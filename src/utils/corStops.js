import dcmjs from 'dcmjs'
import { parseDICOM } from './dicomParser.js'

// COR acquired as one NM file per stop (gantry position). Each file holds one frame per head
// and no AngularViewVector/RotationInformationSequence, so the angular step and the direction
// of rotation are NOT in the data (Siemens Symbia exports StartAngle only in the first stop).
// They must be declared; this module never infers them from the projections.

const { DicomMessage, DicomMetaDictionary } = dcmjs.data
const list = value => value == null ? [] : Array.isArray(value) ? value : [value]
const num = value => value == null || String(value).trim() === '' ? NaN : Number(value)
const text = value => String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim()
const normalizeAngle = angle => ((angle % 360) + 360) % 360
const joinEs = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
const sameAngle = (a, b) => Math.abs(((a - b + 180) % 360 + 360) % 360 - 180) <= 0.1

export { joinEs as joinSpanishList }
export const COR_STOP_METHOD = 'cor-stops-1.0'

function viewFromCode(detector) {
  const label = list(detector?.ViewCodeSequence).map(c => `${c?.CodeMeaning ?? ''} ${c?.CodeValue ?? ''}`).join(' ')
  const match = label.match(/\bview\s*(\d+)\b/i)
  return match ? Number(match[1]) : NaN
}

/** True when the dataset carries its own angular vectors (a classic multiframe tomographic COR). */
export function hasAngularVectors(dataset) {
  return list(dataset.AngularViewVector).length > 0 || list(dataset.RotationInformationSequence).length > 0
}

/** Read one stop: native pixels plus the per-head identity, radius and optional view label. */
export function readCorStop(buffer, name = '') {
  const label = name || 'DICOM'
  const image = parseDICOM(buffer)
  const dataset = DicomMetaDictionary.naturalizeDataset(DicomMessage.readFile(buffer).dict)
  if (image.modality && image.modality !== 'NM') throw new Error(`${label}: se esperaba modalidad NM y se recibió ${image.modality}.`)
  if (hasAngularVectors(dataset)) throw new Error(`${label}: es una adquisición tomográfica con vectores angulares; cárgala sola como objeto multiframe.`)
  const detectors = list(dataset.DetectorInformationSequence)
  const frameCount = image.frames.length
  const vector = list(dataset.DetectorVector).map(num)
  const heads = vector.length ? vector : frameCount === 1 && detectors.length === 1 ? [1] : []
  if (heads.length !== frameCount || heads.some(h => !Number.isInteger(h) || h < 1 || !detectors[h - 1])) {
    throw new Error(`${label}: DetectorVector ausente o inválido; no se infiere el cabezal de cada frame.`)
  }
  if (new Set(heads).size !== heads.length) throw new Error(`${label}: un cabezal aparece en varios frames; cada parada debe tener una sola vista por cabezal.`)
  const windows = list(dataset.EnergyWindowInformationSequence)
  const windowVector = list(dataset.EnergyWindowVector).map(num)
  if (windows.length !== 1 || windowVector.some(v => v !== 1)) throw new Error(`${label}: se requiere una única ventana de energía identificada.`)
  const range = list(windows[0].EnergyWindowRangeSequence)[0] || {}
  const pixelSpacing = image.pixelSpacing && list(dataset.PixelSpacing).length >= 2 ? image.pixelSpacing : null
  return {
    name: label,
    rows: image.rows,
    cols: image.cols,
    pixelSpacing,
    frames: image.frames,
    rescaleSlope: image.rescaleSlope,
    rescaleIntercept: image.rescaleIntercept,
    seriesUid: text(dataset.SeriesInstanceUID),
    sopUid: text(dataset.SOPInstanceUID),
    instanceNumber: num(dataset.InstanceNumber),
    imagesInAcquisition: num(dataset.ImagesInAcquisition),
    station: text(dataset.StationName),
    frameDurationMs: num(dataset.ActualFrameDuration),
    heads: heads.map((detectorNumber, frameIndex) => {
      const detector = detectors[detectorNumber - 1]
      return { detectorNumber, frameIndex, startAngleDeg: num(detector.StartAngle),
        viewCode: viewFromCode(detector), radii: list(detector.RadialPosition).map(num) }
    }),
    metadata: {
      seriesDescription: text(dataset.SeriesDescription),
      studyDescription: text(dataset.StudyDescription),
      equipment: [text(dataset.Manufacturer), text(dataset.ManufacturerModelName)].filter(Boolean).join(' '),
      energyWindowName: text(windows[0].EnergyWindowName),
      energyWindowKeV: [num(range.EnergyWindowLowerLimit), num(range.EnergyWindowUpperLimit)],
      collimators: detectors.map((detector, index) => ({ detectorNumber: index + 1,
        type: text(detector.CollimatorType), gridName: text(detector.CollimatorGridName) }))
    }
  }
}

function radiusForView(radii, viewNumber) {
  if (radii.length === 1) return radii[0] > 0 ? radii[0] : NaN
  // Siemens writes a growing list padded with zeros: the stop's own radius sits at index view-1.
  const value = radii[viewNumber - 1]
  return value > 0 ? value : NaN
}

