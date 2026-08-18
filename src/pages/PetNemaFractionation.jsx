import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_PET_NEMA_CONFIG,
  calculatePetNemaMeasurementProjection,
  calculatePetNemaPlan,
  calculatePetNemaPreparations
} from '../utils/petNemaFractionation'
import '../styles/pet-nema.css'

function pad(value) {
  return String(value).padStart(2, '0')
}

function toDateTimeLocal(value, includeSeconds = false) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  return includeSeconds ? `${base}:${pad(date.getSeconds())}` : base
}

function formatDateTime(value) {
  if (!value) return '--'
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value)
}

function formatClock(value) {
  if (!value) return '--:--:--'
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(value)
}

function formatNumber(value, decimals = 2) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '--'
}

function getInitialForm() {
  const firstAcquisition = new Date()
  firstAcquisition.setSeconds(0, 0)
  firstAcquisition.setMinutes(firstAcquisition.getMinutes() + 60)

  return {
    firstAcquisitionTime: toDateTimeLocal(firstAcquisition),
    backgroundConcentrationKbqMl: DEFAULT_PET_NEMA_CONFIG.backgroundConcentrationKbqMl,
    sphereStockVolumeMl: DEFAULT_PET_NEMA_CONFIG.sphereStockVolumeMl,
    phantomVolumeMl: DEFAULT_PET_NEMA_CONFIG.phantomVolumeMl,
    cylinderDiameterCm: DEFAULT_PET_NEMA_CONFIG.cylinderDiameterCm,
    cylinderLengthCm: DEFAULT_PET_NEMA_CONFIG.cylinderLengthCm,
    linearSourceActivityAtFirstAcquisitionMbq:
      DEFAULT_PET_NEMA_CONFIG.linearSourceActivityAtFirstAcquisitionMbq,
    linearSourceVolumeMl: DEFAULT_PET_NEMA_CONFIG.linearSourceVolumeMl,
    halfLifeMinutes: DEFAULT_PET_NEMA_CONFIG.halfLifeMinutes
  }
}

function sumPendingActivities(preparations, preparedSamples, includeOptional) {
  return preparations
    .filter((preparation) => includeOptional || !preparation.optional)
    .filter((preparation) => !preparedSamples[preparation.id]?.initialConfirmed)
    .reduce(
      (total, preparation) =>
        total + (preparedSamples[preparation.id]?.recommendedActivityMbq ?? preparation.activityMbq),
      0
    )
}

