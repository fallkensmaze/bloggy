/**
 * In-memory, unshielded kerma in a declared horizontal plane. No physical defaults.
 *
 * CSN equations: WEB_BLINDAJES/METODOLOGIA_ES.md §§4, 5.1, 5.2, implemented in
 * csn_{primary,scatter,leakage}_barrier.py. The source coefficients are already in
 * mGy·m²/(mA·min), not mSv; no dose-to-kerma conversion happens here. Declared beam
 * directions replace tabulated U, and each workload share is applied exactly once.
 *
 * NCRP 147 §§4.1.7.3, 4.2.2: Kp¹*N/dp² and Ksec¹*N/dsec². Integrated secondary
 * includes leakage. We explicitly use min(focus-point,patient-point) for dsec,
 * an allowed conservative distance in §4.1.7.3. Manual Ksec must be confirmed as
 * an envelope for all evaluated directions; no angle table is inferred.
 * https://www.aapm.org/pubs/protected_files/NCRP/NCRP_Report_147_AAPM.pdf
 *
 * Coefficients, profiles and provenance are provided by the user during this
 * session. This module contains no licensed tables, clinical presets or hashes.
 */

const PERCENT_TOTAL = 100;
const PERCENT_SUM_TOLERANCE = 1e-8; // arithmetic tolerance, percentage points
const SCATTER_FAR_FIELD_RATIO = 5; // CSN §5.1 strict distance condition
const SQUARE_METRES_TO_SQUARE_CENTIMETRES = 10000;
const LIMITATIONS = Object.freeze([
  'Evaluación en planta y sin blindaje: las paredes, puertas, receptores y materiales dibujados no atenúan estos resultados.',
  'No evalúa suelo, techo, alturas, espesores necesarios ni conformidad de una instalación.',
  'CSN: distribución direccional declarada de la carga; sustituye al U tabulado de la guía. No es la evaluación de barreras con U tabulado.',
  'NCRP: pacientes propios por configuración, sin aplicarles el porcentaje CSN; secundaria integrada con distancia mínima foco/paciente y coeficiente envolvente declarado.',
  'Resultados de kerma en aire, ponderados por ocupación T. No se convierten a dosis efectiva ni a mSv.',
]);

function readNumber(value, label, errors, { min = 0, max = Infinity, allowZero = false } = {}) {
  const allowedType = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  // Number(''), Number(null) and Number(true) must never supply missing physics.
  const number = allowedType ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < min || (!allowZero && number === min) || number > max) {
    errors.push(`${label}: introduce un número ${allowZero ? 'no negativo' : 'positivo'}${max < Infinity ? `, como máximo ${max}` : ''}.`);
    return null;
  }
  return number;
}

function readCoordinate(value, label, errors) {
  const allowedType = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const number = allowedType ? Number(value) : NaN;
  if (!Number.isFinite(number)) {
    errors.push(`${label}: falta una coordenada finita en metros.`);
    return null;
  }
  return number;
}

function readPosition(value, label, errors) {
  if (!value || typeof value !== 'object') {
    errors.push(`${label}: coloca su posición en el plano.`);
    return null;
  }
  const x = readCoordinate(value.x, `${label} X`, errors);
  const y = readCoordinate(value.y, `${label} Y`, errors);
  return x === null || y === null ? null : { x, y };
}

function requireText(value, label, errors) {
  if (typeof value !== 'string' || value.trim() === '') errors.push(`${label}: indica la referencia y las condiciones de los datos.`);
}

function distance(a, b) {
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
}

