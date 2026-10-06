import { useEffect, useRef, useState } from 'react'

const PLANES = [
  { name: 'Transversal · XY', axes: [0, 1], normal: 2 },
  { name: 'Longitudinal · XZ', axes: [0, 2], normal: 1 },
  { name: 'Longitudinal · YZ', axes: [1, 2], normal: 0 },
]
export const TOMO_COLORS = { minimum: '#70b8ff', maximum: '#ff9176', manual: '#d7a1ff', cylinder: '#71ddc2', margin: '#edcf80' }

function SliceView({ series, plane, cursor, onCursor, cylinder, spheres, windowMax, showOverlays }) {
  const ref = useRef(null), shape = [series.cols, series.rows, series.volume.length]
  const spacing = [series.pixelSpacing[1], series.pixelSpacing[0], series.dz]
  const [a, b] = plane.axes, n = plane.normal, width = shape[a], height = shape[b]
  useEffect(() => {
    const canvas = ref.current, ctx = canvas.getContext('2d')
    canvas.width = width; canvas.height = height
    const image = ctx.createImageData(width, height), p = [...cursor]
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      p[a] = x; p[b] = y
      const value = series.volume[p[2]][p[1] * series.cols + p[0]]
      const gray = Math.round(Math.max(0, Math.min(1, value / windowMax)) * 255), offset = (y * width + x) * 4
      image.data[offset] = gray; image.data[offset + 1] = gray; image.data[offset + 2] = gray; image.data[offset + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
    if (!showOverlays) return
    ctx.lineWidth = Math.max(0.4, width / 300)
    const stroke = () => {
      const color = ctx.strokeStyle, lineWidth = ctx.lineWidth
      ctx.strokeStyle = '#000000bb'; ctx.lineWidth = lineWidth + 0.5; ctx.stroke()
      ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke()
    }
    const ellipse = (x, y, rx, ry) => { ctx.beginPath(); ctx.ellipse(x + 0.5, y + 0.5, rx, ry, 0, 0, 2 * Math.PI); stroke() }
    if (cylinder && Object.values(cylinder).every(Number.isFinite)) {
      for (const inner of [false, true]) {
        const r = cylinder.radiusMm - (inner ? cylinder.radialMarginMm : 0)
        const lo = cylinder.firstSlice - 0.5 + (inner ? cylinder.axialMarginMm / series.dz : 0)
        const hi = cylinder.lastSlice + 0.5 - (inner ? cylinder.axialMarginMm / series.dz : 0)
        ctx.strokeStyle = inner ? TOMO_COLORS.margin : TOMO_COLORS.cylinder
        ctx.setLineDash(inner ? [1.5, 1.5] : [])
        if (r <= 0 || hi < lo) continue
        if (n === 2) {
          if (cursor[2] >= lo && cursor[2] <= hi) ellipse(cylinder.cx, cylinder.cy, r / spacing[0], r / spacing[1])
        } else {
          const offset = (cursor[n] - (n === 0 ? cylinder.cx : cylinder.cy)) * spacing[n]
          if (Math.abs(offset) > r) continue
          const half = Math.sqrt(r * r - offset * offset) / spacing[a], c = a === 0 ? cylinder.cx : cylinder.cy
          ctx.beginPath(); ctx.rect(c - half + 0.5, lo + 0.5, 2 * half, hi - lo); stroke()
        }
      }
    }
    ctx.setLineDash([])
    for (const sphere of spheres) {
      const distance = (cursor[n] - sphere.center[n]) * spacing[n], r = sphere.diameterMm / 2
      if (Math.abs(distance) > r) continue
      const sectionRadius = Math.sqrt(Math.max(0, r * r - distance * distance))
      ctx.strokeStyle = sphere.color
      ellipse(sphere.center[a], sphere.center[b], Math.max(0.3, sectionRadius / spacing[a]), Math.max(0.3, sectionRadius / spacing[b]))
    }
    ctx.strokeStyle = '#ffffffaa'; ctx.setLineDash([1, 2]); ctx.beginPath()
    ctx.moveTo(cursor[a] + 0.5, 0); ctx.lineTo(cursor[a] + 0.5, height)
    ctx.moveTo(0, cursor[b] + 0.5); ctx.lineTo(width, cursor[b] + 0.5); ctx.stroke()
  }, [series, plane, cursor, cylinder, spheres, windowMax, showOverlays, a, b, n, width, height])
  return <figure className="tomo-slice">
    <figcaption><strong>{plane.name}</strong><span>{['X', 'Y', 'Z'][n]}: {cursor[n] + 1} / {shape[n]}</span></figcaption>
    <canvas ref={ref} aria-label={`${plane.name}. Selecciona un punto para mover el cursor 3D.`}
      style={{ aspectRatio: `${width * spacing[a]} / ${height * spacing[b]}` }}
      onPointerDown={event => {
        const rect = event.currentTarget.getBoundingClientRect(), next = [...cursor]
        next[a] = Math.max(0, Math.min(width - 1, Math.floor((event.clientX - rect.left) / rect.width * width)))
        next[b] = Math.max(0, Math.min(height - 1, Math.floor((event.clientY - rect.top) / rect.height * height)))
        onCursor(next)
      }} />
    <input type="range" min="0" max={shape[n] - 1} value={cursor[n]} aria-label={`Posición ${['X', 'Y', 'Z'][n]}`}
      onChange={e => { const next = [...cursor]; next[n] = Number(e.target.value); onCursor(next) }} />
  </figure>
}

export function TomoVolumeViews(props) {
  return <div className="tomo-mpr">{PLANES.map(plane => <SliceView key={plane.normal} {...props} plane={plane} />)}</div>
}

export function TomoGeometry3D({ series, cylinder, spheres }) {
  const [angle, setAngle] = useState(0.7)
  if (!cylinder || !Object.values(cylinder).every(Number.isFinite) || cylinder.radiusMm <= 0) return null
  const spacing = [series.pixelSpacing[1], series.pixelSpacing[0], series.dz]
  const middle = (cylinder.firstSlice + cylinder.lastSlice) / 2
  const origin = [cylinder.cx * spacing[0], cylinder.cy * spacing[1], middle * spacing[2]]
  const height = (cylinder.lastSlice - cylinder.firstSlice + 1) * series.dz
  const scale = 200 / Math.max(2 * cylinder.radiusMm, Math.abs(height), 1)
  const project = p => {
    const [x, y, z] = p.map((v, i) => v - origin[i])
    return [180 + scale * (x * Math.cos(angle) - y * Math.sin(angle)),
      155 + scale * (0.4 * (x * Math.sin(angle) + y * Math.cos(angle)) - 0.85 * z)]
  }
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${project(p).join(',')}`).join(' ')
  const ring = (radius, z) => Array.from({ length: 65 }, (_, i) => [origin[0] + radius * Math.cos(i * Math.PI / 32), origin[1] + radius * Math.sin(i * Math.PI / 32), z])
  const low = (cylinder.firstSlice - 0.5) * series.dz, high = (cylinder.lastSlice + 0.5) * series.dz
  return <div className="tomo-geometry"><h3>Geometría 3D</h3><svg viewBox="0 0 360 310" role="img" aria-label="Cilindro y posiciones tridimensionales de las esferas. Vista geométrica, sin renderizado de intensidades.">
    {[low, high].map(z => <path key={z} d={path(ring(cylinder.radiusMm, z))} fill="none" stroke={TOMO_COLORS.cylinder} />)}
    {[0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].map(t => <path key={t} d={path([low, high].map(z => [origin[0] + cylinder.radiusMm * Math.cos(t), origin[1] + cylinder.radiusMm * Math.sin(t), z]))} stroke={TOMO_COLORS.cylinder} opacity=".5" />)}
    {spheres.map((s, index) => {
      const c = s.center.map((v, i) => v * spacing[i]), r = s.diameterMm / 2
      return <g key={index} stroke={s.color} fill="none">{[0, 1, 2].map(axis => <path key={axis} d={path(Array.from({ length: 49 }, (_, i) => {
        const p = [...c]; p[(axis + 1) % 3] += r * Math.cos(i * Math.PI / 24); p[(axis + 2) % 3] += r * Math.sin(i * Math.PI / 24); return p
      }))} />)}<circle cx={project(c)[0]} cy={project(c)[1]} r="2" fill={s.color} /></g>
    })}
  </svg><label className="gamma-field"><span>Girar la vista</span><input type="range" min="0" max="6.28" step="0.02" value={angle} onChange={e => setAngle(Number(e.target.value))} /></label>
    <p className="gamma-hint">Posiciones y tamaños reales. Los cortes muestran las intensidades del volumen.</p></div>
}
