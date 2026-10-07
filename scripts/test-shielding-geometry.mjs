import assert from 'node:assert/strict'
import {
  boundsOfPoints,
  classifyPrimary,
  closestPointOnSegment,
  createCalibration,
  distanceMeters,
  metersToPixel,
  pixelToMeters,
  pointInPolygon,
  segmentIntersection,
  traceBarriers,
  validateWorkloadDistribution,
} from '../src/utils/shieldingGeometry.js'

// All coordinates and use percentages below are synthetic mathematical fixtures.
// They are not clinical defaults or independent shielding/dose validation cases.
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `Expected ${actual} to equal ${expected} within mathematical rounding tolerance`)
const origin = Object.freeze({ x: 0, y: 0 })
const diagonal = Object.freeze({ x: 3, y: 4 })
close(distanceMeters(origin, diagonal), 5)
assert.throws(() => distanceMeters(origin, { x: '', y: 0 }), /coordenadas/)

// A 300/400/500 pixel triangle declared as 5 m gives 0.01 m/px.
const calibration = createCalibration({ x: 10, y: 20 }, { x: 310, y: 420 }, 5)
assert.deepEqual(calibration, { metersPerPixel: 0.01, pixelDistance: 500, realLengthM: 5 })
assert.deepEqual(pixelToMeters({ x: 200, y: 350 }, calibration), { x: 2, y: 3.5 })
assert.deepEqual(metersToPixel({ x: 2, y: 3.5 }, calibration), { x: 200, y: 350 })
for (const length of [0, -1, '', null, Infinity, NaN]) {
  assert.throws(() => createCalibration(origin, diagonal, length), /distancia real/)
}
assert.throws(() => createCalibration(origin, origin, 5), /distintos/)
assert.throws(() => pixelToMeters(origin, null), /calibración/)
assert.throws(() => metersToPixel(origin, { metersPerPixel: 0 }), /calibración/)

// Full opening of 90 degrees: edges at +/-45 degrees, not +/-90 degrees.
const beam = Object.freeze({ source: origin, target: { x: 2, y: 0 }, apertureDeg: 90 })
assert.equal(classifyPrimary({ x: 5, y: 0 }, beam).status, 'inside')
assert.equal(classifyPrimary({ x: 5, y: 5 }, beam).status, 'inside')
assert.equal(classifyPrimary({ x: 5, y: -5 }, beam).status, 'inside')
assert.equal(classifyPrimary({ x: 1, y: 2 }, beam).status, 'outside')
assert.equal(classifyPrimary({ x: -1, y: 0 }, beam).status, 'outside')
assert.equal(classifyPrimary(origin, beam).status, 'unknown')
for (const incomplete of [null, {}, { source: origin }, { ...beam, target: origin },
  { ...beam, apertureDeg: '' }, { ...beam, apertureDeg: 0 }, { ...beam, apertureDeg: 180 },
  { ...beam, apertureDeg: NaN }]) {
  assert.equal(classifyPrimary({ x: 5, y: 0 }, incomplete).status, 'unknown')
}
// SVG y increases downward. Rotating a beam down must classify the lower point.
assert.equal(classifyPrimary({ x: 0, y: 5 }, { ...beam, target: { x: 0, y: 2 } }).status, 'inside')
assert.equal(classifyPrimary({ x: 0, y: -5 }, { ...beam, target: { x: 0, y: 2 } }).status, 'outside')
// Numeric overflow must not silently turn an incomplete result into 'outside'.
assert.equal(classifyPrimary({ x: 1e200, y: 2e200 }, { ...beam, target: { x: 1e200, y: 0 } }).status, 'outside')
assert.equal(classifyPrimary({ x: 1e308, y: 0 }, {
  ...beam, source: { x: -1e308, y: 0 }, target: { x: 1e308, y: 0 },
}).status, 'unknown')