function positiveDistance(value, label, errors) {
  if (value === null) return null;
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${label}: las posiciones deben ser distintas y su distancia finita.`);
    return null;
  }
  return value;
}

function insideBeam(source, target, point, fullApertureDeg) {
  const beamAngle = Math.atan2(target.y - source.y, target.x - source.x);
  const pointAngle = Math.atan2(point.y - source.y, point.x - source.x);
  const difference = Math.abs(Math.atan2(Math.sin(pointAngle - beamAngle), Math.cos(pointAngle - beamAngle)));
  // Boundary points are included; tolerance only accommodates floating arithmetic.
  return difference <= fullApertureDeg * Math.PI / 360 + 1e-12;
}

function geometry(configuration, point) {
  const errors = [];
  const source = readPosition(configuration.source, 'Foco', errors);
  const target = readPosition(configuration.target, 'Dirección del haz', errors);
  const patient = readPosition(configuration.patient, 'Entrada del haz en el paciente', errors);
  const location = readPosition(point, 'Punto de cálculo', errors);
  const aperture = readNumber(configuration.apertureDeg, 'Apertura completa del haz en planta (°)', errors, { max: 179.999 });
  const directionDistance = positiveDistance(distance(source, target), 'Dirección del haz', errors);
  const sourceDistance_m = positiveDistance(distance(source, location), 'Distancia foco-punto', errors);
  const patientDistance_m = positiveDistance(distance(patient, location), 'Distancia paciente-punto', errors);
  const sourcePatientDistance_m = positiveDistance(distance(source, patient), 'Distancia foco-paciente', errors);
  const beamReady = source && target && aperture !== null && directionDistance !== null;
  const primaryApplies = beamReady && location && sourceDistance_m !== null
    ? insideBeam(source, target, location, aperture) : null;
  if (beamReady && patient && sourcePatientDistance_m !== null && !insideBeam(source, target, patient, aperture)) {
    errors.push('El punto de entrada al paciente debe estar dentro del haz declarado.');
  }
  return { errors, primaryApplies, sourceDistance_m, patientDistance_m, sourcePatientDistance_m };
}

function safeResult(value, label, errors, allowZero = true) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    errors.push(`${label}: el cálculo queda fuera del rango numérico representable.`);
    return null;
  }
  return value;
}

function squaredDistance(value, label, errors) {
  return value === null ? null : safeResult(value ** 2, label, errors, false);
}

function csnConfiguration(configuration, point, totalWorkload, occupancy, commonErrors) {
  const errors = [...commonErrors];
  const percent = readNumber(configuration.usePercent, '% de carga CSN', errors, { allowZero: true, max: 100 });
  const detail = { configurationId: configuration.id, name: configuration.name, primaryApplies: null,
    primary_mGy_per_week: null, scatter_mGy_per_week: null, leakage_mGy_per_week: null, errors };
  if (percent === 0 && !errors.length) {
    return { ...detail, status: 'complete', workload_mA_min_per_week: 0,
      primary_mGy_per_week: 0, scatter_mGy_per_week: 0, leakage_mGy_per_week: 0 };
  }
  const geo = geometry(configuration, point);
  errors.push(...geo.errors);
  Object.assign(detail, { ...geo, errors });
  const data = configuration.csn || {};
  const output = readNumber(data.output_mGy_m2_per_mA_min, 'Rendimiento CSN (mGy·m²/mA·min)', errors);
  const scatter = readNumber(data.scatter_fraction, 'Fracción dispersa CSN', errors, { max: 1 });
  const referenceArea = readNumber(data.reference_field_area_cm2, 'Área de referencia de la fracción dispersa (cm²)', errors);
  const fieldArea = readNumber(data.field_area_cm2, 'Área del campo sobre el paciente (cm²)', errors);
  const largestSide = readNumber(data.largest_field_side_m, 'Lado mayor del campo sobre el paciente (m)', errors);
  const leakage = readNumber(data.leakage_mGy_m2_per_mA_min, 'Rendimiento efectivo de fuga (mGy·m²/mA·min)', errors);
  requireText(data.provenance, 'Procedencia CSN', errors);
  if (fieldArea !== null && largestSide !== null && fieldArea > largestSide ** 2 * SQUARE_METRES_TO_SQUARE_CENTIMETRES * (1 + 1e-12)) {
    errors.push('El área del campo no puede superar el cuadrado de su lado mayor.');
  }
  if (largestSide !== null && geo.patientDistance_m !== null && geo.patientDistance_m <= SCATTER_FAR_FIELD_RATIO * largestSide) {
    errors.push('Dispersión CSN: la distancia paciente-punto debe superar cinco veces el lado mayor del campo.');
  }
  const sourceDistanceSquared = squaredDistance(geo.sourceDistance_m, 'Distancia foco-punto al cuadrado', errors);
  const patientDistanceSquared = squaredDistance(geo.patientDistance_m, 'Distancia paciente-punto al cuadrado', errors);
  const sourcePatientDistanceSquared = squaredDistance(geo.sourcePatientDistance_m, 'Distancia foco-paciente al cuadrado', errors);
  const scatterDenominator = patientDistanceSquared !== null && sourcePatientDistanceSquared !== null
    ? safeResult(patientDistanceSquared * sourcePatientDistanceSquared, 'Denominador de dispersión CSN', errors, false) : null;
  if (!errors.length) {
    const workload = safeResult(totalWorkload * percent / PERCENT_TOTAL, 'Carga de la orientación CSN', errors, false);
    if (workload === null) { detail.status = 'incomplete'; return detail; }
    detail.workload_mA_min_per_week = workload;
    detail.primary_mGy_per_week = safeResult(geo.primaryApplies ? output * workload * occupancy / sourceDistanceSquared : 0, 'Primaria CSN', errors, !geo.primaryApplies);
    detail.scatter_mGy_per_week = safeResult(output * workload * scatter * (fieldArea / referenceArea) * occupancy /
      scatterDenominator, 'Dispersión CSN', errors, false);
    detail.leakage_mGy_per_week = safeResult(leakage * workload * occupancy / sourceDistanceSquared, 'Fuga CSN', errors, false);
  }
  detail.status = errors.length ? 'incomplete' : 'complete';
  return detail;
}

function ncrpConfiguration(configuration, point, occupancy, commonErrors) {
  const errors = [...commonErrors];
  const data = configuration.ncrp || {};
  const patients = readNumber(data.patients_per_week, 'Pacientes/semana propios de esta configuración NCRP', errors, { allowZero: true });
  const detail = { configurationId: configuration.id, name: configuration.name, primaryApplies: null,
    primary_mGy_per_week: null, secondary_mGy_per_week: null, errors };
  if (patients === 0 && !errors.length) {
    return { ...detail, status: 'complete', patients_per_week: 0, primary_mGy_per_week: 0, secondary_mGy_per_week: 0 };
  }
  const geo = geometry(configuration, point);
  errors.push(...geo.errors);
  Object.assign(detail, { ...geo, errors });
  const primary = readNumber(data.primary_mGy_per_patient_at_1m, 'K¹ primaria NCRP (mGy/paciente a 1 m)', errors);
  const secondary = readNumber(data.secondary_mGy_per_patient_at_1m, 'K¹ secundaria NCRP (mGy/paciente a 1 m)', errors);
  requireText(data.profile, 'Perfil NCRP', errors);
  requireText(data.provenance, 'Procedencia NCRP', errors);
  if (data.secondary_envelope_confirmed !== true) {
    errors.push('Confirma que K¹ secundaria incluye dispersión y fuga y es una envolvente válida para todas las direcciones y condiciones evaluadas.');
  }
  const sourceDistanceSquared = squaredDistance(geo.sourceDistance_m, 'Distancia foco-punto al cuadrado', errors);
  const patientDistanceSquared = squaredDistance(geo.patientDistance_m, 'Distancia paciente-punto al cuadrado', errors);
  if (!errors.length) {
    const secondaryDistance = Math.min(geo.sourceDistance_m, geo.patientDistance_m);
    detail.patients_per_week = patients;
    detail.secondaryDistance_m = secondaryDistance;
    detail.primary_mGy_per_week = safeResult(geo.primaryApplies ? primary * patients * occupancy / sourceDistanceSquared : 0, 'Primaria NCRP', errors, !geo.primaryApplies);
    detail.secondary_mGy_per_week = safeResult(secondary * patients * occupancy / Math.min(sourceDistanceSquared, patientDistanceSquared), 'Secundaria NCRP', errors, false);
  }
  detail.status = errors.length ? 'incomplete' : 'complete';
  return detail;
}

function aggregate(details, components, errors) {
  const allErrors = [...errors, ...details.flatMap(detail => detail.errors.map(error => `${detail.name || 'Configuración'}: ${error}`))];
  const output = { status: 'incomplete', errors: [...new Set(allErrors)], details, total_mGy_per_week: null };
  for (const component of components) {
    output[component] = details.length && details.every(d => d.status === 'complete' && d[component] !== null)
      ? safeResult(details.reduce((sum, d) => sum + d[component], 0), component, output.errors) : null;
  }
  if (!output.errors.length && details.length && components.every(component => output[component] !== null)) {
    output.total_mGy_per_week = safeResult(components.reduce((sum, component) => sum + output[component], 0), 'Total', output.errors);
    output.status = output.errors.length ? 'incomplete' : 'complete';
  }
  return output;
}

/** Every component returned is in mGy/week with the point's method-specific T applied. */
export function evaluateShielding(scene = {}) {
  const configurations = Array.isArray(scene.configurations) ? scene.configurations : [];
  const points = Array.isArray(scene.points) ? scene.points : [];
  const commonErrors = [];
  if (scene.calibrated !== true) commonErrors.push('Calibra el plano o declara sus dimensiones antes de calcular.');
  if (!configurations.length) commonErrors.push('Añade al menos una configuración de trabajo.');
  const csnErrors = [...commonErrors];
  const workload = readNumber(scene.csnTotalWorkload, 'Carga total CSN (mA·min/semana)', csnErrors);
  const percentages = configurations.map(c => readNumber(c.usePercent, `${c.name || 'Configuración'}: % de carga CSN`, csnErrors, { allowZero: true, max: 100 }));
  if (percentages.every(p => p !== null) && Math.abs(percentages.reduce((sum, p) => sum + p, 0) - PERCENT_TOTAL) > PERCENT_SUM_TOLERANCE) {
    csnErrors.push('Los porcentajes de carga CSN deben sumar 100 %.');
  }
  const results = points.map(point => {
    const csnPointErrors = [...csnErrors];
    const ncrpPointErrors = [...commonErrors];
    const csnOccupancy = readNumber(point.csn_occupancy, 'Ocupación T CSN del punto', csnPointErrors, { max: 1 });
    const ncrpOccupancy = readNumber(point.ncrp_occupancy, 'Ocupación T NCRP del punto', ncrpPointErrors, { max: 1 });
    const csnDetails = configurations.map(c => csnConfiguration(c, point, workload, csnOccupancy, csnPointErrors));
    const ncrpDetails = configurations.map(c => ncrpConfiguration(c, point, ncrpOccupancy, ncrpPointErrors));
    return { pointId: point.id, name: point.name,
      csn: aggregate(csnDetails, ['primary_mGy_per_week', 'scatter_mGy_per_week', 'leakage_mGy_per_week'], csnPointErrors),
      ncrp: aggregate(ncrpDetails, ['primary_mGy_per_week', 'secondary_mGy_per_week'], ncrpPointErrors) };
  });
  return { scope: 'planar_unshielded', unit: 'mGy/semana', occupancyApplied: true,
    status: results.length && results.every(p => p.csn.status === 'complete' && p.ncrp.status === 'complete') ? 'complete' : 'incomplete',
    limitations: [...LIMITATIONS], errors: points.length ? [] : ['Coloca al menos un punto de cálculo.'], points: results };
}
