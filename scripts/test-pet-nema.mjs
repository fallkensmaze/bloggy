// Regression suite for the quantitative calibration in src/utils/petNemaDicom.js
//
// Builds synthetic PET DICOM in memory, runs it through the real
// loadPetDicomSeries(), and asserts on the voxel values that come out.
// Nothing touches disk, so npm run audit:public stays happy.
//
// Why this exists: a wrong Rescale transformation is silent. Nothing throws,
// the phantom is still found, the six spheres are still found, and the report
// still prints a perfectly plausible contrast - computed on stored values
// instead of the declared ones. The previous decoder read RescaleSlope only
// from the root dataset and applied it to every frame of a file, so an
// Enhanced PET, where that attribute lives in the functional groups, decoded
// with slope 1 and nobody could tell. And because NEMA NU 2-2018 7.4 measures
// background variability over 60 ROIs spread across five axial planes, frames
// scaled by different factors invent variability that is not in the image.
//
// So these checks pin the numbers: what each frame's stored value becomes, and
// which of the four sources (per-frame, shared, dataset, identity) it came from.

import dcmjs from 'dcmjs'
import { loadPetDicomSeries } from '../src/utils/petNemaDicom.js'

const { DicomDict, DicomMetaDictionary } = dcmjs.data
const nameMap = DicomMetaDictionary.nameMap

const T = (name) => {
  if (!nameMap[name]) throw new Error(`dcmjs no conoce la keyword ${name}`)
  return nameMap[name].tag.replace(/[(),]/g, '')
}

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
const near = (a, b, tol = 1e-3) => Number.isFinite(a) && Math.abs(a - b) <= tol

// ---- DICOM construction helpers -------------------------------------------
const PET_CLASS = '1.2.840.10008.5.1.4.1.1.128'
const ENHANCED_PET_CLASS = '1.2.840.10008.5.1.4.1.1.130'
const SERIES_UID = '1.2.826.0.1.3680043.9.5.1'
const ROWS = 2
const COLS = 2
const PIXELS_PER_FRAME = ROWS * COLS

let sopCounter = 0
const nextSop = () => `1.2.826.0.1.3680043.9.5.2.${++sopCounter}`

function metaFor(sopClass, sopInstance) {
  return {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1]).buffer] },
    '00020002': { vr: 'UI', Value: [sopClass] },
    '00020003': { vr: 'UI', Value: [sopInstance] },
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] },
    '00020012': { vr: 'UI', Value: ['1.2.826.0.1.3680043.9.5'] },
    '00020013': { vr: 'SH', Value: ['PETTEST'] }
  }
}

// Every frame is filled with a single value, so one voxel tells the whole story.
function pixelModule(frameValues) {
  const samples = new Uint16Array(frameValues.length * PIXELS_PER_FRAME)
  frameValues.forEach((value, frameIndex) => {
    samples.fill(value, frameIndex * PIXELS_PER_FRAME, (frameIndex + 1) * PIXELS_PER_FRAME)
  })
  return {
    [T('Rows')]: { vr: 'US', Value: [ROWS] },
    [T('Columns')]: { vr: 'US', Value: [COLS] },
    [T('BitsAllocated')]: { vr: 'US', Value: [16] },
    [T('BitsStored')]: { vr: 'US', Value: [16] },
    [T('HighBit')]: { vr: 'US', Value: [15] },
    [T('PixelRepresentation')]: { vr: 'US', Value: [0] },
    [T('SamplesPerPixel')]: { vr: 'US', Value: [1] },
    [T('PhotometricInterpretation')]: { vr: 'CS', Value: ['MONOCHROME2'] },
    '7FE00010': { vr: 'OW', Value: [samples.buffer] }
  }
}

