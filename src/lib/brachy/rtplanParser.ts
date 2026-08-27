// Parser DICOM RT Plan para braquiterapia. La lógica de dataset se exporta
// separada para poder validarla con datasets sintéticos sin leer archivos clínicos.

import dcmjs from 'dcmjs'
import type {
  BrachyApplicationSetup,
  BrachyPlan,
  Channel,
  Dwell,
  FractionGroup,
  Point,
  Vector3
} from './types'

const { DicomMessage } = dcmjs.data
const EPS = 1e-9

function extractString(value: any): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value.Alphabetic) return value.Alphabetic
  return String(value)
}

function toNumber(value: any): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(Array.isArray(value) ? value[0] : value)
  return Number.isFinite(number) ? number : undefined
}

function toInteger(value: any, fallback = 0): number {
  const number = toNumber(value)
  return number === undefined ? fallback : Math.trunc(number)
}

function toVector3(value: any): Vector3 | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined
  const vector = value.slice(0, 3).map(Number)
  if (vector.some(component => !Number.isFinite(component))) return undefined
  return vector as Vector3
}

function normalize(vector?: Vector3): Vector3 | undefined {
  if (!vector) return undefined
  const norm = Math.hypot(vector[0], vector[1], vector[2])
  if (norm < EPS) return undefined
  return [vector[0] / norm, vector[1] / norm, vector[2] / norm]
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function midpoint(a: Vector3, b: Vector3): Vector3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
}

function inferDwellOrientations(dwells: Dwell[]): Dwell[] {
  return dwells.map((dwell, index) => {
    const dicomOrientation = normalize(dwell.orientation)
    if (dicomOrientation) {
      return { ...dwell, orientation: dicomOrientation, orientationSource: 'dicom' }
    }

    let direction: Vector3 | undefined
    if (dwell.relativePosition !== undefined) {
      const lower = dwells
        .filter(candidate => candidate.relativePosition !== undefined &&
          candidate.relativePosition! < dwell.relativePosition! - EPS)
        .sort((a, b) => b.relativePosition! - a.relativePosition!)[0]
      const higher = dwells
        .filter(candidate => candidate.relativePosition !== undefined &&
          candidate.relativePosition! > dwell.relativePosition! + EPS)
        .sort((a, b) => a.relativePosition! - b.relativePosition!)[0]

      // El eje positivo del modelo apunta al extremo distal: hacia posiciones relativas menores.
      if (lower) direction = subtract(lower.coords, dwell.coords)
      else if (higher) direction = subtract(dwell.coords, higher.coords)
    }

    if (!direction && index > 0) direction = subtract(dwells[index - 1].coords, dwell.coords)
    if (!direction && index < dwells.length - 1) direction = subtract(dwell.coords, dwells[index + 1].coords)

    return {
      ...dwell,
      orientation: normalize(direction) || [0, 0, 1],
      orientationSource: 'inferred'
    }
  })
}

type ParsedControlPoint = {
  index: number
  cumulativeTimeWeight?: number
  relativePosition?: number
  coords?: Vector3
  orientation?: Vector3
}

function parseControlPoints(channelData: any): ParsedControlPoint[] {
  const sequence = channelData.BrachyControlPointSequence || []
  return sequence.map((controlPoint: any, index: number) => ({
    index: toInteger(controlPoint.ControlPointIndex, index),
    cumulativeTimeWeight: toNumber(controlPoint.CumulativeTimeWeight),
    relativePosition: toNumber(controlPoint.ControlPointRelativePosition),
    coords: toVector3(controlPoint.ControlPoint3DPosition),
    orientation: toVector3(controlPoint.ControlPointOrientation)
  })).sort((a: ParsedControlPoint, b: ParsedControlPoint) => a.index - b.index)
}

