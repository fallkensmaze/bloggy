/**
 * Pure two-dimensional geometry for the temporary shielding editor.
 * Scene points use metres; SVG's positive Y axis points downward. Calibration
 * points alone use native image pixels. These helpers do not calculate dose,
 * transmission, clinical workload defaults, or three-dimensional beam coverage.
 */

// Mathematical rounding tolerances, not physical accuracy or regulatory limits.
const COORDINATE_EPSILON = 1e-9
const ANGLE_EPSILON_DEG = 1e-9
const PERCENT_EPSILON = 1e-6

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)
const isPoint = point => point != null && isFiniteNumber(point.x) && isFiniteNumber(point.y)
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a, b) => a.x * b.x + a.y * b.y
const cross = (a, b) => a.x * b.y - a.y * b.x
const atFraction = (start, delta, fraction) => ({
  x: start.x + delta.x * fraction,
  y: start.y + delta.y * fraction,
})

function assertPoint(point) {
  if (!isPoint(point)) throw new Error('El punto necesita coordenadas numéricas finitas.')
}

export function distanceMeters(a, b) {
  assertPoint(a)
  assertPoint(b)
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function createCalibration(pixelA, pixelB, realLengthM) {
  if (!isFiniteNumber(realLengthM) || realLengthM <= 0) {
    throw new Error('Introduce una distancia real positiva en metros.')
  }
  const pixelDistance = distanceMeters(pixelA, pixelB)
  if (pixelDistance <= COORDINATE_EPSILON) {
    throw new Error('Marca dos puntos distintos para calibrar el plano.')
  }
  const metersPerPixel = realLengthM / pixelDistance
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    throw new Error('La calibración no produce una escala finita y positiva.')
  }
  return { metersPerPixel, pixelDistance, realLengthM }
}

function calibrationScale(calibration) {
  if (!isFiniteNumber(calibration?.metersPerPixel) || calibration.metersPerPixel <= 0) {
    throw new Error('Hace falta una calibración válida del plano.')
  }
  return calibration.metersPerPixel
}

// Calibration scales the image relative to its native upper-left origin. Zoom,
// pan and any display transform belong to the UI and never alter this scale.
export function pixelToMeters(point, calibration) {
  assertPoint(point)
  const scale = calibrationScale(calibration)
  return { x: point.x * scale, y: point.y * scale }
}

export function metersToPixel(point, calibration) {
  assertPoint(point)
  const scale = calibrationScale(calibration)
  return { x: point.x / scale, y: point.y / scale }
}

/**
 * Classify ONLY the plan projection of an explicitly specified cone. target is
 * a direction marker, not an absorbing endpoint: the cone extends past it.
 * Full aperture must be provided and be between 0 and 180 degrees. A wall never
 * removes exposure; attenuation is a separate calculation. 'outside' can only
 * be returned with complete geometry. 'unknown' must not become a numeric zero.
 */
export function classifyPrimary(point, configuration) {
  const unknown = reason => ({ status: 'unknown', reason })
  if (!isPoint(point)) return unknown('Falta la posición del punto de cálculo.')
  if (!isPoint(configuration?.source)) return unknown('Falta la posición del foco.')
  if (!isPoint(configuration?.target)) return unknown('Falta la dirección del haz.')
  if (!isFiniteNumber(configuration.apertureDeg)
    || configuration.apertureDeg <= 0 || configuration.apertureDeg >= 180) {
    return unknown('Define la apertura completa del haz entre 0 y 180 grados.')
  }
  const direction = subtract(configuration.target, configuration.source)
  const toPoint = subtract(point, configuration.source)
  const directionLengthM = Math.hypot(direction.x, direction.y)
  const distanceM = Math.hypot(toPoint.x, toPoint.y)
  if (!Number.isFinite(directionLengthM) || !Number.isFinite(distanceM)) {
    return unknown('Las coordenadas exceden el rango numérico del editor.')
  }
  if (directionLengthM <= COORDINATE_EPSILON) return unknown('La dirección debe alejarse del foco.')
  if (distanceM <= COORDINATE_EPSILON) return unknown('El punto coincide con el foco.')
  const directionUnit = { x: direction.x / directionLengthM, y: direction.y / directionLengthM }
  const toPointUnit = { x: toPoint.x / distanceM, y: toPoint.y / distanceM }
  const angleDeg = Math.atan2(Math.abs(cross(directionUnit, toPointUnit)), dot(directionUnit, toPointUnit)) * 180 / Math.PI
  const inside = angleDeg <= configuration.apertureDeg / 2 + ANGLE_EPSILON_DEG
  return {
    status: inside ? 'inside' : 'outside',
    reason: inside ? 'Dentro de la proyección del haz en planta.' : 'Fuera de la proyección del haz en planta.',
    angleDeg,
    distanceM,
  }
}