/**
 * Validate that the files are the complete set of stops of one acquisition and order them.
 * InstanceNumber gives the order; vendor view labels and ImagesInAcquisition must agree with it.
 */
export function groupCorStops(stops) {
  if (!stops.length) throw new Error('No hay paradas COR.')
  if (stops.length === 1) {
    const s = stops[0]
    throw new Error(`${s.name}: es una sola parada${Number.isFinite(s.imagesInAcquisition) ? ` de ${s.imagesInAcquisition}` : ''}. Carga todas las paradas de la adquisición a la vez o el objeto multiframe.`)
  }
  const ref = stops[0]
  const headsKey = s => s.heads.map(h => h.detectorNumber).sort((a, b) => a - b).join(',')
  const sops = new Set()
  for (const s of stops) {
    if (!s.seriesUid) throw new Error(`${s.name}: falta SeriesInstanceUID; no se puede comprobar que todas las paradas sean de la misma adquisición.`)
    if (s.seriesUid !== ref.seriesUid) throw new Error(`${s.name}: pertenece a otra serie; carga solo las paradas de una adquisición.`)
    if (s.sopUid && sops.has(s.sopUid)) throw new Error(`${s.name}: SOPInstanceUID repetido; retira la copia.`)
    if (s.sopUid) sops.add(s.sopUid)
    if (s.rows !== ref.rows || s.cols !== ref.cols) throw new Error(`${s.name}: matriz ${s.cols} × ${s.rows} distinta del resto.`)
    if (!s.pixelSpacing || !ref.pixelSpacing || s.pixelSpacing.some((v, i) => Math.abs(v - ref.pixelSpacing[i]) > 1e-6)) {
      throw new Error(`${s.name}: PixelSpacing ausente o distinto del resto.`)
    }
    if (headsKey(s) !== headsKey(ref)) throw new Error(`${s.name}: los cabezales no coinciden con el resto de paradas.`)
    if (s.rescaleSlope !== ref.rescaleSlope || s.rescaleIntercept !== ref.rescaleIntercept) throw new Error(`${s.name}: reescalado de píxel distinto del resto.`)
    if (s.metadata.energyWindowName !== ref.metadata.energyWindowName
        || s.metadata.energyWindowKeV.some((v, i) => !Object.is(v, ref.metadata.energyWindowKeV[i]))) {
      throw new Error(`${s.name}: ventana de energía distinta del resto.`)
    }
    if (s.station !== ref.station) throw new Error(`${s.name}: StationName distinto del resto.`)
    if (!Number.isInteger(s.instanceNumber)) throw new Error(`${s.name}: falta InstanceNumber; no se puede ordenar la parada.`)
  }
  const sorted = [...stops].sort((a, b) => a.instanceNumber - b.instanceNumber)
  const count = sorted.length
  for (let i = 1; i < count; i++) {
    if (sorted[i].instanceNumber === sorted[i - 1].instanceNumber) throw new Error(`${sorted[i].name}: InstanceNumber ${sorted[i].instanceNumber} repetido.`)
  }
  if (sorted[count - 1].instanceNumber - sorted[0].instanceNumber + 1 !== count) {
    throw new Error(`Faltan paradas: InstanceNumber ${sorted[0].instanceNumber}–${sorted[count - 1].instanceNumber} con ${count} archivos.`)
  }
  const declared = sorted.map(s => s.imagesInAcquisition).filter(Number.isFinite)
  if (declared.some(v => v !== count)) throw new Error(`Faltan o sobran paradas: el DICOM declara ${declared.find(v => v !== count)} imágenes y se han cargado ${count}.`)
  const ordered = sorted.map((stop, index) => {
    const viewNumber = index + 1
    for (const h of stop.heads) {
      if (Number.isFinite(h.viewCode) && h.viewCode !== viewNumber) {
        throw new Error(`${stop.name}: la etiqueta «View ${h.viewCode}» del cabezal ${h.detectorNumber} no coincide con su posición ${viewNumber} por InstanceNumber.`)
      }
    }
    return { ...stop, viewNumber }
  })
  const heads = ref.heads.map(h => h.detectorNumber).sort((a, b) => a - b)
  const first = ordered[0]
  return {
    stops: ordered,
    count,
    heads,
    // Only the first stop carries the rotation start; never taken from a later stop.
    startAnglesDeg: Object.fromEntries(heads.map(d => [d, first.heads.find(h => h.detectorNumber === d).startAngleDeg])),
    suggestedFullRotationStepDeg: 360 / count
  }
}

/** Summary the interfaces need to ask for the missing geometry. */
export function describeCorStops(stops) {
  const group = groupCorStops(stops)
  const first = group.stops[0]
  return { count: group.count, heads: group.heads, startAnglesDeg: group.startAnglesDeg,
    suggestedFullRotationStepDeg: group.suggestedFullRotationStepDeg,
    files: group.stops.map(s => s.name), seriesDescription: first.metadata.seriesDescription }
}

