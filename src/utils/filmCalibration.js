import { validateLateralCorrection } from './filmLateralCorrection.js'

export const FILM_CALIBRATION_SCHEMA = 1
export const FILM_ALGORITHM_VERSION = '1.4.0'
export const CHANNELS = ['R', 'G', 'B']
export const RESPONSE_BASIS_NET_OD = 'netod'
export const RESPONSE_BASIS_INTENSITY = 'normalized-intensity'

const EPSILON = 1e-12

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function sigmoid(value) {
  if (value >= 0) {
    const e = Math.exp(-Math.min(value, 50))
    return 1 / (1 + e)
  }
  const e = Math.exp(Math.max(value, -50))
  return e / (1 + e)
}

function logit(value) {
  const p = clamp(value, 1e-8, 1 - 1e-8)
  return Math.log(p / (1 - p))
}

function thetaToParams(theta, direction = 'increasing') {
  const c = Math.exp(clamp(theta[2], -20, 25))
  const b = 1e-8 + (1 - 2e-8) * sigmoid(theta[1])
  const a = direction === 'decreasing'
    ? b * c * (1e-8 + (1 - 2e-8) * sigmoid(theta[0]))
    : b * c + Math.exp(clamp(theta[0], -20, 25))
  return { a, b, c }
}

export function calibrationNetOd(doseGy, params) {
  const dose = Number(doseGy)
  const numerator = params.a + params.b * dose
  const denominator = params.c + dose
  if (!(numerator > 0) || !(denominator > 0)) return NaN
  return -Math.log10(numerator / denominator)
}

export function calibrationSlope(doseGy, params) {
  const dose = Math.max(0, Number(doseGy))
  const numerator = params.a - params.b * params.c
  const denominator = Math.LN10 * (params.a + params.b * dose) * (params.c + dose)
  return numerator / denominator
}

export function invertCalibrationNetOd(netOd, params, range = [0, Infinity]) {
  const s = 10 ** (-Number(netOd))
  const denominator = params.b - s
  if (!Number.isFinite(s) || Math.abs(denominator) < EPSILON) return NaN
  const dose = (s * params.c - params.a) / denominator
  if (!Number.isFinite(dose)) return NaN
  return clamp(dose, range[0], range[1])
}

function centroid(simplex, count) {
  const output = new Array(simplex[0].x.length).fill(0)
  for (let index = 0; index < count; index++) {
    for (let axis = 0; axis < output.length; axis++) output[axis] += simplex[index].x[axis] / count
  }
  return output
}

function evaluatePoint(x, objective) {
  const value = objective(x)
  return { x, value: Number.isFinite(value) ? value : Number.MAX_VALUE }
}

function nelderMead(objective, initial, { step = 0.18, maxIterations = 1200, tolerance = 1e-14 } = {}) {
  const dimension = initial.length
  let simplex = [evaluatePoint([...initial], objective)]
  for (let axis = 0; axis < dimension; axis++) {
    const point = [...initial]
    point[axis] += step
    simplex.push(evaluatePoint(point, objective))
  }

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    simplex.sort((left, right) => left.value - right.value)
    const spread = Math.max(...simplex.map((point) => Math.abs(point.value - simplex[0].value)))
    if (spread < tolerance) break

    const center = centroid(simplex, dimension)
    const worst = simplex[dimension]
    const reflected = center.map((value, axis) => value + (value - worst.x[axis]))
    const reflectedPoint = evaluatePoint(reflected, objective)

    if (reflectedPoint.value < simplex[0].value) {
      const expanded = center.map((value, axis) => value + 2 * (reflected[axis] - value))
      const expandedPoint = evaluatePoint(expanded, objective)
      simplex[dimension] = expandedPoint.value < reflectedPoint.value ? expandedPoint : reflectedPoint
      continue
    }
    if (reflectedPoint.value < simplex[dimension - 1].value) {
      simplex[dimension] = reflectedPoint
      continue
    }

    const outside = reflectedPoint.value < worst.value
    const contracted = center.map((value, axis) =>
      outside ? value + 0.5 * (reflected[axis] - value) : value + 0.5 * (worst.x[axis] - value)
    )
    const contractedPoint = evaluatePoint(contracted, objective)
    if (contractedPoint.value < (outside ? reflectedPoint.value : worst.value)) {
      simplex[dimension] = contractedPoint
      continue
    }

    const best = simplex[0].x
    simplex = [simplex[0], ...simplex.slice(1).map((point) =>
      evaluatePoint(point.x.map((value, axis) => best[axis] + 0.5 * (value - best[axis])), objective)
    )]
  }

  simplex.sort((left, right) => left.value - right.value)
  return simplex[0]
}

