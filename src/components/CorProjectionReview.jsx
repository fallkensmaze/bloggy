import { useEffect, useRef, useState } from 'react'
import { drawGammaPixels } from './GammaImage'
import '../styles/cor-review.css'

const COLORS = ['#67e8f9', '#facc15', '#f0abfc']

export default function CorProjectionReview({ series, results }) {
  const [frameIndex, setFrameIndex] = useState(0)
  const [sourceIndex, setSourceIndex] = useState(0)
  const ref = useRef(null)
  useEffect(() => { setFrameIndex(0); setSourceIndex(0) }, [series])
  const index = Math.min(frameIndex, series.frames.length - 1)
  const meta = series.frameMeta[index]
  const detector = results?.detectors.find(d => d.detectorNumber === meta.detectorNumber)
  const measurements = detector?.frames.find(f => f.frameIndex === index)?.sources || []
  const m = measurements[sourceIndex]
  const frame = series.frames[index]
  useEffect(() => {
    const canvas = ref.current
    drawGammaPixels(canvas, frame, series.rows, series.cols, frame.reduce((a, b) => Math.max(a, b), 0))
    const ctx = canvas.getContext('2d')
    measurements.forEach((source, i) => {
      const { minRow, maxRow, minCol, maxCol } = source.roi
      ctx.strokeStyle = COLORS[i]; ctx.fillStyle = COLORS[i]; ctx.lineWidth = Math.max(0.7, series.cols / 350)
      ctx.setLineDash([3, 3]); ctx.strokeRect(0, minRow, series.cols, maxRow - minRow + 1); ctx.setLineDash([])
      ctx.strokeRect(minCol, minRow, maxCol - minCol + 1, maxRow - minRow + 1)
      ctx.beginPath(); ctx.moveTo(source.x - 3 + .5, source.y + .5); ctx.lineTo(source.x + 3 + .5, source.y + .5)
      ctx.moveTo(source.x + .5, source.y - 3 + .5); ctx.lineTo(source.x + .5, source.y + 3 + .5); ctx.stroke()
      ctx.font = `${Math.max(8, series.cols / 32)}px sans-serif`; ctx.fillText(`F${i + 1}`, minCol, minRow - 2)
    })
  }, [series, index, results])
  const profiles = m ? ['x', 'y'].map(axis => {
    const { minRow, maxRow, minCol, maxCol } = m.roi
    const horizontal = axis === 'x'
    const start = horizontal ? minCol : minRow, end = horizontal ? maxCol : maxRow
    const values = Array.from({ length: end - start + 1 }, (_, i) => {
      let total = 0
      if (horizontal) for (let y = minRow; y <= maxRow; y++) total += frame[y * series.cols + start + i]
      else for (let x = minCol; x <= maxCol; x++) total += frame[(start + i) * series.cols + x]
      return total
    })
    const max = Math.max(...values), coord = p => 30 + 350 * (p - start) / (end - start)
    return <figure key={axis}><svg viewBox="0 0 400 170" role="img" aria-label={`Perfil ${axis.toUpperCase()} de fuente ${sourceIndex + 1}`}>
      <rect x={coord(m.centroidWindows[axis][0])} y="15" width={coord(m.centroidWindows[axis][1]) - coord(m.centroidWindows[axis][0])} height="125" fill="#88c0d022" />
      <line x1="30" x2="380" y1="80" y2="80" stroke="#aaa" strokeDasharray="4 3" />
      <polyline points={values.map((v, i) => `${coord(start + i)},${140 - 120 * v / max}`).join(' ')} fill="none" stroke={COLORS[sourceIndex]} strokeWidth="2" />
      <line x1={coord(m[axis])} x2={coord(m[axis])} y1="15" y2="140" stroke="white" />
      <text x="30" y="160" fill="currentColor" fontSize="12">{axis.toUpperCase()} · {m[axis].toFixed(3)} px · 50 % y ventana del centroide</text>
    </svg></figure>
  }) : null
  return <section className="cor-review">
    <h2>Revisión de las proyecciones</h2>
    <div className="cor-review-controls">
      <button type="button" disabled={index === 0} onClick={() => setFrameIndex(index - 1)}>Anterior</button>
      <label>Proyección <select className="dark-select" value={index} onChange={e => setFrameIndex(Number(e.target.value))}>
        {series.frameMeta.map((f, i) => <option key={i} value={i}>{i + 1} · cabezal {f.detectorNumber} · {f.angleDeg.toFixed(1)}°</option>)}
      </select></label>
      <button type="button" disabled={index === series.frames.length - 1} onClick={() => setFrameIndex(index + 1)}>Siguiente</button>
      <label>Fuente <select className="dark-select" value={sourceIndex} onChange={e => setSourceIndex(Number(e.target.value))}>
        {[0, 1, 2].map(i => <option value={i} key={i}>{i + 1}</option>)}
      </select></label>
    </div>
    <div className="cor-review-grid"><canvas ref={ref} aria-label={`Proyección ${index + 1}, cabezal ${meta.detectorNumber}, fuentes y ROI`}
      style={{ aspectRatio: `${series.cols * (series.pixelSpacing?.[1] || 1)} / ${series.rows * (series.pixelSpacing?.[0] || 1)}` }} />
      <div>{profiles || <p>Imagen disponible para revisar el fallo. No se muestran centroides sin un análisis válido.</p>}
        {m && <p>Fuente {sourceIndex + 1}: X {m.x.toFixed(3)} px · Y {m.y.toFixed(3)} px · pico {m.maximumPixel.toFixed(0)} cuentas.</p>}
      </div></div>
    <p>La cruz marca el centroide; la banda discontinua integra el perfil X y el rectángulo integra el perfil Y. Escala de brillo por proyección, sin modificar los datos del cálculo.</p>
  </section>
}
