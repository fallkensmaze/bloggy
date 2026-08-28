const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const scratchCanvases = new WeakMap()

function fieldColour(value) {
  const v = clamp(value, -1, 1)
  const base = [15, 23, 35]
  if (v < 0) {
    const t = -v
    return [Math.round(base[0] + 47 * t), Math.round(base[1] + 119 * t), Math.round(base[2] + 220 * t)]
  }
  return [Math.round(base[0] + 240 * v), Math.round(base[1] + 78 * v), Math.round(base[2] + 23 * v)]
}

export function renderFdtdFrame(canvas, field, metal, material, nx, ny, absorberCells, previousScale = 0.08) {
  const context = canvas.getContext('2d', { alpha: false })
  let scratch = scratchCanvases.get(canvas)
  if (!scratch) {
    scratch = document.createElement('canvas')
    scratchCanvases.set(canvas, scratch)
  }
  if (scratch.width !== nx) scratch.width = nx
  if (scratch.height !== ny) scratch.height = ny
  const scratchContext = scratch.getContext('2d', { alpha: false })
  const image = scratchContext.createImageData(nx, ny)

  let peak = 0
  for (let i = 0; i < field.length; i += 1) peak = Math.max(peak, Math.abs(field[i]))
  const targetScale = Math.max(0.025, peak * 0.82)
  const scale = previousScale * 0.88 + targetScale * 0.12

  for (let i = 0; i < field.length; i += 1) {
    const [r, g, b] = fieldColour(field[i] / scale)
    const offset = i * 4
    const dielectric = material[i] > 1
    image.data[offset] = dielectric ? Math.round(r * 0.72 + 30) : r
    image.data[offset + 1] = dielectric ? Math.round(g * 0.82 + 22) : g
    image.data[offset + 2] = dielectric ? Math.min(255, Math.round(b * 1.08 + 15)) : b
    image.data[offset + 3] = 255
  }
  scratchContext.putImageData(image, 0, 0)
  context.imageSmoothingEnabled = false
  context.drawImage(scratch, 0, 0, canvas.width, canvas.height)

  const sx = canvas.width / nx
  const sy = canvas.height / ny
  context.fillStyle = '#f0d58a'
  for (let i = 0; i < metal.length; i += 1) {
    if (!metal[i]) continue
    const x = i % nx
    const y = Math.floor(i / nx)
    context.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy))
  }

  const absorberX = absorberCells * sx
  const absorberY = absorberCells * sy
  context.strokeStyle = 'rgba(136, 192, 208, 0.55)'
  context.lineWidth = 1
  context.setLineDash([5, 5])
  context.strokeRect(absorberX, absorberY, canvas.width - 2 * absorberX, canvas.height - 2 * absorberY)
  context.setLineDash([])

  const gradient = context.createLinearGradient(18, 0, 142, 0)
  gradient.addColorStop(0, '#3e8efa')
  gradient.addColorStop(0.5, '#0f1723')
  gradient.addColorStop(1, '#ff653a')
  context.fillStyle = 'rgba(26, 30, 38, 0.82)'
  context.fillRect(12, canvas.height - 36, 146, 24)
  context.fillStyle = gradient
  context.fillRect(20, canvas.height - 28, 130, 8)

  return scale
}
