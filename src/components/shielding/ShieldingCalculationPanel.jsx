import React from 'react';
import { NcrpPresetSelector, NcrpOccupancySelector } from './ShieldingDefaults';
import { allocateNcrpPatients, applyNcrpPreset, applyNcrpOccupancy, editNcrpParameter, getNcrpPreset } from '../../utils/shieldingPresets';

const CSN_FIELDS = [
  ['output_mGy_m2_per_mA_min', 'Rendimiento primario', 'mGy·m²/(mA·min)'],
  ['scatter_fraction', 'Fracción de dispersión', 'adimensional'],
  ['reference_field_area_cm2', 'Área de referencia de esa fracción', 'cm²'],
  ['field_area_cm2', 'Área real del campo en el paciente', 'cm²'],
  ['largest_field_side_m', 'Lado mayor del campo en el paciente', 'm'],
  ['leakage_mGy_m2_per_mA_min', 'Rendimiento efectivo de fuga', 'mGy·m²/(mA·min)'],
];
const NCRP_FIELDS = [
  ['patients_per_week', 'Pacientes de esta configuración', 'pacientes/semana'],
  ['primary_mGy_per_patient_at_1m', 'K¹ primaria a 1 m', 'mGy/paciente'],
  ['secondary_mGy_per_patient_at_1m', 'K¹ secundaria total a 1 m', 'mGy/paciente'],
];

function NumberField({ label, unit, value, onChange, max, context }) {
  return <label className="shielding-field">
    <span>{label} <small>{unit}</small></span>
    <input aria-label={context ? `${label} · ${context}` : label} type="number" min="0" max={max} step="any" inputMode="decimal" value={value ?? ''}
      placeholder="Sin definir" onChange={event => onChange(event.target.value)} />
  </label>;
}

function dose(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Pendiente';
  if (value === 0) return '0';
  return new Intl.NumberFormat('es-ES', { maximumSignificantDigits: 4,
    notation: value < 0.001 || value >= 10000 ? 'scientific' : 'standard' }).format(value);
}

