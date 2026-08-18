import dcmjs from 'dcmjs'

const { DicomMessage, DicomMetaDictionary } = dcmjs.data

const NATIVE_TRANSFER_SYNTAXES = new Set([
  '',
  '1.2.840.10008.1.2',
  '1.2.840.10008.1.2.1',
  '1.2.840.10008.1.2.1.99',
  '1.2.840.10008.1.2.2'
])

function firstValue(value) {
  if (Array.isArray(value)) return value[0]
  return value
}

function valueParts(value) {
  if (Array.isArray(value)) return value.flatMap((item) => valueParts(item))
  if (typeof value === 'string' && value.includes('\\')) return value.split('\\')
  return value == null ? [] : [value]
}

function toNumber(value, fallback = Number.NaN) {
  const parsed = Number(firstValue(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNumberArray(value) {
  return valueParts(value)
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

function sequenceItems(sequence) {
  if (Array.isArray(sequence)) return sequence
  if (Array.isArray(sequence?.Value)) return sequence.Value
  return sequence ? [sequence] : []
}

function firstSequenceItem(sequence) {
  return sequenceItems(sequence)[0] || null
}

function getNaturalizedMeta(dicomData) {
  try {
    return dicomData.meta?.dict
      ? DicomMetaDictionary.naturalizeDataset(dicomData.meta.dict)
      : {}
  } catch {
    return {}
  }
}

function getTransferSyntaxUid(dicomData, meta) {
  const naturalized = toText(meta.TransferSyntaxUID)
  if (naturalized) return naturalized
  return toText(dicomData.meta?.dict?.['00020010']?.Value)
}

function getFunctionalGroups(dataset) {
  const shared = firstSequenceItem(dataset.SharedFunctionalGroupsSequence) || {}
  const pixelMeasures = firstSequenceItem(shared.PixelMeasuresSequence) || {}
  const sharedOrientation = firstSequenceItem(shared.PlaneOrientationSequence)?.ImageOrientationPatient
  const sharedPosition = firstSequenceItem(shared.PlanePositionSequence)?.ImagePositionPatient
  const perFrame = sequenceItems(dataset.PerFrameFunctionalGroupsSequence)

  return {
    pixelMeasures,
    sharedOrientation: toNumberArray(sharedOrientation),
    sharedPosition: toNumberArray(sharedPosition),
    perFrame
  }
}

function getPixelSpacing(dataset, functionalGroups) {
  const direct = toNumberArray(dataset.PixelSpacing)
  if (direct.length >= 2) return direct.slice(0, 2)
  const enhanced = toNumberArray(functionalGroups.pixelMeasures.PixelSpacing)
  return enhanced.length >= 2 ? enhanced.slice(0, 2) : null
}

function getFrameGeometry(dataset, functionalGroups, frameCount) {
  const directOrientation = toNumberArray(dataset.ImageOrientationPatient)
  const directPosition = toNumberArray(dataset.ImagePositionPatient)
  const defaultOrientation = directOrientation.length >= 6
    ? directOrientation.slice(0, 6)
    : functionalGroups.sharedOrientation.slice(0, 6)
  const defaultPosition = directPosition.length >= 3
    ? directPosition.slice(0, 3)
    : functionalGroups.sharedPosition.slice(0, 3)
  const frameOrientations = []
  const framePositions = []

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const frameGroup = functionalGroups.perFrame[frameIndex] || {}
    const orientation = toNumberArray(
      firstSequenceItem(frameGroup.PlaneOrientationSequence)?.ImageOrientationPatient
    )
    const position = toNumberArray(
      firstSequenceItem(frameGroup.PlanePositionSequence)?.ImagePositionPatient
    )
    frameOrientations.push(
      orientation.length >= 6 ? orientation.slice(0, 6) : defaultOrientation
    )
    framePositions.push(position.length >= 3 ? position.slice(0, 3) : defaultPosition)
  }

  return { frameOrientations, framePositions }
}

function readDicomStructure(arrayBuffer) {
  const dicomData = DicomMessage.readFile(arrayBuffer)
  const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict)
  const meta = getNaturalizedMeta(dicomData)
  return { dicomData, dataset, meta }
}

function extractHeader(dicomData, dataset, meta) {
  const functionalGroups = getFunctionalGroups(dataset)
  const rows = toNumber(dataset.Rows, 0)
  const cols = toNumber(dataset.Columns, 0)
  const declaredFrames = Math.max(1, toNumber(dataset.NumberOfFrames, 1))
  const geometry = getFrameGeometry(dataset, functionalGroups, declaredFrames)
  const spacingBetweenSlices = toNumber(
    dataset.SpacingBetweenSlices,
    toNumber(functionalGroups.pixelMeasures.SpacingBetweenSlices)
  )
  const sliceThickness = toNumber(
    dataset.SliceThickness,
    toNumber(functionalGroups.pixelMeasures.SliceThickness)
  )

  return {
    rows,
    cols,
    declaredFrames,
    bitsAllocated: toNumber(dataset.BitsAllocated, 16),
    bitsStored: toNumber(dataset.BitsStored, toNumber(dataset.BitsAllocated, 16)),
    highBit: toNumber(dataset.HighBit, toNumber(dataset.BitsStored, 16) - 1),
    pixelRepresentation: toNumber(dataset.PixelRepresentation, 0),
    samplesPerPixel: Math.max(1, toNumber(dataset.SamplesPerPixel, 1)),
    transferSyntaxUid: getTransferSyntaxUid(dicomData, meta),
    pixelSpacing: getPixelSpacing(dataset, functionalGroups),
    spacingBetweenSlices,
    sliceThickness,
    instanceNumber: toNumber(dataset.InstanceNumber),
    modality: toText(dataset.Modality),
    seriesInstanceUid: toText(dataset.SeriesInstanceUID) || '?',
    studyInstanceUid: toText(dataset.StudyInstanceUID),
    sopInstanceUid: toText(dataset.SOPInstanceUID),
    seriesDescription: toText(dataset.SeriesDescription) || '—',
    reconstructionMethod: toText(dataset.ReconstructionMethod) || '—',
    convolutionKernel: toText(dataset.ConvolutionKernel) || '—',
    manufacturer: toText(dataset.Manufacturer),
    modelName: toText(dataset.ManufacturerModelName),
    units: toText(dataset.Units) || '—',
    rescaleSlope: toNumber(dataset.RescaleSlope, 1),
    rescaleIntercept: toNumber(dataset.RescaleIntercept, 0),
    hasPixelData: Boolean(dicomData.dict['7FE00010']),
    ...geometry
  }
}

function readHeader(arrayBuffer) {
  const { dicomData, dataset, meta } = readDicomStructure(arrayBuffer)
  return extractHeader(dicomData, dataset, meta)
}

function getPixelDataBytes(pixelDataElement, arrayBuffer) {
  const value = pixelDataElement.Value || pixelDataElement.value
  const first = Array.isArray(value) ? value[0] : value

  if (first instanceof ArrayBuffer) return new Uint8Array(first)
  if (ArrayBuffer.isView(first)) {
    return new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
  }
  if (typeof first === 'string') {
    const binary = atob(first)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
  }

  if (
    pixelDataElement.dataOffset == null
    || pixelDataElement.length == null
    || pixelDataElement.length <= 0
  ) {
    throw new Error('Pixel Data sin offset o encapsulado no soportado.')
  }
  return new Uint8Array(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length)
}

function readUnsignedPixel(view, byteOffset, bitsAllocated, littleEndian) {
  if (bitsAllocated === 8) return view.getUint8(byteOffset)
  if (bitsAllocated === 16) return view.getUint16(byteOffset, littleEndian)
  if (bitsAllocated === 32) return view.getUint32(byteOffset, littleEndian)
  throw new Error(`Bits Allocated=${bitsAllocated} no soportado.`)
}

function normalizeStoredPixel(rawValue, bitsStored, highBit, pixelRepresentation) {
  const shift = Math.max(0, highBit - bitsStored + 1)
  const range = 2 ** bitsStored
  let value = Math.floor(rawValue / 2 ** shift) % range
  if (pixelRepresentation === 1 && value >= range / 2) value -= range
  return value
}

function decodeDicom(arrayBuffer) {
  const { dicomData, dataset, meta } = readDicomStructure(arrayBuffer)
  const header = extractHeader(dicomData, dataset, meta)

  if (!header.rows || !header.cols || !header.hasPixelData) {
    throw new Error('El DICOM no contiene una imagen válida.')
  }
  if (!NATIVE_TRANSFER_SYNTAXES.has(header.transferSyntaxUid)) {
    throw new Error(`Transfer Syntax comprimida no soportada: ${header.transferSyntaxUid}`)
  }
  if (header.samplesPerPixel !== 1) {
    throw new Error(`Samples Per Pixel=${header.samplesPerPixel} no soportado.`)
  }
  if (header.bitsAllocated % 8 !== 0) {
    throw new Error(`Bits Allocated=${header.bitsAllocated} no está alineado a bytes.`)
  }

  const pixelData = getPixelDataBytes(dicomData.dict['7FE00010'], arrayBuffer)
  const pixelsPerFrame = header.rows * header.cols
  const bytesPerPixel = header.bitsAllocated / 8
  const bytesPerFrame = pixelsPerFrame * bytesPerPixel
  const availableFrames = Math.floor(pixelData.byteLength / bytesPerFrame)
  const frameCount = Math.min(header.declaredFrames, availableFrames)
  if (frameCount < 1) throw new Error('Pixel Data es más corto que un frame completo.')

  const littleEndian = header.transferSyntaxUid !== '1.2.840.10008.1.2.2'
  const frames = []
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const byteOffset = pixelData.byteOffset + frameIndex * bytesPerFrame
    const view = new DataView(pixelData.buffer, byteOffset, bytesPerFrame)
    const values = new Float32Array(pixelsPerFrame)
    for (let pixelIndex = 0; pixelIndex < pixelsPerFrame; pixelIndex++) {
      const raw = readUnsignedPixel(
        view,
        pixelIndex * bytesPerPixel,
        header.bitsAllocated,
        littleEndian
      )
      const stored = normalizeStoredPixel(
        raw,
        header.bitsStored,
        header.highBit,
        header.pixelRepresentation
      )
      values[pixelIndex] = stored * header.rescaleSlope + header.rescaleIntercept
    }
    frames.push(values)
  }

  return { header, frames }
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function populationStandardDeviation(values, average) {
  if (!values.length) return 0
  return Math.sqrt(
    values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length
  )
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function progress(onProgress, phase, current, total, message) {
  onProgress?.({ phase, current, total, fraction: total ? current / total : 0, message })
}

export async function loadPetDicomSeries(inputFiles, { onProgress } = {}) {
  const files = Array.from(inputFiles || []).filter((file) => file && file.size > 0)
  if (!files.length) throw new Error('No se han recibido archivos para analizar.')

  const readable = []
  let invalidFiles = 0
  for (let index = 0; index < files.length; index++) {
    progress(onProgress, 'headers', index, files.length, `Leyendo cabeceras DICOM ${index + 1}/${files.length}`)
    try {
      const header = readHeader(await files[index].arrayBuffer())
      if (header.hasPixelData && header.rows > 0 && header.cols > 0) {
        readable.push({ file: files[index], header })
      } else {
        invalidFiles++
      }
    } catch {
      invalidFiles++
    }
    if (index % 8 === 7) await yieldToBrowser()
  }
  progress(onProgress, 'headers', files.length, files.length, 'Cabeceras DICOM leídas')

  if (!readable.length) {
    throw new Error('No se han encontrado imágenes DICOM válidas en la selección.')
  }

  const warnings = []
  const petRecords = readable.filter(({ header }) => header.modality === 'PT')
  const candidates = petRecords.length ? petRecords : readable
  if (!petRecords.length) {
    warnings.push('No se encontró Modality=PT; se ha usado la serie de imagen más larga disponible.')
  }

  const groups = new Map()
  for (const record of candidates) {
    const key = record.header.seriesInstanceUid || '?'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  if (groups.size > 1) {
    warnings.push(`Se encontraron ${groups.size} series candidatas; se usa la serie PT con más imágenes.`)
  }

  let selected = null
  let selectedFrameCount = -1
  for (const records of groups.values()) {
    const seenSops = new Set()
    const unique = records.filter(({ header }) => {
      if (!header.sopInstanceUid) return true
      if (seenSops.has(header.sopInstanceUid)) return false
      seenSops.add(header.sopInstanceUid)
      return true
    })
    const frameCount = unique.reduce((total, record) => total + record.header.declaredFrames, 0)
    if (frameCount > selectedFrameCount) {
      selected = unique
      selectedFrameCount = frameCount
    }
  }

  const unsupportedSyntaxes = [...new Set(
    selected
      .map(({ header }) => header.transferSyntaxUid)
      .filter((uid) => !NATIVE_TRANSFER_SYNTAXES.has(uid))
  )]
  if (unsupportedSyntaxes.length) {
    throw new Error(
      `La serie usa Pixel Data comprimido (${unsupportedSyntaxes.join(', ')}). Exporta el PET como DICOM nativo sin compresión.`
    )
  }

  const decodedFrames = []
  for (let recordIndex = 0; recordIndex < selected.length; recordIndex++) {
    progress(
      onProgress,
      'pixels',
      recordIndex,
      selected.length,
      `Decodificando PET ${recordIndex + 1}/${selected.length}`
    )
    const { header, frames } = decodeDicom(await selected[recordIndex].file.arrayBuffer())
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
      decodedFrames.push({
        pixels: frames[frameIndex],
        header,
        frameIndex,
        orientation: header.frameOrientations[frameIndex] || header.frameOrientations[0] || [],
        position: header.framePositions[frameIndex] || header.framePositions[0] || []
      })
    }
    if (recordIndex % 4 === 3) await yieldToBrowser()
  }
  progress(onProgress, 'pixels', selected.length, selected.length, 'Serie PET decodificada')

  if (decodedFrames.length < 2) {
    throw new Error('Se necesitan al menos dos cortes para formar un volumen PET.')
  }

  const first = decodedFrames[0].header
  if (!first.pixelSpacing || first.pixelSpacing.length < 2) {
    throw new Error('Pixel Spacing no está presente en la serie PET.')
  }
  for (const frame of decodedFrames) {
    if (frame.header.rows !== first.rows || frame.header.cols !== first.cols) {
      throw new Error('La serie seleccionada contiene matrices de distinto tamaño.')
    }
    const spacing = frame.header.pixelSpacing
    if (
      !spacing
      || Math.abs(spacing[0] - first.pixelSpacing[0]) > 1e-3
      || Math.abs(spacing[1] - first.pixelSpacing[1]) > 1e-3
    ) {
      throw new Error('La serie seleccionada contiene Pixel Spacing no homogéneo.')
    }
  }

  const orientation = decodedFrames.find((frame) => frame.orientation.length >= 6)?.orientation
  let normal = [0, 0, 1]
  if (orientation) {
    normal = cross(orientation.slice(0, 3), orientation.slice(3, 6))
  } else {
    warnings.push('Falta Image Orientation Patient; los cortes se ordenan por Instance Number.')
  }

  for (const frame of decodedFrames) {
    if (frame.position.length >= 3) {
      frame.projectedPosition = dot(frame.position, normal)
    } else if (
      frame.header.framePositions[0]?.length >= 3
      && Number.isFinite(frame.header.spacingBetweenSlices)
    ) {
      frame.projectedPosition = dot(frame.header.framePositions[0], normal)
        + frame.frameIndex * Math.abs(frame.header.spacingBetweenSlices)
    } else {
      frame.projectedPosition = Number.NaN
    }
  }

  const spatialOrderAvailable = decodedFrames.every((frame) => Number.isFinite(frame.projectedPosition))
  if (spatialOrderAvailable) {
    decodedFrames.sort((a, b) => a.projectedPosition - b.projectedPosition)
  } else {
    decodedFrames.sort((a, b) => {
      const instanceA = Number.isFinite(a.header.instanceNumber) ? a.header.instanceNumber : 0
      const instanceB = Number.isFinite(b.header.instanceNumber) ? b.header.instanceNumber : 0
      return instanceA - instanceB || a.frameIndex - b.frameIndex
    })
  }

  let dz
  let axialSpacingSd = 0
  if (spatialOrderAvailable) {
    const differences = []
    for (let index = 1; index < decodedFrames.length; index++) {
      const difference = Math.abs(
        decodedFrames[index].projectedPosition - decodedFrames[index - 1].projectedPosition
      )
      if (difference > 1e-6) differences.push(difference)
    }
    if (differences.length) {
      dz = differences.reduce((total, value) => total + value, 0) / differences.length
      axialSpacingSd = populationStandardDeviation(differences, dz)
    }
  }
  if (!(dz > 0)) {
    dz = Math.abs(first.spacingBetweenSlices) || Math.abs(first.sliceThickness)
    warnings.push('La separación axial se ha tomado de Spacing Between Slices/Slice Thickness.')
  }
  if (!(dz > 0)) throw new Error('No se ha podido determinar la separación axial entre cortes.')
  if (axialSpacingSd > 0.1 * dz) {
    warnings.push(`Espaciado axial no uniforme: ${dz.toFixed(2)} ± ${axialSpacingSd.toFixed(2)} mm.`)
  }
  if (first.units !== 'BQML') {
    warnings.push(`Las unidades DICOM son ${first.units || 'desconocidas'}; se esperaba BQML.`)
  }

  const equipment = `${first.manufacturer} ${first.modelName}`.trim() || '—'
  return {
    volume: decodedFrames.map((frame) => frame.pixels),
    rows: first.rows,
    cols: first.cols,
    pixelSpacing: first.pixelSpacing,
    dz,
    units: first.units,
    warnings,
    info: {
      equipment,
      seriesDescription: first.seriesDescription,
      reconstructionMethod: first.reconstructionMethod,
      convolutionKernel: first.convolutionKernel,
      matrix: `${first.rows} × ${first.cols}`,
      sliceCount: decodedFrames.length,
      pixelSpacing: first.pixelSpacing,
      sliceThickness: first.sliceThickness,
      axialSpacing: dz,
      units: first.units,
      selectedFileCount: selected.length,
      receivedFileCount: files.length,
      invalidFileCount: invalidFiles,
      candidateSeriesCount: groups.size
    }
  }
}

function readFileEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function readDirectoryBatch(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function readAllDirectoryEntries(directoryEntry) {
  const reader = directoryEntry.createReader()
  const entries = []
  while (true) {
    const batch = await readDirectoryBatch(reader)
    if (!batch.length) break
    entries.push(...batch)
  }
  return entries
}

async function filesFromEntry(entry) {
  if (entry.isFile) return [await readFileEntry(entry)]
  if (!entry.isDirectory) return []
  const children = await readAllDirectoryEntries(entry)
  const nested = await Promise.all(children.map((child) => filesFromEntry(child)))
  return nested.flat()
}

export async function collectDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer?.items || [])
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean)

  if (!entries.length) return Array.from(dataTransfer?.files || [])
  const nested = await Promise.all(entries.map((entry) => filesFromEntry(entry)))
  return nested.flat()
}
