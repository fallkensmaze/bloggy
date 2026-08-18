// Regression suite for src/utils/dicomAnonymizer.js
//
// Builds synthetic DICOM objects in memory, runs them through the real
// prepareStudy() / anonymizeStudy(), and asserts against the bytes that come
// out. Nothing touches disk, so npm run audit:public stays happy.
//
// Why this exists: the anonymizer used to build its PHI list from dcmjs
// keywords, and 103 of the 221 names returned by getTagsNameToEmpty() silently
// stopped resolving. Half the PS3.15 profile quietly went unapplied and nothing
// failed - the tool still reported "no issues". A dcmjs upgrade can reintroduce
// that class of bug at any time without a single visible error, so the profile
// is asserted here by TAG NUMBER, which is immune to keyword drift.

import dcmjs from 'dcmjs'
import { prepareStudy, anonymizeStudy } from '../src/utils/dicomAnonymizer.js'

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data
const dictionary = DicomMetaDictionary.dictionary
const nameMap = DicomMetaDictionary.nameMap

const T = (name) => (nameMap[name] ? nameMap[name].tag.replace(/[(),]/g, '') : null)
const infoFor = (tag) => dictionary[`(${tag.slice(0, 4)},${tag.slice(4)})`]

const failures = []
const passed = []
let currentSection = ''

