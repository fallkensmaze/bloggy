// Tipos para el módulo de braquiterapia TG-43

export type Dwell = {
  coords: [number, number, number] // [x, y, z] en mm
  dwellTime: number // segundos
  timeWeight: number // peso normalizado
}

export type Channel = {
  number: number // número del canal
  length: number // longitud del canal en mm
  totalTime?: number // segundos (opcional)
  numberOfDwells?: number // (opcional)
  dwells: Dwell[]
}

export type Point = {
  name: string
  coords: [number, number, number] // [x, y, z] en mm
  prescribedDose?: number // Gy
  calculatedDose?: number // Gy
}

export type BrachyPlan = {
  patientName: string
  patientID: string
  planLabel: string
  planDate: string
  sourceIsotope: string
  refAirKermaRate: number // U (cGy·cm²/h)
  halfLife: number // días
  treatmentModel: string
  channels: Channel[]
  doseReferencePoints?: Point[] // Puntos de referencia del plan
  sourceCalibrationDate?: string // Fecha de calibración de la fuente
  treatmentDate?: string // Fecha de tratamiento
}

export type ParsedRTPlan = {
  applicator?: string
  prescription?: number // Gy
  treatmentModel?: string
  refAirKermaRate: number // U (cGy·cm²/h)
  halfLife: number // días
  sourceIsotope?: string
  points: Point[]
  channels: Channel[]
}

export type SourcePosition = {
  x: number // cm
  y: number // cm
  z: number // cm
  dwellTime: number // segundos
  Sk: number // Reference Air Kerma Rate (U)
  doseRateConstant: number // Lambda (cGy/h/U)
  L: number // longitud activa (cm)
  tHalf: number // vida media (días)
}

export type RadialDosePoint = {
  r: number // cm
  gL: number // función de dosis radial
}

export type AnisotropyPoint = {
  r: number // cm
  theta: number // radianes
  F: number // función de anisotropía
}
