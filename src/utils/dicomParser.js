// NM image parser using dcmjs for the dataset and DataView for pixels.
//
// Beyond the pixels it resolves three things the uniformity analysis cannot do
// without: the shape and orientation of each detector field of view, which
// detector and energy window every frame belongs to, and the counts and
// duration needed to check the acquisition against NEMA NU 1-2007.
import dcmjs from 'dcmjs'
import {
  assertNativeTransferSyntax,
  getPixelDataBytes,
  isLittleEndian,
  normalizeStoredPixel,
  readTransferSyntaxUid,
  readUnsignedPixel,
  resolveFrameCount
} from './dicomPixels.js'
import { measureActiveField } from './nemaAlgorithms.js'

const { DicomMessage, DicomMetaDictionary } = dcmjs.data

const SUPPORTED_FOV_SHAPES = new Set(['RECTANGLE'])

function firstValue(value) {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : undefined
  return value
}

function toNumber(value, fallback = 0) {
  const raw = firstValue(value)
  const num = Number(raw)
  return Number.isFinite(num) ? num : fallback
}

function toNumberArray(value) {
  const arr = Array.isArray(value) ? value : [value]
  return arr
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
}

function toText(value) {
  const raw = firstValue(value)
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && raw.Alphabetic) return raw.Alphabetic
  return String(raw)
}

function toTextArray(value) {
  const arr = Array.isArray(value) ? value : [value]
  return arr.map((item) => toText(item)).filter(Boolean)
}

function sequenceItems(sequence) {
  if (Array.isArray(sequence)) return sequence
  if (Array.isArray(sequence?.Value)) return sequence.Value
  return sequence ? [sequence] : []
}

function getPixelSpacing(dataset) {
  const pixelSpacing = toNumberArray(dataset.PixelSpacing)
  if (pixelSpacing.length >= 2) return [pixelSpacing[0], pixelSpacing[1]]

  const imagerPixelSpacing = toNumberArray(dataset.ImagerPixelSpacing)
  if (imagerPixelSpacing.length >= 2) return [imagerPixelSpacing[0], imagerPixelSpacing[1]]

  return null
}

// DICOM PS3.3 C.8.4.11 defines FieldOfViewDimensions for a RECTANGLE as row
// dimension first, column dimension second. Vendors do not always agree, and
// this reader used to answer that by swapping the two values unconditionally.
//
// So the order is decided by measurement instead. The flood covers the active
// area of the detector, so its extent in rows and columns says which reading of
// the stored pair matches the image actually in the file. On the Symbia Intevo
// of this department the stored pair is [532, 386] while the flood measures
// 386.6 mm across rows and 532.9 mm across columns: the vendor writes
// [column, row], the deviation is real, and it is reported rather than assumed.
// When neither candidate is clearly better, the DICOM standard order wins.
function resolveFovOrder(dims, activeField, pixelSpacing, rows, cols, forcedOrder) {
  if (!dims || dims.length < 2) return null

  const standard = [dims[0], dims[1]]
  const swapped = [dims[1], dims[0]]
  const result = {
    raw: [dims[0], dims[1]],
    order: 'standard',
    dimensionsMm: standard,
    deviation: null,
    alternativeDeviation: null,
    decidedBy: 'default',
    warning: null
  }

  const relativeError = (candidate, measured) => Math.max(
    Math.abs(candidate[0] - measured[0]) / measured[0],
    Math.abs(candidate[1] - measured[1]) / measured[1]
  )

  let measured = null
  if (activeField && pixelSpacing) {
    measured = [activeField.rowsPx * pixelSpacing[0], activeField.colsPx * pixelSpacing[1]]
    result.measuredMm = measured
    result.decidedBy = 'campo_activo'
  } else if (pixelSpacing) {
    // Without an image to measure, the only discriminator left is whether the
    // candidate even fits in the stored matrix.
    measured = [rows * pixelSpacing[0], cols * pixelSpacing[1]]
    result.decidedBy = 'matriz'
    const standardFits = standard[0] <= measured[0] * 1.001 && standard[1] <= measured[1] * 1.001
    const swappedFits = swapped[0] <= measured[0] * 1.001 && swapped[1] <= measured[1] * 1.001
    if (swappedFits && !standardFits) {
      result.order = 'swapped'
      result.dimensionsMm = swapped
      result.warning = 'Las dimensiones del FOV solo encajan en la matriz con el orden invertido; se acepta como desviacion del fabricante.'
    }
    if (forcedOrder === 'standard' || forcedOrder === 'swapped') {
      result.order = forcedOrder
      result.dimensionsMm = forcedOrder === 'swapped' ? swapped : standard
      result.decidedBy = 'manual'
    }
    return result
  }

  if (measured && result.decidedBy === 'campo_activo') {
    const standardError = relativeError(standard, measured)
    const swappedError = relativeError(swapped, measured)
    result.deviation = standardError
    result.alternativeDeviation = swappedError

    if (swappedError < standardError && swappedError < 0.10) {
      result.order = 'swapped'
      result.dimensionsMm = swapped
      result.deviation = swappedError
      result.alternativeDeviation = standardError
      result.warning = `El fabricante almacena FieldOfViewDimensions como [columna, fila]: `
        + `${dims[0]} x ${dims[1]} mm frente a un campo activo de `
        + `${measured[0].toFixed(1)} x ${measured[1].toFixed(1)} mm. `
        + 'Se usa el orden invertido y se documenta la desviacion respecto a PS3.3 C.8.4.11.'
    } else if (standardError >= 0.10 && swappedError >= 0.10) {
      result.warning = 'Ninguno de los dos ordenes de FieldOfViewDimensions concuerda con el campo activo medido; el UFOV declarado puede no corresponder a esta imagen.'
    }
  }

  if (forcedOrder === 'standard' || forcedOrder === 'swapped') {
    result.order = forcedOrder
    result.dimensionsMm = forcedOrder === 'swapped' ? swapped : standard
    result.decidedBy = 'manual'
  }

  return result
}

