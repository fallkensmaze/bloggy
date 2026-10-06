// Quantitative complement to visual SPECT uniformity, not a NEMA/SEFM verdict.
// Coordinates are voxel-centre indices; all distances and kernels use mm.
export const TOMO_METHOD = 'spect-sphere-uniformity-1.0'
const EPS = 1e-8

export function volumeGeometry(series) {
  const { rows, cols, volume, pixelSpacing, dz } = series
  const spacing = [pixelSpacing?.[1], pixelSpacing?.[0], dz]
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 2 || cols < 2
    || !Array.isArray(volume) || volume.length < 2 || spacing.some(v => !Number.isFinite(v) || v <= 0)
    || volume.some(v => v.length !== rows * cols)) throw new Error('Volumen o espaciado 3D inválido.')
  if (rows * cols * volume.length > 32_000_000) throw new Error('El volumen supera el límite de 32 millones de vóxeles de esta herramienta.')
  return { rows, cols, depth: volume.length, spacing }
}

export function validateCylinder(series, cylinder) {
  const g = volumeGeometry(series), [sx, sy, sz] = g.spacing
  const { cx, cy, radiusMm, firstSlice, lastSlice, radialMarginMm, axialMarginMm } = cylinder
  if ([cx, cy, radiusMm, firstSlice, lastSlice, radialMarginMm, axialMarginMm].some(v => !Number.isFinite(v))) {
    throw new Error('Completa todos los campos del cilindro y de los márgenes.')
  }
  if (radiusMm <= 0 || radialMarginMm < 0 || axialMarginMm < 0 || radiusMm <= radialMarginMm
    || !Number.isInteger(firstSlice) || !Number.isInteger(lastSlice) || firstSlice < 0 || lastSlice >= g.depth
    || lastSlice < firstSlice || (lastSlice - firstSlice + 1) * sz <= 2 * axialMarginMm) {
    throw new Error('El cilindro o sus márgenes no dejan un volumen interior válido.')
  }
  if ((cx + 0.5) * sx + EPS < radiusMm || (g.cols - 0.5 - cx) * sx + EPS < radiusMm
    || (cy + 0.5) * sy + EPS < radiusMm || (g.rows - 0.5 - cy) * sy + EPS < radiusMm) {
    throw new Error('El cilindro se sale de la matriz. Revisa el centro y el radio.')
  }
  return { ...g, innerRadius: radiusMm - radialMarginMm,
    zLow: (firstSlice - 0.5) * sz + axialMarginMm,
    zHigh: (lastSlice + 0.5) * sz - axialMarginMm }
}

export function sphereFits(series, cylinder, center, diameterMm) {
  const g = validateCylinder(series, cylinder), r = diameterMm / 2
  const [sx, sy, sz] = g.spacing, [x, y, z] = center
  return Number.isFinite(r) && r > 0 && center.every(Number.isInteger)
    && x >= 0 && x < g.cols && y >= 0 && y < g.rows && z >= 0 && z < g.depth
    && Math.hypot((x - cylinder.cx) * sx, (y - cylinder.cy) * sy) + r <= g.innerRadius + EPS
    && z * sz - r >= g.zLow - EPS && z * sz + r <= g.zHigh + EPS
}

// Exact voxel-centre top-hat sphere represented as contiguous X rows.
// Row prefix sums reduce work from O(r^3) to O(r^2) per tested centre.
export function sphereKernel(diameterMm, spacing) {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0 || spacing.some(v => !Number.isFinite(v) || v <= 0)) {
    throw new Error('El diámetro y los espaciados deben ser positivos.')
  }
  const r2 = (diameterMm / 2) ** 2, [sx, sy, sz] = spacing, rows = []
  let voxelCount = 0
  for (let z = -Math.floor(diameterMm / 2 / sz); z <= Math.floor(diameterMm / 2 / sz); z++) {
    for (let y = -Math.floor(diameterMm / 2 / sy); y <= Math.floor(diameterMm / 2 / sy); y++) {
      const remaining = r2 - (z * sz) ** 2 - (y * sy) ** 2
      if (remaining < -EPS) continue
      const half = Math.floor(Math.sqrt(Math.max(0, remaining)) / sx + EPS)
      rows.push({ y, z, half }); voxelCount += 2 * half + 1
    }
  }
  return { rows, voxelCount, sampledVolumeMl: voxelCount * sx * sy * sz / 1000 }
}

