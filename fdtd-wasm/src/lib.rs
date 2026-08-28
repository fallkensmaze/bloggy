use wasm_bindgen::prelude::*;

const COURANT: f32 = 0.99 / std::f32::consts::SQRT_2;
const ANGLE_SAMPLES: usize = 72;

struct PmlAxis {
    kappa: Vec<f32>,
    b: Vec<f32>,
    c: Vec<f32>,
}

fn make_pml_axis(
    length: usize,
    thickness: usize,
    stagger: f32,
    target_reflection: f32,
    kappa_max: f32,
    alpha_max: f32,
) -> PmlAxis {
    let mut kappa = vec![1.0; length];
    let mut b = vec![1.0; length];
    let mut c = vec![0.0; length];
    let order = 3.0_f32;
    let sigma_max = -((order + 1.0) * target_reflection.ln()) / (2.0 * thickness as f32);

    for index in 0..length {
        let position = index as f32 + stagger;
        let left_depth = if position < thickness as f32 {
            (thickness as f32 - position) / thickness as f32
        } else {
            0.0
        };
        let right_start = (length - 1 - thickness) as f32;
        let right_depth = if position > right_start {
            (position - right_start) / thickness as f32
        } else {
            0.0
        };
        let depth = left_depth.max(right_depth).min(1.0);
        if depth <= 0.0 {
            continue;
        }
        let graded = depth.powf(order);
        let sigma = sigma_max * graded;
        let local_kappa = 1.0 + (kappa_max - 1.0) * graded;
        let alpha = alpha_max * (1.0 - depth);
        let local_b = (-(sigma / local_kappa + alpha) * COURANT).exp();
        let denominator = sigma * local_kappa + local_kappa * local_kappa * alpha;
        kappa[index] = local_kappa;
        b[index] = local_b;
        c[index] = if denominator > 1e-12 {
            sigma * (local_b - 1.0) / denominator
        } else {
            0.0
        };
    }
    PmlAxis { kappa, b, c }
}

#[wasm_bindgen]
pub struct FdtdSimulation {
    nx: usize,
    ny: usize,
    ex: Vec<f32>,
    ey: Vec<f32>,
    hz: Vec<f32>,
    epsilon_r: Vec<f32>,
    metal: Vec<u8>,
    psi_hz_x: Vec<f32>,
    psi_hz_y: Vec<f32>,
    psi_ex_y: Vec<f32>,
    psi_ey_x: Vec<f32>,
    pml_x_h: PmlAxis,
    pml_y_h: PmlAxis,
    pml_x_e: PmlAxis,
    pml_y_e: PmlAxis,
    step_count: u32,
    wavelength_cells: f32,
    source_kind: u8,
    source_amplitude: f32,
    source_x: usize,
    source_y: usize,
    monitor_start: u32,
    monitor_indices: Vec<usize>,
    monitor_cos: Vec<f32>,
    monitor_sin: Vec<f32>,
    ex_re: Vec<f64>,
    ex_im: Vec<f64>,
    ey_re: Vec<f64>,
    ey_im: Vec<f64>,
    hz_re: Vec<f64>,
    hz_im: Vec<f64>,
    v_re: f64,
    v_im: f64,
    i_re: f64,
    i_im: f64,
    measurements: u32,
}

