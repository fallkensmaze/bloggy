use wasm_bindgen::prelude::*;

const COURANT: f32 = 0.42;
const ETA0: f64 = 376.730_313_668;
const BINS: usize = 41;
const TRACE_LIMIT: usize = 4096;
const PATTERN_SAMPLES: usize = 72;
const COURTYARD_LONG_CELLS: usize = 75;
const COURTYARD_SHORT_CELLS: usize = 38;
const COURTYARD_BUILDING_HEIGHT_CELLS: usize = 50;
const COURTYARD_WIRE_CELLS: usize = 25;
const COURTYARD_EPSILON: f32 = 5.0;

struct PmlAxis {
    kappa: Vec<f32>,
    b: Vec<f32>,
    c: Vec<f32>,
}

fn pml_axis(length: usize, thickness: usize, stagger: f32, reflection: f32, kappa_max: f32, alpha_max: f32) -> PmlAxis {
    let mut axis = PmlAxis { kappa: vec![1.0; length], b: vec![1.0; length], c: vec![0.0; length] };
    let sigma_max = -(4.0 * reflection.ln()) / (2.0 * thickness as f32);
    for index in 0..length {
        let position = index as f32 + stagger;
        let left = if position < thickness as f32 { (thickness as f32 - position) / thickness as f32 } else { 0.0 };
        let right_start = (length - 1 - thickness) as f32;
        let right = if position > right_start { (position - right_start) / thickness as f32 } else { 0.0 };
        let depth = left.max(right).min(1.0);
        if depth <= 0.0 { continue; }
        let graded = depth.powi(3);
        let sigma = sigma_max * graded;
        let kappa = 1.0 + (kappa_max - 1.0) * graded;
        let alpha = alpha_max * (1.0 - depth);
        let b = (-(sigma / kappa + alpha) * COURANT).exp();
        let denominator = sigma * kappa + kappa * kappa * alpha;
        axis.kappa[index] = kappa;
        axis.b[index] = b;
        axis.c[index] = if denominator > 1e-12 { sigma * (b - 1.0) / denominator } else { 0.0 };
    }
    axis
}

#[derive(Clone)]
struct WireElement {
    axis: u8,
    x: usize,
    y: usize,
    z: usize,
    start: usize,
    end: usize,
    driven: bool,
}

#[wasm_bindgen]
pub struct FdtdSimulation3d {
    is_courtyard: bool,
    gx: usize,
    gy: usize,
    gz: usize,
    wavelength: f32,
    pml_cells: usize,
    source_kind: u8,
    source_amplitude: f32,
    wire_radius: usize,
    cx: usize,
    cy: usize,
    source_position: usize,
    slice_y: usize,
    profile_len: usize,
    steps: u32,
    ex: Vec<f32>, ey: Vec<f32>, ez: Vec<f32>,
    hx: Vec<f32>, hy: Vec<f32>, hz: Vec<f32>,
    epsilon: Vec<f32>,
    metal: Vec<u8>,
    psi_hx_y: Vec<f32>, psi_hx_z: Vec<f32>,
    psi_hy_z: Vec<f32>, psi_hy_x: Vec<f32>,
    psi_hz_x: Vec<f32>, psi_hz_y: Vec<f32>,
    psi_ex_y: Vec<f32>, psi_ex_z: Vec<f32>,
    psi_ey_z: Vec<f32>, psi_ey_x: Vec<f32>,
    psi_ez_x: Vec<f32>, psi_ez_y: Vec<f32>,
    pml_x_h: PmlAxis, pml_y_h: PmlAxis, pml_z_h: PmlAxis,
    pml_x_e: PmlAxis, pml_y_e: PmlAxis, pml_z_e: PmlAxis,
    elements: Vec<WireElement>,
    driven_index: usize,
    scene_geometry: Vec<f32>,
    ratios: Vec<f64>,
    v_re: Vec<f64>, v_im: Vec<f64>, i_re: Vec<f64>, i_im: Vec<f64>,
    profile_re: Vec<f64>, profile_im: Vec<f64>,
    voltage_trace: Vec<f32>, current_trace: Vec<f32>,
    measurements: u32,
}