/** Validate declared workload shares without normalizing or editing them. */
export function validateWorkloadDistribution(configurations) {
  const errors = []
  if (!Array.isArray(configurations) || configurations.length === 0) {
    return { valid: false, totalPercent: 0, errors: ['Añade al menos una orientación de trabajo.'] }
  }
  let totalPercent = 0
  let complete = true
  configurations.forEach((configuration, index) => {
    const usePercent = configuration?.usePercent
    if (!isFiniteNumber(usePercent) || usePercent < 0 || usePercent > 100) {
      complete = false
      errors.push(`La orientación ${index + 1} necesita un porcentaje entre 0 y 100.`)
    } else {
      totalPercent += usePercent
    }
  })
  if (complete && Math.abs(totalPercent - 100) > PERCENT_EPSILON) {
    errors.push('El reparto de la carga de trabajo debe sumar el 100 %.')
  }
  return { valid: errors.length === 0, totalPercent, errors }
}

export function closestPointOnSegment(point, start, end) {
  assertPoint(point)
  assertPoint(start)
  assertPoint(end)
  const delta = subtract(end, start)
  const lengthSquared = dot(delta, delta)
  const t = lengthSquared <= COORDINATE_EPSILON ** 2
    ? 0 : clamp(dot(subtract(point, start), delta) / lengthSquared, 0, 1)
  const projected = atFraction(start, delta, t)
  return { point: projected, t, distanceM: distanceMeters(point, projected) }
}

/**
 * Closed segment intersection, including shared endpoints and collinear
 * overlaps. An overlap returns its first point along start->end and overlapEnd;
 * callers must keep the 'overlap' ambiguity rather than assume one wall crossing.
 */
export function segmentIntersection(start, end, a, b) {
  for (const point of [start, end, a, b]) assertPoint(point)
  const ray = subtract(end, start)
  const barrier = subtract(b, a)
  const rayLength = Math.hypot(ray.x, ray.y)
  const barrierLength = Math.hypot(barrier.x, barrier.y)
  if (rayLength <= COORDINATE_EPSILON || barrierLength <= COORDINATE_EPSILON) {
    throw new Error('Los segmentos necesitan una longitud mayor que cero.')
  }
  const offset = subtract(a, start)
  const denominator = cross(ray, barrier)
  // Scaled parallelism check avoids comparing a squared length to a length.
  if (Math.abs(denominator) <= Number.EPSILON * 16 * rayLength * barrierLength) {
    if (Math.abs(cross(offset, ray)) / rayLength > COORDINATE_EPSILON) return null
    const raySquared = dot(ray, ray)
    const t0 = dot(offset, ray) / raySquared
    const t1 = t0 + dot(barrier, ray) / raySquared
    const low = Math.max(0, Math.min(t0, t1))
    const high = Math.min(1, Math.max(t0, t1))
    const tTolerance = COORDINATE_EPSILON / rayLength
    if (high < low - tTolerance) return null
    const t = clamp(low, 0, 1)
    const point = atFraction(start, ray, t)
    const u = clamp(dot(subtract(point, a), barrier) / dot(barrier, barrier), 0, 1)
    if (high - low <= tTolerance) return { point, t, u, kind: 'touching' }
    return { point, t, u, kind: 'overlap', overlapEnd: atFraction(start, ray, clamp(high, 0, 1)) }
  }
  const rawT = cross(offset, barrier) / denominator
  const rawU = cross(offset, ray) / denominator
  const tTolerance = COORDINATE_EPSILON / rayLength
  const uTolerance = COORDINATE_EPSILON / barrierLength
  if (rawT < -tTolerance || rawT > 1 + tTolerance || rawU < -uTolerance || rawU > 1 + uTolerance) return null
  const t = clamp(rawT, 0, 1)
  const u = clamp(rawU, 0, 1)
  const touching = t <= tTolerance || t >= 1 - tTolerance || u <= uTolerance || u >= 1 - uTolerance
  return { point: atFraction(start, ray, t), t, u, kind: touching ? 'touching' : 'crossing' }
}

/**
 * Return every crossed barrier in source-to-point order. Endpoints, shared wall
 * vertices and overlapping barriers remain explicit. This is a drawing helper,
 * not material attenuation or a decision that a barrier blocks the primary beam.
 */
export function traceBarriers(source, point, barriers) {
  const distanceM = distanceMeters(source, point)
  if (distanceM <= COORDINATE_EPSILON) throw new Error('La trayectoria necesita una longitud mayor que cero.')
  if (!Array.isArray(barriers)) throw new Error('Hace falta una lista de barreras.')
  return barriers.flatMap(barrier => {
    const hit = segmentIntersection(source, point, barrier.start, barrier.end)
    return hit ? [{ ...hit, barrierId: barrier.id, distanceM: hit.t * distanceM }] : []
  }).sort((a, b) => a.t - b.t)
}

/** Simple polygon inclusion, with its boundary included. No polygon repair. */
export function pointInPolygon(point, polygon) {
  assertPoint(point)
  if (!Array.isArray(polygon) || polygon.length < 3) return false
  polygon.forEach(assertPoint)
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]
    const b = polygon[i]
    if (closestPointOnSegment(point, a, b).distanceM <= COORDINATE_EPSILON) return true
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function boundsOfPoints(points) {
  if (!Array.isArray(points)) throw new Error('Hace falta una lista de puntos.')
  if (points.length === 0) return null
  points.forEach(assertPoint)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}
