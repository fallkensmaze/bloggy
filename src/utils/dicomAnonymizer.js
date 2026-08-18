// Anonimizador de estudios de Radioterapia (CT + RTSTRUCT + RTPLAN + RTDOSE).
// 100% navegador. Documento de referencia: DICOM_RT_ANONYMIZATION_STUDY.md
//
// Estrategia (2 pasadas con tabla de UID compartida):
//   prepareStudy(): parsea cada archivo, clasifica el SOP Class, recoge UID
//                   constantes (SOP Class / Transfer Syntax) y semilla el set
//                   de UID originales para QA.
//   anonymizeStudy(): recorre meta + dataset de forma recursiva por VR=UI,
//                     remapeando UID (constantes preservadas), aplicando el
//                     perfil PHI (PS3.15 Basic + hardening RT), fijando
//                     identidad/fechas nuevas y marcando el objeto como
//                     de-identificado. Nunca toca PixelData.
//
// Las referencias entre objetos (RTPLAN->RTSTRUCT, RTSTRUCT->CT, RTDOSE->RTPLAN,
// FrameOfReference compartido) se conservan automáticamente porque la tabla de
// remapeo oldUID->newUID es única para todo el estudio.

import dcmjs from 'dcmjs'

const { DicomMessage, DicomMetaDictionary } = dcmjs.data
const anonymizer = dcmjs.anonymizer
const nameMap = DicomMetaDictionary.nameMap

// ---- SOP Class UID -> tipo legible ----------------------------------------
const SOP_CLASS = {
  CT_STORAGE: '1.2.840.10008.5.1.4.1.1.2',
  ENHANCED_CT: '1.2.840.10008.5.1.4.1.1.2.1',
  RTIMAGE: '1.2.840.10008.5.1.4.1.1.481.1',
  RTDOSE: '1.2.840.10008.5.1.4.1.1.481.2',
  RTSTRUCT: '1.2.840.10008.5.1.4.1.1.481.3',
  RTRECORD: '1.2.840.10008.5.1.4.1.1.481.4',
  RTPLAN: '1.2.840.10008.5.1.4.1.1.481.5',
  RT_ION_PLAN: '1.2.840.10008.5.1.4.1.1.481.8',
  RT_ION_RECORD: '1.2.840.10008.5.1.4.1.1.481.9',
  ENHANCED_RT: '1.2.840.10008.5.1.4.1.1.481.11' // rango de Enhanced RT (radiation set etc.)
}

const MEDIA_STORAGE_DIRECTORY = '1.2.840.10008.1.3.10' // DICOMDIR
const ANON_UID_ROOT = '2.25' // UUID-derived OID: válido DICOM y claramente no vendor/paciente

function classifySopClass(uid) {
  const u = normUid(uid)
  if (!u) return 'OTHER'
  if (u === SOP_CLASS.CT_STORAGE || u === SOP_CLASS.ENHANCED_CT) return 'CT'
  if (u === SOP_CLASS.RTSTRUCT) return 'RTSTRUCT'
  if (u === SOP_CLASS.RTPLAN) return 'RTPLAN'
  if (u === SOP_CLASS.RTDOSE) return 'RTDOSE'
  if (u === SOP_CLASS.RTIMAGE) return 'RTIMAGE'
  if (u === SOP_CLASS.RTRECORD) return 'RTRECORD'
  if (u === SOP_CLASS.RT_ION_PLAN) return 'RT_ION_PLAN'
  if (u === SOP_CLASS.RT_ION_RECORD) return 'RT_ION_RECORD'
  if (u.startsWith('1.2.840.10008.5.1.4.1.1.481.')) return 'RT_OTHER'
  return 'OTHER'
}

// ---- helpers de tags -------------------------------------------------------
// nameMap entry.tag tiene forma "(0010,0010)" -> lo pasamos a "00100010".
const NAME_HEX = {}
for (const [name, entry] of Object.entries(nameMap)) {
  NAME_HEX[name] = entry.tag.replace(/[(),]/g, '')
}
function H(name) {
  return NAME_HEX[name]
}

const DATE_VR = new Set(['DA', 'TM', 'DT'])
const PN_VR = new Set(['PN'])

// ---- conjuntos de reglas ---------------------------------------------------
// Base PS3.15 / CTP (vetada por dcmjs). Filtramos nombres no resueltos.
// OJO: esa lista usa algunos nombres retirados (p.ej. "OperatorName" en vez de
// "OperatorsName") que no resuelven en nameMap. Por eso NO dependemos solo de
// ella: todo VR=PN se borra salvo PatientName (ver processLevel), y mantenemos
// una lista explícita de keywords actuales para el resto de PHI.
const baseNames = anonymizer.getTagsNameToEmpty()
const BASE_DELETE = new Set(baseNames.map((n) => H(n)).filter(Boolean))
// Fecha/hora se trata por VR, no por nombre: quitamos del base los DA/TM/DT.
for (const name of baseNames) {
  const hex = H(name)
  const entry = nameMap[name]
  if (hex && entry && DATE_VR.has(entry.vr)) BASE_DELETE.delete(hex)
}
// PatientName / PatientID se reemplazan, no se borran.
BASE_DELETE.delete(H('PatientName'))
BASE_DELETE.delete(H('PatientID'))

// Tags cuyo VALOR es una constante estándar (clase / sintaxis) que NO se remapea.
const CONSTANT_POSITIONS = new Set([
  H('SOPClassUID'),             // 0008,0016
  H('RelatedGeneralSOPClassUID'), // 0008,001A: UID de clase estándar
  H('OriginalSpecializedSOPClassUID'), // 0008,001B: UID de clase estándar
  H('MediaStorageSOPClassUID'), // 0002,0002
  H('TransferSyntaxUID'),       // 0002,0010
  H('ReferencedSOPClassUID'),   // 0008,1150
  H('CodingSchemeUID')          // 0008,010C: UID de esquema codificado, no instancia
].filter(Boolean))

const UNENCAPSULATED_TS = new Set([
  '1.2.840.10008.1.2',   // Implicit VR LE
  '1.2.840.10008.1.2.1', // Explicit VR LE
  '1.2.840.10008.1.2.2'  // Explicit BE
])

const PIXEL_DATA = '7FE00010'

function normUid(v) {
  if (v == null) return ''
  return String(v).replace(/[\u0000\s]+$/g, '').trim()
}