// Never renormalize incomplete distributions. Blank means missing, not zero.
const distribution = Object.freeze([
  Object.freeze({ id: 'synthetic-a', usePercent: 70 }),
  Object.freeze({ id: 'synthetic-b', usePercent: 30 }),
])
assert.deepEqual(validateWorkloadDistribution(distribution), { valid: true, totalPercent: 100, errors: [] })
assert.equal(validateWorkloadDistribution([{ usePercent: 99 }]).valid, false)
assert.equal(validateWorkloadDistribution([{ usePercent: 0 }, { usePercent: 100 }]).valid, true)
for (const invalid of [[], [{ usePercent: '' }], [{ usePercent: null }], [{ usePercent: 101 }],
  [{ usePercent: -1 }, { usePercent: 101 }], [{ usePercent: NaN }], [{ usePercent: 60 }, { usePercent: 50 }]]) {
  assert.equal(validateWorkloadDistribution(invalid).valid, false)
}
assert.deepEqual(distribution.map(config => config.usePercent), [70, 30])

const crossing = segmentIntersection(origin, { x: 4, y: 0 }, { x: 2, y: -1 }, { x: 2, y: 1 })
assert.deepEqual(crossing, { point: { x: 2, y: 0 }, t: 0.5, u: 0.5, kind: 'crossing' })
assert.equal(segmentIntersection(origin, { x: 4, y: 0 }, { x: 5, y: -1 }, { x: 5, y: 1 }), null)
assert.equal(segmentIntersection(origin, { x: 4, y: 0 }, { x: 0, y: 1 }, { x: 4, y: 1 }), null)
assert.equal(segmentIntersection(origin, { x: 4, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }).kind, 'touching')
const overlapping = segmentIntersection(origin, { x: 4, y: 0 }, { x: 2, y: 0 }, { x: 6, y: 0 })
assert.equal(overlapping.kind, 'overlap')
assert.deepEqual(overlapping.point, { x: 2, y: 0 })
assert.deepEqual(overlapping.overlapEnd, { x: 4, y: 0 })
assert.throws(() => segmentIntersection(origin, origin, { x: 0, y: 1 }, { x: 4, y: 1 }), /longitud/)

const barriers = Object.freeze([
  Object.freeze({ id: 'far', start: { x: 4, y: -2 }, end: { x: 4, y: 2 } }),
  Object.freeze({ id: 'near', start: { x: 2, y: -2 }, end: { x: 2, y: 2 } }),
  Object.freeze({ id: 'behind', start: { x: -2, y: -2 }, end: { x: -2, y: 2 } }),
])
const hits = traceBarriers(origin, { x: 5, y: 0 }, barriers)
assert.deepEqual(hits.map(hit => hit.barrierId), ['near', 'far'])
assert.deepEqual(hits.map(hit => hit.distanceM), [2, 4])
assert.deepEqual(barriers.map(barrier => barrier.id), ['far', 'near', 'behind'])
// Crossing a barrier never turns a geometrically exposed point into 'outside'.
assert.equal(classifyPrimary({ x: 5, y: 0 }, { ...beam, barriers }).status, 'inside')

const rectangle = [origin, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]
assert.equal(pointInPolygon({ x: 2, y: 2 }, rectangle), true)
assert.equal(pointInPolygon({ x: 4, y: 1 }, rectangle), true)
assert.equal(pointInPolygon({ x: 5, y: 1 }, rectangle), false)
assert.equal(pointInPolygon({ x: 1, y: 1 }, [origin, { x: 1, y: 0 }]), false)
assert.deepEqual(boundsOfPoints(rectangle), { minX: 0, minY: 0, maxX: 4, maxY: 3, width: 4, height: 3 })
assert.equal(boundsOfPoints([]), null)
assert.deepEqual(closestPointOnSegment({ x: 2, y: 2 }, origin, { x: 4, y: 0 }),
  { point: { x: 2, y: 0 }, t: 0.5, distanceM: 2 })
assert.deepEqual(closestPointOnSegment({ x: -2, y: 0 }, origin, { x: 4, y: 0 }),
  { point: { x: 0, y: 0 }, t: 0, distanceM: 2 })
console.log('Shielding geometry: synthetic calibration, beams, workload, barriers and editing helpers passed.')
