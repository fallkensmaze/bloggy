import assert from 'node:assert/strict'
import { emptyScene, scaleScene } from '../src/utils/shieldingScene.js'
import { evaluateShielding } from '../src/utils/shieldingCalculations.js'
import { createShieldingConfiguration, createShieldingPoint, allocateNcrpPatients } from '../src/utils/shieldingPresets.js'
import {
  addShieldingLayer, updateShieldingLayer, removeShieldingLayer, updateShieldingGroup, removeShieldingGroup,
  roomShieldingGroups, shieldingSummary, shieldedWallCount, newShieldingLayer,
} from '../src/utils/shieldingBarriers.js'

// Synthetic geometry only. Declared shielding is data; it must not change any dose.
let next = 1
const makeId = () => `layer-${next++}`
const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]
const walls = square.map((start, i) => ({ id: `w${i}`, roomId: 'r1', edgeIndex: i, name: `Pared ${i + 1}`, kind: 'wall', start, end: square[(i + 1) % 4] }))
const loose = { id: 'free', name: 'Mampara', kind: 'wall', start: { x: 6, y: 0 }, end: { x: 6, y: 3 } }
const base = { ...emptyScene(), rooms: [{ id: 'r1', name: 'Sala 1', vertices: square }], walls: [...walls, loose] }

assert.equal(newShieldingLayer('x').thickness_mm, '', 'a new layer never assumes a thickness')
assert.equal(shieldingSummary([]), '')
assert.equal(shieldingSummary([newShieldingLayer('x')]), 'Pb · espesor pendiente')

// A room adds the same layer to its four walls, and only to them.
const roomIds = walls.map(w => w.id)
let scene = addShieldingLayer(base, roomIds, { material: 'lead', thickness_mm: '2', groupId: 'g1' }, makeId)
assert.equal(shieldedWallCount(scene), 4)
assert.equal(scene.walls.find(w => w.id === 'free').shielding, undefined, 'free walls stay untouched')
assert.equal(new Set(scene.walls.flatMap(w => (w.shielding || []).map(l => l.id))).size, 4, 'each copy has its own id')
assert.equal(base.walls[0].shielding, undefined, 'adding does not mutate the previous scene')
assert.equal(shieldingSummary(scene.walls[0].shielding), 'Pb 2 mm')
let summary = roomShieldingGroups(scene, 'r1')
assert.deepEqual([summary.wallCount, summary.groups.length, summary.groups[0].wallCount], [4, 1, 4])

// Room-wide edits reach every grouped copy.
scene = updateShieldingGroup(scene, 'g1', { thickness_mm: '2.5' })
assert.ok(scene.walls.filter(w => w.roomId).every(w => w.shielding[0].thickness_mm === '2.5'))

// A per-wall edit detaches that copy: a later room edit preserves it.
const w0Layer = scene.walls[0].shielding[0].id
scene = updateShieldingLayer(scene, 'w0', w0Layer, { material: 'concrete', thickness_mm: '150' })
scene = updateShieldingGroup(scene, 'g1', { thickness_mm: '3' })
assert.equal(scene.walls[0].shielding[0].thickness_mm, '150', 'manual per-wall value survives a room edit')
assert.equal(scene.walls[0].shielding[0].groupId, undefined)
assert.equal(scene.walls[1].shielding[0].thickness_mm, '3')
summary = roomShieldingGroups(scene, 'r1')
assert.equal(summary.groups[0].wallCount, 3)

// Blank thickness is kept literally, never refilled.
scene = updateShieldingLayer(scene, 'w1', scene.walls[1].shielding[0].id, { thickness_mm: '' })
assert.equal(scene.walls[1].shielding[0].thickness_mm, '')
assert.match(shieldingSummary(scene.walls[1].shielding), /pendiente/)

// Layers stack on a single barrier and can be removed individually or as a group.
scene = addShieldingLayer(scene, ['free'], { material: 'gypsum', thickness_mm: '15' }, makeId)
scene = addShieldingLayer(scene, ['free'], { material: 'lead', thickness_mm: '1' }, makeId)
const free = scene.walls.find(w => w.id === 'free')
assert.equal(shieldingSummary(free.shielding), 'Yeso 15 mm + Pb 1 mm')
scene = removeShieldingLayer(scene, 'free', free.shielding[0].id)
assert.equal(scene.walls.find(w => w.id === 'free').shielding.length, 1)
scene = removeShieldingGroup(scene, 'g1')
assert.equal(roomShieldingGroups(scene, 'r1').groups.length, 0)
assert.equal(scene.walls[0].shielding.length, 1, 'removing the room layer keeps detached wall layers')

// Calibration scales positions, never millimetres of material.
const scaled = scaleScene(scene, 2)
assert.equal(scaled.walls[0].shielding[0].thickness_mm, '150')
assert.equal(scaled.walls[0].end.x, 8)

// The evaluation is unshielded: declared layers cannot change a result.
const c = createShieldingConfiguration({ id: 'c1', name: 'O1', source: { x: 1, y: 1.5 }, target: { x: 3, y: 1.5 } })
const p = createShieldingPoint({ id: 'p1', name: 'P1', x: 7, y: 1.5 })
const withPoint = s => allocateNcrpPatients({ ...s, configurations: [c], points: [p] })
assert.deepEqual(evaluateShielding(withPoint(scene)).points, evaluateShielding(withPoint(base)).points)

console.log('Shielding barriers: room-wide and per-wall layers, detached overrides, blanks, scaling and no implicit attenuation pass.')