#[wasm_bindgen]
impl FdtdSimulation3d {
    #[wasm_bindgen(constructor)]
    pub fn new(
        nx: usize,
        nz: usize,
        wavelength_cells: f32,
        _dipole_fraction: f32,
        pml_cells: usize,
        target_reflection: f32,
        source_kind: u8,
        source_amplitude: f32,
        _dielectric_enabled: bool,
        kappa_max: f32,
        alpha_max: f32,
        wire_radius_cells: usize,
        antenna_kind: u8,
        depth_cells: usize,
    ) -> FdtdSimulation3d {
        let is_courtyard = antenna_kind == 3;
        let gx = if is_courtyard { nx.clamp(128, 144) } else { nx.clamp(56, 112) };
        let gy = if is_courtyard { depth_cells.clamp(64, 112) } else { gx };
        let gz = if is_courtyard { nz.clamp(104, 160) } else { nz.clamp(80, 160) };
        let wavelength = wavelength_cells.clamp(14.0, 60.0);
        let pml_cells = pml_cells.clamp(8, gx.min(gy).min(gz) / 3);
        let reflection = target_reflection.clamp(1e-12, 1e-2);
        let kappa_max = kappa_max.clamp(1.0, 12.0);
        let alpha_max = alpha_max.clamp(0.0, 0.25);
        let wire_radius = wire_radius_cells.saturating_sub(1).min(1);
        let cx = gx / 2;
        let cy = gy / 2;
        let len = gx * gy * gz;
        let mut epsilon = vec![1.0; len];
        let (elements, driven_index, source_position, slice_y, scene_geometry) = if is_courtyard {
            let x0 = (gx - COURTYARD_LONG_CELLS - COURTYARD_WIRE_CELLS) / 2;
            let x1 = x0 + COURTYARD_LONG_CELLS;
            let y0 = (gy - COURTYARD_SHORT_CELLS) / 2;
            let y1 = y0 + COURTYARD_SHORT_CELLS;
            let ground = pml_cells + 4;
            let roof = ground + COURTYARD_BUILDING_HEIGHT_CELLS;
            let wire_start = x1;
            let wire_end = wire_start + COURTYARD_WIRE_CELLS;
            let wire_y = y0 + 1;
            let wire_z = roof;
            for z in ground..=roof {
                for x in x0..=x1 {
                    epsilon[(z * gy + y0) * gx + x] = COURTYARD_EPSILON;
                    epsilon[(z * gy + y1) * gx + x] = COURTYARD_EPSILON;
                }
                for y in y0..=y1 {
                    epsilon[(z * gy + y) * gx + x0] = COURTYARD_EPSILON;
                    epsilon[(z * gy + y) * gx + x1] = COURTYARD_EPSILON;
                }
            }
            for x in x0..=x1 { for y in y0..=y1 { epsilon[(roof * gy + y) * gx + x] = COURTYARD_EPSILON; }}
            (
                vec![WireElement { axis: 0, x: 0, y: wire_y, z: wire_z, start: wire_start, end: wire_end, driven: true }],
                0,
                wire_start,
                roof,
                vec![2.0, x0 as f32, x1 as f32, y0 as f32, y1 as f32, ground as f32, roof as f32, wire_start as f32, wire_end as f32, wire_y as f32, wire_z as f32, 0.4],
            )
        } else {
            let source_z = gz / 2;
            let specs = [(-0.22_f32, 0.53_f32, false), (0.0, 0.47, true), (0.17, 0.45, false), (0.34, 0.43, false)];
            let mut elements = Vec::with_capacity(specs.len());
            let mut driven_index = 0;
            for (element_index, (offset, length, driven)) in specs.into_iter().enumerate() {
                let x = (cx as f32 + offset * wavelength).round() as usize;
                let cells = (length * wavelength).round().max(7.0) as usize;
                let start = source_z - cells / 2;
                if driven { driven_index = element_index; }
                elements.push(WireElement { axis: 2, x, y: cy, z: 0, start, end: start + cells, driven });
            }
            (elements, driven_index, source_z, cy, Vec::new())
        };
        let element_count = elements.len();
        let profile_len = gx.max(gz);
        let mut metal = vec![0_u8; len];
        for element in &elements {
            for coordinate in element.start..=element.end {
                if element.driven && coordinate == source_position { continue; }
                let (x, y, z) = Self::point_on_element(element, coordinate);
                if element.axis == 0 {
                    for dz in -(wire_radius as isize)..=wire_radius as isize {
                        for dy in -(wire_radius as isize)..=wire_radius as isize {
                            let yy = (y as isize + dy) as usize;
                            let zz = (z as isize + dz) as usize;
                            metal[(zz * gy + yy) * gx + x] = 1;
                        }
                    }
                } else {
                    for dy in -(wire_radius as isize)..=wire_radius as isize {
                        for dx in -(wire_radius as isize)..=wire_radius as isize {
                            let xx = (x as isize + dx) as usize;
                            let yy = (y as isize + dy) as usize;
                            metal[(z * gy + yy) * gx + xx] = 1;
                        }
                    }
                }
            }
        }
        let ratios = (0..BINS).map(|index| 0.7 + index as f64 * 0.6 / (BINS - 1) as f64).collect::<Vec<_>>();
        FdtdSimulation3d {
            is_courtyard, gx, gy, gz, wavelength, pml_cells,
            source_kind: source_kind.min(1), source_amplitude: source_amplitude.clamp(0.01, 2.0),
            wire_radius, cx, cy, source_position, slice_y, profile_len, steps: 0,
            ex: vec![0.0; len], ey: vec![0.0; len], ez: vec![0.0; len],
            hx: vec![0.0; len], hy: vec![0.0; len], hz: vec![0.0; len],
            epsilon, metal,
            psi_hx_y: vec![0.0; len], psi_hx_z: vec![0.0; len],
            psi_hy_z: vec![0.0; len], psi_hy_x: vec![0.0; len],
            psi_hz_x: vec![0.0; len], psi_hz_y: vec![0.0; len],
            psi_ex_y: vec![0.0; len], psi_ex_z: vec![0.0; len],
            psi_ey_z: vec![0.0; len], psi_ey_x: vec![0.0; len],
            psi_ez_x: vec![0.0; len], psi_ez_y: vec![0.0; len],
            pml_x_h: pml_axis(gx, pml_cells, 0.5, reflection, kappa_max, alpha_max),
            pml_y_h: pml_axis(gy, pml_cells, 0.5, reflection, kappa_max, alpha_max),
            pml_z_h: pml_axis(gz, pml_cells, 0.5, reflection, kappa_max, alpha_max),
            pml_x_e: pml_axis(gx, pml_cells, 0.0, reflection, kappa_max, alpha_max),
            pml_y_e: pml_axis(gy, pml_cells, 0.0, reflection, kappa_max, alpha_max),
            pml_z_e: pml_axis(gz, pml_cells, 0.0, reflection, kappa_max, alpha_max),
            elements, driven_index, scene_geometry, ratios,
            v_re: vec![0.0; BINS], v_im: vec![0.0; BINS], i_re: vec![0.0; BINS], i_im: vec![0.0; BINS],
            profile_re: vec![0.0; BINS * element_count * profile_len], profile_im: vec![0.0; BINS * element_count * profile_len],
            voltage_trace: Vec::with_capacity(TRACE_LIMIT), current_trace: Vec::with_capacity(TRACE_LIMIT), measurements: 0,
        }
    }

