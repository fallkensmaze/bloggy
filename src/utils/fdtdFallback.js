const COURANT = 0.5
const ETA0 = 376.730313668
const SPECTRUM_BINS = 41
const SPECTRUM_MIN = 0.7
const SPECTRUM_MAX = 1.3
const SPECTRAL_STRIDE = 2
const TRACE_LIMIT = 4096
const PATTERN_SAMPLES = 72

function makePmlAxis(length, thickness, stagger, targetReflection, kappaMax, alphaMax, absorbLeft = true) {
  const kappa = new Float32Array(length).fill(1)
  const b = new Float32Array(length).fill(1)
  const c = new Float32Array(length)
  const order = 3
  const sigmaMax = -((order + 1) * Math.log(targetReflection)) / (2 * thickness)

  for (let index = 0; index < length; index += 1) {
    const position = index + stagger
    const leftDepth = absorbLeft && position < thickness ? (thickness - position) / thickness : 0
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

const clampIndex = (value, length) => Math.max(0, Math.min(length - 1, Math.round(value)))

export class FdtdSimulationFallback {
  constructor(nx, ny, wavelengthCells, dipoleFraction, pmlCells, targetReflection, sourceKind, sourceAmplitude, dielectricEnabled, kappaMax = 5, alphaMax = 0.05, wireRadiusCells = 1, antennaKind = 0) {
    this.width = Math.max(120, Math.min(520, Math.round(nx)))
    this.height = Math.max(80, Math.min(360, Math.round(ny)))
    this.radialCells = Math.floor(this.width / 2) + 1
    this.wavelength = Math.max(18, Math.min(100, wavelengthCells))
    this.sourceKind = sourceKind ? 1 : 0
    this.sourceAmplitude = Math.max(0.01, Math.min(4, sourceAmplitude))
    this.pmlCells = Math.max(8, Math.min(Math.floor(Math.min(this.radialCells, this.height) / 3), Math.round(pmlCells)))
    this.isMonopole = antennaKind === 1
    this.groundZ = this.isMonopole ? Math.max(this.pmlCells + 5, Math.floor(this.height * 0.36)) : -1
    this.sourceZ = this.isMonopole ? this.groundZ + 1 : Math.floor(this.height / 2)
    this.steps = 0
    this.wireRadius = Math.max(1, Math.min(6, Math.round(wireRadiusCells)))
    const size = this.radialCells * this.height
    this.er = new Float32Array(size)
    this.ez = new Float32Array(size)
    this.hphi = new Float32Array(size)
    this.epsilon = new Float32Array(size).fill(1)
    this.metal = new Uint8Array(size)
    this.psiHPhiR = new Float32Array(size)
    this.psiHPhiZ = new Float32Array(size)
    this.psiErZ = new Float32Array(size)
    this.psiEzR = new Float32Array(size)

    const reflection = Math.max(1e-12, Math.min(1e-2, targetReflection))
    const safeKappa = Math.max(1, Math.min(12, kappaMax))
    const safeAlpha = Math.max(0, Math.min(0.25, alphaMax))
    this.pmlRH = makePmlAxis(this.radialCells, this.pmlCells, 0.5, reflection, safeKappa, safeAlpha, false)
    this.pmlZH = makePmlAxis(this.height, this.pmlCells, 0.5, reflection, safeKappa, safeAlpha, true)
    this.pmlRE = makePmlAxis(this.radialCells, this.pmlCells, 0, reflection, safeKappa, safeAlpha, false)
    this.pmlZE = makePmlAxis(this.height, this.pmlCells, 0, reflection, safeKappa, safeAlpha, true)

    const total = Math.max(8, Math.round(this.wavelength * Math.max(0.1, Math.min(1.8, dipoleFraction))))
    this.arm = this.isMonopole ? total : Math.max(4, Math.floor((total - 1) / 2))
    this.wireStart = this.isMonopole ? this.sourceZ + 1 : Math.max(1, this.sourceZ - this.arm)
    this.wireEnd = Math.min(this.height - 2, this.sourceZ + this.arm)
    for (let z = this.wireStart; z <= this.wireEnd; z += 1) {
      if (z === this.sourceZ) continue
      for (let r = 0; r <= this.wireRadius; r += 1) this.metal[z * this.radialCells + r] = 1
    }
    if (this.isMonopole) {
      for (let r = 0; r < this.radialCells; r += 1) this.metal[this.groundZ * this.radialCells + r] = 1
    }

    if (dielectricEnabled) {
      const r0 = Math.round(this.wavelength * 0.62)
      const r1 = Math.min(this.radialCells - this.pmlCells - 2, r0 + Math.round(this.wavelength * 0.5))
      const z0 = Math.max(1, this.sourceZ - Math.round(this.wavelength * 0.7))
      const z1 = Math.min(this.height - 2, this.sourceZ + Math.round(this.wavelength * 0.7))
      for (let z = z0; z <= z1; z += 1) {
        for (let r = r0; r <= r1; r += 1) this.epsilon[z * this.radialCells + r] = 4
      }
    }

    this.frequencyRatios = Float64Array.from({ length: SPECTRUM_BINS }, (_, index) => (
      SPECTRUM_MIN + index * (SPECTRUM_MAX - SPECTRUM_MIN) / (SPECTRUM_BINS - 1)
    ))
    this.vRe = new Float64Array(SPECTRUM_BINS)
    this.vIm = new Float64Array(SPECTRUM_BINS)
    this.iRe = new Float64Array(SPECTRUM_BINS)
    this.iIm = new Float64Array(SPECTRUM_BINS)
    this.profileRe = new Float64Array(SPECTRUM_BINS * this.height)
    this.profileIm = new Float64Array(SPECTRUM_BINS * this.height)
    this.voltageTrace = []
    this.currentTrace = []
    this.measurements = 0
  }

  step(count) {
    for (let pass = 0; pass < Math.min(64, count); pass += 1) this.singleStep()
  }

  singleStep() {
    const nr = this.radialCells
    const nz = this.height
    for (let z = 0; z < nz - 1; z += 1) {
      for (let r = 0; r < nr - 1; r += 1) {
        const i = z * nr + r
        const dErDz = this.er[i + nr] - this.er[i]
        const dEzDr = this.ez[i + 1] - this.ez[i]
        this.psiHPhiZ[i] = this.pmlZH.b[z] * this.psiHPhiZ[i] + this.pmlZH.c[z] * dErDz
        this.psiHPhiR[i] = this.pmlRH.b[r] * this.psiHPhiR[i] + this.pmlRH.c[r] * dEzDr
        const correctedZ = dErDz / this.pmlZH.kappa[z] + this.psiHPhiZ[i]
        const correctedR = dEzDr / this.pmlRH.kappa[r] + this.psiHPhiR[i]
        this.hphi[i] += COURANT * (correctedR - correctedZ)
      }
    }

    for (let z = 1; z < nz - 1; z += 1) {
      for (let r = 0; r < nr - 1; r += 1) {
        const i = z * nr + r
        const invEpsilon = 1 / this.epsilon[i]
        const dHDz = this.hphi[i] - this.hphi[i - nr]
        this.psiErZ[i] = this.pmlZE.b[z] * this.psiErZ[i] + this.pmlZE.c[z] * dHDz
        this.er[i] -= COURANT * invEpsilon * (dHDz / this.pmlZE.kappa[z] + this.psiErZ[i])

        let radialCurl
        if (r === 0) {
          radialCurl = 4 * this.hphi[i]
        } else {
          const dHDr = this.hphi[i] - this.hphi[i - 1]
          this.psiEzR[i] = this.pmlRE.b[r] * this.psiEzR[i] + this.pmlRE.c[r] * dHDr
          radialCurl = dHDr / this.pmlRE.kappa[r] + this.psiEzR[i] + (this.hphi[i] + this.hphi[i - 1]) / (2 * r)
        }
        this.ez[i] += COURANT * invEpsilon * radialCurl
      }
    }

    const drive = this.sourceValue()
    for (let r = 0; r <= this.wireRadius; r += 1) this.ez[this.sourceZ * nr + r] += drive
    for (let i = 0; i < this.metal.length; i += 1) {
      if (this.metal[i]) this.er[i] = this.ez[i] = 0
    }
    for (let z = 0; z < nz; z += 1) this.er[z * nr] = 0
    for (let r = 0; r < nr; r += 1) {
      this.er[r] = this.ez[r] = 0
      const farZ = (nz - 1) * nr + r
      this.er[farZ] = this.ez[farZ] = 0
    }
    for (let z = 0; z < nz; z += 1) {
      const outer = z * nr + nr - 1
      this.er[outer] = this.ez[outer] = 0
    }

    this.steps += 1
    const voltage = this.portVoltage()
    const current = this.portCurrent()
    if (this.voltageTrace.length < TRACE_LIMIT) {
      this.voltageTrace.push(voltage)
      this.currentTrace.push(current)
    }
    if (this.steps % SPECTRAL_STRIDE === 0) this.accumulateSpectra(voltage, current)
  }

  sourceValue() {
    const t = this.steps * COURANT
    const phase = Math.PI * 2 * t / this.wavelength
    if (this.sourceKind === 0) return this.sourceAmplitude * (1 - Math.exp(-this.steps / 45)) * Math.sin(phase)
    const centre = 3 * this.wavelength
    const width = 0.48 * this.wavelength
    return this.sourceAmplitude * Math.exp(-(((t - centre) / width) ** 2)) * Math.sin(phase)
  }

  portVoltage() {
    let voltage = 0
    for (let r = 0; r <= this.wireRadius; r += 1) voltage += this.ez[this.sourceZ * this.radialCells + r]
    return voltage / (this.wireRadius + 1)
  }

  wireCurrentAt(z) {
    if (z < this.wireStart || z > this.wireEnd || z === this.sourceZ) return 0
    const radiusIndex = Math.min(this.radialCells - 2, this.wireRadius + 1)
    return -2 * Math.PI * (radiusIndex + 0.5) * this.hphi[z * this.radialCells + radiusIndex]
  }

  portCurrent() {
    if (this.isMonopole) return this.wireCurrentAt(this.sourceZ + 1)
    return 0.5 * (this.wireCurrentAt(this.sourceZ - 1) + this.wireCurrentAt(this.sourceZ + 1))
  }

  accumulateSpectra(voltage, current) {
    const t = this.steps * COURANT
    for (let bin = 0; bin < SPECTRUM_BINS; bin += 1) {
      const phase = Math.PI * 2 * t * this.frequencyRatios[bin] / this.wavelength
      const cos = Math.cos(phase)
      const sin = -Math.sin(phase)
      this.vRe[bin] += voltage * cos
      this.vIm[bin] += voltage * sin
      this.iRe[bin] += current * cos
      this.iIm[bin] += current * sin
      const offset = bin * this.height
      for (let z = this.wireStart; z <= this.wireEnd; z += 1) {
        const wireCurrent = this.wireCurrentAt(z)
        this.profileRe[offset + z] += wireCurrent * cos
        this.profileIm[offset + z] += wireCurrent * sin
      }
    }
    this.measurements += 1
  }

  impedanceAt(bin) {
    const index = clampIndex(bin, SPECTRUM_BINS)
    const denominator = this.iRe[index] ** 2 + this.iIm[index] ** 2
    if (denominator <= 1e-18) return { real: 0, imag: 0 }
    return {
      real: ETA0 * (this.vRe[index] * this.iRe[index] + this.vIm[index] * this.iIm[index]) / denominator,
      imag: ETA0 * (this.vIm[index] * this.iRe[index] - this.vRe[index] * this.iIm[index]) / denominator
    }
  }

  resonance_index() {
    let maximumCurrent = 0
    for (let bin = 0; bin < SPECTRUM_BINS; bin += 1) maximumCurrent = Math.max(maximumCurrent, Math.hypot(this.iRe[bin], this.iIm[bin]))
    let best = Math.floor(SPECTRUM_BINS / 2)
    let score = Number.POSITIVE_INFINITY
    for (let bin = 1; bin < SPECTRUM_BINS - 1; bin += 1) {
      const current = Math.hypot(this.iRe[bin], this.iIm[bin])
      const impedance = this.impedanceAt(bin)
      if (current < maximumCurrent * 0.06 || !Number.isFinite(impedance.real) || impedance.real <= 0 || impedance.real > 2000) continue
      const localScore = Math.abs(impedance.imag) + Math.abs(this.frequencyRatios[bin] - 1) * 2
      if (localScore < score) {
        score = localScore
        best = bin
      }
    }
    return best
  }

  current_profile(bin) {
    const index = clampIndex(bin, SPECTRUM_BINS)
    const result = new Float32Array(this.height)
    let maximum = 0
    const offset = index * this.height
    for (let z = this.wireStart; z <= this.wireEnd; z += 1) {
      result[z] = Math.hypot(this.profileRe[offset + z], this.profileIm[offset + z])
      maximum = Math.max(maximum, result[z])
    }
    if (maximum > 0) for (let z = 0; z < result.length; z += 1) result[z] /= maximum
    return result
  }

  radiationPower(bin, theta) {
    if (this.isMonopole && theta > Math.PI / 2) return 0
    const index = clampIndex(bin, SPECTRUM_BINS)
    const offset = index * this.height
    const waveNumber = Math.PI * 2 * this.frequencyRatios[index] / this.wavelength
    let real = 0
    let imag = 0
    for (let z = this.wireStart; z <= this.wireEnd; z += 1) {
      const phase = waveNumber * (z - this.sourceZ) * Math.cos(theta)
      const cos = Math.cos(phase)
      const sin = Math.sin(phase)
      const profileReal = this.profileRe[offset + z]
      const profileImag = this.profileIm[offset + z]
      real += profileReal * cos - profileImag * sin
      imag += profileReal * sin + profileImag * cos
      if (this.isMonopole) {
        const imagePhase = waveNumber * (2 * this.groundZ - z - this.sourceZ) * Math.cos(theta)
        const imageCos = Math.cos(imagePhase)
        const imageSin = Math.sin(imagePhase)
        real += profileReal * imageCos - profileImag * imageSin
        imag += profileReal * imageSin + profileImag * imageCos
      }
    }
    return (real * real + imag * imag) * Math.sin(theta) ** 2
  }

  radiation_pattern_at(bin) {
    const pattern = new Float32Array(PATTERN_SAMPLES)
    let maximum = 0
    for (let sample = 0; sample < PATTERN_SAMPLES; sample += 1) {
      const angle = sample * Math.PI * 2 / PATTERN_SAMPLES
      const theta = angle <= Math.PI ? angle : Math.PI * 2 - angle
      pattern[sample] = this.radiationPower(bin, theta)
      maximum = Math.max(maximum, pattern[sample])
    }
    if (maximum > 0) for (let sample = 0; sample < pattern.length; sample += 1) pattern[sample] /= maximum
    return pattern
  }

  directivity_3d_at(bin) {
    const upperLimit = this.isMonopole ? Math.PI / 2 : Math.PI
    const samples = this.isMonopole ? 90 : 180
    const delta = upperLimit / samples
    let maximum = 0
    let integral = 0
    for (let sample = 0; sample <= samples; sample += 1) {
      const theta = sample * delta
      const power = this.radiationPower(bin, theta)
      maximum = Math.max(maximum, power)
      const weight = sample === 0 || sample === samples ? 0.5 : 1
      integral += weight * power * Math.sin(theta) * delta
    }
    return integral > 1e-18 ? 2 * maximum / integral : 0
  }

  mirrorSnapshot(source, ArrayType) {
    const result = new ArrayType(this.width * this.height)
    const half = Math.floor(this.width / 2)
    for (let z = 0; z < this.height; z += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const r = x < half ? half - 1 - x : x - half
        result[z * this.width + x] = source[z * this.radialCells + Math.min(r, this.radialCells - 1)]
      }
    }
    return result
  }

  reset() {
    for (const array of [this.er, this.ez, this.hphi, this.psiHPhiR, this.psiHPhiZ, this.psiErZ, this.psiEzR, this.vRe, this.vIm, this.iRe, this.iIm, this.profileRe, this.profileIm]) array.fill(0)
    this.voltageTrace = []
    this.currentTrace = []
    this.measurements = 0
    this.steps = 0
  }

  field_snapshot() { return this.mirrorSnapshot(this.hphi, Float32Array) }
  magnetic_field_snapshot() { return this.field_snapshot() }
  electric_z_snapshot() { return this.mirrorSnapshot(this.ez, Float32Array) }
  electric_r_snapshot() {
    const snapshot = this.mirrorSnapshot(this.er, Float32Array)
    const half = Math.floor(this.width / 2)
    for (let z = 0; z < this.height; z += 1) {
      for (let x = 0; x < half; x += 1) snapshot[z * this.width + x] *= -1
    }
    return snapshot
  }
  electric_magnitude_snapshot() {
    const magnitude = new Float32Array(this.er.length)
    for (let index = 0; index < magnitude.length; index += 1) magnitude[index] = Math.hypot(this.er[index], this.ez[index])
    return this.mirrorSnapshot(magnitude, Float32Array)
  }
  metal_snapshot() { return this.mirrorSnapshot(this.metal, Uint8Array) }
  material_snapshot() { return this.mirrorSnapshot(this.epsilon, Float32Array) }
  time_voltage_snapshot() { return Float32Array.from(this.voltageTrace) }
  time_current_snapshot() { return Float32Array.from(this.currentTrace) }
  spectrum_frequencies() { return Float32Array.from(this.frequencyRatios) }
  spectrum_impedance_real() { return Float64Array.from(this.frequencyRatios, (_, index) => this.impedanceAt(index).real) }
  spectrum_impedance_imag() { return Float64Array.from(this.frequencyRatios, (_, index) => this.impedanceAt(index).imag) }
  spectrum_current_magnitude() { return Float64Array.from(this.frequencyRatios, (_, index) => Math.hypot(this.iRe[index], this.iIm[index])) }
  radiation_pattern() { return this.radiation_pattern_at(this.resonance_index()) }
  directivity_2d() { return this.directivity_3d_at(this.resonance_index()) }
  directivity_3d() { return this.directivity_3d_at(this.resonance_index()) }
  impedance_real() { return this.impedanceAt(Math.floor(SPECTRUM_BINS / 2)).real }
  impedance_imag() { return this.impedanceAt(Math.floor(SPECTRUM_BINS / 2)).imag }
  step_count() { return this.steps }
  measurement_count() { return this.measurements }
  nx() { return this.width }
  ny() { return this.height }
  time_step() { return COURANT }
  wire_start() { return this.wireStart }
  wire_end() { return this.wireEnd }
  feed_position() { return this.sourceZ }

  energy() {
    let total = 0
    let weights = 0
    for (let z = 0; z < this.height; z += 1) {
      for (let r = 0; r < this.radialCells; r += 1) {
        const i = z * this.radialCells + r
        const weight = r + 0.5
        total += weight * (this.er[i] ** 2 + this.ez[i] ** 2 + this.hphi[i] ** 2)
        weights += weight
      }
    }
    return total / weights
  }
}