export function corStopGeometryMissing(summary, geometry = {}) {
  const missing = []
  const step = num(geometry.angularStepDeg)
  if (!(step > 0 && step <= 360)) missing.push('paso angular')
  if (!['CW', 'CC'].includes(String(geometry.rotationDirection || '').toUpperCase())) missing.push('sentido de giro')
  for (const d of summary.heads) {
    if (!Number.isFinite(summary.startAnglesDeg[d]) && !Number.isFinite(num(geometry.startAnglesDeg?.[d]))) missing.push(`ángulo inicial del cabezal ${d}`)
  }
  return missing
}

/**
 * Build the same series object parseCorDICOM returns, from the stops and the declared geometry.
 * geometry: { angularStepDeg, rotationDirection: 'CW'|'CC', startAnglesDeg?: { [head]: deg } }
 * startAnglesDeg is only used for heads whose first stop lacks StartAngle; it never overrides DICOM.
 */
export function assembleCorStops(stops, geometry = {}) {
  const group = groupCorStops(stops)
  const missing = corStopGeometryMissing(group, geometry)
  if (missing.length) {
    const error = new Error(`COR por paradas: declara ${joinEs(missing)}. Los archivos por parada no los incluyen y no se infieren.`)
    error.code = 'COR_STOP_GEOMETRY'
    error.missing = missing
    throw error
  }
  const step = num(geometry.angularStepDeg)
  const direction = String(geometry.rotationDirection).toUpperCase()
  if (step * (group.count - 1) >= 360 - 1e-9) throw new Error(`COR por paradas: ${group.count} paradas × ${step}° repiten posiciones angulares; revisa el paso declarado.`)
  const sign = direction === 'CW' ? -1 : 1
  const starts = Object.fromEntries(group.heads.map(d => [d,
    Number.isFinite(group.startAnglesDeg[d]) ? group.startAnglesDeg[d] : num(geometry.startAnglesDeg[d])]))
  const angleOf = (head, viewNumber) => normalizeAngle(starts[head] + sign * (viewNumber - 1) * step)
  // A later stop that does carry StartAngle must agree either with the rotation start or with its own angle.
  for (const stop of group.stops.slice(1)) for (const h of stop.heads) {
    if (Number.isFinite(h.startAngleDeg) && !sameAngle(h.startAngleDeg, starts[h.detectorNumber]) && !sameAngle(h.startAngleDeg, angleOf(h.detectorNumber, stop.viewNumber))) {
      throw new Error(`${stop.name}: StartAngle ${h.startAngleDeg}° del cabezal ${h.detectorNumber} contradice el paso y el sentido declarados.`)
    }
  }
  const frames = [], frameMeta = [], frameInfo = []
  for (const detectorNumber of group.heads) for (const stop of group.stops) {
    const head = stop.heads.find(h => h.detectorNumber === detectorNumber)
    const frameIndex = frames.length
    frames.push(stop.frames[head.frameIndex])
    frameMeta.push({ frameIndex, detectorNumber, rotationNumber: 1, viewNumber: stop.viewNumber,
      angleDeg: angleOf(detectorNumber, stop.viewNumber), angularStepDeg: step,
      frameDurationMs: stop.frameDurationMs, radialPositionMm: radiusForView(head.radii, stop.viewNumber),
      sourceFile: stop.name })
    frameInfo.push({ frameIndex, detectorNumber, sourceFile: stop.name, viewNumber: stop.viewNumber })
  }
  const first = group.stops[0]
  const durations = group.stops.map(s => s.frameDurationMs)
  return {
    rows: first.rows,
    cols: first.cols,
    pixelSpacing: first.pixelSpacing,
    frames,
    frameInfo,
    frameMeta,
    numFrames: frames.length,
    modality: 'NM',
    rescaleSlope: first.rescaleSlope,
    rescaleIntercept: first.rescaleIntercept,
    metadata: {
      ...first.metadata,
      collimators: first.metadata.collimators.map(c => ({ ...c,
        radialPositionMm: group.stops.map(s => radiusForView(s.heads.find(h => h.detectorNumber === c.detectorNumber)?.radii || [], s.viewNumber)) })),
      detectorCount: group.heads.length,
      scanArcDeg: step * group.count,
      angularStepDeg: step,
      rotationDirection: direction,
      frameDurationMs: durations.every(v => v === durations[0]) ? durations[0] : NaN,
      acquisitionMode: 'stops',
      stopCount: group.count,
      stopFiles: group.stops.map(s => s.name),
      stopGeometry: {
        method: COR_STOP_METHOD,
        angularStepDeg: step,
        rotationDirection: direction,
        startAnglesDeg: starts,
        source: {
          angularStep: 'declarado',
          rotationDirection: 'declarado',
          startAngles: Object.fromEntries(group.heads.map(d => [d, Number.isFinite(group.startAnglesDeg[d]) ? 'DICOM (primera parada)' : 'declarado']))
        },
        order: 'InstanceNumber'
      }
    }
  }
}
