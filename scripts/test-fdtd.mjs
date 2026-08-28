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
  config.absorberStrength,
  0,
  config.sourceAmplitude,
  false
)

assert.equal(simulation.field_snapshot().length, config.nx * config.ny)
assert.ok(simulation.metal_snapshot().some(value => value === 1), 'El dipolo debe contener celdas PEC')
simulation.step(128)
simulation.step(64)
assert.equal(simulation.step_count(), 128)
assert.ok(simulation.energy() > 0, 'La fuente debe inyectar energía')
assert.ok(simulation.field_snapshot().every(Number.isFinite), 'El campo debe permanecer finito')

const roundTrip = parseFdtdConfig(serializeFdtdConfig(config))
assert.deepEqual(roundTrip, config)
assert.throws(() => parseFdtdConfig('{"version":1}'), /no es una configuración/)

const clamped = sanitizeFdtdConfig({ nx: 5, ny: 9999, absorberCells: 999 })
assert.equal(clamped.nx, 80)
assert.equal(clamped.ny, 360)
assert.ok(clamped.absorberCells <= Math.floor(Math.min(clamped.nx, clamped.ny) / 3))

console.log('✓ FDTD: propagación finita, geometría PEC y configuración JSON verificadas')
