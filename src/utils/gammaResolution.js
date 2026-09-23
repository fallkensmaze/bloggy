import { numberOrNull } from './gammaDicom.js'

const mean = values => values.reduce((a, b) => a + b, 0) / values.length
const median = values => { const a = [...values].sort((a, b) => a - b); return (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 }

/** Linear crossings around a single LSF peak; no Gaussian fit or smoothing. */
export function profileWidths(profile, spacing, subtractBackground = false) {
  if (!(spacing > 0) || profile.length < 7 || profile.some(v => !Number.isFinite(v) || v < 0)) throw new Error('Perfil o escala no válido.')
  const edge = Math.max(2, Math.floor(profile.length * 0.1))
  const background = subtractBackground ? median([...profile.slice(0, edge), ...profile.slice(-edge)]) : 0
  const peak = Math.max(...profile), peakIndex = profile.indexOf(peak), height = peak - background
  if (!(height > 0)) throw new Error('Perfil sin señal.')
  function width(fraction) {
    const level = background + fraction * height
    let left = peakIndex, right = peakIndex
    while (left > 0 && profile[left] >= level) left--
    while (right < profile.length - 1 && profile[right] >= level) right++
    if (profile[left] >= level || profile[right] >= level) throw new Error('Perfil truncado: amplía la ROI hasta incluir ambas colas al 10 %.')
    // Disconnected islands above 10% indicate multiple sources/peaks: do not select one silently.
    if (fraction === 0.1 && (profile.slice(0, left).some(v => v >= level) || profile.slice(right + 1).some(v => v >= level))) {
      throw new Error('Más de un pico en el perfil: delimita una única fuente lineal.')
    }
    const l = left + (level - profile[left]) / (profile[left + 1] - profile[left])
    const r = right - 1 + (level - profile[right - 1]) / (profile[right] - profile[right - 1])
    return { left: l, right: r, level, mm: (r - l) * spacing }
  }
  return { fwhm: width(0.5), fwtm: width(0.1), peak, peakIndex, background }
}

/** Auto ROI uses the bright line's covariance, excluding its end regions. */
export function locateLine(data, rows, cols) {
  let peak = 0
  for (const v of data) { if (!Number.isFinite(v) || v < 0) throw new Error('Píxeles no válidos.'); peak = Math.max(peak, v) }
  if (!(peak > 0)) throw new Error('Imagen vacía.')
  let weight = 0, sx = 0, sy = 0, xx = 0, yy = 0, xy = 0
  let minX = cols, maxX = 0, minY = rows, maxY = 0
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const v = data[y * cols + x]
    if (v < peak * 0.15) continue
    weight += v; sx += x * v; sy += y * v; xx += x * x * v; yy += y * y * v; xy += x * y * v
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const cx = sx / weight, cy = sy / weight
  xx = xx / weight - cx * cx; yy = yy / weight - cy * cy; xy = xy / weight - cx * cy
  const axis = yy > xx ? 'X' : 'Y' // axis being MEASURED, perpendicular to the line
  const angle = Math.atan2(2 * xy, xx - yy) / 2 * 180 / Math.PI
  const tiltDegrees = Math.min(Math.abs(angle), Math.abs(90 - Math.abs(angle)))
  const disc = Math.sqrt((xx - yy) ** 2 + 4 * xy ** 2)
  const elongation = (xx + yy + disc) / Math.max(1e-9, xx + yy - disc)
  if (elongation < 16) throw new Error('No se reconoce una fuente lineal aislada (elongación insuficiente).')
  const vertical = axis === 'X'
  const start = vertical ? minY : minX, end = vertical ? maxY : maxX
  const a = Math.ceil(start + (end - start) * 0.2), b = Math.floor(end - (end - start) * 0.2)
  const halfWidth = Math.max(18, Math.ceil(Math.sqrt(vertical ? xx : yy) * 6))
  const c = Math.round(vertical ? cx : cy), limit = vertical ? cols : rows
  const lo = Math.max(0, c - halfWidth), hi = Math.min(limit - 1, c + halfWidth)
  const roi = vertical ? { x: lo, y: a, width: hi - lo + 1, height: b - a + 1 }
    : { x: a, y: lo, width: b - a + 1, height: hi - lo + 1 }
  return { axis, tiltDegrees, elongation, roi }
}

export function analyzeResolution(image, frameIndex, options = {}) {
  if (!image.isStatic) throw new Error('La resolución planar requiere una adquisición NM STATIC.')
  const data = image.frames[frameIndex]
  if (!image.pixelSpacing) throw new Error('Falta PixelSpacing válido; no se puede informar en mm.')
  let line
  if (options.roi) {
    const { x, y, width, height } = options.roi
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 7 || height < 7
      || x + width > image.cols || y + height > image.rows) throw new Error('ROI fuera de imagen o demasiado pequeña.')
    const cropped = new Float64Array(width * height)
    for (let row = 0; row < height; row++) cropped.set(data.subarray((y + row) * image.cols + x, (y + row) * image.cols + x + width), row * width)
    line = locateLine(cropped, height, width)
  } else line = locateLine(data, image.rows, image.cols)
  const axis = ['X', 'Y'].includes(options.axis) ? options.axis : line.axis
  if (axis !== line.axis) throw new Error('El eje elegido no es perpendicular a la fuente lineal detectada.')
  const roi = options.roi ?? line.roi
  const { x, y, width, height } = roi
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 7 || height < 7
    || x + width > image.cols || y + height > image.rows) throw new Error('ROI fuera de imagen o demasiado pequeña.')
  if (line.tiltDegrees > 2) throw new Error('Fuente inclinada más de 2°: realinea la adquisición antes de integrar perfiles (control de esta herramienta).')
  const thickness = numberOrNull(options.stripPixels) ?? 8
  if (!Number.isInteger(thickness) || thickness < 1 || thickness > 8) throw new Error('Usa franjas de 1 a 8 píxeles.')
  const along = axis === 'X' ? height : width
  if (along < thickness * 5) throw new Error('La ROI no admite cinco franjas independientes: amplíala o reduce el ancho de franja.')
  const across = axis === 'X' ? width : height
  const spacing = image.pixelSpacing[axis === 'X' ? 1 : 0]
  const profiles = Array.from({ length: 5 }, (_, i) => {
    const offset = Math.round(i * (along - thickness) / 4)
    const values = Array.from({ length: across }, (_, p) => {
      let sum = 0
      for (let j = 0; j < thickness; j++) {
        const row = axis === 'X' ? y + offset + j : y + p
        const col = axis === 'X' ? x + p : x + offset + j
        sum += data[row * image.cols + col]
      }
      return sum
    })
    return { offset, values, ...profileWidths(values, spacing, options.subtractBackground === true) }
  })
  const fwhmMm = mean(profiles.map(p => p.fwhm.mm)), fwtmMm = mean(profiles.map(p => p.fwtm.mm))
  const warnings = []
  if (fwhmMm / spacing < 10) warnings.push('Menos de 10 muestras por FWHM: muestreo inferior al ideal descrito por IAEA; revisar frente a la referencia.')
  if (profiles.some(p => p.peak < 10000)) warnings.push('Algún perfil tiene menos de 10 000 cuentas en el máximo.')
  if (line.tiltDegrees > 0.5) warnings.push('Inclinación superior a 0,5°: puede ensanchar los perfiles integrados.')
  return { method: 'LSF lineal / gamma-qc-1.0', axis, roi, stripPixels: thickness, spacing,
    tiltDegrees: line.tiltDegrees, fwhmMm, fwtmMm,
    fwhmMinMm: Math.min(...profiles.map(p => p.fwhm.mm)), fwhmMaxMm: Math.max(...profiles.map(p => p.fwhm.mm)),
    profiles, warnings }
}