#[wasm_bindgen]
impl FdtdSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new(
        nx: usize,
        ny: usize,
        wavelength_cells: f32,
        dipole_fraction: f32,
        pml_cells: usize,
        target_reflection: f32,
        source_kind: u8,
        source_amplitude: f32,
        dielectric_enabled: bool,
        kappa_max: f32,
        alpha_max: f32,
    ) -> FdtdSimulation {
        let nx = nx.clamp(80, 520);
        let ny = ny.clamp(60, 360);
        let wavelength_cells = wavelength_cells.clamp(16.0, 100.0);
        let pml_cells = pml_cells.clamp(8, nx.min(ny) / 3);
        let target_reflection = target_reflection.clamp(1e-12, 1e-2);
        let kappa_max = kappa_max.clamp(1.0, 12.0);
        let alpha_max = alpha_max.clamp(0.0, 0.25);
        let len = nx * ny;
        let source_x = nx / 2;
        let source_y = ny / 2;

        let mut metal = vec![0; len];
        let total_dipole = (wavelength_cells * dipole_fraction.clamp(0.1, 0.95))
            .round()
            .max(6.0) as usize;
        let arm = (total_dipole.saturating_sub(1) / 2).max(3);
        for x in source_x.saturating_sub(1)..=(source_x + 1).min(nx - 1) {
            for offset in 1..=arm {
                if source_y >= offset {
                    metal[(source_y - offset) * nx + x] = 1;
                }
                if source_y + offset < ny {
                    metal[(source_y + offset) * nx + x] = 1;
                }
            }
        }

        let mut epsilon_r = vec![1.0; len];
        if dielectric_enabled {
            let x0 = source_x + (wavelength_cells * 0.65) as usize;
            let x1 = (x0 + (wavelength_cells * 0.55) as usize).min(nx - pml_cells - 2);
            let y0 = source_y.saturating_sub((wavelength_cells * 0.75) as usize);
            let y1 = (source_y + (wavelength_cells * 0.75) as usize).min(ny - 1);
            if x0 < x1 {
                for y in y0..=y1 {
                    for x in x0..=x1 {
                        epsilon_r[y * nx + x] = 4.0;
                    }
                }
            }
        }

        let monitor_radius = (nx.min(ny) / 2).saturating_sub(pml_cells + 5).max(8);
        let mut monitor_indices = Vec::with_capacity(ANGLE_SAMPLES);
        let mut monitor_cos = Vec::with_capacity(ANGLE_SAMPLES);
        let mut monitor_sin = Vec::with_capacity(ANGLE_SAMPLES);
        for angle_index in 0..ANGLE_SAMPLES {
            let angle = angle_index as f32 * std::f32::consts::TAU / ANGLE_SAMPLES as f32;
            let cos = angle.cos();
            let sin = angle.sin();
            let x = (source_x as f32 + monitor_radius as f32 * cos)
                .round()
                .clamp(1.0, (nx - 2) as f32) as usize;
            let y = (source_y as f32 - monitor_radius as f32 * sin)
                .round()
                .clamp(1.0, (ny - 2) as f32) as usize;
            monitor_indices.push(y * nx + x);
            monitor_cos.push(cos);
            monitor_sin.push(sin);
        }
        let monitor_start = (monitor_radius as f32 / COURANT + wavelength_cells / COURANT).ceil() as u32;

        FdtdSimulation {
            nx,
            ny,
            ex: vec![0.0; len],
            ey: vec![0.0; len],
            hz: vec![0.0; len],
            epsilon_r,
            metal,
            psi_hz_x: vec![0.0; len],
            psi_hz_y: vec![0.0; len],
            psi_ex_y: vec![0.0; len],
            psi_ey_x: vec![0.0; len],
            pml_x_h: make_pml_axis(nx, pml_cells, 0.5, target_reflection, kappa_max, alpha_max),
            pml_y_h: make_pml_axis(ny, pml_cells, 0.5, target_reflection, kappa_max, alpha_max),
            pml_x_e: make_pml_axis(nx, pml_cells, 0.0, target_reflection, kappa_max, alpha_max),
            pml_y_e: make_pml_axis(ny, pml_cells, 0.0, target_reflection, kappa_max, alpha_max),
            step_count: 0,
            wavelength_cells,
            source_kind: source_kind.min(1),
            source_amplitude: source_amplitude.clamp(0.01, 4.0),
            source_x,
            source_y,
            monitor_start,
            monitor_indices,
            monitor_cos,
            monitor_sin,
            ex_re: vec![0.0; ANGLE_SAMPLES],
            ex_im: vec![0.0; ANGLE_SAMPLES],
            ey_re: vec![0.0; ANGLE_SAMPLES],
            ey_im: vec![0.0; ANGLE_SAMPLES],
            hz_re: vec![0.0; ANGLE_SAMPLES],
            hz_im: vec![0.0; ANGLE_SAMPLES],
            v_re: 0.0,
            v_im: 0.0,
            i_re: 0.0,
            i_im: 0.0,
            measurements: 0,
        }
    }

    pub fn step(&mut self, steps: u32) {
        for _ in 0..steps.min(64) {
            self.single_step();
        }
    }

    pub fn reset(&mut self) {
        self.ex.fill(0.0);
        self.ey.fill(0.0);
        self.hz.fill(0.0);
        self.psi_hz_x.fill(0.0);
        self.psi_hz_y.fill(0.0);
        self.psi_ex_y.fill(0.0);
        self.psi_ey_x.fill(0.0);
        self.ex_re.fill(0.0);
        self.ex_im.fill(0.0);
        self.ey_re.fill(0.0);
        self.ey_im.fill(0.0);
        self.hz_re.fill(0.0);
        self.hz_im.fill(0.0);
        self.v_re = 0.0;
        self.v_im = 0.0;
        self.i_re = 0.0;
        self.i_im = 0.0;
        self.measurements = 0;
        self.step_count = 0;
    }

    pub fn field_snapshot(&self) -> Vec<f32> { self.hz.clone() }
    pub fn metal_snapshot(&self) -> Vec<u8> { self.metal.clone() }
    pub fn material_snapshot(&self) -> Vec<f32> { self.epsilon_r.clone() }
    pub fn step_count(&self) -> u32 { self.step_count }
    pub fn measurement_count(&self) -> u32 { self.measurements }
    pub fn nx(&self) -> usize { self.nx }
    pub fn ny(&self) -> usize { self.ny }

    pub fn energy(&self) -> f32 {
        self.ex.iter().zip(&self.ey).zip(&self.hz)
            .map(|((ex, ey), hz)| ex * ex + ey * ey + hz * hz)
            .sum::<f32>() / (self.nx * self.ny) as f32
    }

    pub fn radiation_pattern(&self) -> Vec<f32> {
        let mut pattern = vec![0.0; ANGLE_SAMPLES];
        let mut maximum = 0.0_f32;
        for angle_index in 0..ANGLE_SAMPLES {
            let radial_e_re = self.ey_re[angle_index] * self.monitor_cos[angle_index] as f64
                - self.ex_re[angle_index] * self.monitor_sin[angle_index] as f64;
            let radial_e_im = self.ey_im[angle_index] * self.monitor_cos[angle_index] as f64
                - self.ex_im[angle_index] * self.monitor_sin[angle_index] as f64;
            let flux = (0.5 * (radial_e_re * self.hz_re[angle_index]
                + radial_e_im * self.hz_im[angle_index])).max(0.0) as f32;
            pattern[angle_index] = flux;
            maximum = maximum.max(flux);
        }
        if maximum > 0.0 {
            for value in &mut pattern { *value /= maximum; }
        }
        pattern
    }

    pub fn directivity_2d(&self) -> f32 {
        let pattern = self.radiation_pattern();
        let mean = pattern.iter().sum::<f32>() / pattern.len() as f32;
        let maximum = pattern.iter().copied().fold(0.0_f32, f32::max);
        if mean > 1e-12 { maximum / mean } else { 0.0 }
    }

    pub fn impedance_real(&self) -> f64 {
        let denominator = self.i_re * self.i_re + self.i_im * self.i_im;
        if denominator > 1e-18 {
            (self.v_re * self.i_re + self.v_im * self.i_im) / denominator
        } else { 0.0 }
    }

    pub fn impedance_imag(&self) -> f64 {
        let denominator = self.i_re * self.i_re + self.i_im * self.i_im;
        if denominator > 1e-18 {
            (self.v_im * self.i_re - self.v_re * self.i_im) / denominator
        } else { 0.0 }
    }
}

