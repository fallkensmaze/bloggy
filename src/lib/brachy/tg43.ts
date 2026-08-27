// Formalismo TG-43 para la fuente GammaMed Plus HDR (GMPir HDR 2012).

import type { BrachyPlan, SourcePosition, Vector3 } from './types'
import {
  anisotropyAnglesDeg,
  anisotropyMatrix,
  anisotropyRadii,
  radialDoseData
} from './sourceData'

const EPS = 1e-10

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function magnitude(v: Vector3): number {
  return Math.sqrt(dot(v, v))
}

function normalize(v?: Vector3): Vector3 {
  if (!v) return [0, 0, 1]
  const norm = magnitude(v)
  if (norm < EPS) return [0, 0, 1]
  return [v[0] / norm, v[1] / norm, v[2] / norm]
}

function linearInterpolate(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (Math.abs(x2 - x1) < EPS) return y1
  return y1 + ((x - x1) * (y2 - y1)) / (x2 - x1)
}

function lowerBracket(values: readonly number[], value: number): number {
  if (value <= values[0]) return 0
  for (let i = 0; i < values.length - 1; i += 1) {
    if (value <= values[i + 1]) return i
  }
  return values.length - 2
}

// TG-43U1S1/HEBD: orden cero por debajo de rmin, interpolación log-lineal
// dentro de la tabla y extrapolación exponencial ajustada a los tres últimos radios.
export function interpolateRadialDose(r: number): number {
  const positiveData = radialDoseData.filter(point => point.r >= 0.2)
  const first = positiveData[0]
  const last = positiveData[positiveData.length - 1]

  if (!Number.isFinite(r) || r <= first.r) return first.gL

  if (r <= last.r) {
    const index = lowerBracket(positiveData.map(point => point.r), r)
    const p1 = positiveData[index]
    const p2 = positiveData[index + 1]
    const logG = linearInterpolate(r, p1.r, Math.log(p1.gL), p2.r, Math.log(p2.gL))
    return Math.exp(logG)
  }

  const fit = positiveData.slice(-3)
  const meanR = fit.reduce((sum, point) => sum + point.r, 0) / fit.length
  const meanLogG = fit.reduce((sum, point) => sum + Math.log(point.gL), 0) / fit.length
  const numerator = fit.reduce(
    (sum, point) => sum + (point.r - meanR) * (Math.log(point.gL) - meanLogG),
    0
  )
  const denominator = fit.reduce((sum, point) => sum + (point.r - meanR) ** 2, 0)
  const slope = numerator / denominator
  return Math.exp(meanLogG + slope * (r - meanR))
}

// Bilineal dentro de la tabla; vecino más próximo (orden cero) fuera de rmin/rmax.
export function interpolateAnisotropy(r: number, theta: number): number {
  const radius = clamp(r, anisotropyRadii[0], anisotropyRadii[anisotropyRadii.length - 1])
  const thetaDeg = clamp(theta * 180 / Math.PI, 0, 180)

  const rIndex = lowerBracket(anisotropyRadii, radius)
  const thetaIndex = lowerBracket(anisotropyAnglesDeg, thetaDeg)
  const r1 = anisotropyRadii[rIndex]
  const r2 = anisotropyRadii[rIndex + 1]
  const t1 = anisotropyAnglesDeg[thetaIndex]
  const t2 = anisotropyAnglesDeg[thetaIndex + 1]

  const f11 = anisotropyMatrix[thetaIndex][rIndex]
  const f12 = anisotropyMatrix[thetaIndex][rIndex + 1]
  const f21 = anisotropyMatrix[thetaIndex + 1][rIndex]
  const f22 = anisotropyMatrix[thetaIndex + 1][rIndex + 1]
  const atT1 = linearInterpolate(radius, r1, f11, r2, f12)
  const atT2 = linearInterpolate(radius, r1, f21, r2, f22)

  return linearInterpolate(thetaDeg, t1, atT1, t2, atT2)
}

