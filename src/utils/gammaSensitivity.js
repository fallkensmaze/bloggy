import { numberOrNull } from './gammaDicom.js'

function required(value, name, allowZero = false) {
  const n = numberOrNull(value)
  if (n == null || (allowZero ? n < 0 : n <= 0)) throw new Error(`Introduce ${name} ${allowZero ? '(≥ 0)' : '(> 0)'}.`)
  return n
}

// Compare local acquisition/calibrator clocks without applying the browser timezone.
export function clockSeconds(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(String(value))) throw new Error('Falta fecha y hora completa de actividad/adquisición.')
  const ms = Date.parse(`${value}Z`)
  if (!Number.isFinite(ms)) throw new Error('Fecha y hora no válidas.')
  return ms / 1000
}

export function decayActivity(activity, measuredAt, acquiredAt, halfLifeSeconds) {
  return activity * Math.exp(-Math.LN2 * (clockSeconds(acquiredAt) - clockSeconds(measuredAt)) / halfLifeSeconds)
}

export function analyzeSensitivity(image, frameIndex, options) {
  const frame = image.frameInfo[frameIndex]
  if (!image.isStatic || !frame.countsUsable) throw new Error('Sensibilidad requiere cuentas originales de una adquisición NM STATIC, sin reescalado ni corrección de decaimiento, atenuación o dispersión.')
  const durationSeconds = required(options.durationSeconds ?? frame.durationSeconds, 'duración de adquisición en segundos')
  const halfLifeSeconds = required(options.halfLifeHours, 'semiperiodo en horas') * 3600
  const activityMBq = required(options.activityMBq, 'actividad medida en MBq')
  const acquiredAt = options.acquiredAt || image.metadata.acquiredAt
  const startActivity = decayActivity(activityMBq, options.activityAt, acquiredAt, halfLifeSeconds)
  let residualAtStart = 0
  if (options.useResidual) residualAtStart = decayActivity(required(options.residualMBq, 'actividad residual en MBq', true),
    options.residualAt, acquiredAt, halfLifeSeconds)
  const netActivityStartMBq = startActivity - residualAtStart
  if (!(netActivityStartMBq > 0) || !Number.isFinite(netActivityStartMBq)) throw new Error('La actividad neta al inicio debe ser positiva y finita.')
  // Exact mean over exposure; series/acquisition duration is NEVER summed across heads.
  const exponent = Math.LN2 * durationSeconds / halfLifeSeconds
  const meanActivityMBq = netActivityStartMBq * (-Math.expm1(-exponent)) / exponent
  if (!(meanActivityMBq > 0) || !Number.isFinite(meanActivityMBq)) throw new Error('Actividad media no válida: comprueba semiperiodo y fechas.')
  let backgroundCps = 0, backgroundVariance = 0
  if (options.backgroundMode === 'measured') {
    const counts = required(options.backgroundCounts, 'cuentas de fondo', true)
    const time = required(options.backgroundSeconds, 'tiempo de fondo en segundos')
    backgroundCps = counts / time
    backgroundVariance = counts / time ** 2
  } else if (options.backgroundMode !== 'negligible') throw new Error('Introduce el fondo medido o declara explícitamente que es despreciable.')
  const grossCps = frame.totalCounts / durationSeconds, netCps = grossCps - backgroundCps
  if (!(netCps > 0)) throw new Error('La tasa neta no es positiva: comprueba fondo y tiempos.')
  if (!Number.isFinite(netCps / meanActivityMBq)) throw new Error('Sensibilidad fuera del rango numérico; comprueba los datos.')
  return { method: 'Sensibilidad planar / gamma-qc-1.0', totalCounts: frame.totalCounts, durationSeconds,
    grossCps, backgroundCps, netCps, netActivityStartMBq, meanActivityMBq,
    sensitivity: netCps / meanActivityMBq,
    statisticalUncertainty: Math.sqrt(frame.totalCounts / durationSeconds ** 2 + backgroundVariance) / meanActivityMBq,
    warnings: options.backgroundMode === 'negligible' ? ['Fondo declarado despreciable por el usuario.'] : [] }
}