function isPrivateTagHex(hex) {
  if (!hex || hex.length < 4) return false
  const group = parseInt(hex.slice(0, 4), 16)
  return group % 2 === 1
}
function isOverlayGroupHex(hex) {
  if (!hex || hex.length < 4) return false
  const group = parseInt(hex.slice(0, 4), 16)
  return group >= 0x6000 && group <= 0x60ff
}
// Grupos de curva 5000-50FF (retirados). Igual que los overlays, pueden llevar
// anotaciones y datos con PHI; el perfil básico los retira.
function isCurveGroupHex(hex) {
  if (!hex || hex.length < 4) return false
  const group = parseInt(hex.slice(0, 4), 16)
  return group >= 0x5000 && group <= 0x50ff
}
function isWellKnownDicomUid(uid) {
  // UID estándar DICOM: clases SOP, transfer syntaxes, coding schemes, palettes,
  // etc. No deben remapearse aunque aparezcan en tags UI no cubiertos por nombre.
  return /^1\.2\.840\.10008\./.test(normUid(uid))
}

// Adiciones RT específicas (nombres de persona / equipo anidados, comentarios).
const RT_DELETE = [
  'ReviewerName',          // 300E,0008  (PN: quien aprobó el plan)
  'ReviewDate',            // 300E,0004
  'ReviewTime',            // 300E,0005
  'ROIInterpreter',        // 3006,00A6  (PN: médico que delineó)
  'ROICreatorSequence',    // 3006,004D
  'ROIInterpreterSequence',// 3006,004E
  'DoseComment',           // 3004,0006
  'ContributingEquipmentSequence', // 0018,A001  (duplica institución/estación)
  'ReferencedPatientSequence',     // 0008,1120
  'GraphicAnnotationSequence',     // 0070,0001
  'IconImageSequence',            // 0088,0200
  'EthnicGroup',
  'Occupation',
  'SmokingStatus',
  'DeviceUID',             // 0018,1002
  'ManufacturerDeviceClassUID', // 0018,100B
  'UDISequence'            // 0018,100A
]
for (const name of RT_DELETE) {
  const hex = H(name)
  if (hex) BASE_DELETE.add(hex)
}

// Hardening explícito: dcmjs.anonymizer contiene algunos keywords retirados que
// no resuelven en nameMap. Esta lista usa keywords actuales para cubrir AE
// titles, teléfonos, localizaciones, emisores de ID y secuencias institucionales.
const EXPLICIT_PHI_DELETE = [
  'RetrieveAETitle',
  'InstitutionName',
  'InstitutionAddress',
  'InstitutionCodeSequence',
  'InstitutionalDepartmentName',
  'InstitutionalDepartmentTypeCodeSequence',
  'StationName',
  // AccessionNumber y StudyID NO van aquí: son Type 2 y se vacían en
  // ZERO_LENGTH_HEX, no se borran.
  'IssuerOfPatientID',
  'OtherPatientIDs',
  'OtherPatientNames',
  'OtherPatientIDsSequence',
  'PatientAddress',
  'PatientTelephoneNumbers',
  'PatientTelecomInformation',
  'ReferringPhysicianTelephoneNumbers',
  'AdmissionID',
  'ScheduledStationAETitle',
  'ScheduledStationName',
  'ScheduledStationNameCodeSequence',
  'ScheduledProcedureStepID',
  'ScheduledProcedureStepLocation',
  'PerformedStationAETitle',
  'PerformedStationName',
  'PerformedStationNameCodeSequence',
  'PerformedLocation',
  'PerformedProcedureStepID',
  'PerformedProcedureStepDescription',
  'RequestedProcedureID',
  'RequestedProcedureDescription',
  'RequestedProcedureComments',
  'NamesOfIntendedRecipientsOfResults',
  'PersonAddress',
  'PersonTelephoneNumbers',
  'PersonTelecomInformation'
]
for (const name of EXPLICIT_PHI_DELETE) {
  const hex = H(name)
  if (hex) BASE_DELETE.add(hex)
}

// Perfil PS3.15 direccionado POR NÚMERO DE TAG.
//
// Por qué por número y no por keyword: `anonymizer.getTagsNameToEmpty()` usa
// nombres heredados (RefStudySeq, PPSComments, ReasonforStudy, Impressions...)
// de los que ~103 de 221 NO resuelven en `nameMap`. El `.filter(Boolean)` de
// arriba los descartaba en silencio, así que la mitad del perfil básico nunca
// llegaba a aplicarse. Los VR=PN y VR=DA/TM/DT caían igualmente por las reglas
// de VR, pero TODO el texto libre clínico (LO/ST/LT/UT) se escapaba intacto:
// Allergies, ReasonForVisit, InterpretationText, Impressions, StudyComments...
// Direccionar por tag es inmune a que cambien los keywords del diccionario.
const PS315_REMOVE_HEX = new Set([
  '00080014', // InstanceCreatorUID
  '00081080', // AdmittingDiagnosesDescription
  '00084000', // IdentifyingComments (retirado)
  '00101050', // InsurancePlanIdentification (retirado)
  '00102110', // Allergies
  '00184000', // AcquisitionComments (retirado)
  '00209158', // FrameComments
  '00280301', // BurnedInAnnotation
  '00284000', // ImagePresentationComments (retirado)
  '00320012', // StudyIDIssuer (retirado)
  '00321030', // ReasonForStudy (retirado)
  '00321066', // ReasonForVisit
  '00324000', // StudyComments (retirado)
  '00380011', // IssuerOfAdmissionID (retirado)
  '0038001E', // ScheduledPatientInstitutionResidence (retirado)
  '00380040', // DischargeDiagnosisDescription (retirado)
  '00380061', // IssuerOfServiceEpisodeID (retirado)
  '00400007', // ScheduledProcedureStepDescription
  '00400280', // CommentsOnThePerformedProcedureStep
  '00402001', // ReasonForTheImagingServiceRequest (retirado)
  '00402016', // PlacerOrderNumberImagingServiceRequest
  '00402017', // FillerOrderNumberImagingServiceRequest
  '00403001', // ConfidentialityConstraintOnPatientDataDescription
  '00404036', // HumanPerformerOrganization
  '00880140', // StorageMediaFileSetUID
  '00880904', // TopicTitle (retirado)
  '00880906', // TopicSubject (retirado)
  '00880910', // TopicAuthor (retirado)
  '00880912', // TopicKeywords (retirado)
  '04000100', // DigitalSignatureUID
  '04000402', // ReferencedDigitalSignatureSequence
  '04000403', // ReferencedSOPInstanceMACSequence
  '04000404', // MAC
  '04000550', // ModifiedAttributesSequence
  '04000561', // OriginalAttributesSequence (¡contiene los valores originales!)
  '40080042', // ResultsIDIssuer (retirado)
  '4008010B', // InterpretationText (retirado)
  '40080115', // InterpretationDiagnosisDescription (retirado)
  '4008011A', // DistributionAddress (retirado)
  '40080202', // InterpretationIDIssuer (retirado)
  '40080300', // Impressions (retirado)
  '40084000', // ResultsComments (retirado)
  '04000115', // CertificateOfSigner
  '04000120', // Signature
  '04000305', // CertifiedTimestampType
  '04000310', // CertifiedTimestamp
  'FFFAFFFA', // DigitalSignaturesSequence
  'FFFCFFFC', // DataSetTrailingPadding
  '300C0113', // ReasonForOmissionDescription
  // Fecha de nacimiento/defunción en calendario alternativo: son LO, no DA, así
  // que la regla por VR de fecha no las tocaba.
  '00100033', // PatientBirthDateInAlternativeCalendar
  '00100034', // PatientDeathDateInAlternativeCalendar
  // Documento encapsulado: un PDF/CDA íntegro con PHI viaja aquí sin tocar.
  '00420010', // DocumentTitle
  '00420011', // EncapsulatedDocument
  // Marcadores de PHI en píxel: se retiran del perfil, pero antes se avisa al
  // usuario en prepareStudy() porque no podemos limpiar el PixelData.
  '00280302', // RecognizableVisualFeatures
  // Texto libre RT rellenado por el operador. Sitio habitual de nombre, nº de
  // historia o comentarios clínicos identificables.
  '30080202', // TreatmentStatusComment
  '300A0794', // PatientSetupPhotoDescription
  '3010005A', // RTPhysicianIntentNarrative
  '3010007B', // PrescriptionNotes
  '3010007F', // FractionationNotes
  '30100033', // UserContentLabel
  '30100034', // UserContentLongLabel
  '30100035', // EntityLabel
  '30100036', // EntityName
  '30100037'  // EntityDescription
])

