import assert from 'node:assert/strict';
import { evaluateShielding } from '../src/utils/shieldingCalculations.js';
import { emptyScene, newHistory, commitScene, undoScene, redoScene, removeEntity } from '../src/utils/shieldingScene.js';
import { createShieldingConfiguration, createShieldingPoint, allocateNcrpPatients, applyNcrpPreset } from '../src/utils/shieldingPresets.js';
import { applyCsnPreset, allocateCsnWorkload, editCsnParameter, applyCsnOccupancy } from '../src/utils/shieldingCsnPresets.js';

const near = (actual, expected) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const configuration = (id, csnPresetId) => createShieldingConfiguration({ id, name: id, csnPresetId, source: { x: 0, y: 0 }, target: { x: 1, y: 0 } });
const point = (csnPresetId) => createShieldingPoint({ id: 'p', name: 'P1', x: 3, y: 0, csnPresetId });
const base = () => allocateNcrpPatients({ ...emptyScene(), configurations: [configuration('a')], points: [point()] });
const result = scene => evaluateShielding(scene).points[0];
const csn = scene => result(scene).csn;

// Independent oracle: d_fq=3, d_fp=1, d_pq=2 m; 20 cm square, T=1.
// CSN Table 2 W=160/80/40; Fig 1 rounded G=10/15/20; p.18 Qh=300/240/200.
for (const [id, primary, scatter, leakage] of [
  ['radiography-100', 1600 / 9, 0.8, 160 / 2700],
  ['radiography-125', 1200 / 9, 0.6, 80 / 2160],
  ['radiography-150', 800 / 9, 0.4, 40 / 1800],
]) {
  const original = base(), snapshot = JSON.stringify(original);
  const scene = applyCsnPreset(original, id);
  assert.equal(csn(scene).status, 'complete');
  near(csn(scene).primary_mGy_per_week, primary);
  near(csn(scene).scatter_mGy_per_week, scatter);
  near(csn(scene).leakage_mGy_per_week, leakage);
  assert.deepEqual(result(scene).ncrp, result(original).ncrp, 'CSN never changes NCRP data or shared geometry');
  assert.equal(JSON.stringify(original), snapshot, 'applying presets is immutable');
  assert.match(scene.configurations[0].csn.provenance, /lectura gráfica/);
  assert.match(scene.configurations[0].csn.provenance, /mSv\/mGy = 1/);
}

let scene = applyCsnPreset(base(), 'radiography-100');
const total = csn(scene).total_mGy_per_week;
scene = allocateCsnWorkload(allocateNcrpPatients({ ...scene,
  configurations: [...scene.configurations, configuration('b', scene.csnPresetId)] }));
assert.deepEqual(scene.configurations.map(c => c.usePercent), [50, 50]);
near(csn(scene).total_mGy_per_week, total, 'adding the same orientation does not duplicate room W');
scene = allocateCsnWorkload(removeEntity(scene, 'configuration', 'b'));
near(csn(scene).total_mGy_per_week, total);

scene.points[0] = applyCsnOccupancy(scene.points[0], 'partial');
near(csn(scene).total_mGy_per_week, total / 4);
assert.equal(scene.points[0].ncrp_occupancy, 1);
scene.points[0] = applyCsnOccupancy(scene.points[0], 'occasional');
near(csn(scene).total_mGy_per_week, total / 16);
scene = applyCsnPreset(scene, 'radiography-150');
assert.equal(scene.points[0].csn_occupancy, 1 / 16, 'profile restore preserves chosen occupancy');
const secondaryScene = applyCsnPreset(base(), 'radiography-100');
secondaryScene.points[0] = { ...secondaryScene.points[0], x: 0, y: 4 };
near(csn(secondaryScene).primary_mGy_per_week, 0);
near(csn(secondaryScene).scatter_mGy_per_week, 3.2 / 17);
near(csn(secondaryScene).leakage_mGy_per_week, 1 / 30);

