const COURANT_3D = 0.42
const ETA0 = 376.730313668
const SPECTRUM_BINS = 41
const SPECTRAL_STRIDE = 2
const TRACE_LIMIT = 4096
const PATTERN_SAMPLES = 72
const COURTYARD_LONG_CELLS = 75
const COURTYARD_SHORT_CELLS = 38
const COURTYARD_BUILDING_HEIGHT_CELLS = 50
const COURTYARD_WIRE_CELLS = 25
const COURTYARD_EPSILON = 5

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
    const localB = Math.exp(-(sigma / localKappa + alpha) * COURANT_3D)
    const denominator = sigma * localKappa + localKappa * localKappa * alpha
    kappa[index] = localKappa
    b[index] = localB
    c[index] = denominator > 1e-12 ? sigma * (localB - 1) / denominator : 0
  }
  return { kappa, b, c }
}

export class FdtdSimulation3dFallback {
  constructor(nx, nz, wavelengthCells, _dipoleFraction, pmlCells, targetReflection, sourceKind, sourceAmplitude, _dielectricEnabled, kappaMax = 5, alphaMax = 0.05, wireRadiusCells = 1, antennaKind = 2, depthCells = nx) {
    this.antennaKind = Math.round(antennaKind)
    this.isCourtyard = this.antennaKind === 3
    this.gx = this.isCourtyard
      ? Math.max(128, Math.min(144, Math.round(nx)))
      : Math.max(56, Math.min(112, Math.round(nx)))
    this.gy = this.isCourtyard
      ? Math.max(64, Math.min(112, Math.round(depthCells)))
      : this.gx
    this.gz = this.isCourtyard
      ? Math.max(104, Math.min(160, Math.round(nz)))
      : Math.max(80, Math.min(160, Math.round(nz)))
    this.wavelength = Math.max(14, Math.min(60, wavelengthCells))
    this.pmlCells = Math.max(8, Math.min(Math.floor(Math.min(this.gx, this.gy, this.gz) / 3), Math.round(pmlCells)))
    this.sourceKind = sourceKind ? 1 : 0
    this.sourceAmplitude = Math.max(0.01, Math.min(2, sourceAmplitude))
    this.wireRadius = Math.max(0, Math.min(1, Math.round(wireRadiusCells) - 1))
    this.cx = Math.floor(this.gx / 2)
    this.cy = Math.floor(this.gy / 2)
    this.sourcePosition = Math.floor(this.gz / 2)
    this.sliceY = this.cy
    this.steps = 0
    const size = this.gx * this.gy * this.gz
    this.ex = new Float32Array(size)
    this.ey = new Float32Array(size)
    this.ez = new Float32Array(size)
    this.hx = new Float32Array(size)
    this.hy = new Float32Array(size)
    this.hz = new Float32Array(size)
    this.epsilon = new Float32Array(size).fill(1)
    this.metal = new Uint8Array(size)
    this.psiHxY = new Float32Array(size)
    this.psiHxZ = new Float32Array(size)
    this.psiHyZ = new Float32Array(size)
    this.psiHyX = new Float32Array(size)
    this.psiHzX = new Float32Array(size)
    this.psiHzY = new Float32Array(size)
    this.psiExY = new Float32Array(size)
    this.psiExZ = new Float32Array(size)
    this.psiEyZ = new Float32Array(size)
    this.psiEyX = new Float32Array(size)
    this.psiEzX = new Float32Array(size)
    this.psiEzY = new Float32Array(size)

    const reflection = Math.max(1e-12, Math.min(1e-2, targetReflection))
    const safeKappa = Math.max(1, Math.min(12, kappaMax))
    const safeAlpha = Math.max(0, Math.min(0.25, alphaMax))
    this.pmlXH = makePmlAxis(this.gx, this.pmlCells, 0.5, reflection, safeKappa, safeAlpha)
    this.pmlYH = makePmlAxis(this.gy, this.pmlCells, 0.5, reflection, safeKappa, safeAlpha)
    this.pmlZH = makePmlAxis(this.gz, this.pmlCells, 0.5, reflection, safeKappa, safeAlpha)
    this.pmlXE = makePmlAxis(this.gx, this.pmlCells, 0, reflection, safeKappa, safeAlpha)
    this.pmlYE = makePmlAxis(this.gy, this.pmlCells, 0, reflection, safeKappa, safeAlpha)
    this.pmlZE = makePmlAxis(this.gz, this.pmlCells, 0, reflection, safeKappa, safeAlpha)

    this.sceneGeometry = new Float32Array()
    if (this.isCourtyard) this.buildCourtyardGeometry()
    else this.buildYagiGeometry()
    this.drivenIndex = this.elements.findIndex(element => element.driven)
    this.profileLength = Math.max(this.gx, this.gz)
    this.markConductors()

    this.frequencyRatios = Float64Array.from({ length: SPECTRUM_BINS }, (_, index) => 0.7 + index * 0.6 / (SPECTRUM_BINS - 1))
    this.vRe = new Float64Array(SPECTRUM_BINS)
    this.vIm = new Float64Array(SPECTRUM_BINS)
    this.iRe = new Float64Array(SPECTRUM_BINS)
    this.iIm = new Float64Array(SPECTRUM_BINS)
    this.profileRe = new Float64Array(SPECTRUM_BINS * this.elements.length * this.profileLength)
    this.profileIm = new Float64Array(SPECTRUM_BINS * this.elements.length * this.profileLength)
    this.voltageTrace = []
    this.currentTrace = []
    this.measurements = 0
  }