function identity(sopClass, sopInstance, instanceNumber) {
  return {
    [T('SpecificCharacterSet')]: { vr: 'CS', Value: ['ISO_IR 100'] },
    [T('SOPClassUID')]: { vr: 'UI', Value: [sopClass] },
    [T('SOPInstanceUID')]: { vr: 'UI', Value: [sopInstance] },
    [T('StudyInstanceUID')]: { vr: 'UI', Value: ['1.2.826.0.1.3680043.9.5.0'] },
    [T('SeriesInstanceUID')]: { vr: 'UI', Value: [SERIES_UID] },
    [T('Modality')]: { vr: 'CS', Value: ['PT'] },
    [T('InstanceNumber')]: { vr: 'IS', Value: [String(instanceNumber)] },
    [T('Units')]: { vr: 'CS', Value: ['BQML'] }
  }
}

function transformationSequence({ slope, intercept = 0, rescaleType }) {
  const item = {
    [T('RescaleSlope')]: { vr: 'DS', Value: [String(slope)] },
    [T('RescaleIntercept')]: { vr: 'DS', Value: [String(intercept)] }
  }
  if (rescaleType) item[T('RescaleType')] = { vr: 'LO', Value: [rescaleType] }
  return { vr: 'SQ', Value: [item] }
}

function toFile(meta, dict) {
  const dicomDict = new DicomDict(meta)
  dicomDict.dict = dict
  const buffer = dicomDict.write()
  return { size: buffer.byteLength, arrayBuffer: async () => buffer }
}

// A classic PET slice: one file, one frame, transformation on the root dataset.
function classicSlice({ stored, slope, intercept, z, rescaleType, omitTransformation = false }) {
  const sop = nextSop()
  const dict = {
    ...identity(PET_CLASS, sop, z / 4 + 1),
    ...pixelModule([stored]),
    [T('PixelSpacing')]: { vr: 'DS', Value: ['4', '4'] },
    [T('SliceThickness')]: { vr: 'DS', Value: ['4'] },
    [T('SpacingBetweenSlices')]: { vr: 'DS', Value: ['4'] },
    [T('ImageOrientationPatient')]: { vr: 'DS', Value: ['1', '0', '0', '0', '1', '0'] },
    [T('ImagePositionPatient')]: { vr: 'DS', Value: ['0', '0', String(z)] }
  }
  if (!omitTransformation) {
    dict[T('RescaleSlope')] = { vr: 'DS', Value: [String(slope)] }
    dict[T('RescaleIntercept')] = { vr: 'DS', Value: [String(intercept ?? 0)] }
    if (rescaleType) dict[T('RescaleType')] = { vr: 'LO', Value: [rescaleType] }
  }
  return toFile(metaFor(PET_CLASS, sop), dict)
}

// An Enhanced PET object: one file, several frames, geometry in the functional
// groups. `dataset`, `shared` and `perFrame` each declare a transformation or
// not, which is how the precedence gets exercised.
function enhancedMultiframe({ storedValues, dataset, shared, perFrame = [] }) {
  const sop = nextSop()
  const sharedItem = {
    [T('PixelMeasuresSequence')]: {
      vr: 'SQ',
      Value: [{
        [T('PixelSpacing')]: { vr: 'DS', Value: ['4', '4'] },
        [T('SliceThickness')]: { vr: 'DS', Value: ['4'] },
        [T('SpacingBetweenSlices')]: { vr: 'DS', Value: ['4'] }
      }]
    },
    [T('PlaneOrientationSequence')]: {
      vr: 'SQ',
      Value: [{
        [T('ImageOrientationPatient')]: { vr: 'DS', Value: ['1', '0', '0', '0', '1', '0'] }
      }]
    }
  }
  if (shared) sharedItem[T('PixelValueTransformationSequence')] = transformationSequence(shared)

  const perFrameItems = storedValues.map((_, frameIndex) => {
    const item = {
      [T('PlanePositionSequence')]: {
        vr: 'SQ',
        Value: [{
          [T('ImagePositionPatient')]: { vr: 'DS', Value: ['0', '0', String(frameIndex * 4)] }
        }]
      }
    }
    const frameTransformation = perFrame[frameIndex]
    if (frameTransformation) {
      item[T('PixelValueTransformationSequence')] = transformationSequence(frameTransformation)
    }
    return item
  })

  const dict = {
    ...identity(ENHANCED_PET_CLASS, sop, 1),
    ...pixelModule(storedValues),
    [T('NumberOfFrames')]: { vr: 'IS', Value: [String(storedValues.length)] },
    [T('SharedFunctionalGroupsSequence')]: { vr: 'SQ', Value: [sharedItem] },
    [T('PerFrameFunctionalGroupsSequence')]: { vr: 'SQ', Value: perFrameItems }
  }
  if (dataset) {
    dict[T('RescaleSlope')] = { vr: 'DS', Value: [String(dataset.slope)] }
    dict[T('RescaleIntercept')] = { vr: 'DS', Value: [String(dataset.intercept ?? 0)] }
    if (dataset.rescaleType) dict[T('RescaleType')] = { vr: 'LO', Value: [dataset.rescaleType] }
  }
  return toFile(metaFor(ENHANCED_PET_CLASS, sop), dict)
}