impl FdtdSimulation {
    fn single_step(&mut self) {
        for y in 0..self.ny - 1 {
            for x in 0..self.nx - 1 {
                let i = y * self.nx + x;
                let d_ex_dy = self.ex[i + self.nx] - self.ex[i];
                let d_ey_dx = self.ey[i + 1] - self.ey[i];
                self.psi_hz_y[i] = self.pml_y_h.b[y] * self.psi_hz_y[i] + self.pml_y_h.c[y] * d_ex_dy;
                self.psi_hz_x[i] = self.pml_x_h.b[x] * self.psi_hz_x[i] + self.pml_x_h.c[x] * d_ey_dx;
                let corrected_y = d_ex_dy / self.pml_y_h.kappa[y] + self.psi_hz_y[i];
                let corrected_x = d_ey_dx / self.pml_x_h.kappa[x] + self.psi_hz_x[i];
                self.hz[i] += COURANT * (corrected_y - corrected_x);
            }
        }

        for y in 1..self.ny - 1 {
            for x in 1..self.nx - 1 {
                let i = y * self.nx + x;
                let inv_eps = 1.0 / self.epsilon_r[i];
                let d_hz_dy = self.hz[i] - self.hz[i - self.nx];
                let d_hz_dx = self.hz[i] - self.hz[i - 1];
                self.psi_ex_y[i] = self.pml_y_e.b[y] * self.psi_ex_y[i] + self.pml_y_e.c[y] * d_hz_dy;
                self.psi_ey_x[i] = self.pml_x_e.b[x] * self.psi_ey_x[i] + self.pml_x_e.c[x] * d_hz_dx;
                self.ex[i] += COURANT * inv_eps * (d_hz_dy / self.pml_y_e.kappa[y] + self.psi_ex_y[i]);
                self.ey[i] -= COURANT * inv_eps * (d_hz_dx / self.pml_x_e.kappa[x] + self.psi_ey_x[i]);
            }
        }

        let source_index = self.source_y * self.nx + self.source_x;
        self.ey[source_index] += self.source_value();
        for i in 0..self.metal.len() {
            if self.metal[i] != 0 {
                self.ex[i] = 0.0;
                self.ey[i] = 0.0;
            }
        }
        for x in 0..self.nx {
            self.ex[x] = 0.0;
            self.ey[x] = 0.0;
            let bottom = (self.ny - 1) * self.nx + x;
            self.ex[bottom] = 0.0;
            self.ey[bottom] = 0.0;
        }
        for y in 0..self.ny {
            let left = y * self.nx;
            let right = left + self.nx - 1;
            self.ex[left] = 0.0;
            self.ey[left] = 0.0;
            self.ex[right] = 0.0;
            self.ey[right] = 0.0;
        }

        self.step_count = self.step_count.wrapping_add(1);
        if self.step_count >= self.monitor_start {
            self.accumulate_monitors();
        }
    }