  buildYagiGeometry() {
    const elementSpecs = [
      { role: 'Reflector', offset: -0.22, length: 0.53, driven: false },
      { role: 'Excitado', offset: 0, length: 0.47, driven: true },
      { role: 'Director 1', offset: 0.17, length: 0.45, driven: false },
      { role: 'Director 2', offset: 0.34, length: 0.43, driven: false }
    ]
    this.elements = elementSpecs.map(spec => {
      const x = this.cx + Math.round(spec.offset * this.wavelength)
      const cells = Math.max(7, Math.round(spec.length * this.wavelength))
      const start = this.sourcePosition - Math.floor(cells / 2)
      return { ...spec, axis: 'z', x, y: this.cy, z: 0, start, end: start + cells }
    })
  }

  buildCourtyardGeometry() {
    const x0 = Math.floor((this.gx - COURTYARD_LONG_CELLS - COURTYARD_WIRE_CELLS) / 2)
    const x1 = x0 + COURTYARD_LONG_CELLS
    const y0 = Math.floor((this.gy - COURTYARD_SHORT_CELLS) / 2)
    const y1 = y0 + COURTYARD_SHORT_CELLS
    const ground = this.pmlCells + 4
    const roof = ground + COURTYARD_BUILDING_HEIGHT_CELLS
    const wireStart = x1
    const wireEnd = wireStart + COURTYARD_WIRE_CELLS
    const wireY = y0 + 1
    const wireZ = roof
    this.sourcePosition = wireStart
    this.sliceY = roof
    this.elements = [{ role: 'Hilo exterior de 10 m', axis: 'x', x: 0, y: wireY, z: wireZ, start: wireStart, end: wireEnd, driven: true }]

    for (let z = ground; z <= roof; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        this.epsilon[this.index(x, y0, z)] = COURTYARD_EPSILON
        this.epsilon[this.index(x, y1, z)] = COURTYARD_EPSILON
      }
      for (let y = y0; y <= y1; y += 1) {
        this.epsilon[this.index(x0, y, z)] = COURTYARD_EPSILON
        this.epsilon[this.index(x1, y, z)] = COURTYARD_EPSILON
      }
    }
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) this.epsilon[this.index(x, y, roof)] = COURTYARD_EPSILON
    }
    this.sceneGeometry = Float32Array.from([2, x0, x1, y0, y1, ground, roof, wireStart, wireEnd, wireY, wireZ, 0.4])
  }

  elementPoint(element, coordinate) {
    return element.axis === 'x'
      ? [coordinate, element.y, element.z]
      : [element.x, element.y, coordinate]
  }

  markConductors() {
    for (const element of this.elements) {
      for (let coordinate = element.start; coordinate <= element.end; coordinate += 1) {
        if (element.driven && coordinate === this.sourcePosition) continue
        const [x, y, z] = this.elementPoint(element, coordinate)
        if (element.axis === 'x') {
          for (let dz = -this.wireRadius; dz <= this.wireRadius; dz += 1) {
            for (let dy = -this.wireRadius; dy <= this.wireRadius; dy += 1) this.metal[this.index(x, y + dy, z + dz)] = 1
          }
        } else {
          for (let dy = -this.wireRadius; dy <= this.wireRadius; dy += 1) {
            for (let dx = -this.wireRadius; dx <= this.wireRadius; dx += 1) this.metal[this.index(x + dx, y + dy, z)] = 1
          }
        }
      }
    }
  }

  index(x, y, z) { return (z * this.gy + y) * this.gx + x }

  step(count) {
    for (let pass = 0; pass < Math.min(16, count); pass += 1) this.singleStep()
  }

  singleStep() {
    const { gx, gy, gz } = this
    const plane = gx * gy
    for (let z = 0; z < gz - 1; z += 1) {
      for (let y = 0; y < gy - 1; y += 1) {
        for (let x = 0; x < gx - 1; x += 1) {
          const i = (z * gy + y) * gx + x
          const dEzDy = this.ez[i + gx] - this.ez[i]
          const dEyDz = this.ey[i + plane] - this.ey[i]
          const dExDz = this.ex[i + plane] - this.ex[i]
          const dEzDx = this.ez[i + 1] - this.ez[i]
          const dEyDx = this.ey[i + 1] - this.ey[i]
          const dExDy = this.ex[i + gx] - this.ex[i]
          this.psiHxY[i] = this.pmlYH.b[y] * this.psiHxY[i] + this.pmlYH.c[y] * dEzDy
          this.psiHxZ[i] = this.pmlZH.b[z] * this.psiHxZ[i] + this.pmlZH.c[z] * dEyDz
          this.psiHyZ[i] = this.pmlZH.b[z] * this.psiHyZ[i] + this.pmlZH.c[z] * dExDz
          this.psiHyX[i] = this.pmlXH.b[x] * this.psiHyX[i] + this.pmlXH.c[x] * dEzDx
          this.psiHzX[i] = this.pmlXH.b[x] * this.psiHzX[i] + this.pmlXH.c[x] * dEyDx
          this.psiHzY[i] = this.pmlYH.b[y] * this.psiHzY[i] + this.pmlYH.c[y] * dExDy
          this.hx[i] += COURANT_3D * ((dEyDz / this.pmlZH.kappa[z] + this.psiHxZ[i]) - (dEzDy / this.pmlYH.kappa[y] + this.psiHxY[i]))
          this.hy[i] += COURANT_3D * ((dEzDx / this.pmlXH.kappa[x] + this.psiHyX[i]) - (dExDz / this.pmlZH.kappa[z] + this.psiHyZ[i]))
          this.hz[i] += COURANT_3D * ((dExDy / this.pmlYH.kappa[y] + this.psiHzY[i]) - (dEyDx / this.pmlXH.kappa[x] + this.psiHzX[i]))
        }
      }
    }

    for (let z = 1; z < gz - 1; z += 1) {
      for (let y = 1; y < gy - 1; y += 1) {
        for (let x = 1; x < gx - 1; x += 1) {
          const i = (z * gy + y) * gx + x
          const invEpsilon = 1 / this.epsilon[i]
          const dHzDy = this.hz[i] - this.hz[i - gx]
          const dHyDz = this.hy[i] - this.hy[i - plane]
          const dHxDz = this.hx[i] - this.hx[i - plane]
          const dHzDx = this.hz[i] - this.hz[i - 1]
          const dHyDx = this.hy[i] - this.hy[i - 1]
          const dHxDy = this.hx[i] - this.hx[i - gx]
          this.psiExY[i] = this.pmlYE.b[y] * this.psiExY[i] + this.pmlYE.c[y] * dHzDy
          this.psiExZ[i] = this.pmlZE.b[z] * this.psiExZ[i] + this.pmlZE.c[z] * dHyDz
          this.psiEyZ[i] = this.pmlZE.b[z] * this.psiEyZ[i] + this.pmlZE.c[z] * dHxDz
          this.psiEyX[i] = this.pmlXE.b[x] * this.psiEyX[i] + this.pmlXE.c[x] * dHzDx
          this.psiEzX[i] = this.pmlXE.b[x] * this.psiEzX[i] + this.pmlXE.c[x] * dHyDx
          this.psiEzY[i] = this.pmlYE.b[y] * this.psiEzY[i] + this.pmlYE.c[y] * dHxDy
          this.ex[i] += COURANT_3D * invEpsilon * ((dHzDy / this.pmlYE.kappa[y] + this.psiExY[i]) - (dHyDz / this.pmlZE.kappa[z] + this.psiExZ[i]))
          this.ey[i] += COURANT_3D * invEpsilon * ((dHxDz / this.pmlZE.kappa[z] + this.psiEyZ[i]) - (dHzDx / this.pmlXE.kappa[x] + this.psiEyX[i]))
          this.ez[i] += COURANT_3D * invEpsilon * ((dHyDx / this.pmlXE.kappa[x] + this.psiEzX[i]) - (dHxDy / this.pmlYE.kappa[y] + this.psiEzY[i]))
        }
      }
    }

    const driven = this.elements[this.drivenIndex]
    const [sourceX, sourceY, sourceZ] = this.elementPoint(driven, this.sourcePosition)
    const sourceIndex = this.index(sourceX, sourceY, sourceZ)
    if (driven.axis === 'x') this.ex[sourceIndex] += this.sourceValue()
    else this.ez[sourceIndex] += this.sourceValue()
    for (let i = 0; i < this.metal.length; i += 1) if (this.metal[i]) this.ex[i] = this.ey[i] = this.ez[i] = 0
    this.zeroOuterElectricBoundary()
    this.steps += 1
    const voltage = driven.axis === 'x' ? this.ex[sourceIndex] : this.ez[sourceIndex]
    const current = driven.axis === 'x'
      ? this.wireCurrentAt(this.drivenIndex, this.sourcePosition + 1)
      : 0.5 * (this.wireCurrentAt(this.drivenIndex, this.sourcePosition - 1) + this.wireCurrentAt(this.drivenIndex, this.sourcePosition + 1))
    if (this.voltageTrace.length < TRACE_LIMIT) {
      this.voltageTrace.push(voltage)
      this.currentTrace.push(current)
    }
    if (this.steps % SPECTRAL_STRIDE === 0) this.accumulateSpectra(voltage, current)
  }

  zeroOuterElectricBoundary() {
    const { gx, gy, gz } = this
    for (let z = 0; z < gz; z += 1) {
      for (let y = 0; y < gy; y += 1) {
        for (const x of [0, gx - 1]) {
          const i = this.index(x, y, z); this.ex[i] = this.ey[i] = this.ez[i] = 0
        }
      }
      for (let x = 0; x < gx; x += 1) {
        for (const y of [0, gy - 1]) {
          const i = this.index(x, y, z); this.ex[i] = this.ey[i] = this.ez[i] = 0
        }
      }
    }
    for (let y = 0; y < gy; y += 1) {
      for (let x = 0; x < gx; x += 1) {
        for (const z of [0, gz - 1]) {
          const i = this.index(x, y, z); this.ex[i] = this.ey[i] = this.ez[i] = 0
        }
      }
    }
  }

  sourceValue() {
    const t = this.steps * COURANT_3D
    const phase = Math.PI * 2 * t / this.wavelength
    if (this.sourceKind === 0) return this.sourceAmplitude * (1 - Math.exp(-this.steps / 35)) * Math.sin(phase)
    const centre = 3 * this.wavelength
    const width = 0.48 * this.wavelength
    return this.sourceAmplitude * Math.exp(-(((t - centre) / width) ** 2)) * Math.sin(phase)
  }

  wireCurrentAt(elementIndex, coordinate) {
    const element = this.elements[elementIndex]
    if (coordinate < element.start || coordinate > element.end || (element.driven && coordinate === this.sourcePosition)) return 0
    const radius = this.wireRadius + 2
    const [x, y, z] = this.elementPoint(element, coordinate)
    if (element.axis === 'x') {
      const yp = this.index(x, y + radius, z)
      const ym = this.index(x, y - radius, z)
      const zp = this.index(x, y, z + radius)
      const zm = this.index(x, y, z - radius)
      const hPhi = (this.hz[yp] - this.hz[ym] - this.hy[zp] + this.hy[zm]) / 4
      return -2 * Math.PI * radius * hPhi
    }
    const xp = this.index(x + radius, y, z)
    const xm = this.index(x - radius, y, z)
    const yp = this.index(x, y + radius, z)
    const ym = this.index(x, y - radius, z)
    const hPhi = (this.hy[xp] - this.hy[xm] - this.hx[yp] + this.hx[ym]) / 4
    return -2 * Math.PI * radius * hPhi
  }

  accumulateSpectra(voltage, current) {
    const t = this.steps * COURANT_3D
    for (let bin = 0; bin < SPECTRUM_BINS; bin += 1) {
      const phase = Math.PI * 2 * t * this.frequencyRatios[bin] / this.wavelength
      const cos = Math.cos(phase)
      const sin = -Math.sin(phase)
      this.vRe[bin] += voltage * cos
      this.vIm[bin] += voltage * sin
      this.iRe[bin] += current * cos
      this.iIm[bin] += current * sin
      for (let elementIndex = 0; elementIndex < this.elements.length; elementIndex += 1) {
        const element = this.elements[elementIndex]
        const offset = (bin * this.elements.length + elementIndex) * this.profileLength
        for (let coordinate = element.start; coordinate <= element.end; coordinate += 1) {
          const wireCurrent = this.wireCurrentAt(elementIndex, coordinate)
          this.profileRe[offset + coordinate] += wireCurrent * cos
          this.profileIm[offset + coordinate] += wireCurrent * sin
        }
      }
    }
    this.measurements += 1
  }

  impedanceAt(bin) {
    const index = Math.max(0, Math.min(SPECTRUM_BINS - 1, Math.round(bin)))
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
    let score = Infinity
    for (let bin = 1; bin < SPECTRUM_BINS - 1; bin += 1) {
      const z = this.impedanceAt(bin)
      const signal = Math.hypot(this.iRe[bin], this.iIm[bin])
      if (signal < maximumCurrent * 0.06 || z.real <= 0 || z.real > 3000) continue
      if (Math.abs(z.imag) < score) { score = Math.abs(z.imag); best = bin }
    }
    return best
  }

  current_profile(bin) {
    const index = Math.max(0, Math.min(SPECTRUM_BINS - 1, Math.round(bin)))
    const element = this.elements[this.drivenIndex]
    const offset = (index * this.elements.length + this.drivenIndex) * this.profileLength
    const profile = new Float32Array(this.profileLength)
    let maximum = 0
    for (let coordinate = element.start; coordinate <= element.end; coordinate += 1) {
      profile[coordinate] = Math.hypot(this.profileRe[offset + coordinate], this.profileIm[offset + coordinate])
      maximum = Math.max(maximum, profile[coordinate])
    }
    if (maximum > 0) for (let z = 0; z < profile.length; z += 1) profile[z] /= maximum
    return profile
  }

  radiationPowerDirection(bin, ux, uy, uz) {
    const waveNumber = Math.PI * 2 * this.frequencyRatios[bin] / this.wavelength
    let real = 0
    let imag = 0
    for (let elementIndex = 0; elementIndex < this.elements.length; elementIndex += 1) {
      const element = this.elements[elementIndex]
      const offset = (bin * this.elements.length + elementIndex) * this.profileLength
      for (let coordinate = element.start; coordinate <= element.end; coordinate += 1) {
        const [x, y, z] = this.elementPoint(element, coordinate)
        const phase = waveNumber * ((x - this.cx) * ux + (y - this.cy) * uy + (z - Math.floor(this.gz / 2)) * uz)
        const cos = Math.cos(phase)
        const sin = Math.sin(phase)
        const pr = this.profileRe[offset + coordinate]
        const pi = this.profileIm[offset + coordinate]
        real += pr * cos - pi * sin
        imag += pr * sin + pi * cos
      }
    }
    const along = this.elements[this.drivenIndex].axis === 'x' ? ux : uz
    return (real * real + imag * imag) * Math.max(0, 1 - along * along)
  }

  radiation_pattern_at(bin) {
    const index = Math.max(0, Math.min(SPECTRUM_BINS - 1, Math.round(bin)))
    const pattern = new Float32Array(PATTERN_SAMPLES)
    let maximum = 0
    for (let sample = 0; sample < PATTERN_SAMPLES; sample += 1) {
      const angle = sample * Math.PI * 2 / PATTERN_SAMPLES
      pattern[sample] = this.radiationPowerDirection(index, Math.sin(angle), 0, Math.cos(angle))
      maximum = Math.max(maximum, pattern[sample])
    }
    if (maximum > 0) for (let sample = 0; sample < pattern.length; sample += 1) pattern[sample] /= maximum
    return pattern
  }

  directivity_3d_at(bin) {
    const index = Math.max(0, Math.min(SPECTRUM_BINS - 1, Math.round(bin)))
    const thetaSamples = 36
    const phiSamples = 72
    const dTheta = Math.PI / thetaSamples
    const dPhi = Math.PI * 2 / phiSamples
    let maximum = 0
    let integral = 0
    for (let ti = 0; ti <= thetaSamples; ti += 1) {
      const theta = ti * dTheta
      const sinTheta = Math.sin(theta)
      for (let pi = 0; pi < phiSamples; pi += 1) {
        const phi = pi * dPhi
        const power = this.radiationPowerDirection(index, sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), Math.cos(theta))
        maximum = Math.max(maximum, power)
        integral += power * sinTheta * dTheta * dPhi
      }
    }
    return integral > 1e-18 ? 4 * Math.PI * maximum / integral : 0
  }

  slice(source) {
    const result = new Float32Array(this.gx * (this.isCourtyard ? this.gy : this.gz))
    if (this.isCourtyard) {
      for (let y = 0; y < this.gy; y += 1) for (let x = 0; x < this.gx; x += 1) result[y * this.gx + x] = source[this.index(x, y, this.sliceY)]
      return result
    }
    for (let z = 0; z < this.gz; z += 1) for (let x = 0; x < this.gx; x += 1) result[z * this.gx + x] = source[this.index(x, this.sliceY, z)]
    return result
  }

  field_snapshot() { return this.slice(this.isCourtyard ? this.hz : this.hy) }
  magnetic_field_snapshot() { return this.field_snapshot() }
  electric_z_snapshot() { return this.slice(this.ez) }
  electric_r_snapshot() { return this.slice(this.ex) }
  electric_magnitude_snapshot() {
    const height = this.isCourtyard ? this.gy : this.gz
    const result = new Float32Array(this.gx * height)
    for (let vertical = 0; vertical < height; vertical += 1) {
      for (let x = 0; x < this.gx; x += 1) {
        const i = this.isCourtyard ? this.index(x, vertical, this.sliceY) : this.index(x, this.sliceY, vertical)
        result[vertical * this.gx + x] = Math.hypot(this.ex[i], this.ey[i], this.ez[i])
      }
    }
    return result
  }
  volume_snapshot(kind = 0) {
    if (kind === 1) return this.ez.slice()
    if (kind === 2) return this.ex.slice()
    if (kind === 3) {
      const result = new Float32Array(this.ex.length)
      for (let i = 0; i < result.length; i += 1) result[i] = Math.hypot(this.ex[i], this.ey[i], this.ez[i])
      return result
    }
    return (this.isCourtyard ? this.hz : this.hy).slice()
  }
  conductor_points() {
    const points = []
    for (const element of this.elements) {
      for (let coordinate = element.start; coordinate <= element.end; coordinate += 1) points.push(...this.elementPoint(element, coordinate))
    }
    return Float32Array.from(points)
  }
  scene_geometry() { return this.sceneGeometry.slice() }
  metal_snapshot() { return this.slice(this.metal) }
  material_snapshot() { return this.slice(this.epsilon) }
  time_voltage_snapshot() { return Float32Array.from(this.voltageTrace) }
  time_current_snapshot() { return Float32Array.from(this.currentTrace) }
  spectrum_frequencies() { return Float32Array.from(this.frequencyRatios) }
  spectrum_impedance_real() { return Float64Array.from(this.frequencyRatios, (_, index) => this.impedanceAt(index).real) }
  spectrum_impedance_imag() { return Float64Array.from(this.frequencyRatios, (_, index) => this.impedanceAt(index).imag) }
  spectrum_current_magnitude() { return Float64Array.from(this.frequencyRatios, (_, index) => Math.hypot(this.iRe[index], this.iIm[index])) }
  radiation_pattern() { return this.radiation_pattern_at(this.resonance_index()) }
  directivity_3d() { return this.directivity_3d_at(this.resonance_index()) }
  impedance_real() { return this.impedanceAt(Math.floor(SPECTRUM_BINS / 2)).real }
  impedance_imag() { return this.impedanceAt(Math.floor(SPECTRUM_BINS / 2)).imag }
  step_count() { return this.steps }
  measurement_count() { return this.measurements }
  nx() { return this.gx }
  ny() { return this.gz }
  depth() { return this.gy }
  snapshot_width() { return this.gx }
  snapshot_height() { return this.isCourtyard ? this.gy : this.gz }
  time_step() { return COURANT_3D }
  wire_start() { return this.elements[this.drivenIndex].start }
  wire_end() { return this.elements[this.drivenIndex].end }
  feed_position() { return this.sourcePosition }

  energy() {
    let total = 0
    for (let i = 0; i < this.ex.length; i += 1) total += this.ex[i] ** 2 + this.ey[i] ** 2 + this.ez[i] ** 2 + this.hx[i] ** 2 + this.hy[i] ** 2 + this.hz[i] ** 2
    return total / this.ex.length
  }
}