    pub fn step(&mut self, count: u32) { for _ in 0..count.min(16) { self.single_step(); } }
    pub fn field_snapshot(&self) -> Vec<f32> { self.slice(if self.is_courtyard { &self.hz } else { &self.hy }) }
    pub fn magnetic_field_snapshot(&self) -> Vec<f32> { self.field_snapshot() }
    pub fn electric_z_snapshot(&self) -> Vec<f32> { self.slice(&self.ez) }
    pub fn electric_r_snapshot(&self) -> Vec<f32> { self.slice(&self.ex) }
    pub fn electric_magnitude_snapshot(&self) -> Vec<f32> {
        let height = if self.is_courtyard { self.gy } else { self.gz };
        let mut result = vec![0.0; self.gx * height];
        for vertical in 0..height { for x in 0..self.gx {
            let i = if self.is_courtyard { self.index(x, vertical, self.slice_y) } else { self.index(x, self.slice_y, vertical) };
            result[vertical * self.gx + x] = (self.ex[i] * self.ex[i] + self.ey[i] * self.ey[i] + self.ez[i] * self.ez[i]).sqrt();
        }}
        result
    }
    pub fn volume_snapshot(&self, kind: u8) -> Vec<f32> {
        match kind {
            1 => self.ez.clone(),
            2 => self.ex.clone(),
            3 => self.ex.iter().zip(&self.ey).zip(&self.ez).map(|((ex, ey), ez)| (ex * ex + ey * ey + ez * ez).sqrt()).collect(),
            _ => if self.is_courtyard { self.hz.clone() } else { self.hy.clone() },
        }
    }
    pub fn conductor_points(&self) -> Vec<f32> {
        let mut points = Vec::new();
        for element in &self.elements { for coordinate in element.start..=element.end {
            let (x, y, z) = Self::point_on_element(element, coordinate);
            points.extend_from_slice(&[x as f32, y as f32, z as f32]);
        }}
        points
    }
    pub fn scene_geometry(&self) -> Vec<f32> { self.scene_geometry.clone() }
    pub fn metal_snapshot(&self) -> Vec<u8> { self.slice_u8(&self.metal) }
    pub fn material_snapshot(&self) -> Vec<f32> { self.slice(&self.epsilon) }
    pub fn time_voltage_snapshot(&self) -> Vec<f32> { self.voltage_trace.clone() }
    pub fn time_current_snapshot(&self) -> Vec<f32> { self.current_trace.clone() }
    pub fn spectrum_frequencies(&self) -> Vec<f32> { self.ratios.iter().map(|value| *value as f32).collect() }
    pub fn spectrum_impedance_real(&self) -> Vec<f64> { (0..BINS).map(|bin| self.impedance_at(bin).0).collect() }
    pub fn spectrum_impedance_imag(&self) -> Vec<f64> { (0..BINS).map(|bin| self.impedance_at(bin).1).collect() }
    pub fn spectrum_current_magnitude(&self) -> Vec<f64> {
        (0..BINS).map(|bin| self.i_re[bin].hypot(self.i_im[bin])).collect()
    }
    pub fn step_count(&self) -> u32 { self.steps }
    pub fn measurement_count(&self) -> u32 { self.measurements }
    pub fn nx(&self) -> usize { self.gx }
    pub fn ny(&self) -> usize { self.gz }
    pub fn depth(&self) -> usize { self.gy }
    pub fn snapshot_width(&self) -> usize { self.gx }
    pub fn snapshot_height(&self) -> usize { if self.is_courtyard { self.gy } else { self.gz } }
    pub fn time_step(&self) -> f32 { COURANT }
    pub fn wire_start(&self) -> usize { self.elements[self.driven_index].start }
    pub fn wire_end(&self) -> usize { self.elements[self.driven_index].end }
    pub fn feed_position(&self) -> usize { self.source_position }
    pub fn impedance_real(&self) -> f64 { self.impedance_at(BINS / 2).0 }
    pub fn impedance_imag(&self) -> f64 { self.impedance_at(BINS / 2).1 }

