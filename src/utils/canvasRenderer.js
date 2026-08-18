function hotColor(t) {
  return [
    Math.min(255, Math.round(t * 3 * 255)),
    Math.min(255, Math.max(0, Math.round((t * 3 - 1) * 255))),
    Math.min(255, Math.max(0, Math.round((t * 3 - 2) * 255)))
  ]
}

export function renderCanvas(canvas, data, mask, rows, cols) {
  if (!canvas) {
    console.error('Canvas element is null or undefined')
    return
  }
  
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    console.error('Could not get 2d context from canvas')
    return
  }
  const img = ctx.createImageData(cols, rows)

  let mn = Infinity, mx = -Infinity
  for (let i = 0; i < rows * cols; i++) {
    if (!mask || !mask[i]) {
      if (data[i] < mn) mn = data[i]
      if (data[i] > mx) mx = data[i]
    }
  }

  for (let i = 0; i < rows * cols; i++) {
    let r, g, b
    if (mask && mask[i]) {
      r = 20
      g = 40
      b = 80 // masked → dark blue
    } else {
      const t = mx > mn ? (data[i] - mn) / (mx - mn) : 0
      const rgb = hotColor(t)
      r = rgb[0]
      g = rgb[1]
      b = rgb[2]
    }
    img.data[i * 4] = r
    img.data[i * 4 + 1] = g
    img.data[i * 4 + 2] = b
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}