// Descriptores RT adicionales por número de tag (sus keywords sí resuelven,
// pero se listan aquí junto al resto para que la regla sea una sola).
// Respetan `keepDescriptors` igual que StudyDescription o BeamName.
const DESCRIPTOR_EXTRA_HEX = new Set([
  '300A0402', // SetupImageComment
  '300A00C3', // BeamDescription
  '300A00DD'  // BolusDescription
])

// Type 2: PS3.15 acción "Z" = valor de longitud cero, NO eliminar. Borrarlos
// deja el objeto no conforme y algunos PACS/TPS rechazan la ingesta.
const ZERO_LENGTH_HEX = new Set(
  [
    ...['AccessionNumber', 'ReferringPhysicianName', 'PatientBirthDate', 'StudyID']
      .map(H)
      .filter(Boolean),
    '30080250', // TreatmentDate: Type 2 en RT Treatment Record
    '30080251'  // TreatmentTime: Type 2 en RT Treatment Record
  ]
)
const PATIENT_SEX_HEX = H('PatientSex') // Type 2: se vacía, no se borra

// Ensayo clínico (grupo 0012 salvo los que añadimos nosotros: 0062/0063/0064).
for (const name of Object.keys(nameMap)) {
  if (/^ClinicalTrial/.test(name)) {
    const hex = H(name)
    if (hex) BASE_DELETE.add(hex)
  }
}

// Descriptores de texto libre (frecuente fuente residual de PHI). Se borran
// salvo que el usuario active "conservar descriptores".
const DESCRIPTOR_NAMES = [
  'StudyDescription',
  'SeriesDescription',
  'ImageComments',
  'IdentifyingComments',
  'StudyComments',
  'DerivationDescription',
  'ProtocolName',
  'AcquisitionProtocolName',
  'AcquisitionProtocolDescription',
  'AcquisitionComments',
  'ImagePresentationComments',
  'StructureSetName',
  'StructureSetDescription',
  'RTPlanName',
  'RTPlanDescription',
  'TreatmentProtocols',
  'TreatmentSites',
  'PrescriptionDescription',
  'DoseReferenceDescription',
  'ROIName',
  'ROIDescription',
  'ROIObservationLabel',
  'ROIObservationDescription',
  'BeamName',
  'DoseComment',
  'SetupTechniqueDescription',
  'SetupDeviceDescription',
  'PatientSetupLabel'
]
const DESCRIPTOR_HEX = new Set(DESCRIPTOR_NAMES.map(H).filter(Boolean))
const ROI_NAME_HEX = H('ROIName')
const ROI_NUMBER_HEX = H('ROINumber')
const BEAM_NAME_HEX = H('BeamName')
const BEAM_NUMBER_HEX = H('BeamNumber')
const GENERIC_DESCRIPTOR_HEX = new Set([ROI_NAME_HEX, BEAM_NAME_HEX].filter(Boolean))

// Características del paciente (PS3.15: retirar; opción para retener).
const CHARACTERISTIC_HEX = new Set(
  ['PatientSex', 'PatientAge', 'PatientSize', 'PatientWeight', 'PatientBodyMassIndex']
    .map(H)
    .filter(Boolean)
)

// Identidad de equipo (opción para retener).
const DEVICE_HEX = new Set(
  ['Manufacturer', 'ManufacturerModelName', 'SoftwareVersions']
    .map(H)
    .filter(Boolean)
)

// Meta de archivo (grupo 0002) que se borra siempre.
const META_DELETE = new Set(
  [
    H('ImplementationClassUID'),       // 0002,0012
    H('ImplementationVersionName'),    // 0002,0013
    H('SourceApplicationEntityTitle'), // 0002,0016
    H('SendingApplicationEntityTitle'),// 0002,0017
    H('ReceivingApplicationEntityTitle'), // 0002,0018
    H('PrivateInformationCreatorUID'), // 0002,0100
    H('PrivateInformation')            // 0002,0102
  ].filter(Boolean)
)

// Fechas de estudio -> se fijan a la nueva fecha/hora (no se borran).
const STUDY_DATE_HEX = new Set(
  [
    'StudyDate', 'StudyTime',
    'SeriesDate', 'SeriesTime',
    'ContentDate', 'ContentTime',
    'AcquisitionDate', 'AcquisitionTime',
    'InstanceCreationDate', 'InstanceCreationTime',
    'RTPlanDate', 'RTPlanTime',
    'StructureSetDate', 'StructureSetTime'
  ]
    .map(H)
    .filter(Boolean)
)
// AcquisitionDateTime (VR=DT) es Type 1C obligatorio en Enhanced CT
// ORIGINAL/MIXED: borrarlo deja esos objetos inválidos. Se sustituye.
STUDY_DATE_HEX.add('0008002A')