    pub fn energy(&self) -> f32 {
        let total = self.ex.iter().zip(&self.ey).zip(&self.ez).zip(&self.hx).zip(&self.hy).zip(&self.hz)
            .map(|(((((ex, ey), ez), hx), hy), hz)| ex * ex + ey * ey + ez * ez + hx * hx + hy * hy + hz * hz)
            .sum::<f32>();
        total / self.ex.len() as f32
    }

    pub fn resonance_index(&self) -> usize {
        let max_current = (0..BINS).map(|bin| self.i_re[bin].hypot(self.i_im[bin])).fold(0.0_f64, f64::max);
        let mut best = BINS / 2;
        let mut score = f64::INFINITY;
        for bin in 1..BINS - 1 {
            let signal = self.i_re[bin].hypot(self.i_im[bin]);
            let z = self.impedance_at(bin);
            if signal < max_current * 0.06 || z.0 <= 0.0 || z.0 > 3000.0 { continue; }
            if z.1.abs() < score { score = z.1.abs(); best = bin; }
        }
        best
    }

    pub fn current_profile(&self, bin: usize) -> Vec<f32> {
        let bin = bin.min(BINS - 1);
        let element = &self.elements[self.driven_index];
        let offset = (bin * self.elements.len() + self.driven_index) * self.profile_len;
        let mut result = vec![0.0_f32; self.profile_len];
        let mut maximum = 0.0_f32;
        for coordinate in element.start..=element.end {
            result[coordinate] = self.profile_re[offset + coordinate].hypot(self.profile_im[offset + coordinate]) as f32;
            maximum = maximum.max(result[coordinate]);
        }
        if maximum > 0.0 { for value in &mut result { *value /= maximum; } }
        result
    }

