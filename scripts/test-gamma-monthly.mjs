import assert from 'node:assert/strict'
import fs from 'node:fs'
import dcmjs from 'dcmjs'
import { sensitivityInUnit } from '../src/utils/gammaSensitivity.js'
import { analyzeGammaEntry, initialGammaOptions } from '../src/utils/gammaBatch.js'
import { parseGammaDicom, classifyGamma } from '../src/utils/gammaDicom.js'
import { applyMonthlyReference, buildMonthlyReport, sensitivityReportMetric } from '../src/utils/gammaMonthlyReport.js'
import { validateMonthlyBatch, evaluateGammaMetrics } from '../src/utils/gammaReport.js'
import { matchesMonthlyReference, MONTHLY_LIMITS, configuredGammaMetrics } from '../src/utils/gammaQcLimits.js'
import { loadTomoDicomSeries } from '../src/utils/tomoDicom.js'
import { proposeCylinder, analyzeTomoUniformity } from '../src/utils/tomoUniformity.js'

let passed = 0
function test(name, fn) { fn(); passed++; console.log(`ok ${name}`) }
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)
const base = { metadata: { acquiredAt: '2026-01-05T10:00:00', equipment: 'SYNTHETIC' } }
const m = (key, value, limit = null, unit = '%') => ({ key, value, limit, unit, operator: 'max' })
const entry = (records, extra = {}) => ({ type: records[0]?.type, records, included: true, ...extra })
const resolution = (axis, value, limit = 7.5) => ({ id: axis, type: 'resolution', detector: 1, axis,
  metrics: [m('fwhm', value, limit, 'mm'), m('fwtm', 13, 13.6, 'mm')],
  inputs: { verified: true }, protocol: 'test reference', limitSource: 'synthetic local',
  status: value > limit ? 'No conforme' : 'Conforme' })