function prefixVolume(series) {
  const { rows, cols } = volumeGeometry(series)
  return series.volume.map(frame => {
    const prefix = new Float64Array(rows * (cols + 1))
    for (let y = 0; y < rows; y++) {
      let total = 0
      for (let x = 0; x < cols; x++) {
        const value = frame[y * cols + x]
        if (!Number.isFinite(value)) throw new Error('El volumen contiene valores no finitos; no se excluyen silenciosamente.')
        total += value; prefix[y * (cols + 1) + x + 1] = total
      }
    }
    return prefix
  })
}

function kernelMean(prefix, cols, kernel, x, y, z) {
  let sum = 0
  for (const row of kernel.rows) {
    const base = (y + row.y) * (cols + 1), p = prefix[z + row.z]
    sum += p[base + x + row.half + 1] - p[base + x - row.half]
  }
  return sum / kernel.voxelCount
}

export function measureSphere(series, cylinder, center, diameterMm) {
  if (!sphereFits(series, cylinder, center, diameterMm)) throw new Error('La esfera no cabe con los márgenes seleccionados. Mueve el cursor o reduce su diámetro.')
  const kernel = sphereKernel(diameterMm, volumeGeometry(series).spacing)
  let sum = 0
  for (const row of kernel.rows) {
    for (let dx = -row.half; dx <= row.half; dx++) {
      const value = series.volume[center[2] + row.z][(center[1] + row.y) * series.cols + center[0] + dx]
      if (!Number.isFinite(value)) throw new Error('La esfera contiene valores no finitos.')
      sum += value
    }
  }
  return { center: [...center], diameterMm, mean: sum / kernel.voxelCount,
    voxelCount: kernel.voxelCount, sampledVolumeMl: kernel.sampledVolumeMl }
}

function referenceStatistics(series, cylinder, g) {
  let count = 0, mean = 0, m2 = 0, min = Infinity, max = -Infinity
  const [sx, sy, sz] = g.spacing
  for (let z = 0; z < g.depth; z++) {
    if (z * sz < g.zLow - EPS || z * sz > g.zHigh + EPS) continue
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      if (Math.hypot((x - cylinder.cx) * sx, (y - cylinder.cy) * sy) > g.innerRadius + EPS) continue
      const value = series.volume[z][y * g.cols + x]
      const delta = value - mean; count++; mean += delta / count; m2 += delta * (value - mean)
      min = Math.min(min, value); max = Math.max(max, value)
    }
  }
  if (!count || !(mean > 0)) throw new Error('La región de referencia está vacía o su media no es positiva.')
  return { count, mean, minVoxel: min, maxVoxel: max, sd: Math.sqrt(Math.max(0, m2 / count)),
    sampledVolumeMl: count * sx * sy * sz / 1000 }
}

export function diameterRange(min, max, step) {
  if (![min, max, step].every(Number.isFinite) || min <= 0 || max < min || step <= 0) throw new Error('Revisa el rango de diámetros y su incremento.')
  const n = Math.floor((max - min) / step + EPS) + 1
  if (n > 40) throw new Error('Selecciona como máximo 40 diámetros por análisis.')
  return Array.from({ length: n }, (_, i) => Number((min + i * step).toFixed(6)))
}

function quantile(sorted, q) {
  const p = (sorted.length - 1) * q, lo = Math.floor(p)
  return sorted[lo] + (sorted[Math.ceil(p)] - sorted[lo]) * (p - lo)
}

