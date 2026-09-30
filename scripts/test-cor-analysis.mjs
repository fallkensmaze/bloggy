import assert from 'node:assert/strict'
import {
  analyzeCor,
  corAcquisitionValid,
  toleranceStatus,
  diagnosticPerformance,
  parseValidationCsv,
  rocAnalysis
} from '../src/utils/corAnalysis.js'

function gaussianFrame(rows, cols, points, sigma = 1.35) {
  const frame = new Float64Array(rows * cols)
  for (const point of points) {
    const minRow = Math.max(0, Math.floor(point.y - 5 * sigma))
    const maxRow = Math.min(rows - 1, Math.ceil(point.y + 5 * sigma))
    const minCol = Math.max(0, Math.floor(point.x - 5 * sigma))
    const maxCol = Math.min(cols - 1, Math.ceil(point.x + 5 * sigma))
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const radiusSquared = (row - point.y) ** 2 + (col - point.x) ** 2
        frame[row * cols + col] += point.amplitude * Math.exp(-radiusSquared / (2 * sigma ** 2))
      }
    }
  }
  return frame
}

function syntheticSeries() {
  const rows = 128
  const cols = 128
  const centre = (cols - 1) / 2
  const frames = []
  const frameMeta = []
  const sourceRows = [43, 64, 85]
  const sourceRadii = [-22, 1.4, 21]
  const detectorOffsets = [0.4, -0.2]

  for (let detector = 1; detector <= 2; detector++) {
    for (let view = 0; view < 12; view++) {
      const angleDeg = view * 30 + (detector - 1) * 180
      const angle = angleDeg * Math.PI / 180
      const points = sourceRows.map((baseY, sourceIndex) => ({
        x: centre + detectorOffsets[detector - 1] + sourceRadii[sourceIndex] * Math.cos(angle),
        y: baseY + 0.18 * Math.sin(2 * angle + sourceIndex * 0.25) + (detector - 1) * 0.06,
        amplitude: 6500 - sourceIndex * 150
      }))
      frames.push(gaussianFrame(rows, cols, points))
      frameMeta.push({
        frameIndex: frames.length - 1,
        detectorNumber: detector,
        rotationNumber: 1,
        viewNumber: view + 1,
        angleDeg: ((angleDeg % 360) + 360) % 360,
        angularStepDeg: 30,
        radialPositionMm: 200
      })
    }
  }

  return {
    frames,
    frameMeta,
    rows,
    cols,
    pixelSpacing: [2, 2],
    metadata: { frameDurationMs: 60000, scanArcDeg: 360 }
  }
}

const results = analyzeCor(syntheticSeries())
assert.equal(results.detectors.length, 2)
assert.equal(results.pairs.length, 1)
assert.equal(results.centralSourceIndex, 1)
assert.equal(results.detectors[0].acquisition.enoughCountsAtZero, true)
assert.ok(Math.abs(results.detectors[0].sources[1].corMm - 0.8) < 0.12)
assert.ok(Math.abs(results.detectors[1].sources[1].corMm + 0.4) < 0.12)
assert.ok(results.upperBounds.deltaCorPairMm > 1.1)
assert.ok(results.upperBounds.deltaCorPairMm < 1.6)
assert.ok(results.upperBounds.deltaAxialSingleMm > 0.4)
assert.ok(results.upperBounds.deltaAxialSingleMm < 1.1)
assert.ok(Number.isFinite(results.geometry3d.maximumDiameterMm))
assert.ok(results.geometry3d.maximumDiameterMm > 0)
assert.equal(results.geometry3d.lines.length, 24)
for (const line of results.geometry3d.lines) {
  const ellipsoidDistance = results.geometry3d.axes.reduce((sum, axis) => {
    const component = line.residual.reduce(
      (value, coordinate, index) => value + coordinate * axis.direction[index],
      0
    )
    return sum + (component / axis.semiAxisMm) ** 2
  }, 0)
  assert.ok(ellipsoidDistance <= 1 + 1e-6)
}