    pub fn radiation_pattern_at(&self, bin: usize) -> Vec<f32> {
        let bin = bin.min(BINS - 1);
        let mut result = vec![0.0_f32; PATTERN_SAMPLES];
        let mut maximum = 0.0_f32;
        for (sample, value) in result.iter_mut().enumerate() {
            let angle = sample as f64 * std::f64::consts::TAU / PATTERN_SAMPLES as f64;
            *value = self.radiation_direction(bin, angle.sin(), 0.0, angle.cos()) as f32;
            maximum = maximum.max(*value);
        }
        if maximum > 0.0 { for value in &mut result { *value /= maximum; } }
        result
    }

    pub fn directivity_3d_at(&self, bin: usize) -> f32 {
        let bin = bin.min(BINS - 1);
        let nt = 36_usize;
        let np = 72_usize;
        let dt = std::f64::consts::PI / nt as f64;
        let dp = std::f64::consts::TAU / np as f64;
        let mut maximum = 0.0_f64;
        let mut integral = 0.0_f64;
        for ti in 0..=nt {
            let theta = ti as f64 * dt;
            let sin_theta = theta.sin();
            for pi in 0..np {
                let phi = pi as f64 * dp;
                let power = self.radiation_direction(bin, sin_theta * phi.cos(), sin_theta * phi.sin(), theta.cos());
                maximum = maximum.max(power);
                integral += power * sin_theta * dt * dp;
            }
        }
        if integral > 1e-18 { (std::f64::consts::TAU * 2.0 * maximum / integral) as f32 } else { 0.0 }
    }

    pub fn radiation_pattern(&self) -> Vec<f32> { self.radiation_pattern_at(self.resonance_index()) }
    pub fn directivity_3d(&self) -> f32 { self.directivity_3d_at(self.resonance_index()) }
}

impl FdtdSimulation3d {
    fn index(&self, x: usize, y: usize, z: usize) -> usize { (z * self.gy + y) * self.gx + x }

    fn point_on_element(element: &WireElement, coordinate: usize) -> (usize, usize, usize) {
        if element.axis == 0 { (coordinate, element.y, element.z) } else { (element.x, element.y, coordinate) }
    }

