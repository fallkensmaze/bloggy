import { evaluateGammaMetrics, monthlyCompleteness, monthlyVerdict } from './gammaReport.js'
import { numberOrNull } from './gammaDicom.js'

export const MONTHLY_REFERENCE_SOURCE = 'Informe mensual de referencia del servicio, agosto 2026. Límites locales a revisar para el colimador y protocolo utilizados.'
export const SENSITIVITY_REFERENCE_URL = 'https://www.siemens-healthineers.com/es/refurbished-systems-medical-imaging-and-therapy/ecoline-refurbished-systems/molecular-imaging-ecoline/symbia-intevo-eco'

// Explicit opt-in: limits only. Never copy measured results or acquisition declarations.
export function applyMonthlyReference(entry) {
  const o = { ...entry.options, verified: false, limitSource: MONTHLY_REFERENCE_SOURCE }
  if (entry.type === 'uniformity') o.uniformityProfile = 'symbia_intevo'
  if (entry.type === 'resolution') Object.assign(o, { fwhmLimit: '7.5', fwtmLimit: '13.6' })
  if (entry.type === 'cor') Object.assign(o, { corLimit: '1.2', axialLimit: '1.2' })
  if (entry.type === 'sensitivity') {
    Object.assign(o, { sensitivityComparison: 'minimum', sensitivityUnit: 'cpm/µCi', minimumSensitivity: '202',
      limitSource: `${MONTHLY_REFERENCE_SOURCE} Siemens Symbia: 202 cpm/µCi, LEHR a 10 cm. ${SENSITIVITY_REFERENCE_URL}` })
    // Old per-frame reference choices must not silently override the selected template.
    o.frameOptions = Object.fromEntries(Object.entries(o.frameOptions || {}).map(([i, value]) => [i,
      { ...value, sensitivityComparison: 'minimum', sensitivityUnit: 'cpm/µCi', minimumSensitivity: '202' }]))
  }
  return { ...entry, options: o, records: null, analysisError: '' }
}

export const metricValue = (record, key) => record?.metrics.find(m => m.key === key)?.value ?? null
export const metricByKey = (record, key) => record?.metrics.find(m => m.key === key)
export function sensitivityReportMetric(record) {
  const measured = metricByKey(record, 'sensitivity')
  if (measured) return measured
  return { key: 'sensitivity', value: null, unit: record?.inputs?.sensitivityUnit || 'cps/MBq', operator: 'min',
    limit: record?.inputs?.sensitivityComparison === 'minimum' ? numberOrNull(record.inputs.minimumSensitivity) : null }
}
const finiteMean = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : null
const unique = records => records.length === 1 ? records[0] : null

function recordSlot(record) {
  return `${record.type}:${record.detector ?? 'all'}:${record.type === 'resolution' ? record.axis || 'unknown' : ''}`
}

export function reportConflicts(records) {
  const slots = new Map()
  for (const r of records) { const key = recordSlot(r); slots.set(key, [...(slots.get(key) || []), r]) }
  return [...slots.values()].filter(rs => rs.length > 1).map(rs => ({
    type: rs[0].type, detector: rs[0].detector, axis: rs[0].axis,
    files: rs.map(r => ({ id: r.id, file: r.file, acquiredAt: r.acquiredAt })),
  }))
}

function uniformityCells(record) {
  const differential = (field, label) => {
    const a = metricByKey(record, `DUvert${field}`), b = metricByKey(record, `DUhoriz${field}`)
    return { key: label, label, value: Number.isFinite(a?.value) && Number.isFinite(b?.value) ? Math.max(a.value, b.value) : null,
      unit: '%', operator: 'max', limit: a?.limit != null && a.limit === b?.limit ? a.limit : null }
  }
  return [differential('Cfov', 'UDCC'), differential('Ufov', 'UDCT'),
    { ...metricByKey(record, 'IUcfov'), label: 'UICC' }, { ...metricByKey(record, 'IUufov'), label: 'UICT' }]
}

function resolutionRow(records, head, criterion) {
  const x = unique(records.filter(r => r.type === 'resolution' && r.detector === head && r.axis === 'X'))
  const y = unique(records.filter(r => r.type === 'resolution' && r.detector === head && r.axis === 'Y'))
  const widths = ['fwhm', 'fwtm'].map(key => {
    const a = metricByKey(x, key), b = metricByKey(y, key)
    return { key, label: key.toUpperCase(), x: a?.value, y: b?.value, value: finiteMean(a?.value, b?.value),
      limit: a?.limit != null && a.limit === b?.limit ? a.limit : null, unit: 'mm', operator: 'max' }
  })
  const evaluation = criterion === 'mean' ? evaluateGammaMetrics(widths, {
    verified: Boolean(x?.inputs?.verified && y?.inputs?.verified),
    protocol: x?.protocol?.trim() && y?.protocol?.trim() ? `${x.protocol}; ${y.protocol}` : '',
    limitSource: x?.limitSource?.trim() && y?.limitSource?.trim() ? `${x.limitSource}; ${y.limitSource}` : '',
    blocked: !x || !y || [x, y].some(r => r.status === 'No evaluable') ? 'Faltan medidas X/Y válidas y únicas.' : '',
  }) : { status: !x || !y ? 'No evaluable' : [x, y].some(r => r.status === 'No conforme') ? 'No conforme'
    : [x, y].every(r => r.status === 'Conforme') ? 'Conforme' : 'Pendiente de evaluación', reason: 'Comparación de cada eje con su límite.' }
  return { head, x, y, widths, ...evaluation }
}

export function buildMonthlyReport(entries, heads, resolutionCriterion = 'mean') {
  const included = entries.filter(e => e.included !== false)
  const records = included.flatMap(e => e.records || [])
  const conflicts = reportConflicts(records)
  const missing = monthlyCompleteness(records, heads)
  const resolution = heads.map(head => resolutionRow(records, head, resolutionCriterion))
  const states = [...records.filter(r => r.type !== 'resolution'), ...resolution]
  const pending = included.some(e => !e.records?.length || e.type === 'unknown') || conflicts.length > 0
  return {
    records, conflicts, missing, resolutionCriterion,
    verdict: monthlyVerdict(states, missing, pending),
    uniformity: heads.map(head => { const record = unique(records.filter(r => r.type === 'uniformity' && r.detector === head)); return { head, record, cells: uniformityCells(record) } }),
    resolution,
    sensitivity: heads.map(head => ({ head, record: unique(records.filter(r => r.type === 'sensitivity' && r.detector === head)) })),
    cor: unique(records.filter(r => r.type === 'cor')),
    tomography: unique(records.filter(r => r.type === 'tomography')),
    pendingFiles: included.filter(e => !e.records?.length).map(e => ({ file: e.name, reason: e.analysisError || e.error || 'Pendiente de análisis / clasificación' })),
    excluded: entries.filter(e => e.included === false).map(e => ({ file: e.name, type: e.type,
      acquiredAt: e.image?.metadata.acquiredAt, reason: e.exclusionReason || 'Sin motivo registrado' })),
  }
}
