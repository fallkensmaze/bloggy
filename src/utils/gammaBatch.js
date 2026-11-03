import { parseDICOM } from './dicomParser.js'
import { parseCorDICOM } from './corDicom.js'
import { assembleCorStops, groupCorStops, readCorStop } from './corStops.js'
import { analyzeCor, corAcquisitionValid } from './corAnalysis.js'
import { calculateNemaGeometric, detectLimitProfile } from './nemaAlgorithms.js'
import { createAcquisitionDeclaration, evaluateAcquisition } from './nemaAcquisition.js'
import { analyzeResolution } from './gammaResolution.js'
import { analyzeSensitivity, sensitivityInUnit } from './gammaSensitivity.js'
import { numberOrNull } from './gammaDicom.js'
import { evaluateGammaMetrics } from './gammaReport.js'
import { configuredGammaMetrics, gammaUniformityProfile } from './gammaQcLimits.js'

export function initialGammaOptions(image) {
  return { acquiredAt: image.metadata.acquiredAt, activityAt: '', activityMBq: '', halfLifeHours: '',
    useResidual: false, residualMBq: '', residualAt: '', backgroundMode: '',
    backgroundCounts: '', backgroundSeconds: '', durationSeconds: '',
    axis: 'auto', stripPixels: 8, subtractBackground: false, rois: {}, frameOptions: {},
    fwhmLimit: '', fwtmLimit: '', referenceSensitivity: '', sensitivityTolerance: '',
    sensitivityComparison: 'reference', sensitivityUnit: 'cps/MBq', minimumSensitivity: '',
    limitSource: '', protocol: '', verified: false, notes: '',
    uniformityProfile: 'auto', targetSize: 'auto', declaration: createAcquisitionDeclaration(),
    corDeclaration: {}, corStopGeometry: { angularStepDeg: '', rotationDirection: '', startAnglesDeg: {} }, corLimit: '', axialLimit: '', tomoVerdict: '', tomoObservations: '',
    tomoLimitPercent: '', tomoUniformityPercent: '', tomoUniformityDefinition: '' }
}

const metric = (key, label, value, unit, limit = null, operator = 'max') => ({ key, label, value, unit, limit: numberOrNull(limit), operator })

