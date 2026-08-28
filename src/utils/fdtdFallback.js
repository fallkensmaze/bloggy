const COURANT = 0.99 / Math.SQRT2
const ANGLE_SAMPLES = 72

function makePmlAxis(length, thickness, stagger, targetReflection, kappaMax, alphaMax) {
  const kappa = new Float32Array(length).fill(1)
  const b = new Float32Array(length).fill(1)
  const c = new Float32Array(length)
  const order = 3
  const sigmaMax = -((order + 1) * Math.log(targetReflection)) / (2 * thickness)

  for (let index = 0; index < length; index += 1) {
    const position = index + stagger
    const leftDepth = position < thickness ? (thickness - position) / thickness : 0
    const rightStart = length - 1 - thickness
    const rightDepth = position > rightStart ? (position - rightStart) / thickness : 0
    const depth = Math.min(1, Math.max(leftDepth, rightDepth))
    if (depth <= 0) continue
    const graded = depth ** order
    const sigma = sigmaMax * graded
    const localKappa = 1 + (kappaMax - 1) * graded
    const alpha = alphaMax * (1 - depth)
    const localB = Math.exp(-(sigma / localKappa + alpha) * COURANT)
    const denominator = sigma * localKappa + localKappa * localKappa * alpha
    kappa[index] = localKappa
    b[index] = localB
    c[index] = denominator > 1e-12 ? sigma * (localB - 1) / denominator : 0
  }
  return { kappa, b, c }
}

