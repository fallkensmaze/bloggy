import assert from 'node:assert/strict'
import { readFdtdAnalysis, s11Db } from '../src/utils/fdtdAnalysis.js'
import { FdtdSimulation3dFallback } from '../src/utils/fdtdCartesian3dFallback.js'
import { FdtdSimulationFallback } from '../src/utils/fdtdFallback.js'
import { FDTD_COURTYARD, FDTD_PRESETS, parseFdtdConfig, sanitizeFdtdConfig, serializeFdtdConfig } from '../src/utils/fdtdConfig.js'

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
  config.wireRadiusCells,
  0
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
assert.ok(simulation.electric_z_snapshot().every(Number.isFinite), 'Ez debe permanecer finito')
assert.ok(simulation.electric_r_snapshot().every(Number.isFinite), 'Er debe permanecer finito')
assert.ok(simulation.electric_magnitude_snapshot().every(Number.isFinite), '|E| debe permanecer finito')
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
assert.equal(analysis.resonanceAvailable, true, 'El pulso debe localizar un cruce de Xin por cero')
assert.equal(analysis.resonanceImpedance.imag, 0, 'La resonancia interpolada debe cumplir Xin = 0')
assert.ok(analysis.validSpectrum.every(Boolean), 'El pulso debe cubrir toda la banda configurada en este caso')
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

const continuous = makeSimulation(0)
for (let block = 0; block < 25; block += 1) continuous.step(64)
const continuousAnalysis = readFdtdAnalysis(continuous, { ...config, sourceType: 'continuous' })
assert.equal(continuousAnalysis.ready, true)
assert.equal(continuousAnalysis.spectrumMode, 'nominal')
assert.equal(continuousAnalysis.resonanceAvailable, false, 'Una onda continua no puede estimar una resonancia de banda ancha')
assert.equal(continuousAnalysis.validSpectrum.filter(Boolean).length, 1, 'La onda continua solo debe validar f0')
assert.equal(continuousAnalysis.plottedResistance.filter(Number.isFinite).length, 1, 'No deben dibujarse cocientes de fuga espectral')
assert.equal(continuousAnalysis.plottedReactance.filter(Number.isFinite).length, 1, 'Xin solo debe mostrarse en f0')
assert.ok(Number.isFinite(continuousAnalysis.nominalImpedance.real) && Number.isFinite(continuousAnalysis.nominalImpedance.imag))

const roundTrip = parseFdtdConfig(serializeFdtdConfig(config))
assert.deepEqual(roundTrip, config)
const migrated = parseFdtdConfig(JSON.stringify({ schema: 'falkens-maze/fdtd', version: 2, nx: 240, ny: 150 }))
assert.equal(migrated.version, 5)
assert.equal(migrated.antennaType, 'dipole')
assert.equal(migrated.frequencyMHz, FDTD_PRESETS.halfWave.frequencyMHz)
assert.throws(() => parseFdtdConfig('{"version":1}'), /no es una configuración/)

const clamped = sanitizeFdtdConfig({ nx: 5, ny: 9999, absorberCells: 999, wireRadiusCells: 99 })
assert.equal(clamped.nx, 120)
assert.equal(clamped.ny, 360)
assert.equal(clamped.wireRadiusCells, 6)
assert.ok(clamped.absorberCells <= Math.floor(Math.min(Math.floor(clamped.nx / 2) + 1, clamped.ny) / 3))
assert.equal(sanitizeFdtdConfig(FDTD_PRESETS.longWire).antennaType, 'longwire')
assert.ok(sanitizeFdtdConfig(FDTD_PRESETS.longWire).dipoleFraction > 1)
assert.equal(sanitizeFdtdConfig(FDTD_PRESETS.yagi).nx, 72)
assert.equal(sanitizeFdtdConfig(FDTD_PRESETS.yagi).depthCells, 72)

const monopoleConfig = sanitizeFdtdConfig(FDTD_PRESETS.quarterWave)
const monopole = new FdtdSimulationFallback(
  monopoleConfig.nx,
  monopoleConfig.ny,
  monopoleConfig.wavelengthCells,
  monopoleConfig.dipoleFraction,
  monopoleConfig.absorberCells,
  monopoleConfig.pmlTargetReflection,
  1,
  monopoleConfig.sourceAmplitude,
  false,
  monopoleConfig.pmlKappaMax,
  monopoleConfig.pmlAlphaMax,
  monopoleConfig.wireRadiusCells,
  1
)
assert.ok(monopole.feed_position() < Math.floor(monopole.ny() / 2), 'El monopolo debe alimentarse sobre el plano de tierra')
assert.ok(monopole.metal_snapshot().filter(value => value === 1).length > monopole.nx(), 'El monopolo debe incluir el plano PEC')
for (let block = 0; block < 12; block += 1) monopole.step(64)
assert.ok(monopole.energy() > 0 && Number.isFinite(monopole.energy()), 'El monopolo debe propagar un campo finito')
assert.ok(monopole.directivity_3d_at(monopole.resonance_index()) > 1, 'El monopolo debe producir un patrón radiado')

