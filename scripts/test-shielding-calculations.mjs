import assert from 'node:assert/strict';
import { evaluateShielding } from '../src/utils/shieldingCalculations.js';

// All coefficients below are deliberately fictitious arithmetic fixtures. They are
// not equipment data, licensed tables, or defaults for a radiation installation.
const fictitiousCsn = {
  output_mGy_m2_per_mA_min: '4', scatter_fraction: '0.1',
  reference_field_area_cm2: '100', field_area_cm2: '100', largest_field_side_m: '0.1',
  leakage_mGy_m2_per_mA_min: '0.2', provenance: 'Fictitious manual arithmetic fixture',
};
const fictitiousNcrp = {
  patients_per_week: '10', primary_mGy_per_patient_at_1m: '6',
  secondary_mGy_per_patient_at_1m: '2', profile: 'Fictitious homogeneous profile',
  provenance: 'Fictitious manual arithmetic fixture', secondary_envelope_confirmed: true,
};
function fixture() {
  return {
    calibrated: true, csnTotalWorkload: '100',
    configurations: [
      { id: 'a', name: 'East', source: { x: 0, y: 0 }, target: { x: 1, y: 0 },
        patient: { x: 1, y: 0 }, apertureDeg: 20, usePercent: 25,
        csn: { ...fictitiousCsn }, ncrp: { ...fictitiousNcrp } },
      { id: 'b', name: 'North', source: { x: 0, y: 0 }, target: { x: 0, y: 1 },
        patient: { x: 0, y: 1 }, apertureDeg: 20, usePercent: 75,
        csn: { ...fictitiousCsn }, ncrp: { ...fictitiousNcrp, patients_per_week: '20' } },
    ],
    points: [{ id: 'p', name: 'P', x: 3, y: 0, csn_occupancy: '0.5', ncrp_occupancy: '0.25' }],
  };
}
let checks = 0;
function test(name, fn) { fn(); checks += 1; console.log(`ok ${checks} - ${name}`); }
function near(actual, expected) {
  // Double precision arithmetic only: 1e-11 relative/absolute, not a clinical tolerance.
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-11 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
function result(input) { return evaluateShielding(input).points[0]; }

test('manual two-direction oracle includes all components and counts the workload once', () => {
  const output = result(fixture());
  assert.equal(output.csn.status, 'complete');
  // East primary = 4*25/9; north primary=0. Occupancy is 1/2.
  near(output.csn.primary_mGy_per_week, 50 / 9);
  // East scatter=10/4; north scatter=30/10. Occupancy is 1/2.
  near(output.csn.scatter_mGy_per_week, 2.75);
  near(output.csn.leakage_mGy_per_week, 10 / 9);
  near(output.csn.total_mGy_per_week, 113 / 12);
  assert.equal(output.ncrp.status, 'complete');
  // NCRP primary=60/9. Integrated secondary=20/4 + 40/9.
  // It uses min(focus distance, patient distance), and applies occupancy 1/4.
  near(output.ncrp.primary_mGy_per_week, 5 / 3);
  near(output.ncrp.secondary_mGy_per_week, 85 / 36);
  near(output.ncrp.total_mGy_per_week, 145 / 36);
  assert.equal(Object.hasOwn(output.ncrp, 'leakage_mGy_per_week'), false);
  assert.deepEqual(output.csn.details.map(d => d.primaryApplies), [true, false]);
});
test('CSN percentages never rescale declared NCRP patient counts', () => {
  const input = fixture();
  input.configurations[0].usePercent = 80;
  input.configurations[1].usePercent = 20;
  near(result(input).ncrp.total_mGy_per_week, 145 / 36);
  assert.notEqual(result(input).csn.total_mGy_per_week, 113 / 12);
});
test('outside both beams has zero primary but positive scatter and leakage', () => {
  const input = fixture(); input.points[0].x = -3;
  const output = result(input);
  assert.equal(output.csn.primary_mGy_per_week, 0);
  assert.ok(output.csn.scatter_mGy_per_week > 0 && output.csn.leakage_mGy_per_week > 0);
  assert.equal(output.ncrp.primary_mGy_per_week, 0);
  assert.ok(output.ncrp.secondary_mGy_per_week > 0);
});
test('calibration, physical units and missing data never turn into a numeric total', () => {
  for (const mutate of [
    v => { v.calibrated = false; },
    v => { v.configurations[0].patient = null; },
    v => { v.configurations[0].apertureDeg = ''; },
    v => { v.configurations[0].source.x = Infinity; },
  ]) {
    const input = fixture(); mutate(input);
    const output = result(input);
    assert.equal(output.csn.total_mGy_per_week, null);
    assert.equal(output.ncrp.total_mGy_per_week, null);
    assert.ok(output.csn.errors.length && output.ncrp.errors.length);
  }
  const input = fixture(); input.configurations[0].csn.leakage_mGy_m2_per_mA_min = '';
  assert.equal(result(input).csn.total_mGy_per_week, null);
  assert.equal(result(input).ncrp.status, 'complete');
});
test('bad CSN percentage sum blocks only CSN and is not silently normalized', () => {
  const input = fixture(); input.configurations[0].usePercent = 20;
  assert.equal(result(input).csn.total_mGy_per_week, null);
  assert.equal(result(input).ncrp.status, 'complete');
});
test('NCRP needs an attributed profile and confirmed angular applicability', () => {
  for (const key of ['profile', 'provenance', 'secondary_envelope_confirmed']) {
    const input = fixture(); input.configurations[0].ncrp[key] = '';
    assert.equal(result(input).ncrp.total_mGy_per_week, null);
    assert.equal(result(input).csn.status, 'complete');
  }
});
test('CSN inverse square scatter limit is strict at five field sides', () => {
  const input = fixture(); input.points[0].x = 1.5;
  assert.equal(result(input).csn.scatter_mGy_per_week, null);
  assert.match(result(input).csn.errors.join(' '), /cinco/);
  input.points[0].x = 1.501;
  assert.equal(result(input).csn.status, 'complete');
});
test('point at source or scatterer blocks singular values', () => {
  for (const x of [0, 1]) {
    const input = fixture(); input.points[0].x = x;
    const output = result(input);
    assert.equal(output.csn.total_mGy_per_week, null);
    assert.equal(output.ncrp.total_mGy_per_week, null);
    assert.ok(output.csn.errors.length && output.ncrp.errors.length);
  }
});
test('blank, booleans, infinities and overflow are rejected as physical data', () => {
  for (const invalid of ['', ' ', true, false, null, undefined, 'Infinity', '1e999', -1]) {
    const input = fixture(); input.configurations[0].csn.output_mGy_m2_per_mA_min = invalid;
    assert.equal(result(input).csn.total_mGy_per_week, null);
  }
  const input = fixture(); input.configurations[0].csn.output_mGy_m2_per_mA_min = '1e308';
  assert.equal(result(input).csn.total_mGy_per_week, null);
});
test('overlarge field area is inconsistent with its declared largest side', () => {
  const input = fixture(); input.configurations[0].csn.field_area_cm2 = '200';
  assert.equal(result(input).csn.total_mGy_per_week, null);
});
test('overflow in squared distances and underflow never become a zero exposure', () => {
  for (const x of [1e200, 1e-200]) {
    const input = fixture(); input.points[0].x = x;
    const output = result(input);
    assert.equal(output.csn.total_mGy_per_week, null);
    assert.equal(output.ncrp.total_mGy_per_week, null);
  }
  const input = fixture();
  input.configurations[0].csn.leakage_mGy_m2_per_mA_min = '5e-324';
  input.csnTotalWorkload = '5e-324';
  assert.equal(result(input).csn.total_mGy_per_week, null);
});
test('zero allocation is explicit and does not require inactive CSN coefficients', () => {
  const input = fixture();
  input.configurations[0].usePercent = 0; input.configurations[0].csn = {};
  input.configurations[1].usePercent = 100;
  assert.equal(result(input).csn.status, 'complete');
  assert.equal(result(input).csn.details[0].primary_mGy_per_week, 0);
});
test('subdividing a configuration preserves every physical contribution', () => {
  const input = fixture(); const before = result(input);
  const old = input.configurations[0];
  input.configurations.splice(0, 1,
    { ...old, id: 'a1', usePercent: 10, ncrp: { ...old.ncrp, patients_per_week: 4 } },
    { ...old, id: 'a2', usePercent: 15, ncrp: { ...old.ncrp, patients_per_week: 6 } });
  near(result(input).csn.total_mGy_per_week, before.csn.total_mGy_per_week);
  near(result(input).ncrp.total_mGy_per_week, before.ncrp.total_mGy_per_week);
});
test('rotating and translating the entire scene preserves results', () => {
  const input = fixture(); const before = result(input);
  const transform = p => ({ ...p, x: 7 - p.y, y: -4 + p.x });
  input.points = input.points.map(transform);
  input.configurations = input.configurations.map(c => ({ ...c,
    source: transform(c.source), target: transform(c.target), patient: transform(c.patient) }));
  near(result(input).csn.total_mGy_per_week, before.csn.total_mGy_per_week);
  near(result(input).ncrp.total_mGy_per_week, before.ncrp.total_mGy_per_week);
});
test('evaluation is pure and outputs its restricted scope explicitly', () => {
  const input = fixture(); const before = JSON.stringify(input);
  const output = evaluateShielding(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(output.scope, 'planar_unshielded');
  assert.equal(output.unit, 'mGy/semana');
  assert.equal(output.occupancyApplied, true);
  assert.ok(output.limitations.some(v => /CSN/.test(v)));
  assert.ok(output.limitations.some(v => /blindaje/.test(v)));
  assert.equal(Object.hasOwn(output.points[0].csn, 'complies'), false);
});
test('empty geometry gives a useful incomplete result', () => {
  const input = fixture(); input.configurations = [];
  assert.equal(result(input).csn.total_mGy_per_week, null);
  assert.equal(evaluateShielding({}).status, 'incomplete');
});
console.log(`${checks} shielding calculation checks passed (fictitious inputs only).`);
