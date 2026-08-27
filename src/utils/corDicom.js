import dcmjs from 'dcmjs'
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

function normaliseAngle(angle) {
  return ((angle % 360) + 360) % 360
}

function frameVector(dataset, keyword, frameCount, fallbackFactory) {
  const values = numbers(dataset[keyword])
  return Array.from({ length: frameCount }, (_, index) => (
    Number.isFinite(values[index]) ? values[index] : fallbackFactory(index)
  ))
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
  const defaultViews = Math.max(1, number(rotations[0]?.NumberOfFramesInRotation, frameCount))
  const detectorVector = frameVector(
    dataset,
    'DetectorVector',
    frameCount,
    (index) => Math.floor(index / defaultViews) + 1
  )
  const rotationVector = frameVector(dataset, 'RotationVector', frameCount, () => 1)
  const angularViewVector = frameVector(
    dataset,
    'AngularViewVector',
    frameCount,
    (index) => (index % defaultViews) + 1
  )

  const frameMeta = Array.from({ length: frameCount }, (_, index) => {
    const detectorNumber = Math.max(1, Math.trunc(detectorVector[index]))
    const rotationNumber = Math.max(1, Math.trunc(rotationVector[index]))
    const viewNumber = Math.max(1, Math.trunc(angularViewVector[index]))
    const detector = detectors[detectorNumber - 1] || {}
    const rotation = rotations[rotationNumber - 1] || rotations[0] || {}
    const angularStep = number(rotation.AngularStep, 360 / defaultViews)
    const direction = text(rotation.RotationDirection).toUpperCase() === 'CW' ? -1 : 1
    const startAngle = number(detector.StartAngle, number(rotation.StartAngle, 0))

    return {
      frameIndex: index,
      detectorNumber,
      rotationNumber,
      viewNumber,
      angleDeg: normaliseAngle(startAngle + direction * (viewNumber - 1) * angularStep),
      angularStepDeg: Math.abs(angularStep),
      radialPositionMm: number(
        numbers(detector.RadialPosition)[viewNumber - 1],
        number(numbers(rotation.RadialPosition)[viewNumber - 1])
      )
    }
  })

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