// Tags Type 1 que deben seguir presentes y no vacíos: se sustituyen por genéricos.
const GENERIC_LABEL = {
  [H('StructureSetLabel')]: 'RTSTRUCT', // 3006,0002
  [H('RTPlanLabel')]: 'PLAN'            // 300A,0002
}
const TREATMENT_MACHINE_NAME = H('TreatmentMachineName') // 300A,00B2

const PATIENT_NAME_HEX = H('PatientName') // 0010,0010
const PATIENT_ID_HEX = H('PatientID')     // 0010,0020
const PAT_ID_REMOVED = '00120062'         // PatientIdentityRemoved
const DEID_METHOD = '00120063'            // DeidentificationMethod
const LONG_TEMPORAL_MODIFIED = '00280303' // LongitudinalTemporalInformationModified

// Identidad de implementación propia (0002,0012 es Type 1: no puede faltar).
const ANON_IMPL_CLASS_UID = '2.25.176699139456107506103932785242768831106'
const ANON_IMPL_VERSION = 'FALKEN_RT_ANON'

// ---- pase 1: análisis ------------------------------------------------------
function getFirstString(dict, hex) {
  const el = dict && dict[hex]
  if (!el || !Array.isArray(el.Value) || el.Value.length === 0) return ''
  return valueToText(el.Value[0])
}

function getFirstNumber(dict, hex) {
  const text = getFirstString(dict, hex)
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function getNumberArray(dict, hex) {
  const el = dict && dict[hex]
  if (!el || !Array.isArray(el.Value)) return []
  return el.Value.map((v) => Number(valueToText(v))).filter((n) => Number.isFinite(n))
}

function valueToText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return normUid(v)
  // dcmjs puede representar PN como { Alphabetic, Ideographic, Phonetic }.
  if (typeof v === 'object') {
    if ('Alphabetic' in v) return normUid(v.Alphabetic)
    if ('_rawValue' in v) return normUid(v._rawValue)
  }
  return normUid(v)
}

/**
 * @param {Array<{name:string, buffer:ArrayBuffer}>} files
 * @returns {Promise<{entries:Array, constants:Set, originalUids:Set, warnings:Array, summary:Object}>}
 */
export async function prepareStudy(files) {
  const entries = []
  const constants = new Set()
  const originalUids = new Set()
  const referencedSopUids = new Set()
  const warnings = []

  for (const file of files) {
    let dd
    try {
      dd = DicomMessage.readFile(file.buffer)
    } catch (err) {
      warnings.push({ file: file.name, level: 'error', msg: `No es un DICOM válido: ${err.message}` })
      continue
    }
    const meta = dd.meta || {}
    const dict = dd.dict || {}

    const sopClass = getFirstString(dict, H('SOPClassUID'))
    if (sopClass === MEDIA_STORAGE_DIRECTORY) {
      warnings.push({ file: file.name, level: 'info', msg: 'DICOMDIR ignorado (se regenera/regla del visor; no es un objeto SOP).' })
      continue
    }
    const transferSyntax = getFirstString(meta, H('TransferSyntaxUID'))
    const kind = classifySopClass(sopClass)
    const compressed = transferSyntax ? !UNENCAPSULATED_TS.has(transferSyntax) : false

    // Recoger UID constantes y originales recorriendo meta + dataset.
    walkCollect(meta, constants, originalUids)
    walkCollect(dict, constants, originalUids)
    walkReferencedSopInstances(dict, referencedSopUids)

    const originalName = getFirstString(dict, PATIENT_NAME_HEX)
    const originalId = getFirstString(dict, PATIENT_ID_HEX)

    entries.push({
      name: file.name,
      buffer: file.buffer,
      dd,
      kind,
      sopClass,
      transferSyntax,
      compressed,
      studyUid: getFirstString(dict, H('StudyInstanceUID')),
      seriesUid: getFirstString(dict, H('SeriesInstanceUID')),
      sopUid: getFirstString(dict, H('SOPInstanceUID')),
      forUid: getFirstString(dict, H('FrameOfReferenceUID')),
      instanceNumber: getFirstNumber(dict, H('InstanceNumber')),
      imagePosition: getNumberArray(dict, H('ImagePositionPatient')),
      imageOrientation: getNumberArray(dict, H('ImageOrientationPatient')),
      sliceLocation: getFirstNumber(dict, H('SliceLocation')),
      originalName,
      originalId,
      pixelHash: pixelDataHash(dict)
    })

    if (compressed && (kind === 'CT' || kind === 'RTDOSE')) {
      warnings.push({
        file: file.name,
        level: 'warn',
        msg: `Transfer Syntax comprimido (${transferSyntax}). Se reescribirá tal cual; revisa visualmente que el PixelData quede intacto.`
      })
    }
    // El propio objeto declara que lleva PHI quemada en los píxeles. No podemos
    // limpiarla en el navegador (haría falta OCR / recorte), y los marcadores se
    // retiran con el perfil, así que hay que avisar ANTES de que el usuario
    // asuma que el ZIP es publicable.
    const burnedIn = getFirstString(dict, '00280301').toUpperCase()
    const visualFeatures = getFirstString(dict, '00280302').toUpperCase()
    if (burnedIn === 'YES' || visualFeatures === 'YES') {
      const which = burnedIn === 'YES' ? 'BurnedInAnnotation=YES' : 'RecognizableVisualFeatures=YES'
      warnings.push({
        file: file.name,
        level: 'warn',
        msg: `El objeto declara PHI en la imagen (${which}). Los píxeles NO se modifican: revísalos visualmente o descarta el archivo antes de compartir.`
      })
    }
    if (kind === 'RT_ION_PLAN' || kind === 'RT_ION_RECORD' || kind === 'RT_OTHER') {
      warnings.push({
        file: file.name,
        level: 'warn',
        msg: `Objeto RT avanzado (${kind}). El remapeo genérico por UID aplica, pero puede haber descriptores/UID extra no cubiertos. Revisa el resultado.`
      })
    }
  }

  // Referencias externas: ReferencedSOPInstanceUID que no aparecen como instancia
  // ni como UID estructural normal del estudio (Study/Series/Frame). Evita avisar
  // por StudyInstanceUID, SeriesInstanceUID o FrameOfReferenceUID, que no son SOP.
  const knownStudyUids = new Set(entries.map((e) => e.studyUid).filter(Boolean))
  const knownSeriesUids = new Set(entries.map((e) => e.seriesUid).filter(Boolean))
  const knownForUids = new Set(entries.map((e) => e.forUid).filter(Boolean))
  const knownUids = new Set([
    ...entries.map((e) => e.sopUid).filter(Boolean),
    ...knownStudyUids,
    ...knownSeriesUids,
    ...knownForUids
  ])
  const referenced = new Set()
  for (const uid of referencedSopUids) {
    if (!constants.has(uid) && !knownUids.has(uid)) referenced.add(uid)
  }
  if (referenced.size > 0) {
    warnings.push({
      level: 'info',
      msg: `Se detectaron ${referenced.size} UID referenciados que no existen como instancia en el estudio (posibles referencias externas). Se remapearán igualmente para mantener consistencia interna.`
    })
  }
  warnings.push(...detectCtGeometryWarnings(entries))

  const summary = {
    total: entries.length,
    byKind: countBy(entries, (e) => e.kind),
    studies: unique(entries.map((e) => e.studyUid).filter(Boolean)).length,
    originalName: entries[0]?.originalName || '',
    originalId: entries[0]?.originalId || ''
  }

  return { entries, constants, originalUids, warnings, summary }
}

