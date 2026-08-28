import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function rotatePoint(point, rotation) {
  const cosX = Math.cos(rotation.x)
  const sinX = Math.sin(rotation.x)
  const cosY = Math.cos(rotation.y)
  const sinY = Math.sin(rotation.y)
  const y = point[1] * cosX - point[2] * sinX
  const z = point[1] * sinX + point[2] * cosX
  return [point[0] * cosY + z * sinY, y, -point[0] * sinY + z * cosY]
}

function fieldColour(value, magnitudeOnly = false) {
  const intensity = clamp(Math.abs(value), 0, 1)
  if (magnitudeOnly) return `rgba(240, 213, 138, ${0.1 + 0.82 * intensity})`
  return value < 0
    ? `rgba(62, 142, 250, ${0.12 + 0.78 * intensity})`
    : `rgba(255, 101, 58, ${0.12 + 0.78 * intensity})`
}

function drawCartesianFrame(context, frame, size, rotation, zoom) {
  const { volume, gridX, gridY, gridZ, conductorPoints, scale, fieldKind, absorberCells } = frame
  if (!volume?.length) return
  const usableX = Math.max(8, gridX - 2 * absorberCells)
  const usableY = Math.max(8, gridY - 2 * absorberCells)
  const usableZ = Math.max(8, gridZ - 2 * absorberCells)
  const normalizer = Math.max(usableX, usableY, usableZ) / 1.7
  const cameraScale = Math.min(size.width, size.height) * 0.39 * zoom
  const project = point => {
    const rotated = rotatePoint(point, rotation)
    const perspective = 1 / Math.max(0.55, 1 + rotated[2] * 0.2)
    return { x: size.width / 2 + rotated[0] * cameraScale * perspective, y: size.height / 2 - rotated[1] * cameraScale * perspective, depth: rotated[2], perspective }
  }
  const world = (x, y, z) => [(x - gridX / 2) / normalizer, (z - gridZ / 2) / normalizer, (y - gridY / 2) / normalizer]
  const x0 = absorberCells
  const x1 = gridX - absorberCells
  const y0 = absorberCells
  const y1 = gridY - absorberCells
  const z0 = absorberCells
  const z1 = gridZ - absorberCells
  const corners = [
    world(x0, y0, z0), world(x1, y0, z0), world(x1, y1, z0), world(x0, y1, z0),
    world(x0, y0, z1), world(x1, y0, z1), world(x1, y1, z1), world(x0, y1, z1)
  ].map(project)
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  context.strokeStyle = 'rgba(136, 192, 208, .22)'
  context.lineWidth = 1
  for (const [a, b] of edges) {
    context.beginPath(); context.moveTo(corners[a].x, corners[a].y); context.lineTo(corners[b].x, corners[b].y); context.stroke()
  }

  const points = []
  const stride = Math.max(3, Math.round(Math.max(gridX, gridZ) / 28))
  const safeScale = Math.max(1e-7, scale)
  for (let z = absorberCells; z < gridZ - absorberCells; z += stride) {
    for (let y = absorberCells; y < gridY - absorberCells; y += stride) {
      for (let x = absorberCells; x < gridX - absorberCells; x += stride) {
        const value = volume[(z * gridY + y) * gridX + x] / safeScale
        if (Math.abs(value) < 0.07) continue
        points.push({ ...project(world(x, y, z)), value })
      }
    }
  }
  points.sort((a, b) => a.depth - b.depth)
  for (const point of points) {
    context.fillStyle = fieldColour(point.value, fieldKind === 'emagnitude')
    context.beginPath()
    context.arc(point.x, point.y, clamp(1.1 + Math.abs(point.value) * 1.9, 1.1, 3.5) * point.perspective, 0, Math.PI * 2)
    context.fill()
  }

  const groups = new Map()
  for (let index = 0; index < conductorPoints.length; index += 3) {
    const x = conductorPoints[index]
    const y = conductorPoints[index + 1]
    const z = conductorPoints[index + 2]
    const key = `${x}:${y}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(z)
  }
  context.strokeStyle = '#f0d58a'
  context.lineWidth = 4
  context.lineCap = 'round'
  for (const [key, zs] of groups) {
    const [x, y] = key.split(':').map(Number)
    const a = project(world(x, y, Math.min(...zs)))
    const b = project(world(x, y, Math.max(...zs)))
    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke()
  }
  context.lineCap = 'butt'
}

const FdtdField3D = forwardRef(function FdtdField3D({ absorberCells }, forwardedRef) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const latestRef = useRef(null)
  const dragRef = useRef(null)
  const [size, setSize] = useState({ width: 960, height: 600 })
  const [rotation, setRotation] = useState({ x: -0.38, y: 0.72 })
  const [zoom, setZoom] = useState(1)

  const draw = useCallback(() => {
    const frame = latestRef.current
    const canvas = canvasRef.current
    if (!frame || !canvas) return
    const { field, metal, nx, ny, scale } = frame
    const context = canvas.getContext('2d', { alpha: false })
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.width * pixelRatio)
    canvas.height = Math.round(size.height * pixelRatio)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

    const gradient = context.createRadialGradient(size.width * 0.5, size.height * 0.46, 20, size.width * 0.5, size.height * 0.5, size.width * 0.7)
    gradient.addColorStop(0, '#182334')
    gradient.addColorStop(1, '#0b1018')
    context.fillStyle = gradient
    context.fillRect(0, 0, size.width, size.height)

    if (frame.symmetry === 'cartesian') {
      drawCartesianFrame(context, frame, size, rotation, zoom)
      return
    }

    const half = Math.floor(nx / 2)
    const usableRadius = Math.max(8, half - absorberCells)
    const usableHalfZ = Math.max(8, ny / 2 - absorberCells)
    const cameraScale = Math.min(size.width, size.height) * 0.39 * zoom
    const project = point => {
      const rotated = rotatePoint(point, rotation)
      const perspective = 1 / Math.max(0.55, 1 + rotated[2] * 0.22)
      return {
        x: size.width / 2 + rotated[0] * cameraScale * perspective,
        y: size.height / 2 - rotated[1] * cameraScale * perspective,
        depth: rotated[2],
        perspective
      }
    }

    const normalizedRadius = 0.92
    const normalizedTop = usableHalfZ / usableRadius
    context.strokeStyle = 'rgba(136, 192, 208, .24)'
    context.lineWidth = 1
    const drawPolyline = points => {
      context.beginPath()
      points.forEach((point, index) => {
        const projected = project(point)
        if (index === 0) context.moveTo(projected.x, projected.y)
        else context.lineTo(projected.x, projected.y)
      })
      context.stroke()
    }
    for (const axial of [-normalizedTop, normalizedTop]) {
      const ring = Array.from({ length: 49 }, (_, index) => {
        const phi = index * Math.PI * 2 / 48
        return [normalizedRadius * Math.cos(phi), axial, normalizedRadius * Math.sin(phi)]
      })
      drawPolyline(ring)
    }
    for (const phi of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      drawPolyline([
        [normalizedRadius * Math.cos(phi), -normalizedTop, normalizedRadius * Math.sin(phi)],
        [normalizedRadius * Math.cos(phi), normalizedTop, normalizedRadius * Math.sin(phi)]
      ])
    }

    const points = []
    const radialStride = Math.max(3, Math.round(usableRadius / 32))
    const axialStride = Math.max(3, Math.round(ny / 48))
    const azimuthSamples = 10
    const safeScale = Math.max(1e-7, scale)
    for (let z = absorberCells; z < ny - absorberCells; z += axialStride) {
      for (let r = 1; r < usableRadius; r += radialStride) {
        const value = field[z * nx + Math.min(nx - 1, half + r)] / safeScale
        if (Math.abs(value) < 0.055) continue
        const radius = r / usableRadius * normalizedRadius
        const axial = (z - ny / 2) / usableRadius
        for (let azimuth = 0; azimuth < azimuthSamples; azimuth += 1) {
          const phi = azimuth * Math.PI * 2 / azimuthSamples
          const projected = project([radius * Math.cos(phi), axial, radius * Math.sin(phi)])
          points.push({ ...projected, value })
        }
      }
    }
    points.sort((a, b) => a.depth - b.depth)
    for (const point of points) {
      const radius = clamp(1.1 + Math.abs(point.value) * 1.8, 1.1, 3.4) * point.perspective
      context.fillStyle = fieldColour(point.value, frame.fieldKind === 'emagnitude')
      context.beginPath()
      context.arc(point.x, point.y, radius, 0, Math.PI * 2)
      context.fill()
    }

    let groundZ = -1
    for (let z = 0; z < ny; z += 1) {
      let metalCells = 0
      for (let x = 0; x < nx; x += 1) metalCells += metal[z * nx + x] ? 1 : 0
      if (metalCells > nx * 0.7) {
        groundZ = z
        break
      }
    }
    if (groundZ >= 0) {
      const groundAxial = (groundZ - ny / 2) / usableRadius
      const groundRadius = normalizedRadius * 0.96
      const ring = Array.from({ length: 65 }, (_, index) => {
        const phi = index * Math.PI * 2 / 64
        return project([groundRadius * Math.cos(phi), groundAxial, groundRadius * Math.sin(phi)])
      })
      context.fillStyle = 'rgba(240, 213, 138, .08)'
      context.strokeStyle = 'rgba(240, 213, 138, .72)'
      context.beginPath()
      ring.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y))
      context.closePath()
      context.fill()
      context.stroke()
      context.strokeStyle = 'rgba(240, 213, 138, .24)'
      for (const radius of [0.32, 0.64]) {
        drawPolyline(Array.from({ length: 49 }, (_, index) => {
          const phi = index * Math.PI * 2 / 48
          return [groundRadius * radius * Math.cos(phi), groundAxial, groundRadius * radius * Math.sin(phi)]
        }))
      }
      for (let spoke = 0; spoke < 8; spoke += 1) {
        const phi = spoke * Math.PI / 4
        drawPolyline([[0, groundAxial, 0], [groundRadius * Math.cos(phi), groundAxial, groundRadius * Math.sin(phi)]])
      }
    }

    let wireStart = ny
    let wireEnd = 0
    for (let z = 0; z < ny; z += 1) {
      if (z !== groundZ && metal[z * nx + half]) {
        wireStart = Math.min(wireStart, z)
        wireEnd = Math.max(wireEnd, z)
      }
    }
    if (wireStart <= wireEnd) {
      const a = project([0, (wireStart - ny / 2) / usableRadius, 0])
      const b = project([0, (wireEnd - ny / 2) / usableRadius, 0])
      context.strokeStyle = '#f0d58a'
      context.lineWidth = 5
      context.lineCap = 'round'
      context.beginPath()
      context.moveTo(a.x, a.y)
      context.lineTo(b.x, b.y)
      context.stroke()
      context.lineCap = 'butt'
    }

    const origin = project([0, -normalizedTop * 1.08, 0])
    const axes = [
      { label: 'x', colour: '#bf616a', end: project([0.28, -normalizedTop * 1.08, 0]) },
      { label: 'z', colour: '#a3be8c', end: project([0, -normalizedTop * 1.08 + 0.28, 0]) },
      { label: 'y', colour: '#5e81ac', end: project([0, -normalizedTop * 1.08, 0.28]) }
    ]
    context.font = '600 10px ui-monospace, monospace'
    for (const axis of axes) {
      context.strokeStyle = axis.colour
      context.beginPath()
      context.moveTo(origin.x, origin.y)
      context.lineTo(axis.end.x, axis.end.y)
      context.stroke()
      context.fillStyle = axis.colour
      context.fillText(axis.label, axis.end.x + 4, axis.end.y - 3)
    }
  }, [absorberCells, rotation, size, zoom])

  useImperativeHandle(forwardedRef, () => ({
    render(frame) {
      latestRef.current = frame
      draw()
    },
    getCanvas() { return canvasRef.current },
    redraw: draw
  }), [draw])

  useEffect(() => {
    if (!containerRef.current) return undefined
    const observer = new ResizeObserver(entries => {
      const width = Math.max(320, Math.floor(entries[0].contentRect.width))
      setSize({ width, height: Math.max(360, Math.round(width * 0.625)) })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => { draw() }, [draw])

  const startDrag = event => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, rotation }
  }
  const moveDrag = event => {
    if (!dragRef.current) return
    setRotation({
      x: clamp(dragRef.current.rotation.x + (event.clientY - dragRef.current.y) * 0.008, -Math.PI / 2, Math.PI / 2),
      y: dragRef.current.rotation.y + (event.clientX - dragRef.current.x) * 0.008
    })
  }
  const endDrag = event => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }

  return (
    <div ref={containerRef} className="fdtd-3d-viewer">
      <canvas
        ref={canvasRef}
        aria-label="Reconstrucción tridimensional interactiva del campo electromagnético"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={event => {
          event.preventDefault()
          setZoom(current => clamp(current * Math.exp(-event.deltaY * 0.001), 0.55, 2.8))
        }}
      />
      <div className="fdtd-3d-controls">
        <button type="button" onClick={() => setZoom(current => clamp(current / 1.2, 0.55, 2.8))} aria-label="Alejar"><i className="bi bi-dash-lg" /></button>
        <button type="button" onClick={() => setZoom(current => clamp(current * 1.2, 0.55, 2.8))} aria-label="Acercar"><i className="bi bi-plus-lg" /></button>
        <button type="button" onClick={() => { setRotation({ x: -0.38, y: 0.72 }); setZoom(1) }}><i className="bi bi-arrow-counterclockwise" /> Vista</button>
      </div>
      <div className="fdtd-3d-help">Arrastra para rotar · rueda para ampliar</div>
    </div>
  )
})

export default FdtdField3D
