// COR acquired as one NM file per stop (Siemens Symbia "COR NEMA" export): every file holds one
// frame per head, StartAngle appears only in the first stop and RadialPosition is a zero-padded
// list whose last element is the stop's own radius. There is no AngularStep or RotationDirection.
// What can go wrong silently: a missing or duplicated stop, stops ordered by file name instead of
// InstanceNumber, or an angle invented from the projections. The NEMA bounds would still print.
// This suite pins that the stop path reproduces the multiframe path exactly, and refuses the rest.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import dcmjs from 'dcmjs'
import { parseCorDICOM } from '../src/utils/corDicom.js'
import { analyzeCor } from '../src/utils/corAnalysis.js'
import { assembleCorStops, describeCorStops, groupCorStops, readCorStop } from '../src/utils/corStops.js'
import { classifyGamma, parseGammaDicom } from '../src/utils/gammaDicom.js'
import { analyzeGammaEntry, initialGammaOptions, mergeCorStopEntries } from '../src/utils/gammaBatch.js'
import { validateMonthlyBatch } from '../src/utils/gammaReport.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`ok ${name}`) }

const ROWS = 128, COLS = 128, STOPS = 12, STEP = 30, SERIES = '1.2.826.0.1.3680043.10.1.77'
const START = { 1: 180, 2: 0 }
const angleOf = (head, view) => ((START[head] - (view - 1) * STEP) % 360 + 360) % 360 // CW

function projection(head, angleDeg) {
  const frame = new Uint16Array(ROWS * COLS)
  const centre = (COLS - 1) / 2, a = angleDeg * Math.PI / 180, sigma = 1.35
  const sources = [[43, -22], [64, 1.4], [85, 21]]
  for (const [i, [row, radius]] of sources.entries()) {
    const x = centre + (head === 1 ? 0.4 : -0.2) + radius * Math.cos(a)
    const y = row + 0.18 * Math.sin(2 * a + i * 0.25) + (head - 1) * 0.06
    for (let r = Math.floor(y - 7); r <= Math.ceil(y + 7); r++) for (let c = Math.floor(x - 7); c <= Math.ceil(x + 7); c++) {
      frame[r * COLS + c] += Math.round(6500 * Math.exp(-((r - y) ** 2 + (c - x) ** 2) / (2 * sigma ** 2)))
    }
  }
  return frame
}