function walkCollect(dict, constants, originalUids) {
  if (!dict) return
  for (const hex of Object.keys(dict)) {
    const el = dict[hex]
    if (!el) continue
    if (el.vr === 'UI' && Array.isArray(el.Value)) {
      for (const v of el.Value) {
        const u = normUid(v)
        if (!u) continue
        originalUids.add(u)
        if (CONSTANT_POSITIONS.has(hex) || isWellKnownDicomUid(u)) constants.add(u)
      }
    } else if (el.vr === 'SQ' && Array.isArray(el.Value)) {
      for (const item of el.Value) walkCollect(item, constants, originalUids)
    }
  }
}

function walkReferencedSopInstances(dict, out) {
  if (!dict) return
  const refSopHex = H('ReferencedSOPInstanceUID')
  for (const hex of Object.keys(dict)) {
    const el = dict[hex]
    if (!el) continue
    if (hex === refSopHex && el.vr === 'UI' && Array.isArray(el.Value)) {
      for (const v of el.Value) {
        const u = normUid(v)
        if (u) out.add(u)
      }
    } else if (el.vr === 'SQ' && Array.isArray(el.Value)) {
      for (const item of el.Value) walkReferencedSopInstances(item, out)
    }
  }
}

// ---- pase 2: anonimización -------------------------------------------------
function defaultOptions() {
  const today = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return {
    patientName: 'Anon^Anon',
    patientId: 'ANON',
    studyDate: `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`,
    studyTime: '000000',
    keepDescriptors: false,
    keepPatientCharacteristics: false,
    keepDeviceIdentity: false,
    keepPrivateTags: false
  }
}

/**
 * @param {Object} prepared  resultado de prepareStudy()
 * @param {Object} options   ver defaultOptions()
 * @param {(i:number,total:number,name:string)=>void} [onProgress]
 * @returns {{outputs:Array, qaIssues:Array, tableSize:number, method:string}}
 */
export function anonymizeStudy(prepared, userOptions, onProgress) {
  const options = { ...defaultOptions(), ...userOptions }
  const { entries, constants } = prepared

  const table = new Map()
  // El remapeo decide POR POSICIÓN, no por valor. Antes bastaba con que un UID
  // apareciese una vez en una posición constante (p.ej. CodingSchemeUID) para
  // que ese valor quedara exento en cualquier otro tag: un estudio que reusara
  // el mismo UID como FrameOfReferenceUID lo sacaba sin anonimizar.
  const remap = (raw, hex) => {
    const u = normUid(raw)
    if (!u) return u
    if (isWellKnownDicomUid(u)) return u
    if (hex ? CONSTANT_POSITIONS.has(hex) : constants.has(u)) return u
    let nu = table.get(u)
    if (!nu) {
      nu = DicomMetaDictionary.uid()
      table.set(u, nu)
    }
    return nu
  }

  const deidMethodValues = buildDeidMethodValues(options)
  const deidMethod = deidMethodValues.join('; ')
  const ctx = { options, remap, deidMethod, deidMethodValues }

  const outputs = []
  const qaIssues = []
  const pixelChecks = []
  const ctOrderLabels = buildCtOrderLabels(entries)
  const total = entries.length

  for (let i = 0; i < total; i++) {
    const entry = entries[i]
    processLevel(entry.dd.meta, ctx, true, false)
    processLevel(entry.dd.dict, ctx, false, true)

    let outBuffer
    try {
      outBuffer = entry.dd.write()
    } catch (err) {
      qaIssues.push({ file: entry.name, level: 'error', msg: `Error al escribir: ${err.message}` })
      onProgress?.(i + 1, total, entry.name)
      continue
    }

    const leaks = scanForLeaks(outBuffer, entry, prepared.originalUids, prepared.constants)
    if (leaks.length) qaIssues.push(...leaks)

    // Reparseo único de la salida: sirve de verificación de que el fichero
    // escrito sigue siendo DICOM legible, y alimenta las dos comprobaciones.
    let outDd = null
    try {
      outDd = DicomMessage.readFile(outBuffer)
    } catch (err) {
      qaIssues.push({ file: entry.name, level: 'error', msg: `La salida no se puede volver a leer como DICOM: ${err.message}` })
    }

    const pixelCheck = verifyPixelHash(outDd, entry)
    if (pixelCheck) {
      pixelChecks.push(pixelCheck)
      if (!pixelCheck.ok) qaIssues.push({ file: entry.name, level: 'error', msg: pixelCheck.msg })
    }

    if (outDd) qaIssues.push(...scanResidualPhi(outDd, entry, options))

    const newSopUid = getFirstString(entry.dd.dict, H('SOPInstanceUID'))
    outputs.push({
      name: anonymizedOutputName(entry.name, entry.kind, newSopUid, i + 1, ctOrderLabels.get(entry)),
      buffer: outBuffer
    })
    onProgress?.(i + 1, total, entry.name)
  }

  return {
    outputs,
    qaIssues,
    tableSize: table.size,
    method: deidMethod,
    uidRoot: ANON_UID_ROOT,
    uidExamples: [...table.values()].slice(0, 5),
    pixelChecks
  }
}

function buildDeidMethodValues(options) {
  const parts = [
    'PS3.15 Basic Application Confidentiality Profile',
    'ANON_UID_REMAP_2.25_UUID_OID'
  ]
  if (options.keepPatientCharacteristics) parts.push('Retain Patient Characteristics')
  if (options.keepDeviceIdentity) parts.push('Retain Device Identity')
  if (options.keepDescriptors) parts.push('Retain Descriptors')
  // NO es la opción "Retain Safe Private" de PS3.15: esa exige filtrar por
  // creador privado y lista segura. Aquí se conservan TODOS los grupos impares,
  // así que hay que declararlo tal cual y no bajo un nombre normativo que
  // promete un filtrado que no hacemos.
  if (options.keepPrivateTags) parts.push('Retain All Private Tags (unfiltered, NOT PS3.15 Retain Safe Private)')
  return parts
}

