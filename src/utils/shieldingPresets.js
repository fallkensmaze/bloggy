import { createCsnParameters, getCsnPreset } from './shieldingCsnPresets.js';

// Selected numerical reference data, not a copy of the NCRP tables.
// NCRP 147 (2004), Tables 4.3, 4.5 and 4.7, printed pp. 40, 43, 46–47.
// Secondary = leakage + forward/backscatter (the larger tabulated direction).
export const NCRP_REFERENCE_URL = 'https://www.aapm.org/pubs/protected_files/NCRP/NCRP_Report_147_AAPM.pdf';
export const DEFAULT_NCRP_PRESET = 'rad-bucky';
export const NCRP_PRESETS = Object.freeze([
  { id: 'rad-bucky', label: 'Radiología general · bucky mural', profile: 'Rad Room (chest bucky)',
    patients: 120, primary: 2.3, secondary: 0.0073, fieldArea: 1535, referenceDistance: 1.83, fieldWidth: 0.43 },
  { id: 'rad-other', label: 'Radiología general · otras direcciones', profile: 'Rad Room (floor or other barriers)',
    patients: 120, primary: 5.2, secondary: 0.033, fieldArea: 1000, referenceDistance: 1, fieldWidth: Math.sqrt(0.1) },
  { id: 'chest', label: 'Sala dedicada de tórax', profile: 'Chest Room',
    patients: 200, primary: 1.2, secondary: 0.0036, fieldArea: 1535, referenceDistance: 2, fieldWidth: 0.43 },
  { id: 'rf-radiographic', label: 'Sala R&F · tubo radiográfico', profile: 'Rad Tube (R&F room)',
    patients: 25, primary: 5.9, secondary: 0.04, fieldArea: 1000, referenceDistance: 1, fieldWidth: Math.sqrt(0.1) },
].map(Object.freeze));

// NCRP 147 Table 4.1, printed p. 31. Unknown use starts conservatively at T = 1.
export const NCRP_OCCUPANCIES = Object.freeze([
  { id: 'full', label: 'Despacho, control, espera atendida o uso desconocido', value: 1 },
  { id: 'examination', label: 'Exploración o tratamiento', value: 0.5 },
  { id: 'corridor', label: 'Pasillo o habitación de pacientes', value: 0.2 },
  { id: 'corridor-door', label: 'Exterior de puerta de pasillo', value: 0.125 },
  { id: 'occasional', label: 'Almacén, aseo público o espera no atendida', value: 0.05 },
  { id: 'transient', label: 'Escalera o tránsito exterior ocasional', value: 0.025 },
].map(Object.freeze));

export const getNcrpPreset = id => NCRP_PRESETS.find(preset => preset.id === id);
export const presetAperture = preset => 2 * Math.atan(preset.fieldWidth / (2 * preset.referenceDistance)) * 180 / Math.PI;

export function createNcrpParameters(id = DEFAULT_NCRP_PRESET) {
  const preset = getNcrpPreset(id);
  if (!preset) throw new Error('Perfil NCRP desconocido.');
  return {
    preset_id: id, coefficients_modified: false, patients_mode: 'automatic',
    patients_per_week: preset.patients,
    primary_mGy_per_patient_at_1m: preset.primary,
    secondary_mGy_per_patient_at_1m: preset.secondary,
    profile: preset.profile,
    provenance: `NCRP 147 (2004), tablas 4.3, 4.5 y 4.7, pp. 40, 43 y 46–47. ${preset.profile}. ` +
      `N típico de actividad media; campo ${preset.fieldArea} cm² a ${preset.referenceDistance} m. ` +
      'Secundaria total de avance/retrodispersión. Sin preblindaje.',
    secondary_envelope_confirmed: true,
  };
}

export function createShieldingConfiguration({ id, name, source, target, csnPresetId }) {
  const preset = getNcrpPreset(DEFAULT_NCRP_PRESET);
  return { id, name, source: { ...source }, target: { ...target }, patient: { ...target },
    patientFollowsTarget: true, apertureDeg: presetAperture(preset), apertureMode: 'preset',
    usePercent: '', usePercentMode: 'automatic', csn: getCsnPreset(csnPresetId) ? createCsnParameters(csnPresetId) : {}, ncrp: createNcrpParameters() };
}

export function createShieldingPoint({ id, name, x, y, csnPresetId }) {
  return { id, name, x, y, csn_occupancy: getCsnPreset(csnPresetId) ? 1 : '', csn_occupancy_type: getCsnPreset(csnPresetId) ? 'full' : 'unset', ncrp_occupancy: 1, ncrp_occupancy_type: 'full' };
}

/** Equal initial allocation is an application assumption, NOT an NCRP use factor.
 * The tabulated component profiles (e.g. bucky and other barriers) each use the
 * room's N. Only repeated orientations of the SAME profile divide that N.
 * A user-entered N is always kept verbatim, including an intentionally blank input.
 */
export function allocateNcrpPatients(scene) {
  const counts = new Map();
  for (const configuration of scene.configurations) {
    const id = configuration.ncrp?.preset_id;
    if (getNcrpPreset(id)) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return { ...scene, configurations: scene.configurations.map(configuration => {
    const data = configuration.ncrp;
    const preset = getNcrpPreset(data?.preset_id);
    if (!preset || data.patients_mode !== 'automatic') return configuration;
    const patients = preset.patients / counts.get(preset.id);
    return data.patients_per_week === patients ? configuration :
      { ...configuration, ncrp: { ...data, patients_per_week: patients } };
  }) };
}

export function applyNcrpPreset(scene, configurationId, presetId) {
  const preset = getNcrpPreset(presetId);
  if (!preset) throw new Error('Perfil NCRP desconocido.');
  return allocateNcrpPatients({ ...scene, configurations: scene.configurations.map(configuration =>
    configuration.id !== configurationId ? configuration : {
      ...configuration, ncrp: createNcrpParameters(presetId),
      // Profile selection changes physics, never the drawn positions or manual aperture.
      ...(configuration.apertureMode === 'preset' ? { apertureDeg: presetAperture(preset) } : {}),
    }) });
}

export function editNcrpParameter(data = {}, field, value) {
  const next = { ...data, [field]: value };
  if (field === 'patients_per_week') next.patients_mode = 'manual';
  if (['primary_mGy_per_patient_at_1m', 'secondary_mGy_per_patient_at_1m', 'profile', 'provenance'].includes(field)) {
    next.coefficients_modified = true;
  }
  // A new secondary coefficient no longer has the preset's angular applicability.
  if (field === 'secondary_mGy_per_patient_at_1m') next.secondary_envelope_confirmed = false;
  return next;
}

export function applyNcrpOccupancy(point, type) {
  const preset = NCRP_OCCUPANCIES.find(item => item.id === type);
  return preset ? { ...point, ncrp_occupancy_type: type, ncrp_occupancy: preset.value } :
    { ...point, ncrp_occupancy_type: 'manual' };
}
