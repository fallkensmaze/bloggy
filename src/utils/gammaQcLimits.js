import { numberOrNull } from './gammaDicom.js'
import { getLimitProfile } from './nemaAlgorithms.js'

// Only the supplied monthly tolerance cells are transcribed, never historical results.
export const MONTHLY_REFERENCE_ID = 'sala01-2026'
export const MONTHLY_REFERENCE_SOURCE = 'QC.Sala-01.2026.xlsx · Sala 1 · N.S. 1660 · Resumen mensuales'
export const MONTHLY_LIMITS = {
  uniformity: { DUcfov: 2.5, DUufov: 2.7, IUcfov: 2.9, IUufov: 3.7 },
  fwhm: 7.5, fwtm: 13.6, sensitivity: 202, cor: 1.1988, axial: 1.1988, tomography: 10,
}
export const MONTHLY_REFERENCE_ROWS = [
  { type: 'uniformity', label: 'Uniformidad intrínseca', criterion: 'UDCC ≤ 2,5 % · UDCT ≤ 2,7 % · UICC ≤ 2,9 % · UICT ≤ 3,7 %', cells: 'C7:J7' },
  { type: 'resolution', label: 'Resolución espacial', criterion: 'FWHM media X/Y ≤ 7,5 mm · FWTM media X/Y ≤ 13,6 mm', cells: 'C27:F27' },
  { type: 'sensitivity', label: 'Sensibilidad planar', criterion: 'H1 y H2 ≥ 202 cpm/µCi', cells: 'C47:D47' },
  { type: 'cor', label: 'COR y alineación axial', criterion: 'Las cuatro cotas ≤ 1,1988 mm (0,5 × 2,3976 mm)', cells: 'C66:F66' },
  { type: 'tomography', label: 'Uniformidad tomográfica', criterion: '≤ 10 % · medida y definición del protocolo pendientes de registrar', cells: 'C102' },
]
export const monthlyLimitSource = type => `${MONTHLY_REFERENCE_SOURCE}!${MONTHLY_REFERENCE_ROWS.find(r => r.type === type)?.cells || ''}`

export function matchesMonthlyReference(image) {
  const m = image?.metadata || {}
  const serial = String(m.serial || '').trim()
  const station = String(m.station || '').trim().toUpperCase().replace(/[\s_-]/g, '')
  // A conflicting serial must not be hidden by a familiar station name.
  if (serial && serial !== '1660') return false
  if (/^SYMBIA\d+$/.test(station) && station !== 'SYMBIA1660') return false
  return m.acquiredAt?.startsWith('2026-') && (serial === '1660' || station === 'SYMBIA1660') || false
}

export function gammaUniformityProfile(options, detected) {
  const profile = options.uniformityProfile === 'auto' ? detected : getLimitProfile(options.uniformityProfile)
  return options.referenceProfile === MONTHLY_REFERENCE_ID && profile?.id === 'symbia_intevo'
    ? { ...profile, specs: MONTHLY_LIMITS.uniformity, source: monthlyLimitSource('uniformity') } : profile
}

// Keep configured tolerances visible when a measurement cannot be calculated.
export function configuredGammaMetrics(type, options = {}) {
  const metric = (key, label, unit, limit, operator = 'max') => ({ key, label, unit, limit: numberOrNull(limit), value: null, operator })
  if (type === 'resolution') return [metric('fwhm', 'FWHM', 'mm', options.fwhmLimit), metric('fwtm', 'FWTM', 'mm', options.fwtmLimit)]
  if (type === 'sensitivity') return options.sensitivityComparison === 'minimum'
    ? [metric('sensitivity', 'Sensibilidad', options.sensitivityUnit || 'cps/MBq', options.minimumSensitivity, 'min')]
    : [metric('sensitivity', 'Sensibilidad', options.sensitivityUnit || 'cps/MBq', null), metric('deviation', '|Δ referencia|', '%', options.sensitivityTolerance)]
  if (type === 'cor') return [metric('deltaCorSingleMm', 'δCOR,1', 'mm', options.corLimit), metric('deltaCorPairMm', 'δCOR,12', 'mm', options.corLimit),
    metric('deltaAxialSingleMm', 'δAXIAL,1', 'mm', options.axialLimit), metric('deltaAxialPairMm', 'δAXIAL,12', 'mm', options.axialLimit)]
  if (type === 'tomography') return [metric('tomoUniformity', 'Uniformidad del protocolo', '%', options.tomoLimitPercent)]
  if (type === 'uniformity') {
    const profile = gammaUniformityProfile(options)
    return ['IUufov', 'IUcfov', 'DUvertUfov', 'DUhorizUfov', 'DUvertCfov', 'DUhorizCfov'].map(key => metric(key, key, '%',
      profile?.specs?.[key.startsWith('DU') ? (key.endsWith('Ufov') ? 'DUufov' : 'DUcfov') : key]))
  }
  return []
}