// One entry per frame, each carrying the detector and energy window that frame
// actually belongs to. DetectorVector and EnergyWindowVector are 1-based
// indices into their sequences; taking element 0 for every frame, as this used
// to, labels both heads of a dual-head flood with the geometry of the first.
function buildFrameInfo(dataset, frameCount, warnings) {
  const detectors = sequenceItems(dataset.DetectorInformationSequence)
  const windows = sequenceItems(dataset.EnergyWindowInformationSequence)
  const detectorVector = toNumberArray(dataset.DetectorVector)
  const windowVector = toNumberArray(dataset.EnergyWindowVector)

  if (frameCount > 1 && detectors.length > 1 && detectorVector.length !== frameCount) {
    warnings.push(
      'El DICOM tiene varios detectores pero no un DetectorVector por frame; no se puede asignar cada frame a su cabezal.'
    )
  }

  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const detectorNumber = detectorVector[frameIndex]
      ?? (detectors.length === 1 ? 1 : null)
    const windowNumber = windowVector[frameIndex]
      ?? (windows.length === 1 ? 1 : null)
    const detector = detectorNumber != null ? detectors[detectorNumber - 1] : null
    const window = windowNumber != null ? windows[windowNumber - 1] : null
    const range = window ? sequenceItems(window.EnergyWindowRangeSequence)[0] : null

    return {
      frameIndex,
      detectorNumber: detectorNumber ?? null,
      detectorKnown: Boolean(detector),
      energyWindowNumber: windowNumber ?? null,
      energyWindowName: window ? toText(window.EnergyWindowName) : '',
      energyWindowLowerLimit: range ? toNumber(range.EnergyWindowLowerLimit, Number.NaN) : Number.NaN,
      energyWindowUpperLimit: range ? toNumber(range.EnergyWindowUpperLimit, Number.NaN) : Number.NaN,
      fovShape: detector ? toText(detector.FieldOfViewShape).toUpperCase() : '',
      fovDimensionsRaw: detector ? toNumberArray(detector.FieldOfViewDimensions) : [],
      collimatorType: detector
        ? toText(detector.CollimatorType)
        : toText(dataset.CollimatorType),
      collimatorGridName: detector
        ? toText(detector.CollimatorGridName)
        : toText(dataset.CollimatorGridName),
      zoomFactor: detector ? toNumberArray(detector.ZoomFactor) : [],
      totalCounts: 0,
      ufovSizeMm: null,
      fov: null
    }
  })
}

