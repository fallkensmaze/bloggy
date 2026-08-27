// Separates three things the uniformity page used to conflate into a single
// green badge: the NEMA number, the validity of the acquisition that produced
// it, and the comparison against the acceptance limits of a given camera.
//
// A value inside the Siemens limits is not "Conforme" if the flood was taken at
// 40 000 cps, or with a collimator on, or with a pixel that is not square: NEMA
// NU 1-2007 states acquisition conditions, and a number measured outside them
// is not a NEMA result at all. Equally, a number that cannot be checked against
// anything is not a failure - it is simply unverified, and says so.

export const NEMA_MIN_COUNTS = 10000
export const NEMA_MAX_COUNT_RATE_CPS = 20000
export const NEMA_PIXEL_RANGE_MM = [4.48, 8.32]
export const NEMA_SOURCE_DISTANCE_FACTOR = 5

// Attributable to the rounding DICOM applies when it stores PixelSpacing as a
// decimal string. It is a tolerance of this implementation, not of NEMA, which
// simply requires square pixels.
export const PIXEL_SQUARE_TOLERANCE = 0.005

export const STATES = {
  CONFORME: 'Conforme',
  NO_CONFORME: 'No conforme',
  NO_EVALUABLE: 'No evaluable',
  NO_VERIFICADA: 'Conforme numericamente, adquisicion no verificada'
}

const OK = 'ok'
const FAIL = 'fail'
const UNKNOWN = 'unknown'
const INFO = 'info'

function check(id, label, status, value, detail, kind = 'acquisition') {
  return { id, label, status, value, detail, kind }
}

function isBlank(value) {
  return value == null || String(value).trim() === ''
}

