import {
  calibrationNetOd,
  calibrationSlope,
  invertCalibrationNetOd,
  RESPONSE_BASIS_INTENSITY,
  validateCalibrationRecord
} from './filmCalibration.js'

export const FILM_ANALYSIS_METHODS = [
  { id: 'multichannel', label: 'Multicanal con perturbación común' },
  { id: 'weighted-rgb', label: 'RGB ponderado' },
  { id: 'red', label: 'Canal rojo' },
  { id: 'green', label: 'Canal verde' },
  { id: 'blue', label: 'Canal azul' }
]

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function quadratic(vector, matrix) {
  let sum = 0
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) sum += vector[row] * matrix[row][column] * vector[column]
  }
  return sum
}

function matrixVector(matrix, vector) {
  return matrix.map((row) => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2])
}

function commonPerturbationObjective(netOd, dose, calibration) {
  const mean = calibration.fits.map((fit) => calibrationNetOd(dose, fit.params))
  const residual = netOd.map((value, channel) => value - mean[channel])
  const inverse = calibration.covarianceInverse
  const qResidual = matrixVector(inverse, residual)
  const ones = [1, 1, 1]
  const qOnes = matrixVector(inverse, ones)
  const denominator = qOnes[0] + qOnes[1] + qOnes[2]
  const delta = denominator > 1e-20
    ? (qResidual[0] + qResidual[1] + qResidual[2]) / denominator
    : 0
  const corrected = residual.map((value) => value - delta)
  return { value: 0.5 * quadratic(corrected, inverse), delta }
}

function goldenMinimum(fn, lower, upper, iterations = 20) {
  if (!(upper > lower)) return { x: lower, ...fn(lower) }
  const ratio = (Math.sqrt(5) - 1) / 2
  let left = lower
  let right = upper
  let x1 = right - ratio * (right - left)
  let x2 = left + ratio * (right - left)
  let f1 = fn(x1)
  let f2 = fn(x2)
  for (let iteration = 0; iteration < iterations; iteration++) {
    if (f1.value <= f2.value) {
      right = x2
      x2 = x1
      f2 = f1
      x1 = right - ratio * (right - left)
      f1 = fn(x1)
    } else {
      left = x1
      x1 = x2
      f1 = f2
      x2 = left + ratio * (right - left)
      f2 = fn(x2)
    }
  }
  return f1.value <= f2.value ? { x: x1, ...f1 } : { x: x2, ...f2 }
}

function channelDose(netOd, channel, calibration) {
  return invertCalibrationNetOd(
    netOd[channel],
    calibration.fits[channel].params,
    calibration.doseRangeGy
  )
}

function weightedDose(netOd, calibration) {
  let numerator = 0
  let denominator = 0
  const sigmaResponse = calibration.sigmaResponse || calibration.sigmaNetOd
  for (let channel = 0; channel < 3; channel++) {
    const dose = channelDose(netOd, channel, calibration)
    if (!Number.isFinite(dose)) continue
    const slope = Math.abs(calibrationSlope(dose, calibration.fits[channel].params))
    const sigma = Math.max(1e-8, sigmaResponse[channel])
    const weight = (slope * slope) / (sigma * sigma)
    if (!Number.isFinite(weight) || weight <= 0) continue
    numerator += dose * weight
    denominator += weight
  }
  return denominator > 0
    ? { dose: numerator / denominator, sigma: 1 / Math.sqrt(denominator) }
    : { dose: NaN, sigma: NaN }
}

