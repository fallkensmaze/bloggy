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