// Frames come back sorted by axial position, so volume[i] is the i-th slice
// from the feet up and every voxel in it carries the same value.
const voxels = (series) => series.volume.map((slice) => slice[0])
const mentions = (warnings, fragment) => warnings.some((warning) => warning.includes(fragment))

// ---- Case 1: classic single-frame -----------------------------------------
async function testClassicSingleFrame() {
  section('Caso 1 - DICOM clasico de un frame')
  const series = await loadPetDicomSeries([
    classicSlice({ stored: 100, slope: 2, intercept: 10, z: 0, rescaleType: 'BQML' }),
    classicSlice({ stored: 100, slope: 2, intercept: 10, z: 4 })
  ])
  const values = voxels(series)
  check('stored 100 con slope 2 e intercept 10 da 210', near(values[0], 210), `${values[0]}`)
  check('el segundo corte tambien da 210', near(values[1], 210), `${values[1]}`)
  check('la fuente es el dataset', series.calibration.sources.join() === 'dataset', series.calibration.sources.join())
  check('RescaleType se propaga', series.calibration.rescaleTypes.includes('BQML'), series.calibration.rescaleTypes.join())
  check('no hay calibracion mixta', series.calibration.mixedAcrossFrames === false)
  check('Units se conserva', series.units === 'BQML' && series.calibration.units === 'BQML', series.units)
}

// ---- Case 2: different files, different slopes -----------------------------
async function testPerFileSlopes() {
  section('Caso 2 - ficheros single-frame con slopes distintos')
  const series = await loadPetDicomSeries([
    classicSlice({ stored: 100, slope: 2, intercept: 0, z: 0 }),
    classicSlice({ stored: 100, slope: 3, intercept: 0, z: 4 })
  ])
  const values = voxels(series)
  check('el corte 0 usa su propio slope 2', near(values[0], 200), `${values[0]}`)
  check('el corte 1 usa su propio slope 3', near(values[1], 300), `${values[1]}`)
  check('se detecta calibracion mixta', series.calibration.mixedAcrossFrames === true)
  check('se avisa de la calibracion mixta', mentions(series.warnings, 'factores de calibración distintos'))
  check('slope minimo y maximo', near(series.calibration.minimumSlope, 2) && near(series.calibration.maximumSlope, 3))
  check('el resumen muestra el rango de slopes', series.info.calibration.includes('slope 2–3'), series.info.calibration)
}

