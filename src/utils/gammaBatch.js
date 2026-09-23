import { parseDICOM } from './dicomParser.js'
import { parseCorDICOM } from './corDicom.js'
import { analyzeCor } from './corAnalysis.js'
import { calculateNemaGeometric, detectLimitProfile, getLimitProfile } from './nemaAlgorithms.js'
import { createAcquisitionDeclaration, evaluateAcquisition } from './nemaAcquisition.js'
import { analyzeResolution } from './gammaResolution.js'
import { analyzeSensitivity } from './gammaSensitivity.js'
import { numberOrNull } from './gammaDicom.js'
import { evaluateGammaMetrics } from './gammaReport.js'

export function initialGammaOptions(image) {
  return { acquiredAt: image.metadata.acquiredAt, activityAt: '', activityMBq: '', halfLifeHours: '',
    useResidual: false, residualMBq: '', residualAt: '', backgroundMode: '',
    backgroundCounts: '', backgroundSeconds: '', durationSeconds: '',
    axis: 'auto', stripPixels: 8, subtractBackground: false, rois: {}, frameOptions: {},
    fwhmLimit: '', fwtmLimit: '', referenceSensitivity: '', sensitivityTolerance: '',
    limitSource: '', protocol: '', verified: false, notes: '',
    uniformityProfile: 'auto', targetSize: 'auto', declaration: createAcquisitionDeclaration(),
    corLimit: '', axialLimit: '', tomoVerdict: '', tomoObservations: '' }
}

const metric = (key, label, value, unit, limit = null, operator = 'max') => ({ key, label, value, unit, limit: numberOrNull(limit), operator })

export function analyzeGammaEntry(entry) {
  const { image, options: o, type } = entry
  const base = { file: entry.name, type, equipment: image.metadata.equipment, acquiredAt: image.metadata.acquiredAt,
    methodVersion: 'gamma-qc-1.0', protocol: o.protocol, limitSource: o.limitSource, notes: o.notes,
    inputs: o, metadata: image.metadata }
  if (type === 'unknown') throw new Error('Selecciona el tipo de prueba antes del análisis.')
  if (type === 'tomography') {
    const ready = o.verified && o.protocol.trim() && o.tomoObservations.trim() && ['Conforme', 'No conforme'].includes(o.tomoVerdict)
    return [{ ...base, id: `${entry.id}:tomo`, detector: null, metrics: [], method: 'Revisión visual por el usuario',
      status: ready ? o.tomoVerdict : 'Pendiente de revisión', reason: ready ? o.tomoObservations : 'Requiere revisar los cortes, documentar el protocolo y firmar la valoración visual.',
      details: { observations: o.tomoObservations, frames: image.frames.length } }]
  }
  if (type === 'cor') {
    if (!image.hasCorGeometry) throw new Error('Faltan vectores de detector/vista o geometría de rotación DICOM. No se inventan ángulos en el informe mensual.')
    const result = analyzeCor(parseCorDICOM(entry.buffer))
    const metrics = [metric('deltaCorSingleMm', 'δCOR,1', result.upperBounds.deltaCorSingleMm, 'mm', o.corLimit),
      metric('deltaCorPairMm', 'δCOR,12', result.upperBounds.deltaCorPairMm, 'mm', o.corLimit),
      metric('deltaAxialSingleMm', 'δAXIAL,1', result.upperBounds.deltaAxialSingleMm, 'mm', o.axialLimit),
      metric('deltaAxialPairMm', 'δAXIAL,12', result.upperBounds.deltaAxialPairMm, 'mm', o.axialLimit)]
    const checks = result.acquisition.detectorChecks
    const fields = ['evenViews', 'enoughViews', 'uniformAngles', 'includesZero', 'includes180', 'enoughCountsAtZero', 'underMaximumCountRate']
    const valid = result.acquisition.pixelSizeUnder5Mm && checks.every(c => fields.every(k => c[k] === true))
    return [{ ...base, id: `${entry.id}:cor`, detector: null, detectors: result.detectors.map(d => d.detectorNumber), metrics,
      method: result.method, ...evaluateGammaMetrics(metrics, { ...o, blocked: valid ? '' : 'Revisa los requisitos de adquisición COR; hay comprobaciones incumplidas o desconocidas.' }),
      details: { acquisition: result.acquisition, roiSizeMm: result.roiSizeMm } }]
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
        const reference = numberOrNull(options.referenceSensitivity), tolerance = numberOrNull(options.sensitivityTolerance)
        if (reference != null && reference <= 0 || tolerance != null && tolerance < 0) throw new Error('Referencia y tolerancia de sensibilidad no válidas.')
        const deviation = reference > 0 ? 100 * Math.abs(result.sensitivity / reference - 1) : null
        const metrics = [metric('sensitivity', 'Sensibilidad', result.sensitivity, 'cps/MBq'),
          metric('deviation', '|Δ referencia|', deviation, '%', tolerance)]
        const evaluation = frame.detectorNumber != null && reference == null
          ? { status: 'Sin tolerancia', reason: 'Sensibilidad calculada. Introduce la referencia del cabezal y su tolerancia para compararla.' }
          : evaluateGammaMetrics([metrics[1]], { ...options, blocked: frame.detectorNumber == null ? 'Detector sin identificar.' : '' })
        return { ...record, method: result.method, metrics, ...evaluation, details: result }
      }
      const profile = o.uniformityProfile === 'auto' ? detectLimitProfile(parsed) : getLimitProfile(o.uniformityProfile)
      const result = calculateNemaGeometric(parsed.frames[i], parsed.rows, parsed.cols, {
        targetSize: o.targetSize === 'auto' ? null : Number(o.targetSize), pixelSpacingMm: parsed.pixelSpacing,
        ufovSizeMm: parsed.frameInfo[i].ufovSizeMm, vendorFovMm: profile.fovMm })
      const evaluation = evaluateAcquisition({ parsed, frame: parsed.frameInfo[i], result, profile, declaration: o.declaration })
      const metrics = ['IUufov', 'IUcfov', 'DUvertUfov', 'DUhorizUfov', 'DUvertCfov', 'DUhorizCfov'].map(key => metric(key, key,
        result[key], '%', profile.specs?.[key.replace('vert', '').replace('horiz', '')]))
      return { ...record, method: 'NEMA NU 1-2007 §2.4', metrics, status: evaluation.state, reason: evaluation.reason,
        limitSource: profile.source, details: { checks: evaluation.checks, methodVersion: result.metadata?.methodVersion,
          geometry: { pixelSizeMm: result.metadata?.pixelSpacingResampledMm, ufovSizeMm: result.metadata?.ufovSizeMm } } }
    } catch (e) {
      return { ...record, metrics: [], status: 'No evaluable', reason: e.message }
    }
  })
}
