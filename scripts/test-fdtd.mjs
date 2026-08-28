import assert from 'node:assert/strict'
import { readFdtdAnalysis, s11Db } from '../src/utils/fdtdAnalysis.js'
import { FdtdSimulationFallback } from '../src/utils/fdtdFallback.js'
import { FDTD_PRESETS, parseFdtdConfig, sanitizeFdtdConfig, serializeFdtdConfig } from '../src/utils/fdtdConfig.js'

const config = sanitizeFdtdConfig(FDTD_PRESETS.halfWave)
const makeSimulation = (sourceKind = 1) => new FdtdSimulationFallback(
  config.nx,
  config.ny,
  config.wavelengthCells,
  config.dipoleFraction,
  config.absorberCells,
  config.pmlTargetReflection,
  sourceKind,
  config.sourceAmplitude,
  false,
  config.pmlKappaMax,
  config.pmlAlphaMax,
  config.wireRadiusCells
)

const simulation = makeSimulation(1)
assert.equal(simulation.field_snapshot().length, config.nx * config.ny)
assert.ok(simulation.metal_snapshot().some(value => value === 1), 'El dipolo 3D debe contener celdas PEC')
simulation.step(64)
simulation.step(64)
simulation.step(64)
assert.equal(simulation.step_count(), 192)
assert.ok(simulation.energy() > 0, 'La fuente debe inyectar energía')
assert.ok(simulation.field_snapshot().every(Number.isFinite), 'El campo cilíndrico debe permanecer finito')
assert.ok(simulation.measurement_count() > 0, 'Deben acumularse fasores de banda ancha')

for (let block = 0; block < 15; block += 1) simulation.step(64)
const resonanceIndex = simulation.resonance_index()
const frequencies = simulation.spectrum_frequencies()
const resistance = simulation.spectrum_impedance_real()
const reactance = simulation.spectrum_impedance_imag()
const profile = simulation.current_profile(resonanceIndex)
const pattern = simulation.radiation_pattern_at(resonanceIndex)
const directivity = simulation.directivity_3d_at(resonanceIndex)
assert.equal(frequencies.length, 41)
assert.equal(resistance.length, frequencies.length)
assert.equal(reactance.length, frequencies.length)
assert.ok(resistance.every(Number.isFinite) && reactance.every(Number.isFinite), 'Z(f) debe ser finita')
assert.equal(profile.length, config.ny)
assert.ok(Math.max(...profile) > 0.99, 'La corriente sobre el hilo debe estar normalizada')
assert.equal(pattern.length, 72)
assert.ok(pattern.every(value => value >= 0 && value <= 1), 'El patrón debe estar normalizado')
assert.ok(directivity > 1 && directivity < 4, 'La directividad 3D del dipolo debe ser físicamente plausible')

const analysis = readFdtdAnalysis(simulation, config)
assert.equal(analysis.frequencyMHz.length, 41)
assert.equal(analysis.currentProfile.length, simulation.wire_end() - simulation.wire_start() + 1)
assert.ok(Number.isFinite(analysis.resonanceMHz) && analysis.resonanceMHz > 0)
assert.ok(Number.isFinite(analysis.directivityDb))
assert.ok(s11Db(50, 0) <= -150, 'Una carga de 50 Ω debe dar reflexión numéricamente nula')
assert.equal(Math.round(s11Db(75, 0) * 100) / 100, -13.98)

const pulse = makeSimulation(1)
let peakEnergy = 0
for (let block = 0; block < 32; block += 1) {
  pulse.step(64)
  peakEnergy = Math.max(peakEnergy, pulse.energy())
}
assert.ok(peakEnergy > 0, 'El pulso debe entrar en la malla')
assert.ok(pulse.energy() < peakEnergy * 0.08, 'La CPML cilíndrica debe evacuar al menos el 92 % de la energía del pulso')

const field = pulse.field_snapshot()
const half = Math.floor(pulse.nx() / 2)
for (let z = 0; z < pulse.ny(); z += 17) {
  assert.equal(field[z * pulse.nx() + half - 5], field[z * pulse.nx() + half + 4], 'La reconstrucción del corte debe ser axisimétrica')
}

const roundTrip = parseFdtdConfig(serializeFdtdConfig(config))
assert.deepEqual(roundTrip, config)
const migrated = parseFdtdConfig(JSON.stringify({ schema: 'falkens-maze/fdtd', version: 2, nx: 240, ny: 150 }))
assert.equal(migrated.version, 3)
assert.equal(migrated.frequencyMHz, FDTD_PRESETS.halfWave.frequencyMHz)
assert.throws(() => parseFdtdConfig('{"version":1}'), /no es una configuración/)

const clamped = sanitizeFdtdConfig({ nx: 5, ny: 9999, absorberCells: 999, wireRadiusCells: 99 })
assert.equal(clamped.nx, 120)
assert.equal(clamped.ny, 360)
assert.equal(clamped.wireRadiusCells, 6)
assert.ok(clamped.absorberCells <= Math.floor(Math.min(Math.floor(clamped.nx / 2) + 1, clamped.ny) / 3))

console.log('✓ FDTD 3D: malla axisimétrica, CPML, espectro, S11, corriente y radiación verificadas')