// Procesa un nivel del dataset (o meta). isMeta: grupo 0002. isRoot: dataset raíz.
function processLevel(dict, ctx, isMeta, isRoot) {
  if (!dict) return
  const { options } = ctx

  // 1) Determinar tags a borrar o vaciar en este nivel.
  const toDelete = []
  const toBlank = []
  for (const hex of Object.keys(dict)) {
    if (hex === PIXEL_DATA) continue
    if (isMeta) {
      if (META_DELETE.has(hex)) toDelete.push(hex)
      continue
    }
    const el = dict[hex]
    if (!el) continue

    // Type 2: vaciar en vez de borrar (PS3.15 acción Z). Va antes que las
    // reglas de borrado para que PN/fecha no se los lleven por delante.
    if (ZERO_LENGTH_HEX.has(hex)) {
      toBlank.push(hex)
      continue
    }
    if (hex === PATIENT_SEX_HEX && !options.keepPatientCharacteristics) {
      toBlank.push(hex)
      continue
    }
    if (META_DELETE.has(hex)) {
      toDelete.push(hex)
      continue
    }
    // Todo VR=PN salvo PatientName es identificador personal
    // (OperatorsName, ReviewerName, ROIInterpreter, Physician*, etc.).
    if (PN_VR.has(el.vr) && hex !== PATIENT_NAME_HEX) {
      toDelete.push(hex)
      continue
    }
    if (!options.keepPrivateTags && isPrivateTagHex(hex)) {
      toDelete.push(hex)
      continue
    }
    if (isOverlayGroupHex(hex) || isCurveGroupHex(hex)) {
      toDelete.push(hex)
      continue
    }
    // Guardas de retención: van ANTES de BASE_DELETE. Muchos de estos tags
    // (StudyDescription, PatientSex, DeviceUID...) también están en la lista
    // base, que se evaluaba primero, así que las opciones "conservar" no hacían
    // nada: se borraban igual mientras DeidentificationMethod declaraba que se
    // habían conservado. Nunca retienen algo de PS315_REMOVE_HEX: eso es PHI
    // dura y no es negociable por opción.
    if (!PS315_REMOVE_HEX.has(hex)) {
      if (options.keepDescriptors && (DESCRIPTOR_HEX.has(hex) || DESCRIPTOR_EXTRA_HEX.has(hex))) continue
      if (options.keepPatientCharacteristics && CHARACTERISTIC_HEX.has(hex)) continue
      if (options.keepDeviceIdentity && DEVICE_HEX.has(hex)) continue
    }
    if (BASE_DELETE.has(hex) || PS315_REMOVE_HEX.has(hex)) {
      toDelete.push(hex)
      continue
    }
    if (
      !options.keepDescriptors &&
      (DESCRIPTOR_HEX.has(hex) || DESCRIPTOR_EXTRA_HEX.has(hex)) &&
      !GENERIC_DESCRIPTOR_HEX.has(hex)
    ) {
      toDelete.push(hex)
      continue
    }
    if (!options.keepPatientCharacteristics && CHARACTERISTIC_HEX.has(hex)) {
      toDelete.push(hex)
      continue
    }
    if (!options.keepDeviceIdentity && DEVICE_HEX.has(hex)) {
      toDelete.push(hex)
      continue
    }
    // Fechas/horas que no son de estudio -> borrar.
    if (DATE_VR.has(el.vr) && !STUDY_DATE_HEX.has(hex)) {
      toDelete.push(hex)
    }
  }
  for (const hex of toDelete) delete dict[hex]
  for (const hex of toBlank) {
    if (dict[hex]) dict[hex].Value = []
  }

  // 2) Procesar los elementos restantes.
  for (const hex of Object.keys(dict)) {
    const el = dict[hex]
    if (!el) continue

    if (el.vr === 'UI' && Array.isArray(el.Value)) {
      el.Value = el.Value.map((v) => ctx.remap(v, hex))
      continue
    }
    if (el.vr === 'SQ' && Array.isArray(el.Value)) {
      for (const item of el.Value) processLevel(item, ctx, false, false)
      continue
    }
    if (isMeta) continue

    // Reemplazos puntuales (solo dataset).
    if (hex === PATIENT_NAME_HEX) {
      el.Value = [options.patientName]
      continue
    }
    if (hex === PATIENT_ID_HEX) {
      el.Value = [options.patientId]
      continue
    }
    if (STUDY_DATE_HEX.has(hex)) {
      if (el.vr === 'TM') el.Value = [options.studyTime]
      else if (el.vr === 'DT') el.Value = [`${options.studyDate}${options.studyTime}`]
      else el.Value = [options.studyDate]
      continue
    }
    if (!options.keepDescriptors && hex === ROI_NAME_HEX) {
      const n = getFirstString(dict, ROI_NUMBER_HEX)
      el.Value = [n ? `ROI_${n}` : 'ROI']
      continue
    }
    if (!options.keepDescriptors && hex === BEAM_NAME_HEX) {
      const n = getFirstString(dict, BEAM_NUMBER_HEX)
      el.Value = [n ? `BEAM_${n}` : 'BEAM']
      continue
    }
    if (GENERIC_LABEL[hex] && !options.keepDescriptors) {
      el.Value = [GENERIC_LABEL[hex]]
      continue
    }
    if (hex === TREATMENT_MACHINE_NAME && !options.keepDeviceIdentity) {
      el.Value = ['LINAC']
      continue
    }
  }

  // 3a) Reponer identidad de implementación en el meta.
  // 0002,0012 es Type 1 en PS3.10: borrarlo deja el File Meta no conforme y
  // hace fallar a validadores estrictos (dciodvfy, dcm4che). Se sustituye por
  // la nuestra en vez de eliminarse, que además documenta qué generó el fichero.
  if (isMeta) {
    dict['00020012'] = { vr: 'UI', Value: [ANON_IMPL_CLASS_UID] }
    dict['00020013'] = { vr: 'SH', Value: [ANON_IMPL_VERSION] }
  }

  // 3b) Marcar de-identificación (solo dataset raíz).
  if (!isMeta && isRoot) {
    dict[PAT_ID_REMOVED] = { vr: 'CS', Value: ['YES'] }
    dict[DEID_METHOD] = { vr: 'LO', Value: ctx.deidMethodValues }
    // Las fechas se han desplazado/fijado: hay que declararlo (PS3.15 C.7.1.1).
    dict[LONG_TEMPORAL_MODIFIED] = { vr: 'CS', Value: ['MODIFIED'] }
  }
}