function multichannelDose(netOd, calibration) {
  const [minimum, maximum] = calibration.doseRangeGy
  const weighted = weightedDose(netOd, calibration)
  const seed = Number.isFinite(weighted.dose) ? weighted.dose : (minimum + maximum) / 2
  const span = Math.max((maximum - minimum) * 0.22, 0.05)
  let lower = Math.max(minimum, seed - span)
  let upper = Math.min(maximum, seed + span)
  const objective = (dose) => commonPerturbationObjective(netOd, dose, calibration)
  let optimum = goldenMinimum(objective, lower, upper, 18)

  const edgeTolerance = Math.max(1e-5, (upper - lower) * 0.015)
  if ((optimum.x - lower < edgeTolerance && lower > minimum) ||
      (upper - optimum.x < edgeTolerance && upper < maximum)) {
    lower = minimum
    upper = maximum
    optimum = goldenMinimum(objective, lower, upper, 22)
  }

  const step = Math.max(1e-4, (maximum - minimum) / 1200)
  const lo = Math.max(minimum, optimum.x - step)
  const hi = Math.min(maximum, optimum.x + step)
  const center = optimum.value
  const curvature = lo < optimum.x && hi > optimum.x
    ? (objective(lo).value - 2 * center + objective(hi).value) / (((hi - lo) / 2) ** 2)
    : NaN
  const sigma = Number.isFinite(curvature) && curvature > 1e-12 ? 1 / Math.sqrt(curvature) : NaN
  return { dose: optimum.x, sigma, delta: optimum.delta }
}

function pixelReference(reference, referenceRgb, pixelIndex) {
  if (reference?.data) {
    const start = pixelIndex * 3
    return [reference.data[start], reference.data[start + 1], reference.data[start + 2]]
  }
  return referenceRgb
}

function summarize(values, invalid) {
  let count = 0
  let sum = 0
  let sumSquares = 0
  let minimum = Infinity
  let maximum = -Infinity
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (invalid[index] || !Number.isFinite(value)) continue
    count++
    sum += value
    sumSquares += value * value
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  const mean = count ? sum / count : NaN
  return {
    count,
    meanGy: mean,
    stdGy: count ? Math.sqrt(Math.max(0, sumSquares / count - mean * mean)) : NaN,
    minGy: count ? minimum : NaN,
    maxGy: count ? maximum : NaN
  }
}

export function analyzeFilmImage({ measurement, reference = null, calibration, method = 'multichannel', onProgress }) {
  validateCalibrationRecord(calibration)
  if (!measurement?.data || !measurement.width || !measurement.height) throw new Error('Imagen de medida no válida.')
  const intensityBasis = calibration.responseBasis === RESPONSE_BASIS_INTENSITY
  if (!intensityBasis && reference?.data && (reference.width !== measurement.width || reference.height !== measurement.height)) {
    throw new Error('La referencia sin irradiar no tiene las mismas dimensiones que la medida.')
  }
  if (!FILM_ANALYSIS_METHODS.some((entry) => entry.id === method)) throw new Error(`Método desconocido: ${method}.`)

  const pixels = measurement.width * measurement.height
  const dose = new Float32Array(pixels)
  const sigma = new Float32Array(pixels)
  const delta = new Float32Array(pixels)
  const outOfRange = new Uint8Array(pixels)
  const saturated = new Uint8Array(pixels)
  const invalid = new Uint8Array(pixels)
  const range = calibration.doseRangeGy
  const sigmaResponse = calibration.sigmaResponse || calibration.sigmaNetOd
  const responseBounds = calibration.fits.map((fit) => {
    const first = calibrationNetOd(range[0], fit.params)
    const last = calibrationNetOd(range[1], fit.params)
    return [Math.min(first, last), Math.max(first, last)]
  })
  const progressStep = Math.max(1, Math.floor(pixels / 100))

  for (let pixel = 0; pixel < pixels; pixel++) {
    const start = pixel * 3
    const measured = [measurement.data[start], measurement.data[start + 1], measurement.data[start + 2]]
    const i0 = intensityBasis ? null : pixelReference(reference, calibration.referenceRgb, pixel)
    if (measured.some((value) => value <= 1 || value >= 65534) || i0?.some((value) => value <= 1 || value >= 65534)) {
      saturated[pixel] = 1
    }
    const response = intensityBasis
      ? measured.map((value) => value / 65535)
      : measured.map((value, channel) => Math.log10(Math.max(1, i0[channel]) / Math.max(1, value)))
    if (response.some((value) => !Number.isFinite(value))) {
      invalid[pixel] = 1
      dose[pixel] = NaN
      sigma[pixel] = NaN
      continue
    }
    outOfRange[pixel] = response.some((value, channel) =>
      value < responseBounds[channel][0] - 3 * sigmaResponse[channel] ||
      value > responseBounds[channel][1] + 3 * sigmaResponse[channel]
    ) ? 1 : 0

    let result
    if (method === 'multichannel') result = multichannelDose(response, calibration)
    else if (method === 'weighted-rgb') result = weightedDose(response, calibration)
    else {
      const channel = method === 'red' ? 0 : method === 'green' ? 1 : 2
      const value = channelDose(response, channel, calibration)
      const slope = Math.abs(calibrationSlope(value, calibration.fits[channel].params))
      result = {
        dose: value,
        sigma: slope > 0 ? sigmaResponse[channel] / slope : NaN,
        delta: 0
      }
    }

    if (!Number.isFinite(result.dose)) {
      invalid[pixel] = 1
      dose[pixel] = NaN
      sigma[pixel] = NaN
    } else {
      dose[pixel] = clamp(result.dose, range[0], range[1])
      sigma[pixel] = Number.isFinite(result.sigma) ? result.sigma : NaN
      delta[pixel] = Number.isFinite(result.delta) ? result.delta : 0
    }
    if (onProgress && pixel % progressStep === 0) onProgress(pixel / pixels)
  }
  onProgress?.(1)

  return {
    width: measurement.width,
    height: measurement.height,
    pixelSpacingMm: measurement.pixelSpacingMm,
    method,
    dose,
    sigma,
    delta,
    outOfRange,
    saturated,
    invalid,
    statistics: summarize(dose, invalid),
    calibrationId: calibration.id,
    calibrationName: calibration.name,
    calibrationVersion: calibration.algorithmVersion,
    responseBasis: calibration.responseBasis || 'netod',
    createdAt: new Date().toISOString()
  }
}