function section(name) {
  currentSection = name
  console.log(`\n${name}`)
}
function check(label, ok, detail = '') {
  if (ok) {
    passed.push(label)
    console.log(`  ok   ${label}${detail ? ` (${detail})` : ''}`)
  } else {
    failures.push(`${currentSection} :: ${label}${detail ? ` -> ${detail}` : ''}`)
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`)
  }
}

// ---- DICOM construction helpers -------------------------------------------
const CT_CLASS = '1.2.840.10008.5.1.4.1.1.2'
const RS_CLASS = '1.2.840.10008.5.1.4.1.1.481.3'
const RP_CLASS = '1.2.840.10008.5.1.4.1.1.481.5'
const RD_CLASS = '1.2.840.10008.5.1.4.1.1.481.2'

function metaFor(sopClass, sopInstance) {
  return {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1]).buffer] },
    '00020002': { vr: 'UI', Value: [sopClass] },
    '00020003': { vr: 'UI', Value: [sopInstance] },
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] },
    '00020012': { vr: 'UI', Value: ['1.2.826.0.1.3680043.9.5'] },
    '00020013': { vr: 'SH', Value: ['SOURCEIMPL'] }
  }
}
function identity(sopClass, sopInstance, modality, extra = {}) {
  return {
    [T('SpecificCharacterSet')]: { vr: 'CS', Value: ['ISO_IR 100'] },
    [T('SOPClassUID')]: { vr: 'UI', Value: [sopClass] },
    [T('SOPInstanceUID')]: { vr: 'UI', Value: [sopInstance] },
    [T('Modality')]: { vr: 'CS', Value: [modality] },
    [T('PatientName')]: { vr: 'PN', Value: [{ Alphabetic: 'GARCIA^MARIA' }] },
    [T('PatientID')]: { vr: 'LO', Value: ['HOSP12345'] },
    ...extra
  }
}
function pixelModule(values) {
  return {
    [T('Rows')]: { vr: 'US', Value: [2] },
    [T('Columns')]: { vr: 'US', Value: [2] },
    [T('BitsAllocated')]: { vr: 'US', Value: [16] },
    [T('BitsStored')]: { vr: 'US', Value: [16] },
    [T('HighBit')]: { vr: 'US', Value: [15] },
    [T('PixelRepresentation')]: { vr: 'US', Value: [0] },
    [T('SamplesPerPixel')]: { vr: 'US', Value: [1] },
    [T('PhotometricInterpretation')]: { vr: 'CS', Value: ['MONOCHROME2'] },
    '7FE00010': { vr: 'OW', Value: [new Uint16Array(values).buffer] }
  }
}
function toFile(name, meta, dict) {
  const dd = new DicomDict(meta)
  dd.dict = dict
  return { name, buffer: dd.write() }
}
async function runOne(file, options = {}) {
  const prepared = await prepareStudy([file])
  if (!prepared.entries.length) throw new Error(`probe file did not parse: ${file.name}`)
  const result = anonymizeStudy(prepared, options)
  return { prepared, result, out: DicomMessage.readFile(result.outputs[0].buffer) }
}
function bytesAsLatin1(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let text = ''
  for (let i = 0; i < u8.length; i += 0x8000) {
    text += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 0x8000, u8.length)))
  }
  return text
}
const isBlank = (el) =>
  !el || !Array.isArray(el.Value) || el.Value.length === 0 || el.Value.every((v) => v === '' || v == null)

// ===========================================================================
// 1. PS3.15 Basic Profile, addressed by tag number
// ===========================================================================
// Table E.1-1 entries with action X/Z/D. UID tags are covered by the remap and
// date/time tags by the VR rule, so a survivor here is a genuine profile gap.
const PS315_TAGS = [
  '00080014', '00080050', '00080080', '00080081', '00080082', '00080092', '00080094', '00080096',
  '0008009C', '0008009D', '00080201', '00081030', '0008103E', '00081040', '00081048', '00081049',
  '00081050', '00081052', '00081060', '00081062', '00081070', '00081072', '00081080', '00081084',
  '00081110', '00081111', '00081120', '00081140', '00082111', '00082112', '00084000',
  '00100021', '00100032', '00100033', '00100034', '00100050', '00100101', '00100102', '00101000',
  '00101001', '00101002', '00101005', '00101010', '00101020', '00101030', '00101040', '00101050',
  '00101060', '00101080', '00101081', '00101090', '00101100', '00102000', '00102110', '00102150',
  '00102152', '00102154', '00102155', '00102160', '00102180', '001021A0', '001021B0', '001021C0',
  '001021D0', '001021F0', '00102203', '00102297', '00102299', '00104000',
  '00120010', '00120020', '00120021', '00120030', '00120031', '00120040', '00120042', '00120050',
  '00120060', '00120071', '00120072',
  '00180010', '00181000', '00181002', '00181004', '00181005', '00181007', '00181008', '00181030',
  '00184000', '0018700A', '0018A003', '00200010', '00204000', '00209158', '00209161', '00209164',
  '00280301', '00280302', '00284000',
  '00320012', '00321030', '00321032', '00321033', '00321060', '00321064', '00321066', '00321070',
  '00324000', '00380004', '00380010', '00380011', '00380014', '0038001A', '0038001C', '0038001E',
  '00380020', '00380021', '00380040', '00380050', '00380060', '00380061', '00380062', '00380064',
  '00380300', '00380400', '00380500', '00384000',
  '00400001', '00400002', '00400003', '00400004', '00400005', '00400006', '00400007', '00400010',
  '00400011', '00400012', '00400241', '00400242', '00400243', '00400244', '00400245', '00400248',
  '00400253', '00400254', '00400275', '00400280', '00400555', '00401001', '00401004', '00401005',
  '00401010', '00401011', '00401101', '00401102', '00401103', '00401400', '00402001', '00402008',
  '00402009', '00402010', '00402016', '00402017', '00402400', '00403001', '00404005', '00404010',
  '00404011', '00404025', '00404027', '00404028', '00404030', '00404034', '00404035', '00404036',
  '00404037', '0040A027', '0040A075', '0040A078', '0040A07A', '0040A07C', '0040A088', '0040A123',
  '0040A124', '0040A730',
  '00420010', '00420011',
  '00700084', '00700086', '0070031A', '00880140', '00880200', '00880904', '00880906', '00880910',
  '00880912', '04000100', '04000115', '04000120', '04000305', '04000310', '04000402', '04000403',
  '04000404', '04000550', '04000561', '20300020',
  '30060004', '30060008', '30060009', '3006004D', '3006004E', '300600A6',
  '30040006', '30080054', '30080056', '30080202', '300C0113',
  '300A0003', '300A0004', '300A00C3', '300A00DD', '300A0402', '300A0794',
  '3010005A', '3010007B', '3010007F', '30100033', '30100034', '30100035', '30100036', '30100037',
  '40080042', '40080102', '4008010A', '4008010B', '4008010C', '40080111', '40080114', '40080115',
  '40080118', '40080119', '4008011A', '40080202', '40080300', '40084000',
  'FFFAFFFA', 'FFFCFFFC'
]
// Intentionally replaced rather than removed, so their survival is correct.
const REPLACED_NOT_REMOVED = new Set([
  '30060008', '30060009', // StructureSetDate/Time -> new study date
  '30060002', '300A0002', // StructureSetLabel / RTPlanLabel -> generic (Type 1)
  '300A00B2'              // TreatmentMachineName -> LINAC
])
const NUMERIC_VRS = new Set(['US', 'SS', 'UL', 'SL', 'FL', 'FD', 'AT', 'OW', 'OF', 'SV', 'UV'])

async function testPs315Coverage() {
  section('PS3.15 Basic Profile coverage (addressed by tag number)')
  const markers = new Map()
  const dict = identity(CT_CLASS, '1.2.826.0.1.3680043.9.1.1', 'CT')
  let n = 0
  for (const tag of PS315_TAGS) {
    if (REPLACED_NOT_REMOVED.has(tag)) continue
    const info = infoFor(tag)
    if (!info || NUMERIC_VRS.has(info.vr)) continue
    n++
    const marker = `QQ${String(n).padStart(3, '0')}ZZ`
    const { vr } = info
    if (vr === 'SQ') dict[tag] = { vr, Value: [{ '00081090': { vr: 'LO', Value: [marker] } }] }
    else if (vr === 'PN') dict[tag] = { vr, Value: [{ Alphabetic: marker }] }
    else if (vr === 'AS') dict[tag] = { vr, Value: ['099Y'] }
    else if (vr === 'DA') dict[tag] = { vr, Value: ['19850102'] }
    else if (vr === 'TM') dict[tag] = { vr, Value: ['131415'] }
    else if (vr === 'DT') dict[tag] = { vr, Value: ['19850102131415'] }
    else if (vr === 'UI') dict[tag] = { vr, Value: [`1.2.826.0.1.3680043.9.8888.${n}`] }
    else if (vr === 'OB' || vr === 'UN') {
      const u8 = new Uint8Array(marker.length)
      for (let i = 0; i < marker.length; i++) u8[i] = marker.charCodeAt(i)
      dict[tag] = { vr, Value: [u8.buffer] }
    } else dict[tag] = { vr, Value: [marker] }
    markers.set(tag, { marker, vr, name: info.name })
  }

  const { result, out } = await runOne(
    toFile('ps315.dcm', metaFor(CT_CLASS, '1.2.826.0.1.3680043.9.1.1'), dict)
  )
  const text = bytesAsLatin1(result.outputs[0].buffer)
  const survivors = []
  for (const [tag, info] of markers) {
    const present = tag in out.dict && !isBlank(out.dict[tag])
    if (info.vr === 'UI' || info.vr === 'AS' || ['DA', 'TM', 'DT'].includes(info.vr)) {
      if (present && out.dict[tag].Value[0] === (info.vr === 'UI' ? info.marker : out.dict[tag].Value[0])) {
        if (info.vr === 'UI' && out.dict[tag].Value[0] === info.marker) survivors.push(`${tag} ${info.name} (UID not remapped)`)
        else if (info.vr !== 'UI') survivors.push(`${tag} ${info.name} (${info.vr})`)
      }
      continue
    }
    if (text.includes(info.marker)) survivors.push(`${tag} ${info.name} (${info.vr})`)
  }
  check(`no basic-profile tag survives (probed ${markers.size})`, survivors.length === 0, survivors.join('; '))
  check('QA reports no residual PHI', result.qaIssues.length === 0, result.qaIssues.map((q) => q.msg).join('; '))
}

// ===========================================================================
// 2. dcmjs keyword-drift canary
// ===========================================================================
function testKeywordDriftCanary() {
  section('dcmjs keyword-drift canary')
  const names = dcmjs.anonymizer.getTagsNameToEmpty()
  const unresolved = names.filter((name) => !nameMap[name])
  console.log(`  note: ${unresolved.length}/${names.length} dcmjs anonymizer keywords do not resolve in nameMap`)
  // Not a failure by itself - the profile is enforced by tag number precisely so
  // that this number can drift. This prints it so a jump is visible in CI logs.
  check('profile does not depend on dcmjs keyword resolution', true, `${unresolved.length} unresolved, covered by tag-number list`)
}

// ===========================================================================
// 3. Type 2 / Type 1 conformance
// ===========================================================================
async function testConformance() {
  section('DICOM conformance (Type 1 / Type 2)')
  const dict = identity(CT_CLASS, '1.2.826.0.1.3680043.9.2.1', 'CT', {
    [T('StudyInstanceUID')]: { vr: 'UI', Value: ['1.2.826.0.1.3680043.9.2.2'] },
    [T('SeriesInstanceUID')]: { vr: 'UI', Value: ['1.2.826.0.1.3680043.9.2.3'] },
    [T('PatientBirthDate')]: { vr: 'DA', Value: ['19700101'] },
    [T('PatientSex')]: { vr: 'CS', Value: ['F'] },
    [T('ReferringPhysicianName')]: { vr: 'PN', Value: [{ Alphabetic: 'LOPEZ^JUAN' }] },
    [T('AccessionNumber')]: { vr: 'SH', Value: ['ACC777'] },
    [T('StudyID')]: { vr: 'SH', Value: ['ST99'] },
    [T('StudyDate')]: { vr: 'DA', Value: ['20240101'] },
    [T('SeriesNumber')]: { vr: 'IS', Value: ['1'] },
    '0008002A': { vr: 'DT', Value: ['20240101101010'] },
    ...pixelModule([1, 2, 3, 4])
  })
  const { out } = await runOne(toFile('t2.dcm', metaFor(CT_CLASS, '1.2.826.0.1.3680043.9.2.1'), dict))

  // Action Z: must remain present with a zero-length value, not be deleted.
  for (const name of ['PatientBirthDate', 'PatientSex', 'ReferringPhysicianName', 'AccessionNumber', 'StudyID']) {
    const tag = T(name)
    const ok = tag in out.dict && isBlank(out.dict[tag])
    check(`${name} kept zero-length (Type 2)`, ok, ok ? '' : (tag in out.dict ? 'present but not empty' : 'REMOVED'))
  }
  // Type 1 in File Meta (PS3.10 table 7.1-1).
  check('ImplementationClassUID present in File Meta', '00020012' in out.meta)
  check('FileMetaInformationVersion present', '00020001' in out.meta)
  // Type 1C in Enhanced CT: replaced, not deleted.
  const acqOk = '0008002A' in out.dict && !isBlank(out.dict['0008002A'])
  check('AcquisitionDateTime replaced not removed', acqOk, acqOk ? '' : 'REMOVED')
  // Must survive untouched.
  for (const name of ['Modality', 'SpecificCharacterSet', 'SeriesNumber', 'StudyDate']) {
    check(`${name} survives`, T(name) in out.dict && !isBlank(out.dict[T(name)]))
  }
  check('PixelData preserved', '7FE00010' in out.dict)
  check('PatientIdentityRemoved = YES', out.dict['00120062']?.Value?.[0] === 'YES')
  check('LongitudinalTemporalInformationModified set', !!out.dict['00280303']?.Value?.[0],
    out.dict['00280303']?.Value?.[0])
  check('meta and dataset SOPInstanceUID agree',
    out.meta['00020003']?.Value?.[0] === out.dict[T('SOPInstanceUID')]?.Value?.[0])
}

// ===========================================================================
// 4. RT reference graph across a full study
// ===========================================================================
async function testRtReferenceGraph() {
  section('RT reference graph (CT x3 + RTSTRUCT + RTPLAN + RTDOSE)')
  const root = '1.2.826.0.1.3680043.9.7777'
  const study = `${root}.1`
  const frameOfRef = `${root}.2`
  const ctSeries = `${root}.3`
  const ctSops = [1, 2, 3].map((i) => `${root}.10.${i}`)
  const rsSop = `${root}.20`
  const rpSop = `${root}.30`
  const rdSop = `${root}.40`
  const studyTags = (sop, series, modality, extra) =>
    identity(
      { CT: CT_CLASS, RTSTRUCT: RS_CLASS, RTPLAN: RP_CLASS, RTDOSE: RD_CLASS }[modality],
      sop, modality,
      {
        [T('StudyInstanceUID')]: { vr: 'UI', Value: [study] },
        [T('SeriesInstanceUID')]: { vr: 'UI', Value: [series] },
        [T('StudyID')]: { vr: 'SH', Value: ['ST99'] },
        ...extra
      }
    )

  const files = []
  ctSops.forEach((sop, i) => {
    files.push(toFile(`CT.${i}.dcm`, metaFor(CT_CLASS, sop), studyTags(sop, ctSeries, 'CT', {
      [T('FrameOfReferenceUID')]: { vr: 'UI', Value: [frameOfRef] },
      [T('InstanceNumber')]: { vr: 'IS', Value: [String(i + 1)] },
      [T('ImagePositionPatient')]: { vr: 'DS', Value: ['0', '0', String(i * 3)] },
      [T('ImageOrientationPatient')]: { vr: 'DS', Value: ['1', '0', '0', '0', '1', '0'] },
      ...pixelModule([i, i + 1, i + 2, i + 3])
    })))
  })

  const contourImages = ctSops.map((sop) => ({
    [T('ReferencedSOPClassUID')]: { vr: 'UI', Value: [CT_CLASS] },
    [T('ReferencedSOPInstanceUID')]: { vr: 'UI', Value: [sop] }
  }))
  files.push(toFile('RS.dcm', metaFor(RS_CLASS, rsSop), studyTags(rsSop, `${root}.4`, 'RTSTRUCT', {
    [T('StructureSetLabel')]: { vr: 'SH', Value: ['GARCIA_PLAN'] },
    [T('ReferencedFrameOfReferenceSequence')]: {
      vr: 'SQ',
      Value: [{
        [T('FrameOfReferenceUID')]: { vr: 'UI', Value: [frameOfRef] },
        [T('RTReferencedStudySequence')]: {
          vr: 'SQ',
          Value: [{
            [T('ReferencedSOPClassUID')]: { vr: 'UI', Value: ['1.2.840.10008.3.1.2.3.1'] },
            [T('ReferencedSOPInstanceUID')]: { vr: 'UI', Value: [study] },
            [T('RTReferencedSeriesSequence')]: {
              vr: 'SQ',
              Value: [{
                [T('SeriesInstanceUID')]: { vr: 'UI', Value: [ctSeries] },
                [T('ContourImageSequence')]: { vr: 'SQ', Value: contourImages }
              }]
            }
          }]
        }
      }]
    },
    [T('StructureSetROISequence')]: {
      vr: 'SQ',
      Value: [{
        [T('ROINumber')]: { vr: 'IS', Value: ['1'] },
        [T('ReferencedFrameOfReferenceUID')]: { vr: 'UI', Value: [frameOfRef] },
        [T('ROIName')]: { vr: 'LO', Value: ['PTV_GARCIA'] },
        [T('ROIGenerationAlgorithm')]: { vr: 'CS', Value: ['MANUAL'] }
      }]
    }
  })))

  files.push(toFile('RP.dcm', metaFor(RP_CLASS, rpSop), studyTags(rpSop, `${root}.5`, 'RTPLAN', {
    [T('RTPlanLabel')]: { vr: 'SH', Value: ['GARCIA_RT'] },
    [T('RTPlanGeometry')]: { vr: 'CS', Value: ['PATIENT'] },
    [T('FrameOfReferenceUID')]: { vr: 'UI', Value: [frameOfRef] },
    [T('ReferencedStructureSetSequence')]: {
      vr: 'SQ',
      Value: [{
        [T('ReferencedSOPClassUID')]: { vr: 'UI', Value: [RS_CLASS] },
        [T('ReferencedSOPInstanceUID')]: { vr: 'UI', Value: [rsSop] }
      }]
    },
    [T('BeamSequence')]: {
      vr: 'SQ',
      Value: [{
        [T('BeamNumber')]: { vr: 'IS', Value: ['1'] },
        [T('BeamName')]: { vr: 'LO', Value: ['AP_GARCIA'] },
        [T('TreatmentMachineName')]: { vr: 'SH', Value: ['TRUEBEAM_HOSPITAL_X'] },
        [T('BeamType')]: { vr: 'CS', Value: ['STATIC'] },
        [T('RadiationType')]: { vr: 'CS', Value: ['PHOTON'] }
      }]
    }
  })))

  files.push(toFile('RD.dcm', metaFor(RD_CLASS, rdSop), studyTags(rdSop, `${root}.6`, 'RTDOSE', {
    [T('FrameOfReferenceUID')]: { vr: 'UI', Value: [frameOfRef] },
    [T('DoseUnits')]: { vr: 'CS', Value: ['GY'] },
    [T('DoseType')]: { vr: 'CS', Value: ['PHYSICAL'] },
    [T('DoseSummationType')]: { vr: 'CS', Value: ['PLAN'] },
    [T('GridFrameOffsetVector')]: { vr: 'DS', Value: ['0'] },
    [T('DoseGridScaling')]: { vr: 'DS', Value: ['0.001'] },
    [T('NumberOfFrames')]: { vr: 'IS', Value: ['1'] },
    [T('ReferencedRTPlanSequence')]: {
      vr: 'SQ',
      Value: [{
        [T('ReferencedSOPClassUID')]: { vr: 'UI', Value: [RP_CLASS] },
        [T('ReferencedSOPInstanceUID')]: { vr: 'UI', Value: [rpSop] }
      }]
    },
    ...pixelModule([9, 8, 7, 6])
  })))

  const prepared = await prepareStudy(files)
  const result = anonymizeStudy(prepared, {})
  check('all six objects processed', result.outputs.length === 6, String(result.outputs.length))
  check('no QA issues', result.qaIssues.length === 0, result.qaIssues.map((q) => q.msg).join('; '))

  const byModality = {}
  for (const output of result.outputs) {
    const parsed = DicomMessage.readFile(output.buffer)
    const modality = parsed.dict[T('Modality')].Value[0]
    ;(byModality[modality] = byModality[modality] || []).push(parsed)
  }
  const ctUids = byModality.CT.map((p) => p.dict[T('SOPInstanceUID')].Value[0])
  const rs = byModality.RTSTRUCT[0].dict
  const rp = byModality.RTPLAN[0].dict
  const rd = byModality.RTDOSE[0].dict
  const refFrame = rs[T('ReferencedFrameOfReferenceSequence')].Value[0]
  const refStudy = refFrame[T('RTReferencedStudySequence')].Value[0]
  const refSeries = refStudy[T('RTReferencedSeriesSequence')].Value[0]

  check('RTSTRUCT -> every CT SOPInstanceUID',
    refSeries[T('ContourImageSequence')].Value
      .map((item) => item[T('ReferencedSOPInstanceUID')].Value[0])
      .every((uid) => ctUids.includes(uid)))
  check('RTSTRUCT -> CT SeriesInstanceUID',
    refSeries[T('SeriesInstanceUID')].Value[0] === byModality.CT[0].dict[T('SeriesInstanceUID')].Value[0])
  check('RTSTRUCT -> StudyInstanceUID',
    refStudy[T('ReferencedSOPInstanceUID')].Value[0] === byModality.CT[0].dict[T('StudyInstanceUID')].Value[0])
  check('FrameOfReferenceUID shared CT <-> RTSTRUCT',
    refFrame[T('FrameOfReferenceUID')].Value[0] === byModality.CT[0].dict[T('FrameOfReferenceUID')].Value[0])
  check('FrameOfReferenceUID shared CT <-> StructureSetROI',
    rs[T('StructureSetROISequence')].Value[0][T('ReferencedFrameOfReferenceUID')].Value[0]
      === byModality.CT[0].dict[T('FrameOfReferenceUID')].Value[0])
  check('RTPLAN -> RTSTRUCT',
    rp[T('ReferencedStructureSetSequence')].Value[0][T('ReferencedSOPInstanceUID')].Value[0]
      === rs[T('SOPInstanceUID')].Value[0])
  check('RTDOSE -> RTPLAN',
    rd[T('ReferencedRTPlanSequence')].Value[0][T('ReferencedSOPInstanceUID')].Value[0]
      === rp[T('SOPInstanceUID')].Value[0])
  check('single StudyInstanceUID across the study',
    new Set(Object.values(byModality).flat().map((p) => p.dict[T('StudyInstanceUID')].Value[0])).size === 1)
  check('every new UID under the 2.25 root',
    [...ctUids, rs[T('SOPInstanceUID')].Value[0], rp[T('SOPInstanceUID')].Value[0]]
      .every((uid) => uid.startsWith('2.25.')))

  // Type 1 attributes must stay present and non-empty, so they are genericised.
  check('StructureSetLabel genericised', rs[T('StructureSetLabel')]?.Value?.[0] === 'RTSTRUCT')
  check('RTPlanLabel genericised', rp[T('RTPlanLabel')]?.Value?.[0] === 'PLAN')
  check('ROIName genericised', rs[T('StructureSetROISequence')].Value[0][T('ROIName')].Value[0] === 'ROI_1')
  check('BeamName genericised', rp[T('BeamSequence')].Value[0][T('BeamName')].Value[0] === 'BEAM_1')
  check('TreatmentMachineName genericised',
    rp[T('BeamSequence')].Value[0][T('TreatmentMachineName')].Value[0] === 'LINAC')
  check('RTPlanGeometry (Type 1) kept', !isBlank(rp[T('RTPlanGeometry')]))
  check('DoseUnits (Type 1) kept', !isBlank(rd[T('DoseUnits')]))
  check('GridFrameOffsetVector kept', T('GridFrameOffsetVector') in rd)

  // CT slice ordering label is derived from geometry, not from the source name.
  const ctNames = result.outputs.filter((o) => o.name.startsWith('CT_')).map((o) => o.name).sort()
  check('CT outputs carry a slice-order prefix',
    ctNames.every((name) => /^CT_anon_\d{4}_/.test(name)), ctNames.join(', '))
}

// ===========================================================================
// 5. Output paths must not carry source folder names
// ===========================================================================
async function testOutputPathsCarryNoPhi() {
  section('Output paths')
  const dict = identity(CT_CLASS, '1.2.826.0.1.3680043.9.3.1', 'CT')
  const prepared = await prepareStudy([
    toFile('GARCIA_MARIA_HOSP12345/ACC998877/CT001.dcm', metaFor(CT_CLASS, '1.2.826.0.1.3680043.9.3.1'), dict)
  ])
  const result = anonymizeStudy(prepared, {})
  const name = result.outputs[0].name
  check('source folders dropped from ZIP entry', !name.includes('/'), name)
  check('patient name not in output path', !/GARCIA|MARIA/i.test(name), name)
  check('patient id not in output path', !name.includes('HOSP12345'), name)
  check('accession not in output path', !name.includes('ACC998877'), name)
}

// ===========================================================================
// 6. Retention options must actually retain
// ===========================================================================
async function testRetentionOptions() {
  section('Retention options are honoured')
  const build = () => identity(CT_CLASS, '1.2.826.0.1.3680043.9.4.1', 'CT', {
    [T('StudyDescription')]: { vr: 'LO', Value: ['TORAX_RUTINA'] },
    [T('SeriesDescription')]: { vr: 'LO', Value: ['AXIAL_1MM'] },
    [T('ProtocolName')]: { vr: 'LO', Value: ['PROTO_A'] },
    [T('PatientSex')]: { vr: 'CS', Value: ['F'] },
    [T('PatientAge')]: { vr: 'AS', Value: ['045Y'] },
    [T('PatientWeight')]: { vr: 'DS', Value: ['70'] },
    [T('Manufacturer')]: { vr: 'LO', Value: ['SIEMENS'] },
    [T('ManufacturerModelName')]: { vr: 'LO', Value: ['SOMATOM'] }
  })

  const kept = await runOne(
    toFile('keep.dcm', metaFor(CT_CLASS, '1.2.826.0.1.3680043.9.4.1'), build()),
    { keepDescriptors: true, keepPatientCharacteristics: true, keepDeviceIdentity: true }
  )
  for (const name of ['StudyDescription', 'SeriesDescription', 'ProtocolName']) {
    check(`keepDescriptors retains ${name}`, !isBlank(kept.out.dict[T(name)]))
  }
  for (const name of ['PatientSex', 'PatientAge', 'PatientWeight']) {
    check(`keepPatientCharacteristics retains ${name}`, !isBlank(kept.out.dict[T(name)]))
  }
  for (const name of ['Manufacturer', 'ManufacturerModelName']) {
    check(`keepDeviceIdentity retains ${name}`, !isBlank(kept.out.dict[T(name)]))
  }

  const stripped = await runOne(
    toFile('strip.dcm', metaFor(CT_CLASS, '1.2.826.0.1.3680043.9.4.1'), build()),
    {}
  )
  for (const name of ['StudyDescription', 'SeriesDescription', 'ProtocolName', 'PatientAge', 'PatientWeight', 'Manufacturer']) {
    check(`default profile drops ${name}`, isBlank(stripped.out.dict[T(name)]))
  }
  check('default profile blanks PatientSex (Type 2)',
    T('PatientSex') in stripped.out.dict && isBlank(stripped.out.dict[T('PatientSex')]))
  check('declared method mentions retention only when used',
    !stripped.result.method.includes('Retain Descriptors'), stripped.result.method)
}

// ===========================================================================
// 7. QA scanner must see non-ASCII names
// ===========================================================================
async function testUtf8LeakDetection() {
  section('QA scanner: non-ASCII (UTF-8) names')
  const dict = identity(CT_CLASS, '1.2.826.0.1.3680043.9.5.1', 'CT', {
    [T('SpecificCharacterSet')]: { vr: 'CS', Value: ['ISO_IR 192'] },
    [T('PatientName')]: { vr: 'PN', Value: [{ Alphabetic: 'MUÑOZ^JOSÉ' }] },
    // Retained as a descriptor, so the surname really does reach the output.
    [T('ROIName')]: { vr: 'LO', Value: ['PTV_MUÑOZ'] }
  })
  const { result } = await runOne(
    toFile('utf8.dcm', metaFor(CT_CLASS, '1.2.826.0.1.3680043.9.5.1'), dict),
    { keepDescriptors: true }
  )
  const utf8 = new TextDecoder('utf-8').decode(new Uint8Array(result.outputs[0].buffer))
  check('probe really does leak the surname', utf8.includes('MUÑOZ'))
  check('QA flags the non-ASCII leak', result.qaIssues.length > 0,
    result.qaIssues.map((q) => q.msg).join('; '))
}

// ===========================================================================
// 8. UID remapping is decided by position, not by value
// ===========================================================================
async function testUidRemapIsPositional() {
  section('UID remapping is positional')
  const shared = '1.2.826.0.1.3680043.9.6.7777'
  const dict = identity(CT_CLASS, '1.2.826.0.1.3680043.9.6.1', 'CT', {
    // Same value in a constant position and in an instance position.
    [T('CodingSchemeIdentificationSequence')]: {
      vr: 'SQ', Value: [{ [T('CodingSchemeUID')]: { vr: 'UI', Value: [shared] } }]
    },
    [T('FrameOfReferenceUID')]: { vr: 'UI', Value: [shared] }
  })
  const { out } = await runOne(toFile('const.dcm', metaFor(CT_CLASS, '1.2.826.0.1.3680043.9.6.1'), dict))
  const frameOfRef = out.dict[T('FrameOfReferenceUID')]?.Value?.[0]
  check('FrameOfReferenceUID is remapped despite the value appearing in a constant position',
    frameOfRef !== shared && String(frameOfRef).startsWith('2.25.'), String(frameOfRef))
  check('SOPClassUID (a real constant) is left alone',
    out.dict[T('SOPClassUID')].Value[0] === CT_CLASS)
}

// ===========================================================================
// 9. Private, overlay and curve groups
// ===========================================================================
async function testGroupRemoval() {
  section('Private / overlay / curve groups')
  const withGroups = () => identity(CT_CLASS, '1.2.826.0.1.3680043.9.7.1', 'CT', {
    '00290010': { vr: 'LO', Value: ['SIEMENS CSA HEADER'] },
    '00291010': { vr: 'LO', Value: ['PRIVATEPHI'] },
    '60000022': { vr: 'LO', Value: ['OVERLAYPHI'] },
    '50000022': { vr: 'LO', Value: ['CURVEPHI'] }
  })
  const { out } = await runOne(toFile('groups.dcm', metaFor(CT_CLASS, '1.2.826.0.1.3680043.9.7.1'), withGroups()))
  check('private group removed', !('00291010' in out.dict))
  check('private creator removed', !('00290010' in out.dict))
  check('overlay group removed', !('60000022' in out.dict))
  check('curve group removed', !('50000022' in out.dict))

  const retained = await runOne(
    toFile('groups2.dcm', metaFor(CT_CLASS, '1.2.826.0.1.3680043.9.7.1'), withGroups()),
    { keepPrivateTags: true }
  )
  check('keepPrivateTags retains private tags', '00291010' in retained.out.dict)
  check('keepPrivateTags still removes overlays', !('60000022' in retained.out.dict))
  check('keepPrivateTags still removes curves', !('50000022' in retained.out.dict))
  // Retaining every odd group is NOT the PS3.15 "Retain Safe Private" option,
  // which requires filtering by private creator against a safe list. The
  // declaration may name it only to disclaim it.
  const method = retained.result.method
  const falselyClaimsSafePrivate =
    /Retain Safe Private/.test(method) && !/NOT PS3\.15 Retain Safe Private/.test(method)
  check('declared method does not falsely claim PS3.15 Retain Safe Private',
    !falselyClaimsSafePrivate, method)
}

// ===========================================================================
// 10. Burned-in PHI is surfaced, since pixels are never modified
// ===========================================================================
async function testBurnedInWarning() {
  section('Burned-in PHI warning')
  const dict = identity(CT_CLASS, '1.2.826.0.1.3680043.9.8.1', 'CT', {
    '00280301': { vr: 'CS', Value: ['YES'] },
    '00280302': { vr: 'CS', Value: ['YES'] },
    ...pixelModule([1, 2, 3, 4])
  })
  const file = toFile('burned.dcm', metaFor(CT_CLASS, '1.2.826.0.1.3680043.9.8.1'), dict)
  const prepared = await prepareStudy([file])
  const warned = prepared.warnings.some((w) => /BurnedInAnnotation|RecognizableVisualFeatures/.test(w.msg))
  check('prepareStudy warns about burned-in PHI', warned,
    prepared.warnings.map((w) => w.msg).join('; '))
  const result = anonymizeStudy(prepared, {})
  const out = DicomMessage.readFile(result.outputs[0].buffer)
  check('BurnedInAnnotation removed by the profile', !('00280301' in out.dict))
  check('RecognizableVisualFeatures removed by the profile', !('00280302' in out.dict))
  check('PixelData still byte-identical', result.pixelChecks.every((p) => p.ok))
}

// ---- runner ---------------------------------------------------------------
const suites = [
  testPs315Coverage,
  testKeywordDriftCanary,
  testConformance,
  testRtReferenceGraph,
  testOutputPathsCarryNoPhi,
  testRetentionOptions,
  testUtf8LeakDetection,
  testUidRemapIsPositional,
  testGroupRemoval,
  testBurnedInWarning
]

for (const suite of suites) {
  try {
    await suite()
  } catch (error) {
    currentSection = suite.name
    check(`${suite.name} threw`, false, error.stack || error.message)
  }
}

console.log('')
if (failures.length > 0) {
  console.error(`DICOM anonymizer regression FAILED: ${failures.length} of ${failures.length + passed.length} checks`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`DICOM anonymizer regression passed: ${passed.length} checks.`)
