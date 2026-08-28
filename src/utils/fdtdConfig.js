export const FDTD_CONFIG_VERSION = 4

export const FDTD_PRESETS = {
  halfWave: {
    id: 'halfWave',
    name: 'Dipolo λ/2 · análisis 3D',
    description: 'Dipolo de 0,47 λ con pulso de banda ancha para obtener campo, impedancia y radiación 3D.',
    antennaType: 'dipole',
    nx: 240,
    ny: 150,
    wavelengthCells: 40,
    frequencyMHz: 300,
    dipoleFraction: 0.47,
    wireRadiusCells: 1,
    absorberCells: 18,
    pmlTargetReflection: 1e-8,
    pmlKappaMax: 5,
    pmlAlphaMax: 0.05,
    sourceType: 'pulse',
    sourceAmplitude: 0.8,
    stepsPerFrame: 4,
    dielectric: false
  },
  shortPulse: {
    id: 'shortPulse',
    name: 'Dipolo corto · pulso',
    description: 'Dipolo de 0,25 λ excitado con un pulso para observar el frente transitorio.',
    antennaType: 'dipole',
    nx: 240,
    ny: 150,
    wavelengthCells: 40,
    frequencyMHz: 300,
    dipoleFraction: 0.25,
    wireRadiusCells: 1,
    absorberCells: 18,
    pmlTargetReflection: 1e-8,
    pmlKappaMax: 5,
    pmlAlphaMax: 0.05,
    sourceType: 'pulse',
    sourceAmplitude: 1.0,
    stepsPerFrame: 4,
    dielectric: false
  },
  dielectric: {
    id: 'dielectric',
    name: 'Dipolo λ/2 · anillo dieléctrico',
    description: 'Añade un volumen anular con εr = 4 alrededor del dipolo axisimétrico.',
    antennaType: 'dipole',
    nx: 240,
    ny: 150,
    wavelengthCells: 40,
    frequencyMHz: 300,
    dipoleFraction: 0.47,
    wireRadiusCells: 1,
    absorberCells: 18,
    pmlTargetReflection: 1e-8,
    pmlKappaMax: 5,
    pmlAlphaMax: 0.05,
    sourceType: 'continuous',
    sourceAmplitude: 0.8,
    stepsPerFrame: 4,
    dielectric: true
  },
  quarterWave: {
    id: 'quarterWave',
    name: 'Vertical λ/4 · plano de tierra',
    description: 'Monopolo de cuarto de onda sobre un plano conductor infinito axisimétrico.',
    antennaType: 'monopole',
    nx: 240,
    ny: 170,
    wavelengthCells: 40,
    frequencyMHz: 145,
    dipoleFraction: 0.24,
    wireRadiusCells: 1,
    absorberCells: 18,
    pmlTargetReflection: 1e-8,
    pmlKappaMax: 5,
    pmlAlphaMax: 0.05,
    sourceType: 'pulse',
    sourceAmplitude: 0.8,
    stepsPerFrame: 4,
    dielectric: false
  },
  fiveEighths: {
    id: 'fiveEighths',
    name: 'Vertical 5/8 λ · plano de tierra',
    description: 'Monopolo vertical de 5/8 λ sobre plano conductor; permite observar el estrechamiento del lóbulo.',
    antennaType: 'monopole',
    nx: 240,
    ny: 190,
    wavelengthCells: 40,
    frequencyMHz: 145,
    dipoleFraction: 0.625,
    wireRadiusCells: 1,
    absorberCells: 18,
    pmlTargetReflection: 1e-8,
    pmlKappaMax: 5,
    pmlAlphaMax: 0.05,
    sourceType: 'pulse',
    sourceAmplitude: 0.8,
    stepsPerFrame: 4,
    dielectric: false
  },
  longWire: {
    id: 'longWire',
    name: 'Hilo largo · 1,25 λ',
    description: 'Hilo recto de 1,25 λ alimentado en el centro para estudiar corrientes y lóbulos múltiples.',
    antennaType: 'longwire',
    nx: 240,
    ny: 210,
    wavelengthCells: 40,
    frequencyMHz: 14.2,
    dipoleFraction: 1.25,
    wireRadiusCells: 1,
    absorberCells: 18,
    pmlTargetReflection: 1e-8,
    pmlKappaMax: 5,
    pmlAlphaMax: 0.05,
    sourceType: 'pulse',
    sourceAmplitude: 0.8,
    stepsPerFrame: 3,
    dielectric: false
  },
  yagi: {
    id: 'yagi',
    name: 'Yagi-Uda · 4 elementos',
    description: 'Malla cartesiana 3D con reflector, elemento excitado y dos directores paralelos.',
    antennaType: 'yagi',
    nx: 72,
    ny: 96,
    wavelengthCells: 24,
    frequencyMHz: 145,
    dipoleFraction: 0.47,
    wireRadiusCells: 1,
    absorberCells: 9,
    pmlTargetReflection: 1e-7,
    pmlKappaMax: 5,
    pmlAlphaMax: 0.05,
    sourceType: 'pulse',
    sourceAmplitude: 0.65,
    stepsPerFrame: 1,
    dielectric: false
  }
}

