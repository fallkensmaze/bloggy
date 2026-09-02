const PATTERN_FLOOR_DB = -40
const SPECTRAL_SIGNAL_FLOOR = 0.08

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

function findReactanceCrossing(ratios, resistance, reactance, valid, nominalIndex) {
  const crossings = []
  for (let index = 0; index < ratios.length - 1; index += 1) {
    if (!valid[index] || !valid[index + 1]) continue
    const x0 = reactance[index]
    const x1 = reactance[index + 1]
    const r0 = resistance[index]
    const r1 = resistance[index + 1]
    if (![x0, x1, r0, r1].every(Number.isFinite) || r0 <= 0 || r1 <= 0 || x0 * x1 > 0) continue
    const denominator = Math.abs(x0) + Math.abs(x1)
    const fraction = denominator > 1e-12 ? Math.abs(x0) / denominator : 0
    crossings.push({
      plotIndex: index + fraction,
      bin: fraction <= 0.5 ? index : index + 1,
      ratio: ratios[index] + fraction * (ratios[index + 1] - ratios[index]),
      real: r0 + fraction * (r1 - r0)
    })
  }
  if (!crossings.length) return null
  return crossings.reduce((best, candidate) => (
    Math.abs(candidate.ratio - ratios[nominalIndex]) < Math.abs(best.ratio - ratios[nominalIndex]) ? candidate : best
  ))
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
  const nominalIndex = ratios.reduce((best, value, index) => (
    Math.abs(value - 1) < Math.abs(ratios[best] - 1) ? index : best
  ), 0)
  const frequencyMHz = ratios.map(ratio => ratio * config.frequencyMHz)
  const s11 = resistance.map((real, index) => s11Db(real, reactance[index]))
  const currentSpectrum = typeof simulation.spectrum_current_magnitude === 'function'
    ? Array.from(simulation.spectrum_current_magnitude(), value => Math.max(0, finiteOr(value)))
    : ratios.map(() => 1)
  const maximumCurrentSpectrum = Math.max(0, ...currentSpectrum)
  const elapsedCycles = simulation.step_count() * simulation.time_step() / config.wavelengthCells
  const requiredCycles = config.sourceType === 'pulse' ? 10 : 12
  const ready = elapsedCycles >= requiredCycles && simulation.measurement_count() > 0
  const validSpectrum = currentSpectrum.map((value, index) => ready && (
    config.sourceType === 'pulse'
      ? maximumCurrentSpectrum > 0 && value >= maximumCurrentSpectrum * SPECTRAL_SIGNAL_FLOOR
      : index === nominalIndex
  ))
  const crossing = config.sourceType === 'pulse' && ready
    ? findReactanceCrossing(ratios, resistance, reactance, validSpectrum, nominalIndex)
    : null
  const resonanceAvailable = Boolean(crossing)
  const resonanceIndex = crossing?.bin ?? nominalIndex
  const resonancePlotIndex = crossing?.plotIndex ?? nominalIndex
  const resonanceRatio = crossing?.ratio ?? ratios[nominalIndex] ?? 1

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
  const endFed = config.antennaType === 'monopole' || config.antennaType === 'courtyard'
  const position = endFed
    ? profileIndices.map(index => (index - sourceZ) / Math.max(1, wireEnd - sourceZ))
    : profileIndices.map(index => (index - sourceZ) / wireLength)
  const idealProfile = endFed
    ? position.map(value => Math.max(0, Math.cos(Math.PI * value / 2)))
    : position.map(value => Math.max(0, Math.cos(Math.PI * value)))

  const linearPattern = Array.from(simulation.radiation_pattern_at(resonanceIndex))
  const patternDb = linearPattern.map(value => Math.max(PATTERN_FLOOR_DB, 10 * Math.log10(Math.max(1e-4, value))))
  const directivity = finiteOr(simulation.directivity_3d_at(resonanceIndex))
  const directivityDb = directivity > 0 ? 10 * Math.log10(directivity) : 0

  return {
    samples: simulation.measurement_count(),
    ready,
    elapsedCycles,
    requiredCycles,
    spectrumMode: config.sourceType === 'pulse' ? 'broadband' : 'nominal',
    validSpectrum,
    plottedResistance: resistance.map((value, index) => validSpectrum[index] ? value : null),
    plottedReactance: reactance.map((value, index) => validSpectrum[index] ? value : null),
    plottedS11: s11.map((value, index) => validSpectrum[index] ? value : null),
    timeNs: indices.map(index => index * timeScaleNs),
    voltage: indices.map(index => normalizedVoltage[index]),
    current: indices.map(index => normalizedCurrent[index]),
    frequencyMHz,
    resistance,
    reactance,
    s11,
    resonanceIndex,
    resonancePlotIndex,
    resonanceAvailable,
    nominalIndex,
    resonanceMHz: config.frequencyMHz * resonanceRatio,
    lengthOverLambda: config.dipoleFraction * resonanceRatio,
    resonanceImpedance: { real: crossing?.real ?? 0, imag: 0 },
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
  elapsedCycles: 0,
  requiredCycles: 10,
  spectrumMode: 'broadband',
  validSpectrum: [],
  plottedResistance: [],
  plottedReactance: [],
  plottedS11: [],
  timeNs: [],
  voltage: [],
  current: [],
  frequencyMHz: [],
  resistance: [],
  reactance: [],
  s11: [],
  resonanceIndex: 0,
  resonancePlotIndex: 0,
  resonanceAvailable: false,
  nominalIndex: 0,
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
