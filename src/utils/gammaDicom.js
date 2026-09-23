import dcmjs from 'dcmjs'
import {
  assertNativeTransferSyntax, getPixelDataBytes, isLittleEndian,
  normalizeStoredPixel, readTransferSyntaxUid, readUnsignedPixel, resolveFrameCount
} from './dicomPixels.js'

const first = value => Array.isArray(value) ? value[0] : value
const list = value => value == null ? [] : Array.isArray(value) ? value : [value]
const text = value => String(first(value) ?? '').trim()
export function numberOrNull(value) {
  const v = first(value)
  return v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v)
}

// A DICOM wall-clock date, deliberately without conversion to the browser's timezone.
export function dicomDateTime(date, time = '') {
  const d = text(date), t = text(time)
  if (!/^\d{8}$/.test(d)) return ''
  const day = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  const check = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== day) return ''
  if (!/^\d{6}(\.\d+)?$/.test(t)) return day
  return `${day}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}${t.includes('.') ? t.slice(6) : ''}`
}

/** Native NM pixels + allowlisted QC metadata. Never retain patient fields. */
export function parseGammaDicom(buffer) {
  const raw = dcmjs.data.DicomMessage.readFile(buffer)
  const d = dcmjs.data.DicomMetaDictionary.naturalizeDataset(raw.dict)
  if (text(d.Modality) !== 'NM') throw new Error('Se requiere un DICOM de medicina nuclear (NM).')
  const syntax = readTransferSyntaxUid(raw)
  assertNativeTransferSyntax(syntax)
  const rows = numberOrNull(d.Rows), cols = numberOrNull(d.Columns)
  const bits = numberOrNull(d.BitsAllocated)
  const stored = numberOrNull(d.BitsStored) ?? bits
  const high = numberOrNull(d.HighBit) ?? stored - 1
  if (!(Number.isInteger(rows) && Number.isInteger(cols) && rows > 0 && cols > 0) || ![8, 16, 32].includes(bits)
      || !(Number.isInteger(stored) && Number.isInteger(high) && stored > 0 && stored <= bits && high >= stored - 1 && high < bits)
      || (numberOrNull(d.SamplesPerPixel) ?? 1) !== 1) throw new Error('Geometría o codificación de píxel no soportada.')
  const bytes = getPixelDataBytes(raw.dict['7FE00010'], buffer)
  const frameBytes = rows * cols * bits / 8
  const sizing = resolveFrameCount(numberOrNull(d.NumberOfFrames) ?? 1, bytes.byteLength, frameBytes)
  const slope = numberOrNull(d.RescaleSlope) ?? 1
  const intercept = numberOrNull(d.RescaleIntercept) ?? 0
  const units = text(d.Units).toUpperCase()
  const imageType = list(d.ImageType).map(v => String(v).toUpperCase())
  const warnings = []
  if (!sizing.paddingOnly) warnings.push('Hay bytes sobrantes en PixelData; no se interpretan como frames.')
  const frames = [], frameInfo = []
  const detectors = list(d.DetectorInformationSequence), windows = list(d.EnergyWindowInformationSequence)
  const detectorVector = list(d.DetectorVector), windowVector = list(d.EnergyWindowVector)
  const functionalGroups = list(d.PerFrameFunctionalGroupsSequence)
  // Enhanced/per-frame transformations must not silently become root-level identity.
  if (functionalGroups.length || d.SharedFunctionalGroupsSequence) throw new Error('NM con grupos funcionales no soportado: exporta NM clásico sin comprimir.')
  for (let f = 0; f < sizing.frameCount; f++) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + f * frameBytes, frameBytes)
    const pixels = new Float64Array(rows * cols)
    let totalCounts = 0, negative = false
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = normalizeStoredPixel(readUnsignedPixel(view, i * bits / 8, bits, isLittleEndian(syntax)),
        stored, high, numberOrNull(d.PixelRepresentation) ?? 0) * slope + intercept
      totalCounts += pixels[i]
      negative ||= pixels[i] < 0
    }
    const det = numberOrNull(detectorVector[f]) ?? (detectors.length === 1 ? 1 : null)
    const win = numberOrNull(windowVector[f]) ?? (windows.length === 1 ? 1 : null)
    const detector = detectors[det - 1], window = windows[win - 1]
    const range = list(window?.EnergyWindowRangeSequence)[0]
    const durationMs = numberOrNull(d.ActualFrameDuration)
    frames.push(pixels)
    frameInfo.push({ frameIndex: f, detectorNumber: detector ? det : null,
      energyWindowNumber: window ? win : null, energyWindowName: text(window?.EnergyWindowName),
      energyWindowKeV: [numberOrNull(range?.EnergyWindowLowerLimit), numberOrNull(range?.EnergyWindowUpperLimit)],
      view: text(list(detector?.ViewCodeSequence)[0]?.CodeMeaning),
      collimator: text(detector?.CollimatorGridName), collimatorType: text(detector?.CollimatorType),
      totalCounts, durationSeconds: durationMs > 0 ? durationMs / 1000 : null,
      // Empty units are frequent in original static NM. Only raw, nonnegative counts qualify.
      countsUsable: !negative && slope === 1 && intercept === 0 && ['', 'CNTS'].includes(units)
        && imageType.includes('ORIGINAL') && imageType.includes('EMISSION')
        && !list(d.CorrectedImage).some(v => ['DECY', 'ATTN', 'SCAT'].includes(String(v))),
    })
  }
  const spacing = list(d.PixelSpacing).map(numberOrNull)
  const station = text(d.StationName), serial = text(d.DeviceSerialNumber)
  const rotations = list(d.RotationInformationSequence), rotationVector = list(d.RotationVector)
  const hasCorGeometry = list(d.AngularViewVector).length === frames.length
    && detectorVector.length === frames.length && rotations.length > 0
    && (rotations.length === 1 || rotationVector.length === frames.length)
    && frameInfo.every(f => f.detectorNumber != null && f.energyWindowNumber != null)
    && new Set(frameInfo.map(f => f.energyWindowNumber)).size === 1
    && rotations.every(r => numberOrNull(r.AngularStep) > 0 && ['CW', 'CC'].includes(text(r.RotationDirection)))
    && frameInfo.every((f, i) => numberOrNull(detectors[f.detectorNumber - 1]?.StartAngle) != null
      || numberOrNull(rotations[(numberOrNull(rotationVector[i]) ?? 1) - 1]?.StartAngle) != null)
  return { rows, cols, frames, frameInfo,
    pixelSpacing: spacing.length === 2 && spacing.every(v => v > 0) ? spacing : null,
    isStatic: imageType.includes('STATIC'),
    // Presence of real angular metadata is required by the monthly COR adapter.
    hasCorGeometry,
    metadata: { equipment: [station, serial].filter(Boolean).join(' · '), station, serial,
      model: [text(d.Manufacturer), text(d.ManufacturerModelName)].filter(Boolean).join(' '),
      acquiredAt: dicomDateTime(d.AcquisitionDate, d.AcquisitionTime)
        || dicomDateTime(text(d.AcquisitionDateTime).slice(0, 8), text(d.AcquisitionDateTime).slice(8).replace(/[+-]\d{4}$/, '')),
      description: text(d.SeriesDescription),
      radionuclide: text(list(list(d.RadiopharmaceuticalInformationSequence)[0]?.RadionuclideCodeSequence)[0]?.CodeMeaning),
      transferSyntax: syntax, units: units || 'No declaradas; comprobar cuentas originales',
    }, imageType, instanceUid: text(d.SOPInstanceUID), warnings }
}

export function classifyGamma(image) {
  const label = image.metadata.description.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\bcor\b|cent(ro|er|re).*rota/.test(label)) return 'cor'
  if (/resol/.test(label)) return 'resolution'
  if (/sensi/.test(label)) return 'sensitivity'
  if (/unif|flood/.test(label)) return 'uniformity'
  if (/recon|tomograf/.test(label) || (image.imageType.includes('DERIVED') && image.imageType.includes('TOMO'))) return 'tomography'
  return 'unknown'
}