function MethodResult({ method, title, components }) {
  if (!method) return null;
  return <div className="shielding-method-result">
    <h4>{title}</h4>
    <dl>
      {components.map(([key, label]) => <React.Fragment key={key}>
        <dt>{label}</dt><dd>{dose(method[key])}</dd>
      </React.Fragment>)}
      <dt><strong>Total con ocupación T</strong></dt>
      <dd><strong>{dose(method.total_mGy_per_week)}</strong></dd>
    </dl>
    {!!method.errors.length && <details className="shielding-missing-data">
      <summary>Revisar {method.errors.length} {method.errors.length === 1 ? 'dato' : 'datos'}</summary>
      <ul>{method.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>
    </details>}
    {!!method.details.length && <details className="shielding-calculation-detail">
      <summary>Ver por orientación</summary>
      {method.details.map((detail, index) => <div key={detail.configurationId ?? index}>
        <strong>{detail.name || `Orientación ${index + 1}`}</strong>
        <p>{detail.primaryApplies === true ? 'Con exposición primaria en planta.' :
          detail.primaryApplies === false ? 'Fuera del haz primario en planta.' : 'Primaria sin evaluar o configuración sin carga.'}</p>
        <dl>{components.map(([key, label]) => <React.Fragment key={key}>
          <dt>{label}</dt><dd>{dose(detail[key])}</dd>
        </React.Fragment>)}</dl>
      </div>)}
    </details>}
  </div>;
}

/** UI-only adapter. All scene changes stay in the parent's transient state. */
export default function ShieldingCalculationPanel({ scene, onChangeScene, results, onCalculate }) {
  const configurations = scene.configurations || [];
  const points = scene.points || [];
  const updateConfiguration = (index, method, field, value) => onChangeScene({ ...scene,
    configurations: configurations.map((configuration, current) => current !== index ? configuration :
      { ...configuration, [method]: method === 'ncrp' ? editNcrpParameter(configuration.ncrp, field, value) :
        { ...configuration[method], [field]: value } }) });
  const updatePoint = (index, field, value) => onChangeScene({ ...scene,
    points: points.map((point, current) => current === index ? { ...point, [field]: value,
      ...(field === 'ncrp_occupancy' ? { ncrp_occupancy_type: 'manual' } : {}) } : point) });
  const profileIds = [...new Set(configurations.map(c => c.ncrp?.preset_id).filter(id => getNcrpPreset(id)))];

  return <section className="shielding-calculation-panel" aria-label="Cálculos CSN y NCRP">
    <div className="shielding-calculation-scope">
      <strong>En planta · Sin blindaje</strong>
      <p>Compara el kerma que llega a cada punto antes de las barreras. Las paredes, puertas y
        receptores dibujados todavía no atenúan la radiación. No calcula espesores ni conformidad.</p>
    </div>
    <p className="shielding-help">Dibuja el foco, la entrada al paciente y los puntos; pulsa Calcular.
      NCRP empieza con valores de referencia editables y T = 1. La comparación CSN requiere sus propios datos.</p>
    <button className="shielding-calculate-button" type="button" onClick={onCalculate}
      disabled={!configurations.length || !points.length || !scene.calibrated}>Calcular CSN y NCRP</button>
    {!scene.calibrated && <p className="shielding-help">Primero calibra el plano o define las dimensiones de la sala.</p>}
    <details className="shielding-calculation-inputs">
      <summary>Editar parámetros y valores NCRP</summary>
      <p className="shielding-help">Las orientaciones del mismo perfil se reparten por igual su N de referencia.
        Es un reparto inicial de la aplicación, editable, no un factor U tabulado. Bucky y otras direcciones
        son perfiles complementarios: cada uno usa N de la sala sin repetir la secundaria de sala completa.</p>
      {profileIds.map(id => {
        const members = configurations.filter(c => c.ncrp?.preset_id === id);
        const counts = members.map(c => c.ncrp.patients_per_week);
        const valid = counts.every(n => (typeof n === 'number' || (typeof n === 'string' && n.trim() !== '')) && Number.isFinite(Number(n)) && Number(n) >= 0);
        return <p className="shielding-profile-total" key={id}>{getNcrpPreset(id).label}: suma N = {valid ? dose(counts.reduce((sum, n) => sum + Number(n), 0)) : 'pendiente'} pacientes/semana
          {members.some(c => c.ncrp.patients_mode === 'manual') && ' · incluye valores manuales; revisa la carga total del perfil.'}</p>;
      })}
      <NumberField label="Carga total del equipo · CSN" unit="mA·min/semana" value={scene.csnTotalWorkload}
        onChange={value => onChangeScene({ ...scene, csnTotalWorkload: value })} />
      <p className="shielding-help">Esta carga se reparte con el porcentaje de cada orientación.
        NCRP usa sus propios pacientes por orientación; no se les aplica ese porcentaje.</p>
      {!configurations.length && <p>Añade una orientación del equipo sobre el plano.</p>}
      {configurations.map((configuration, index) => <details className="shielding-config-data"
        key={configuration.id ?? index} open={configurations.length === 1}>
        <summary>{configuration.name || `Orientación ${index + 1}`} · coeficientes</summary>
        <NcrpPresetSelector configuration={configuration}
          onApply={presetId => onChangeScene(applyNcrpPreset(scene, configuration.id, presetId))} />
        {!configuration.patient && <p className="shielding-help">Falta colocar la entrada del haz en el paciente en esta orientación.</p>}
        <details className="shielding-method-inputs">
          <summary>Guía CSN · carga y rendimientos</summary>
          <p className="shielding-help">Distribución direccional declarada, que sustituye al U tabulado.
            Introduce rendimientos en kerma a la tensión de trabajo. La fuga efectiva debe incluir
            la corrección que corresponda; no se añade ningún factor implícito.</p>
          {CSN_FIELDS.map(([key, label, unit]) => <NumberField key={key} label={label} unit={unit}
            max={key === 'scatter_fraction' ? 1 : undefined} value={configuration.csn?.[key]}
            onChange={value => updateConfiguration(index, 'csn', key, value)} />)}
          <label className="shielding-field"><span>Procedencia y condiciones CSN</span>
            <textarea rows="2" value={configuration.csn?.provenance ?? ''}
              placeholder="Referencia, fecha, tensión y condiciones de medida o cálculo"
              onChange={event => updateConfiguration(index, 'csn', 'provenance', event.target.value)} /></label>
        </details>
        <details className="shielding-method-inputs" open>
          <summary>NCRP 147 · pacientes y perfil</summary>
          <p className="shielding-help">K¹ secundaria incluye dispersión y fuga; se precarga el valor mayor de las
            direcciones tabuladas. N corresponde a esta orientación, después del reparto inicial del perfil.
            Al editar N, tu valor queda fijo aunque añadas o borres otras orientaciones.</p>
          {NCRP_FIELDS.map(([key, label, unit]) => <NumberField key={key} label={label} unit={unit}
            context={configuration.name} value={configuration.ncrp?.[key]} onChange={value => updateConfiguration(index, 'ncrp', key, value)} />)}
          {getNcrpPreset(configuration.ncrp?.preset_id) && <label className="shielding-checkbox">
            <input type="checkbox" aria-label={`Reparto automático NCRP · ${configuration.name}`}
              checked={configuration.ncrp.patients_mode === 'automatic'}
              onChange={event => onChangeScene(allocateNcrpPatients({ ...scene, configurations: configurations.map((c, i) =>
                i === index ? { ...c, ncrp: { ...c.ncrp, patients_mode: event.target.checked ? 'automatic' : 'manual' } } : c) }))} />
            <span>Repartir automáticamente N de referencia entre las orientaciones de este perfil.</span>
          </label>}
          <label className="shielding-field"><span>Perfil NCRP</span>
            <input type="text" value={configuration.ncrp?.profile ?? ''} placeholder="Distribución de carga y condiciones aplicables"
              onChange={event => updateConfiguration(index, 'ncrp', 'profile', event.target.value)} /></label>
          <label className="shielding-field"><span>Procedencia NCRP</span>
            <textarea rows="2" value={configuration.ncrp?.provenance ?? ''} placeholder="Referencia exacta, edición y condiciones del perfil"
              onChange={event => updateConfiguration(index, 'ncrp', 'provenance', event.target.value)} /></label>
          <label className="shielding-checkbox">
            <input type="checkbox" checked={configuration.ncrp?.secondary_envelope_confirmed === true}
              onChange={event => updateConfiguration(index, 'ncrp', 'secondary_envelope_confirmed', event.target.checked)} />
            <span>Usar K¹ secundaria como envolvente de dispersión y fuga para las direcciones evaluadas.
              Activo de inicio para el perfil tabulado; al editar K¹ secundaria hay que revisar esta opción.</span>
          </label>
          <p className="shielding-help">La distancia secundaria será la menor entre foco–punto y
            paciente–punto, conforme a la opción conservadora de NCRP 147 §4.1.7.3.</p>
        </details>
      </details>)}
      <details className="shielding-point-data">
        <summary>Ocupación de los puntos</summary>
        {!points.length && <p>Coloca un punto sobre el plano para evaluarlo.</p>}
        {points.map((point, index) => <fieldset key={point.id ?? index}>
          <legend>{point.name || `Punto ${index + 1}`}</legend>
          <NcrpOccupancySelector point={point} onChange={type => onChangeScene({ ...scene,
            points: points.map((p, i) => i === index ? applyNcrpOccupancy(p, type) : p) })} />
          <NumberField label="Ocupación T · CSN" unit="fracción, mayor que 0 y hasta 1" max="1"
            context={point.name} value={point.csn_occupancy} onChange={value => updatePoint(index, 'csn_occupancy', value)} />
          <NumberField label="Ocupación T · NCRP" unit="fracción, mayor que 0 y hasta 1" max="1"
            context={point.name} value={point.ncrp_occupancy} onChange={value => updatePoint(index, 'ncrp_occupancy', value)} />
        </fieldset>)}
      </details>
      <p className="shielding-help">Perfiles radiográficos NCRP 147: tablas 4.1, 4.3, 4.5 y 4.7.
        No incluyen TC, mamografía ni el tubo fluoroscópico. Los cambios permanecen solo en esta pestaña.</p>
    </details>
    {results && <div className="shielding-calculation-results" aria-live="polite">
      <h3>Resultados · mGy/semana con ocupación T</h3>
      {results.points.map(point => <section className="shielding-point-result" key={point.pointId}>
        <h3>{point.name}</h3>
        <div className="shielding-method-comparison">
          <MethodResult method={point.ncrp} title="NCRP 147" components={[
            ['primary_mGy_per_week', 'Primaria'], ['secondary_mGy_per_week', 'Dispersa + fuga']]} />
          <MethodResult method={point.csn} title="CSN · dirección declarada" components={[
            ['primary_mGy_per_week', 'Primaria'], ['scatter_mGy_per_week', 'Dispersa'], ['leakage_mGy_per_week', 'Fuga']]} />
        </div>
      </section>)}
      <details className="shielding-calculation-limitations"><summary>Alcance de esta evaluación</summary>
        <ul>{results.limitations.map(text => <li key={text}>{text}</li>)}</ul>
      </details>
    </div>}
  </section>;
}