export function analyzeGammaEntry(entry) {
  const { image, options: o, type } = entry
  const base = { file: entry.name, type, equipment: image.metadata.equipment, acquiredAt: image.metadata.acquiredAt,
    methodVersion: 'gamma-qc-2.1', protocol: o.protocol, limitSource: o.limitSource, notes: o.notes,
    inputs: o, metadata: image.metadata }
  if (type === 'unknown') throw new Error('Selecciona el tipo de prueba antes del análisis.')
  if (type === 'tomography') {
    if (!image.imageType?.includes('RECON TOMO') || entry.tomoError) {
      return [{ ...base, id: `${entry.id}:tomo`, detector: null, metrics: [], status: 'No evaluable',
        reason: entry.tomoError || 'Selecciona una reconstrucción NM RECON TOMO; las proyecciones no son cortes espaciales.' }]
    }
    const value = numberOrNull(o.tomoUniformityPercent)
    const metrics = configuredGammaMetrics(type, o).map(m => ({ ...m, value: value != null && value >= 0 ? value : null }))
    const visualReady = o.verified && o.protocol.trim() && o.tomoObservations.trim() && ['Conforme', 'No conforme'].includes(o.tomoVerdict)
    const numerical = evaluateGammaMetrics(metrics, { ...o,
      blocked: o.tomoUniformityDefinition?.trim() ? '' : 'Registra la definición de la medida tomográfica a la que se aplica la tolerancia.' })
    const evaluation = visualReady && o.tomoVerdict === 'No conforme'
      ? { status: 'No conforme', reason: o.tomoObservations }
      : numerical.status === 'No conforme' ? numerical
        : !visualReady ? { status: 'Pendiente de revisión', reason: 'Requiere revisar los cortes, documentar el protocolo y firmar la valoración visual.' }
          : numerical
    return [{ ...base, id: `${entry.id}:tomo`, detector: null, metrics, method: 'Revisión visual y uniformidad del protocolo registrada por el usuario',
      ...evaluation, details: { observations: o.tomoObservations, definition: o.tomoUniformityDefinition,
        frames: image.frames.length, quantitative: entry.tomoQuantitative || null } }]
  }
  if (type === 'cor') {
    if (!entry.stopParts && !image.hasCorGeometry) throw new Error(image.imageType?.includes('TOMO')
      ? 'Faltan vectores de detector/vista o geometría de rotación DICOM. No se inventan ángulos en el informe mensual.'
      : 'Parada COR aislada: carga a la vez todas las paradas de la adquisición o el objeto multiframe.')
    const series = entry.stopParts ? corStopSeries(entry) : parseCorDICOM(entry.buffer)
    const result = analyzeCor(series)
    const metrics = [metric('deltaCorSingleMm', 'δCOR,1', result.upperBounds.deltaCorSingleMm, 'mm', o.corLimit),
      metric('deltaCorPairMm', 'δCOR,12', result.upperBounds.deltaCorPairMm, 'mm', o.corLimit),
      metric('deltaAxialSingleMm', 'δAXIAL,1', result.upperBounds.deltaAxialSingleMm, 'mm', o.axialLimit),
      metric('deltaAxialPairMm', 'δAXIAL,12', result.upperBounds.deltaAxialPairMm, 'mm', o.axialLimit)]
    const valid = corAcquisitionValid(result, o.corDeclaration)
    return [{ ...base, id: `${entry.id}:cor`, detector: null, detectors: result.detectors.map(d => d.detectorNumber), metrics,
      method: result.method, ...evaluateGammaMetrics(metrics, { ...o, blocked: valid ? '' : 'Revisa los requisitos de adquisición COR; hay comprobaciones incumplidas o desconocidas.' }),
      details: { acquisition: result.acquisition, declaration: o.corDeclaration, methodVersion: result.methodVersion, roiSizeMm: result.roiSizeMm, detectors: result.detectors,
        ...(entry.stopParts ? { stopGeometry: series.metadata.stopGeometry, stopFiles: series.metadata.stopFiles } : {}) } }]
  }
  const parsed = type === 'uniformity' ? parseDICOM(entry.buffer) : null
  return image.frames.map((_, i) => {
    const frame = image.frameInfo[i]
    const options = { ...o, ...o.frameOptions?.[i] }
    const record = { ...base, id: `${entry.id}:${i}`, detector: frame.detectorNumber, frameIndex: i,
      window: frame.energyWindowName, collimator: frame.collimator, frameMetadata: frame, inputs: options }
    try {
      if (type === 'resolution') {
        const result = analyzeResolution(image, i, { ...options, roi: o.rois[i] })
        const metrics = [metric('fwhm', 'FWHM', result.fwhmMm, 'mm', options.fwhmLimit), metric('fwtm', 'FWTM', result.fwtmMm, 'mm', options.fwtmLimit)]
        return { ...record, method: result.method, axis: result.axis, metrics,
          ...evaluateGammaMetrics(metrics, { ...options, blocked: frame.detectorNumber == null ? 'Detector sin identificar.' : '' }), details: result }
      }
      if (type === 'sensitivity') {
        if (options.acquiredAt?.slice(0, 7) !== image.metadata.acquiredAt.slice(0, 7)) throw new Error('El inicio de adquisición debe conservar el mes declarado en el DICOM.')
        const result = analyzeSensitivity(image, i, { ...options,
          durationSeconds: numberOrNull(options.durationSeconds) ?? frame.durationSeconds })
        const unit = options.sensitivityUnit || 'cps/MBq'
        const value = sensitivityInUnit(result.sensitivity, unit)
        if (options.sensitivityComparison === 'minimum') {
          const minimum = numberOrNull(options.minimumSensitivity)
          if (minimum != null && minimum <= 0) throw new Error('El límite mínimo de sensibilidad debe ser positivo.')
          const metrics = [metric('sensitivity', 'Sensibilidad', value, unit, minimum, 'min')]
          return { ...record, method: result.method, metrics,
            ...evaluateGammaMetrics(metrics, { ...options, blocked: frame.detectorNumber == null ? 'Detector sin identificar.' : '' }), details: result }
        }
        const reference = numberOrNull(options.referenceSensitivity), tolerance = numberOrNull(options.sensitivityTolerance)
        if (reference != null && reference <= 0 || tolerance != null && tolerance < 0) throw new Error('Referencia y tolerancia de sensibilidad no válidas.')
        const deviation = reference > 0 ? 100 * Math.abs(value / reference - 1) : null
        const metrics = [metric('sensitivity', 'Sensibilidad', value, unit),
          metric('deviation', '|Δ referencia|', deviation, '%', tolerance)]
        const evaluation = frame.detectorNumber != null && reference == null
          ? { status: 'Sin tolerancia', reason: 'Sensibilidad calculada. Introduce la referencia del cabezal y su tolerancia para compararla.' }
          : evaluateGammaMetrics([metrics[1]], { ...options, blocked: frame.detectorNumber == null ? 'Detector sin identificar.' : '' })
        return { ...record, method: result.method, metrics, ...evaluation, details: result }
      }
      const profile = gammaUniformityProfile(o, detectLimitProfile(parsed))
      const result = calculateNemaGeometric(parsed.frames[i], parsed.rows, parsed.cols, {
        targetSize: o.targetSize === 'auto' ? null : Number(o.targetSize), pixelSpacingMm: parsed.pixelSpacing,
        ufovSizeMm: parsed.frameInfo[i].ufovSizeMm, vendorFovMm: profile.fovMm })
      const evaluation = evaluateAcquisition({ parsed, frame: parsed.frameInfo[i], result, profile, declaration: o.declaration })
      const metrics = ['IUufov', 'IUcfov', 'DUvertUfov', 'DUhorizUfov', 'DUvertCfov', 'DUhorizCfov'].map(key => metric(key, key,
        result[key], '%', profile.specs?.[key.startsWith('DU') ? (key.endsWith('Ufov') ? 'DUufov' : 'DUcfov') : key]))
      return { ...record, method: 'NEMA NU 1-2007 §2.4', metrics, status: evaluation.state, reason: evaluation.reason,
        limitSource: profile.source, details: { checks: evaluation.checks, methodVersion: result.metadata?.methodVersion,
          geometry: { pixelSizeMm: result.metadata?.pixelSpacingResampledMm, ufovSizeMm: result.metadata?.ufovSizeMm } } }
    } catch (e) {
      return { ...record, metrics: configuredGammaMetrics(type, options), status: 'No evaluable', reason: e.message }
    }
  })
}

