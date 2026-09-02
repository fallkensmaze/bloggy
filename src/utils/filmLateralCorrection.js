export const LATERAL_CORRECTION_VERSION = 1
export const LATERAL_AXES = ['x', 'y']

const REQUIRED_CENTRAL_FRACTION = 0.5
const EPSILON = 1e-12

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function coordinate(position, length) {
  return 2 * ((position + 0.5) / length - 0.5)
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length
  const augmented = matrix.map((row, index) => [...row, vector[index]])
  for (let column = 0; column < size; column++) {
    let pivot = column
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    }
    if (Math.abs(augmented[pivot][column]) < 1e-14) throw new Error('No se puede identificar la corrección lateral con estas ROI.')
    if (pivot !== column) [augmented[pivot], augmented[column]] = [augmented[column], augmented[pivot]]
    const divisor = augmented[column][column]
    for (let index = column; index <= size; index++) augmented[column][index] /= divisor
    for (let row = 0; row < size; row++) {
      if (row === column) continue
      const factor = augmented[row][column]
      for (let index = column; index <= size; index++) augmented[row][index] -= factor * augmented[column][index]
    }
  }
  return augmented.map((row) => row[size])
}

function correctionDelta(normalizedValue, u, coefficients) {
  return (coefficients.a1 + coefficients.b1 * normalizedValue) * u +
    (coefficients.a2 + coefficients.b2 * normalizedValue) * u * u
}

function fitChannel(profiles, channel, commonRange) {
  const size = 4
  const normal = Array.from({ length: size }, () => new Array(size).fill(0))
  const target = new Array(size).fill(0)
  let observationCount = 0

  for (const profile of profiles) {
    const center = profile.centerRgb[channel]
    for (const sample of profile.samples) {
      if (sample.u < commonRange[0] || sample.u > commonRange[1]) continue
      const value = sample.rgb[channel]
      const features = [sample.u, sample.u * sample.u, value * sample.u, value * sample.u * sample.u]
      const difference = center - value
      for (let row = 0; row < size; row++) {
        target[row] += features[row] * difference
        for (let column = 0; column < size; column++) normal[row][column] += features[row] * features[column]
      }
      observationCount++
    }
  }

  const trace = normal.reduce((sum, row, index) => sum + row[index], 0)
  const ridge = Math.max(EPSILON, trace * 1e-10 / size)
  for (let index = 0; index < size; index++) normal[index][index] += ridge
  const [a1, a2, b1, b2] = solveLinearSystem(normal, target)
  const coefficients = { a1, a2, b1, b2 }
  let sumSquares = 0
  let maximumAbsolute = 0
  let maximumCorrection = 0

  for (const profile of profiles) {
    const center = profile.centerRgb[channel]
    for (const sample of profile.samples) {
      if (sample.u < commonRange[0] || sample.u > commonRange[1]) continue
      const delta = correctionDelta(sample.rgb[channel], sample.u, coefficients)
      const residual = sample.rgb[channel] + delta - center
      sumSquares += residual * residual
      maximumAbsolute = Math.max(maximumAbsolute, Math.abs(residual))
      maximumCorrection = Math.max(maximumCorrection, Math.abs(delta))
    }
  }

  return {
    coefficients,
    observations: observationCount,
    rmseIntensity: Math.sqrt(sumSquares / Math.max(1, observationCount)),
    maximumAbsoluteIntensity: maximumAbsolute,
    maximumCorrectionIntensity: maximumCorrection
  }
}

/**
 * Modelo de Lewis–Chan: la respuesta local se transforma a la respuesta que
 * tendría en el centro mediante una relación afín dependiente de la posición.
 * A(u) y B(u) se representan con polinomios de segundo grado y la identidad se
 * impone exactamente en u=0.
 */
