import React from 'react';

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

function NumberField({ label, unit, value, onChange, max }) {
  return <label className="shielding-field">
    <span>{label} <small>{unit}</small></span>
    <input type="number" min="0" max={max} step="any" inputMode="decimal" value={value ?? ''}
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
      { ...configuration, [method]: { ...configuration[method], [field]: value } }) });
  const updatePoint = (index, field, value) => onChangeScene({ ...scene,
    points: points.map((point, current) => current === index ? { ...point, [field]: value } : point) });

  return <section className="shielding-calculation-panel" aria-label="Cálculos CSN y NCRP">
    <div className="shielding-calculation-scope">
      <strong>En planta · Sin blindaje</strong>
      <p>Compara el kerma que llega a cada punto antes de las barreras. Las paredes, puertas y
        receptores dibujados todavía no atenúan la radiación. No calcula espesores ni conformidad.</p>
    </div>
    <details className="shielding-calculation-inputs" open={!results}>
      <summary>Datos para calcular</summary>
      <NumberField label="Carga total del equipo · CSN" unit="mA·min/semana" value={scene.csnTotalWorkload}
        onChange={value => onChangeScene({ ...scene, csnTotalWorkload: value })} />
      <p className="shielding-help">Esta carga se reparte con el porcentaje de cada orientación.
        NCRP usa sus propios pacientes por orientación; no se les aplica ese porcentaje.</p>
      {!configurations.length && <p>Añade una orientación del equipo sobre el plano.</p>}
      {configurations.map((configuration, index) => <details className="shielding-config-data"
        key={configuration.id ?? index} open={configurations.length === 1}>
        <summary>{configuration.name || `Orientación ${index + 1}`} · coeficientes</summary>
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
        <details className="shielding-method-inputs">
          <summary>NCRP 147 · pacientes y perfil</summary>
          <p className="shielding-help">Introduce los pacientes correspondientes solo a esta orientación
            y sus coeficientes del mismo perfil. K¹ primaria no debe llevar otro reparto direccional.
            K¹ secundaria ya incluye dispersión y fuga. Cada pareja de pacientes y coeficientes debe
            cubrir solo esta configuración: repetir un perfil de sala completa con todos sus pacientes
            en cada orientación duplicaría la carga.</p>
          {NCRP_FIELDS.map(([key, label, unit]) => <NumberField key={key} label={label} unit={unit}
            value={configuration.ncrp?.[key]} onChange={value => updateConfiguration(index, 'ncrp', key, value)} />)}
          <label className="shielding-field"><span>Perfil NCRP</span>
            <input type="text" value={configuration.ncrp?.profile ?? ''} placeholder="Distribución de carga y condiciones aplicables"
              onChange={event => updateConfiguration(index, 'ncrp', 'profile', event.target.value)} /></label>
          <label className="shielding-field"><span>Procedencia NCRP</span>
            <textarea rows="2" value={configuration.ncrp?.provenance ?? ''} placeholder="Referencia exacta, edición y condiciones del perfil"
              onChange={event => updateConfiguration(index, 'ncrp', 'provenance', event.target.value)} /></label>
          <label className="shielding-checkbox">
            <input type="checkbox" checked={configuration.ncrp?.secondary_envelope_confirmed === true}
              onChange={event => updateConfiguration(index, 'ncrp', 'secondary_envelope_confirmed', event.target.checked)} />
            <span>K¹ secundaria incluye dispersión y fuga y es una envolvente válida para todas las
              direcciones y condiciones que estoy evaluando.</span>
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
          <NumberField label="Ocupación T · CSN" unit="fracción, mayor que 0 y hasta 1" max="1"
            value={point.csn_occupancy} onChange={value => updatePoint(index, 'csn_occupancy', value)} />
          <NumberField label="Ocupación T · NCRP" unit="fracción, mayor que 0 y hasta 1" max="1"
            value={point.ncrp_occupancy} onChange={value => updatePoint(index, 'ncrp_occupancy', value)} />
        </fieldset>)}
      </details>
      <p className="shielding-help">Sin valores físicos precargados. Los datos y referencias permanecen
        solo en esta pestaña.</p>
    </details>
    <button className="shielding-calculate-button" type="button" onClick={onCalculate}
      disabled={!configurations.length || !points.length || !scene.calibrated}>Calcular CSN y NCRP</button>
    {!scene.calibrated && <p className="shielding-help">Primero calibra el plano o define las dimensiones de la sala.</p>}
    {results && <div className="shielding-calculation-results" aria-live="polite">
      <h3>Resultados · mGy/semana con ocupación T</h3>
      {results.points.map(point => <section className="shielding-point-result" key={point.pointId}>
        <h3>{point.name}</h3>
        <div className="shielding-method-comparison">
          <MethodResult method={point.csn} title="CSN · dirección declarada" components={[
            ['primary_mGy_per_week', 'Primaria'], ['scatter_mGy_per_week', 'Dispersa'], ['leakage_mGy_per_week', 'Fuga']]} />
          <MethodResult method={point.ncrp} title="NCRP 147" components={[
            ['primary_mGy_per_week', 'Primaria'], ['secondary_mGy_per_week', 'Dispersa + fuga']]} />
        </div>
      </section>)}
      <details className="shielding-calculation-limitations"><summary>Alcance de esta evaluación</summary>
        <ul>{results.limitations.map(text => <li key={text}>{text}</li>)}</ul>
      </details>
    </div>}
  </section>;
}