export function fitCalibrationCurve(dosesGy, responseValues, { direction = 'increasing' } = {}) {
  if (dosesGy.length !== responseValues.length || dosesGy.length < 4) {
    throw new Error('Se necesitan al menos cuatro puntos para ajustar la curva.')
  }
  const pairs = dosesGy
    .map((dose, index) => ({ dose: Number(dose), value: Number(responseValues[index]) }))
    .filter((point) => Number.isFinite(point.dose) && Number.isFinite(point.value))
    .sort((left, right) => left.dose - right.dose)
  if (pairs.length < 4) throw new Error('No hay suficientes puntos numéricos para el ajuste.')

  const maximumDose = Math.max(...pairs.map((point) => point.dose), 0.01)
  const maximumResponse = Math.max(...pairs.map((point) => point.value), 0.01)
  const minimumResponse = Math.min(...pairs.map((point) => point.value))
  const asymptote = direction === 'decreasing'
    ? clamp(10 ** (-minimumResponse * 0.8), 1e-5, 0.99999)
    : clamp(10 ** (-maximumResponse) * 0.65, 1e-5, 0.95)
  const objective = (theta) => {
    const params = thetaToParams(theta, direction)
    let sum = 0
    for (const point of pairs) {
      const predicted = calibrationNetOd(point.dose, params)
      if (!Number.isFinite(predicted)) return Number.MAX_VALUE
      const residual = predicted - point.value
      sum += residual * residual
      if (predicted < -0.002) sum += predicted * predicted * 100
    }
    return sum
  }

  let best = null
  for (const scale of [0.08, 0.2, 0.5, 1, 2, 5]) {
    const c = maximumDose * scale
    const initial = direction === 'decreasing'
      ? [
          logit(clamp(10 ** (-maximumResponse) / asymptote, 1e-6, 1 - 1e-6)),
          logit(asymptote),
          Math.log(c)
        ]
      : [
          Math.log(Math.max(EPSILON, c - asymptote * c)),
          logit(asymptote),
          Math.log(c)
        ]
    const candidate = nelderMead(objective, initial)
    if (!best || candidate.value < best.value) best = candidate
  }

  const params = thetaToParams(best.x, direction)
  const predictions = pairs.map((point) => calibrationNetOd(point.dose, params))
  const residuals = pairs.map((point, index) => point.value - predictions[index])
  const mean = pairs.reduce((sum, point) => sum + point.value, 0) / pairs.length
  const sumSquares = residuals.reduce((sum, value) => sum + value * value, 0)
  const totalSquares = pairs.reduce((sum, point) => sum + (point.value - mean) ** 2, 0)

  return {
    params,
    direction,
    rmseResponse: Math.sqrt(sumSquares / pairs.length),
    rmseNetOd: Math.sqrt(sumSquares / pairs.length),
    r2: totalSquares > 0 ? 1 - sumSquares / totalSquares : 1,
    monotonic: direction === 'decreasing' ? params.a < params.b * params.c : params.a > params.b * params.c,
    residuals,
    predictions
  }
}

function pooledCovariance(points, responseKey) {
  const sum = Array.from({ length: 3 }, () => [0, 0, 0])
  let degrees = 0
  for (const point of points) {
    const covariance = point.summary?.[responseKey]?.covariance
    const count = Number(point.summary?.[responseKey]?.count || 0)
    if (!covariance || count < 2) continue
    const weight = count - 1
    degrees += weight
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) sum[row][column] += covariance[row][column] * weight
    }
  }
  if (!degrees) return [[1e-6, 0, 0], [0, 1e-6, 0], [0, 0, 1e-6]]
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) sum[row][column] /= degrees
  }
  const trace = sum[0][0] + sum[1][1] + sum[2][2]
  const regularization = Math.max(1e-10, trace * 1e-5 / 3)
  for (let index = 0; index < 3; index++) sum[index][index] += regularization
  return sum
}