export function fitLateralCorrection(profiles, axis = 'x') {
  if (!LATERAL_AXES.includes(axis)) throw new Error('El eje lateral debe ser X o Y.')
  if (!Array.isArray(profiles) || profiles.length < 4) {
    throw new Error('La corrección lateral necesita al menos cuatro perfiles uniformes de distinta respuesta.')
  }
  if (profiles.some((profile) => profile.axis !== axis)) throw new Error('Los perfiles laterales no comparten el mismo eje.')
  if (profiles.some((profile) => !Number.isFinite(profile.axisLength) || profile.axisLength < 2)) {
    throw new Error('Los perfiles laterales no conservan la geometría del escaneo.')
  }

  const commonRange = [
    Math.max(...profiles.map((profile) => profile.range[0])),
    Math.min(...profiles.map((profile) => profile.range[1]))
  ]
  const halfPixelTolerance = Math.max(...profiles.map((profile) => 1 / profile.axisLength))
  const requiredHalfSpan = REQUIRED_CENTRAL_FRACTION - halfPixelTolerance
  if (commonRange[0] > -requiredHalfSpan || commonRange[1] < requiredHalfSpan) {
    throw new Error('Las ROI deben cubrir conjuntamente al menos el 50 % central del eje lateral y extenderse a ambos lados del centro.')
  }

  for (let channel = 0; channel < 3; channel++) {
    const centers = profiles.map((profile) => profile.centerRgb[channel]).sort((left, right) => left - right)
    const distinctCenters = centers.reduce((groups, value) => {
      if (!groups.length || value - groups.at(-1) >= 0.002) groups.push(value)
      return groups
    }, [])
    if (distinctCenters.length < 4) {
      throw new Error(`El canal ${['R', 'G', 'B'][channel]} necesita al menos cuatro niveles de respuesta lateral distintos.`)
    }
    const span = centers.at(-1) - centers[0]
    if (!(span > 0.04)) throw new Error(`El canal ${['R', 'G', 'B'][channel]} no contiene suficiente variedad de respuesta para separar dosis y posición lateral.`)
  }

  const channels = [0, 1, 2].map((channel) => fitChannel(profiles, channel, commonRange))
  return {
    version: LATERAL_CORRECTION_VERSION,
    model: 'lewis-chan-affine-quadratic',
    axis,
    coordinate: 'normalized-scan-center',
    validRangeNormalized: commonRange,
    channelFits: channels,
    profileCount: profiles.length,
    sourceImages: [...new Set(profiles.map((profile) => profile.imageName))],
    createdAt: new Date().toISOString()
  }
}

export function validateLateralCorrection(correction) {
  if (!correction || correction.version !== LATERAL_CORRECTION_VERSION ||
      correction.model !== 'lewis-chan-affine-quadratic' || !LATERAL_AXES.includes(correction.axis)) {
    throw new Error('La calibración no contiene una corrección lateral compatible.')
  }
  const range = correction.validRangeNormalized
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) ||
      range[0] < -1 || range[1] > 1 || range[0] >= 0 || range[1] <= 0) {
    throw new Error('El intervalo validado de la corrección lateral no es válido.')
  }
  if (!Array.isArray(correction.channelFits) || correction.channelFits.length !== 3) {
    throw new Error('La corrección lateral no contiene los tres canales RGB.')
  }
  for (const fit of correction.channelFits) {
    if (!fit?.coefficients || !['a1', 'a2', 'b1', 'b2'].every((key) => Number.isFinite(fit.coefficients[key])) ||
        !Number.isFinite(fit.rmseIntensity) || fit.rmseIntensity < 0) {
      throw new Error('La corrección lateral contiene coeficientes no válidos.')
    }
  }
  return correction
}

export function lateralCoordinate(correction, x, y, width, height) {
  const position = correction.axis === 'x' ? x : y
  const length = correction.axis === 'x' ? width : height
  return coordinate(position, length)
}

export function isInsideLateralRange(correction, x, y, width, height) {
  const u = lateralCoordinate(correction, x, y, width, height)
  const [minimum, maximum] = correction.validRangeNormalized
  return u >= minimum - 1e-9 && u <= maximum + 1e-9
}

export function correctLateralValue(value, channel, x, y, width, height, correction) {
  if (!correction) return value
  const normalized = Number(value) / 65535
  const u = lateralCoordinate(correction, x, y, width, height)
  const fit = correction.channelFits[channel]
  const corrected = normalized + correctionDelta(normalized, u, fit.coefficients)
  return clamp(corrected, 1 / 65535, 1) * 65535
}
