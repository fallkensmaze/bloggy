use wasm_bindgen::prelude::*;

mod cartesian3d;
pub use cartesian3d::FdtdSimulation3d;

const COURANT: f32 = 0.5;
const ETA0: f64 = 376.730_313_668;
const SPECTRUM_BINS: usize = 41;
const SPECTRUM_MIN: f64 = 0.7;
const SPECTRUM_MAX: f64 = 1.3;
const SPECTRAL_STRIDE: u32 = 2;
const TRACE_LIMIT: usize = 4096;
const PATTERN_SAMPLES: usize = 72;

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
    absorb_left: bool,
) -> PmlAxis {
    let mut kappa = vec![1.0; length];
    let mut b = vec![1.0; length];
    let mut c = vec![0.0; length];
    let order = 3.0_f32;
    let sigma_max = -((order + 1.0) * target_reflection.ln()) / (2.0 * thickness as f32);

    for index in 0..length {
        let position = index as f32 + stagger;
        let left_depth = if absorb_left && position < thickness as f32 {
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
    nz: usize,
    nr: usize,
    er: Vec<f32>,
    ez: Vec<f32>,
    hphi: Vec<f32>,
    epsilon_r: Vec<f32>,
    metal: Vec<u8>,
    psi_hphi_r: Vec<f32>,
    psi_hphi_z: Vec<f32>,
    psi_er_z: Vec<f32>,
    psi_ez_r: Vec<f32>,
    pml_r_h: PmlAxis,
    pml_z_h: PmlAxis,
    pml_r_e: PmlAxis,
    pml_z_e: PmlAxis,
    step_count: u32,
    wavelength_cells: f32,
    source_kind: u8,
    source_amplitude: f32,
    source_z: usize,
    is_monopole: bool,
    ground_z: usize,
    wire_radius: usize,
    wire_start: usize,
    wire_end: usize,
    frequency_ratios: Vec<f64>,
    v_re: Vec<f64>,
    v_im: Vec<f64>,
    i_re: Vec<f64>,
    i_im: Vec<f64>,
    profile_re: Vec<f64>,
    profile_im: Vec<f64>,
    voltage_trace: Vec<f32>,
    current_trace: Vec<f32>,
    measurements: u32,
}

#[wasm_bindgen]
impl FdtdSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new(
        nx: usize,
        nz: usize,
        wavelength_cells: f32,
        dipole_fraction: f32,
        pml_cells: usize,
        target_reflection: f32,
        source_kind: u8,
        source_amplitude: f32,
        dielectric_enabled: bool,
        kappa_max: f32,
        alpha_max: f32,
        wire_radius_cells: usize,
        antenna_kind: u8,
    ) -> FdtdSimulation {
        let nx = nx.clamp(120, 520);
        let nz = nz.clamp(80, 360);
        let nr = nx / 2 + 1;
        let wavelength_cells = wavelength_cells.clamp(18.0, 100.0);
        let pml_cells = pml_cells.clamp(8, nr.min(nz) / 3);
        let target_reflection = target_reflection.clamp(1e-12, 1e-2);
        let kappa_max = kappa_max.clamp(1.0, 12.0);
        let alpha_max = alpha_max.clamp(0.0, 0.25);
        let wire_radius = wire_radius_cells.clamp(1, 6);
        let len = nr * nz;
        let is_monopole = antenna_kind == 1;
        let ground_z = if is_monopole { (nz * 36 / 100).max(pml_cells + 5) } else { 0 };
        let source_z = if is_monopole { ground_z + 1 } else { nz / 2 };

        let total_dipole = (wavelength_cells * dipole_fraction.clamp(0.1, 1.8))
            .round()
            .max(8.0) as usize;
        let arm = if is_monopole { total_dipole } else { (total_dipole.saturating_sub(1) / 2).max(4) };
        let wire_start = if is_monopole { source_z + 1 } else { source_z.saturating_sub(arm).max(1) };
        let wire_end = (source_z + arm).min(nz - 2);
        let mut metal = vec![0; len];
        for z in wire_start..=wire_end {
            if z == source_z {
                continue;
            }
            for r in 0..=wire_radius {
                metal[z * nr + r] = 1;
            }
        }
        if is_monopole {
            for r in 0..nr {
                metal[ground_z * nr + r] = 1;
            }
        }

        let mut epsilon_r = vec![1.0; len];
        if dielectric_enabled {
            let r0 = (wavelength_cells * 0.62).round() as usize;
            let r1 = (r0 + (wavelength_cells * 0.5).round() as usize).min(nr - pml_cells - 2);
            let z0 = source_z.saturating_sub((wavelength_cells * 0.7).round() as usize).max(1);
            let z1 = (source_z + (wavelength_cells * 0.7).round() as usize).min(nz - 2);
            if r0 <= r1 {
                for z in z0..=z1 {
                    for r in r0..=r1 {
                        epsilon_r[z * nr + r] = 4.0;
                    }
                }
            }
        }

        let frequency_ratios = (0..SPECTRUM_BINS)
            .map(|index| SPECTRUM_MIN + index as f64 * (SPECTRUM_MAX - SPECTRUM_MIN) / (SPECTRUM_BINS - 1) as f64)
            .collect::<Vec<_>>();

        FdtdSimulation {
            nx,
            nz,
            nr,
            er: vec![0.0; len],
            ez: vec![0.0; len],
            hphi: vec![0.0; len],
            epsilon_r,
            metal,
            psi_hphi_r: vec![0.0; len],
            psi_hphi_z: vec![0.0; len],
            psi_er_z: vec![0.0; len],
            psi_ez_r: vec![0.0; len],
            pml_r_h: make_pml_axis(nr, pml_cells, 0.5, target_reflection, kappa_max, alpha_max, false),
            pml_z_h: make_pml_axis(nz, pml_cells, 0.5, target_reflection, kappa_max, alpha_max, true),
            pml_r_e: make_pml_axis(nr, pml_cells, 0.0, target_reflection, kappa_max, alpha_max, false),
            pml_z_e: make_pml_axis(nz, pml_cells, 0.0, target_reflection, kappa_max, alpha_max, true),
            step_count: 0,
            wavelength_cells,
            source_kind: source_kind.min(1),
            source_amplitude: source_amplitude.clamp(0.01, 4.0),
            source_z,
            is_monopole,
            ground_z,
            wire_radius,
            wire_start,
            wire_end,
            frequency_ratios,
            v_re: vec![0.0; SPECTRUM_BINS],
            v_im: vec![0.0; SPECTRUM_BINS],
            i_re: vec![0.0; SPECTRUM_BINS],
            i_im: vec![0.0; SPECTRUM_BINS],
            profile_re: vec![0.0; SPECTRUM_BINS * nz],
            profile_im: vec![0.0; SPECTRUM_BINS * nz],
            voltage_trace: Vec::with_capacity(TRACE_LIMIT),
            current_trace: Vec::with_capacity(TRACE_LIMIT),
            measurements: 0,
        }
    }

    pub fn step(&mut self, steps: u32) {
        for _ in 0..steps.min(64) {
            self.single_step();
        }
    }

    pub fn reset(&mut self) {
        self.er.fill(0.0);
        self.ez.fill(0.0);
        self.hphi.fill(0.0);
        self.psi_hphi_r.fill(0.0);
        self.psi_hphi_z.fill(0.0);
        self.psi_er_z.fill(0.0);
        self.psi_ez_r.fill(0.0);
        self.v_re.fill(0.0);
        self.v_im.fill(0.0);
        self.i_re.fill(0.0);
        self.i_im.fill(0.0);
        self.profile_re.fill(0.0);
        self.profile_im.fill(0.0);
        self.voltage_trace.clear();
        self.current_trace.clear();
        self.measurements = 0;
        self.step_count = 0;
    }

    pub fn field_snapshot(&self) -> Vec<f32> { self.mirror_f32(&self.hphi) }
    pub fn magnetic_field_snapshot(&self) -> Vec<f32> { self.field_snapshot() }
    pub fn electric_z_snapshot(&self) -> Vec<f32> { self.mirror_f32(&self.ez) }
    pub fn electric_r_snapshot(&self) -> Vec<f32> {
        let mut snapshot = self.mirror_f32(&self.er);
        let half = self.nx / 2;
        for z in 0..self.nz {
            for x in 0..half {
                snapshot[z * self.nx + x] *= -1.0;
            }
        }
        snapshot
    }
    pub fn electric_magnitude_snapshot(&self) -> Vec<f32> {
        let magnitude = self.er.iter().zip(&self.ez)
            .map(|(er, ez)| (er * er + ez * ez).sqrt())
            .collect::<Vec<_>>();
        self.mirror_f32(&magnitude)
    }
    pub fn metal_snapshot(&self) -> Vec<u8> { self.mirror_u8(&self.metal) }
    pub fn material_snapshot(&self) -> Vec<f32> { self.mirror_f32(&self.epsilon_r) }
    pub fn time_voltage_snapshot(&self) -> Vec<f32> { self.voltage_trace.clone() }
    pub fn time_current_snapshot(&self) -> Vec<f32> { self.current_trace.clone() }
    pub fn spectrum_frequencies(&self) -> Vec<f32> { self.frequency_ratios.iter().map(|value| *value as f32).collect() }
    pub fn spectrum_impedance_real(&self) -> Vec<f64> { (0..SPECTRUM_BINS).map(|bin| self.impedance_at(bin).0).collect() }
    pub fn spectrum_impedance_imag(&self) -> Vec<f64> { (0..SPECTRUM_BINS).map(|bin| self.impedance_at(bin).1).collect() }
    pub fn spectrum_current_magnitude(&self) -> Vec<f64> {
        (0..SPECTRUM_BINS).map(|bin| self.i_re[bin].hypot(self.i_im[bin])).collect()
    }
    pub fn step_count(&self) -> u32 { self.step_count }
    pub fn measurement_count(&self) -> u32 { self.measurements }
    pub fn nx(&self) -> usize { self.nx }
    pub fn ny(&self) -> usize { self.nz }
    pub fn time_step(&self) -> f32 { COURANT }
    pub fn wire_start(&self) -> usize { self.wire_start }
    pub fn wire_end(&self) -> usize { self.wire_end }
    pub fn feed_position(&self) -> usize { self.source_z }

    pub fn energy(&self) -> f32 {
        let mut total = 0.0_f64;
        let mut weights = 0.0_f64;
        for z in 0..self.nz {
            for r in 0..self.nr {
                let i = z * self.nr + r;
                let weight = r as f64 + 0.5;
                total += weight * (self.er[i] as f64 * self.er[i] as f64
                    + self.ez[i] as f64 * self.ez[i] as f64
                    + self.hphi[i] as f64 * self.hphi[i] as f64);
                weights += weight;
            }
        }
        (total / weights) as f32
    }

    pub fn resonance_index(&self) -> usize {
        let maximum_current = (0..SPECTRUM_BINS)
            .map(|bin| self.i_re[bin].hypot(self.i_im[bin]))
            .fold(0.0_f64, f64::max);
        let mut best = SPECTRUM_BINS / 2;
        let mut score = f64::INFINITY;
        for bin in 1..SPECTRUM_BINS - 1 {
            let current = self.i_re[bin].hypot(self.i_im[bin]);
            let impedance = self.impedance_at(bin);
            if current < maximum_current * 0.06 || !impedance.0.is_finite() || impedance.0 <= 0.0 || impedance.0 > 2000.0 {
                continue;
            }
            let local_score = impedance.1.abs() + (self.frequency_ratios[bin] - 1.0).abs() * 2.0;
            if local_score < score {
                score = local_score;
                best = bin;
            }
        }
        best
    }

    pub fn current_profile(&self, bin: usize) -> Vec<f32> {
        let bin = bin.min(SPECTRUM_BINS - 1);
        let offset = bin * self.nz;
        let mut profile = vec![0.0_f32; self.nz];
        let mut maximum = 0.0_f32;
        for z in self.wire_start..=self.wire_end {
            profile[z] = self.profile_re[offset + z].hypot(self.profile_im[offset + z]) as f32;
            maximum = maximum.max(profile[z]);
        }
        if maximum > 0.0 {
            for value in &mut profile {
                *value /= maximum;
            }
        }
        profile
    }

    pub fn radiation_pattern_at(&self, bin: usize) -> Vec<f32> {
        let bin = bin.min(SPECTRUM_BINS - 1);
        let mut pattern = vec![0.0_f32; PATTERN_SAMPLES];
        let mut maximum = 0.0_f32;
        for (sample, value) in pattern.iter_mut().enumerate() {
            let angle = sample as f64 * std::f64::consts::TAU / PATTERN_SAMPLES as f64;
            let theta = if angle <= std::f64::consts::PI { angle } else { std::f64::consts::TAU - angle };
            *value = self.radiation_power(bin, theta) as f32;
            maximum = maximum.max(*value);
        }
        if maximum > 0.0 {
            for value in &mut pattern {
                *value /= maximum;
            }
        }
        pattern
    }

    pub fn directivity_3d_at(&self, bin: usize) -> f32 {
        let bin = bin.min(SPECTRUM_BINS - 1);
        let upper_limit = if self.is_monopole { std::f64::consts::FRAC_PI_2 } else { std::f64::consts::PI };
        let samples = if self.is_monopole { 90_usize } else { 180_usize };
        let delta = upper_limit / samples as f64;
        let mut maximum = 0.0_f64;
        let mut integral = 0.0_f64;
        for sample in 0..=samples {
            let theta = sample as f64 * delta;
            let power = self.radiation_power(bin, theta);
            maximum = maximum.max(power);
            let weight = if sample == 0 || sample == samples { 0.5 } else { 1.0 };
            integral += weight * power * theta.sin() * delta;
        }
        if integral > 1e-18 { (2.0 * maximum / integral) as f32 } else { 0.0 }
    }

    pub fn radiation_pattern(&self) -> Vec<f32> { self.radiation_pattern_at(self.resonance_index()) }
    pub fn directivity_2d(&self) -> f32 { self.directivity_3d_at(self.resonance_index()) }
    pub fn directivity_3d(&self) -> f32 { self.directivity_3d_at(self.resonance_index()) }
    pub fn impedance_real(&self) -> f64 { self.impedance_at(SPECTRUM_BINS / 2).0 }
    pub fn impedance_imag(&self) -> f64 { self.impedance_at(SPECTRUM_BINS / 2).1 }
}

impl FdtdSimulation {
    fn single_step(&mut self) {
        for z in 0..self.nz - 1 {
            for r in 0..self.nr - 1 {
                let i = z * self.nr + r;
                let d_er_dz = self.er[i + self.nr] - self.er[i];
                let d_ez_dr = self.ez[i + 1] - self.ez[i];
                self.psi_hphi_z[i] = self.pml_z_h.b[z] * self.psi_hphi_z[i] + self.pml_z_h.c[z] * d_er_dz;
                self.psi_hphi_r[i] = self.pml_r_h.b[r] * self.psi_hphi_r[i] + self.pml_r_h.c[r] * d_ez_dr;
                let corrected_z = d_er_dz / self.pml_z_h.kappa[z] + self.psi_hphi_z[i];
                let corrected_r = d_ez_dr / self.pml_r_h.kappa[r] + self.psi_hphi_r[i];
                self.hphi[i] += COURANT * (corrected_r - corrected_z);
            }
        }

        for z in 1..self.nz - 1 {
            for r in 0..self.nr - 1 {
                let i = z * self.nr + r;
                let inv_eps = 1.0 / self.epsilon_r[i];
                let d_h_dz = self.hphi[i] - self.hphi[i - self.nr];
                self.psi_er_z[i] = self.pml_z_e.b[z] * self.psi_er_z[i] + self.pml_z_e.c[z] * d_h_dz;
                self.er[i] -= COURANT * inv_eps * (d_h_dz / self.pml_z_e.kappa[z] + self.psi_er_z[i]);

                let radial_curl = if r == 0 {
                    4.0 * self.hphi[i]
                } else {
                    let d_h_dr = self.hphi[i] - self.hphi[i - 1];
                    self.psi_ez_r[i] = self.pml_r_e.b[r] * self.psi_ez_r[i] + self.pml_r_e.c[r] * d_h_dr;
                    d_h_dr / self.pml_r_e.kappa[r] + self.psi_ez_r[i]
                        + (self.hphi[i] + self.hphi[i - 1]) / (2.0 * r as f32)
                };
                self.ez[i] += COURANT * inv_eps * radial_curl;
            }
        }

        let drive = self.source_value();
        for r in 0..=self.wire_radius {
            self.ez[self.source_z * self.nr + r] += drive;
        }
        for i in 0..self.metal.len() {
            if self.metal[i] != 0 {
                self.er[i] = 0.0;
                self.ez[i] = 0.0;
            }
        }
        for z in 0..self.nz {
            self.er[z * self.nr] = 0.0;
        }
        for r in 0..self.nr {
            self.er[r] = 0.0;
            self.ez[r] = 0.0;
            let far_z = (self.nz - 1) * self.nr + r;
            self.er[far_z] = 0.0;
            self.ez[far_z] = 0.0;
        }
        for z in 0..self.nz {
            let outer = z * self.nr + self.nr - 1;
            self.er[outer] = 0.0;
            self.ez[outer] = 0.0;
        }

        self.step_count = self.step_count.wrapping_add(1);
        let voltage = self.port_voltage();
        let current = self.port_current();
        if self.voltage_trace.len() < TRACE_LIMIT {
            self.voltage_trace.push(voltage);
            self.current_trace.push(current);
        }
        if self.step_count % SPECTRAL_STRIDE == 0 {
            self.accumulate_spectra(voltage, current);
        }
    }

    fn source_value(&self) -> f32 {
        let t = self.step_count as f32 * COURANT;
        let phase = std::f32::consts::TAU * t / self.wavelength_cells;
        if self.source_kind == 0 {
            self.source_amplitude * (1.0 - (-(self.step_count as f32) / 45.0).exp()) * phase.sin()
        } else {
            let centre = 3.0 * self.wavelength_cells;
            let width = 0.48 * self.wavelength_cells;
            self.source_amplitude * (-((t - centre) / width).powi(2)).exp() * phase.sin()
        }
    }

    fn port_voltage(&self) -> f32 {
        let mut voltage = 0.0;
        for r in 0..=self.wire_radius {
            voltage += self.ez[self.source_z * self.nr + r];
        }
        voltage / (self.wire_radius + 1) as f32
    }

    fn wire_current_at(&self, z: usize) -> f32 {
        if z < self.wire_start || z > self.wire_end || z == self.source_z {
            return 0.0;
        }
        let radius_index = (self.wire_radius + 1).min(self.nr - 2);
        -std::f32::consts::TAU * (radius_index as f32 + 0.5) * self.hphi[z * self.nr + radius_index]
    }

    fn port_current(&self) -> f32 {
        if self.is_monopole {
            return self.wire_current_at(self.source_z + 1);
        }
        0.5 * (self.wire_current_at(self.source_z - 1) + self.wire_current_at(self.source_z + 1))
    }

    fn accumulate_spectra(&mut self, voltage: f32, current: f32) {
        let t = self.step_count as f64 * COURANT as f64;
        for bin in 0..SPECTRUM_BINS {
            let phase = std::f64::consts::TAU * t * self.frequency_ratios[bin] / self.wavelength_cells as f64;
            let cos = phase.cos();
            let sin = -phase.sin();
            self.v_re[bin] += voltage as f64 * cos;
            self.v_im[bin] += voltage as f64 * sin;
            self.i_re[bin] += current as f64 * cos;
            self.i_im[bin] += current as f64 * sin;
            let offset = bin * self.nz;
            for z in self.wire_start..=self.wire_end {
                let wire_current = self.wire_current_at(z) as f64;
                self.profile_re[offset + z] += wire_current * cos;
                self.profile_im[offset + z] += wire_current * sin;
            }
        }
        self.measurements += 1;
    }

    fn impedance_at(&self, bin: usize) -> (f64, f64) {
        let bin = bin.min(SPECTRUM_BINS - 1);
        let denominator = self.i_re[bin] * self.i_re[bin] + self.i_im[bin] * self.i_im[bin];
        if denominator <= 1e-18 {
            return (0.0, 0.0);
        }
        (
            ETA0 * (self.v_re[bin] * self.i_re[bin] + self.v_im[bin] * self.i_im[bin]) / denominator,
            ETA0 * (self.v_im[bin] * self.i_re[bin] - self.v_re[bin] * self.i_im[bin]) / denominator,
        )
    }

    fn radiation_power(&self, bin: usize, theta: f64) -> f64 {
        if self.is_monopole && theta > std::f64::consts::FRAC_PI_2 {
            return 0.0;
        }
        let bin = bin.min(SPECTRUM_BINS - 1);
        let offset = bin * self.nz;
        let wave_number = std::f64::consts::TAU * self.frequency_ratios[bin] / self.wavelength_cells as f64;
        let mut real = 0.0;
        let mut imag = 0.0;
        for z in self.wire_start..=self.wire_end {
            let phase = wave_number * (z as f64 - self.source_z as f64) * theta.cos();
            let cos = phase.cos();
            let sin = phase.sin();
            let profile_real = self.profile_re[offset + z];
            let profile_imag = self.profile_im[offset + z];
            real += profile_real * cos - profile_imag * sin;
            imag += profile_real * sin + profile_imag * cos;
            if self.is_monopole {
                let image_phase = wave_number * (2.0 * self.ground_z as f64 - z as f64 - self.source_z as f64) * theta.cos();
                let image_cos = image_phase.cos();
                let image_sin = image_phase.sin();
                real += profile_real * image_cos - profile_imag * image_sin;
                imag += profile_real * image_sin + profile_imag * image_cos;
            }
        }
        (real * real + imag * imag) * theta.sin().powi(2)
    }

    fn mirror_f32(&self, source: &[f32]) -> Vec<f32> {
        let mut result = vec![0.0; self.nx * self.nz];
        let half = self.nx / 2;
        for z in 0..self.nz {
            for x in 0..self.nx {
                let r = (if x < half { half - 1 - x } else { x - half }).min(self.nr - 1);
                result[z * self.nx + x] = source[z * self.nr + r];
            }
        }
        result
    }

    fn mirror_u8(&self, source: &[u8]) -> Vec<u8> {
        let mut result = vec![0; self.nx * self.nz];
        let half = self.nx / 2;
        for z in 0..self.nz {
            for x in 0..self.nx {
                let r = (if x < half { half - 1 - x } else { x - half }).min(self.nr - 1);
                result[z * self.nx + x] = source[z * self.nr + r];
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn simulation(source_kind: u8) -> FdtdSimulation {
        FdtdSimulation::new(240, 150, 40.0, 0.47, 18, 1e-8, source_kind, 0.8, false, 5.0, 0.05, 1, 0)
    }

    #[test]
    fn builds_axisymmetric_cpml_grid_and_dipole() {
        let sim = simulation(0);
        assert_eq!(sim.field_snapshot().len(), 36_000);
        assert!(sim.metal_snapshot().iter().filter(|&&value| value == 1).count() >= 30);
        assert_eq!(sim.pml_r_e.kappa[0], 1.0);
        assert!(sim.pml_r_e.kappa[sim.nr - 1] > 1.0);
        assert_eq!(sim.step_count(), 0);
    }

    #[test]
    fn propagation_and_three_dimensional_observables_remain_finite() {
        let mut sim = simulation(1);
        for _ in 0..12 { sim.step(64); }
        assert!(sim.energy().is_finite() && sim.energy() > 0.0);
        assert!(sim.field_snapshot().iter().all(|value| value.is_finite()));
        assert!(sim.measurement_count() > 0);
        let resonance = sim.resonance_index();
        assert!(sim.directivity_3d_at(resonance).is_finite());
        assert!(sim.impedance_real().is_finite());
        assert!(sim.impedance_imag().is_finite());
        assert_eq!(sim.spectrum_current_magnitude().len(), SPECTRUM_BINS);
        assert_eq!(sim.current_profile(resonance).len(), sim.ny());
    }

    #[test]
    fn cpml_removes_most_pulse_energy() {
        let mut sim = simulation(1);
        let mut peak = 0.0_f32;
        for _ in 0..32 {
            sim.step(64);
            peak = peak.max(sim.energy());
        }
        assert!(peak > 0.0);
        assert!(sim.energy() < peak * 0.08, "remaining={} peak={}", sim.energy(), peak);
    }

    #[test]
    fn reset_clears_dynamic_and_spectral_state() {
        let mut sim = simulation(0);
        sim.step(64);
        sim.reset();
        assert_eq!(sim.step_count(), 0);
        assert_eq!(sim.measurement_count(), 0);
        assert_eq!(sim.energy(), 0.0);
        assert!(sim.time_voltage_snapshot().is_empty());
    }
}