function write(dataset) {
  const dict = new dcmjs.data.DicomDict({ '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] } })
  dict.dict = dcmjs.data.DicomMetaDictionary.denaturalizeDataset({ ...dataset, _vrMap: { PixelData: 'OW' } })
  return dict.write()
}

const common = (frames) => ({ SOPClassUID: '1.2.840.10008.5.1.4.1.1.20', Modality: 'NM', Manufacturer: 'SIEMENS NM',
  ManufacturerModelName: 'Encore2', StationName: 'SYMBIA0000', SeriesDescription: 'COR NEMA', SeriesInstanceUID: SERIES,
  AcquisitionDate: '20261019', AcquisitionTime: '132812', Rows: ROWS, Columns: COLS, NumberOfFrames: frames,
  BitsAllocated: 16, BitsStored: 16, HighBit: 15, PixelRepresentation: 0, SamplesPerPixel: 1,
  PhotometricInterpretation: 'MONOCHROME2', PixelSpacing: [2, 2], ActualFrameDuration: 60000,
  NumberOfEnergyWindows: 1, EnergyWindowVector: Array(frames).fill(1),
  EnergyWindowInformationSequence: [{ EnergyWindowName: 'Tc', EnergyWindowRangeSequence: [{ EnergyWindowLowerLimit: 126, EnergyWindowUpperLimit: 154 }] }] })

function stopBuffer(view, { instance = view, viewLabel = view, startInEvery = null } = {}) {
  const pixels = new Uint16Array(2 * ROWS * COLS)
  pixels.set(projection(1, angleOf(1, view)), 0); pixels.set(projection(2, angleOf(2, view)), ROWS * COLS)
  const detector = head => ({ RadialPosition: view === 1 ? 200 : [...Array(view - 1).fill(0), 200], CollimatorType: 'PARA',
    ViewCodeSequence: [{ CodeValue: `Det ${head} View ${viewLabel}`, CodingSchemeDesignator: '99NMG', CodeMeaning: `Det ${head} View ${viewLabel}` }],
    ...(view === 1 ? { StartAngle: START[head] } : startInEvery === 'own' ? { StartAngle: angleOf(head, view) } : startInEvery != null ? { StartAngle: startInEvery[head] } : {}) })
  return write({ ...common(2), ImageType: ['ORIGINAL', 'PRIMARY', 'STATIC', 'EMISSION'], SOPInstanceUID: `${SERIES}.${instance}`,
    InstanceNumber: instance, ImagesInAcquisition: STOPS, DetectorVector: [1, 2], NumberOfDetectors: 2,
    DetectorInformationSequence: [detector(1), detector(2)], PixelData: [pixels.buffer] })
}

function multiframeBuffer() {
  const pixels = new Uint16Array(2 * STOPS * ROWS * COLS), heads = [], views = []
  for (const head of [1, 2]) for (let view = 1; view <= STOPS; view++) {
    pixels.set(projection(head, angleOf(head, view)), heads.length * ROWS * COLS); heads.push(head); views.push(view)
  }
  return write({ ...common(2 * STOPS), ImageType: ['ORIGINAL', 'PRIMARY', 'TOMO', 'EMISSION'], SOPInstanceUID: `${SERIES}.99`,
    DetectorVector: heads, AngularViewVector: views, RotationVector: Array(heads.length).fill(1), NumberOfDetectors: 2,
    DetectorInformationSequence: [1, 2].map(head => ({ StartAngle: START[head], RadialPosition: 200, CollimatorType: 'PARA' })),
    RotationInformationSequence: [{ StartAngle: 180, AngularStep: STEP, RotationDirection: 'CW', ScanArc: 360,
      NumberOfFramesInRotation: STOPS, ActualFrameDuration: 60000 }], PixelData: [pixels.buffer] })
}

const buffers = Array.from({ length: STOPS }, (_, i) => stopBuffer(i + 1))
const names = buffers.map((_, i) => `stop-${String(i + 1).padStart(2, '0')}.dcm`)
const read = (list = buffers, labels = names) => list.map((b, i) => readCorStop(b, labels[i]))
const declared = { angularStepDeg: '30', rotationDirection: 'CW' }

test('the multiframe reader still rejects a lone stop: it has no angular vectors', () => {
  assert.throws(() => parseCorDICOM(buffers[0]), /AngularViewVector/)
})

test('stops are ordered by InstanceNumber, not by the order the files arrive', () => {
  const shuffled = [7, 2, 11, 0, 5, 9, 1, 10, 3, 6, 8, 4]
  const group = groupCorStops(shuffled.map(i => readCorStop(buffers[i], names[i])))
  assert.deepEqual(group.stops.map(s => s.name), names)
  assert.deepEqual(group.startAnglesDeg, { 1: 180, 2: 0 })
  assert.equal(group.suggestedFullRotationStepDeg, 30)
})

test('without a declared step and direction nothing is assembled', () => {
  assert.throws(() => assembleCorStops(read(), {}), e => e.code === 'COR_STOP_GEOMETRY' && e.missing.join() === 'paso angular,sentido de giro')
  assert.throws(() => assembleCorStops(read(), { angularStepDeg: '30' }), e => e.missing.join() === 'sentido de giro')
})

test('stop assembly reproduces the multiframe analysis exactly', () => {
  const stops = assembleCorStops(read(), declared)
  const multi = parseCorDICOM(multiframeBuffer())
  assert.deepEqual(stops.frameMeta.map(f => [f.detectorNumber, f.viewNumber, f.angleDeg]), multi.frameMeta.map(f => [f.detectorNumber, f.viewNumber, f.angleDeg]))
  assert.deepEqual(stops.frameMeta.map(f => f.radialPositionMm), Array(24).fill(200))
  assert.equal(stops.metadata.scanArcDeg, 360); assert.equal(stops.metadata.acquisitionMode, 'stops')
  assert.equal(stops.metadata.stopGeometry.source.angularStep, 'declarado')
  const a = analyzeCor(stops), b = analyzeCor(multi)
  assert.deepEqual(a.upperBounds, b.upperBounds)
  assert.deepEqual(a.acquisition.detectorChecks, b.acquisition.detectorChecks)
  assert.equal(a.geometry3d.maximumDiameterMm, b.geometry3d.maximumDiameterMm)
  assert.ok(a.acquisition.detectorChecks.every(c => c.includesZero && c.includes180 && c.uniformAngles && c.viewCount === 12))
})

test('a wrong declared step is not hidden: the 0°/180° and 360° checks fail', () => {
  const a = analyzeCor(assembleCorStops(read(), { ...declared, angularStepDeg: '15' }))
  assert.ok(a.acquisition.detectorChecks.every(c => !c.uniformAngles))
  assert.throws(() => assembleCorStops(read(), { ...declared, angularStepDeg: '40' }), /repiten posiciones/)
})

test('missing, duplicated, foreign or mislabelled stops are refused', () => {
  assert.throws(() => assembleCorStops(read(buffers.slice(0, 11)), declared), /declara 12 imágenes y se han cargado 11/)
  const gap = [...buffers.slice(0, 5), ...buffers.slice(6)]
  assert.throws(() => groupCorStops(read(gap, [...names.slice(0, 5), ...names.slice(6)])), /Faltan paradas/)
  assert.throws(() => groupCorStops(read([...buffers, buffers[3]], [...names, 'copia.dcm'])), /repetido/)
  assert.throws(() => groupCorStops(read([buffers[0]])), /una sola parada de 12/)
  const swapped = buffers.map((b, i) => i === 4 ? stopBuffer(5, { viewLabel: 6 }) : b)
  assert.throws(() => groupCorStops(read(swapped)), /View 6.*posición 5/)
  const other = readCorStop(stopBuffer(3), 'other.dcm'); other.seriesUid = '9.9.9'
  assert.throws(() => groupCorStops([...read().filter((_, i) => i !== 2), other]), /otra serie/)
})

test('a StartAngle in later stops must agree with the declared geometry', () => {
  const own = buffers.map((b, i) => i ? stopBuffer(i + 1, { startInEvery: 'own' }) : b)
  assert.equal(assembleCorStops(read(own), declared).frameMeta[1].angleDeg, 150)
  assert.throws(() => assembleCorStops(read(own), { ...declared, rotationDirection: 'CC' }), /contradice/)
  const rotationStart = buffers.map((b, i) => i ? stopBuffer(i + 1, { startInEvery: START }) : b)
  assert.doesNotThrow(() => assembleCorStops(read(rotationStart), { ...declared, rotationDirection: 'CC' }))
})

test('describeCorStops exposes what the form must ask for', () => {
  const summary = describeCorStops(read())
  assert.equal(summary.count, 12); assert.deepEqual(summary.heads, [1, 2]); assert.equal(summary.seriesDescription, 'COR NEMA')
})

// Monthly report: twelve stop files are one COR entry; declarations start empty.
const entryOf = (buffer, name) => {
  const image = parseGammaDicom(buffer)
  return { id: name, name, buffer, image, type: classifyGamma(image), included: true, exclusionReason: '', options: initialGammaOptions(image), records: null }
}

test('monthly: all stops of a series merge into one COR entry and analyze with the declared geometry', () => {
  const entries = mergeCorStopEntries(buffers.map((b, i) => entryOf(b, names[i])))
  assert.equal(entries.length, 1)
  const [entry] = entries
  assert.equal(entry.type, 'cor'); assert.equal(entry.stopParts.length, 12); assert.equal(entry.image.frames.length, 24)
  assert.ok(validateMonthlyBatch(entries).valid)
  assert.deepEqual(entry.options.corStopGeometry, { angularStepDeg: '', rotationDirection: '', startAnglesDeg: {} })
  assert.throws(() => analyzeGammaEntry(entry), /declara paso angular y sentido de giro/)
  const record = analyzeGammaEntry({ ...entry, options: { ...entry.options, corStopGeometry: declared } })[0]
  const reference = analyzeCor(parseCorDICOM(multiframeBuffer()))
  assert.equal(record.metrics.find(m => m.key === 'deltaCorSingleMm').value, reference.upperBounds.deltaCorSingleMm)
  assert.equal(record.details.stopGeometry.angularStepDeg, 30); assert.equal(record.details.stopFiles.length, 12)
})

test('monthly: a stop added later joins its series; an incomplete set blocks the batch', () => {
  const first = mergeCorStopEntries(buffers.slice(0, 11).map((b, i) => entryOf(b, names[i])))
  assert.equal(first.length, 1); assert.match(first[0].error, /declara 12 imágenes y se han cargado 11/)
  assert.equal(validateMonthlyBatch(first).valid, false)
  const completed = mergeCorStopEntries([...first, entryOf(buffers[11], names[11])])
  assert.equal(completed.length, 1); assert.equal(completed[0].error, undefined); assert.equal(completed[0].stopParts.length, 12)
  const lone = analyzeGammaEntry.bind(null, { ...entryOf(buffers[0], names[0]) })
  assert.throws(lone, /Parada COR aislada/)
})

// Real per-stop export kept outside the repository.
if (process.env.COR_STOPS_FIXTURE_DIR) {
  const dir = process.env.COR_STOPS_FIXTURE_DIR
  const files = fs.readdirSync(dir).filter(f => /\.dcm$/i.test(f))
  test(`real per-stop COR (${files.length} files) assembles and yields finite NEMA bounds`, () => {
    const stops = files.map(f => { const b = fs.readFileSync(`${dir}/${f}`); return readCorStop(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f) })
    const summary = describeCorStops(stops)
    const series = assembleCorStops(stops, { angularStepDeg: String(summary.suggestedFullRotationStepDeg), rotationDirection: 'CW' })
    const result = analyzeCor(series)
    assert.ok(Object.values(result.upperBounds).every(Number.isFinite))
    assert.ok(result.acquisition.detectorChecks.every(c => c.includesZero && c.includes180 && c.uniformAngles))
    console.log('  ', summary.count, 'paradas ·', JSON.stringify(result.upperBounds))
  })
}

console.log(`\n${passed} COR per-stop checks passed.`)
