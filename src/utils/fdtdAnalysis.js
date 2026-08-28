const PATTERN_FLOOR_DB = -40

const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback

function normalizeTrace(values) {
  let peak = 0
  for (const value of values) peak = Math.max(peak, Math.abs(value))
  if (peak <= 1e-18) return Array.from(values, () => 0)
  return Array.from(values, value => value / peak)
}

function decimateSeries(values, maximumPoints = 360) {
  const stride = Math.max(1, Math.ceil(values.length / maximumPoints))
  const indices = []
  for (let index = 0; index < values.length; index += stride) indices.push(index)
  if (values.length > 0 && indices.at(-1) !== values.length - 1) indices.push(values.length - 1)
  return indices
}

export function s11Db(real, imag, referenceOhms = 50) {
  const denominator = (real + referenceOhms) ** 2 + imag ** 2
  if (denominator <= 1e-18) return 0
  const magnitude = Math.sqrt(((real - referenceOhms) ** 2 + imag ** 2) / denominator)
  return 20 * Math.log10(Math.max(1e-8, magnitude))
}

export function readFdtdAnalysis(simulation, config) {
  const ratios = Array.from(simulation.spectrum_frequencies())
  const resistance = Array.from(simulation.spectrum_impedance_real(), value => finiteOr(value))
  const reactance = Array.from(simulation.spectrum_impedance_imag(), value => finiteOr(value))
  const resonanceIndex = Math.max(0, Math.min(ratios.length - 1, simulation.resonance_index()))
  const nominalIndex = ratios.reduce((best, value, index) => (
    Math.abs(value - 1) < Math.abs(ratios[best] - 1) ? index : best
  ), 0)
  const frequencyMHz = ratios.map(ratio => ratio * config.frequencyMHz)
  const s11 = resistance.map((real, index) => s11Db(real, reactance[index]))

  const voltage = Array.from(simulation.time_voltage_snapshot())
  const current = Array.from(simulation.time_current_snapshot())
  const indices = decimateSeries(voltage)
  const normalizedVoltage = normalizeTrace(voltage)
  const normalizedCurrent = normalizeTrace(current)
  const timeScaleNs = simulation.time_step() * 1000 / (config.wavelengthCells * config.frequencyMHz)

  const wireStart = simulation.wire_start()
  const wireEnd = simulation.wire_end()
  const sourceZ = typeof simulation.feed_position === 'function' ? simulation.feed_position() : Math.floor(simulation.ny() / 2)
  const wireLength = Math.max(1, wireEnd - wireStart)
  const profile = Array.from(simulation.current_profile(resonanceIndex))
  const profileIndices = Array.from({ length: wireEnd - wireStart + 1 }, (_, index) => wireStart + index)
  const position = config.antennaType === 'monopole'
    ? profileIndices.map(index => (index - sourceZ) / Math.max(1, wireEnd - sourceZ))
    : profileIndices.map(index => (index - sourceZ) / wireLength)
  const idealProfile = config.antennaType === 'monopole'
    ? position.map(value => Math.max(0, Math.cos(Math.PI * value / 2)))
    : position.map(value => Math.max(0, Math.cos(Math.PI * value)))

  const linearPattern = Array.from(simulation.radiation_pattern_at(resonanceIndex))
  const patternDb = linearPattern.map(value => Math.max(PATTERN_FLOOR_DB, 10 * Math.log10(Math.max(1e-4, value))))
  const directivity = finiteOr(simulation.directivity_3d_at(resonanceIndex))
  const directivityDb = directivity > 0 ? 10 * Math.log10(directivity) : 0
  const resonanceRatio = ratios[resonanceIndex] || 1

  return {
    samples: simulation.measurement_count(),
    ready: simulation.measurement_count() >= Math.ceil(6 * config.wavelengthCells / (simulation.time_step() * 2)),
    timeNs: indices.map(index => index * timeScaleNs),
    voltage: indices.map(index => normalizedVoltage[index]),
    current: indices.map(index => normalizedCurrent[index]),
    frequencyMHz,
    resistance,
    reactance,
    s11,
    resonanceIndex,
    resonanceMHz: config.frequencyMHz * resonanceRatio,
    lengthOverLambda: config.dipoleFraction * resonanceRatio,
    resonanceImpedance: { real: resistance[resonanceIndex] || 0, imag: reactance[resonanceIndex] || 0 },
    nominalImpedance: { real: resistance[nominalIndex] || 0, imag: reactance[nominalIndex] || 0 },
    currentPosition: position,
    currentProfile: profileIndices.map(index => profile[index]),
    idealProfile,
    patternDb,
    directivity,
    directivityDb
  }
}

export const EMPTY_FDTD_ANALYSIS = {
  samples: 0,
  ready: false,
  timeNs: [],
  voltage: [],
  current: [],
  frequencyMHz: [],
  resistance: [],
  reactance: [],
  s11: [],
  resonanceIndex: 0,
  resonanceMHz: 0,
  lengthOverLambda: 0,
  resonanceImpedance: { real: 0, imag: 0 },
  nominalImpedance: { real: 0, imag: 0 },
  currentPosition: [],
  currentProfile: [],
  idealProfile: [],
  patternDb: Array(72).fill(PATTERN_FLOOR_DB),
  directivity: 0,
  directivityDb: 0
}
