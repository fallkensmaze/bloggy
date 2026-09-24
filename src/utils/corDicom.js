import dcmjs from 'dcmjs'
import { readCorGeometry } from './corGeometry.js'
import { parseDICOM } from './dicomParser.js'

const { DicomMessage, DicomMetaDictionary } = dcmjs.data

function first(value) {
  return Array.isArray(value) ? value[0] : value
}

function number(value, fallback = Number.NaN) {
  const parsed = Number(first(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

function numbers(value) {
  if (value == null) return []
  return (Array.isArray(value) ? value : [value])
    .map(Number)
    .filter(Number.isFinite)
}

function text(value) {
  const raw = first(value)
  return raw == null ? '' : String(raw)
}

export function parseCorDICOM(arrayBuffer) {
  const image = parseDICOM(arrayBuffer)
  const dicomData = DicomMessage.readFile(arrayBuffer)
  const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict)

  if (image.modality && image.modality !== 'NM') {
    throw new Error(`Se esperaba modalidad NM y se recibió ${image.modality}`)
  }

  const rotations = Array.isArray(dataset.RotationInformationSequence)
    ? dataset.RotationInformationSequence
    : []
  const detectors = Array.isArray(dataset.DetectorInformationSequence)
    ? dataset.DetectorInformationSequence
    : []
  const frameCount = image.frames.length
  const frameMeta = readCorGeometry(dataset, frameCount)
  const detectorVector = frameMeta.map(frame => frame.detectorNumber)

  const energyWindow = dataset.EnergyWindowInformationSequence?.[0] || {}
  const energyRange = energyWindow.EnergyWindowRangeSequence?.[0] || {}
  const rotation = rotations[0] || {}

  return {
    ...image,
    frameMeta,
    metadata: {
      seriesDescription: text(dataset.SeriesDescription),
      studyDescription: text(dataset.StudyDescription),
      equipment: [text(dataset.Manufacturer), text(dataset.ManufacturerModelName)]
        .filter(Boolean)
        .join(' '),
      collimators: detectors.map((detector, index) => ({
        detectorNumber: index + 1,
        type: text(detector.CollimatorType),
        gridName: text(detector.CollimatorGridName),
        radialPositionMm: numbers(detector.RadialPosition)
      })),
      detectorCount: new Set(detectorVector).size,
      scanArcDeg: number(rotation.ScanArc),
      angularStepDeg: number(rotation.AngularStep),
      rotationDirection: text(rotation.RotationDirection),
      frameDurationMs: number(rotation.ActualFrameDuration),
      energyWindowName: text(energyWindow.EnergyWindowName),
      energyWindowKeV: [
        number(energyRange.EnergyWindowLowerLimit),
        number(energyRange.EnergyWindowUpperLimit)
      ]
    }
  }
}