// ---- QA: búsqueda binaria de identificadores originales en la salida -------
function scanForLeaks(outBuffer, entry, originalUids, constants = new Set()) {
  const issues = []
  const u8 = outBuffer instanceof Uint8Array ? outBuffer : new Uint8Array(outBuffer)
  // Se busca en las DOS decodificaciones. Interpretar solo como Latin-1 hacía
  // invisible cualquier nombre no ASCII grabado en UTF-8 (ISO_IR 192): "MUÑOZ"
  // ocupa dos bytes por "Ñ" y nunca coincidía. Con apellidos españoles eso es
  // el caso habitual, no un borde.
  const text = latinToText(u8)
  let utf8Text = ''
  try {
    utf8Text = new TextDecoder('utf-8').decode(u8)
  } catch {
    utf8Text = ''
  }
  const contains = (needle) => text.indexOf(needle) !== -1 || (utf8Text && utf8Text.indexOf(needle) !== -1)

  const check = (needle, label) => {
    if (needle && needle.length >= 3 && contains(needle)) {
      issues.push({ file: entry.name, level: 'warn', msg: `Se encontró "${needle}" (${label}) en el archivo de salida.` })
    }
  }

  // Identificadores clave de ESTE archivo.
  check(entry.sopUid, 'SOPInstanceUID original')
  check(entry.studyUid, 'StudyInstanceUID original')
  check(entry.seriesUid, 'SeriesInstanceUID original')
  check(entry.originalId, 'PatientID original')
  // Nombre: buscar apellido y nombre (partes del campo PN "Apo^Nom^...").
  for (const part of String(entry.originalName || '').split(/[\^=\\]/)) {
    check(part, 'parte del PatientName original')
  }

  // Cualquier UID original del estudio que aparezca literal.
  for (const uid of originalUids) {
    if (constants.has(uid) || isWellKnownDicomUid(uid)) continue
    if (uid.length >= 8 && contains(uid)) {
      // Evitar duplicar los ya reportados.
      if (uid !== entry.sopUid && uid !== entry.studyUid && uid !== entry.seriesUid) {
        issues.push({ file: entry.name, level: 'warn', msg: `UID original presente en la salida: ${uid}` })
      }
    }
  }
  return dedupe(issues)
}

// Verificación estructural: recorre la SALIDA ya escrita y comprueba que no
// queda ningún tag que el perfil debía retirar. Antes el QA solo buscaba UID y
// nombre/ID del paciente, así que daba "sin hallazgos" aunque quedara PHI
// clínica en texto libre (Allergies, ReasonForVisit, Impressions...).
function scanResidualPhi(outDd, entry, options) {
  const issues = []
  const seen = new Set()
  const report = (hex, why) => {
    if (seen.has(hex)) return
    seen.add(hex)
    issues.push({ file: entry.name, level: 'warn', msg: `Tag ${formatTag(hex)} sigue presente en la salida (${why}).` })
  }
  const walk = (dict) => {
    if (!dict) return
    for (const hex of Object.keys(dict)) {
      const el = dict[hex]
      if (!el || hex === PIXEL_DATA) continue
      // Un elemento de longitud cero no puede filtrar nada: es justo el
      // resultado esperado de la acción "Z" del perfil sobre los Type 2.
      if (isZeroLength(el)) continue
      if (PS315_REMOVE_HEX.has(hex)) report(hex, 'perfil PS3.15')
      else if (BASE_DELETE.has(hex)) report(hex, 'lista PHI')
      else if (isOverlayGroupHex(hex)) report(hex, 'grupo overlay')
      else if (isCurveGroupHex(hex)) report(hex, 'grupo curve')
      else if (!options.keepPrivateTags && isPrivateTagHex(hex)) report(hex, 'tag privado')
      else if (PN_VR.has(el.vr) && hex !== PATIENT_NAME_HEX) report(hex, 'VR=PN')
      else if (DATE_VR.has(el.vr) && !STUDY_DATE_HEX.has(hex)) report(hex, 'fecha/hora no anonimizada')
      if (el.vr === 'SQ' && Array.isArray(el.Value)) for (const item of el.Value) walk(item)
    }
  }
  walk(outDd.dict)
  return issues
}

function formatTag(hex) {
  return `(${hex.slice(0, 4)},${hex.slice(4)})`
}

function isZeroLength(el) {
  if (!Array.isArray(el.Value) || el.Value.length === 0) return true
  return el.Value.every((v) => v == null || valueToText(v) === '')
}

function verifyPixelHash(outDd, entry) {
  if (!entry.pixelHash) return null
  if (!outDd) return { file: entry.name, ok: false, before: entry.pixelHash, after: '', msg: 'No se pudo verificar PixelData: la salida no se pudo reparsear.' }
  try {
    const dd = outDd
    const after = pixelDataHash(dd.dict)
    if (!after) {
      return { file: entry.name, ok: false, before: entry.pixelHash, after: '', msg: 'PixelData presente al inicio pero ausente tras escribir.' }
    }
    if (after !== entry.pixelHash) {
      return { file: entry.name, ok: false, before: entry.pixelHash, after, msg: `Hash de PixelData cambió (${entry.pixelHash} -> ${after}).` }
    }
    return { file: entry.name, ok: true, before: entry.pixelHash, after }
  } catch (err) {
    return { file: entry.name, ok: false, before: entry.pixelHash, after: '', msg: `No se pudo verificar PixelData tras escribir: ${err.message}` }
  }
}

const PIXEL_CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

// El hash incluye la ESTRUCTURA (nº de fragmentos y longitud de cada uno), no
// solo los bytes concatenados. Con transfer syntax encapsulada, dcmjs puede
// reagrupar fragmentos al reescribir y cambiar cuántos frames se leen: la
// concatenación es idéntica pero el objeto ya no significa lo mismo, y un CRC
// plano lo daba por bueno.
function pixelDataHash(dict) {
  const el = dict && dict[PIXEL_DATA]
  if (!el || !Array.isArray(el.Value)) return ''
  let crc = 0xffffffff
  const shape = []
  const update = (data) => {
    if (data == null) return
    if (Array.isArray(data)) {
      for (const item of data) update(item)
      return
    }
    let u8 = null
    if (data instanceof Uint8Array) u8 = data
    else if (data instanceof ArrayBuffer) u8 = new Uint8Array(data)
    else if (ArrayBuffer.isView(data)) u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    else if (typeof data === 'string') {
      u8 = new Uint8Array(data.length)
      for (let i = 0; i < data.length; i++) u8[i] = data.charCodeAt(i) & 0xff
    }
    if (!u8) return
    shape.push(u8.length)
    for (let i = 0; i < u8.length; i++) {
      crc = PIXEL_CRC_TABLE[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8)
    }
  }
  update(el.Value)
  const bytes = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
  return `${bytes}/${shape.length}:${shape.join(',')}`
}