function parseDwells(channelData: any, warnings: string[]): Dwell[] {
  const controlPoints = parseControlPoints(channelData)
  const channelNumber = toInteger(channelData.ChannelNumber)
  const channelTotalTime = toNumber(channelData.ChannelTotalTime) || 0
  const finalWeight = toNumber(channelData.FinalCumulativeTimeWeight) ??
    controlPoints[controlPoints.length - 1]?.cumulativeTimeWeight ?? 0
  const movementType = extractString(channelData.SourceMovementType).toUpperCase()

  if (channelTotalTime <= 0 || finalWeight <= 0) {
    warnings.push(`Canal ${channelNumber}: faltan Channel Total Time o Final Cumulative Time Weight válidos.`)
    return []
  }

  const dwells: Dwell[] = []
  const stepwisePairs = movementType === 'STEPWISE' && controlPoints.length % 2 === 0

  if (!stepwisePairs) {
    warnings.push(`Canal ${channelNumber}: movimiento ${movementType || 'no indicado'} tratado por segmentos consecutivos.`)
  }

  const stride = stepwisePairs ? 2 : 1
  for (let index = 0; index + 1 < controlPoints.length; index += stride) {
    const start = controlPoints[index]
    const end = controlPoints[index + 1]
    if (start.cumulativeTimeWeight === undefined || end.cumulativeTimeWeight === undefined) continue

    const timeWeight = end.cumulativeTimeWeight - start.cumulativeTimeWeight
    if (timeWeight <= EPS) continue

    let coords = start.coords || end.coords
    if (!stepwisePairs && start.coords && end.coords) coords = midpoint(start.coords, end.coords)
    if (!coords) {
      warnings.push(`Canal ${channelNumber}: control point sin Control Point 3D Position.`)
      continue
    }

    const relativePosition = start.relativePosition ?? end.relativePosition
    const orientation = start.orientation || end.orientation
    dwells.push({
      coords,
      dwellTime: channelTotalTime * timeWeight / finalWeight,
      timeWeight,
      relativePosition,
      orientation
    })
  }

  return inferDwellOrientations(dwells)
}

function parseApplicationSetups(dataset: any, warnings: string[]): BrachyApplicationSetup[] {
  return (dataset.ApplicationSetupSequence || []).map((setupData: any, setupIndex: number) => {
    const setupNumber = toInteger(setupData.ApplicationSetupNumber, setupIndex + 1)
    const setupName = extractString(setupData.ApplicationSetupName) || `Setup ${setupNumber}`
    const channels: Channel[] = (setupData.ChannelSequence || []).map((channelData: any) => ({
      number: toInteger(channelData.ChannelNumber),
      setupNumber,
      setupName,
      length: toNumber(channelData.ChannelLength) || 0,
      totalTime: toNumber(channelData.ChannelTotalTime) || 0,
      finalCumulativeTimeWeight: toNumber(channelData.FinalCumulativeTimeWeight) || 0,
      sourceMovementType: extractString(channelData.SourceMovementType),
      dwells: parseDwells(channelData, warnings)
    })).filter((channel: Channel) => channel.dwells.length > 0)

    return { number: setupNumber, name: setupName, channels }
  }).filter((setup: BrachyApplicationSetup) => setup.channels.length > 0)
}

function parseFractionGroups(dataset: any): FractionGroup[] {
  return (dataset.FractionGroupSequence || []).map((groupData: any, groupIndex: number) => {
    const setupReferences = groupData.ReferencedBrachyApplicationSetupSequence || []
    return {
      number: toInteger(groupData.FractionGroupNumber, groupIndex + 1),
      description: extractString(groupData.FractionGroupDescription),
      numberOfFractions: Math.max(1, toInteger(groupData.NumberOfFractionsPlanned, 1)),
      referencedSetupNumbers: setupReferences
        .map((reference: any) => toInteger(reference.ReferencedBrachyApplicationSetupNumber))
        .filter((number: number) => number > 0),
      setupDoses: setupReferences.map((reference: any) => ({
        setupNumber: toInteger(reference.ReferencedBrachyApplicationSetupNumber),
        coords: toVector3(reference.BrachyApplicationSetupDoseSpecificationPoint),
        doseGy: toNumber(reference.BrachyApplicationSetupDose),
        referencedDoseReferenceUID: extractString(reference.ReferencedDoseReferenceUID) || undefined
      })),
      doseReferences: (groupData.ReferencedDoseReferenceSequence || []).map((reference: any) => ({
        doseReferenceNumber: toInteger(reference.ReferencedDoseReferenceNumber),
        targetPrescriptionDose: toNumber(reference.TargetPrescriptionDose)
      }))
    }
  })
}