// ---- Case 3: enhanced multiframe, shared transformation --------------------
async function testEnhancedShared() {
  section('Caso 3 - multiframe con transformacion compartida')
  const series = await loadPetDicomSeries([
    enhancedMultiframe({ storedValues: [100, 200, 300], shared: { slope: 2.5, rescaleType: 'BQML' } })
  ])
  const values = voxels(series)
  check(
    'los tres frames usan la compartida',
    near(values[0], 250) && near(values[1], 500) && near(values[2], 750),
    values.join(', ')
  )
  check('la fuente es shared', series.calibration.sources.join() === 'shared', series.calibration.sources.join())
  check('la calibracion no es mixta', series.calibration.mixedAcrossFrames === false)
  check('ningun frame cae en el fallback', series.calibration.fallbackFrameCount === 0)
}

// ---- Case 4: enhanced multiframe, per-frame transformation -----------------
async function testEnhancedPerFrame() {
  section('Caso 4 - multiframe con transformacion por frame')
  const series = await loadPetDicomSeries([
    enhancedMultiframe({
      storedValues: [100, 100, 100],
      perFrame: [{ slope: 1 }, { slope: 2 }, { slope: 3 }]
    })
  ])
  const values = voxels(series)
  check('frame 0 -> 100', near(values[0], 100), `${values[0]}`)
  check('frame 1 -> 200', near(values[1], 200), `${values[1]}`)
  check('frame 2 -> 300', near(values[2], 300), `${values[2]}`)
  check('la fuente es per-frame', series.calibration.sources.join() === 'per-frame', series.calibration.sources.join())
  check('se detecta calibracion mixta', series.calibration.mixedAcrossFrames === true)
}

// ---- Case 5: precedence ----------------------------------------------------
async function testPrecedence() {
  section('Caso 5 - precedencia per-frame > shared > dataset > fallback')

  const all = await loadPetDicomSeries([
    enhancedMultiframe({
      storedValues: [100, 100],
      dataset: { slope: 2 },
      shared: { slope: 3 },
      perFrame: [{ slope: 4 }]
    })
  ])
  const allValues = voxels(all)
  check('per-frame gana a shared y a dataset', near(allValues[0], 400), `${allValues[0]}`)
  check('sin per-frame gana shared sobre dataset', near(allValues[1], 300), `${allValues[1]}`)
  check(
    'se registran ambas fuentes',
    all.calibration.sources.slice().sort().join() === 'per-frame,shared',
    all.calibration.sources.join()
  )

  const sharedOverDataset = await loadPetDicomSeries([
    enhancedMultiframe({ storedValues: [100, 100], dataset: { slope: 2 }, shared: { slope: 3 } })
  ])
  check(
    'shared gana a dataset',
    voxels(sharedOverDataset).every((value) => near(value, 300)),
    voxels(sharedOverDataset).join(', ')
  )
  check(
    'la fuente es shared',
    sharedOverDataset.calibration.sources.join() === 'shared',
    sharedOverDataset.calibration.sources.join()
  )

  const datasetOnly = await loadPetDicomSeries([
    enhancedMultiframe({ storedValues: [100, 100], dataset: { slope: 2 } })
  ])
  check(
    'dataset gana al fallback',
    voxels(datasetOnly).every((value) => near(value, 200)),
    voxels(datasetOnly).join(', ')
  )
  check(
    'la fuente es dataset',
    datasetOnly.calibration.sources.join() === 'dataset',
    datasetOnly.calibration.sources.join()
  )
}

// ---- Case 6: non-zero intercept --------------------------------------------
async function testIntercept() {
  section('Caso 6 - intercept distinto de cero')
  const series = await loadPetDicomSeries([
    enhancedMultiframe({
      storedValues: [100, 100],
      dataset: { slope: 2, intercept: 10 },
      shared: { slope: 2, intercept: -3 },
      perFrame: [{ slope: 2, intercept: 5 }]
    })
  ])
  const values = voxels(series)
  check('el intercept per-frame se aplica', near(values[0], 205), `${values[0]}`)
  check('el intercept shared se aplica', near(values[1], 197), `${values[1]}`)
  check(
    'intercept minimo y maximo',
    near(series.calibration.minimumIntercept, -3) && near(series.calibration.maximumIntercept, 5)
  )

  const classic = await loadPetDicomSeries([
    classicSlice({ stored: 50, slope: 4, intercept: -25, z: 0 }),
    classicSlice({ stored: 50, slope: 4, intercept: -25, z: 4 })
  ])
  check(
    'el intercept del dataset se aplica',
    voxels(classic).every((value) => near(value, 175)),
    voxels(classic).join(', ')
  )
}

