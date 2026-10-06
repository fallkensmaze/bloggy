import dcmjs from 'dcmjs'
import { assertNativeTransferSyntax, getPixelDataBytes, isLittleEndian, normalizeStoredPixel,
  readTransferSyntaxUid, readUnsignedPixel, resolveFrameCount } from './dicomPixels.js'

const { DicomMessage, DicomMetaDictionary } = dcmjs.data
const parts = v => (Array.isArray(v) ? v.flatMap(parts) : v == null ? [] : String(v).split('\\'))
const numbers = v => parts(v).map(x => x.trim() === '' ? NaN : Number(x))
const num = v => numbers(v)[0] ?? NaN
const txt = v => parts(v).join('\\').trim()
const items = v => Array.isArray(v) ? v : v ? [v] : []
const first = v => items(v)[0] || {}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
const isVector = (a, n) => a.length === n && a.every(Number.isFinite)
const nearVector = (a, b, tol) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol)

function orientationNormal(o) {
  if (!isVector(o, 6)) return null
  const x = o.slice(0, 3), y = o.slice(3, 6)
  if (Math.abs(Math.hypot(...x) - 1) > 1e-4 || Math.abs(Math.hypot(...y) - 1) > 1e-4 || Math.abs(dot(x, y)) > 1e-4) {
    throw new Error('ImageOrientationPatient no define ejes ortonormales.')
  }
  return cross(x, y)
}

function calibration(dataset, shared, group) {
  for (const [object, source] of [[first(group.PixelValueTransformationSequence), 'per-frame'],
    [first(shared.PixelValueTransformationSequence), 'shared'], [dataset, 'dataset']]) {
    if (object.RescaleSlope == null && object.RescaleIntercept == null) continue
    const slope = num(object.RescaleSlope), intercept = object.RescaleIntercept == null ? 0 : num(object.RescaleIntercept)
    if (!Number.isFinite(slope) || slope <= 0 || !Number.isFinite(intercept)) throw new Error('Rescale Slope/Intercept inválido.')
    return { slope, intercept, source, rescaleType: txt(object.RescaleType) }
  }
  return { slope: 1, intercept: 0, source: 'identity', rescaleType: '' }
}