test('202 cpm/µCi is 90.99099 cps/MBq, with missing and unsupported units explicit', () => {
  near(sensitivityInUnit(202 / 2.22, 'cpm/µCi'), 202)
  near(sensitivityInUnit(202 / 2.22, 'cps/MBq'), 90.99099099099098)
  assert.equal(sensitivityInUnit(null), null)
  assert.throws(() => sensitivityInUnit(1, 'unknown'), /Unidad/)
})
test('Absolute minimum and relative reference compare in the selected display unit', () => {
  const image = { ...base, isStatic: true, frames: [[]], frameInfo: [{ detectorNumber: 1, totalCounts: 6000, durationSeconds: 60, countsUsable: true }] }
  const options = { ...initialGammaOptions(image), activityAt: image.metadata.acquiredAt, activityMBq: 1,
    halfLifeHours: 1e10, backgroundMode: 'negligible', protocol: 'test', limitSource: 'test', verified: true,
    sensitivityComparison: 'minimum', sensitivityUnit: 'cpm/µCi', minimumSensitivity: 202 }
  const get = patch => analyzeGammaEntry({ image, id: 's', name: 's', type: 'sensitivity', options: { ...options, ...patch } })[0]
  const result = get({})
  assert.equal(result.status, 'Conforme'); near(result.metrics[0].value, 222, 1e-6)
  assert.equal(result.metrics[0].operator, 'min'); assert.equal(result.metrics[0].unit, 'cpm/µCi')
  assert.equal(get({ minimumSensitivity: 223 }).status, 'No conforme')
  assert.equal(get({ minimumSensitivity: '' }).status, 'Sin tolerancia')
  assert.equal(get({ activityMBq: '' }).status, 'No evaluable')
  assert.equal(get({ sensitivityComparison: 'reference', referenceSensitivity: 222, sensitivityTolerance: 0.1 }).status, 'Conforme')
  assert.equal(get({ verified: false }).status, 'Adquisición no verificada')
})
test('Reference profile supplies limits only and clears conflicting head overrides', () => {
  const options = { ...initialGammaOptions(base), activityMBq: '', verified: true,
    frameOptions: { 0: { backgroundCounts: 123, sensitivityComparison: 'reference', minimumSensitivity: 999 } } }
  const applied = applyMonthlyReference({ type: 'sensitivity', options })
  assert.equal(applied.options.verified, false); assert.equal(applied.options.activityMBq, '')
  assert.equal(applied.options.minimumSensitivity, '202'); assert.equal(applied.options.sensitivityUnit, 'cpm/µCi')
  assert.equal(applied.options.frameOptions[0].minimumSensitivity, '202')
  assert.equal(applied.options.frameOptions[0].backgroundCounts, 123)
  assert.equal(options.frameOptions[0].minimumSensitivity, 999)
})
test('Excel defaults match only the identified 2026 Sala 1 camera', () => {
  const match = patch => matchesMonthlyReference({ metadata: { acquiredAt: '2026-01-05', station: 'SYMBIA1660', ...patch } })
  assert.equal(match({}), true)
  assert.equal(match({ station: '', serial: '1660' }), true)
  assert.equal(match({ serial: '2402' }), false)
  assert.equal(match({ station: 'SYMBIA2402', serial: '1660' }), false)
  assert.equal(match({ station: 'SYMBIA16601' }), false)
  assert.equal(match({ station: '', model: 'Symbia Intevo Bold' }), false)
  assert.equal(match({ acquiredAt: '2027-01-05' }), false)
  assert.equal(matchesMonthlyReference(null), false)
})
test('Workbook limits retain correct IU/DU mapping and exact COR half-pixel boundary', () => {
  assert.deepEqual(MONTHLY_LIMITS.uniformity, { DUcfov: 2.5, DUufov: 2.7, IUcfov: 2.9, IUufov: 3.7 })
  const applied = type => applyMonthlyReference({ type, options: initialGammaOptions(base) })
  assert.equal(applied('cor').options.corLimit, '1.1988')
  assert.equal(applied('cor').options.axialLimit, '1.1988')
  const input = { ...applied('cor').options, protocol: 'synthetic', verified: true }
  const evaluate = value => evaluateGammaMetrics(configuredGammaMetrics('cor', input).map(m => ({ ...m, value })), input)
  assert.equal(evaluate(1.1988).status, 'Conforme')
  assert.equal(evaluate(1.199).status, 'No conforme')
  assert.equal(applied('resolution').options.fwhmLimit, '7.5')
  assert.equal(applied('resolution').options.fwtmLimit, '13.6')
  assert.equal(applied('tomography').options.tomoLimitPercent, '10')
  assert.equal(applied('tomography').options.tomoUniformityPercent, '')
  assert.equal(applied('tomography').options.tomoUniformityDefinition, '')
  assert.match(applied('tomography').options.limitSource, /Resumen mensuales!C102/)
})
test('Tomography local comparison requires a defined measure, tolerance and visual review', () => {
  const image = { ...base, frames: [[]], imageType: ['ORIGINAL', 'PRIMARY', 'RECON TOMO'] }
  const e = applyMonthlyReference({ image, id: 't', type: 'tomography', options: initialGammaOptions(image) })
  const reviewed = { ...e.options, protocol: 'synthetic', verified: true, tomoVerdict: 'Conforme', tomoObservations: 'Reviewed',
    tomoUniformityDefinition: 'Synthetic percentage defined by local protocol', tomoUniformityPercent: '10' }
  const get = patch => analyzeGammaEntry({ ...e, options: { ...reviewed, ...patch }, tomoQuantitative: { results: [{ uniformityPercent: 1 }] } })[0]
  assert.equal(get({}).status, 'Conforme')
  assert.equal(get({ tomoUniformityPercent: '10.0001' }).status, 'No conforme')
  assert.equal(get({ tomoUniformityPercent: '0' }).status, 'Conforme')
  assert.equal(get({ tomoUniformityPercent: '-1' }).status, 'No evaluable')
  assert.equal(get({ tomoUniformityPercent: '' }).status, 'No evaluable')
  assert.equal(get({ tomoUniformityDefinition: '' }).status, 'No evaluable')
  assert.equal(get({ tomoLimitPercent: '' }).status, 'Sin tolerancia')
  assert.equal(get({ verified: false }).status, 'Pendiente de revisión')
  assert.equal(get({ tomoVerdict: '' }).status, 'Pendiente de revisión')
  assert.equal(get({ tomoVerdict: 'No conforme', tomoUniformityPercent: '0' }).status, 'No conforme')
  assert.equal(get({ tomoUniformityPercent: '' }).metrics[0].limit, 10)
  assert.equal(get({ tomoUniformityPercent: '' }).metrics[0].value, null, 'The U3D result must not silently fill the local measurement')
  assert.equal(JSON.parse(JSON.stringify(get({}))).details.definition, reviewed.tomoUniformityDefinition)
})
test('Pending report measurements retain configured tolerances without fabricating a result', () => {
  const image = { ...base, frameInfo: [{ detectorNumber: 1 }, { detectorNumber: 2 }] }
  const entries = ['uniformity', 'resolution', 'sensitivity', 'cor', 'tomography'].map(type => applyMonthlyReference({
    image, type, options: initialGammaOptions(image), name: `pending-${type}`, analysisError: 'Pending measurement' }))
  const r = buildMonthlyReport(entries, [1, 2])
  assert.equal(r.verdict, 'Informe incompleto')
  assert.deepEqual(r.uniformity[0].cells.map(m => m.limit), [2.5, 2.7, 2.9, 3.7])
  assert.deepEqual(r.resolution[1].widths.map(m => m.limit), [7.5, 13.6])
  assert.equal(r.corMetrics[0].limit, 1.1988)
  assert.equal(r.sensitivity[0].configuredMetrics[0].limit, 202)
  assert.equal(r.tomographyMetrics[0].limit, 10)
  assert.ok(r.uniformity[0].cells.every(m => m.value == null))
  assert.ok(r.resolution[0].widths.every(m => m.value == null))
  const different = { ...entries[1], options: { ...entries[1].options, fwhmLimit: '8' } }
  assert.equal(buildMonthlyReport([...entries, different], [1]).resolution[0].widths[0].limit, null)
})
test('Monthly resolution distinguishes mean X/Y from per-axis comparison and preserves raw results', () => {
  const x = resolution('X', 7.4), y = resolution('Y', 7.6), entries = [entry([x]), entry([y])]
  const mean = buildMonthlyReport(entries, [1], 'mean'), each = buildMonthlyReport(entries, [1], 'each')
  near(mean.resolution[0].widths[0].value, 7.5)
  assert.equal(mean.resolution[0].status, 'Conforme')
  assert.equal(each.resolution[0].status, 'No conforme')
  assert.equal(mean.records[1].status, 'No conforme')
  assert.equal(buildMonthlyReport([entry([x])], [1]).resolution[0].status, 'No evaluable')
  const unsigned = { ...y, inputs: { verified: false } }
  assert.equal(buildMonthlyReport([entry([x]), entry([unsigned])], [1]).resolution[0].status, 'Adquisición no verificada')
  assert.equal(buildMonthlyReport([entry([x]), entry([resolution('Y', 7.5, 8)])], [1]).resolution[0].status, 'Sin tolerancia')
})
test('Uniformity report maps DU to maxima in both axes, including all four limits', () => {
  const uniformity = { type: 'uniformity', detector: 1, metrics: [m('DUvertCfov', 1, 2.5), m('DUhorizCfov', 1.5, 2.5),
    m('DUvertUfov', 1.6, 2.7), m('DUhorizUfov', 1.7, 2.7), m('IUcfov', 2.8, 2.9), m('IUufov', 3.6, 3.7)] }
  const row = buildMonthlyReport([entry([uniformity])], [1]).uniformity[0]
  assert.deepEqual(row.cells.map(c => c.value), [1.5, 1.7, 2.8, 3.6])
  assert.deepEqual(row.cells.map(c => c.limit), [2.5, 2.7, 2.9, 3.7])
  assert.equal(buildMonthlyReport([], [1]).uniformity[0].cells[0].value, null)
})
test('Actual uniformity batch adapter keeps DUufov/DUcfov case-correct limit keys', () => {
  const d = { SOPClassUID: '1.2.840.10008.5.1.4.1.1.20', SOPInstanceUID: '1.2.3.4.1',
    Modality: 'NM', Rows: 128, Columns: 128, NumberOfFrames: 1, BitsAllocated: 16, BitsStored: 16, HighBit: 15,
    PixelRepresentation: 0, SamplesPerPixel: 1, PhotometricInterpretation: 'MONOCHROME2', PixelSpacing: [6.4, 6.4],
    ActualFrameDuration: 100000, ImageType: ['ORIGINAL', 'PRIMARY', 'STATIC', 'EMISSION'],
    AcquisitionDate: '20260105', AcquisitionTime: '100000', DetectorVector: [1], EnergyWindowVector: [1],
    DetectorInformationSequence: [{ FieldOfViewDimensions: [532, 386], CollimatorType: 'NONE' }],
    EnergyWindowInformationSequence: [{ EnergyWindowName: 'Tc', EnergyWindowRangeSequence: [{ EnergyWindowLowerLimit: 130, EnergyWindowUpperLimit: 150 }] }],
    PixelData: [new Uint16Array(128 * 128).fill(12000).buffer] }
  const dict = new dcmjs.data.DicomDict({ '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] } })
  dict.dict = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(d); dict.dict['7FE00010'].vr = 'OW'
  const buffer = dict.write(), image = parseGammaDicom(buffer)
  const r = analyzeGammaEntry({ buffer, image, type: 'uniformity', id: 'u', name: 'synthetic', options: { ...initialGammaOptions(image), uniformityProfile: 'symbia_intevo' } })[0]
  assert.ok(r.metrics.length === 6, r.reason)
  assert.deepEqual(r.metrics.filter(m => m.key.startsWith('DU')).map(m => m.limit), [2.7, 2.7, 2.5, 2.5])
})
test('Repeated COR cannot be silently averaged or chosen; explicit exclusion keeps provenance', () => {
  const cor = id => ({ id, type: 'cor', detectors: [1, 2], metrics: [m('deltaCorSingleMm', 1, 1.2)], status: 'Conforme', file: id })
  const first = entry([cor('first')], { name: 'first', image: base }), second = entry([cor('second')], { name: 'second', image: base })
  const ambiguous = buildMonthlyReport([first, second], [1, 2])
  assert.equal(ambiguous.conflicts.length, 1); assert.equal(ambiguous.cor, null)
  const selected = buildMonthlyReport([{ ...first, included: false, exclusionReason: 'Repeated acquisition' }, second], [1, 2])
  assert.equal(selected.cor.id, 'second'); assert.equal(selected.conflicts.length, 0)
  assert.equal(selected.excluded[0].reason, 'Repeated acquisition')
  assert.equal(selected.verdict, 'Informe incompleto')
})
test('Pending calculations remain visible in incomplete report data', () => {
  const report = buildMonthlyReport([{ type: 'sensitivity', name: 'missing', analysisError: 'Need activity' }], [1, 2])
  assert.equal(report.pendingFiles[0].reason, 'Need activity'); assert.equal(report.verdict, 'Informe incompleto')
  const sensitivity = sensitivityReportMetric({ metrics: [], inputs: { sensitivityComparison: 'minimum', minimumSensitivity: '202', sensitivityUnit: 'cpm/µCi' } })
  assert.equal(sensitivity.value, null); assert.equal(sensitivity.limit, 202); assert.equal(sensitivity.unit, 'cpm/µCi')
})

// User data stays outside the repository. Enable only with a complete monthly batch.
if (process.env.GAMMA_MONTHLY_FIXTURE_DIR) {
  const dir = process.env.GAMMA_MONTHLY_FIXTURE_DIR, files = fs.readdirSync(dir).filter(f => /\.dcm$/i.test(f))
  const entries = []
  for (const [id, name] of files.entries()) {
    const b = fs.readFileSync(`${dir}/${name}`), buffer = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
    const image = parseGammaDicom(buffer), type = classifyGamma(image)
    const e = applyMonthlyReference({ id: String(id), name, buffer, image, type, options: initialGammaOptions(image) })
    e.records = analyzeGammaEntry(e); entries.push(e)
    if (type === 'tomography') {
      const series = await loadTomoDicomSeries([{ arrayBuffer: async () => buffer }])
      assert.ok(series.volume.length > 1 && series.dz > 0)
      const config = { cylinder: proposeCylinder(series), diametersMm: [10, 20, 40, 60], stride: 2, centerMode: 'per-diameter' }
      const result = analyzeTomoUniformity(series, config)
      assert.equal(result.results.length, 4); assert.ok(result.results.every(r => r.valid))
      console.log('ok real reconstructed NM: MPR geometry and sphere analysis')
    }
  }
  test('Real monthly batch imports all five test types and retains both COR acquisitions', () => {
    assert.ok(validateMonthlyBatch(entries).valid)
    assert.deepEqual([...new Set(entries.map(e => e.type))].sort(), ['cor', 'resolution', 'sensitivity', 'tomography', 'uniformity'])
    const report = buildMonthlyReport(entries, [1, 2])
    assert.equal(report.conflicts.length, 1); assert.equal(report.conflicts[0].type, 'cor')
    assert.equal(report.missing.length, 0)
    assert.ok(report.sensitivity.every(r => r.record.status === 'No evaluable'))
    assert.ok(report.resolution.every(r => r.widths.every(m => m.value > 0)))
    assert.ok(report.uniformity.every(r => r.cells.every(m => Number.isFinite(m.limit))))
  })
}
console.log(`\n${passed} monthly-report checks passed.`)
