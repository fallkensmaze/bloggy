import assert from 'node:assert/strict'
import fs from 'node:fs'
import dcmjs from 'dcmjs'
import { parseGammaDicom, dicomDateTime, classifyGamma } from '../src/utils/gammaDicom.js'
import { analyzeResolution, profileWidths } from '../src/utils/gammaResolution.js'
import { analyzeSensitivity, decayActivity } from '../src/utils/gammaSensitivity.js'
import { analyzeGammaEntry, initialGammaOptions } from '../src/utils/gammaBatch.js'
import { validateMonthlyBatch, monthlyCompleteness, monthlyVerdict, evaluateGammaMetrics } from '../src/utils/gammaReport.js'
import { NAV_LINKS, NAV_SECTIONS } from '../src/utils/navigation.js'

let passed = 0
function test(name, fn) { fn(); passed++; console.log(`ok ${name}`) }
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`)

function makeDicom(overrides = {}, syntax = '1.2.840.10008.1.2.1') {
  const d = { SOPClassUID: '1.2.840.10008.5.1.4.1.1.20', SOPInstanceUID: '1.2.826.0.1.3680043.10.1000.1',
    Modality: 'NM', Rows: 2, Columns: 3, NumberOfFrames: 2, BitsAllocated: 16, BitsStored: 12, HighBit: 11,
    PixelRepresentation: 0, SamplesPerPixel: 1, PhotometricInterpretation: 'MONOCHROME2', PixelSpacing: [2, 3],
    ActualFrameDuration: 10000, ImageType: ['ORIGINAL', 'PRIMARY', 'STATIC', 'EMISSION'],
    AcquisitionDate: '20260903', AcquisitionTime: '123454.899000', SeriesDate: '20261001', StationName: 'CAM-A',
    Manufacturer: 'SYNTHETIC', ManufacturerModelName: 'QA', PatientName: 'DO_NOT_RETAIN', PatientID: 'DO_NOT_RETAIN',
    DetectorVector: [2, 1], EnergyWindowVector: [1, 1],
    DetectorInformationSequence: [{ CollimatorGridName: 'A' }, { CollimatorGridName: 'B' }],
    EnergyWindowInformationSequence: [{ EnergyWindowName: 'Tc', EnergyWindowRangeSequence: [{ EnergyWindowLowerLimit: 130, EnergyWindowUpperLimit: 150 }] }],
    PixelData: [new Uint16Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer], ...overrides }
  const dict = new dcmjs.data.DicomDict({ '00020010': { vr: 'UI', Value: [syntax] } })
  dict.dict = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(d)
  dict.dict['7FE00010'].vr = 'OW'
  return dict.write()
}

test('Native DICOM: per-frame detector mapping, counts, ms→s, acquisition date, no PHI', () => {
  const p = parseGammaDicom(makeDicom())
  assert.deepEqual(p.frameInfo.map(f => f.detectorNumber), [2, 1])
  assert.deepEqual(p.frameInfo.map(f => f.totalCounts), [21, 57])
  assert.equal(p.frameInfo[0].durationSeconds, 10)
  assert.equal(p.metadata.acquiredAt, '2026-09-03T12:34:54.899000')
  assert.equal(p.frameInfo[0].collimator, 'B')
  assert.ok(!JSON.stringify(p).includes('DO_NOT_RETAIN'))
})
test('Missing detector vector cannot silently relabel multi-head frames', () => {
  assert.equal(parseGammaDicom(makeDicom({ DetectorVector: undefined })).frameInfo[0].detectorNumber, null)
})
test('Missing duration, invalid date, rescaling and compressed transfer syntax do not invent quantitative data', () => {
  const p = parseGammaDicom(makeDicom({ ActualFrameDuration: '', AcquisitionDate: '20260230', RescaleSlope: 2 }))
  assert.equal(p.frameInfo[0].durationSeconds, null); assert.equal(p.metadata.acquiredAt, ''); assert.equal(p.frameInfo[0].countsUsable, false)
  assert.throws(() => parseGammaDicom(makeDicom({}, '1.2.840.10008.1.2.4.50')), /comprimida/)
  assert.equal(dicomDateTime('20260903'), '2026-09-03')
})
test('Truncated PixelData is rejected', () => assert.throws(() => parseGammaDicom(makeDicom({ NumberOfFrames: 3 })), /incompleto/))
test('Monthly COR never invents a missing angular step or combines energy windows', () => {
  const base = { AngularViewVector: [1, 2], RotationVector: [1, 1],
    RotationInformationSequence: [{ AngularStep: 30, StartAngle: 0, RotationDirection: 'CC' }] }
  assert.equal(parseGammaDicom(makeDicom(base)).hasCorGeometry, true)
  assert.equal(parseGammaDicom(makeDicom({ ...base, RotationInformationSequence: [{ StartAngle: 0, RotationDirection: 'CC' }] })).hasCorGeometry, false)
  assert.equal(parseGammaDicom(makeDicom({ ...base, EnergyWindowVector: [1, 2],
    EnergyWindowInformationSequence: [{ EnergyWindowName: 'photopeak' }, { EnergyWindowName: 'scatter' }] })).hasCorGeometry, false)
})

const gaussian = (sigma, n = 101, background = 0) => Array.from({ length: n }, (_, x) => background + 10000 * Math.exp(-0.5 * ((x - (n - 1) / 2) / sigma) ** 2))
test('Gaussian crossings agree with analytical FWHM=2√(2ln2)σ and FWTM=2√(2ln10)σ', () => {
  const r = profileWidths(gaussian(5), 0.4)
  near(r.fwhm.mm, 2 * Math.sqrt(2 * Math.log(2)) * 2, 0.015)
  // Linear interpolation of samples at 0.4 mm has finite discretization error (<0.1 pixel here).
  near(r.fwtm.mm, 2 * Math.sqrt(2 * Math.log(10)) * 2, 0.04)
})
test('Optional pedestal removal and invalid/truncated/multiple peaks', () => {
  near(profileWidths(gaussian(5, 101, 300), 1, true).fwhm.mm, profileWidths(gaussian(5), 1).fwhm.mm, 1e-8)
  assert.throws(() => profileWidths([8, 9, 10, 20, 10, 9, 8], 1), /truncado/)
  assert.throws(() => profileWidths(Array(10).fill(0), 1), /sin señal/)
  const p = gaussian(3); p[10] = 4000; assert.throws(() => profileWidths(p, 1), /Más de un pico/)
})
function lineImage(axis) {
  const rows = 160, cols = 160, data = new Float64Array(rows * cols)
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const along = axis === 'X' ? y : x, across = axis === 'X' ? x : y
    data[y * cols + x] = along > 10 && along < 150 ? 5000 * Math.exp(-0.5 * ((across - 80) / 3) ** 2) : 0
  }
  return { rows, cols, frames: [data], pixelSpacing: [0.5, 1], isStatic: true }
}
test('Spatial resolution uses column spacing for X, row spacing for Y, five disjoint strips', () => {
  const x = analyzeResolution(lineImage('X'), 0), y = analyzeResolution(lineImage('Y'), 0)
  assert.equal(x.axis, 'X'); assert.equal(y.axis, 'Y'); near(x.fwhmMm / y.fwhmMm, 2)
  near(x.fwhmMm, 2 * Math.sqrt(2 * Math.log(2)) * 3, 0.03)
  assert.equal(x.profiles.length, 5)
  assert.ok(x.profiles.every((p, i) => i === 0 || p.offset - x.profiles[i - 1].offset >= 8))
  assert.throws(() => analyzeResolution({ ...lineImage('X'), pixelSpacing: null }, 0), /PixelSpacing/)
  assert.throws(() => analyzeResolution(lineImage('X'), 0, { axis: 'Y' }), /perpendicular/)
})

const sensitivityImage = { isStatic: true, metadata: { acquiredAt: '2026-09-03T12:00:00' },
  frameInfo: [{ totalCounts: 120000, durationSeconds: 60, countsUsable: true }] }
const sensitivityOptions = { activityMBq: 20, activityAt: '2026-09-03T11:00:00', halfLifeHours: 1,
  backgroundMode: 'measured', backgroundCounts: 600, backgroundSeconds: 60 }
test('Sensitivity: one half-life, background, exposure-integrated activity and Poisson variance', () => {
  const r = analyzeSensitivity(sensitivityImage, 0, sensitivityOptions)
  near(r.netActivityStartMBq, 10); near(r.netCps, 1990)
  const meanA = 10 * (1 - 2 ** (-1 / 60)) / (Math.log(2) / 60)
  near(r.meanActivityMBq, meanA)
  near(r.sensitivity, 1990 / meanA)
  near(r.statisticalUncertainty, Math.sqrt((120000 + 600) / 60 ** 2) / meanA)
})
test('Residual activity gets its own clock; crossing midnight is explicit', () => {
  near(decayActivity(20, '2026-09-02T23:30', '2026-09-03T00:30', 3600), 10)
  near(analyzeSensitivity(sensitivityImage, 0, { ...sensitivityOptions, useResidual: true,
    residualMBq: 1, residualAt: '2026-09-03T12:00:00' }).netActivityStartMBq, 9)
})
test('Missing activity/date/background, incompatible counts and negative net rate block sensitivity', () => {
  for (const patch of [{ activityMBq: '' }, { activityAt: '2026-09-03' }, { halfLifeHours: '' }, { backgroundMode: '' }, { backgroundCounts: 9999999 }]) {
    assert.throws(() => analyzeSensitivity(sensitivityImage, 0, { ...sensitivityOptions, ...patch }))
  }
  assert.throws(() => analyzeSensitivity({ ...sensitivityImage, frameInfo: [{ ...sensitivityImage.frameInfo[0], countsUsable: false }] }, 0, sensitivityOptions), /cuentas originales/)
})

const batchEntry = (name, station = 'CAM-A', date = '2026-09-03T12:00') => ({ name, image: {
  instanceUid: name, metadata: { station, serial: '', model: 'QA', acquiredAt: date, equipment: station } } })
test('Monthly batch: same camera/month only, never silently discard errors, duplicates or absent identity', () => {
  assert.ok(validateMonthlyBatch([batchEntry('a'), batchEntry('b', 'cam-a', '2026-09-30')]).valid)
  for (const bad of [batchEntry('b', 'CAM-B'), batchEntry('b', 'CAM-A', '2026-08-31'), batchEntry('b', ''), batchEntry('b', 'CAM-A', ''), batchEntry('a'), { name: 'b', error: 'corrupt' }]) {
    assert.equal(validateMonthlyBatch([batchEntry('a'), bad]).valid, false)
  }
  assert.equal(validateMonthlyBatch([]).valid, false)
})
test('A missing test or unsigned/limitless result cannot yield a conforming report', () => {
  const r = [{ type: 'resolution', detector: 1, axis: 'X', status: 'Conforme' }]
  const missing = monthlyCompleteness(r, [1, 2])
  assert.ok(missing.includes('Resolución Y · cabezal 1'))
  assert.ok(missing.includes('Reconstrucción tomográfica'))
  assert.equal(monthlyVerdict(r, missing), 'Informe incompleto')
  assert.equal(monthlyVerdict([{ status: 'Sin tolerancia' }], []), 'Pendiente de evaluación')
  const metrics = [{ value: 7, limit: 8 }]
  assert.equal(evaluateGammaMetrics(metrics).status, 'Sin tolerancia')
  assert.equal(evaluateGammaMetrics(metrics, { limitSource: 'local' }).status, 'Adquisición no verificada')
  assert.equal(evaluateGammaMetrics(metrics, { limitSource: 'local', protocol: 'reference', verified: true }).status, 'Conforme')
  assert.equal(evaluateGammaMetrics([{ value: 9, limit: 8 }]).status, 'No conforme')
  assert.equal(evaluateGammaMetrics([{ value: 0, limit: '' }]).status, 'Sin tolerancia')
})
test('Unknown descriptions need classification; tomography never passes automatically', () => {
  const image = parseGammaDicom(makeDicom({ SeriesDescription: 'desconocida' }))
  assert.equal(classifyGamma(image), 'unknown')
  const records = analyzeGammaEntry({ name: 'synthetic', id: 'test', image, type: 'tomography', options: initialGammaOptions(image) })
  assert.equal(records[0].status, 'Pendiente de revisión')
})
test('Navigation catalog is unique and both private routes stay admin-only', () => {
  assert.equal(new Set(NAV_LINKS.map(l => l.href)).size, NAV_LINKS.length)
  assert.ok(NAV_LINKS.every(l => NAV_SECTIONS.includes(l.section)))
  for (const href of ['/radioaficionado', '/informe-mensual-gamma']) assert.equal(NAV_LINKS.find(l => l.href === href).admin, true)
})

// Optional local fixtures: never commit the user's DICOM files or their pixel data.
if (process.env.GAMMA_QC_FIXTURE_DIR) {
  test('Provided DICOM: both axes/heads, true dates, counts and mixed-batch rejection', () => {
    const files = fs.readdirSync(process.env.GAMMA_QC_FIXTURE_DIR).filter(f => f.endsWith('.dcm'))
    const entries = files.map((name, i) => {
      const b = fs.readFileSync(`${process.env.GAMMA_QC_FIXTURE_DIR}/${name}`)
      const buffer = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), image = parseGammaDicom(buffer)
      return { name, id: String(i), buffer, image, type: classifyGamma(image), options: initialGammaOptions(image) }
    })
    const spatial = entries.filter(e => e.type === 'resolution').flatMap(analyzeGammaEntry)
    assert.deepEqual(spatial.map(r => [r.detector, r.axis]), [[1, 'X'], [2, 'X'], [1, 'Y'], [2, 'Y']])
    assert.ok(spatial.every(r => r.metrics[0].value > 7 && r.metrics[0].value < 8))
    const sensitivity = entries.find(e => e.type === 'sensitivity')
    assert.deepEqual(sensitivity.image.frameInfo.map(f => f.totalCounts), [4000000, 4000000])
    assert.equal(sensitivity.image.metadata.acquiredAt.slice(0, 10), '2026-08-10')
    assert.equal(validateMonthlyBatch(entries).valid, false)
    assert.equal(validateMonthlyBatch(entries.filter(e => e.type === 'resolution')).valid, true)
    assert.ok(analyzeGammaEntry(sensitivity).every(r => r.status === 'No evaluable'))
  })
}
console.log(`\n${passed} gamma QC checks passed.`)