// Single reconstructed NM volume only. Never choose the longest series, drop
// unreadable files, interpret projections as slices, or sort by filename.
export async function loadTomoDicomSeries(inputFiles, onProgress) {
  const files = Array.from(inputFiles || [])
  if (!files.length) throw new Error('Selecciona un DICOM multiframe o todos los cortes de una serie SPECT reconstruida.')
  const frames = [], warnings = [], sops = new Set(), series = new Set(), studies = new Set(), units = new Set()
  let info = null, dimensions = null, voxelCount = 0
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    onProgress?.(`Leyendo SPECT ${fileIndex + 1}/${files.length}`)
    const buffer = await files[fileIndex].arrayBuffer(), raw = DicomMessage.readFile(buffer)
    const d = DicomMetaDictionary.naturalizeDataset(raw.dict), syntax = readTransferSyntaxUid(raw)
    assertNativeTransferSyntax(syntax)
    if (txt(d.Modality) !== 'NM' || parts(d.ImageType)[2] !== 'RECON TOMO') {
      throw new Error('Se requiere NM con ImageType RECON TOMO. Selecciona el volumen SPECT reconstruido, sin CT, proyecciones TOMO ni fases gated.')
    }
    for (const key of ['EnergyWindowVector', 'DetectorVector', 'TimeSlotVector', 'RRIntervalVector', 'TimeSliceVector', 'RotationVector']) {
      if (new Set(parts(d[key])).size > 1) throw new Error(`El archivo mezcla ${key}. Exporta un único volumen reconstruido.`)
    }
    if (!txt(d.SeriesInstanceUID) || !txt(d.SOPInstanceUID)) throw new Error('Falta la identidad DICOM de la serie o de la instancia.')
    if (sops.has(txt(d.SOPInstanceUID))) throw new Error('Se ha seleccionado una instancia DICOM duplicada.')
    sops.add(txt(d.SOPInstanceUID)); series.add(txt(d.SeriesInstanceUID)); studies.add(txt(d.StudyInstanceUID)); units.add(txt(d.Units) || 'u.a.')
    if (series.size > 1 || studies.size > 1 || units.size > 1) throw new Error('La selección mezcla series, estudios o unidades. Carga una sola reconstrucción.')
    const rows = num(d.Rows), cols = num(d.Columns), count = d.NumberOfFrames == null ? 1 : num(d.NumberOfFrames)
    const bits = num(d.BitsAllocated), stored = num(d.BitsStored), high = num(d.HighBit), signed = num(d.PixelRepresentation)
    if (![rows, cols, count].every(v => Number.isInteger(v) && v > 0) || ![8, 16, 32].includes(bits)
      || !Number.isInteger(stored) || stored < 1 || stored > bits || !Number.isInteger(high) || high < stored - 1 || high >= bits
      || ![0, 1].includes(signed) || num(d.SamplesPerPixel) !== 1 || txt(d.PhotometricInterpretation) !== 'MONOCHROME2') {
      throw new Error('Geometría o codificación de píxel NM no soportada.')
    }
    voxelCount += rows * cols * count
    if (voxelCount > 32_000_000) throw new Error('La selección supera 32 millones de vóxeles.')
    if (dimensions && (dimensions.rows !== rows || dimensions.cols !== cols)) throw new Error('Los cortes tienen matrices diferentes.')
    dimensions = { rows, cols }
    const bytes = getPixelDataBytes(raw.dict['7FE00010'], buffer)
    const resolved = resolveFrameCount(count, bytes.byteLength, rows * cols * bits / 8)
    if (!resolved.paddingOnly) throw new Error('Pixel Data contiene bytes sobrantes incompatibles con NumberOfFrames.')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const shared = first(d.SharedFunctionalGroupsSequence), groups = items(d.PerFrameFunctionalGroupsSequence)
    if (groups.length && groups.length !== count) throw new Error('Los grupos funcionales no coinciden con NumberOfFrames.')
    const detector = first(d.DetectorInformationSequence)
    const baseOrientation = numbers(first(shared.PlaneOrientationSequence).ImageOrientationPatient ?? d.ImageOrientationPatient ?? detector.ImageOrientationPatient)
    const basePosition = numbers(first(shared.PlanePositionSequence).ImagePositionPatient ?? d.ImagePositionPatient ?? detector.ImagePositionPatient)
    const baseNormal = orientationNormal(baseOrientation)
    const sbs = num(first(shared.PixelMeasuresSequence).SpacingBetweenSlices ?? d.SpacingBetweenSlices)
    const sliceVector = numbers(d.SliceVector)
    if (sliceVector.length && (sliceVector.length !== count || sliceVector.some(v => !Number.isInteger(v) || v < 1) || new Set(sliceVector).size !== count)) {
      throw new Error('SliceVector tiene longitud incorrecta o cortes repetidos: no es un único volumen 3D.')
    }
    if (count > 1 && sliceVector.length) {
      const sorted = [...sliceVector].sort((a, b) => a - b)
      if (sorted.some((v, i) => i && v !== sorted[i - 1] + 1)) throw new Error('SliceVector contiene huecos entre cortes.')
    }
    if (count > 1 && d.NumberOfSlices != null && num(d.NumberOfSlices) !== count) throw new Error('NumberOfSlices no coincide con el volumen; comprueba fases o cortes ausentes.')
    if (count > 1 && !groups.length && !sliceVector.length) warnings.push('No hay SliceVector: se conserva el orden de frames del único archivo multiframe. Verifica los tres planos.')
    if (count > 1 && files.length > 1 && !isVector(basePosition, 3) && !groups.length) throw new Error('No se pueden concatenar archivos multiframe sin posiciones físicas.')
    for (let f = 0; f < count; f++) {
      const group = groups[f] || {}, measures = first(group.PixelMeasuresSequence)
      const spacing = numbers(measures.PixelSpacing ?? first(shared.PixelMeasuresSequence).PixelSpacing ?? d.PixelSpacing)
      if (!isVector(spacing, 2) || spacing.some(v => v <= 0)) throw new Error('Falta PixelSpacing positivo en cada corte.')
      const orientation = numbers(first(group.PlaneOrientationSequence).ImageOrientationPatient ?? baseOrientation)
      const normal = orientationNormal(orientation)
      let position = numbers(first(group.PlanePositionSequence).ImagePositionPatient)
      let localZ = NaN
      if (!isVector(position, 3)) {
        if (count === 1) position = basePosition
        else {
          if (!Number.isFinite(sbs) || sbs === 0) throw new Error('Falta SpacingBetweenSlices. SliceThickness no sustituye la distancia entre cortes.')
          localZ = ((sliceVector[f] ?? f + 1) - (sliceVector[0] ?? 1)) * sbs
          if (baseNormal && isVector(basePosition, 3)) position = basePosition.map((v, i) => v + baseNormal[i] * localZ)
        }
      }
      if ((d.RealWorldValueMappingSequence || shared.RealWorldValueMappingSequence || group.RealWorldValueMappingSequence || d.ModalityLUTSequence)) {
        throw new Error('La imagen contiene una transformación LUT/RealWorldValueMapping no soportada. Exporta valores con Rescale Slope/Intercept.')
      }
      const cal = calibration(d, shared, group), pixels = new Float32Array(rows * cols)
      for (let i = 0; i < pixels.length; i++) {
        const rawValue = readUnsignedPixel(view, (f * pixels.length + i) * bits / 8, bits, isLittleEndian(syntax))
        pixels[i] = normalizeStoredPixel(rawValue, stored, high, signed) * cal.slope + cal.intercept
        if (!Number.isFinite(pixels[i])) throw new Error('El reescalado produce valores no finitos.')
      }
      frames.push({ pixels, spacing, orientation, normal, position, localZ, cal,
        declaredSpacing: num(measures.SpacingBetweenSlices ?? first(shared.PixelMeasuresSequence).SpacingBetweenSlices ?? d.SpacingBetweenSlices),
        sourceFrame: f + 1 })
    }
    if (!info) info = {
      equipment: [txt(d.Manufacturer), txt(d.ManufacturerModelName)].filter(Boolean).join(' ') || 'No declarado',
      reconstructionMethod: txt(d.ReconstructionMethod) || 'No declarado', convolutionKernel: txt(d.ConvolutionKernel) || 'No declarado',
      correctedImage: txt(d.CorrectedImage) || 'No declarado', imageType: txt(d.ImageType), sourceFiles: files.length,
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  if (frames.length < 3) throw new Error('Se requieren al menos tres cortes para analizar uniformidad 3D.')
  const start = frames[0]
  if (frames.some(f => !nearVector(f.spacing, start.spacing, 1e-4))) throw new Error('El tamaño de píxel cambia entre cortes.')
  const spatial = frames.every(f => f.normal && isVector(f.position, 3))
  if (spatial) {
    if (frames.some(f => !nearVector(f.orientation, start.orientation, 1e-4))) throw new Error('Los cortes tienen orientaciones diferentes.')
    for (const f of frames) {
      const offset = f.position.map((v, i) => v - start.position[i])
      const projected = dot(offset, start.normal)
      if (Math.hypot(...offset.map((v, i) => v - start.normal[i] * projected)) > 0.01) throw new Error('Los cortes presentan desplazamiento lateral; se requiere una rejilla 3D regular.')
      f.order = dot(f.position, start.normal)
    }
  } else {
    if (files.length !== 1 || frames.some(f => !Number.isFinite(f.localZ))
      || frames.some(f => !nearVector(f.orientation, start.orientation, 1e-4))) throw new Error('No se puede determinar un orden espacial fiable de los cortes.')
    frames.forEach(f => { f.order = f.localZ })
    warnings.push('Sin posición/orientación completa: se usa una rejilla local definida por SliceVector y SpacingBetweenSlices; los ejes no son etiquetas anatómicas.')
  }
  frames.sort((a, b) => a.order - b.order)
  const differences = frames.slice(1).map((f, i) => f.order - frames[i].order)
  const dz = differences.reduce((s, v) => s + v, 0) / differences.length
  if (!(dz > 0) || differences.some(v => v <= 1e-6 || Math.abs(v - dz) > Math.max(0.01, dz * 0.001))) {
    throw new Error('Hay cortes duplicados, ausentes o espaciado irregular. No se interpola ni se inventan cortes.')
  }
  if (frames.some(f => Number.isFinite(f.declaredSpacing)
    && Math.abs(Math.abs(f.declaredSpacing) - dz) > Math.max(0.01, dz * 0.001))) {
    throw new Error('Las posiciones físicas no concuerdan con SpacingBetweenSlices; comprueba cortes omitidos o cabeceras inconsistentes.')
  }
  const calibrations = frames.map(f => f.cal)
  if (calibrations.some(c => c.source === 'identity')) warnings.push('Algunos cortes no declaran Rescale: se usan sus valores almacenados. Las unidades se muestran tal como se exportaron.')
  if (new Set(calibrations.map(c => c.rescaleType)).size > 1) throw new Error('La serie mezcla tipos de reescalado.')
  return { ...dimensions, volume: frames.map(f => f.pixels), pixelSpacing: start.spacing, dz, units: [...units][0],
    warnings: [...new Set(warnings)], info: { ...info, calibration: calibrations, sourceFrameOrder: frames.map(f => f.sourceFrame),
      geometrySource: spatial ? 'ImagePositionPatient + ImageOrientationPatient' : 'Rejilla local NM',
      originalSpacingMm: [...start.spacing, dz] } }
}
