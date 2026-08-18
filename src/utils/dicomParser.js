// Generic DICOM image parser using dcmjs for the dataset and DataView for pixels.
import dcmjs from 'dcmjs'

const { DicomMessage, DicomMetaDictionary } = dcmjs.data

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

function getNaturalizedMeta(dicomData) {
  try {
    if (!dicomData.meta?.dict) return {}
    return DicomMetaDictionary.naturalizeDataset(dicomData.meta.dict)
  } catch {
    return {}
  }
}

function getTransferSyntaxUID(dicomData, meta) {
  const fromNaturalized = toText(meta.TransferSyntaxUID)
  if (fromNaturalized) return fromNaturalized

  const raw = dicomData.meta?.dict?.['00020010']
  if (!raw) return ''
  return toText(raw.Value)
}

function getPixelDataBytes(pixelDataElement, arrayBuffer) {
  const value = pixelDataElement.Value || pixelDataElement.value

  if (value && value.length > 0) {
    const first = value[0]
    if (first instanceof ArrayBuffer) return new Uint8Array(first)
    if (ArrayBuffer.isView(first)) {
      return new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
    }
    if (typeof first === 'string') {
      const binary = atob(first)
      const out = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
      return out
    }
  }

  if (pixelDataElement.dataOffset == null || pixelDataElement.length == null || pixelDataElement.length <= 0) {
    throw new Error('Pixel Data comprimido o sin offset no soportado por el visor')
  }

  return new Uint8Array(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length)
}

function getPixelSpacing(dataset) {
  const pixelSpacing = toNumberArray(dataset.PixelSpacing)
  if (pixelSpacing.length >= 2) return [pixelSpacing[0], pixelSpacing[1]]

  const imagerPixelSpacing = toNumberArray(dataset.ImagerPixelSpacing)
  if (imagerPixelSpacing.length >= 2) return [imagerPixelSpacing[0], imagerPixelSpacing[1]]

  return null
}

function getUfovSizeMm(dataset) {
  const detectorSequence = dataset.DetectorInformationSequence
  if (!Array.isArray(detectorSequence) || detectorSequence.length === 0) return null

  const dims = toNumberArray(detectorSequence[0]?.FieldOfViewDimensions)
  if (dims.length < 2) return null

  // Siemens NM usually stores FieldOfViewDimensions as [columns_mm, rows_mm].
  return [dims[1], dims[0]]
}

function readPixel(view, byteOffset, bitsAllocated, pixelRepresentation, littleEndian) {
  if (bitsAllocated === 8) {
    return pixelRepresentation === 1 ? view.getInt8(byteOffset) : view.getUint8(byteOffset)
  }
  if (bitsAllocated === 16) {
    return pixelRepresentation === 1
      ? view.getInt16(byteOffset, littleEndian)
      : view.getUint16(byteOffset, littleEndian)
  }
  if (bitsAllocated === 32) {
    return pixelRepresentation === 1
      ? view.getInt32(byteOffset, littleEndian)
      : view.getUint32(byteOffset, littleEndian)
  }
  throw new Error(`Bits Allocated no soportado: ${bitsAllocated}`)
}

export function parseDICOM(arrayBuffer) {
  try {
    const dicomData = DicomMessage.readFile(arrayBuffer)
    const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict)
    const meta = getNaturalizedMeta(dicomData)

    const rows = toNumber(dataset.Rows)
    const cols = toNumber(dataset.Columns)
    const bitsAllocated = toNumber(dataset.BitsAllocated, 16)
    const bitsStored = toNumber(dataset.BitsStored, bitsAllocated)
    const highBit = toNumber(dataset.HighBit, bitsStored - 1)
    const pixelRepresentation = toNumber(dataset.PixelRepresentation, 0)
    const declaredFrames = Math.max(1, toNumber(dataset.NumberOfFrames, 1))
    const samplesPerPixel = Math.max(1, toNumber(dataset.SamplesPerPixel, 1))
    const transferSyntaxUID = getTransferSyntaxUID(dicomData, meta)
    const littleEndian = transferSyntaxUID !== '1.2.840.10008.1.2.2'

    if (!rows || !cols) {
      throw new Error('Rows/Columns no encontrados en el DICOM')
    }

    if (samplesPerPixel !== 1) {
      throw new Error(`SamplesPerPixel=${samplesPerPixel} no soportado para este analisis`)
    }

    if (bitsAllocated % 8 !== 0) {
      throw new Error(`Bits Allocated no byte-alineado: ${bitsAllocated}`)
    }

    const pixelDataElement = dicomData.dict['7FE00010']
    if (!pixelDataElement) {
      throw new Error('No se encontraron datos de pixel (tag 7FE0,0010)')
    }

    const pixelData = getPixelDataBytes(pixelDataElement, arrayBuffer)
    const framePixels = rows * cols
    const bytesPerPixel = bitsAllocated / 8
    const frameBytes = framePixels * bytesPerPixel
    const availableFrames = Math.max(1, Math.floor(pixelData.byteLength / frameBytes))
    const numFrames = Math.max(declaredFrames, availableFrames)
    const slope = toNumber(dataset.RescaleSlope, 1)
    const intercept = toNumber(dataset.RescaleIntercept, 0)

    if (pixelData.byteLength < frameBytes) {
      throw new Error('Pixel Data mas corto que un frame DICOM completo')
    }

    const frames = []
    const maxFrames = Math.min(numFrames, availableFrames)

    for (let frameIndex = 0; frameIndex < maxFrames; frameIndex++) {
      const frameOffset = pixelData.byteOffset + frameIndex * frameBytes
      const view = new DataView(pixelData.buffer, frameOffset, frameBytes)
      const frameFloat = new Float64Array(framePixels)

      for (let i = 0; i < framePixels; i++) {
        const rawValue = readPixel(view, i * bytesPerPixel, bitsAllocated, pixelRepresentation, littleEndian)
        frameFloat[i] = rawValue * slope + intercept
      }

      frames.push(frameFloat)
    }

    return {
      frames,
      rows,
      cols,
      numFrames: frames.length,
      bitsAllocated,
      bitsStored,
      highBit,
      pixelRepresentation,
      samplesPerPixel,
      transferSyntaxUID,
      littleEndian,
      pixelSpacing: getPixelSpacing(dataset),
      ufovSizeMm: getUfovSizeMm(dataset),
      modality: toText(dataset.Modality),
      correctedImage: dataset.CorrectedImage || null,
      collimatorType: toText(dataset.CollimatorType),
      manufacturer: toText(dataset.Manufacturer),
      modelName: toText(dataset.ManufacturerModelName),
      rescaleSlope: slope,
      rescaleIntercept: intercept,
      pixelDataBytes: pixelData.byteLength
    }
  } catch (err) {
    console.error('Error al parsear DICOM:', err)
    throw new Error('Error al parsear archivo DICOM: ' + err.message)
  }
}