export function invert3x3(matrix) {
  const [a, b, c] = matrix[0]
  const [d, e, f] = matrix[1]
  const [g, h, i] = matrix[2]
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const D = -(b * i - c * h)
  const E = a * i - c * g
  const F = -(a * h - b * g)
  const G = b * f - c * e
  const H = -(a * f - c * d)
  const I = a * e - b * d
  const determinant = a * A + b * B + c * C
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-24) {
    throw new Error('La covarianza RGB es singular incluso después de regularizarla.')
  }
  return {
    determinant,
    inverse: [[A, D, G], [B, E, H], [C, F, I]].map((row) => row.map((value) => value / determinant))
  }
}

function weightedReference(points) {
  const total = points.reduce((sum, point) => sum + Number(point.summary?.baseline?.count || 0), 0)
  if (!total) throw new Error('Los puntos no contienen una referencia sin irradiar válida.')
  const mean = [0, 0, 0]
  for (const point of points) {
    const weight = Number(point.summary.baseline.count || 0)
    for (let channel = 0; channel < 3; channel++) mean[channel] += point.summary.baseline.mean[channel] * weight / total
  }
  return mean
}

function doseErrors(points, fits, doseRange, responseKey) {
  return points.map((point) => {
    const reconstructed = CHANNELS.map((_, channel) =>
      invertCalibrationNetOd(point.summary[responseKey].mean[channel], fits[channel].params, doseRange)
    )
    return {
      doseGy: point.doseGy,
      reconstructedGy: reconstructed,
      errorsGy: reconstructed.map((value) => value - point.doseGy)
    }
  })
}

