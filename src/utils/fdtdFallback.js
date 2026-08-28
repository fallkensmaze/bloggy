const COURANT = 0.99 / Math.SQRT2

export class FdtdSimulationFallback {
  constructor(nx, ny, wavelengthCells, dipoleFraction, absorberCells, absorberStrength, sourceKind, sourceAmplitude, dielectricEnabled) {
    this.width = Math.max(80, Math.min(520, Math.round(nx)))
    this.height = Math.max(60, Math.min(360, Math.round(ny)))
    this.wavelength = Math.max(16, Math.min(100, wavelengthCells))
    this.sourceKind = sourceKind ? 1 : 0
    this.sourceAmplitude = Math.max(0.01, Math.min(4, sourceAmplitude))
    this.sourceX = Math.floor(this.width / 2)
    this.sourceY = Math.floor(this.height / 2)
    this.steps = 0
    const size = this.width * this.height
    this.ex = new Float32Array(size)
    this.ey = new Float32Array(size)
    this.hz = new Float32Array(size)
    this.epsilon = new Float32Array(size).fill(1)
    this.metal = new Uint8Array(size)
    this.damping = new Float32Array(size).fill(1)

    const total = Math.max(6, Math.round(this.wavelength * Math.max(0.1, Math.min(0.95, dipoleFraction))))
    const arm = Math.max(3, Math.floor((total - 1) / 2))
    for (let x = this.sourceX - 1; x <= this.sourceX + 1; x += 1) {
      for (let offset = 1; offset <= arm; offset += 1) {
        if (this.sourceY - offset >= 0) this.metal[(this.sourceY - offset) * this.width + x] = 1
        if (this.sourceY + offset < this.height) this.metal[(this.sourceY + offset) * this.width + x] = 1
      }
    }

    if (dielectricEnabled) {
      const x0 = this.sourceX + Math.round(this.wavelength * 0.65)
      const x1 = Math.min(this.width - absorberCells - 2, x0 + Math.round(this.wavelength * 0.55))
      const y0 = Math.max(0, this.sourceY - Math.round(this.wavelength * 0.75))
      const y1 = Math.min(this.height - 1, this.sourceY + Math.round(this.wavelength * 0.75))
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) this.epsilon[y * this.width + x] = 4
      }
    }

    const thickness = Math.max(6, Math.min(Math.floor(Math.min(this.width, this.height) / 3), Math.round(absorberCells)))
    const strength = Math.max(0.005, Math.min(0.35, absorberStrength))
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const edge = Math.min(x, this.width - 1 - x, y, this.height - 1 - y)
        if (edge < thickness) {
          const depth = (thickness - edge) / thickness
          this.damping[y * this.width + x] = Math.exp(-strength * depth ** 3)
        }
      }
    }
  }

  step(count) {
    const n = this.width
    const m = this.height
    for (let pass = 0; pass < Math.min(64, count); pass += 1) {
      for (let y = 0; y < m - 1; y += 1) {
        for (let x = 0; x < n - 1; x += 1) {
          const i = y * n + x
          this.hz[i] += COURANT * ((this.ex[i + n] - this.ex[i]) - (this.ey[i + 1] - this.ey[i]))
        }
      }
      for (let y = 1; y < m - 1; y += 1) {
        for (let x = 1; x < n - 1; x += 1) {
          const i = y * n + x
          const invEpsilon = 1 / this.epsilon[i]
          this.ex[i] += COURANT * invEpsilon * (this.hz[i] - this.hz[i - n])
          this.ey[i] -= COURANT * invEpsilon * (this.hz[i] - this.hz[i - 1])
        }
      }
      this.ey[this.sourceY * n + this.sourceX] += this.sourceValue()
      for (let i = 0; i < this.hz.length; i += 1) {
        if (this.metal[i]) this.ex[i] = this.ey[i] = 0
        const damping = this.damping[i]
        this.ex[i] *= damping
        this.ey[i] *= damping
        this.hz[i] *= damping
      }
      this.steps += 1
    }
  }

  sourceValue() {
    const t = this.steps * COURANT
    const phase = Math.PI * 2 * t / this.wavelength
    if (this.sourceKind === 0) {
      return this.sourceAmplitude * (1 - Math.exp(-this.steps / 45)) * Math.sin(phase)
    }
    const centre = 2.8 * this.wavelength
    const width = 0.72 * this.wavelength
    return this.sourceAmplitude * Math.exp(-(((t - centre) / width) ** 2)) * Math.sin(phase)
  }

  reset() {
    this.ex.fill(0)
    this.ey.fill(0)
    this.hz.fill(0)
    this.steps = 0
  }

  field_snapshot() { return this.hz.slice() }
  metal_snapshot() { return this.metal.slice() }
  material_snapshot() { return this.epsilon.slice() }
  step_count() { return this.steps }
  nx() { return this.width }
  ny() { return this.height }

  energy() {
    let total = 0
    for (let i = 0; i < this.hz.length; i += 1) {
      total += this.ex[i] ** 2 + this.ey[i] ** 2 + this.hz[i] ** 2
    }
    return total / this.hz.length
  }
}
