import assert from 'node:assert/strict';
import { evaluateShielding } from '../src/utils/shieldingCalculations.js';
import { emptyScene, newHistory, commitScene, undoScene, redoScene, removeEntity, scaleScene } from '../src/utils/shieldingScene.js';
import { createShieldingConfiguration, createShieldingPoint, allocateNcrpPatients, applyNcrpPreset,
  editNcrpParameter, applyNcrpOccupancy, NCRP_PRESETS } from '../src/utils/shieldingPresets.js';

// Synthetic geometry; reference coefficients checked against NCRP 147 Tables 4.3/4.5/4.7.
const near = (actual, expected) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const configuration = id => createShieldingConfiguration({ id, name: id, source: { x: 0, y: 0 }, target: { x: 1, y: 0 } });
const point = (x = 3, y = 0) => createShieldingPoint({ id: 'p', name: 'P1', x, y });
const base = () => allocateNcrpPatients({ ...emptyScene(), configurations: [configuration('a')], points: [point()] });
const ncrp = scene => evaluateShielding(scene).points[0].ncrp;

let scene = base();
assert.equal(ncrp(scene).status, 'complete', 'drawing alone supplies all NCRP inputs');
// Primary = 120*2.3/3²; secondary = 120*0.0073/2², each with T = 1.
near(ncrp(scene).primary_mGy_per_week, 92 / 3);
near(ncrp(scene).secondary_mGy_per_week, 0.219);
near(ncrp(scene).total_mGy_per_week, 92 / 3 + 0.219);
assert.equal(evaluateShielding(scene).points[0].csn.status, 'incomplete', 'no NCRP coefficients silently fill CSN');
scene.points = [point(0, 4)];
near(ncrp(scene).primary_mGy_per_week, 0);
near(ncrp(scene).secondary_mGy_per_week, 0.05475);
scene.points[0] = applyNcrpOccupancy(scene.points[0], 'corridor');
near(ncrp(scene).total_mGy_per_week, 0.01095);
assert.equal(scene.points[0].csn_occupancy, '', 'NCRP occupancy leaves the other method independent');

scene = base();
const originalTotal = ncrp(scene).total_mGy_per_week;
scene = allocateNcrpPatients({ ...scene, configurations: [...scene.configurations, configuration('b')] });
assert.deepEqual(scene.configurations.map(c => c.ncrp.patients_per_week), [60, 60]);
near(ncrp(scene).total_mGy_per_week, originalTotal);
scene = allocateNcrpPatients(removeEntity(scene, 'configuration', 'b'));
near(ncrp(scene).total_mGy_per_week, originalTotal);
scene = allocateNcrpPatients({ ...scene, configurations: [...scene.configurations, configuration('b')] });
scene = applyNcrpPreset(scene, 'b', 'rad-other');
assert.deepEqual(scene.configurations.map(c => c.ncrp.patients_per_week), [120, 120], 'complementary workload profiles both use room N');
near(ncrp(scene).primary_mGy_per_week, 100);
near(ncrp(scene).secondary_mGy_per_week, 1.209);

// Each profile has an independent oracle, not a copy of the utility's table.
for (const [id, expectedPrimary, expectedSecondary] of [
  ['rad-bucky', 92 / 3, 0.219], ['rad-other', 208 / 3, 0.99],
  ['chest', 80 / 3, 0.18], ['rf-radiographic', 147.5 / 9, 0.25],
]) {
  const chosen = applyNcrpPreset(base(), 'a', id);
  near(ncrp(chosen).primary_mGy_per_week, expectedPrimary);
  near(ncrp(chosen).secondary_mGy_per_week, expectedSecondary);
  assert.ok(chosen.configurations[0].apertureDeg > 0);
}
assert.equal(NCRP_PRESETS.length, 4);

scene = base();
scene.configurations[0].ncrp = editNcrpParameter(scene.configurations[0].ncrp, 'patients_per_week', '240');
near(ncrp(scene).total_mGy_per_week, originalTotal * 2);
scene.configurations[0].ncrp = editNcrpParameter(scene.configurations[0].ncrp, 'primary_mGy_per_patient_at_1m', '4');
scene = allocateNcrpPatients({ ...scene, configurations: [...scene.configurations, configuration('b')] });
assert.equal(scene.configurations[0].ncrp.patients_per_week, '240', 'custom N survives drawing another orientation');
assert.equal(scene.configurations[0].ncrp.primary_mGy_per_patient_at_1m, '4', 'custom coefficient is preserved');
assert.equal(scene.configurations[1].ncrp.patients_per_week, 60, 'new orientation has a share, not an extra full-room load');
assert.equal(scene.configurations[0].ncrp.coefficients_modified, true);
const copy = JSON.stringify(scene);
scaleScene(scene, 2); evaluateShielding(scene); allocateNcrpPatients(scene);
assert.equal(JSON.stringify(scene), copy, 'helpers and evaluator do not mutate the scene');

let history = newHistory(scene);
const restored = applyNcrpPreset(scene, 'a', 'rad-bucky');
history = commitScene(history, restored);
assert.equal(undoScene(history).present.configurations[0].ncrp.patients_per_week, '240');
assert.equal(redoScene(undoScene(history)).present.configurations[0].ncrp.patients_per_week, 60);
assert.deepEqual(restored.configurations[0].source, scene.configurations[0].source);
assert.deepEqual(restored.configurations[0].patient, scene.configurations[0].patient);
scene.configurations[0].apertureMode = 'manual'; scene.configurations[0].apertureDeg = '30';
assert.equal(applyNcrpPreset(scene, 'a', 'chest').configurations[0].apertureDeg, '30');

for (const field of ['patients_per_week', 'primary_mGy_per_patient_at_1m', 'secondary_mGy_per_patient_at_1m']) {
  const missing = base();
  missing.configurations[0].ncrp = editNcrpParameter(missing.configurations[0].ncrp, field, '');
  assert.equal(ncrp(allocateNcrpPatients(missing)).status, 'incomplete', 'a cleared input must stay missing');
}
scene = base();
scene.configurations[0].ncrp = editNcrpParameter(scene.configurations[0].ncrp, 'secondary_mGy_per_patient_at_1m', '0.01');
assert.equal(ncrp(scene).status, 'incomplete', 'edited secondary needs its own angular applicability');
scene.configurations[0].ncrp.secondary_envelope_confirmed = true;
near(ncrp(scene).secondary_mGy_per_week, 0.3);
for (const position of [{ x: 0, y: 0 }, { x: 1, y: 0 }]) {
  const singular = base(); singular.points[0] = { ...singular.points[0], ...position };
  assert.equal(ncrp(singular).status, 'incomplete');
}
console.log('Shielding NCRP presets: direct drawing, numerical oracles, shared profiles, overrides and history pass.');
