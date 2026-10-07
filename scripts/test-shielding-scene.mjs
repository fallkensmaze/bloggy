import assert from 'node:assert/strict'
import { emptyScene, newHistory, commitScene, undoScene, redoScene, scaleScene, updateEntity, removeEntity } from '../src/utils/shieldingScene.js'

// Synthetic editor coordinates only: these are not clinical fixtures.
const initial = emptyScene()
assert.deepEqual(initial.walls, [])
assert.deepEqual(initial.configurations, [])
assert.equal(initial.calibrated, true, 'a blank metric canvas has a declared metre grid')
const wall = { id: 'w1', name: 'Pared 1', start: { x: 1, y: 2 }, end: { x: 5, y: 2 } }
let history = newHistory(initial)
history = commitScene(history, { ...initial, walls: [wall] })
assert.equal(history.past.length, 1)
history = commitScene(history, updateEntity(history.present, 'wall', 'w1', { name: 'Exterior' }))
assert.equal(undoScene(history).present.walls[0].name, 'Pared 1')
assert.equal(redoScene(undoScene(history)).present.walls[0].name, 'Exterior')
const branched = commitScene(undoScene(history), { ...initial, name: 'Alternativa' })
assert.equal(branched.future.length, 0)
assert.equal(initial.walls.length, 0, 'edits must not mutate previous states')
assert.equal(removeEntity(history.present, 'wall', 'w1').walls.length, 0)
const scene = { ...history.present, configurations: [{ id: 'c1', source: { x: 2, y: 2 }, target: { x: 4, y: 2 }, usePercent: '60' }], points: [{ id: 'p1', x: 8, y: 4, occupancy: '0.25' }], background: { width: 10, height: 6, url: 'blob:synthetic' } }
const scaled = scaleScene(scene, 2)
assert.equal(scaled.walls[0].end.x, 10)
assert.equal(scaled.configurations[0].source.x, 4)
assert.equal(scaled.configurations[0].target.x, 8)
assert.equal(scaled.points[0].x, 16)
assert.equal(scaled.points[0].occupancy, '0.25')
assert.equal(scaled.configurations[0].usePercent, '60')
assert.equal(scaled.background.width, 20)
assert.throws(() => scaleScene(scene, 0))
assert.throws(() => scaleScene(scene, Infinity))
assert.throws(() => scaleScene(scene, 1e308), /finita/, 'calibration cannot overflow coordinates or background dimensions')
console.log('Shielding scene: immutable edits, undo/redo and complete calibration pass.')