    fn single_step(&mut self) {
        let plane = self.gx * self.gy;
        for z in 0..self.gz - 1 { for y in 0..self.gy - 1 { for x in 0..self.gx - 1 {
            let i = (z * self.gy + y) * self.gx + x;
            let dez_dy = self.ez[i + self.gx] - self.ez[i];
            let dey_dz = self.ey[i + plane] - self.ey[i];
            let dex_dz = self.ex[i + plane] - self.ex[i];
            let dez_dx = self.ez[i + 1] - self.ez[i];
            let dey_dx = self.ey[i + 1] - self.ey[i];
            let dex_dy = self.ex[i + self.gx] - self.ex[i];
            self.psi_hx_y[i] = self.pml_y_h.b[y] * self.psi_hx_y[i] + self.pml_y_h.c[y] * dez_dy;
            self.psi_hx_z[i] = self.pml_z_h.b[z] * self.psi_hx_z[i] + self.pml_z_h.c[z] * dey_dz;
            self.psi_hy_z[i] = self.pml_z_h.b[z] * self.psi_hy_z[i] + self.pml_z_h.c[z] * dex_dz;
            self.psi_hy_x[i] = self.pml_x_h.b[x] * self.psi_hy_x[i] + self.pml_x_h.c[x] * dez_dx;
            self.psi_hz_x[i] = self.pml_x_h.b[x] * self.psi_hz_x[i] + self.pml_x_h.c[x] * dey_dx;
            self.psi_hz_y[i] = self.pml_y_h.b[y] * self.psi_hz_y[i] + self.pml_y_h.c[y] * dex_dy;
            self.hx[i] += COURANT * ((dey_dz / self.pml_z_h.kappa[z] + self.psi_hx_z[i]) - (dez_dy / self.pml_y_h.kappa[y] + self.psi_hx_y[i]));
            self.hy[i] += COURANT * ((dez_dx / self.pml_x_h.kappa[x] + self.psi_hy_x[i]) - (dex_dz / self.pml_z_h.kappa[z] + self.psi_hy_z[i]));
            self.hz[i] += COURANT * ((dex_dy / self.pml_y_h.kappa[y] + self.psi_hz_y[i]) - (dey_dx / self.pml_x_h.kappa[x] + self.psi_hz_x[i]));
        }}}
        for z in 1..self.gz - 1 { for y in 1..self.gy - 1 { for x in 1..self.gx - 1 {
            let i = (z * self.gy + y) * self.gx + x;
            let inv_eps = 1.0 / self.epsilon[i];
            let dhz_dy = self.hz[i] - self.hz[i - self.gx];
            let dhy_dz = self.hy[i] - self.hy[i - plane];
            let dhx_dz = self.hx[i] - self.hx[i - plane];
            let dhz_dx = self.hz[i] - self.hz[i - 1];
            let dhy_dx = self.hy[i] - self.hy[i - 1];
            let dhx_dy = self.hx[i] - self.hx[i - self.gx];
            self.psi_ex_y[i] = self.pml_y_e.b[y] * self.psi_ex_y[i] + self.pml_y_e.c[y] * dhz_dy;
            self.psi_ex_z[i] = self.pml_z_e.b[z] * self.psi_ex_z[i] + self.pml_z_e.c[z] * dhy_dz;
            self.psi_ey_z[i] = self.pml_z_e.b[z] * self.psi_ey_z[i] + self.pml_z_e.c[z] * dhx_dz;
            self.psi_ey_x[i] = self.pml_x_e.b[x] * self.psi_ey_x[i] + self.pml_x_e.c[x] * dhz_dx;
            self.psi_ez_x[i] = self.pml_x_e.b[x] * self.psi_ez_x[i] + self.pml_x_e.c[x] * dhy_dx;
            self.psi_ez_y[i] = self.pml_y_e.b[y] * self.psi_ez_y[i] + self.pml_y_e.c[y] * dhx_dy;
            self.ex[i] += COURANT * inv_eps * ((dhz_dy / self.pml_y_e.kappa[y] + self.psi_ex_y[i]) - (dhy_dz / self.pml_z_e.kappa[z] + self.psi_ex_z[i]));
            self.ey[i] += COURANT * inv_eps * ((dhx_dz / self.pml_z_e.kappa[z] + self.psi_ey_z[i]) - (dhz_dx / self.pml_x_e.kappa[x] + self.psi_ey_x[i]));
            self.ez[i] += COURANT * inv_eps * ((dhy_dx / self.pml_x_e.kappa[x] + self.psi_ez_x[i]) - (dhx_dy / self.pml_y_e.kappa[y] + self.psi_ez_y[i]));
        }}}
        let driven = self.elements[self.driven_index].clone();
        let (source_x, source_y, source_z) = Self::point_on_element(&driven, self.source_position);
        let source_index = self.index(source_x, source_y, source_z);
        let drive = self.source_value();
        if driven.axis == 0 { self.ex[source_index] += drive; } else { self.ez[source_index] += drive; }
        for i in 0..self.metal.len() { if self.metal[i] != 0 { self.ex[i] = 0.0; self.ey[i] = 0.0; self.ez[i] = 0.0; } }
        self.zero_boundaries();
        self.steps = self.steps.wrapping_add(1);
        let voltage = if driven.axis == 0 { self.ex[source_index] } else { self.ez[source_index] };
        let current = if driven.axis == 0 {
            self.wire_current(self.driven_index, self.source_position + 1)
        } else {
            0.5 * (self.wire_current(self.driven_index, self.source_position - 1) + self.wire_current(self.driven_index, self.source_position + 1))
        };
        if self.voltage_trace.len() < TRACE_LIMIT { self.voltage_trace.push(voltage); self.current_trace.push(current); }
        if self.steps % 2 == 0 { self.accumulate(voltage, current); }
    }