export function buildFilmCalibration({ name, metadata = {}, points, roi, lateralCorrection = null }) {
  if (!lateralCorrection) {
    throw new Error('La calibración necesita una corrección lateral obtenida con tiras uniformes que atraviesen el centro del escaneo.')
  }
  validateLateralCorrection(lateralCorrection)
  const responseBasis = metadata.responseBasis === RESPONSE_BASIS_INTENSITY
    ? RESPONSE_BASIS_INTENSITY
    : RESPONSE_BASIS_NET_OD
  const responseKey = responseBasis === RESPONSE_BASIS_INTENSITY ? 'response' : 'netOd'
  const responseDirection = responseBasis === RESPONSE_BASIS_INTENSITY ? 'decreasing' : 'increasing'
  const validPoints = (points || [])
    .filter((point) => Number(point.doseGy) > 0 && point.summary?.[responseKey]?.mean?.length === 3)
    .map((point) => ({ ...point, doseGy: Number(point.doseGy) }))
    .sort((left, right) => left.doseGy - right.doseGy)
  const uniqueDoses = new Set(validPoints.map((point) => point.doseGy))
  if (uniqueDoses.size < 4) throw new Error('La calibración necesita al menos cuatro dosis positivas diferentes.')

  const fitDoses = responseBasis === RESPONSE_BASIS_NET_OD
    ? [0, ...validPoints.map((point) => point.doseGy)]
    : validPoints.map((point) => point.doseGy)
  const fits = CHANNELS.map((_, channel) => fitCalibrationCurve(
    fitDoses,
    responseBasis === RESPONSE_BASIS_NET_OD
      ? [0, ...validPoints.map((point) => point.summary[responseKey].mean[channel])]
      : validPoints.map((point) => point.summary[responseKey].mean[channel]),
    { direction: responseDirection }
  ))
  if (fits.some((fit) => !fit.monotonic)) throw new Error('Alguna curva ajustada no es monótona.')

  const doseRange = [
    responseBasis === RESPONSE_BASIS_NET_OD ? 0 : Math.min(...validPoints.map((point) => point.doseGy)),
    Math.max(...validPoints.map((point) => point.doseGy))
  ]
  const covariance = pooledCovariance(validPoints, responseKey)
  const { inverse, determinant } = invert3x3(covariance)
  const errors = doseErrors(validPoints, fits, doseRange, responseKey)
  const doseRmse = CHANNELS.map((_, channel) => Math.sqrt(
    errors.reduce((sum, point) => sum + point.errorsGy[channel] ** 2, 0) / errors.length
  ))
  const now = new Date().toISOString()

  return {
    schemaVersion: FILM_CALIBRATION_SCHEMA,
    algorithmVersion: FILM_ALGORITHM_VERSION,
    id: globalThis.crypto?.randomUUID?.() || `film-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: String(name || '').trim() || `Calibración ${now.slice(0, 10)}`,
    createdAt: now,
    updatedAt: now,
    metadata,
    roi,
    lateralCorrection,
    responseBasis,
    responseDirection,
    doseRangeGy: doseRange,
    referenceRgb: responseBasis === RESPONSE_BASIS_NET_OD ? weightedReference(validPoints) : null,
    points: validPoints,
    fits,
    covariance,
    covarianceInverse: inverse,
    covarianceDeterminant: determinant,
    sigmaResponse: covariance.map((row, index) => Math.sqrt(Math.max(EPSILON, row[index]))),
    sigmaNetOd: responseBasis === RESPONSE_BASIS_NET_OD
      ? covariance.map((row, index) => Math.sqrt(Math.max(EPSILON, row[index])))
      : null,
    validation: {
      doseRmseGy: doseRmse,
      points: errors,
      valid: fits.every((fit) => fit.r2 >= 0.98) && doseRmse.every(Number.isFinite),
      warnings: fits.flatMap((fit, channel) => fit.r2 < 0.98 ? [`Canal ${CHANNELS[channel]}: R²=${fit.r2.toFixed(4)}.`] : [])
    }
  }
}

export function validateCalibrationRecord(calibration) {
  if (!calibration || calibration.schemaVersion !== FILM_CALIBRATION_SCHEMA) {
    throw new Error('Formato de calibración desconocido o incompatible.')
  }
  if (!String(calibration.id || '').trim() || !String(calibration.name || '').trim()) {
    throw new Error('La calibración no contiene identificador y nombre válidos.')
  }
  if (!Array.isArray(calibration.fits) || calibration.fits.length !== 3) {
    throw new Error('La calibración no contiene las tres curvas RGB.')
  }
  const responseBasis = calibration.responseBasis || RESPONSE_BASIS_NET_OD
  const expectedDirection = responseBasis === RESPONSE_BASIS_INTENSITY ? 'decreasing' : 'increasing'
  const responseDirection = calibration.responseDirection || expectedDirection
  if (![RESPONSE_BASIS_NET_OD, RESPONSE_BASIS_INTENSITY].includes(responseBasis)) {
    throw new Error('La base de respuesta de la calibración no es compatible.')
  }
  if (responseDirection !== expectedDirection) {
    throw new Error('La dirección de las curvas no coincide con la base de respuesta.')
  }
  for (const fit of calibration.fits) {
    const params = fit?.params
    if (!params || !['a', 'b', 'c'].every((key) => Number.isFinite(params[key]) && params[key] > 0) ||
        !(responseDirection === 'decreasing' ? params.a < params.b * params.c : params.a > params.b * params.c)) {
      throw new Error('La calibración contiene una curva RGB no válida o no monótona.')
    }
  }
  if (responseBasis === RESPONSE_BASIS_NET_OD && (!Array.isArray(calibration.referenceRgb) || calibration.referenceRgb.length !== 3)) {
    throw new Error('La calibración no contiene una referencia RGB válida.')
  }
  if (responseBasis === RESPONSE_BASIS_NET_OD && calibration.referenceRgb.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('La referencia RGB de la calibración no es numérica o positiva.')
  }
  if (!Array.isArray(calibration.doseRangeGy) || calibration.doseRangeGy.length !== 2 ||
      !calibration.doseRangeGy.every(Number.isFinite) || calibration.doseRangeGy[0] < 0 ||
      calibration.doseRangeGy[1] <= calibration.doseRangeGy[0]) {
    throw new Error('El rango de dosis de la calibración no es válido.')
  }
  const sigmaResponse = calibration.sigmaResponse || calibration.sigmaNetOd
  if (!Array.isArray(sigmaResponse) || sigmaResponse.length !== 3 ||
      sigmaResponse.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('La calibración no contiene incertidumbres RGB válidas.')
  }
  if (!Array.isArray(calibration.covariance) || calibration.covariance.length !== 3 ||
      calibration.covariance.some((row) => !Array.isArray(row) || row.length !== 3 || row.some((value) => !Number.isFinite(value)))) {
    throw new Error('La matriz de covarianza RGB no es válida.')
  }
  if (!Array.isArray(calibration.validation?.doseRmseGy) || calibration.validation.doseRmseGy.length !== 3) {
    throw new Error('La calibración no contiene métricas de validación compatibles.')
  }
  if (calibration.lateralCorrection) validateLateralCorrection(calibration.lateralCorrection)
  invert3x3(calibration.covariance)
  return calibration
}