/** Series of a merged per-stop COR entry, with the step/direction declared for that entry only. */
export function corStopSeries(entry) {
  const stops = entry.corStopData || entry.stopParts.map(p => readCorStop(p.buffer, p.name))
  return assembleCorStops(stops, entry.options?.corStopGeometry)
}

const isCorStopPart = e => e.type === 'cor' && e.image && e.buffer && !e.stopParts && !e.image.hasCorGeometry && !e.image.imageType?.includes('TOMO')

/**
 * Per-stop COR files (one NM file per gantry position) become ONE monthly entry per series.
 * Previously merged entries are expanded again so that stops added later join their series;
 * the merged entry starts with fresh options (declarations are never inherited).
 * A group that is not a complete, consistent set stays as a visible error: nothing is split or dropped.
 */
export function mergeCorStopEntries(entries, finalize = entry => entry) {
  const parts = [], slots = []
  for (const e of entries) {
    if (e.stopParts) { parts.push(...e.stopParts); slots.push(null) }
    else if (isCorStopPart(e)) { parts.push({ id: e.id, name: e.name, buffer: e.buffer, image: e.image }); slots.push(null) }
    else slots.push(e)
  }
  if (!parts.length) return entries
  const groups = new Map()
  for (const part of parts) {
    let key = `file:${part.id}`
    try { key = readCorStop(part.buffer, part.name).seriesUid || key } catch { /* reported when the group is built */ }
    groups.set(key, [...(groups.get(key) || []), part])
  }
  const merged = [...groups.values()].map(group => {
    const id = group[0].id
    try {
      const stops = group.map(p => ({ ...readCorStop(p.buffer, p.name), part: p }))
      const ordered = groupCorStops(stops)
      const stopParts = ordered.stops.map(s => s.part)
      const first = stopParts[0].image
      const frames = [], frameInfo = []
      for (const detectorNumber of ordered.heads) for (const stop of ordered.stops) {
        const head = stop.heads.find(h => h.detectorNumber === detectorNumber)
        frames.push(stop.part.image.frames[head.frameIndex])
        frameInfo.push({ ...stop.part.image.frameInfo[head.frameIndex], frameIndex: frameInfo.length,
          view: `parada ${stop.viewNumber}/${ordered.count}`, sourceFile: stop.name })
      }
      const image = { ...first, frames, frameInfo, hasCorGeometry: false, instanceUids: stopParts.map(p => p.image.instanceUid),
        corStops: { count: ordered.count, heads: ordered.heads, startAnglesDeg: ordered.startAnglesDeg,
          suggestedFullRotationStepDeg: ordered.suggestedFullRotationStepDeg, files: stopParts.map(p => p.name) } }
      const corStopData = ordered.stops.map(({ part, ...stop }) => stop)
      return finalize({ id, name: `${first.metadata.description || 'COR'} · ${ordered.count} paradas`, buffer: null, stopParts, corStopData, image,
        type: 'cor', included: true, exclusionReason: '', options: initialGammaOptions(image), records: null })
    } catch (error) {
      return { id, name: `COR por paradas · ${group.length} archivo${group.length === 1 ? '' : 's'}`, error: error.message,
        type: 'cor', included: true, stopParts: group }
    }
  })
  const out = []
  let inserted = false
  for (const slot of slots) {
    if (slot) out.push(slot)
    else if (!inserted) { out.push(...merged); inserted = true }
  }
  return out
}
