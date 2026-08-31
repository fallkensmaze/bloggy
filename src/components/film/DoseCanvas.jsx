import { useEffect, useMemo, useRef, useState } from 'react'

const STOPS = [
  [0, [46, 52, 64]],
  [0.12, [94, 79, 162]],
  [0.28, [72, 126, 176]],
  [0.45, [78, 168, 167]],
  [0.62, [163, 190, 140]],
  [0.8, [235, 203, 139]],
  [1, [191, 97, 106]]
]

function colorAt(value) {
  const normalized = Math.max(0, Math.min(1, value))
  for (let index = 1; index < STOPS.length; index++) {
    if (normalized <= STOPS[index][0]) {
      const [x0, c0] = STOPS[index - 1]
      const [x1, c1] = STOPS[index]
      const fraction = (normalized - x0) / (x1 - x0)
      return c0.map((channel, axis) => Math.round(channel + fraction * (c1[axis] - channel)))
    }
  }
  return STOPS[STOPS.length - 1][1]
}

function finiteMaximum(values) {
  let maximum = 0
  for (const value of values || []) if (Number.isFinite(value)) maximum = Math.max(maximum, value)
  return maximum || 1
}

export default function DoseCanvas({
  values,
  width,
  height,
  unit = 'Gy',
  maximum,
  invalid,
  outOfRange,
  saturated,
  title = 'Mapa de dosis'
}) {
  const canvasRef = useRef(null)
  const [hover, setHover] = useState(null)
  const scaleMaximum = useMemo(() => maximum || finiteMaximum(values), [maximum, values])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !values || !width || !height) return
    const longest = Math.max(width, height)
    const scale = Math.min(1, 1100 / longest)
    const displayWidth = Math.max(1, Math.round(width * scale))
    const displayHeight = Math.max(1, Math.round(height * scale))
    canvas.width = displayWidth
    canvas.height = displayHeight
    canvas.style.aspectRatio = `${width} / ${height}`
    const context = canvas.getContext('2d')
    const image = context.createImageData(displayWidth, displayHeight)

    for (let y = 0; y < displayHeight; y++) {
      const sourceY = Math.min(height - 1, Math.floor(y / scale))
      for (let x = 0; x < displayWidth; x++) {
        const sourceX = Math.min(width - 1, Math.floor(x / scale))
        const source = sourceY * width + sourceX
        const target = (y * displayWidth + x) * 4
        let color
        if (invalid?.[source]) color = [35, 38, 46]
        else if (saturated?.[source]) color = [180, 80, 190]
        else if (outOfRange?.[source]) color = [235, 160, 75]
        else color = colorAt(values[source] / scaleMaximum)
        image.data[target] = color[0]
        image.data[target + 1] = color[1]
        image.data[target + 2] = color[2]
        image.data[target + 3] = 255
      }
    }
    context.putImageData(image, 0, 0)
  }, [height, invalid, outOfRange, saturated, scaleMaximum, values, width])

  const onPointerMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.min(width - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * width)))
    const y = Math.min(height - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * height)))
    const index = y * width + x
    setHover({ x, y, value: values[index], invalid: Boolean(invalid?.[index]) })
  }

  return (
    <div className="film-map-card">
      <div className="film-map-heading">
        <strong>{title}</strong>
        <span>{hover ? `x=${hover.x}, y=${hover.y}: ${hover.invalid || !Number.isFinite(hover.value) ? 'no válido' : `${hover.value.toFixed(3)} ${unit}`}` : `0–${scaleMaximum.toFixed(2)} ${unit}`}</span>
      </div>
      <canvas ref={canvasRef} className="film-dose-canvas" onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)} />
      <div className="film-color-scale">
        <span>0</span>
        <div />
        <span>{scaleMaximum.toFixed(2)} {unit}</span>
      </div>
      {(outOfRange || saturated) && (
        <div className="film-map-legend">
          <span><i className="film-swatch film-swatch-range" />Fuera de calibración</span>
          <span><i className="film-swatch film-swatch-saturated" />Saturado</span>
        </div>
      )}
    </div>
  )
}
