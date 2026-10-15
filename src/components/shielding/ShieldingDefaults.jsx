import { CSN_PRESETS, CSN_OCCUPANCIES, CSN_REFERENCE_URL, getCsnPreset } from '../../utils/shieldingCsnPresets';
import { NCRP_PRESETS, NCRP_OCCUPANCIES, NCRP_REFERENCE_URL, getNcrpPreset } from '../../utils/shieldingPresets';

export function NcrpPresetSelector({ configuration, onApply }) {
  const preset = getNcrpPreset(configuration.ncrp?.preset_id);
  return <div className="shielding-preset">
    <label className="shielding-field"><span>Valores iniciales NCRP 147</span>
      <select aria-label={`Perfil inicial NCRP · ${configuration.name}`} value={preset?.id ?? ''}
        onChange={event => onApply(event.target.value)}>
        {!preset && <option value="">Datos manuales</option>}
        {NCRP_PRESETS.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select>
    </label>
    {preset && <>
      <p className="shielding-help">{configuration.ncrp.coefficients_modified ? 'Coeficientes personalizados desde este perfil.' : 'Coeficientes NCRP precargados y editables.'}
        {' '}Referencia: {preset.patients} pacientes/semana, actividad media.
        {' '}Campo de referencia: {preset.fieldArea} cm² a {preset.referenceDistance} m.</p>
      <button type="button" className="sh-text-button" onClick={() => onApply(preset.id)}>Restaurar valores NCRP</button>
    </>}
    <p className="shielding-help">Cambiar o restaurar el perfil carga sus coeficientes y su reparto inicial de pacientes.
      {' '}<a href={NCRP_REFERENCE_URL} target="_blank" rel="noreferrer">Referencia NCRP 147</a></p>
  </div>;
}

export function NcrpOccupancySelector({ point, onChange }) {
  return <label className="shielding-field"><span>Uso del espacio · NCRP</span>
    <select aria-label={`Uso del espacio NCRP · ${point.name}`} value={point.ncrp_occupancy_type || 'manual'}
      onChange={event => onChange(event.target.value)}>
      {NCRP_OCCUPANCIES.map(item => <option key={item.id} value={item.id}>{item.label} · T = {item.value}</option>)}
      <option value="manual">Ocupación personalizada</option>
    </select>
  </label>;
}

export function CsnPresetSelector({ scene, onApply }) {
  const preset = getCsnPreset(scene.csnPresetId);
  const modified = scene.csnWorkloadModified || scene.configurations.some(c => c.csn?.coefficients_modified);
  return <div className="shielding-preset">
    <label className="shielding-field"><span>Valores iniciales CSN 5.11 · equipo completo</span>
      <select aria-label="Perfil inicial CSN 5.11" value={preset?.id ?? ''} onChange={event => onApply(event.target.value)}>
        {!preset && <option value="">Seleccionar perfil CSN (datos manuales)</option>}
        {CSN_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
    {preset && <>
      <p className="shielding-help">{modified ? 'Parámetros CSN personalizados desde este perfil.' : 'Valores CSN cargados y editables.'}
        {' '}Referencia: W = {preset.workload} mA·min/semana; G ≈ {preset.output} mGy·m²/(mA·min); Qh = {preset.qh} mA·min/h.
        {' '}Hipótesis: G aproximado con mSv/mGy ≈ 1 y campo supuesto de 20 × 20 cm.</p>
      <button type="button" className="sh-text-button" onClick={() => onApply(preset.id)}>Restaurar valores CSN</button>
    </>}
    <details className="shielding-preset-notes">
      <summary>Qué carga el perfil CSN y sus hipótesis</summary>
      <p className="shielding-help">Carga W y los coeficientes CSN de todas las orientaciones de este equipo.
        Las ocupaciones y los porcentajes manuales se conservan. Los porcentajes automáticos se reparten por igual.
        {' '}<a href={CSN_REFERENCE_URL} target="_blank" rel="noreferrer">Guía CSN 5.11 · 1990</a></p>
      <p className="shielding-help">G es una lectura aproximada de la figura 1 para 2 mm Al y tensión constante,
        con equivalencia numérica aproximada mSv/mGy = 1 indicada por la guía para radiodiagnóstico.
        Campo inicial supuesto: 20 × 20 cm; revisa el campo real y la apertura dibujada.
        Fuga: límite 1 mGy/h a 1 m, f = 1 conservador. Puedes editar Qh, f y el límite en Resultados.</p>
    </details>
  </div>;
}

export function CsnOccupancySelector({ point, onChange }) {
  return <label className="shielding-field"><span>Uso del espacio · CSN 5.11</span>
    <select aria-label={`Uso del espacio CSN · ${point.name}`} value={point.csn_occupancy_type || 'manual'}
      onChange={event => onChange(event.target.value)}>
      {point.csn_occupancy_type === 'unset' && <option value="unset">Sin definir</option>}
      {CSN_OCCUPANCIES.map(item => <option key={item.id} value={item.id}>{item.label} · T = {item.value}</option>)}
      <option value="manual">Ocupación personalizada</option>
    </select>
  </label>;
}