const within = (value, min, max, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export function sanitizeFdtdConfig(input = {}) {
  const base = FDTD_PRESETS.halfWave
  const antennaType = ['dipole', 'monopole', 'longwire', 'yagi'].includes(input.antennaType) ? input.antennaType : base.antennaType
  const nx = Math.round(within(input.nx, antennaType === 'yagi' ? 56 : 120, antennaType === 'yagi' ? 112 : 520, base.nx))
  const ny = Math.round(within(input.ny, 80, 360, base.ny))
  const radialExtent = antennaType === 'yagi' ? nx : Math.floor(nx / 2) + 1
  const maxAbsorber = Math.max(8, Math.floor(Math.min(radialExtent, ny) / 3))

  return {
    version: FDTD_CONFIG_VERSION,
    id: typeof input.id === 'string' ? input.id.slice(0, 40) : 'custom',
    name: typeof input.name === 'string' ? input.name.slice(0, 80) : 'Configuración personalizada',
    description: typeof input.description === 'string' ? input.description.slice(0, 240) : '',
    antennaType,
    nx,
    ny,
    wavelengthCells: within(input.wavelengthCells, 16, 100, base.wavelengthCells),
    frequencyMHz: within(input.frequencyMHz, 0.1, 100000, base.frequencyMHz),
    dipoleFraction: within(input.dipoleFraction, 0.1, 1.8, base.dipoleFraction),
    wireRadiusCells: Math.round(within(input.wireRadiusCells, 1, 6, base.wireRadiusCells)),
    absorberCells: Math.round(within(input.absorberCells, 8, maxAbsorber, base.absorberCells)),
    pmlTargetReflection: within(input.pmlTargetReflection, 1e-12, 1e-2, base.pmlTargetReflection),
    pmlKappaMax: within(input.pmlKappaMax, 1, 12, base.pmlKappaMax),
    pmlAlphaMax: within(input.pmlAlphaMax, 0, 0.25, base.pmlAlphaMax),
    sourceType: input.sourceType === 'pulse' ? 'pulse' : 'continuous',
    sourceAmplitude: within(input.sourceAmplitude, 0.01, 4, base.sourceAmplitude),
    stepsPerFrame: Math.round(within(input.stepsPerFrame, 1, 16, base.stepsPerFrame)),
    dielectric: Boolean(input.dielectric)
  }
}

export function serializeFdtdConfig(config) {
  return JSON.stringify({
    schema: 'falkens-maze/fdtd',
    ...sanitizeFdtdConfig(config)
  }, null, 2)
}

export function parseFdtdConfig(text) {
  const parsed = JSON.parse(text)
  if (!parsed || parsed.schema !== 'falkens-maze/fdtd') {
    throw new Error('El archivo no es una configuración FDTD de Falken\'s Maze.')
  }
  if (![1, 2, 3, FDTD_CONFIG_VERSION].includes(parsed.version)) {
    throw new Error(`Versión de configuración no compatible: ${parsed.version ?? 'sin versión'}.`)
  }
  if (parsed.version === 1) {
    parsed.pmlTargetReflection = FDTD_PRESETS.halfWave.pmlTargetReflection
    parsed.pmlKappaMax = FDTD_PRESETS.halfWave.pmlKappaMax
    parsed.pmlAlphaMax = FDTD_PRESETS.halfWave.pmlAlphaMax
  }
  if (parsed.version < 3) {
    parsed.frequencyMHz = FDTD_PRESETS.halfWave.frequencyMHz
    parsed.wireRadiusCells = FDTD_PRESETS.halfWave.wireRadiusCells
  }
  if (parsed.version < 4) parsed.antennaType = FDTD_PRESETS.halfWave.antennaType
  return sanitizeFdtdConfig(parsed)
}
