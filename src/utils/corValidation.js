// Declarations belong to the current acquisition only. Never persist or inherit them.
export const COR_DECLARATIONS = [
  ['sources', 'Tres fuentes Tc-99m/Co-57 de ≤5 mm, coplanares y colocadas según §4.1; fuente central en el eje y centro del FOV (±5 mm)'],
  ['collimator', 'Colimador de alta resolución y ventana de energía del protocolo clínico documentado'],
  ['noTable', 'Sin mesa ni soporte interpuesto entre las fuentes y el detector en ninguna vista'],
  ['counts', 'Los valores representan cuentas; calibración espacial y correcciones de adquisición revisadas'],
  ['orientation', 'Misma orientación axial e identidad de las tres fuentes entre cabezales'],
  ['reviewed', 'He revisado las fuentes y sus ROI en todas las proyecciones']
]

export function corNumber(value) {
  if (value == null || String(value).trim() === '') return NaN
  return Number(value)
}

export function evaluateCorAcquisition(results, declaration = {}) {
  if (!results) return [{ id: 'data', label: 'Adquisición analizada', pass: null }]
  const a = results.acquisition
  const checks = [
    { id: 'pixel', label: 'Píxel <5 mm', pass: a.pixelSizeUnder5Mm },
    { id: 'roi', label: 'ROI efectiva de 40–50 mm por eje', pass: a.roiSizeValid },
    { id: 'scaling', label: 'Sin reescalado de las cuentas', pass: a.countsUnscaled === false ? false : a.countsUnscaled === true || declaration.counts === 'yes' ? true : null }
  ]
  const manualRadius = corNumber(declaration.radiusMm)
  const radii = a.radiiMm || []
  const known = radii.filter(v => Number.isFinite(v))
  const radiusValues = radii.map(v => Number.isFinite(v) ? v : manualRadius)
  // 0.5 mm is a tool allowance for recorded/entered rounding, not a NEMA tolerance.
  const inRange = v => v > 0 && Math.abs(v - 200) <= 0.5
  checks.push({ id: 'radius', label: 'Radio 200 mm (margen de redondeo de la herramienta: 0,5 mm)',
    pass: known.some(v => !inRange(v)) ? false : !radiusValues.length || radiusValues.some(v => !Number.isFinite(v)) ? null : radiusValues.every(inRange),
    detail: `${known.length}/${radii.length} radios DICOM conocidos${Number.isFinite(manualRadius) ? `; declaración para los ausentes: ${manualRadius} mm` : ''}` })
  const labels = { evenViews: 'Número par de vistas', enoughViews: 'Al menos 8 vistas', uniformAngles: 'Muestreo uniforme de 360°',
    includesZero: 'Vista 0°', includes180: 'Vista 180°', enoughCountsAtZero: 'Pico ≥5000 cuentas por fuente a 0°', underMaximumCountRate: 'Tasa ≤20000 cps' }
  if (!a.detectorChecks?.length) checks.push({ id: 'heads', label: 'Cabezal identificado', pass: false })
  for (const head of a.detectorChecks || []) for (const [key, label] of Object.entries(labels)) {
    checks.push({ id: `${head.detectorNumber}:${key}`, label: `Cabezal ${head.detectorNumber}: ${label}`, pass: head[key] ?? null })
  }
  for (const [id, label] of COR_DECLARATIONS) checks.push({ id, label, pass: declaration[id] === 'yes' ? true : declaration[id] === 'no' ? false : null })
  return checks
}

export function corCentroidsCsv(results) {
  const lines = ['detector,source,frame,view,angle_deg,x_px,y_px,cor_mm,roi_x0,roi_y0,roi_x1,roi_y1']
  for (const detector of results.detectors) for (const source of detector.sources) for (const m of source.measurements) {
    lines.push([detector.detectorNumber, source.sourceIndex + 1, m.frameIndex + 1, m.viewNumber, m.angleDeg,
      m.x, m.y, source.corMm, m.roi.minCol, m.roi.minRow, m.roi.maxCol, m.roi.maxRow].join(','))
  }
  return lines.join('\n') + '\n'
}
