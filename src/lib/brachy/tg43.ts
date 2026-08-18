// Implementación del formalismo TG-43 para braquiterapia HDR
// Basado en AAPM TG-43 Update (2004)

import { SourcePosition, RadialDosePoint, AnisotropyPoint } from './types'
import { radialDoseData, anisotropyData } from './sourceData'

// Distancia euclidiana 3D
function distance(
  p1: [number, number, number],
  p2: [number, number, number]
): number {
  const dx = p1[0] - p2[0]
  const dy = p1[1] - p2[1]
  const dz = p1[2] - p2[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// Interpolación lineal simple
function linearInterpolate(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  if (Math.abs(x2 - x1) < 1e-10) return y1
  return y1 + ((x - x1) * (y2 - y1)) / (x2 - x1)
}

// Interpolación log-lineal para función de dosis radial
function interpolateRadialDose(r: number): number {
  // Buscar puntos más cercanos
  let r1 = radialDoseData[0]
  let r2 = radialDoseData[radialDoseData.length - 1]
  
  for (let i = 0; i < radialDoseData.length - 1; i++) {
    if (r >= radialDoseData[i].r && r <= radialDoseData[i + 1].r) {
      r1 = radialDoseData[i]
      r2 = radialDoseData[i + 1]
      break
    }
  }
  
  // Extrapolación si está fuera del rango
  if (r < radialDoseData[0].r) {
    r1 = radialDoseData[0]
    r2 = radialDoseData[1]
  } else if (r > radialDoseData[radialDoseData.length - 1].r) {
    r1 = radialDoseData[radialDoseData.length - 2]
    r2 = radialDoseData[radialDoseData.length - 1]
  }
  
  // Interpolación log-lineal
  const logR = Math.log(r)
  const logR1 = Math.log(r1.r)
  const logR2 = Math.log(r2.r)
  
  return linearInterpolate(logR, logR1, r1.gL, logR2, r2.gL)
}

// Interpolación bilineal para función de anisotropía
function interpolateAnisotropy(r: number, theta: number): number {
  // Obtener radios únicos
  const uniqueR = Array.from(new Set(anisotropyData.map(p => p.r))).sort((a, b) => a - b)
  
  // Encontrar radios que rodean r
  let r1 = uniqueR[0]
  let r2 = uniqueR[uniqueR.length - 1]
  
  for (let i = 0; i < uniqueR.length - 1; i++) {
    if (r >= uniqueR[i] && r <= uniqueR[i + 1]) {
      r1 = uniqueR[i]
      r2 = uniqueR[i + 1]
      break
    }
  }
  
  // Extrapolación si está fuera del rango
  if (r < uniqueR[0]) {
    r1 = uniqueR[0]
    r2 = uniqueR[1]
  } else if (r > uniqueR[uniqueR.length - 1]) {
    r1 = uniqueR[uniqueR.length - 2]
    r2 = uniqueR[uniqueR.length - 1]
  }
  
  // Obtener datos para r1 y r2
  const dataR1 = anisotropyData.filter(p => Math.abs(p.r - r1) < 0.01).sort((a, b) => a.theta - b.theta)
  const dataR2 = anisotropyData.filter(p => Math.abs(p.r - r2) < 0.01).sort((a, b) => a.theta - b.theta)
  
  // Interpolar en theta para r1
  let F1 = 1.0
  for (let i = 0; i < dataR1.length - 1; i++) {
    if (theta >= dataR1[i].theta && theta <= dataR1[i + 1].theta) {
      F1 = linearInterpolate(theta, dataR1[i].theta, dataR1[i].F, dataR1[i + 1].theta, dataR1[i + 1].F)
      break
    }
  }
  
  // Interpolar en theta para r2
  let F2 = 1.0
  for (let i = 0; i < dataR2.length - 1; i++) {
    if (theta >= dataR2[i].theta && theta <= dataR2[i + 1].theta) {
      F2 = linearInterpolate(theta, dataR2[i].theta, dataR2[i].F, dataR2[i + 1].theta, dataR2[i + 1].F)
      break
    }
  }
  
  // Interpolar en r
  if (Math.abs(r2 - r1) < 0.01) return F1
  return linearInterpolate(r, r1, F1, r2, F2)
}

// Función de geometría G(r,θ) para source lineal
export function getGeometryFunction(
  source: SourcePosition,
  point: { x: number; y: number; z: number }
): number {
  const rRef = 1.0 // cm
  const thetaRef = Math.PI / 2 // 90 grados
  const L = source.L
  
  // Geometría de referencia
  const betaRef = 2 * Math.atan(L / (2 * rRef))
  const glRef = betaRef / (L * rRef * Math.sin(thetaRef))
  
  // Posiciones
  const s: [number, number, number] = [source.x, source.y, source.z]
  const p: [number, number, number] = [point.x, point.y, point.z]
  const p1: [number, number, number] = [point.x, point.y, point.z - L / 2]
  const p2: [number, number, number] = [point.x, point.y, point.z + L / 2]
  
  // Distancias
  const R = distance(s, p)
  const R1 = distance(s, p2)
  const R2 = distance(s, p1)
  
  // Ángulos
  const theta1 = Math.acos((point.z - source.z + L / 2) / R1)
  const theta2 = Math.acos((point.z - source.z - L / 2) / R2)
  const theta = Math.acos((point.z - source.z) / R)
  
  let gl: number
  
  // Caso especial: punto en el eje longitudinal
  if (Math.abs(theta) < 1e-6 || Math.abs(theta - Math.PI) < 1e-6) {
    gl = 1 / (R * R - (L * L) / 4)
  } else {
    const beta = Math.abs(theta2 - theta1)
    gl = beta / (L * R * Math.sin(theta))
  }
  
  return gl / glRef
}

// Calcular dosis en un punto debido a una source
export function calculateDoseFromSource(
  source: SourcePosition,
  point: { x: number; y: number; z: number }
): number {
  // Convertir coordenadas de mm a cm si es necesario
  const pointCm = {
    x: point.x,
    y: point.y,
    z: point.z
  }
  
  // Distancia source-punto
  const s: [number, number, number] = [source.x, source.y, source.z]
  const p: [number, number, number] = [pointCm.x, pointCm.y, pointCm.z]
  const r = distance(s, p)
  
  // Ángulo polar
  const dz = pointCm.z - source.z
  const theta = Math.acos(dz / r)
  
  // Función de geometría
  const G = getGeometryFunction(source, pointCm)
  
  // Función de dosis radial
  const gL = interpolateRadialDose(r)
  
  // Función de anisotropía
  const F = interpolateAnisotropy(r, theta)
  
  // Fórmula TG-43
  // D = Sk * Lambda * G(r,theta) * gL(r) * F(r,theta) * t
  const Sk = source.Sk
  const Lambda = source.doseRateConstant
  const t = source.dwellTime / 3600 // convertir segundos a horas
  
  const dose = Sk * Lambda * G * gL * F * t
  
  return dose // cGy
}

// Calcular dosis total en un punto debido a múltiples sources
export function calculateTotalDose(
  sources: SourcePosition[],
  point: { x: number; y: number; z: number }
): number {
  let totalDose = 0
  
  for (const source of sources) {
    totalDose += calculateDoseFromSource(source, point)
  }
  
  return totalDose / 100 // convertir cGy a Gy
}

// Calcular factor de decaimiento radioactivo
export function calculateDecayFactor(
  initialDate: Date,
  treatmentDate: Date,
  halfLife: number // días
): number {
  const timeDiff = treatmentDate.getTime() - initialDate.getTime()
  const daysDiff = timeDiff / (1000 * 60 * 60 * 24)
  
  // A(t) = A0 * e^(-λt) = A0 * 2^(-t/T½)
  return Math.pow(2, -daysDiff / halfLife)
}

// Calcular actividad actual de la fuente
export function calculateCurrentActivity(
  initialActivity: number,
  initialDate: Date,
  currentDate: Date,
  halfLife: number
): number {
  const decayFactor = calculateDecayFactor(initialDate, currentDate, halfLife)
  return initialActivity * decayFactor
}

// Crear train de sources desde dwells
export function makeSourceTrain(
  dwells: { coords: [number, number, number]; dwellTime: number }[],
  refAirKermaRate: number,
  doseRateConstant: number,
  activeLength: number,
  halfLife: number
): SourcePosition[] {
  return dwells.map(dwell => ({
    // Reordenar ejes: x=x/10, y=z/10, z=y/10 (mm a cm)
    x: dwell.coords[0] / 10,
    y: dwell.coords[2] / 10,
    z: dwell.coords[1] / 10,
    dwellTime: dwell.dwellTime,
    Sk: refAirKermaRate,
    doseRateConstant,
    L: activeLength,
    tHalf: halfLife
  }))
}
