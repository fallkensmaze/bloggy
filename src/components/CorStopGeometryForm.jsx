import '../styles/cor-review.css'

const fmt = value => Number.isFinite(value) ? value.toLocaleString('es-ES', { maximumFractionDigits: 3 }) : '—'

// Declared geometry of a COR acquired as one file per stop. Starts empty for every new set of files.
export default function CorStopGeometryForm({ summary, value = {}, onChange }) {
  const set = (key, next) => onChange({ ...value, [key]: next })
  const step = summary.suggestedFullRotationStepDeg
  return <fieldset className="cor-declarations cor-stop-geometry">
    <legend>Geometría de las paradas · {summary.count} archivos</legend>
    <p>Cada archivo es una parada con un frame por cabezal. Se ordenan por InstanceNumber y se comprueba que no falte ninguna.
      El paso angular y el sentido de giro no están en estos DICOM: decláralos según el protocolo de adquisición; no se infieren de las imágenes.
      Se reinician al cargar otros archivos.</p>
    <label><span>Paso angular entre paradas (°)</span>
      <input className="dark-input" aria-label="Paso angular entre paradas" type="number" min="0" max="360" step="any" value={value.angularStepDeg ?? ''} onChange={e => set('angularStepDeg', e.target.value)} placeholder={String(step)} />
    </label>
    <p><button type="button" className="cor-stop-step" onClick={() => set('angularStepDeg', String(step))}>Usar 360° / {summary.count} = {fmt(step)}°</button> si cada cabezal recorre 360° en las {summary.count} paradas.</p>
    <label><span>Sentido de giro</span>
      <select className="dark-select" aria-label="Sentido de giro" value={value.rotationDirection || ''} onChange={e => set('rotationDirection', e.target.value)}>
        <option value="">Sin declarar</option><option value="CW">Horario (CW)</option><option value="CC">Antihorario (CC)</option>
      </select>
    </label>
    {summary.heads.map(head => Number.isFinite(summary.startAnglesDeg[head])
      ? <p key={head}>Cabezal {head}: ángulo inicial {fmt(summary.startAnglesDeg[head])}° (StartAngle de la primera parada).</p>
      : <label key={head}><span>Ángulo inicial del cabezal {head} (°) · ausente en DICOM</span>
        <input className="dark-input" aria-label={`Ángulo inicial del cabezal ${head}`} type="number" step="any" value={value.startAnglesDeg?.[head] ?? ''}
          onChange={e => set('startAnglesDeg', { ...value.startAnglesDeg, [head]: e.target.value })} /></label>)}
    <p>δCOR y δAXIAL se calculan con las posiciones de las fuentes y no dependen del ángulo asignado a cada vista. El paso y el sentido determinan
      las comprobaciones de muestreo (vistas de 0° y 180°, 360° uniformes), la vista de referencia de 0° y el modelo 3D experimental.</p>
  </fieldset>
}