function buildDoseReferencePoints(dataset: any, fractionGroups: FractionGroup[]): Point[] {
  const points: Point[] = []

  for (const [index, doseRef] of (dataset.DoseReferenceSequence || []).entries()) {
    const coords = toVector3(doseRef.DoseReferencePointCoordinates)
    if (!coords) continue

    const doseReferenceNumber = toInteger(doseRef.DoseReferenceNumber, index + 1)
    const matchingGroups = fractionGroups.map(group => ({
      group,
      reference: group.doseReferences.find(item => item.doseReferenceNumber === doseReferenceNumber)
    })).filter(item => item.reference?.targetPrescriptionDose !== undefined)

    let prescribedDoseTotal: number | undefined
    let prescribedDosePerFraction: number | undefined
    let prescriptionSource: string | undefined

    if (matchingGroups.length === 1) {
      const { group, reference } = matchingGroups[0]
      prescribedDoseTotal = reference!.targetPrescriptionDose
      prescribedDosePerFraction = prescribedDoseTotal! / group.numberOfFractions
      prescriptionSource = `Target Prescription Dose, grupo ${group.number}`
    } else if (matchingGroups.length > 1) {
      prescribedDoseTotal = matchingGroups.reduce(
        (sum, item) => sum + (item.reference!.targetPrescriptionDose || 0),
        0
      )
      prescriptionSource = 'Suma de Target Prescription Dose de varios grupos'
    } else {
      const legacyDose = toNumber(doseRef.TargetPrescriptionDose)
      if (legacyDose !== undefined) {
        prescribedDoseTotal = legacyDose
        if (fractionGroups.length === 1) {
          prescribedDosePerFraction = legacyDose / fractionGroups[0].numberOfFractions
          prescriptionSource = 'Target Prescription Dose del plan; dosis/sesión derivada'
        } else {
          prescriptionSource = 'Target Prescription Dose del plan; alcance no desambiguado'
        }
      }
    }

    points.push({
      name: extractString(doseRef.DoseReferenceDescription) ||
        extractString(doseRef.DoseReferenceStructureType) || `Punto ${index + 1}`,
      coords,
      doseReferenceNumber,
      prescribedDosePerFraction,
      prescribedDoseTotal,
      prescriptionSource
    })
  }

  for (const group of fractionGroups) {
    for (const setupDose of group.setupDoses) {
      if (!setupDose.coords || setupDose.doseGy === undefined) continue
      points.push({
        name: `Punto dosis setup ${setupDose.setupNumber} · grupo ${group.number}`,
        coords: setupDose.coords,
        prescribedDosePerFraction: setupDose.doseGy,
        prescribedDoseTotal: setupDose.doseGy * group.numberOfFractions,
        prescriptionSource: 'Brachy Application Setup Dose (dosis por sesión)'
      })
    }
  }

  return points
}

export function parseBrachyDataset(dataset: any): BrachyPlan {
  const warnings: string[] = []
  const source = dataset.SourceSequence?.[0] || {}
  const applicationSetups = parseApplicationSetups(dataset, warnings)
  const channels = applicationSetups.flatMap(setup => setup.channels)
  const fractionGroups = parseFractionGroups(dataset)
  const numberOfFractions = fractionGroups.length > 0
    ? fractionGroups.reduce((sum, group) => sum + group.numberOfFractions, 0)
    : 1

  if (fractionGroups.length === 0) {
    warnings.push('El RTPLAN no incluye Fraction Group Sequence; se asume una sesión.')
  } else if (fractionGroups.length > 1) {
    warnings.push('El plan contiene varios grupos de fracciones; la dosis total usa el multiplicador de cada setup.')
  }
  if (channels.some(channel => channel.dwells.some(dwell => dwell.orientationSource === 'inferred'))) {
    warnings.push('Alguna orientación de fuente no venía en DICOM y se ha inferido con la tangente del canal.')
  }
  if (channels.length === 0) throw new Error('No se encontraron dwells con tiempos válidos en el RT Plan')

  const refAirKermaRate = toNumber(source.ReferenceAirKermaRate) || 0
  if (refAirKermaRate <= 0) throw new Error('Reference Air Kerma Rate ausente o no válido')

  const halfLifeSeconds = toNumber(source.RadionuclideHalfLife)
  const plan: BrachyPlan = {
    patientName: extractString(dataset.PatientName),
    patientID: extractString(dataset.PatientID),
    planLabel: extractString(dataset.RTPlanLabel || dataset.RTPlanName),
    planDate: extractString(dataset.RTPlanDate),
    sourceIsotope: extractString(source.SourceIsotopeName) || 'Ir-192',
    refAirKermaRate,
    halfLife: halfLifeSeconds ? halfLifeSeconds / 86400 : 73.83,
    treatmentModel: extractString(dataset.TreatmentMachineName),
    applicationSetups,
    channels,
    fractionGroups,
    numberOfFractions,
    doseReferencePoints: buildDoseReferencePoints(dataset, fractionGroups),
    warnings,
    sourceCalibrationDate: extractString(source.SourceStrengthReferenceDate) || undefined,
    sourceCalibrationTime: extractString(source.SourceStrengthReferenceTime) || undefined,
    treatmentDate: extractString(dataset.RTPlanDate) || undefined
  }

  return plan
}

export function parseRTPlanBrachy(arrayBuffer: ArrayBuffer): BrachyPlan {
  try {
    const dicomData = DicomMessage.readFile(arrayBuffer)
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict)
    return parseBrachyDataset(dataset)
  } catch (error) {
    throw new Error('Error al parsear RT Plan de braquiterapia: ' + (error as Error).message)
  }
}
