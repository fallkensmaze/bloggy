export const FDTD_CONFIG_VERSION = 2

export const FDTD_PRESETS = {
  halfWave: {
    id: 'halfWave',
    name: 'Dipolo λ/2 · onda continua',
    description: 'Dipolo resonante aproximado de 0,47 λ, alimentado de forma continua.',
    nx: 240,
    ny: 150,
    wavelengthCells: 40,
    dipoleFraction: 0.47,
    absorberCells: 18,
    pmlTargetReflection: 1e-8,
    pmlKappaMax: 5,
    pmlAlphaMax: 0.05,
    sourceType: 'continuous',
    sourceAmplitude: 0.8,
    stepsPerFrame: 4,
    dielectric: false
  },
  shortPulse: {
    id: 'shortPulse',
    name: 'Dipolo corto · pulso',
    description: 'Dipolo de 0,25 λ excitado con un pulso para observar el frente transitorio.',
    nx: 240,
    ny: 150,
    wavelengthCells: 40,
    dipoleFraction: 0.25,
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
    name: 'Dipolo λ/2 · bloque dieléctrico',
    description: 'Añade a la derecha un bloque con εr = 4 para visualizar refracción y reflexión.',
    nx: 240,
    ny: 150,
    wavelengthCells: 40,
    dipoleFraction: 0.47,
    absorberCells: 18,
    pmlTargetReflection: 1e-8,
    pmlKappaMax: 5,
    pmlAlphaMax: 0.05,
    sourceType: 'continuous',
    sourceAmplitude: 0.8,
    stepsPerFrame: 4,
    dielectric: true
  }
}

const within = (value, min, max, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export function sanitizeFdtdConfig(input = {}) {
  const base = FDTD_PRESETS.halfWave
  const nx = Math.round(within(input.nx, 80, 520, base.nx))
  const ny = Math.round(within(input.ny, 60, 360, base.ny))
  const maxAbsorber = Math.max(8, Math.floor(Math.min(nx, ny) / 3))

  return {
    version: FDTD_CONFIG_VERSION,
    id: typeof input.id === 'string' ? input.id.slice(0, 40) : 'custom',
    name: typeof input.name === 'string' ? input.name.slice(0, 80) : 'Configuración personalizada',
    description: typeof input.description === 'string' ? input.description.slice(0, 240) : '',
    nx,
    ny,
    wavelengthCells: within(input.wavelengthCells, 16, 100, base.wavelengthCells),
    dipoleFraction: within(input.dipoleFraction, 0.1, 0.95, base.dipoleFraction),
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
  if (![1, FDTD_CONFIG_VERSION].includes(parsed.version)) {
    throw new Error(`Versión de configuración no compatible: ${parsed.version ?? 'sin versión'}.`)
  }
  if (parsed.version === 1) {
    parsed.pmlTargetReflection = FDTD_PRESETS.halfWave.pmlTargetReflection
    parsed.pmlKappaMax = FDTD_PRESETS.halfWave.pmlKappaMax
    parsed.pmlAlphaMax = FDTD_PRESETS.halfWave.pmlAlphaMax
  }
  return sanitizeFdtdConfig(parsed)
}