export function analyzeTomoUniformity(series, config, onProgress) {
  const { cylinder, diametersMm, stride = 1, centerMode = 'per-diameter' } = config
  const g = validateCylinder(series, cylinder), [sx, sy, sz] = g.spacing
  if (!Array.isArray(diametersMm) || !diametersMm.length || diametersMm.length > 40
    || diametersMm.some(v => !Number.isFinite(v) || v <= 0)
    || !Number.isInteger(stride) || stride < 1 || stride > 8
    || !['per-diameter', 'common'].includes(centerMode)) throw new Error('Parámetros del barrido inválidos.')
  const diameters = [...new Set(diametersMm)].sort((a, b) => a - b), largest = diameters.at(-1)
  const prefix = prefixVolume(series), reference = referenceStatistics(series, cylinder, g)
  const results = []
  for (let index = 0; index < diameters.length; index++) {
    const diameterMm = diameters[index], fitRadius = (centerMode === 'common' ? largest : diameterMm) / 2
    const allowedRadius = g.innerRadius - fitRadius
    const zMin = Math.max(0, Math.ceil((g.zLow + fitRadius) / sz - EPS))
    const zMax = Math.min(g.depth - 1, Math.floor((g.zHigh - fitRadius) / sz + EPS))
    const row = { diameterMm, centerCount: 0, valid: false }
    if (allowedRadius < -EPS || zMin > zMax) {
      results.push({ ...row, reason: 'La esfera no cabe en el volumen con estos márgenes.' }); continue
    }
    const kernel = sphereKernel(diameterMm, g.spacing), values = []
    let minimum = null, maximum = null
    // Grid anchored at voxel (0,0,0), invariant across diameters and margins.
    const startZ = Math.ceil(zMin / stride) * stride
    for (let z = startZ; z <= zMax; z += stride) {
      for (let y = 0; y < g.rows; y += stride) {
        const y2 = ((y - cylinder.cy) * sy) ** 2
        if (y2 > allowedRadius ** 2 + EPS) continue
        for (let x = 0; x < g.cols; x += stride) {
          if (((x - cylinder.cx) * sx) ** 2 + y2 > allowedRadius ** 2 + EPS) continue
          const value = kernelMean(prefix, g.cols, kernel, x, y, z)
          const center = [x, y, z]
          if (!minimum || value < minimum.mean) minimum = { mean: value, center }
          if (!maximum || value > maximum.mean) maximum = { mean: value, center }
          values.push(value)
        }
      }
      if ((z - startZ) % (4 * stride) === 0) onProgress?.({ fraction: (index + (z - zMin) / Math.max(1, zMax - zMin + 1)) / diameters.length, diameterMm })
    }
    if (!values.length) {
      results.push({ ...row, reason: 'No hay centros en la rejilla seleccionada; reduce el paso o el diámetro.' }); continue
    }
    values.sort((a, b) => a - b)
    results.push({ ...row, valid: true, centerCount: values.length, voxelCount: kernel.voxelCount,
      sampledVolumeMl: kernel.sampledVolumeMl, minimum, maximum,
      minimumPercent: 100 * minimum.mean / reference.mean, maximumPercent: 100 * maximum.mean / reference.mean,
      p05: quantile(values, 0.05), p95: quantile(values, 0.95),
      uniformityPercent: minimum.mean >= 0 && maximum.mean > 0
        ? 100 * (maximum.mean - minimum.mean) / (maximum.mean + minimum.mean) : null })
    onProgress?.({ fraction: (index + 1) / diameters.length, diameterMm })
  }
  if (!results.some(r => r.valid)) throw new Error('Ningún diámetro tiene posiciones válidas. Reduce los diámetros, el margen o el paso.')
  const warnings = []
  if (diameters[0] < 2 * Math.max(...g.spacing)) warnings.push('Los diámetros pequeños están pobremente muestreados. Consulta el número de vóxeles y el volumen efectivo; varios diámetros pueden representar el mismo núcleo.')
  if (stride > 1) warnings.push('Barrido submuestreado: los extremos son los de la rejilla elegida, no los de todos los centros de vóxel.')
  if (reference.minVoxel < 0) warnings.push('Se conservan los valores negativos de la reconstrucción. U3D no se calcula cuando una media es negativa.')
  return { method: TOMO_METHOD, createdAt: new Date().toISOString(), config: structuredClone(config),
    geometry: { rows: g.rows, cols: g.cols, depth: g.depth, spacingMm: g.spacing },
    info: structuredClone(series.info || {}), units: series.units || 'u.a.', reference, results, warnings,
    scope: 'Medida complementaria experimental. Sin tolerancia normativa ni veredicto de conformidad.' }
}

