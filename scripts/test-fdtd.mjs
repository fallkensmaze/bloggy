import assert from 'node:assert/strict'
import { FdtdSimulationFallback } from '../src/utils/fdtdFallback.js'
import { FDTD_PRESETS, parseFdtdConfig, sanitizeFdtdConfig, serializeFdtdConfig } from '../src/utils/fdtdConfig.js'

const config = sanitizeFdtdConfig(FDTD_PRESETS.halfWave)
const simulation = new FdtdSimulationFallback(
  config.nx,
  config.ny,
  config.wavelengthCells,
  config.dipoleFraction,
  config.absorberCells,
  config.pmlTargetReflection,
  0,
  config.sourceAmplitude,
  false,
  config.pmlKappaMax,
  config.pmlAlphaMax
)

assert.equal(simulation.field_snapshot().length, config.nx * config.ny)
assert.ok(simulation.metal_snapshot().some(value => value === 1), 'El dipolo debe contener celdas PEC')
simulation.step(128)
simulation.step(64)
simulation.step(64)
assert.equal(simulation.step_count(), 192)
assert.ok(simulation.energy() > 0, 'La fuente debe inyectar energía')
assert.ok(simulation.field_snapshot().every(Number.isFinite), 'El campo debe permanecer finito')
assert.ok(simulation.measurement_count() > 0, 'Deben acumularse fasores en los monitores')
assert.ok(Number.isFinite(simulation.directivity_2d()), 'La directividad 2D debe ser finita')
assert.ok(Number.isFinite(simulation.impedance_real()), 'La parte real de Z debe ser finita')
assert.ok(Number.isFinite(simulation.impedance_imag()), 'La parte imaginaria de Z debe ser finita')

const pulse = new FdtdSimulationFallback(140, 100, 28, 0.47, 14, 1e-8, 1, 0.8, false, 5, 0.05)
let peakEnergy = 0
for (let block = 0; block < 16; block += 1) {
  pulse.step(64)
  peakEnergy = Math.max(peakEnergy, pulse.energy())
}
assert.ok(peakEnergy > 0, 'El pulso debe entrar en la malla')
assert.ok(pulse.energy() < peakEnergy * 0.08, 'La CPML debe evacuar al menos el 92 % de la energía del pulso')

const roundTrip = parseFdtdConfig(serializeFdtdConfig(config))
assert.deepEqual(roundTrip, config)
assert.throws(() => parseFdtdConfig('{"version":1}'), /no es una configuración/)

const clamped = sanitizeFdtdConfig({ nx: 5, ny: 9999, absorberCells: 999 })
assert.equal(clamped.nx, 80)
assert.equal(clamped.ny, 360)
assert.ok(clamped.absorberCells <= Math.floor(Math.min(clamped.nx, clamped.ny) / 3))

console.log('✓ FDTD: CPML, monitores de radiación, impedancia y configuración JSON verificadas')
