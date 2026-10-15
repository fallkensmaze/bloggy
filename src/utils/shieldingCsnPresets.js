// CSN GS 5.11 (October 1990), printed pages 16–18, 21 and 23.
// Only conventional radiography: these are alternative design scenarios, not
// workloads to add together. No CT, mammography or fluoroscopy model is inferred.
export const CSN_REFERENCE_URL = 'https://www.csn.es/documents/10182/896572/GS%2005-11%20Aspectos%20t%C3%A9cnicos%20de%20seguridad%20y%20protecci%C3%B3n%20radiol%C3%B3gica%20de%20instalaciones%20m%C3%A9dicas%20de%20rayos%20X%20para%20diagn%C3%B3stico%20%28Octubre%201990%29';
export const CSN_PRESETS = Object.freeze([
  { id: 'radiography-100', label: 'Radiografía sin radioscopia · 100 kVp', kvp: 100, workload: 160, output: 10, qh: 300 },
  { id: 'radiography-125', label: 'Radiografía sin radioscopia · 125 kVp', kvp: 125, workload: 80, output: 15, qh: 240 },
  { id: 'radiography-150', label: 'Radiografía sin radioscopia · 150 kVp', kvp: 150, workload: 40, output: 20, qh: 200 },
].map(Object.freeze));

export const CSN_OCCUPANCIES = Object.freeze([
  { id: 'full', label: 'Total · personal expuesto, despacho, trabajo o uso desconocido', value: 1 },
  { id: 'partial', label: 'Público · pasillo estrecho, sala de espera o aparcamiento', value: 1 / 4 },
  { id: 'occasional', label: 'Público · exterior, aseo, escalera o ascensor automático', value: 1 / 16 },
].map(Object.freeze));

export const getCsnPreset = id => CSN_PRESETS.find(preset => preset.id === id);

export function createCsnParameters(id) {
  const preset = getCsnPreset(id);
  if (!preset) throw new Error('Perfil CSN desconocido.');
  return {
    preset_id: id, coefficients_modified: false,
    output_mGy_m2_per_mA_min: preset.output,
    scatter_fraction: 0.002, reference_field_area_cm2: 400,
    // Application assumption: a square 20 × 20 cm field. Edit for the real field.
    field_area_cm2: 400, largest_field_side_m: 0.2,
    qh_mA_min_per_hour: preset.qh, leakage_factor: 1, leakage_limit_mGy_per_hour_at_1m: 1,
    leakage_mode: 'derived', leakage_mGy_m2_per_mA_min: 1 / preset.qh,
    provenance: `CSN GS 5.11 (1990): tabla 2, p. 21, W = ${preset.workload} mA·min/semana a ${preset.kvp} kVp; ` +
      `figura 1, p. 23, Γ ≈ ${preset.output} mSv·m²/(mA·min), lectura gráfica redondeada, wolframio, tensión constante, 2 mm Al. ` +
      'Modelo inicial: equivalencia numérica aproximada mSv/mGy = 1 para radiodiagnóstico (p. 18); no es una medida de kerma del equipo. ' +
      `Dispersión a = 0,002 para 400 cm² (p. 17). Fuga: límite 1 mGy/h a 1 m y Qh = ${preset.qh} mA·min/h (p. 18); ` +
      'f = 1 conservador, sin reducción por tensión nominal de la carcasa. Campo inicial 20 × 20 cm: hipótesis editable de la aplicación.',
  };
}

const positive = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value)) && Number(value) > 0;

export function editCsnParameter(data = {}, field, value) {
  const next = { ...data, [field]: value, coefficients_modified: true };
  if (field === 'leakage_mGy_m2_per_mA_min') next.leakage_mode = 'manual';
  if (['qh_mA_min_per_hour', 'leakage_factor', 'leakage_limit_mGy_per_hour_at_1m'].includes(field)) {
    next.leakage_mode = 'derived';
    const q = next.qh_mA_min_per_hour, f = next.leakage_factor, limit = next.leakage_limit_mGy_per_hour_at_1m;
    const leakage = positive(q) && positive(f) && Number(f) <= 1 && positive(limit) ? Number(limit) * Number(f) / Number(q) : NaN;
    next.leakage_mGy_m2_per_mA_min = Number.isFinite(leakage) && leakage > 0 ? leakage : '';
  }
  return next;
}

export function applyCsnOccupancy(point, type) {
  const preset = CSN_OCCUPANCIES.find(item => item.id === type);
  return preset ? { ...point, csn_occupancy_type: type, csn_occupancy: preset.value } :
    { ...point, csn_occupancy_type: 'manual' };
}

// Equal shares are an application starting point, not the guide's tabulated U.
// Manual percentages (including blanks) survive profile changes and new drawing.
export function allocateCsnWorkload(scene) {
  if (!getCsnPreset(scene.csnPresetId) || !scene.configurations.length) return scene;
  return { ...scene, configurations: scene.configurations.map(configuration =>
    configuration.usePercentMode === 'automatic' ?
      { ...configuration, usePercent: 100 / scene.configurations.length } : configuration) };
}

export function applyCsnPreset(scene, presetId) {
  const preset = getCsnPreset(presetId);
  if (!preset) throw new Error('Perfil CSN desconocido.');
  return allocateCsnWorkload({ ...scene, csnPresetId: presetId,
    csnTotalWorkload: preset.workload, csnWorkloadModified: false,
    configurations: scene.configurations.map(configuration => ({ ...configuration, csn: createCsnParameters(presetId) })),
    points: scene.points.map(point => point.csn_occupancy_type !== 'manual' &&
      (point.csn_occupancy === '' || point.csn_occupancy == null) ? applyCsnOccupancy(point, 'full') : point),
  });
}