    fn source_value(&self) -> f32 {
        let t = self.step_count as f32 * COURANT;
        let phase = std::f32::consts::TAU * t / self.wavelength_cells;
        if self.source_kind == 0 {
            self.source_amplitude * (1.0 - (-(self.step_count as f32) / 45.0).exp()) * phase.sin()
        } else {
            let centre = 2.8 * self.wavelength_cells;
            let width = 0.72 * self.wavelength_cells;
            self.source_amplitude * (-((t - centre) / width).powi(2)).exp() * phase.sin()
        }
    }

    fn accumulate_monitors(&mut self) {
        let phase = std::f64::consts::TAU * self.step_count as f64 * COURANT as f64 / self.wavelength_cells as f64;
        let cos = phase.cos();
        let sin = -phase.sin();
        for angle_index in 0..ANGLE_SAMPLES {
            let i = self.monitor_indices[angle_index];
            self.ex_re[angle_index] += self.ex[i] as f64 * cos;
            self.ex_im[angle_index] += self.ex[i] as f64 * sin;
            self.ey_re[angle_index] += self.ey[i] as f64 * cos;
            self.ey_im[angle_index] += self.ey[i] as f64 * sin;
            self.hz_re[angle_index] += self.hz[i] as f64 * cos;
            self.hz_im[angle_index] += self.hz[i] as f64 * sin;
        }
        let source_index = self.source_y * self.nx + self.source_x;
        let current = (self.port_current_at(self.source_y - 1) + self.port_current_at(self.source_y + 1)) * 0.5;
        let voltage = self.ey[source_index];
        self.v_re += voltage as f64 * cos;
        self.v_im += voltage as f64 * sin;
        self.i_re += current as f64 * cos;
        self.i_im += current as f64 * sin;
        self.measurements += 1;
    }

    fn port_current_at(&self, y: usize) -> f32 {
        let left = y * self.nx + self.source_x.saturating_sub(2);
        let right = y * self.nx + (self.source_x + 2).min(self.nx - 1);
        self.hz[right] - self.hz[left]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn simulation(source_kind: u8) -> FdtdSimulation {
        FdtdSimulation::new(140, 100, 28.0, 0.47, 14, 1e-8, source_kind, 0.8, false, 5.0, 0.05)
    }

    #[test]
    fn builds_cpml_grid_and_dipole() {
        let sim = simulation(0);
        assert_eq!(sim.field_snapshot().len(), 14_000);
        assert!(sim.metal_snapshot().iter().filter(|&&value| value == 1).count() >= 18);
        assert!(sim.pml_x_e.kappa[0] > 1.0);
        assert_eq!(sim.step_count(), 0);
    }

    #[test]
    fn propagation_and_port_observables_remain_finite() {
        let mut sim = simulation(0);
        for _ in 0..10 { sim.step(64); }
        assert!(sim.energy().is_finite() && sim.energy() > 0.0);
        assert!(sim.field_snapshot().iter().all(|value| value.is_finite()));
        assert!(sim.measurement_count() > 0);
        assert!(sim.directivity_2d().is_finite());
        assert!(sim.impedance_real().is_finite());
        assert!(sim.impedance_imag().is_finite());
    }

    #[test]
    fn cpml_removes_most_pulse_energy() {
        let mut sim = simulation(1);
        let mut peak = 0.0_f32;
        for _ in 0..16 {
            sim.step(64);
            peak = peak.max(sim.energy());
        }
        assert!(peak > 0.0);
        assert!(sim.energy() < peak * 0.08, "remaining={} peak={}", sim.energy(), peak);
    }

    #[test]
    fn reset_clears_dynamic_and_measurement_state() {
        let mut sim = simulation(0);
        sim.step(256);
        sim.reset();
        assert_eq!(sim.step_count(), 0);
        assert_eq!(sim.measurement_count(), 0);
        assert_eq!(sim.energy(), 0.0);
    }
}
