import dcmjs from 'dcmjs'

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data

export const RT_DOSE_STORAGE_UID = '1.2.840.10008.5.1.4.1.1.481.2'
const CT_STORAGE_UID = '1.2.840.10008.5.1.4.1.1.2'
const RT_PLAN_STORAGE_UID = '1.2.840.10008.5.1.4.1.1.481.5'
const RT_ION_PLAN_STORAGE_UID = '1.2.840.10008.5.1.4.1.1.481.8'
const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1'
const IMPLEMENTATION_CLASS_UID = '2.25.176699139456107506103932785242768831106'
const IMPLEMENTATION_VERSION = 'FALKEN_FILM_1'

function first(dict, tag, fallback = '') {
  const values = dict?.[tag]?.Value
  return Array.isArray(values) && values.length ? values[0] : fallback
}

function numericArray(dict, tag) {
  const values = dict?.[tag]?.Value
  return Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : []
}

function cloneElement(element) {
  if (!element) return null
  return { vr: element.vr, Value: Array.isArray(element.Value) ? structuredClone(element.Value) : [] }
}

function dicomDateTime(date = new Date()) {
  const pad = (number) => String(number).padStart(2, '0')
  return {
    date: `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    time: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  }
}

function parseDicom(buffer) {
  try {
    const source = buffer instanceof ArrayBuffer
      ? buffer
      : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    return DicomMessage.readFile(source)
  } catch (error) {
    throw new Error(`No se pudo leer el DICOM de referencia: ${error.message}`)
  }
}

export function inspectDoseReference(buffer) {
  const dd = parseDicom(buffer)
  const dict = dd.dict
  const sopClassUid = String(first(dict, '00080016'))
  const geometry = {
    imagePositionPatient: numericArray(dict, '00200032'),
    imageOrientationPatient: numericArray(dict, '00200037'),
    pixelSpacing: numericArray(dict, '00280030')
  }
  return {
    dd,
    summary: {
      patientName: first(dict, '00100010'),
      patientId: String(first(dict, '00100020')),
      modality: String(first(dict, '00080060')),
      sopClassUid,
      sopInstanceUid: String(first(dict, '00080018')),
      frameOfReferenceUid: String(first(dict, '00200052')),
      studyInstanceUid: String(first(dict, '0020000D')),
      geometry,
      hasGeometry: geometry.imagePositionPatient.length === 3 &&
        geometry.imageOrientationPatient.length === 6 && geometry.pixelSpacing.length === 2,
      hasPlanReference: Boolean(dict['300C0002']?.Value?.length),
      isRtPlan: sopClassUid === RT_PLAN_STORAGE_UID || sopClassUid === RT_ION_PLAN_STORAGE_UID
    }
  }
}

function copyIfPresent(target, source, tags) {
  for (const tag of tags) {
    const element = cloneElement(source[tag])
    if (element) target[tag] = element
  }
}

function pixelBufferFromDose(dose, scaling) {
  const buffer = new ArrayBuffer(dose.length * 4)
  const view = new DataView(buffer)
  for (let index = 0; index < dose.length; index++) {
    const value = Number.isFinite(dose[index]) ? Math.max(0, dose[index]) : 0
    const stored = Math.min(0xffffffff, Math.max(0, Math.round(value / scaling)))
    view.setUint32(index * 4, stored, true)
  }
  return buffer
}

function ds(value) {
  if (!Number.isFinite(Number(value))) throw new Error(`Valor DICOM no numérico: ${value}.`)
  return Number(value).toPrecision(12).replace(/0+$/, '').replace(/\.$/, '')
}

function requiredGeometry(reference, override, pixelSpacingMm) {
  const fromReference = reference.summary.geometry
  const position = override?.imagePositionPatient?.length === 3
    ? override.imagePositionPatient.map(Number)
    : fromReference.imagePositionPatient
  const orientation = override?.imageOrientationPatient?.length === 6
    ? override.imageOrientationPatient.map(Number)
    : fromReference.imageOrientationPatient
  const spacing = override?.pixelSpacing?.length === 2
    ? override.pixelSpacing.map(Number)
    : pixelSpacingMm?.every(Number.isFinite)
      ? pixelSpacingMm.map(Number)
      : fromReference.pixelSpacing
  if (position.length !== 3 || position.some((value) => !Number.isFinite(value))) {
    throw new Error('Falta ImagePositionPatient del plano de película.')
  }
  if (orientation.length !== 6 || orientation.some((value) => !Number.isFinite(value))) {
    throw new Error('Falta ImageOrientationPatient del plano de película.')
  }
  const rowNorm = Math.hypot(...orientation.slice(0, 3))
  const columnNorm = Math.hypot(...orientation.slice(3, 6))
  const dot = orientation[0] * orientation[3] + orientation[1] * orientation[4] + orientation[2] * orientation[5]
  if (Math.abs(rowNorm - 1) > 1e-3 || Math.abs(columnNorm - 1) > 1e-3 || Math.abs(dot) > 1e-3) {
    throw new Error('ImageOrientationPatient debe contener dos vectores unitarios y ortogonales.')
  }
  if (spacing.length !== 2 || spacing.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Falta PixelSpacing válido; comprueba el DPI del TIFF.')
  }
  return { position, orientation, spacing }
}

function planReferenceSequence(source, planReferenceBuffer, geometryReference) {
  let sopClassUid
  let sopInstanceUid

  const existing = source['300C0002']?.Value?.[0]
  if (existing) {
    sopClassUid = String(first(existing, '00081150'))
    sopInstanceUid = String(first(existing, '00081155'))
  } else if (planReferenceBuffer) {
    const plan = inspectDoseReference(planReferenceBuffer)
    if (!plan.summary.isRtPlan) throw new Error('El archivo de plan no es un RT Plan ni un RT Ion Plan.')
    if (plan.summary.studyInstanceUid && geometryReference.summary.studyInstanceUid &&
        plan.summary.studyInstanceUid !== geometryReference.summary.studyInstanceUid) {
      throw new Error('El RT Plan y la referencia geométrica pertenecen a estudios distintos.')
    }
    if (plan.summary.frameOfReferenceUid && geometryReference.summary.frameOfReferenceUid &&
        plan.summary.frameOfReferenceUid !== geometryReference.summary.frameOfReferenceUid) {
      throw new Error('El RT Plan y la referencia geométrica usan Frame of Reference distintos.')
    }
    sopClassUid = plan.summary.sopClassUid
    sopInstanceUid = plan.summary.sopInstanceUid
  }

  if (!sopClassUid || !sopInstanceUid) {
    throw new Error('Para exportar Dose Summation Type PLAN se necesita un RT Plan de referencia.')
  }
  return {
    vr: 'SQ',
    Value: [{
      '00081150': { vr: 'UI', Value: [sopClassUid] },
      '00081155': { vr: 'UI', Value: [sopInstanceUid] }
    }]
  }
}

export function createFilmRtDose({
  dose,
  width,
  height,
  pixelSpacingMm,
  referenceBuffer,
  planReferenceBuffer,
  geometry,
  calibrationName,
  method,
  doseSummationType = 'PLAN'
}) {
  if (!referenceBuffer) throw new Error('Selecciona un CT o RT Dose de referencia antes de exportar.')
  if (!dose || dose.length !== width * height) throw new Error('La matriz de dosis no coincide con Rows×Columns.')
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535) {
    throw new Error('Dimensiones no válidas para RT Dose.')
  }
  if (doseSummationType !== 'PLAN') {
    throw new Error('Esta versión exporta únicamente Dose Summation Type PLAN.')
  }

  const reference = inspectDoseReference(referenceBuffer)
  const source = reference.dd.dict
  if (!reference.summary.frameOfReferenceUid) throw new Error('El DICOM de referencia no contiene FrameOfReferenceUID.')
  const resolvedGeometry = requiredGeometry(reference, geometry, pixelSpacingMm)
  const referencedPlan = planReferenceSequence(source, planReferenceBuffer, reference)
  const maximum = dose.reduce((current, value) => Number.isFinite(value) ? Math.max(current, value) : current, 0)
  if (!(maximum > 0)) throw new Error('La matriz no contiene ninguna dosis positiva.')
  const scaling = maximum / 0xffffffff
  const pixelData = pixelBufferFromDose(dose, scaling)
  const sopInstanceUid = DicomMetaDictionary.uid()
  const seriesInstanceUid = DicomMetaDictionary.uid()
  const studyInstanceUid = reference.summary.studyInstanceUid || DicomMetaDictionary.uid()
  const { date, time } = dicomDateTime()

  const meta = {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1]).buffer] },
    '00020002': { vr: 'UI', Value: [RT_DOSE_STORAGE_UID] },
    '00020003': { vr: 'UI', Value: [sopInstanceUid] },
    '00020010': { vr: 'UI', Value: [EXPLICIT_VR_LITTLE_ENDIAN] },
    '00020012': { vr: 'UI', Value: [IMPLEMENTATION_CLASS_UID] },
    '00020013': { vr: 'SH', Value: [IMPLEMENTATION_VERSION] }
  }

  const dict = {
    '00080016': { vr: 'UI', Value: [RT_DOSE_STORAGE_UID] },
    '00080018': { vr: 'UI', Value: [sopInstanceUid] },
    '00080008': { vr: 'CS', Value: ['DERIVED', 'PRIMARY', 'DOSE'] },
    '00080020': { vr: 'DA', Value: [String(first(source, '00080020') || date)] },
    '00080030': { vr: 'TM', Value: [String(first(source, '00080030') || time)] },
    '00080021': { vr: 'DA', Value: [date] },
    '00080031': { vr: 'TM', Value: [time] },
    '00080023': { vr: 'DA', Value: [date] },
    '00080033': { vr: 'TM', Value: [time] },
    '00080050': { vr: 'SH', Value: [String(first(source, '00080050') || '')] },
    '00080060': { vr: 'CS', Value: ['RTDOSE'] },
    '00080070': { vr: 'LO', Value: ["Falken's Maze"] },
    '00080090': cloneElement(source['00080090']) || { vr: 'PN', Value: [] },
    '00081070': { vr: 'PN', Value: [] },
    '0008103E': { vr: 'LO', Value: ['EBT3 FILM DOSE'] },
    '00081090': { vr: 'LO', Value: ['Bloggy Film Dosimetry'] },
    '00100010': cloneElement(source['00100010']) || { vr: 'PN', Value: [] },
    '00100020': cloneElement(source['00100020']) || { vr: 'LO', Value: [] },
    '00100030': cloneElement(source['00100030']) || { vr: 'DA', Value: [] },
    '00100040': cloneElement(source['00100040']) || { vr: 'CS', Value: [] },
    '00181020': { vr: 'LO', Value: ['FILM_1.0.0'] },
    '00180050': { vr: 'DS', Value: [] },
    '0020000D': { vr: 'UI', Value: [studyInstanceUid] },
    '0020000E': { vr: 'UI', Value: [seriesInstanceUid] },
    '00200010': { vr: 'SH', Value: [String(first(source, '00200010') || '')] },
    '00200011': { vr: 'IS', Value: ['9001'] },
    '00200013': { vr: 'IS', Value: ['1'] },
    '00200032': { vr: 'DS', Value: resolvedGeometry.position.map(ds) },
    '00200037': { vr: 'DS', Value: resolvedGeometry.orientation.map(ds) },
    '00200052': { vr: 'UI', Value: [reference.summary.frameOfReferenceUid] },
    '00201040': cloneElement(source['00201040']) || { vr: 'LO', Value: [] },
    '00280002': { vr: 'US', Value: [1] },
    '00280004': { vr: 'CS', Value: ['MONOCHROME2'] },
    '00280010': { vr: 'US', Value: [height] },
    '00280011': { vr: 'US', Value: [width] },
    '00280030': { vr: 'DS', Value: resolvedGeometry.spacing.map(ds) },
    '00280100': { vr: 'US', Value: [32] },
    '00280101': { vr: 'US', Value: [32] },
    '00280102': { vr: 'US', Value: [31] },
    '00280103': { vr: 'US', Value: [0] },
    '30040002': { vr: 'CS', Value: ['GY'] },
    '30040004': { vr: 'CS', Value: ['PHYSICAL'] },
    '30040006': {
      vr: 'LO',
      Value: [`Measured EBT3 film; ${String(calibrationName || 'calibration').slice(0, 40)}; ${method}`.slice(0, 64)]
    },
    '3004000A': { vr: 'CS', Value: [doseSummationType] },
    '3004000E': { vr: 'DS', Value: [ds(scaling)] },
    '300C0002': referencedPlan,
    '7FE00010': { vr: 'OW', Value: [pixelData] }
  }

  copyIfPresent(dict, source, ['00080005', '00120062', '00120063'])
  if (source['300C0060']) dict['300C0060'] = cloneElement(source['300C0060'])
  else if (source['00081140']) dict['00081140'] = cloneElement(source['00081140'])
  else if (reference.summary.sopClassUid === CT_STORAGE_UID && first(source, '00080018')) {
    dict['00081140'] = {
      vr: 'SQ',
      Value: [{
        '00081150': { vr: 'UI', Value: [CT_STORAGE_UID] },
        '00081155': { vr: 'UI', Value: [String(first(source, '00080018'))] }
      }]
    }
  } else {
    throw new Error('La referencia geométrica no aporta una imagen ni un RT Structure Set de derivación.')
  }

  const output = new DicomDict(meta)
  output.dict = dict
  const buffer = output.write()
  // El propio escritor debe poder volver a leer lo que produce.
  try { DicomMessage.readFile(buffer) } catch (error) {
    throw new Error(`El RT Dose generado no se puede reabrir: ${error.message}`)
  }
  return {
    buffer,
    fileName: `RD_FILM_${sopInstanceUid}.dcm`,
    sopInstanceUid,
    seriesInstanceUid,
    doseGridScaling: scaling,
    maximumDoseGy: maximum,
    geometry: resolvedGeometry,
    reference: reference.summary
  }
}

export function triggerDicomDownload(result) {
  const blob = new Blob([result.buffer], { type: 'application/dicom' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = result.fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