// A source missing outside the zero-degree view must never become a finite midpoint.
for (const kind of ['missing', 'flat', 'truncated', 'ambiguous']) {
  const series = syntheticSeries()
  const frame = series.frames[1]
  for (let y = 54; y <= 74; y++) for (let x = 0; x < 128; x++) frame[y * 128 + x] = kind === 'flat' ? 100 : 0
  if (kind === 'truncated' || kind === 'ambiguous') {
    const points = kind === 'truncated' ? [{ x: 0, y: 64, amplitude: 6500 }]
      : [{ x: 45, y: 64, amplitude: 6500 }, { x: 80, y: 64, amplitude: 6500 }]
    const extra = gaussianFrame(128, 128, points)
    for (let i = 0; i < frame.length; i++) frame[i] += extra[i]
  }
  assert.throws(() => analyzeCor(series), /Cabezal 1, frame 2, fuente 2:/, kind)
}
const shifted = syntheticSeries()
shifted.frameMeta.forEach(frame => { frame.angleDeg = (frame.angleDeg + 5) % 360 })
const shiftedResult = analyzeCor(shifted)
assert.equal(shiftedResult.detectors[0].acquisition.includesZero, false)
assert.equal(shiftedResult.detectors[0].acquisition.includes180, false)
assert.equal(corAcquisitionValid(shiftedResult), false)
assert.ok(toleranceStatus(shiftedResult, { deltaCorSingleMm: 100 }).every(item => item.pass === null))
const rounded = syntheticSeries()
rounded.frameMeta.forEach(frame => { frame.angleDeg = (frame.angleDeg + 0.01) % 360 })
assert.equal(analyzeCor(rounded).detectors[0].acquisition.includesZero, true)
const fastFrame = syntheticSeries()
fastFrame.frameMeta[1].frameDurationMs = 1
assert.equal(analyzeCor(fastFrame).detectors[0].acquisition.underMaximumCountRate, false)

const records = parseValidationCsv([
  'score_mm,label',
  '0.4,0',
  '0.7,apto',
  '1.4,defecto',
  '1.8,1'
].join('\n'))
const performance = diagnosticPerformance(records, 1)
assert.deepEqual(
  { tp: performance.tp, tn: performance.tn, fp: performance.fp, fn: performance.fn },
  { tp: 2, tn: 2, fp: 0, fn: 0 }
)
assert.equal(performance.sensitivity, 1)
assert.equal(performance.specificity, 1)
assert.ok(performance.sensitivityCi95[0] < 1)
assert.equal(performance.sensitivityCi95[1], 1)
const roc = rocAnalysis(records)
assert.ok(roc.auc > 0.99)
assert.ok(roc.best.youden > 0.99)

console.log('COR analysis assertions passed')

// Independent acceptance checks and adversarial source geometry (cor-qc-1.2).
const { COR_DECLARATIONS, evaluateCorAcquisition, corCentroidsCsv } = await import('../src/utils/corValidation.js')
const { readCorGeometry } = await import('../src/utils/corGeometry.js')
const confirmed = { ...Object.fromEntries(COR_DECLARATIONS.map(([id]) => [id, 'yes'])), limitSource: 'Synthetic reference only' }
assert.equal(corAcquisitionValid(results), false, 'A numerical result cannot confirm the physical setup')
assert.equal(corAcquisitionValid(results, confirmed), true)
for (const [id] of COR_DECLARATIONS) {
  assert.equal(corAcquisitionValid(results, { ...confirmed, [id]: '' }), false, id)
  assert.equal(corAcquisitionValid(results, { ...confirmed, [id]: 'no' }), false, id)
}
for (const radius of [100, NaN]) {
  const series = syntheticSeries(); series.frameMeta.forEach(f => { f.radialPositionMm = radius })
  const result = analyzeCor(series)
  assert.equal(corAcquisitionValid(result, confirmed), false)
  assert.equal(corAcquisitionValid(result, { ...confirmed, radiusMm: '200' }), Number.isNaN(radius), 'Manual radius cannot override an explicitly wrong DICOM value')
}
const scaled = syntheticSeries(); scaled.rescaleSlope = 2; scaled.rescaleIntercept = 0
assert.equal(corAcquisitionValid(analyzeCor(scaled), confirmed), false)
assert.throws(() => analyzeCor(syntheticSeries(), { roiSizeMm: 10 }), /40 y 50/)
for (const limit of ['', null, -1, NaN]) assert.equal(toleranceStatus(results, { deltaCorSingleMm: limit }, confirmed)[0].pass, null)
assert.equal(toleranceStatus(results, { deltaCorSingleMm: 1 }, confirmed)[0].pass, true)
assert.equal(toleranceStatus(results, { deltaCorSingleMm: 1 }, { ...confirmed, limitSource: '' })[0].pass, null)
const mixed = syntheticSeries(); mixed.frameMeta[1].rotationNumber = 2
assert.throws(() => analyzeCor(mixed), /única rotación/)
const repeated = syntheticSeries(); repeated.frameMeta[1].viewNumber = 1
assert.throws(() => analyzeCor(repeated), /repetidas/)
const dataset = { DetectorVector: [1, 1], AngularViewVector: [1, 2], DetectorInformationSequence: [{ StartAngle: 0, RadialPosition: [200] }],
  RotationInformationSequence: [{ AngularStep: 30, RotationDirection: 'CC', NumberOfFramesInRotation: 2 }], EnergyWindowInformationSequence: [{}] }
