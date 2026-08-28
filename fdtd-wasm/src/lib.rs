use wasm_bindgen::prelude::*;

const COURANT: f32 = 0.99 / std::f32::consts::SQRT_2;

#[wasm_bindgen]
pub struct FdtdSimulation {
    nx: usize,
    ny: usize,
    ex: Vec<f32>,
    ey: Vec<f32>,
    hz: Vec<f32>,
    epsilon_r: Vec<f32>,
    metal: Vec<u8>,
    damping: Vec<f32>,
    step_count: u32,
    wavelength_cells: f32,
    source_kind: u8,
    source_amplitude: f32,
    source_x: usize,
    source_y: usize,
}

#[wasm_bindgen]
impl FdtdSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new(
        nx: usize,
        ny: usize,
        wavelength_cells: f32,
        dipole_fraction: f32,
        absorber_cells: usize,
        absorber_strength: f32,
        source_kind: u8,
        source_amplitude: f32,
        dielectric_enabled: bool,
    ) -> FdtdSimulation {
        let nx = nx.clamp(80, 520);
        let ny = ny.clamp(60, 360);
        let wavelength_cells = wavelength_cells.clamp(16.0, 100.0);
        let absorber_cells = absorber_cells.clamp(6, nx.min(ny) / 3);
        let absorber_strength = absorber_strength.clamp(0.005, 0.35);
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
                    metal[source_y.saturating_sub(offset) * nx + x] = 1;
                }
                if source_y + offset < ny {
                    metal[(source_y + offset) * nx + x] = 1;
                }
            }
        }

        let mut epsilon_r = vec![1.0; len];
        if dielectric_enabled {
            let x0 = source_x + (wavelength_cells * 0.65) as usize;
            let x1 = (x0 + (wavelength_cells * 0.55) as usize).min(nx - absorber_cells - 2);
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

        let mut damping = vec![1.0; len];
        for y in 0..ny {
            for x in 0..nx {
                let edge_distance = x.min(nx - 1 - x).min(y.min(ny - 1 - y));
                if edge_distance < absorber_cells {
                    let depth = (absorber_cells - edge_distance) as f32 / absorber_cells as f32;
                    damping[y * nx + x] = (-absorber_strength * depth.powi(3)).exp();
                }
            }
        }

        FdtdSimulation {
            nx,
            ny,
            ex: vec![0.0; len],
            ey: vec![0.0; len],
            hz: vec![0.0; len],
            epsilon_r,
            metal,
            damping,
            step_count: 0,
            wavelength_cells,
            source_kind: source_kind.min(1),
            source_amplitude: source_amplitude.clamp(0.01, 4.0),
            source_x,
            source_y,
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
        self.step_count = 0;
    }

    pub fn field_snapshot(&self) -> Vec<f32> {
        self.hz.clone()
    }

    pub fn metal_snapshot(&self) -> Vec<u8> {
        self.metal.clone()
    }

    pub fn material_snapshot(&self) -> Vec<f32> {
        self.epsilon_r.clone()
    }

    pub fn energy(&self) -> f32 {
        let total: f32 = self
            .ex
            .iter()
            .zip(&self.ey)
            .zip(&self.hz)
            .map(|((ex, ey), hz)| ex * ex + ey * ey + hz * hz)
            .sum();
        total / (self.nx * self.ny) as f32
    }

    pub fn step_count(&self) -> u32 {
        self.step_count
    }

    pub fn nx(&self) -> usize {
        self.nx
    }

    pub fn ny(&self) -> usize {
        self.ny
    }
}

impl FdtdSimulation {
    fn single_step(&mut self) {
        for y in 0..self.ny - 1 {
            for x in 0..self.nx - 1 {
                let i = y * self.nx + x;
                let dex_dy = self.ex[i + self.nx] - self.ex[i];
                let dey_dx = self.ey[i + 1] - self.ey[i];
                self.hz[i] += COURANT * (dex_dy - dey_dx);
            }
        }

        for y in 1..self.ny - 1 {
            for x in 1..self.nx - 1 {
                let i = y * self.nx + x;
                let inv_eps = 1.0 / self.epsilon_r[i];
                self.ex[i] += COURANT * inv_eps * (self.hz[i] - self.hz[i - self.nx]);
                self.ey[i] -= COURANT * inv_eps * (self.hz[i] - self.hz[i - 1]);
            }
        }

        let source = self.source_value();
        let source_index = self.source_y * self.nx + self.source_x;
        self.ey[source_index] += source;

        for i in 0..self.hz.len() {
            if self.metal[i] != 0 {
                self.ex[i] = 0.0;
                self.ey[i] = 0.0;
            }
            let d = self.damping[i];
            self.ex[i] *= d;
            self.ey[i] *= d;
            self.hz[i] *= d;
        }

        self.step_count = self.step_count.wrapping_add(1);
    }

    fn source_value(&self) -> f32 {
        let t = self.step_count as f32 * COURANT;
        let phase = std::f32::consts::TAU * t / self.wavelength_cells;
        if self.source_kind == 0 {
            let ramp = 1.0 - (-(self.step_count as f32) / 45.0).exp();
            self.source_amplitude * ramp * phase.sin()
        } else {
            let centre = 2.8 * self.wavelength_cells;
            let width = 0.72 * self.wavelength_cells;
            let envelope = (-((t - centre) / width).powi(2)).exp();
            self.source_amplitude * envelope * phase.sin()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_requested_grid_and_dipole() {
        let sim = FdtdSimulation::new(160, 100, 32.0, 0.47, 12, 0.08, 0, 0.8, false);
        assert_eq!(sim.field_snapshot().len(), 16_000);
        assert!(sim.metal_snapshot().iter().filter(|&&v| v == 1).count() >= 18);
        assert_eq!(sim.step_count(), 0);
    }

    #[test]
    fn propagation_remains_finite_and_carries_energy() {
        let mut sim = FdtdSimulation::new(160, 100, 32.0, 0.47, 12, 0.08, 0, 0.8, false);
        sim.step(64);
        sim.step(64);
        assert!(sim.energy().is_finite());
        assert!(sim.energy() > 0.0);
        assert!(sim.field_snapshot().iter().all(|value| value.is_finite()));
    }

    #[test]
    fn reset_clears_the_dynamic_state() {
        let mut sim = FdtdSimulation::new(120, 80, 28.0, 0.47, 10, 0.08, 1, 1.0, true);
        sim.step(32);
        sim.reset();
        assert_eq!(sim.step_count(), 0);
        assert_eq!(sim.energy(), 0.0);
    }
}