function PetNemaFractionation() {
  const [form, setForm] = useState(getInitialForm)
  const [preparedSamples, setPreparedSamples] = useState({})
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const plan = useMemo(() => calculatePetNemaPlan(form), [form])
  const preparations = useMemo(
    () => calculatePetNemaPreparations(plan, new Date(now)),
    [plan, now]
  )

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  const planSignature = useMemo(() => JSON.stringify(form), [form])
  const [baselineSignature, setBaselineSignature] = useState(planSignature)
  const hasRecordedSamples = Object.keys(preparedSamples).length > 0
  const planChangedSinceRecording = hasRecordedSamples && planSignature !== baselineSignature

  useEffect(() => {
    if (!hasRecordedSamples) setBaselineSignature(planSignature)
  }, [planSignature, hasRecordedSamples])

  const discardRecordedSamples = () => {
    setPreparedSamples({})
    setBaselineSignature(planSignature)
  }

  const startPreparation = (preparation) => {
    setPreparedSamples((current) => {
      if (!Number.isFinite(preparation.activityMbq) || preparation.overdue) return current

      return {
        ...current,
        [preparation.id]: {
          recommendedActivityMbq: preparation.activityMbq,
          startedAt: new Date(now),
          initialActivityMbq: '',
          initialMeasuredAt: toDateTimeLocal(new Date(now), true),
          initialConfirmed: false,
          initialProjection: null,
          residualEnabled: false,
          residualActivityMbq: '',
          residualMeasuredAt: '',
          residualConfirmed: false,
          residualProjection: null
        }
      }
    })
  }

  const cancelPreparation = (preparationId) => {
    setPreparedSamples((current) => {
      const { [preparationId]: removed, ...remaining } = current
      return remaining
    })
  }

  const updatePreparation = (preparationId, field, value) => {
    setPreparedSamples((current) => ({
      ...current,
      [preparationId]: {
        ...current[preparationId],
        [field]: value
      }
    }))
  }

  const confirmInitialMeasurement = (preparation) => {
    setPreparedSamples((current) => {
      const snapshot = current[preparation.id]
      if (!snapshot) return current

      const projection = calculatePetNemaMeasurementProjection({
        targetActivityMbq: preparation.targetActivityMbq,
        targetTime: preparation.targetTime,
        initialActivityMbq: snapshot.initialActivityMbq,
        initialMeasuredAt: snapshot.initialMeasuredAt,
        halfLifeMinutes: form.halfLifeMinutes
      })
      if (!Number.isFinite(projection.netAtImageMbq)) return current

      return {
        ...current,
        [preparation.id]: {
          ...snapshot,
          initialConfirmed: true,
          initialProjection: projection
        }
      }
    })
  }

  const editInitialMeasurement = (preparationId) => {
    setPreparedSamples((current) => ({
      ...current,
      [preparationId]: {
        ...current[preparationId],
        initialConfirmed: false,
        initialProjection: null,
        residualEnabled: false,
        residualActivityMbq: '',
        residualMeasuredAt: '',
        residualConfirmed: false,
        residualProjection: null
      }
    }))
  }

  const enableResidualMeasurement = (preparationId) => {
    setPreparedSamples((current) => ({
      ...current,
      [preparationId]: {
        ...current[preparationId],
        residualEnabled: true,
        residualMeasuredAt: toDateTimeLocal(new Date(), true)
      }
    }))
  }

  const confirmResidualMeasurement = (preparation) => {
    setPreparedSamples((current) => {
      const snapshot = current[preparation.id]
      if (!snapshot) return current

      const projection = calculatePetNemaMeasurementProjection({
        targetActivityMbq: preparation.targetActivityMbq,
        targetTime: preparation.targetTime,
        initialActivityMbq: snapshot.initialActivityMbq,
        initialMeasuredAt: snapshot.initialMeasuredAt,
        residualActivityMbq: snapshot.residualActivityMbq,
        residualMeasuredAt: snapshot.residualMeasuredAt,
        halfLifeMinutes: form.halfLifeMinutes
      })
      if (!Number.isFinite(projection.netAtImageMbq)) return current

      return {
        ...current,
        [preparation.id]: {
          ...snapshot,
          residualConfirmed: true,
          residualProjection: projection
        }
      }
    })
  }

  const editResidualMeasurement = (preparationId) => {
    setPreparedSamples((current) => ({
      ...current,
      [preparationId]: {
        ...current[preparationId],
        residualConfirmed: false,
        residualProjection: null
      }
    }))
  }

  const completedSamples = preparations.filter(
    (preparation) => preparedSamples[preparation.id]?.initialConfirmed
  ).length
  const pendingRequiredMbq = sumPendingActivities(preparations, preparedSamples, false)
  const pendingWithLinearSourceMbq = sumPendingActivities(preparations, preparedSamples, true)
  const hasOverduePending = preparations.some(
    (preparation) => preparation.overdue && !preparedSamples[preparation.id]?.initialConfirmed
  )

  return (
    <div className="page-body pet-nema-page">
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-bullseye"></i></div>
        <h1 className="page-title">PET NEMA - Calidad de imagen</h1>
        <p className="page-subtitle">
          Planificacion del llenado del maniqui de esferas y apoyo temporal para el fraccionamiento de F-18
        </p>
      </div>

      <div className="pet-nema-info">
        <i className="bi bi-info-circle"></i>
        <div>
          Indica la hora de la primera imagen. Las actividades pendientes se corrigen por decaimiento
          cada segundo. Al preparar una muestra, registra la actividad medida y confirma la hora
          propuesta. Despues de inyectarla puedes anadir el residual de la jeringa para calcular la
          actividad neta y su desviacion.
        </div>
      </div>

      {planChangedSinceRecording && (
        <div className="pet-nema-warning">
          <i className="bi bi-exclamation-triangle"></i>
          <div>
            Has cambiado la planificacion despues de registrar medidas. Las recomendaciones
            congeladas y las desviaciones mostradas ya no corresponden a estos parametros.
            Las medidas se conservan hasta que las descartes.
            <button type="button" className="pet-nema-secondary-button" onClick={discardRecordedSamples}>
              Descartar medidas registradas
            </button>
          </div>
        </div>
      )}

      <section className="calc-card pet-nema-section">
        <SectionHeading icon="bi-calendar2-check" title="Planificacion" subtitle="Define la hora de la primera imagen y los parametros del maniqui" />
        <div className="pet-nema-form-grid">
          <Field label="Hora prevista 1a adquisicion">
            <input
              className="dark-input"
              type="datetime-local"
              value={form.firstAcquisitionTime}
              onChange={(event) => updateForm('firstAcquisitionTime', event.target.value)}
            />
          </Field>
          <Field label="Fondo (kBq/ml)">
            <NumberInput value={form.backgroundConcentrationKbqMl} onChange={(value) => updateForm('backgroundConcentrationKbqMl', value)} step="0.1" />
          </Field>
          <Field label="Volumen disolucion esferas (ml)">
            <NumberInput value={form.sphereStockVolumeMl} onChange={(value) => updateForm('sphereStockVolumeMl', value)} step="1" />
          </Field>
          <Field label="Actividad fuente lineal en 1a adq. (MBq)">
            <NumberInput value={form.linearSourceActivityAtFirstAcquisitionMbq} onChange={(value) => updateForm('linearSourceActivityAtFirstAcquisitionMbq', value)} step="1" />
          </Field>
          <Field label="Volumen fuente lineal (ml)">
            <NumberInput value={form.linearSourceVolumeMl} onChange={(value) => updateForm('linearSourceVolumeMl', value)} step="0.1" />
          </Field>
        </div>

        <details className="pet-nema-details">
          <summary>Parametros geometricos del maniqui</summary>
          <div className="pet-nema-form-grid pet-nema-details-grid">
            <Field label="Volumen cavidad sin insertos (ml)">
              <NumberInput value={form.phantomVolumeMl} onChange={(value) => updateForm('phantomVolumeMl', value)} step="1" />
            </Field>
            <Field label="Diametro inserto cilindrico (cm)">
              <NumberInput value={form.cylinderDiameterCm} onChange={(value) => updateForm('cylinderDiameterCm', value)} step="0.1" />
            </Field>
            <Field label="Longitud inserto cilindrico (cm)">
              <NumberInput value={form.cylinderLengthCm} onChange={(value) => updateForm('cylinderLengthCm', value)} step="0.1" />
            </Field>
            <Field label="Semivida F-18 / intervalo adquisiciones (min)">
              <NumberInput value={form.halfLifeMinutes} onChange={(value) => updateForm('halfLifeMinutes', value)} step="1" />
            </Field>
          </div>
          <div className="pet-nema-geometry">
            Introduce el volumen de la cavidad vacia: el modulo descuenta esferas e inserto.
            Si tu valor ya se midio con los insertos montados, se descontarian dos veces.
            <br />
            Volumen de fondo calculado: <strong>{formatNumber(plan.geometry.backgroundVolumeMl)} ml</strong>
            {' '}| esferas: {formatNumber(plan.geometry.spheresVolumeMl)} ml
            {' '}| inserto: {formatNumber(plan.geometry.cylinderInsertVolumeMl)} ml
          </div>
        </details>

        {plan.warnings.map((warning) => (
          <div className="pet-nema-warning" key={warning}>
            <i className="bi bi-exclamation-triangle"></i> {warning}
          </div>
        ))}
        {hasOverduePending && (
          <div className="pet-nema-warning">
            <i className="bi bi-exclamation-triangle"></i>{' '}
            La hora objetivo ya ha pasado para alguna muestra pendiente. Revisa la planificacion antes de prepararla.
          </div>
        )}
      </section>

      <section className="pet-nema-timer-section">
        <SectionHeading icon="bi-stopwatch" title="Cronometros operativos" subtitle="Cuenta atras en tiempo real para las dos adquisiciones" />
        <div className="pet-nema-timer-grid">
          <CountdownCard
            icon="bi-camera"
            label="1a adquisicion"
            description="Adquirir con F1 en el fondo"
            target={plan.firstAcquisitionTime}
            now={now}
          />
          <CountdownCard
            icon="bi-hourglass-split"
            label="2a adquisicion"
            description="Anadir F2 tras la primera adquisicion"
            target={plan.secondAcquisitionTime}
            now={now}
          />
        </div>
      </section>

      <section className="calc-card pet-nema-section">
        <SectionHeading icon="bi-eyedropper" title="Preparacion guiada" subtitle={`Actividades pendientes actualizadas a las ${formatClock(new Date(now))}`} />
        <div className="pet-nema-preparation-grid">
          {preparations.map((preparation) => (
            <PreparationCard
              key={preparation.id}
              preparation={preparation}
              snapshot={preparedSamples[preparation.id]}
              now={now}
              onStart={() => startPreparation(preparation)}
              onCancel={() => cancelPreparation(preparation.id)}
              onChange={(field, value) => updatePreparation(preparation.id, field, value)}
              onConfirmInitial={() => confirmInitialMeasurement(preparation)}
              onEditInitial={() => editInitialMeasurement(preparation.id)}
              onEnableResidual={() => enableResidualMeasurement(preparation.id)}
              onConfirmResidual={() => confirmResidualMeasurement(preparation)}
              onEditResidual={() => editResidualMeasurement(preparation.id)}
            />
          ))}
        </div>

        <div className="pet-nema-total-grid">
          <Metric label="Pendiente sin fuente lineal" value={`${formatNumber(pendingRequiredMbq)} MBq`} />
          <Metric label="Pendiente con fuente lineal" value={`${formatNumber(pendingWithLinearSourceMbq)} MBq`} accent />
          <Metric label="Muestras preparadas" value={`${completedSamples} / ${preparations.length}`} />
        </div>
        <p className="pet-nema-reset-note">
          Si cambias la planificacion o los parametros, se reinician las marcas de preparacion.
        </p>
      </section>

      <section className="calc-card pet-nema-section">
        <SectionHeading icon="bi-calculator" title="Comprobacion teorica" subtitle="Concentraciones y ratios previstos en cada adquisicion" />
        <div className="pet-nema-table-wrap">
          <table className="pet-nema-table">
            <thead>
              <tr>
                <th>Comprobacion</th>
                <th>1a adquisicion</th>
                <th>2a adquisicion</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Fondo</td>
                <td>{formatNumber(form.backgroundConcentrationKbqMl)} kBq/ml</td>
                <td>{formatNumber(plan.backgroundConcentrationAtSecondAcquisitionKbqMl)} kBq/ml</td>
              </tr>
              <tr>
                <td>Esferas</td>
                <td>{formatNumber(plan.firstSphereConcentrationKbqMl)} kBq/ml</td>
                <td>{formatNumber(plan.sphereConcentrationAtSecondAcquisitionKbqMl)} kBq/ml</td>
              </tr>
              <tr>
                <td>Ratio esferas / fondo</td>
                <td>{formatNumber(plan.expectedFirstRatio)} : 1</td>
                <td>{formatNumber(plan.expectedSecondRatio)} : 1</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function SectionHeading({ icon, title, subtitle }) {
  return (
    <div className="pet-nema-section-heading">
      <div className="pet-nema-section-icon"><i className={`bi ${icon}`}></i></div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label>
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

function NumberInput({ value, onChange, step }) {
  return <input className="dark-input" type="number" value={value} onChange={(event) => onChange(event.target.value)} step={step} />
}

function PreparationCard({
  preparation,
  snapshot,
  now,
  onStart,
  onCancel,
  onChange,
  onConfirmInitial,
  onEditInitial,
  onEnableResidual,
  onConfirmResidual,
  onEditResidual
}) {
  const started = Boolean(snapshot)
  const prepared = Boolean(snapshot?.initialConfirmed)
  const activityMbq = snapshot?.recommendedActivityMbq ?? preparation.activityMbq
  const canStart = Number.isFinite(activityMbq) && !preparation.overdue
  const projection = snapshot?.residualConfirmed
    ? snapshot.residualProjection
    : snapshot?.initialProjection
  const projectionLabel = snapshot?.residualConfirmed
    ? 'Actividad neta en imagen'
    : 'Actividad inicial en imagen'

  return (
    <div className={`pet-nema-preparation-card${prepared ? ' pet-nema-preparation-card-done' : ''}${preparation.overdue && !started ? ' pet-nema-preparation-card-overdue' : ''}`}>
      <div className="pet-nema-preparation-header">
        <span>{preparation.label}</span>
        <small>
          {snapshot?.residualConfirmed
            ? 'Neta calculada'
            : prepared
              ? 'Medida confirmada'
              : started
                ? 'Introducir medida'
                : preparation.overdue
                  ? 'Fuera de hora'
                  : preparation.optional
                    ? 'Opcional'
                    : 'Pendiente'}
        </small>
      </div>
      <strong>{formatNumber(activityMbq)} <small>MBq</small></strong>
      <p>{preparation.description}</p>
      <div className="pet-nema-preparation-meta">
        <small>
          Actividad objetivo en imagen: {formatNumber(preparation.targetActivityMbq)} MBq
          {' '}a las {formatDateTime(preparation.targetTime)}
        </small>
        <small>
          {started
            ? `Registro iniciado a las ${formatClock(snapshot.startedAt)}`
            : `Actualizada a las ${formatClock(new Date(now))}`}
        </small>
      </div>

      {!started && (
        <button
          className="pet-nema-prepare-button"
          type="button"
          disabled={!canStart}
          onClick={onStart}
        >
          <i className="bi bi-check2"></i>
          Marcar preparada
        </button>
      )}

      {started && (
        <div className="pet-nema-measurement-panel">
          <MeasurementFields
            activityLabel="Actividad inicial medida (MBq)"
            activityValue={snapshot.initialActivityMbq}
            timeLabel="Hora medida inicial"
            timeValue={snapshot.initialMeasuredAt}
            disabled={snapshot.initialConfirmed}
            onActivityChange={(value) => onChange('initialActivityMbq', value)}
            onTimeChange={(value) => onChange('initialMeasuredAt', value)}
          />

          {!snapshot.initialConfirmed && (
            <div className="pet-nema-action-row">
              <button
                className="pet-nema-prepare-button"
                type="button"
                disabled={!validMeasurement(snapshot.initialActivityMbq, snapshot.initialMeasuredAt)}
                onClick={onConfirmInitial}
              >
                <i className="bi bi-check2-circle"></i>
                Confirmar medida
              </button>
              <SecondaryButton onClick={onCancel}>Cancelar</SecondaryButton>
            </div>
          )}

          {projection && (
            <ProjectionResult
              label={projectionLabel}
              projection={projection}
              targetActivityMbq={preparation.targetActivityMbq}
              showResidual={snapshot.residualConfirmed}
            />
          )}

          {snapshot.initialConfirmed && !snapshot.residualEnabled && (
            <div className="pet-nema-action-row">
              <button className="pet-nema-prepare-button" type="button" onClick={onEnableResidual}>
                <i className="bi bi-eyedropper"></i>
                Registrar residual
              </button>
              <SecondaryButton onClick={onEditInitial}>Editar medida</SecondaryButton>
            </div>
          )}

          {snapshot.residualEnabled && (
            <div className="pet-nema-residual-panel">
              <span className="pet-nema-panel-title">Residual tras inyeccion</span>
              <MeasurementFields
                activityLabel="Actividad residual medida (MBq)"
                activityValue={snapshot.residualActivityMbq}
                timeLabel="Hora medida residual"
                timeValue={snapshot.residualMeasuredAt}
                disabled={snapshot.residualConfirmed}
                onActivityChange={(value) => onChange('residualActivityMbq', value)}
                onTimeChange={(value) => onChange('residualMeasuredAt', value)}
              />
              <div className="pet-nema-action-row">
                {snapshot.residualConfirmed ? (
                  <SecondaryButton onClick={onEditResidual}>Editar residual</SecondaryButton>
                ) : (
                  <button
                    className="pet-nema-prepare-button"
                    type="button"
                    disabled={!validMeasurement(snapshot.residualActivityMbq, snapshot.residualMeasuredAt)}
                    onClick={onConfirmResidual}
                  >
                    <i className="bi bi-calculator"></i>
                    Calcular neta
                  </button>
                )}
                <SecondaryButton onClick={onEditInitial}>Editar medida inicial</SecondaryButton>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MeasurementFields({
  activityLabel,
  activityValue,
  timeLabel,
  timeValue,
  disabled,
  onActivityChange,
  onTimeChange
}) {
  return (
    <div className="pet-nema-measurement-grid">
      <label>
        <span>{activityLabel}</span>
        <input
          className="dark-input"
          type="number"
          min="0"
          step="any"
          value={activityValue}
          disabled={disabled}
          onChange={(event) => onActivityChange(event.target.value)}
        />
      </label>
      <label>
        <span>{timeLabel}</span>
        <input
          className="dark-input"
          type="datetime-local"
          step="1"
          value={timeValue}
          disabled={disabled}
          onChange={(event) => onTimeChange(event.target.value)}
        />
      </label>
    </div>
  )
}

function ProjectionResult({ label, projection, targetActivityMbq, showResidual }) {
  return (
    <div className="pet-nema-preparation-projection">
      <span>{label}</span>
      <strong>{formatNumber(projection.netAtImageMbq)} <small>MBq</small></strong>
      <small>
        Esperada: {formatNumber(targetActivityMbq)} MBq
        {' '}| desviacion: {formatSignedPercent(projection.deviationPercent)}
      </small>
      {showResidual && (
        <small>
          Inicial corregida: {formatNumber(projection.initialAtImageMbq)} MBq
          {' '}| residual corregido: {formatNumber(projection.residualAtImageMbq)} MBq
        </small>
      )}
    </div>
  )
}

function SecondaryButton({ children, onClick }) {
  return (
    <button className="pet-nema-secondary-button" type="button" onClick={onClick}>
      {children}
    </button>
  )
}

function validMeasurement(activityMbq, measuredAt) {
  return activityMbq !== '' &&
    Number.isFinite(Number(activityMbq)) &&
    Number(activityMbq) >= 0 &&
    Boolean(measuredAt)
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return '--'
  const normalized = Math.abs(value) < 0.005 ? 0 : value
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(2)} %`
}

function Metric({ label, value, accent }) {
  return (
    <div className={`pet-nema-metric${accent ? ' pet-nema-metric-accent' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function CountdownCard({ icon, label, description, target, now }) {
  const targetMs = target?.getTime()
  const remaining = Number.isFinite(targetMs) ? targetMs - now : Number.NaN
  const past = Number.isFinite(remaining) && remaining < -1000
  const className = !Number.isFinite(remaining) ? 'invalid' : past ? 'past' : remaining < 10 * 60000 ? 'soon' : 'upcoming'

  return (
    <div className={`pet-nema-timer-card pet-nema-timer-${className}`}>
      <div className="pet-nema-timer-header">
        <i className={`bi ${icon}`}></i>
        <span>{label}</span>
      </div>
      <strong>{formatCountdown(remaining)}</strong>
      <p>{description}</p>
      <small>{past ? 'Tiempo transcurrido desde' : 'Programado para'} {formatDateTime(target)}</small>
    </div>
  )
}

function formatCountdown(milliseconds) {
  if (!Number.isFinite(milliseconds)) return '--:--:--'
  const prefix = milliseconds < -1000 ? '+' : ''
  const seconds = Math.floor(Math.abs(milliseconds) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return `${prefix}${pad(hours)}:${pad(minutes)}:${pad(remainder)}`
}

export default PetNemaFractionation