function toNumber(value) {
  if (value == null) return Number.NaN
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function squarePixelCheck(pixelSpacing) {
  if (!pixelSpacing || pixelSpacing.length < 2) {
    return check(
      'square_pixel',
      'Pixel cuadrado',
      UNKNOWN,
      'Sin PixelSpacing',
      'El DICOM no declara PixelSpacing, asi que no se puede comprobar ni convertir a milimetros.',
      'blocking'
    )
  }

  const [rowMm, colMm] = pixelSpacing
  const largest = Math.max(rowMm, colMm)
  const deviation = Math.abs(rowMm - colMm) / largest
  const square = deviation <= PIXEL_SQUARE_TOLERANCE

  return check(
    'square_pixel',
    'Pixel cuadrado',
    square ? OK : FAIL,
    `${rowMm.toFixed(3)} x ${colMm.toFixed(3)} mm`,
    square
      ? `Desviacion ${(deviation * 100).toFixed(2)} %, dentro del ${(PIXEL_SQUARE_TOLERANCE * 100).toFixed(1)} % atribuible al redondeo DICOM (tolerancia de esta herramienta, no de NEMA).`
      : `Desviacion ${(deviation * 100).toFixed(2)} %: el pixel no es cuadrado y el analisis NEMA no es aplicable.`,
    'blocking'
  )
}

function effectivePixelCheck(metadata) {
  const tolerance = metadata?.pixelTolerance
  if (!tolerance) {
    return check(
      'effective_pixel',
      'Pixel efectivo 6,4 mm +-30 %',
      UNKNOWN,
      'Sin dato',
      'Sin PixelSpacing no se puede saber el tamano fisico del pixel de analisis.',
      'blocking'
    )
  }

  const [rowMm, colMm] = tolerance.finalPixel
  const value = `${rowMm.toFixed(2)} x ${colMm.toFixed(2)} mm`
  const detail = `Intervalo NEMA ${NEMA_PIXEL_RANGE_MM[0]}-${NEMA_PIXEL_RANGE_MM[1]} mm.`

  if (!tolerance.square) {
    return check('effective_pixel', 'Pixel efectivo 6,4 mm +-30 %', FAIL, value,
      `${detail} El pixel de analisis no es cuadrado.`, 'blocking')
  }

  return check(
    'effective_pixel',
    'Pixel efectivo 6,4 mm +-30 %',
    tolerance.insideTolerance ? OK : FAIL,
    value,
    detail,
    'blocking'
  )
}

function countsCheck(metadata) {
  const center = metadata?.centerCountResampled
  const max = metadata?.maxCountCfov

  if (!Number.isFinite(center)) {
    return check('counts', 'Cuentas por pixel', UNKNOWN, 'Sin dato', 'No se pudo medir el pixel central.')
  }

  const ok = center >= NEMA_MIN_COUNTS
  return check(
    'counts',
    'Cuentas por pixel',
    ok ? OK : FAIL,
    `${Math.round(center).toLocaleString('es-ES')} en el centro`,
    `Maximo del CFOV ${Math.round(max || 0).toLocaleString('es-ES')}. NEMA pide al menos `
    + `${NEMA_MIN_COUNTS.toLocaleString('es-ES')} cuentas por pixel tras la suma.`
  )
}

function countRateCheck(parsed, frameCounts, declaration) {
  const durationSeconds = Number.isFinite(parsed?.actualFrameDurationMs)
    ? parsed.actualFrameDurationMs / 1000
    : Number.NaN
  const declared = toNumber(declaration?.countRateCps)

  let cps = Number.NaN
  let origin = ''
  if (Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(frameCounts)) {
    cps = frameCounts / durationSeconds
    origin = `${frameCounts.toLocaleString('es-ES')} cuentas en ${durationSeconds.toFixed(0)} s (ActualFrameDuration).`
  } else if (Number.isFinite(declared)) {
    cps = declared
    origin = 'Valor declarado manualmente.'
  }

  if (!Number.isFinite(cps)) {
    return check('count_rate', 'Tasa de cuentas', UNKNOWN, 'Sin dato',
      'No hay una duracion fiable en el DICOM ni una tasa declarada.')
  }

  return check(
    'count_rate',
    'Tasa de cuentas',
    cps <= NEMA_MAX_COUNT_RATE_CPS ? OK : FAIL,
    `${Math.round(cps).toLocaleString('es-ES')} cps`,
    `${origin} NEMA limita a ${NEMA_MAX_COUNT_RATE_CPS.toLocaleString('es-ES')} cps.`
  )
}

function collimatorCheck(frame, declaration) {
  const type = (frame?.collimatorType || '').toUpperCase()

  if (type === 'NONE') {
    return check('collimator', 'Colimador', OK, 'NONE',
      'El DICOM confirma adquisicion intrinseca, sin colimador.')
  }
  if (type) {
    return check('collimator', 'Colimador', FAIL, type,
      'La uniformidad intrinseca se mide sin colimador.')
  }
  if (declaration?.collimatorRemoved === 'si') {
    return check('collimator', 'Colimador', OK, 'Retirado (declarado)',
      'El DICOM no lo indica; confirmado por el fisico.')
  }
  if (declaration?.collimatorRemoved === 'no') {
    return check('collimator', 'Colimador', FAIL, 'Montado (declarado)',
      'La uniformidad intrinseca se mide sin colimador.')
  }
  return check('collimator', 'Colimador', UNKNOWN, 'Sin dato',
    'Ni el DICOM ni la declaracion indican si habia colimador.')
}

function sourceDistanceCheck(ufovSizeMm, declaration) {
  const largestMm = Array.isArray(ufovSizeMm) ? Math.max(...ufovSizeMm) : Number.NaN
  const requiredCm = Number.isFinite(largestMm)
    ? largestMm * NEMA_SOURCE_DISTANCE_FACTOR / 10
    : Number.NaN
  const declared = toNumber(declaration?.sourceDistanceCm)
  const requiredText = Number.isFinite(requiredCm)
    ? `Minimo ${requiredCm.toFixed(0)} cm (5 x ${largestMm.toFixed(0)} mm del UFOV).`
    : 'No se conoce la dimension mayor del UFOV.'

  if (!Number.isFinite(declared)) {
    if (declaration?.distanceConfirmed) {
      return check('source_distance', 'Distancia fuente-detector', OK, 'Confirmada',
        `${requiredText} Confirmada por el fisico sin anotar el valor.`)
    }
    return check('source_distance', 'Distancia fuente-detector', UNKNOWN, 'Sin dato', requiredText)
  }

  if (!Number.isFinite(requiredCm)) {
    return check('source_distance', 'Distancia fuente-detector', UNKNOWN, `${declared} cm`, requiredText)
  }

  return check(
    'source_distance',
    'Distancia fuente-detector',
    declared >= requiredCm ? OK : FAIL,
    `${declared} cm`,
    requiredText
  )
}

function uniformityCorrectionCheck(parsed, declaration) {
  const corrections = Array.isArray(parsed?.correctedImage) ? parsed.correctedImage : []
  const unique = [...new Set(corrections.map((item) => item.toUpperCase()))]

  if (unique.length) {
    return check('corrections', 'Correcciones aplicadas', INFO, unique.join(', '),
      'Tomado de CorrectedImage. Anota en el informe si el estado esperado es otro.')
  }
  if (!isBlank(declaration?.uniformityCorrection)) {
    return check('corrections', 'Correcciones aplicadas', INFO, declaration.uniformityCorrection,
      'Declarado por el fisico; el DICOM no lo indica.')
  }
  return check('corrections', 'Correcciones aplicadas', UNKNOWN, 'Sin dato',
    'El DICOM no trae CorrectedImage y no se ha declarado.')
}

function limitRows(result, specs) {
  const duUfov = Math.max(result.DUvertUfov, result.DUhorizUfov)
  const duCfov = Math.max(result.DUvertCfov, result.DUhorizCfov)

  return [
    { id: 'IUufov', label: 'IU UFOV', value: result.IUufov, limit: specs.IUufov },
    { id: 'IUcfov', label: 'IU CFOV', value: result.IUcfov, limit: specs.IUcfov },
    { id: 'DUufov', label: 'DU UFOV', value: duUfov, limit: specs.DUufov },
    { id: 'DUcfov', label: 'DU CFOV', value: duCfov, limit: specs.DUcfov }
  ]
}

export function evaluateAcquisition({ parsed, frame, result, profile, declaration = {} }) {
  const checks = []
  const metadata = result?.metadata || {}

  checks.push(check(
    'modality',
    'Modalidad',
    parsed?.modality === 'NM' ? OK : FAIL,
    parsed?.modality || 'Sin dato',
    'NEMA NU 1 se aplica a imagenes de medicina nuclear planar.',
    'blocking'
  ))

  checks.push(check(
    'transfer_syntax',
    'Transfer syntax',
    OK,
    parsed?.transferSyntaxUID || 'Implicit VR Little Endian',
    'Sin comprimir: los pixeles se leen de forma nativa.',
    'blocking'
  ))

  const shape = frame?.fovShape || parsed?.fovShape || ''
  checks.push(check(
    'fov_shape',
    'Forma del FOV',
    shape === 'RECTANGLE' ? OK : (shape ? FAIL : UNKNOWN),
    shape || 'Sin dato',
    shape === 'RECTANGLE'
      ? 'Geometria rectangular, la que implementa esta herramienta.'
      : 'Solo se soporta RECTANGLE; otras formas no son evaluables aqui.',
    'blocking'
  ))

  checks.push(check(
    'frame_identified',
    'Frame identificado',
    frame?.detectorKnown ? OK : UNKNOWN,
    frame?.detectorNumber != null ? `Detector ${frame.detectorNumber}` : 'Sin identificar',
    frame?.energyWindowName
      ? `Ventana ${frame.energyWindowName} (${frame.energyWindowLowerLimit.toFixed(1)}-${frame.energyWindowUpperLimit.toFixed(1)} keV).`
      : 'No se ha podido asociar el frame a un detector y una ventana energetica.'
  ))

  checks.push(squarePixelCheck(parsed?.pixelSpacing))
  checks.push(effectivePixelCheck(metadata))
  checks.push(countsCheck(metadata))
  checks.push(countRateCheck(parsed, frame?.totalCounts, declaration))
  checks.push(collimatorCheck(frame, declaration))
  checks.push(sourceDistanceCheck(frame?.ufovSizeMm || parsed?.ufovSizeMm, declaration))
  checks.push(uniformityCorrectionCheck(parsed, declaration))

  const radionuclide = parsed?.radionuclide || declaration?.radionuclide
  checks.push(check(
    'radionuclide',
    'Radionucleido',
    isBlank(radionuclide) ? UNKNOWN : INFO,
    isBlank(radionuclide) ? 'Sin dato' : radionuclide,
    parsed?.radionuclide ? 'Tomado del DICOM.' : 'Declarado por el fisico.'
  ))

  if (!isBlank(declaration?.deviations)) {
    checks.push(check('deviations', 'Desviaciones del procedimiento', INFO,
      declaration.deviations, 'Anotado por el fisico.'))
  }

  const blocking = checks.filter((item) => item.kind === 'blocking')
  const acquisition = checks.filter((item) => item.kind === 'acquisition')
  const blockingFailed = blocking.filter((item) => item.status === FAIL || item.status === UNKNOWN)
  const acquisitionFailed = acquisition.filter((item) => item.status === FAIL)
  const acquisitionUnknown = acquisition.filter((item) => item.status === UNKNOWN)

  const specs = profile?.specs || null
  const comparison = specs && result?.available ? limitRows(result, specs) : []
  const exceeded = comparison.filter((row) => Number.isFinite(row.value) && row.value > row.limit)

  let state
  let reason

  if (!result?.available) {
    state = STATES.NO_EVALUABLE
    reason = result?.error || 'El calculo no ha podido completarse.'
  } else if (blockingFailed.length) {
    state = STATES.NO_EVALUABLE
    reason = `No se cumplen las condiciones basicas del analisis: ${blockingFailed.map((item) => item.label.toLowerCase()).join(', ')}.`
  } else if (acquisitionFailed.length) {
    state = STATES.NO_EVALUABLE
    reason = `La adquisicion incumple requisitos de NEMA NU 1: ${acquisitionFailed.map((item) => item.label.toLowerCase()).join(', ')}. El numero se calcula, pero no es un resultado NEMA valido.`
  } else if (!specs) {
    state = STATES.NO_EVALUABLE
    reason = 'No hay un perfil de limites aplicable a este equipo: se informan los valores NEMA sin veredicto de conformidad.'
  } else if (exceeded.length) {
    state = STATES.NO_CONFORME
    reason = `Fuera de limites: ${exceeded.map((row) => row.label).join(', ')}.`
  } else if (acquisitionUnknown.length) {
    state = STATES.NO_VERIFICADA
    reason = `Dentro de limites, pero quedan datos de adquisicion sin verificar: ${acquisitionUnknown.map((item) => item.label.toLowerCase()).join(', ')}.`
  } else {
    state = STATES.CONFORME
    reason = 'Dentro de limites y con la adquisicion verificada.'
  }

  return {
    checks,
    comparison,
    exceeded,
    state,
    reason,
    profile: profile || null,
    numericallyWithinLimits: Boolean(specs) && exceeded.length === 0
  }
}
