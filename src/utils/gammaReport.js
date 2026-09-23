import { numberOrNull } from './gammaDicom.js'

export const GAMMA_TESTS = { resolution: 'Resolución espacial', sensitivity: 'Sensibilidad',
  uniformity: 'Uniformidad NEMA', cor: 'Centro de rotación', tomography: 'Reconstrucción tomográfica', unknown: 'Sin clasificar' }

/** The batch is one camera and one acquisition month. Never silently split or discard files. */
export function validateMonthlyBatch(entries) {
  const errors = []
  if (!entries.length) errors.push('Carga los DICOM del mes.')
  const months = new Set(), identities = new Set(), seen = new Set()
  for (const entry of entries) {
    if (entry.error || !entry.image) { errors.push(`${entry.name}: ${entry.error || 'DICOM no leído'}`); continue }
    const m = entry.image.metadata
    if (!/^\d{4}-\d{2}-\d{2}/.test(m.acquiredAt)) errors.push(`${entry.name}: falta una fecha de adquisición válida.`)
    else months.add(m.acquiredAt.slice(0, 7))
    // Strict composite identity: a missing serial/station in part of the batch is a mismatch too.
    // Model alone is NOT a unique camera identifier. Whitespace/case are immaterial.
    const normalize = value => String(value || '').trim().toUpperCase().replace(/\s+/g, ' ')
    if (!m.station && !m.serial) errors.push(`${entry.name}: falta StationName y DeviceSerialNumber; no se puede verificar la gammacámara.`)
    else identities.add(JSON.stringify([normalize(m.station), normalize(m.serial), normalize(m.model)]))
    const uid = entry.image.instanceUid
    if (uid && seen.has(uid)) errors.push(`${entry.name}: SOPInstanceUID duplicado; retira la copia.`)
    if (uid) seen.add(uid)
  }
  if (months.size > 1) errors.push(`Hay adquisiciones de meses distintos: ${[...months].join(', ')}.`)
  if (identities.size > 1) errors.push('Los identificadores DICOM no corresponden a una única gammacámara.')
  return { valid: errors.length === 0, errors, month: months.size === 1 ? [...months][0] : '',
    equipment: entries[0]?.image?.metadata.equipment || '' }
}

export function evaluateGammaMetrics(metrics, { verified = false, limitSource = '', protocol = '', blocked = '' } = {}) {
  if (blocked) return { status: 'No evaluable', reason: blocked }
  if (!metrics.length || metrics.some(m => !Number.isFinite(m.value))) return { status: 'No evaluable', reason: 'Faltan medidas válidas.' }
  const evaluated = metrics.filter(m => numberOrNull(m.limit) != null && Number(m.limit) >= 0)
  if (evaluated.some(m => m.operator === 'min' ? m.value < Number(m.limit) : m.value > Number(m.limit))) {
    return { status: 'No conforme', reason: 'Se supera al menos una tolerancia configurada.' }
  }
  if (evaluated.length !== metrics.length || !limitSource.trim()) return { status: 'Sin tolerancia', reason: 'Completa las tolerancias y su procedencia para emitir conformidad.' }
  if (!verified || !protocol.trim()) return { status: 'Adquisición no verificada', reason: 'Revisa las condiciones de adquisición y documenta el protocolo de comparación.' }
  return { status: 'Conforme', reason: 'Dentro de las tolerancias indicadas y adquisición verificada por el usuario.' }
}

export function monthlyCompleteness(records, detectorNumbers, requireTomography = true) {
  const missing = []
  for (const detector of detectorNumbers) {
    for (const type of ['uniformity', 'sensitivity']) {
      if (!records.some(r => r.type === type && r.detector === detector)) missing.push(`${GAMMA_TESTS[type]} · cabezal ${detector}`)
    }
    for (const axis of ['X', 'Y']) if (!records.some(r => r.type === 'resolution' && r.detector === detector && r.axis === axis)) {
      missing.push(`Resolución ${axis} · cabezal ${detector}`)
    }
    if (!records.some(r => r.type === 'cor' && r.detectors?.includes(detector))) missing.push(`COR · cabezal ${detector}`)
  }
  if (requireTomography && !records.some(r => r.type === 'tomography')) missing.push('Reconstrucción tomográfica')
  return missing
}

export function monthlyVerdict(records, missing, pendingFiles = false) {
  if (missing.length || pendingFiles || !records.length) return 'Informe incompleto'
  if (records.some(r => r.status === 'No conforme')) return 'No conforme'
  if (records.some(r => r.status !== 'Conforme')) return 'Pendiente de evaluación'
  return 'Conforme según el protocolo registrado'
}

export function tomographyPrompt({ metadata }, frameNumbers) {
  return `Revisión orientativa de control de calidad de una reconstrucción tomográfica de gammacámara.\n`
    + `Imagen: mosaico de los frames ${frameNumbers.join(', ')}. No presupongas orientación anatómica: son índices de la matriz DICOM.\n`
    + `Describe únicamente hallazgos visibles (anillos, defectos focales, heterogeneidad, truncamiento y otros artefactos), indicando incertidumbres. `
    + `Pregunta por fantoma, actividad, colimador, órbita, matriz, reconstrucción, filtro y correcciones cuando hagan falta. `
    + `No inventes FWHM, uniformidad, contraste ni tolerancias a partir de la imagen de pantalla. `
    + `No emitas un veredicto de aptitud clínica. Separa observaciones, posibles causas y comprobaciones propuestas. `
    + `El resultado será revisado por un especialista en Radiofísica.\nRadionucleido declarado: ${metadata.radionuclide || 'sin dato'}.`
}