export function parseDICOM(arrayBuffer, options = {}) {
  try {
    const dicomData = DicomMessage.readFile(arrayBuffer)
    const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict)
    const warnings = []

    const rows = toNumber(dataset.Rows)
    const cols = toNumber(dataset.Columns)
    const bitsAllocated = toNumber(dataset.BitsAllocated, 16)
    const bitsStored = toNumber(dataset.BitsStored, bitsAllocated)
    const highBit = toNumber(dataset.HighBit, bitsStored - 1)
    const pixelRepresentation = toNumber(dataset.PixelRepresentation, 0)
    const declaredFrames = Math.max(1, toNumber(dataset.NumberOfFrames, 1))
    const samplesPerPixel = Math.max(1, toNumber(dataset.SamplesPerPixel, 1))
    const transferSyntaxUID = readTransferSyntaxUid(dicomData)
    const littleEndian = isLittleEndian(transferSyntaxUID)

    if (!rows || !cols) {
      throw new Error('Rows/Columns no encontrados en el DICOM')
    }

    // A compressed transfer syntax used to fall through to the native reader,
    // which happily turned JPEG fragments into a plausible-looking uniformity.
    assertNativeTransferSyntax(transferSyntaxUID)

    if (samplesPerPixel !== 1) {
      throw new Error(`SamplesPerPixel=${samplesPerPixel} no soportado para este analisis`)
    }

    if (bitsAllocated % 8 !== 0) {
      throw new Error(`Bits Allocated no byte-alineado: ${bitsAllocated}`)
    }

    const pixelData = getPixelDataBytes(dicomData.dict['7FE00010'], arrayBuffer)
    const framePixels = rows * cols
    const bytesPerPixel = bitsAllocated / 8
    const frameBytes = framePixels * bytesPerPixel
    const frameSizing = resolveFrameCount(declaredFrames, pixelData.byteLength, frameBytes)

    if (!frameSizing.paddingOnly) {
      warnings.push(
        `Pixel Data tiene ${frameSizing.surplus} bytes por encima de los ${declaredFrames} frames declarados; `
        + 'se ignoran y no se crean frames adicionales.'
      )
    }

    const slope = toNumber(dataset.RescaleSlope, 1)
    const intercept = toNumber(dataset.RescaleIntercept, 0)
    const frameInfo = buildFrameInfo(dataset, frameSizing.frameCount, warnings)
    const frames = []

    for (let frameIndex = 0; frameIndex < frameSizing.frameCount; frameIndex++) {
      const frameOffset = pixelData.byteOffset + frameIndex * frameBytes
      const view = new DataView(pixelData.buffer, frameOffset, frameBytes)
      const frameFloat = new Float64Array(framePixels)
      let totalCounts = 0

      for (let i = 0; i < framePixels; i++) {
        const rawValue = readUnsignedPixel(view, i * bytesPerPixel, bitsAllocated, littleEndian)
        const stored = normalizeStoredPixel(rawValue, bitsStored, highBit, pixelRepresentation)
        const value = stored * slope + intercept
        frameFloat[i] = value
        totalCounts += value
      }

      frameInfo[frameIndex].totalCounts = totalCounts
      frames.push(frameFloat)
    }

    const pixelSpacing = getPixelSpacing(dataset)

    for (const info of frameInfo) {
      const activeField = measureActiveField(frames[info.frameIndex], rows, cols)
      info.activeField = activeField
      info.fov = resolveFovOrder(
        info.fovDimensionsRaw,
        activeField,
        pixelSpacing,
        rows,
        cols,
        options.fovOrder
      )
      info.ufovSizeMm = info.fov?.dimensionsMm ?? null

      if (info.fovShape && !SUPPORTED_FOV_SHAPES.has(info.fovShape)) {
        info.unsupportedFovShape = true
      }
    }

    const fovWarnings = new Set(frameInfo.map((info) => info.fov?.warning).filter(Boolean))
    for (const warning of fovWarnings) warnings.push(warning)

    const unsupportedShapes = new Set(
      frameInfo.filter((info) => info.unsupportedFovShape).map((info) => info.fovShape)
    )
    for (const shape of unsupportedShapes) {
      warnings.push(
        `FieldOfViewShape=${shape} no esta soportado: la geometria UFOV/CFOV de esta herramienta es rectangular. `
        + 'El resultado no es evaluable segun NEMA.'
      )
    }

    const actualFrameDurationMs = toNumber(dataset.ActualFrameDuration, Number.NaN)

    return {
      frames,
      frameInfo,
      rows,
      cols,
      numFrames: frames.length,
      declaredFrames,
      bitsAllocated,
      bitsStored,
      highBit,
      pixelRepresentation,
      samplesPerPixel,
      transferSyntaxUID,
      littleEndian,
      pixelSpacing,
      ufovSizeMm: frameInfo[0]?.ufovSizeMm ?? null,
      fov: frameInfo[0]?.fov ?? null,
      fovShape: frameInfo[0]?.fovShape ?? '',
      modality: toText(dataset.Modality),
      correctedImage: toTextArray(dataset.CorrectedImage),
      collimatorType: frameInfo[0]?.collimatorType ?? toText(dataset.CollimatorType),
      manufacturer: toText(dataset.Manufacturer),
      modelName: toText(dataset.ManufacturerModelName),
      softwareVersions: toTextArray(dataset.SoftwareVersions),
      seriesDescription: toText(dataset.SeriesDescription),
      numberOfDetectors: toNumber(dataset.NumberOfDetectors, frameInfo.length),
      actualFrameDurationMs,
      radionuclide: toText(
        sequenceItems(dataset.RadiopharmaceuticalInformationSequence)[0]
          ?.RadionuclideCodeSequence?.[0]?.CodeMeaning
      ),
      rescaleSlope: slope,
      rescaleIntercept: intercept,
      pixelDataBytes: pixelData.byteLength,
      warnings
    }
  } catch (err) {
    console.error('Error al parsear DICOM:', err)
    throw new Error('Error al parsear archivo DICOM: ' + err.message)
  }
}