export function proposeCylinder(series) {
  const { rows, cols, depth, spacing } = volumeGeometry(series), [sx, sy] = spacing
  const sums = series.volume.map(f => f.reduce((a, b) => a + Math.max(0, b), 0))
  const threshold = sums.reduce((peak, v) => Math.max(peak, v), 0) * 0.25
  let firstSlice = sums.findIndex(v => v > threshold), lastSlice = sums.findLastIndex(v => v > threshold)
  if (firstSlice < 0) { firstSlice = 0; lastSlice = depth - 1 }
  const frame = series.volume[Math.floor((firstSlice + lastSlice) / 2)]
  let peak = 0; for (const v of frame) peak = Math.max(peak, v)
  let xmin = cols, xmax = -1, ymin = rows, ymax = -1
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (frame[y * cols + x] > 0.35 * peak) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y)
  }
  const cx = xmax >= xmin ? (xmin + xmax) / 2 : (cols - 1) / 2
  const cy = ymax >= ymin ? (ymin + ymax) / 2 : (rows - 1) / 2
  const radiusMm = xmax >= xmin ? Math.min((xmax - xmin + 1) * sx, (ymax - ymin + 1) * sy) / 2 : Math.min(cols * sx, rows * sy) / 3
  return { cx, cy, radiusMm, firstSlice, lastSlice, radialMarginMm: 10, axialMarginMm: 10 }
}

export function makeTomoDemo() {
  const rows = 64, cols = 64, depth = 48, pixelSpacing = [3, 3], dz = 4
  const volume = Array.from({ length: depth }, (_, z) => Float32Array.from({ length: rows * cols }, (_, i) => {
    const x = (i % cols - 31.5) * 3, y = (Math.floor(i / cols) - 31.5) * 3, zz = (z - 23.5) * 4
    const radial = Math.hypot(x, y)
    if (radial > 78 || Math.abs(zz) > 82) return 0
    const ring = 16 * Math.exp(-(((radial - 42) / 4) ** 2))
    const cold = -28 * Math.exp(-(x ** 2 + (y + 18) ** 2 + (zz - 22) ** 2) / (2 * 12 ** 2))
    return 100 + ring + cold + 2 * Math.sin(i * 3.17 + z * 1.31)
  }))
  return { rows, cols, volume, pixelSpacing, dz, units: 'u.a.', warnings: [],
    info: { equipment: 'Volumen sintético', seriesDescription: 'Cilindro con anillo caliente y defecto frío 3D', demo: true } }
}

export function tomoResultsCsv(result) {
  const header = ['diameter_mm', 'centres', 'kernel_voxels', 'sampled_volume_ml', 'minimum_mean', 'maximum_mean', 'minimum_percent', 'maximum_percent', 'U3D_percent', 'P05', 'P95', 'min_x', 'min_y', 'min_z', 'max_x', 'max_y', 'max_z']
  return [header.join(','), ...result.results.filter(r => r.valid).map(r => [r.diameterMm, r.centerCount, r.voxelCount, r.sampledVolumeMl,
    r.minimum.mean, r.maximum.mean, r.minimumPercent, r.maximumPercent, r.uniformityPercent, r.p05, r.p95, ...r.minimum.center, ...r.maximum.center].join(','))].join('\n')
}