// ---- Case 7: no transformation at all --------------------------------------
async function testMissingTransformation() {
  section('Caso 7 - sin transformacion declarada')
  const series = await loadPetDicomSeries([
    classicSlice({ stored: 100, z: 0, omitTransformation: true }),
    classicSlice({ stored: 100, z: 4, omitTransformation: true })
  ])
  const values = voxels(series)
  check('se usa la identidad slope 1 intercept 0', values.every((value) => near(value, 100)), values.join(', '))
  check('la fuente es fallback', series.calibration.sources.join() === 'fallback', series.calibration.sources.join())
  check(
    'se cuentan los frames sin transformacion',
    series.calibration.fallbackFrameCount === 2,
    `${series.calibration.fallbackFrameCount}`
  )
  check('se avisa del fallback', mentions(series.warnings, 'no declaran Rescale Slope/Intercept'))
  check('el fallback no detiene el analisis', series.volume.length === 2)

  const enhanced = await loadPetDicomSeries([enhancedMultiframe({ storedValues: [100, 100] })])
  check('un Enhanced sin transformacion tambien avisa', mentions(enhanced.warnings, 'no declaran Rescale Slope/Intercept'))
}

// ---- Regression: what already worked must keep working ---------------------
async function testRegression() {
  section('Regresion - comportamiento previo intacto')

  // The exact scenario from the brief: one file per slice, one slope each.
  const series = await loadPetDicomSeries([
    classicSlice({ stored: 1000, slope: 2.015, intercept: 0, z: 0 }),
    classicSlice({ stored: 1000, slope: 2.083, intercept: 0, z: 4 }),
    classicSlice({ stored: 1000, slope: 1.994, intercept: 0, z: 8 })
  ])
  const values = voxels(series)
  check(
    'cada corte conserva su slope',
    near(values[0], 2015) && near(values[1], 2083) && near(values[2], 1994),
    values.join(', ')
  )
  check('no se aplica un slope global de serie', !values.every((value) => near(value, values[0])))

  const uniform = await loadPetDicomSeries([
    classicSlice({ stored: 100, slope: 2, intercept: 0, z: 0 }),
    classicSlice({ stored: 100, slope: 2, intercept: 0, z: 4 })
  ])
  check('una serie uniforme no se marca como mixta', uniform.calibration.mixedAcrossFrames === false)
  check(
    'una serie uniforme no genera warnings de calibracion',
    !mentions(uniform.warnings, 'factores de calibración distintos')
      && !mentions(uniform.warnings, 'no declaran Rescale Slope/Intercept'),
    uniform.warnings.join(' | ')
  )
  check(
    'el resumen de calibracion llega a la UI',
    typeof uniform.info.calibration === 'string' && uniform.info.calibration.includes('slope'),
    uniform.info.calibration
  )
  check('el orden axial se mantiene', uniform.volume.length === 2 && near(uniform.dz, 4), `dz=${uniform.dz}`)
}

const suites = [
  testClassicSingleFrame,
  testPerFileSlopes,
  testEnhancedShared,
  testEnhancedPerFrame,
  testPrecedence,
  testIntercept,
  testMissingTransformation,
  testRegression
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
  console.error(`PET NEMA assertions FAILED: ${failures.length} of ${failures.length + passed.length} checks`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`PET NEMA assertions passed: ${passed.length} checks.`)