    fn source_value(&self) -> f32 {
        let t = self.steps as f32 * COURANT;
        let phase = std::f32::consts::TAU * t / self.wavelength;
        if self.source_kind == 0 {
            self.source_amplitude * (1.0 - (-(self.steps as f32) / 35.0).exp()) * phase.sin()
        } else {
            let centre = 3.0 * self.wavelength;
            let width = 0.48 * self.wavelength;
            self.source_amplitude * (-((t - centre) / width).powi(2)).exp() * phase.sin()
        }
    }

    fn zero_boundaries(&mut self) {
        for z in 0..self.gz { for y in 0..self.gy { for x in [0, self.gx - 1] {
            let i = (z * self.gy + y) * self.gx + x; self.ex[i] = 0.0; self.ey[i] = 0.0; self.ez[i] = 0.0;
        }}}
        for z in 0..self.gz { for x in 0..self.gx { for y in [0, self.gy - 1] {
            let i = (z * self.gy + y) * self.gx + x; self.ex[i] = 0.0; self.ey[i] = 0.0; self.ez[i] = 0.0;
        }}}
        for y in 0..self.gy { for x in 0..self.gx { for z in [0, self.gz - 1] {
            let i = (z * self.gy + y) * self.gx + x; self.ex[i] = 0.0; self.ey[i] = 0.0; self.ez[i] = 0.0;
        }}}
    }

    fn wire_current(&self, element_index: usize, coordinate: usize) -> f32 {
        let element = &self.elements[element_index];
        if coordinate < element.start || coordinate > element.end || (element.driven && coordinate == self.source_position) { return 0.0; }
        let radius = self.wire_radius + 2;
        let (x, y, z) = Self::point_on_element(element, coordinate);
        let hphi = if element.axis == 0 {
            let yp = self.index(x, y + radius, z);
            let ym = self.index(x, y - radius, z);
            let zp = self.index(x, y, z + radius);
            let zm = self.index(x, y, z - radius);
            (self.hz[yp] - self.hz[ym] - self.hy[zp] + self.hy[zm]) * 0.25
        } else {
            let xp = self.index(x + radius, y, z);
            let xm = self.index(x - radius, y, z);
            let yp = self.index(x, y + radius, z);
            let ym = self.index(x, y - radius, z);
            (self.hy[xp] - self.hy[xm] - self.hx[yp] + self.hx[ym]) * 0.25
        };
        -std::f32::consts::TAU * radius as f32 * hphi
    }

    fn accumulate(&mut self, voltage: f32, current: f32) {
        let t = self.steps as f64 * COURANT as f64;
        for bin in 0..BINS {
            let phase = std::f64::consts::TAU * t * self.ratios[bin] / self.wavelength as f64;
            let cos = phase.cos(); let sin = -phase.sin();
            self.v_re[bin] += voltage as f64 * cos; self.v_im[bin] += voltage as f64 * sin;
            self.i_re[bin] += current as f64 * cos; self.i_im[bin] += current as f64 * sin;
            for element_index in 0..self.elements.len() {
                let element = self.elements[element_index].clone();
                let offset = (bin * self.elements.len() + element_index) * self.profile_len;
                for coordinate in element.start..=element.end {
                    let wire_current = self.wire_current(element_index, coordinate) as f64;
                    self.profile_re[offset + coordinate] += wire_current * cos;
                    self.profile_im[offset + coordinate] += wire_current * sin;
                }
            }
        }
        self.measurements += 1;
    }

    fn impedance_at(&self, bin: usize) -> (f64, f64) {
        let bin = bin.min(BINS - 1);
        let denominator = self.i_re[bin] * self.i_re[bin] + self.i_im[bin] * self.i_im[bin];
        if denominator <= 1e-18 { return (0.0, 0.0); }
        (ETA0 * (self.v_re[bin] * self.i_re[bin] + self.v_im[bin] * self.i_im[bin]) / denominator,
         ETA0 * (self.v_im[bin] * self.i_re[bin] - self.v_re[bin] * self.i_im[bin]) / denominator)
    }