assert.deepEqual(readCorGeometry(dataset, 2).map(f => f.radialPositionMm), [200, 200], 'Scalar radius applies to every view')
assert.throws(() => readCorGeometry({ ...dataset, RotationVector: [1, 2], RotationInformationSequence: [dataset.RotationInformationSequence[0], dataset.RotationInformationSequence[0]] }, 2), /única rotación/)

// A 16 mm excursion used to push the PSF near the fixed axial ROI edge.
// The known motion must be retained, never subtracted by the tracking process.
const moving = syntheticSeries()
for (let d = 0; d < 2; d++) for (let v = 0; v < 12; v++) {
  const angle = (v * 30 + d * 180) * Math.PI / 180
  moving.frames[d * 12 + v] = gaussianFrame(128, 128, [43, 64, 85].map((y, i) => ({
    x: 63.5 + [0.4, -0.2][d] + [-22, 1.4, 21][i] * Math.cos(angle),
    y: y + 8 * Math.sin(angle), amplitude: 6500
  })))
}
const tracked = analyzeCor(moving)
assert.ok(Math.abs(tracked.upperBounds.deltaAxialSingleMm - 32) < 0.15, 'Peak-to-peak motion is 32 mm')
for (const d of tracked.detectors) for (const source of d.sources) for (const m of source.measurements) {
  assert.ok(Math.abs((m.roi.minRow + m.roi.maxRow) / 2 - m.y) <= 0.5 + 1e-9, 'ROI recentred per view')
}
// Per-head seed detection must preserve a large physical offset between heads.
const offset = syntheticSeries()
for (let v = 0; v < 12; v++) {
  const angle = (v * 30 + 180) * Math.PI / 180
  offset.frames[12 + v] = gaussianFrame(128, 128, [43, 64, 85].map((y, i) => ({
    x: 63.3 + [-22, 1.4, 21][i] * Math.cos(angle), y: y + 25, amplitude: 6500
  })))
}
assert.ok(Math.abs(analyzeCor(offset).upperBounds.deltaAxialPairMm - 50) < 0.15)
const csv = corCentroidsCsv(results).trim().split('\n')
assert.equal(csv.length, 73, 'Every head/source/view measurement is exported')
assert.equal(csv[0].split(',').length, csv[1].split(',').length)
console.log('COR tracking, geometry, acquisition declarations and exports passed')
assert.deepEqual(parseValidationCsv('filename,score_mm,label\n"a,b.dcm",0.4,0\n"quote""name.dcm",1.4,1'), [{ score: 0.4, label: 0 }, { score: 1.4, label: 1 }])
assert.throws(() => parseValidationCsv('score_mm,label\n,0\n1,1'), /Fila 2/)
assert.throws(() => parseValidationCsv('score_mm,label\n-1,0\n1,1'), /Fila 2/)
