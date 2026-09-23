import { useEffect, useRef } from 'react'

export function drawGammaPixels(canvas, data, rows, cols, maximum) {
  canvas.width = cols; canvas.height = rows
  const context = canvas.getContext('2d')
  const image = context.createImageData(cols, rows)
  for (let i = 0; i < data.length; i++) {
    const value = Math.max(0, Math.min(255, Math.round(255 * data[i] / (maximum || 1))))
    image.data[i * 4] = value; image.data[i * 4 + 1] = value; image.data[i * 4 + 2] = value; image.data[i * 4 + 3] = 255
  }
  context.putImageData(image, 0, 0)
}

export default function GammaImage({ image, frameIndex, maximum, roi, onRoi }) {
  const ref = useRef(null), start = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    drawGammaPixels(canvas, image.frames[frameIndex], image.rows, image.cols, maximum)
    if (roi) {
      const context = canvas.getContext('2d')
      context.strokeStyle = '#69e3dc'; context.lineWidth = Math.max(1, image.cols / 300)
      context.strokeRect(roi.x, roi.y, roi.width, roi.height)
    }
  }, [image, frameIndex, maximum, roi])
  const point = event => {
    const rect = ref.current.getBoundingClientRect()
    return { x: Math.max(0, Math.min(image.cols - 1, Math.floor((event.clientX - rect.left) / rect.width * image.cols))),
      y: Math.max(0, Math.min(image.rows - 1, Math.floor((event.clientY - rect.top) / rect.height * image.rows))) }
  }
  return <canvas ref={ref} className={`gamma-image ${onRoi ? 'gamma-selectable' : ''}`}
    aria-label={`Imagen DICOM, frame ${frameIndex + 1}${onRoi ? '. Arrastra para seleccionar una ROI; también puedes editar sus coordenadas.' : ''}`}
    style={{ aspectRatio: `${image.cols * (image.pixelSpacing?.[1] || 1)} / ${image.rows * (image.pixelSpacing?.[0] || 1)}` }}
    onPointerDown={event => { if (onRoi) { start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId) } }}
    onPointerUp={event => {
      if (!onRoi || !start.current) return
      const a = start.current, b = point(event); start.current = null
      if (Math.abs(a.x - b.x) < 6 || Math.abs(a.y - b.y) < 6) return
      onRoi({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 })
    }} onPointerCancel={() => { start.current = null }} />
}

export function GammaProfiles({ result }) {
  const colors = ['#88c0d0', '#a3be8c', '#ebcb8b', '#b48ead', '#d08770']
  return <figure className="gamma-profile"><svg viewBox="0 0 620 190" role="img" aria-label="Cinco perfiles LSF normalizados, líneas de referencia al 50 y 10 por ciento">
    {[0.5, 0.1].map(level => <g key={level}><line x1="35" x2="605" y1={150 - level * 120} y2={150 - level * 120} stroke="#718096" strokeDasharray="4 4" />
      <text x="1" y={154 - level * 120} fill="currentColor" fontSize="11">{level * 100}%</text></g>)}
    {result.profiles.map((p, index) => <polyline key={index} fill="none" stroke={colors[index]} strokeWidth="1.6"
      points={p.values.map((v, i) => `${35 + 570 * i / (p.values.length - 1)},${150 - 120 * (v - p.background) / (p.peak - p.background)}`).join(' ')} />)}
    <text x="35" y="178" fill="currentColor" fontSize="12">0 mm</text><text x="500" y="178" fill="currentColor" fontSize="12">{((result.profiles[0].values.length - 1) * result.spacing).toFixed(1)} mm</text>
  </svg><figcaption>Cinco franjas de {result.stripPixels} píxeles · sin suavizado · cruces interpolados linealmente</figcaption></figure>
}

export function tomographyMosaic(image, selected, maximum) {
  const frames = [...new Set(selected)], tile = 240, columns = Math.min(4, frames.length)
  const canvas = document.createElement('canvas'), scratch = document.createElement('canvas')
  canvas.width = columns * tile; canvas.height = Math.ceil(frames.length / columns) * (tile + 26)
  const context = canvas.getContext('2d'); context.fillStyle = '#10131a'; context.fillRect(0, 0, canvas.width, canvas.height)
  frames.forEach((f, i) => {
    drawGammaPixels(scratch, image.frames[f], image.rows, image.cols, maximum)
    const ratio = image.cols * (image.pixelSpacing?.[1] || 1) / (image.rows * (image.pixelSpacing?.[0] || 1))
    const w = Math.min(tile, tile * ratio), h = Math.min(tile, tile / ratio)
    const x = i % columns * tile, y = Math.floor(i / columns) * (tile + 26)
    context.drawImage(scratch, x + (tile - w) / 2, y + (tile - h) / 2, w, h)
    context.fillStyle = '#fff'; context.font = '14px sans-serif'; context.fillText(`Frame ${f + 1} · escala común`, x + 8, y + tile + 18)
  })
  return canvas
}
