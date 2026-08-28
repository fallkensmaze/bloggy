import { useEffect, useMemo, useRef, useState } from 'react'

const CHANNEL_COLORS = [
  '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4dd0e1',
  '#e57373', '#aed581', '#7986cb', '#ffd54f', '#4db6ac'
]

const finiteVector = (coords) => (
  Array.isArray(coords) && coords.length >= 3 && coords.slice(0, 3).every(Number.isFinite)
)

function rotatePoint(point, rotation) {
  const cosX = Math.cos(rotation.x)
  const sinX = Math.sin(rotation.x)
  const cosY = Math.cos(rotation.y)
  const sinY = Math.sin(rotation.y)
  const y = point[1] * cosX - point[2] * sinX
  const z = point[1] * sinX + point[2] * cosX

  return [
    point[0] * cosY + z * sinY,
    y,
    -point[0] * sinY + z * cosY
  ]
}

function drawDiamond(context, x, y, radius) {
  context.beginPath()
  context.moveTo(x, y - radius)
  context.lineTo(x + radius, y)
  context.lineTo(x, y + radius)
  context.lineTo(x - radius, y)
  context.closePath()
}

function formatCoords(coords) {
  return coords.map(value => value.toFixed(1)).join(', ')
}

export default function Tg43Plan3D({ plan, results, doseScope }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const projectedItemsRef = useRef([])
  const dragRef = useRef(null)
  const [size, setSize] = useState({ width: 900, height: 560 })
  const [rotation, setRotation] = useState({ x: -0.55, y: 0.7 })
  const [zoom, setZoom] = useState(1)
  const [hovered, setHovered] = useState(null)

  const scene = useMemo(() => {
    const channels = (plan?.channels || []).map((channel, channelIndex) => ({
      ...channel,
      color: CHANNEL_COLORS[channelIndex % CHANNEL_COLORS.length],
      points: channel.dwells
        .filter(dwell => finiteVector(dwell.coords))
        .map((dwell, dwellIndex) => ({
          coords: dwell.coords.slice(0, 3),
          dwellTime: dwell.dwellTime,
          dwellIndex
        }))
    })).filter(channel => channel.points.length > 0)

    const calculationPoints = (results || [])
      .filter(result => finiteVector(result.coords))
      .map(result => ({
        name: result.name,
        coords: result.coords.slice(0, 3),
        dose: doseScope === 'total'
          ? result.calculatedDoseTotal
          : result.calculatedDosePerFraction
      }))

    const allCoords = [
      ...channels.flatMap(channel => channel.points.map(point => point.coords)),
      ...calculationPoints.map(point => point.coords)
    ]
    const mins = [0, 1, 2].map(axis => Math.min(...allCoords.map(point => point[axis])))
    const maxs = [0, 1, 2].map(axis => Math.max(...allCoords.map(point => point[axis])))
    const center = mins.map((min, axis) => (min + maxs[axis]) / 2)
    const span = Math.max(10, ...maxs.map((max, axis) => max - mins[axis]))

    return { channels, calculationPoints, center, span }
  }, [plan, results, doseScope])

  useEffect(() => {
    if (!containerRef.current) return undefined
    const observer = new ResizeObserver(entries => {
      const width = Math.max(320, Math.floor(entries[0].contentRect.width))
      setSize({ width, height: Math.max(420, Math.min(620, Math.round(width * 0.62))) })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size.width * pixelRatio
    canvas.height = size.height * pixelRatio
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, size.width, size.height)

    const styles = getComputedStyle(canvas)
    const background = styles.getPropertyValue('--bg-tertiary').trim() || '#171b24'
    const muted = styles.getPropertyValue('--text-muted').trim() || '#87909f'
    const border = styles.getPropertyValue('--border-color').trim() || '#343b4a'
    context.fillStyle = background
    context.fillRect(0, 0, size.width, size.height)

    const plotCenter = [size.width / 2, size.height / 2]
    const scale = Math.min(size.width, size.height) * 0.66 / scene.span * zoom
    const project = coords => {
      const centered = coords.map((value, axis) => value - scene.center[axis])
      const rotated = rotatePoint(centered, rotation)
      return {
        x: plotCenter[0] + rotated[0] * scale,
        y: plotCenter[1] - rotated[1] * scale,
        depth: rotated[2]
      }
    }

    const axisLength = scene.span * 0.42
    const axes = [
      { label: 'X', color: '#ef5350', end: [scene.center[0] + axisLength, scene.center[1], scene.center[2]] },
      { label: 'Y', color: '#66bb6a', end: [scene.center[0], scene.center[1] + axisLength, scene.center[2]] },
      { label: 'Z', color: '#42a5f5', end: [scene.center[0], scene.center[1], scene.center[2] + axisLength] }
    ]
    const origin = project(scene.center)
    context.lineWidth = 1.3
    context.font = '600 11px system-ui, sans-serif'
    for (const axis of axes) {
      const end = project(axis.end)
      context.strokeStyle = axis.color
      context.beginPath()
      context.moveTo(origin.x, origin.y)
      context.lineTo(end.x, end.y)
      context.stroke()
      context.fillStyle = axis.color
      context.fillText(axis.label, end.x + 5, end.y - 5)
    }

    const lineSegments = []
    const markers = []
    for (const channel of scene.channels) {
      const projected = channel.points.map(point => ({ ...point, ...project(point.coords) }))
      for (let index = 1; index < projected.length; index += 1) {
        lineSegments.push({
          a: projected[index - 1],
          b: projected[index],
          depth: (projected[index - 1].depth + projected[index].depth) / 2,
          color: channel.color
        })
      }
      projected.forEach(point => markers.push({
        ...point,
        type: 'dwell',
        color: channel.color,
        channelNumber: channel.number,
        setupName: channel.setupName
      }))
    }

    lineSegments.sort((a, b) => a.depth - b.depth)
    for (const segment of lineSegments) {
      context.strokeStyle = `${segment.color}b5`
      context.lineWidth = 2.2
      context.beginPath()
      context.moveTo(segment.a.x, segment.a.y)
      context.lineTo(segment.b.x, segment.b.y)
      context.stroke()
    }

    scene.calculationPoints.forEach(point => markers.push({
      ...point,
      ...project(point.coords),
      type: 'calculation',
      color: '#ff5ca8'
    }))
    markers.sort((a, b) => a.depth - b.depth)

    const positiveTimes = scene.channels.flatMap(channel => channel.points.map(point => point.dwellTime))
      .filter(time => Number.isFinite(time) && time > 0)
    const maxDwellTime = Math.max(1, ...positiveTimes)
    const projectedItems = []

    for (const marker of markers) {
      if (marker.type === 'dwell') {
        const radius = 3.5 + 4 * Math.sqrt(Math.max(0, marker.dwellTime) / maxDwellTime)
        context.fillStyle = marker.color
        context.strokeStyle = background
        context.lineWidth = 1.5
        context.beginPath()
        context.arc(marker.x, marker.y, radius, 0, Math.PI * 2)
        context.fill()
        context.stroke()
        projectedItems.push({ ...marker, radius: radius + 5 })
      } else {
        context.fillStyle = marker.color
        context.strokeStyle = '#fff'
        context.lineWidth = 1.6
        drawDiamond(context, marker.x, marker.y, 8)
        context.fill()
        context.stroke()
        context.fillStyle = '#fff'
        context.font = '600 12px system-ui, sans-serif'
        context.fillText(marker.name, marker.x + 12, marker.y - 9)
        projectedItems.push({ ...marker, radius: 13 })
      }
    }
    projectedItemsRef.current = projectedItems.reverse()

    context.fillStyle = muted
    context.font = '11px system-ui, sans-serif'
    context.fillText('Sistema de coordenadas DICOM · mm', 16, size.height - 18)
    context.strokeStyle = border
    context.strokeRect(0.5, 0.5, size.width - 1, size.height - 1)
  }, [rotation, scene, size, zoom])

  const startDrag = event => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, rotation }
    setHovered(null)
  }

  const movePointer = event => {
    if (dragRef.current) {
      const dx = event.clientX - dragRef.current.x
      const dy = event.clientY - dragRef.current.y
      setRotation({
        x: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, dragRef.current.rotation.x + dy * 0.008)),
        y: dragRef.current.rotation.y + dx * 0.008
      })
      return
    }
    const rect = canvasRef.current.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const item = projectedItemsRef.current.find(candidate => (
      Math.hypot(candidate.x - x, candidate.y - y) <= candidate.radius
    ))
    setHovered(item ? { ...item, left: x, top: y } : null)
  }

  const endDrag = event => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }

  const resetView = () => {
    setRotation({ x: -0.55, y: 0.7 })
    setZoom(1)
    setHovered(null)
  }

  return (
    <div className="tg43-3d-viewer">
      <div className="tg43-3d-toolbar">
        <div className="tg43-3d-legend" aria-label="Leyenda del visor 3D">
          <span><i className="tg43-legend-line" /> Canal</span>
          <span><i className="tg43-legend-dwell" /> Parada (tamaño ∝ tiempo)</span>
          <span><i className="tg43-legend-point" /> Punto de cálculo</span>
        </div>
        <div className="tg43-3d-controls" role="group" aria-label="Controles de la vista 3D">
          <button type="button" onClick={() => setZoom(current => Math.max(0.45, current / 1.2))} aria-label="Alejar">
            <i className="bi bi-dash-lg" />
          </button>
          <button type="button" onClick={() => setZoom(current => Math.min(3.5, current * 1.2))} aria-label="Acercar">
            <i className="bi bi-plus-lg" />
          </button>
          <button type="button" onClick={resetView}>
            <i className="bi bi-arrow-counterclockwise" /> Restablecer
          </button>
        </div>
      </div>
      <div ref={containerRef} className="tg43-3d-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="tg43-3d-canvas"
          aria-label="Vista 3D interactiva de canales, posiciones de parada y puntos de cálculo"
          onPointerDown={startDrag}
          onPointerMove={movePointer}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => !dragRef.current && setHovered(null)}
          onWheel={event => {
            event.preventDefault()
            setZoom(current => Math.max(0.45, Math.min(3.5, current * Math.exp(-event.deltaY * 0.001))))
          }}
        />
        {hovered && (
          <div
            className="tg43-3d-tooltip"
            style={{ left: Math.min(hovered.left + 14, size.width - 235), top: Math.max(8, hovered.top - 12) }}
          >
            {hovered.type === 'dwell' ? (
              <>
                <strong>Canal {hovered.channelNumber} · parada {hovered.dwellIndex + 1}</strong>
                <span>{formatCoords(hovered.coords)} mm</span>
                <span>Tiempo: {hovered.dwellTime.toFixed(2)} s</span>
              </>
            ) : (
              <>
                <strong>{hovered.name}</strong>
                <span>{formatCoords(hovered.coords)} mm</span>
                <span>Dosis: {Number.isFinite(hovered.dose) ? hovered.dose.toFixed(3) : '—'} Gy</span>
              </>
            )}
          </div>
        )}
      </div>
      <p className="tg43-3d-help">
        Arrastra para rotar y usa la rueda o los botones para ampliar. La trayectoria del
        canal se interpola entre posiciones DICOM consecutivas; las paradas y los puntos conservan sus
        coordenadas originales.
      </p>
    </div>
  )
}