export class FdtdSimulationFallback {
  constructor(nx, ny, wavelengthCells, dipoleFraction, pmlCells, targetReflection, sourceKind, sourceAmplitude, dielectricEnabled, kappaMax = 5, alphaMax = 0.05) {
    this.width = Math.max(80, Math.min(520, Math.round(nx)))
    this.height = Math.max(60, Math.min(360, Math.round(ny)))
    this.wavelength = Math.max(16, Math.min(100, wavelengthCells))
    this.sourceKind = sourceKind ? 1 : 0
    this.sourceAmplitude = Math.max(0.01, Math.min(4, sourceAmplitude))
    this.sourceX = Math.floor(this.width / 2)
    this.sourceY = Math.floor(this.height / 2)
    this.steps = 0
    this.pmlCells = Math.max(8, Math.min(Math.floor(Math.min(this.width, this.height) / 3), Math.round(pmlCells)))
    const size = this.width * this.height
    this.ex = new Float32Array(size)
    this.ey = new Float32Array(size)
    this.hz = new Float32Array(size)
    this.epsilon = new Float32Array(size).fill(1)
    this.metal = new Uint8Array(size)
    this.psiHzX = new Float32Array(size)
    this.psiHzY = new Float32Array(size)
    this.psiExY = new Float32Array(size)
    this.psiEyX = new Float32Array(size)

    const reflection = Math.max(1e-12, Math.min(1e-2, targetReflection))
    const safeKappa = Math.max(1, Math.min(12, kappaMax))
    const safeAlpha = Math.max(0, Math.min(0.25, alphaMax))
    this.pmlXH = makePmlAxis(this.width, this.pmlCells, 0.5, reflection, safeKappa, safeAlpha)
    this.pmlYH = makePmlAxis(this.height, this.pmlCells, 0.5, reflection, safeKappa, safeAlpha)
    this.pmlXE = makePmlAxis(this.width, this.pmlCells, 0, reflection, safeKappa, safeAlpha)
    this.pmlYE = makePmlAxis(this.height, this.pmlCells, 0, reflection, safeKappa, safeAlpha)

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
      const x1 = Math.min(this.width - this.pmlCells - 2, x0 + Math.round(this.wavelength * 0.55))
      const y0 = Math.max(0, this.sourceY - Math.round(this.wavelength * 0.75))
      const y1 = Math.min(this.height - 1, this.sourceY + Math.round(this.wavelength * 0.75))
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) this.epsilon[y * this.width + x] = 4
      }
    }

    this.monitorRadius = Math.max(8, Math.floor(Math.min(this.width, this.height) / 2 - this.pmlCells - 5))
    this.monitorIndices = new Uint32Array(ANGLE_SAMPLES)
    this.monitorCos = new Float32Array(ANGLE_SAMPLES)
    this.monitorSin = new Float32Array(ANGLE_SAMPLES)
    for (let angleIndex = 0; angleIndex < ANGLE_SAMPLES; angleIndex += 1) {
      const angle = angleIndex * Math.PI * 2 / ANGLE_SAMPLES
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const x = Math.max(1, Math.min(this.width - 2, Math.round(this.sourceX + this.monitorRadius * cos)))
      const y = Math.max(1, Math.min(this.height - 2, Math.round(this.sourceY - this.monitorRadius * sin)))
      this.monitorIndices[angleIndex] = y * this.width + x
      this.monitorCos[angleIndex] = cos
      this.monitorSin[angleIndex] = sin
    }
    this.exRe = new Float64Array(ANGLE_SAMPLES)
    this.exIm = new Float64Array(ANGLE_SAMPLES)
    this.eyRe = new Float64Array(ANGLE_SAMPLES)
    this.eyIm = new Float64Array(ANGLE_SAMPLES)
    this.hzRe = new Float64Array(ANGLE_SAMPLES)
    this.hzIm = new Float64Array(ANGLE_SAMPLES)
    this.vRe = 0
    this.vIm = 0
    this.iRe = 0
    this.iIm = 0
    this.measurements = 0
    this.monitorStart = Math.ceil(this.monitorRadius / COURANT + this.wavelength / COURANT)
  }

  step(count) {
    const n = this.width
    const m = this.height
    for (let pass = 0; pass < Math.min(64, count); pass += 1) {
      for (let y = 0; y < m - 1; y += 1) {
        for (let x = 0; x < n - 1; x += 1) {
          const i = y * n + x
          const dExDy = this.ex[i + n] - this.ex[i]
          const dEyDx = this.ey[i + 1] - this.ey[i]
          this.psiHzY[i] = this.pmlYH.b[y] * this.psiHzY[i] + this.pmlYH.c[y] * dExDy
          this.psiHzX[i] = this.pmlXH.b[x] * this.psiHzX[i] + this.pmlXH.c[x] * dEyDx
          const correctedY = dExDy / this.pmlYH.kappa[y] + this.psiHzY[i]
          const correctedX = dEyDx / this.pmlXH.kappa[x] + this.psiHzX[i]
          this.hz[i] += COURANT * (correctedY - correctedX)
        }
      }
      for (let y = 1; y < m - 1; y += 1) {
        for (let x = 1; x < n - 1; x += 1) {
          const i = y * n + x
          const invEpsilon = 1 / this.epsilon[i]
          const dHzDy = this.hz[i] - this.hz[i - n]
          const dHzDx = this.hz[i] - this.hz[i - 1]
          this.psiExY[i] = this.pmlYE.b[y] * this.psiExY[i] + this.pmlYE.c[y] * dHzDy
          this.psiEyX[i] = this.pmlXE.b[x] * this.psiEyX[i] + this.pmlXE.c[x] * dHzDx
          this.ex[i] += COURANT * invEpsilon * (dHzDy / this.pmlYE.kappa[y] + this.psiExY[i])
          this.ey[i] -= COURANT * invEpsilon * (dHzDx / this.pmlXE.kappa[x] + this.psiEyX[i])
        }
      }

      this.ey[this.sourceY * n + this.sourceX] += this.sourceValue()
      for (let i = 0; i < this.metal.length; i += 1) if (this.metal[i]) this.ex[i] = this.ey[i] = 0
      for (let x = 0; x < n; x += 1) {
        this.ex[x] = this.ey[x] = 0
        const bottom = (m - 1) * n + x
        this.ex[bottom] = this.ey[bottom] = 0
      }
      for (let y = 0; y < m; y += 1) {
        const left = y * n
        const right = left + n - 1
        this.ex[left] = this.ey[left] = 0
        this.ex[right] = this.ey[right] = 0
      }

      this.steps += 1
      if (this.steps >= this.monitorStart) this.accumulateMonitors()
    }
  }

  sourceValue() {
    const t = this.steps * COURANT
    const phase = Math.PI * 2 * t / this.wavelength
    if (this.sourceKind === 0) return this.sourceAmplitude * (1 - Math.exp(-this.steps / 45)) * Math.sin(phase)
    const centre = 2.8 * this.wavelength
    const width = 0.72 * this.wavelength
    return this.sourceAmplitude * Math.exp(-(((t - centre) / width) ** 2)) * Math.sin(phase)
  }

  accumulateMonitors() {
    const phase = Math.PI * 2 * this.steps * COURANT / this.wavelength
    const cos = Math.cos(phase)
    const sin = -Math.sin(phase)
    for (let angleIndex = 0; angleIndex < ANGLE_SAMPLES; angleIndex += 1) {
      const i = this.monitorIndices[angleIndex]
      this.exRe[angleIndex] += this.ex[i] * cos
      this.exIm[angleIndex] += this.ex[i] * sin
      this.eyRe[angleIndex] += this.ey[i] * cos
      this.eyIm[angleIndex] += this.ey[i] * sin
      this.hzRe[angleIndex] += this.hz[i] * cos
      this.hzIm[angleIndex] += this.hz[i] * sin
    }
    const sourceIndex = this.sourceY * this.width + this.sourceX
    const current = (this.portCurrentAt(this.sourceY - 1) + this.portCurrentAt(this.sourceY + 1)) * 0.5
    const voltage = this.ey[sourceIndex]
    this.vRe += voltage * cos
    this.vIm += voltage * sin
    this.iRe += current * cos
    this.iIm += current * sin
    this.measurements += 1
  }

  portCurrentAt(y) {
    const left = y * this.width + Math.max(0, this.sourceX - 2)
    const right = y * this.width + Math.min(this.width - 1, this.sourceX + 2)
    return this.hz[right] - this.hz[left]
  }

  reset() {
    for (const array of [this.ex, this.ey, this.hz, this.psiHzX, this.psiHzY, this.psiExY, this.psiEyX, this.exRe, this.exIm, this.eyRe, this.eyIm, this.hzRe, this.hzIm]) array.fill(0)
    this.vRe = this.vIm = this.iRe = this.iIm = 0
    this.measurements = 0
    this.steps = 0
  }

  field_snapshot() { return this.hz.slice() }
  metal_snapshot() { return this.metal.slice() }
  material_snapshot() { return this.epsilon.slice() }
  step_count() { return this.steps }
  measurement_count() { return this.measurements }
  nx() { return this.width }
  ny() { return this.height }

  energy() {
    let total = 0
    for (let i = 0; i < this.hz.length; i += 1) total += this.ex[i] ** 2 + this.ey[i] ** 2 + this.hz[i] ** 2
    return total / this.hz.length
  }

  radiation_pattern() {
    const pattern = new Float32Array(ANGLE_SAMPLES)
    let maximum = 0
    for (let angleIndex = 0; angleIndex < ANGLE_SAMPLES; angleIndex += 1) {
      const radialERe = this.eyRe[angleIndex] * this.monitorCos[angleIndex] - this.exRe[angleIndex] * this.monitorSin[angleIndex]
      const radialEIm = this.eyIm[angleIndex] * this.monitorCos[angleIndex] - this.exIm[angleIndex] * this.monitorSin[angleIndex]
      const flux = Math.max(0, 0.5 * (radialERe * this.hzRe[angleIndex] + radialEIm * this.hzIm[angleIndex]))
      pattern[angleIndex] = flux
      maximum = Math.max(maximum, flux)
    }
    if (maximum > 0) for (let i = 0; i < pattern.length; i += 1) pattern[i] /= maximum
    return pattern
  }

  directivity_2d() {
    const pattern = this.radiation_pattern()
    let sum = 0
    let maximum = 0
    for (const value of pattern) { sum += value; maximum = Math.max(maximum, value) }
    const mean = sum / pattern.length
    return mean > 1e-12 ? maximum / mean : 0
  }

  impedance_real() {
    const denominator = this.iRe * this.iRe + this.iIm * this.iIm
    return denominator > 1e-18 ? (this.vRe * this.iRe + this.vIm * this.iIm) / denominator : 0
  }

  impedance_imag() {
    const denominator = this.iRe * this.iRe + this.iIm * this.iIm
    return denominator > 1e-18 ? (this.vIm * this.iRe - this.vRe * this.iIm) / denominator : 0
  }
}