function qcEstimate(response, calibration, method) {
  if (method === 'multichannel') return multichannelDose(response, calibration).dose
  if (method === 'weighted-rgb') return weightedDose(response, calibration).dose
  return channelDose(response, ['red', 'green', 'blue'].indexOf(method), calibration)
}

/**
 * Reconstruye los puntos que originaron la curva a partir de la respuesta media
 * medida en sus TIFF. Es una autoverificación del ajuste, no una validación con
 * datos independientes.
 */
export function verifyCalibrationPoints(calibration) {
  validateCalibrationRecord(calibration)
  const responseKey = calibration.responseBasis === RESPONSE_BASIS_INTENSITY ? 'response' : 'netOd'
  const methods = ['multichannel', 'weighted-rgb', 'red', 'green', 'blue']
  const points = (calibration.points || []).map((point) => {
    const expectedGy = Number(point.doseGy)
    const response = point.summary?.[responseKey]?.mean
    if (!Array.isArray(response) || response.length !== 3) {
      throw new Error(`El punto de ${expectedGy} Gy no conserva una respuesta RGB válida.`)
    }
    const estimatesGy = Object.fromEntries(methods.map((method) => [method, qcEstimate(response, calibration, method)]))
    const deviationsGy = Object.fromEntries(methods.map((method) => [method, estimatesGy[method] - expectedGy]))
    const deviationsPercent = Object.fromEntries(methods.map((method) => [
      method,
      expectedGy > 0 ? deviationsGy[method] / expectedGy * 100 : NaN
    ]))
    return { pointId: point.id, expectedGy, estimatesGy, deviationsGy, deviationsPercent }
  })

  const summary = Object.fromEntries(methods.map((method) => {
    const errors = points.map((point) => point.deviationsGy[method]).filter(Number.isFinite)
    const percentErrors = points.map((point) => point.deviationsPercent[method]).filter(Number.isFinite)
    return [method, {
      biasGy: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : NaN,
      rmseGy: errors.length ? Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length) : NaN,
      maximumAbsoluteGy: errors.length ? Math.max(...errors.map(Math.abs)) : NaN,
      maximumAbsolutePercent: percentErrors.length ? Math.max(...percentErrors.map(Math.abs)) : NaN
    }]
  }))

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    source: 'calibration-images',
    independent: false,
    methods,
    points,
    summary
  }
}