function latinToText(u8) {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + chunk, u8.length)))
  }
  return s
}

// ---- utilidades ------------------------------------------------------------
function countBy(arr, fn) {
  const out = {}
  for (const item of arr) {
    const k = fn(item)
    out[k] = (out[k] || 0) + 1
  }
  return out
}
function unique(arr) {
  return [...new Set(arr)]
}
function dedupe(arr) {
  const seen = new Set()
  const out = []
  for (const it of arr) {
    const k = `${it.file}|${it.msg}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}
function sanitizeName(name) {
  // Conserva carpetas relativas dentro del ZIP, pero evita rutas absolutas,
  // traversal y caracteres problemáticos para visores/Windows.
  const parts = String(name || 'dicom.dcm')
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[:*?"<>|]/g, '_'))
  return parts.join('/') || 'dicom.dcm'
}

function ctPositionProjection(entry) {
  const pos = Array.isArray(entry.imagePosition) ? entry.imagePosition : []
  if (pos.length < 3) return null
  const ori = Array.isArray(entry.imageOrientation) ? entry.imageOrientation : []
  if (ori.length >= 6) {
    const row = ori.slice(0, 3)
    const col = ori.slice(3, 6)
    const normal = [
      row[1] * col[2] - row[2] * col[1],
      row[2] * col[0] - row[0] * col[2],
      row[0] * col[1] - row[1] * col[0]
    ]
    const norm = Math.hypot(normal[0], normal[1], normal[2])
    if (norm > 0) {
      return (pos[0] * normal[0] + pos[1] * normal[1] + pos[2] * normal[2]) / norm
    }
  }
  return pos[2]
}

function ctSortValue(entry) {
  const projection = ctPositionProjection(entry)
  if (projection != null) return projection
  if (entry.sliceLocation != null) return entry.sliceLocation
  if (entry.instanceNumber != null) return entry.instanceNumber
  return null
}

function compareCtEntries(a, b) {
  const av = ctSortValue(a.entry)
  const bv = ctSortValue(b.entry)
  if (av != null && bv != null && av !== bv) return av - bv
  if (a.entry.instanceNumber != null && b.entry.instanceNumber != null && a.entry.instanceNumber !== b.entry.instanceNumber) {
    return a.entry.instanceNumber - b.entry.instanceNumber
  }
  return a.index - b.index
}

function buildCtOrderLabels(entries) {
  const groups = new Map()
  entries.forEach((entry, index) => {
    if (entry.kind !== 'CT') return
    const key = entry.seriesUid || `__ct_series_${index}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ entry, index })
  })

  const labels = new Map()
  for (const items of groups.values()) {
    const sorted = [...items].sort(compareCtEntries)
    const width = Math.max(4, String(sorted.length).length)
    sorted.forEach((item, n) => labels.set(item.entry, String(n + 1).padStart(width, '0')))
  }
  return labels
}

function detectCtGeometryWarnings(entries) {
  const warnings = []
  const groups = new Map()
  for (const entry of entries) {
    if (entry.kind !== 'CT') continue
    const key = entry.seriesUid || `__ct_series_${entry.name}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }

  for (const items of groups.values()) {
    const positioned = items
      .map((entry, index) => ({ entry, index, pos: ctPositionProjection(entry) }))
      .filter((item) => item.pos != null)
      .sort((a, b) => (a.pos === b.pos ? a.index - b.index : a.pos - b.pos))
    if (positioned.length < 3) continue
    const diffs = []
    for (let i = 1; i < positioned.length; i++) {
      const d = Math.abs(positioned[i].pos - positioned[i - 1].pos)
      if (d > 1e-6) diffs.push(d)
    }
    if (diffs.length < 2) continue
    const sortedDiffs = [...diffs].sort((a, b) => a - b)
    const expected = sortedDiffs[Math.floor(sortedDiffs.length / 2)]
    if (!Number.isFinite(expected) || expected <= 0) continue
    let worst = { delta: 0, i: -1, spacing: expected }
    for (let i = 0; i < diffs.length; i++) {
      const delta = Math.abs(diffs[i] - expected)
      if (delta > worst.delta) worst = { delta, i, spacing: diffs[i] }
    }
    const tolerance = Math.max(0.1, expected * 0.05)
    if (worst.delta > tolerance) {
      const a = positioned[worst.i]?.entry
      const b = positioned[worst.i + 1]?.entry
      warnings.push({
        file: a?.name || b?.name,
        level: 'warn',
        msg: `La serie CT ya presenta espaciado no uniforme o cortes ausentes antes de anonimizar: se esperaba ~${formatMm(expected)} mm y se encontró ${formatMm(worst.spacing)} mm${a && b ? ` entre "${a.name}" y "${b.name}"` : ''}.`
      })
    }
  }
  return warnings
}

function formatMm(n) {
  return Number(n).toFixed(3).replace(/\.000$/, '')
}

function outputTypeCode(kind) {
  // Prefijos habituales para objetos RT en sistemas DICOM: RD/RP/RS + CT.
  // El número usado en el nombre es el nuevo SOPInstanceUID anonimizado.
  const map = {
    CT: 'CT',
    RTDOSE: 'RD',
    RTPLAN: 'RP',
    RTSTRUCT: 'RS',
    RTIMAGE: 'RI',
    RTRECORD: 'RR',
    RT_ION_PLAN: 'RIP',
    RT_ION_RECORD: 'RIR',
    RT_OTHER: 'RT'
  }
  return map[kind] || 'DICOM'
}

// La salida es PLANA a propósito: no se conservan las carpetas de origen.
// Un export típico viene como "GARCIA_MARIA_HOSP12345/ACC998877/CT001.dcm" y
// antes solo se renombraba el fichero, así que el nombre y el nº de historia
// del paciente seguían dentro del ZIP aunque el dataset estuviera limpio.
// El nombre resultante ya es único (tipo + orden de corte + nuevo SOPInstanceUID).
function anonymizedOutputName(name, kind, newSopUid, fallbackIndex, ctOrderLabel = '') {
  const type = outputTypeCode(kind)
  const uidOrNum = normUid(newSopUid) || String(fallbackIndex || 1)
  const orderPrefix = kind === 'CT' && ctOrderLabel ? `${ctOrderLabel}_` : ''
  return sanitizeName(`${type}_anon_${orderPrefix}${uidOrNum}.dcm`)
}

export { defaultOptions, classifySopClass, SOP_CLASS }
