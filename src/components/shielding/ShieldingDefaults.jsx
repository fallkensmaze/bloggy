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