function sourceCoordinates(source: SourcePosition, point: { x: number; y: number; z: number }) {
  const displacement: Vector3 = [point.x - source.x, point.y - source.y, point.z - source.z]
  const orientation = normalize(source.orientation)
  const r = magnitude(displacement)
  const axial = dot(displacement, orientation)
  const transverse = Math.sqrt(Math.max(0, r * r - axial * axial))
  const theta = r > EPS ? Math.acos(clamp(axial / r, -1, 1)) : 0
  return { r, axial, transverse, theta }
}

// G_L(r,theta) / G_L(r0=1 cm, theta0=90º), con eje arbitrario de la fuente.
export function getGeometryFunction(
  source: SourcePosition,
  point: { x: number; y: number; z: number }
): number {
  const { axial, transverse } = sourceCoordinates(source, point)
  const halfLength = source.L / 2
  const betaRef = 2 * Math.atan(source.L / 2)
  const geometryRef = betaRef / source.L

  let geometry: number
  if (transverse < EPS) {
    geometry = 1 / Math.abs(axial * axial - halfLength * halfLength)
  } else {
    const beta = Math.atan2(axial + halfLength, transverse) -
      Math.atan2(axial - halfLength, transverse)
    geometry = Math.abs(beta) / (source.L * transverse)
  }

  return geometry / geometryRef
}

export function calculateDoseFromSource(
  source: SourcePosition,
  point: { x: number; y: number; z: number }
): number {
  const { r, theta } = sourceCoordinates(source, point)
  if (r < EPS) return Number.POSITIVE_INFINITY

  const geometry = getGeometryFunction(source, point)
  const radialDose = interpolateRadialDose(r)
  const anisotropy = interpolateAnisotropy(r, theta)
  const dwellHours = source.dwellTime / 3600

  return source.Sk * source.doseRateConstant * geometry * radialDose * anisotropy * dwellHours
}

export function calculateTotalDose(
  sources: SourcePosition[],
  point: { x: number; y: number; z: number }
): number {
  const doseCgy = sources.reduce((sum, source) => sum + calculateDoseFromSource(source, point), 0)
  return doseCgy / 100
}

export function calculateDecayFactor(initialDate: Date, treatmentDate: Date, halfLife: number): number {
  const daysDiff = (treatmentDate.getTime() - initialDate.getTime()) / 86_400_000
  return Math.pow(2, -daysDiff / halfLife)
}

export function calculateCurrentActivity(
  initialActivity: number,
  initialDate: Date,
  currentDate: Date,
  halfLife: number
): number {
  return initialActivity * calculateDecayFactor(initialDate, currentDate, halfLife)
}

export function makeSourceTrain(
  dwells: { coords: Vector3; dwellTime: number; orientation?: Vector3 }[],
  refAirKermaRate: number,
  doseRateConstant: number,
  activeLength: number,
  halfLife: number,
  timeMultiplier = 1
): SourcePosition[] {
  return dwells.map(dwell => ({
    x: dwell.coords[0] / 10,
    y: dwell.coords[1] / 10,
    z: dwell.coords[2] / 10,
    orientation: normalize(dwell.orientation),
    dwellTime: dwell.dwellTime * timeMultiplier,
    Sk: refAirKermaRate,
    doseRateConstant,
    L: activeLength,
    tHalf: halfLife
  }))
}

export function getSetupFractionMultiplier(plan: BrachyPlan, setupNumber: number): number {
  if (plan.fractionGroups.length === 0) return 1
  const referenced = plan.fractionGroups.filter(group => group.referencedSetupNumbers.includes(setupNumber))
  if (referenced.length > 0) {
    return referenced.reduce((sum, group) => sum + group.numberOfFractions, 0)
  }
  if (plan.applicationSetups.length === 1) return plan.numberOfFractions || 1
  return 1
}