    fn radiation_direction(&self, bin: usize, ux: f64, uy: f64, uz: f64) -> f64 {
        let k = std::f64::consts::TAU * self.ratios[bin] / self.wavelength as f64;
        let mut real = 0.0; let mut imag = 0.0;
        for (element_index, element) in self.elements.iter().enumerate() {
            let offset = (bin * self.elements.len() + element_index) * self.profile_len;
            for coordinate in element.start..=element.end {
                let (x, y, z) = Self::point_on_element(element, coordinate);
                let phase = k * ((x as f64 - self.cx as f64) * ux + (y as f64 - self.cy as f64) * uy + (z as f64 - (self.gz / 2) as f64) * uz);
                let cos = phase.cos(); let sin = phase.sin();
                let pr = self.profile_re[offset + coordinate]; let pi = self.profile_im[offset + coordinate];
                real += pr * cos - pi * sin; imag += pr * sin + pi * cos;
            }
        }
        let along = if self.elements[self.driven_index].axis == 0 { ux } else { uz };
        (real * real + imag * imag) * (1.0 - along * along).max(0.0)
    }

    fn slice(&self, source: &[f32]) -> Vec<f32> {
        if self.is_courtyard {
            let mut result = vec![0.0; self.gx * self.gy];
            for y in 0..self.gy { for x in 0..self.gx { result[y * self.gx + x] = source[self.index(x, y, self.slice_y)]; }}
            return result;
        }
        let mut result = vec![0.0; self.gx * self.gz];
        for z in 0..self.gz { for x in 0..self.gx { result[z * self.gx + x] = source[self.index(x, self.slice_y, z)]; }}
        result
    }
    fn slice_u8(&self, source: &[u8]) -> Vec<u8> {
        if self.is_courtyard {
            let mut result = vec![0; self.gx * self.gy];
            for y in 0..self.gy { for x in 0..self.gx { result[y * self.gx + x] = source[self.index(x, y, self.slice_y)]; }}
            return result;
        }
        let mut result = vec![0; self.gx * self.gz];
        for z in 0..self.gz { for x in 0..self.gx { result[z * self.gx + x] = source[self.index(x, self.slice_y, z)]; }}
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yagi_grid_propagates_and_exports_fields() {
        let mut sim = FdtdSimulation3d::new(56, 80, 18.0, 0.47, 8, 1e-7, 1, 0.6, false, 5.0, 0.05, 1, 2, 56);
        for _ in 0..12 { sim.step(8); }
        assert_eq!(sim.field_snapshot().len(), 56 * 80);
        assert_eq!(sim.volume_snapshot(3).len(), 56 * 56 * 80);
        assert!(sim.conductor_points().len() > 60);
        assert!(sim.energy().is_finite() && sim.energy() > 0.0);
        assert!(sim.electric_magnitude_snapshot().iter().all(|value| value.is_finite()));
        assert!(sim.measurement_count() > 0);
        assert_eq!(sim.spectrum_current_magnitude().len(), BINS);
        let resonance = sim.resonance_index();
        assert!(sim.directivity_3d_at(resonance).is_finite());
        assert_eq!(sim.radiation_pattern_at(resonance).len(), PATTERN_SAMPLES);
    }

    #[test]
    fn courtyard_preserves_building_and_horizontal_wire_geometry() {
        let mut sim = FdtdSimulation3d::new(128, 112, 50.0, 0.5, 8, 1e-7, 0, 0.6, true, 5.0, 0.05, 1, 3, 72);
        let scene = sim.scene_geometry();
        assert_eq!(scene.len(), 12);
        assert_eq!(scene[0], 2.0);
        assert!(((scene[2] - scene[1]) * scene[11] - 30.0).abs() < 1e-4);
        assert!(((scene[8] - scene[7]) * scene[11] - 10.0).abs() < 1e-4);
        assert!(((scene[9] - scene[3]) * scene[11] - 0.4).abs() < 1e-4);
        assert!(((scene[6] - scene[5]) * scene[11] - 20.0).abs() < 1e-4);
        assert_eq!(scene[7], scene[2]);
        assert!(scene[8] > scene[2]);
        assert_eq!(sim.depth(), 72);
        assert_eq!(sim.field_snapshot().len(), sim.nx() * sim.depth());
        assert!(sim.material_snapshot().iter().any(|value| *value == COURTYARD_EPSILON));
        let wire = sim.conductor_points();
        assert_eq!(wire[1], wire[wire.len() - 2]);
        assert_eq!(wire[2], wire[wire.len() - 1]);
        for _ in 0..4 { sim.step(4); }
        assert!(sim.energy().is_finite() && sim.energy() > 0.0);
    }
}
