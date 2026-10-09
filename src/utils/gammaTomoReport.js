// Selected, calibrated native planes. No anatomical orientation is invented.
export function captureTomoReportViews(series, cursor, maximum, cylinder) {
  const shape = [series.cols, series.rows, series.volume.length]
  const spacing = [series.pixelSpacing[1], series.pixelSpacing[0], series.dz]
  const lower = cylinder ? [Math.floor(cylinder.cx - cylinder.radiusMm / spacing[0]) - 2,
    Math.floor(cylinder.cy - cylinder.radiusMm / spacing[1]) - 2, cylinder.firstSlice] : [0, 0, 0]
  const upper = cylinder ? [Math.ceil(cylinder.cx + cylinder.radiusMm / spacing[0]) + 2,
    Math.ceil(cylinder.cy + cylinder.radiusMm / spacing[1]) + 2, cylinder.lastSlice] : shape.map(n => n - 1)
  const lo = lower.map((v, i) => Math.max(0, Math.min(shape[i] - 1, Math.floor(v))))
  const hi = upper.map((v, i) => Math.max(lo[i], Math.min(shape[i] - 1, Math.ceil(v))))
  return [[0, 1, 2, 'XY'], [0, 2, 1, 'XZ'], [1, 2, 0, 'YZ']].map(([a, b, n, label]) => {
    const width = hi[a] - lo[a] + 1, height = hi[b] - lo[b] + 1
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(width, height), p = [...cursor]
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      p[a] = x + lo[a]; p[b] = y + lo[b]
      const value = Math.round(255 * Math.max(0, Math.min(1, series.volume[p[2]][p[1] * series.cols + p[0]] / maximum)))
      image.data.set([value, value, value, 255], 4 * (y * width + x))
    }
    ctx.putImageData(image, 0, 0)
    return { src: canvas.toDataURL('image/png'), label: `Plano ${label} · ${['X', 'Y', 'Z'][n]} = ${cursor[n] + 1}`,
      aspectRatio: width * spacing[a] / (height * spacing[b]), cursor: [...cursor], maximum, crop: { lo, hi } }
  })
}
