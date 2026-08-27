// Tipos del módulo de verificación independiente TG-43.

export type Vector3 = [number, number, number]

export type Dwell = {
  coords: Vector3 // coordenadas DICOM [x, y, z] en mm
  dwellTime: number // tiempo incremental del dwell en segundos
  timeWeight: number // incremento de Cumulative Time Weight
  relativePosition?: number // posición relativa en el canal, mm
  orientation?: Vector3 // eje unitario de la fuente, hacia el extremo distal
  orientationSource?: 'dicom' | 'inferred'
}

export type Channel = {
  number: number
  setupNumber: number
  setupName?: string
  length: number // mm
  totalTime: number // s
  finalCumulativeTimeWeight: number
  sourceMovementType: string
  dwells: Dwell[]
}

export type BrachyApplicationSetup = {
  number: number
  name: string
  channels: Channel[]
}

export type SetupDose = {
  setupNumber: number
  coords?: Vector3
  doseGy?: number // dosis del setup en una fracción/sesión
  referencedDoseReferenceUID?: string
}

export type FractionDoseReference = {
  doseReferenceNumber: number
  targetPrescriptionDose?: number // dosis prescrita para el grupo de fracciones
}

export type FractionGroup = {
  number: number
  description: string
  numberOfFractions: number
  referencedSetupNumbers: number[]
  setupDoses: SetupDose[]
  doseReferences: FractionDoseReference[]
}

export type Point = {
  name: string
  coords: Vector3
  doseReferenceNumber?: number
  prescribedDosePerFraction?: number
  prescribedDoseTotal?: number
  prescriptionSource?: string
  calculatedDosePerFraction?: number
  calculatedDoseTotal?: number
}

export type BrachyPlan = {
  patientName: string
  patientID: string
  planLabel: string
  planDate: string
  sourceIsotope: string
  refAirKermaRate: number // U = cGy·cm²/h
  halfLife: number // días
  treatmentModel: string
  applicationSetups: BrachyApplicationSetup[]
  channels: Channel[] // vista plana para compatibilidad/UI
  fractionGroups: FractionGroup[]
  numberOfFractions: number
  doseReferencePoints: Point[]
  warnings: string[]
  sourceCalibrationDate?: string
  sourceCalibrationTime?: string
  treatmentDate?: string
}

export type SourcePosition = {
  x: number // cm
  y: number // cm
  z: number // cm
  orientation: Vector3 // eje unitario de la fuente
  dwellTime: number // segundos
  Sk: number // U
  doseRateConstant: number // cGy h⁻¹ U⁻¹
  L: number // longitud activa, cm
  tHalf: number // vida media, días
}

export type RadialDosePoint = {
  r: number
  gL: number
}

export type AnisotropyPoint = {
  r: number
  theta: number
  F: number
}