const yagiConfig = sanitizeFdtdConfig({ ...FDTD_PRESETS.yagi, nx: 56, ny: 80, wavelengthCells: 18, absorberCells: 8 })
const yagi = new FdtdSimulation3dFallback(
  yagiConfig.nx,
  yagiConfig.ny,
  yagiConfig.wavelengthCells,
  yagiConfig.dipoleFraction,
  yagiConfig.absorberCells,
  yagiConfig.pmlTargetReflection,
  1,
  yagiConfig.sourceAmplitude,
  false,
  yagiConfig.pmlKappaMax,
  yagiConfig.pmlAlphaMax,
  yagiConfig.wireRadiusCells,
  2,
  yagiConfig.depthCells
)
for (let block = 0; block < 6; block += 1) yagi.step(16)
assert.equal(yagi.field_snapshot().length, yagi.nx() * yagi.ny())
assert.equal(yagi.volume_snapshot(3).length, yagi.nx() * yagi.depth() * yagi.ny())
assert.ok(yagi.conductor_points().length > 60, 'La Yagi debe exportar reflector, excitado y directores')
assert.ok(yagi.energy() > 0 && Number.isFinite(yagi.energy()), 'La malla cartesiana debe propagar un campo finito')
assert.ok(yagi.electric_magnitude_snapshot().every(Number.isFinite), 'El campo eléctrico cartesiano debe permanecer finito')
assert.ok(yagi.spectrum_impedance_real().every(Number.isFinite), 'La impedancia de la Yagi debe permanecer finita')
assert.equal(yagi.radiation_pattern_at(yagi.resonance_index()).length, 72)
assert.ok(Number.isFinite(yagi.directivity_3d_at(yagi.resonance_index())))

const courtyardConfig = sanitizeFdtdConfig(FDTD_PRESETS.courtyard)
assert.equal(courtyardConfig.antennaType, 'courtyard')
assert.deepEqual([courtyardConfig.nx, courtyardConfig.depthCells, courtyardConfig.ny], [112, 72, 120])
assert.equal(courtyardConfig.frequencyMHz, FDTD_PRESETS.courtyard.frequencyMHz)
const courtyard = new FdtdSimulation3dFallback(
  courtyardConfig.nx,
  courtyardConfig.ny,
  courtyardConfig.wavelengthCells,
  courtyardConfig.dipoleFraction,
  courtyardConfig.absorberCells,
  courtyardConfig.pmlTargetReflection,
  0,
  courtyardConfig.sourceAmplitude,
  true,
  courtyardConfig.pmlKappaMax,
  courtyardConfig.pmlAlphaMax,
  courtyardConfig.wireRadiusCells,
  3,
  courtyardConfig.depthCells
)
const courtyardScene = Array.from(courtyard.scene_geometry())
const sceneMetres = cells => Math.round(cells * FDTD_COURTYARD.spatialStepMetres * 1e6) / 1e6
assert.equal(courtyardScene[0], 1)
assert.equal(sceneMetres(courtyardScene[2] - courtyardScene[1]), FDTD_COURTYARD.longSideMetres)
assert.equal(sceneMetres(courtyardScene[8] - courtyardScene[7]), FDTD_COURTYARD.wireLengthMetres)
assert.equal(sceneMetres(courtyardScene[9] - courtyardScene[3]), FDTD_COURTYARD.wireOffsetMetres)
assert.equal(sceneMetres(courtyardScene[10] - courtyardScene[5]), FDTD_COURTYARD.wireHeightMetres)
assert.equal(courtyard.depth(), courtyardConfig.depthCells)
assert.ok(courtyard.material_snapshot().some(value => value === FDTD_COURTYARD.wallRelativePermittivity), 'El corte del patio debe contener suelo y paredes dieléctricas')
const courtyardWire = Array.from(courtyard.conductor_points())
assert.equal(courtyardWire[1], courtyardWire.at(-2), 'El hilo debe ser paralelo al lado A sobre y constante')
assert.equal(courtyardWire[2], courtyardWire.at(-1), 'El hilo debe permanecer horizontal')
assert.equal(sceneMetres(courtyardWire.at(-3) - courtyardWire[0]), FDTD_COURTYARD.wireLengthMetres)
for (let block = 0; block < 4; block += 1) courtyard.step(4)
assert.ok(courtyard.energy() > 0 && Number.isFinite(courtyard.energy()), 'El hilo del patio debe excitar un campo finito')
assert.ok(courtyard.electric_magnitude_snapshot().every(Number.isFinite), 'El campo del patio debe permanecer finito')

console.log('✓ FDTD 3D: campos E/H, CPML, dipolo, monopolo, hilo largo, Yagi y patio cartesiano verificados')
