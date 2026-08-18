const LN2 = Math.log(2)

export const F18_HALF_LIFE_MINUTES = 110

export const DEFAULT_PET_NEMA_CONFIG = {
  backgroundConcentrationKbqMl: 5.3,
  firstSphereToBackgroundRatio: 8,
  phantomVolumeMl: 9700,
  cylinderDiameterCm: 5.1,
  cylinderLengthCm: 18,
  sphereDiametersCm: [3.7, 2.8, 2.2, 1.7, 1.3, 1.0],
  sphereStockVolumeMl: 500,
  linearSourceActivityAtFirstAcquisitionMbq: 116,
  linearSourceVolumeMl: 5.5,
  halfLifeMinutes: F18_HALF_LIFE_MINUTES
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function date(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function minutesBetween(from, to) {
  const fromDate = date(from)
  const toDate = date(to)
  if (!fromDate || !toDate) return Number.NaN
  return (toDate - fromDate) / 60000
}

function addMinutes(value, minutes) {
  const parsed = date(value)
  if (!parsed) return null
  return new Date(parsed.getTime() + number(minutes) * 60000)
}

export function sphereVolumeMl(diameterCm) {
  const diameter = number(diameterCm)
  return (4 * Math.PI * Math.pow(diameter / 2, 3)) / 3
}

export function cylinderVolumeMl(diameterCm, lengthCm) {
  const diameter = number(diameterCm)
  return Math.PI * Math.pow(diameter / 2, 2) * number(lengthCm)
}

export function decayFactor(elapsedMinutes, halfLifeMinutes = F18_HALF_LIFE_MINUTES) {
  const halfLife = number(halfLifeMinutes)
  const elapsed = Number(elapsedMinutes)
  if (halfLife <= 0 || !Number.isFinite(elapsed)) return Number.NaN
  return Math.exp((-LN2 * elapsed) / halfLife)
}

export function activityAtTime(activityMbq, measuredAt, targetTime, halfLifeMinutes = F18_HALF_LIFE_MINUTES) {
  return number(activityMbq) * decayFactor(minutesBetween(measuredAt, targetTime), halfLifeMinutes)
}

export function activityNeededAtPreparation(
  activityAtTargetMbq,
  preparationTime,
  targetTime,
  halfLifeMinutes = F18_HALF_LIFE_MINUTES
) {
  return number(activityAtTargetMbq) / decayFactor(minutesBetween(preparationTime, targetTime), halfLifeMinutes)
}

export function calculatePhantomGeometry(config = {}) {
  const values = { ...DEFAULT_PET_NEMA_CONFIG, ...config }
  const sphereVolumesMl = values.sphereDiametersCm.map(sphereVolumeMl)
  const spheresVolumeMl = sphereVolumesMl.reduce((sum, volume) => sum + volume, 0)
  const cylinderInsertVolumeMl = cylinderVolumeMl(values.cylinderDiameterCm, values.cylinderLengthCm)
  const backgroundVolumeMl = number(values.phantomVolumeMl) - spheresVolumeMl - cylinderInsertVolumeMl

  return {
    sphereVolumesMl,
    spheresVolumeMl,
    largeSpheresVolumeMl: sphereVolumesMl.slice(0, 2).reduce((sum, volume) => sum + volume, 0),
    smallSpheresVolumeMl: sphereVolumesMl.slice(2).reduce((sum, volume) => sum + volume, 0),
    cylinderInsertVolumeMl,
    backgroundVolumeMl
  }
}

export function calculatePetNemaPlan(config = {}) {
  const values = { ...DEFAULT_PET_NEMA_CONFIG, ...config }
  const geometry = calculatePhantomGeometry(values)
  const halfLifeMinutes = number(values.halfLifeMinutes, F18_HALF_LIFE_MINUTES)
  const firstAcquisitionTime = date(values.firstAcquisitionTime)
  const secondAcquisitionTime = addMinutes(firstAcquisitionTime, halfLifeMinutes)

  const backgroundActivityAtAcquisitionMbq =
    number(values.backgroundConcentrationKbqMl) * geometry.backgroundVolumeMl / 1000
  const backgroundFraction1AtSecondAcquisitionMbq = activityAtTime(
    backgroundActivityAtAcquisitionMbq,
    firstAcquisitionTime,
    secondAcquisitionTime,
    halfLifeMinutes
  )
  const backgroundFraction2AtSecondAcquisitionMbq =
    backgroundActivityAtAcquisitionMbq - backgroundFraction1AtSecondAcquisitionMbq

  const firstSphereConcentrationKbqMl =
    number(values.backgroundConcentrationKbqMl) * number(values.firstSphereToBackgroundRatio)
  const sphereStockActivityAtFirstAcquisitionMbq =
    firstSphereConcentrationKbqMl * number(values.sphereStockVolumeMl) / 1000
  const sphereStockAtSecondAcquisitionMbq = activityAtTime(
    sphereStockActivityAtFirstAcquisitionMbq,
    firstAcquisitionTime,
    secondAcquisitionTime,
    halfLifeMinutes
  )
  const backgroundAtSecondAcquisitionMbq =
    backgroundFraction1AtSecondAcquisitionMbq + backgroundFraction2AtSecondAcquisitionMbq
  const backgroundConcentrationAtSecondAcquisitionKbqMl =
    backgroundAtSecondAcquisitionMbq / geometry.backgroundVolumeMl * 1000
  const sphereConcentrationAtSecondAcquisitionKbqMl =
    sphereStockAtSecondAcquisitionMbq / number(values.sphereStockVolumeMl) * 1000

  const warnings = []
  if (!firstAcquisitionTime) {
    warnings.push('Introduce una hora valida para la primera adquisicion.')
  }
  if (geometry.backgroundVolumeMl <= 0) {
    warnings.push('El volumen de fondo calculado debe ser mayor que cero.')
  }

  return {
    values,
    geometry,
    firstAcquisitionTime,
    secondAcquisitionTime,
    warnings,
    backgroundActivityAtAcquisitionMbq,
    backgroundFraction1AtSecondAcquisitionMbq,
    backgroundFraction2AtSecondAcquisitionMbq,
    firstSphereConcentrationKbqMl,
    sphereStockActivityAtFirstAcquisitionMbq,
    sphereStockAtSecondAcquisitionMbq,
    backgroundAtSecondAcquisitionMbq,
    backgroundConcentrationAtSecondAcquisitionKbqMl,
    sphereConcentrationAtSecondAcquisitionKbqMl,
    expectedFirstRatio:
      firstSphereConcentrationKbqMl / number(values.backgroundConcentrationKbqMl),
    expectedSecondRatio:
      sphereConcentrationAtSecondAcquisitionKbqMl /
      backgroundConcentrationAtSecondAcquisitionKbqMl,
    linearSourceConcentrationKbqMl:
      number(values.linearSourceActivityAtFirstAcquisitionMbq) /
      number(values.linearSourceVolumeMl) * 1000
  }
}

export function calculatePetNemaPreparations(plan, preparationTime) {
  const preparedAt = date(preparationTime)
  const halfLifeMinutes = plan.values.halfLifeMinutes
  const preparations = [
    {
      id: 'background-f1',
      label: 'Fondo F1',
      description: 'Usar en el fondo para la primera adquisicion.',
      targetActivityMbq: plan.backgroundActivityAtAcquisitionMbq,
      targetTime: plan.firstAcquisitionTime
    },
    {
      id: 'background-f2',
      label: 'Fondo F2',
      description: 'Reservar y anadir despues de la primera adquisicion.',
      targetActivityMbq: plan.backgroundFraction2AtSecondAcquisitionMbq,
      targetTime: plan.secondAcquisitionTime
    },
    {
      id: 'sphere-stock',
      label: 'Disolucion esferas',
      description: `${number(plan.values.sphereStockVolumeMl)} ml para el ratio inicial 8:1.`,
      targetActivityMbq: plan.sphereStockActivityAtFirstAcquisitionMbq,
      targetTime: plan.firstAcquisitionTime
    },
    {
      id: 'linear-source',
      label: 'Fuente lineal',
      description: `${number(plan.values.linearSourceVolumeMl)} ml. Preparacion opcional.`,
      targetActivityMbq: number(plan.values.linearSourceActivityAtFirstAcquisitionMbq),
      targetTime: plan.firstAcquisitionTime,
      optional: true
    }
  ]

  return preparations.map((preparation) => ({
    ...preparation,
    activityMbq: activityNeededAtPreparation(
      preparation.targetActivityMbq,
      preparedAt,
      preparation.targetTime,
      halfLifeMinutes
    ),
    overdue: Boolean(preparedAt && preparation.targetTime && preparedAt > preparation.targetTime)
  }))
}

export function calculatePetNemaMeasurementProjection({
  targetActivityMbq,
  targetTime,
  initialActivityMbq,
  initialMeasuredAt,
  residualActivityMbq = '',
  residualMeasuredAt,
  halfLifeMinutes = F18_HALF_LIFE_MINUTES
}) {
  const initialAtImageMbq = activityAtTime(
    initialActivityMbq,
    initialMeasuredAt,
    targetTime,
    halfLifeMinutes
  )
  const hasResidual = residualActivityMbq !== '' &&
    residualActivityMbq !== null &&
    residualActivityMbq !== undefined
  const residualAtImageMbq = hasResidual
    ? activityAtTime(residualActivityMbq, residualMeasuredAt, targetTime, halfLifeMinutes)
    : 0
  const netAtImageMbq = initialAtImageMbq - residualAtImageMbq
  const target = number(targetActivityMbq)
  const deviationPercent = target === 0
    ? Number.NaN
    : (netAtImageMbq - target) / target * 100

  return {
    initialAtImageMbq,
    residualAtImageMbq,
    netAtImageMbq,
    deviationPercent
  }
}
