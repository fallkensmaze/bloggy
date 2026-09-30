import { COR_DECLARATIONS } from '../utils/corValidation'
import '../styles/cor-review.css'

export default function CorAcquisitionForm({ value = {}, onChange }) {
  const set = (key, next) => onChange({ ...value, [key]: next })
  return <fieldset className="cor-declarations">
    <legend>Condiciones de esta adquisición</legend>
    <p>Completa las condiciones del montaje y revisa las proyecciones. Se reinician al cargar otro archivo.</p>
    {COR_DECLARATIONS.map(([key, label]) => <label key={key}>
      <span>{label}</span><select className="dark-select" value={value[key] || ''} onChange={e => set(key, e.target.value)}>
        <option value="">Sin verificar</option><option value="yes">Confirmado</option><option value="no">No se cumple</option>
      </select>
    </label>)}
    <label><span>Radio medido (mm), solo para los valores ausentes en DICOM</span>
      <input className="dark-input" type="number" min="0" step="0.1" value={value.radiusMm ?? ''} onChange={e => set('radiusMm', e.target.value)} placeholder="200" />
    </label>
  </fieldset>
}