scene = applyCsnPreset(base(), 'radiography-100');
let data = editCsnParameter(scene.configurations[0].csn, 'leakage_factor', '0.3');
near(data.leakage_mGy_m2_per_mA_min, 0.001);
data = editCsnParameter(data, 'qh_mA_min_per_hour', '150');
near(data.leakage_mGy_m2_per_mA_min, 0.002);
data = editCsnParameter(data, 'leakage_limit_mGy_per_hour_at_1m', '0.5');
near(data.leakage_mGy_m2_per_mA_min, 0.001);
data = editCsnParameter(data, 'leakage_mGy_m2_per_mA_min', '0.005');
assert.equal(data.leakage_mode, 'manual');
scene.configurations[0].csn = data;
near(csn(scene).leakage_mGy_per_week, 0.8 / 9);
for (const field of ['output_mGy_m2_per_mA_min', 'scatter_fraction', 'reference_field_area_cm2',
  'field_area_cm2', 'largest_field_side_m', 'leakage_mGy_m2_per_mA_min', 'provenance',
  'qh_mA_min_per_hour', 'leakage_factor', 'leakage_limit_mGy_per_hour_at_1m']) {
  const missing = applyCsnPreset(base(), 'radiography-100');
  missing.configurations[0].csn = editCsnParameter(missing.configurations[0].csn, field, '');
  assert.equal(csn(allocateCsnWorkload(missing)).status, 'incomplete', `blank ${field} never refilled`);
  assert.equal(result(missing).ncrp.status, 'complete');
}
for (const invalid of ['', ' ', -1, 0, 2, true, Infinity]) {
  assert.equal(editCsnParameter(data, 'leakage_factor', invalid).leakage_mGy_m2_per_mA_min, '');
}

// Manual values, including intentional blanks, survive unrelated mutations.
scene = applyCsnPreset(base(), 'radiography-100');
scene = { ...scene, csnTotalWorkload: '', csnWorkloadModified: true,
  configurations: [{ ...scene.configurations[0], usePercent: '', usePercentMode: 'manual',
    csn: editCsnParameter(scene.configurations[0].csn, 'output_mGy_m2_per_mA_min', '12') }],
  points: [{ ...scene.points[0], csn_occupancy: '', csn_occupancy_type: 'manual' }] };
scene = allocateCsnWorkload({ ...scene, configurations: [...scene.configurations, configuration('b', scene.csnPresetId)] });
assert.equal(scene.csnTotalWorkload, '');
assert.equal(scene.configurations[0].usePercent, '');
assert.equal(scene.configurations[0].csn.output_mGy_m2_per_mA_min, '12');
assert.equal(csn(scene).status, 'incomplete');
const restored = applyCsnPreset(scene, 'radiography-125');
assert.equal(restored.csnTotalWorkload, 80);
assert.equal(restored.configurations[0].usePercent, '');
assert.equal(restored.points[0].csn_occupancy, '');
assert.equal(restored.configurations[0].csn.output_mGy_m2_per_mA_min, 15);
const history = commitScene(newHistory(scene), restored);
assert.deepEqual(undoScene(history).present, scene);
assert.deepEqual(redoScene(undoScene(history)).present, restored);
assert.deepEqual(applyNcrpPreset(restored, 'a', 'chest').configurations[0].csn, restored.configurations[0].csn);

// A profile can be selected before drawing; subsequent entities inherit it.
scene = applyCsnPreset(emptyScene(), 'radiography-125');
scene = allocateCsnWorkload({ ...scene, configurations: [configuration('a', scene.csnPresetId)], points: [point(scene.csnPresetId)] });
assert.equal(csn(scene).status, 'complete');
assert.equal(scene.points[0].csn_occupancy, 1);
assert.throws(() => applyCsnPreset(scene, 'ct'), /desconocido/);
console.log('CSN presets: source oracles, independent methods, leakage derivation, allocation, manual blanks and history pass.');
