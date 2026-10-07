import React, { useId, useLayoutEffect, useState } from 'react'

const colors = {
  wall: '#334a5b',
  selected: '#087c86',
  point: '#07838b',
  beam: '#bd8117',
  door: '#a27648',
  window: '#4688aa',
  patient: '#b36391',
  draft: '#168b93',
}

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
const pointsAttribute = points => points.map(point => `${point.x},${point.y}`).join(' ')
const lineLength = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
const cleanNumber = value => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value)
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

function gridSpacing(width) {
  const desired = width / 12
  const magnitude = 10 ** Math.floor(Math.log10(desired))
  const scaled = desired / magnitude
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * magnitude
}

function Label({ x, y, children, unit, color = '#334a5b', anchor = 'start', background = true }) {
  const label = String(children)
  const width = (label.length * 6.3 + 14) * unit
  const offset = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0
  return <g className="sh-canvas-label" transform={`translate(${x} ${y})`} pointerEvents="none">
    {background && <rect x={offset} y={-12 * unit} width={width} height={19 * unit} rx={5 * unit}
      fill="#fff" fillOpacity="0.94" />}
    <text x={anchor === 'start' ? 7 * unit : anchor === 'end' ? -7 * unit : 0} y={0}
      textAnchor={anchor} fill={color} fontSize={11 * unit} fontWeight="600"
      fontFamily="inherit">{label}</text>
  </g>
}

function Handle({ point, name, unit, color = colors.selected }) {
  if (!finitePoint(point)) return null
  return <circle className="sh-canvas-handle" data-handle={name} cx={point.x} cy={point.y}
    r={5 * unit} fill="#fff" stroke={color} strokeWidth="2"
    vectorEffect="non-scaling-stroke" style={{ cursor: 'grab' }} />
}

function DirectionBeam({ configuration, viewBox, unit, markerId }) {
  const { source, target, apertureDeg } = configuration
  if (!finitePoint(source) || !finitePoint(target) || lineLength(source, target) < 1e-9) return null
  const angle = Math.atan2(target.y - source.y, target.x - source.x)
  const radius = Math.hypot(viewBox.width, viewBox.height) * 2
    + Math.hypot(source.x - viewBox.x, source.y - viewBox.y)
  const validAperture = typeof apertureDeg === 'number'
    && Number.isFinite(apertureDeg) && apertureDeg > 0 && apertureDeg < 180
  const halfAngle = validAperture ? apertureDeg * Math.PI / 360 : null
  const edgeA = validAperture ? {
    x: source.x + Math.cos(angle - halfAngle) * radius,
    y: source.y + Math.sin(angle - halfAngle) * radius,
  } : null
  const edgeB = validAperture ? {
    x: source.x + Math.cos(angle + halfAngle) * radius,
    y: source.y + Math.sin(angle + halfAngle) * radius,
  } : null
  return <g className="sh-canvas-beam" pointerEvents="none">
    {validAperture && <path
      d={`M ${source.x} ${source.y} L ${edgeA.x} ${edgeA.y} A ${radius} ${radius} 0 0 1 ${edgeB.x} ${edgeB.y} Z`}
      fill={colors.beam} fillOpacity="0.09" stroke={colors.beam} strokeOpacity="0.45"
      strokeWidth="1" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />}
    <line x1={source.x} y1={source.y} x2={target.x} y2={target.y}
      stroke={colors.beam} strokeWidth="1.5" strokeDasharray="5 4"
      vectorEffect="non-scaling-stroke" markerEnd={`url(#${markerId})`} />
    <circle cx={target.x} cy={target.y} r={6 * unit} fill="#fff" stroke={colors.beam}
      strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    <path d={`M ${target.x - 3 * unit} ${target.y} H ${target.x + 3 * unit} M ${target.x} ${target.y - 3 * unit} V ${target.y + 3 * unit}`}
      stroke={colors.beam} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    <Label x={target.x + 10 * unit} y={target.y + 4 * unit} unit={unit} color={colors.beam}>Dirección</Label>
  </g>
}

function Draft({ tool, draft, cursor, unit, calibrated, markerId }) {
  const first = draft[0]
  const last = draft.length === 2 && ['calibrate', 'measure'].includes(tool) ? draft[1] : cursor || draft.at(-1)
  const color = tool === 'calibrate' ? '#8861c4' : colors.draft
  const lineStyle = { stroke: color, strokeWidth: 2, vectorEffect: 'non-scaling-stroke', strokeDasharray: '6 4', fill: 'none' }
  let path = null
  let showLength = false
  if (first && last && ['wall', 'door', 'window', 'measure', 'calibrate', 'configuration'].includes(tool)) {
    path = <line x1={first.x} y1={first.y} x2={last.x} y2={last.y} {...lineStyle}
      markerEnd={tool === 'configuration' ? `url(#${markerId})` : undefined} />
    showLength = tool !== 'configuration'
  } else if (first && last && tool === 'rectangle') {
    path = <rect x={Math.min(first.x, last.x)} y={Math.min(first.y, last.y)}
      width={Math.abs(last.x - first.x)} height={Math.abs(last.y - first.y)}
      {...lineStyle} fill={color} fillOpacity="0.045" />
  } else if (draft.length && tool === 'room') {
    const vertices = cursor ? [...draft, cursor] : draft
    path = <>
      {vertices.length > 2 && <polygon points={pointsAttribute(vertices)} fill={color} fillOpacity="0.055" />}
      <polyline points={pointsAttribute(vertices)} {...lineStyle} />
      {vertices.length > 2 && <line x1={last.x} y1={last.y} x2={first.x} y2={first.y}
        {...lineStyle} strokeOpacity="0.35" />}
    </>
  }
  const middle = first && last ? midpoint(first, last) : null
  return <g className="sh-canvas-draft" pointerEvents="none">
    {path}
    {draft.map((point, index) => <circle key={index} cx={point.x} cy={point.y}
      r={(index === 0 && tool === 'room' ? 5 : 3) * unit}
      fill="#fff" stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />)}
    {showLength && calibrated && middle && <Label x={middle.x} y={middle.y - 10 * unit}
      unit={unit} color={color} anchor="middle">{`${cleanNumber(lineLength(first, last))} m`}</Label>}
    {tool === 'rectangle' && first && last && calibrated && <>
      <Label x={middle.x} y={Math.max(first.y, last.y) + 18 * unit} unit={unit} anchor="middle"
        color={color}>{`${cleanNumber(Math.abs(last.x - first.x))} m`}</Label>
      <Label x={Math.max(first.x, last.x) + 9 * unit} y={middle.y} unit={unit}
        color={color}>{`${cleanNumber(Math.abs(last.y - first.y))} m`}</Label>
    </>}
    {cursor && ['point', 'patient'].includes(tool) && <>
      <circle cx={cursor.x} cy={cursor.y} r={7 * unit} fill={color} fillOpacity="0.1"
        stroke={color} strokeDasharray="3 3" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path d={`M ${cursor.x - 11 * unit} ${cursor.y} H ${cursor.x + 11 * unit} M ${cursor.x} ${cursor.y - 11 * unit} V ${cursor.y + 11 * unit}`}
        stroke={color} strokeWidth="0.8" strokeOpacity="0.6" vectorEffect="non-scaling-stroke" />
    </>}
  </g>
}

/** Presentation only: coordinates, selection and pointer actions belong to the page. */
export default function ShieldingCanvas({
  scene,
  viewBox,
  selection = null,
  tool = 'select',
  draft = [],
  cursor = null,
  activeConfigurationId,
  backgroundOpacity = 0.55,
  svgRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onDoubleClick,
}) {
  const id = useId().replace(/:/g, '')
  const gridId = `shielding-grid-${id}`
  const arrowId = `shielding-arrow-${id}`
  const [viewport, setViewport] = useState({ width: 800, height: 600 })
  useLayoutEffect(() => {
    const element = svgRef.current
    const measure = () => {
      const { width, height } = element.getBoundingClientRect()
      if (width > 0 && height > 0) setViewport({ width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [svgRef])
  // SVG uses meet: the limiting axis controls scale. Labels and handles keep
  // their CSS-pixel size on phones and on wide monitors, independently of zoom.
  const unit = Math.max(viewBox.width / viewport.width, viewBox.height / viewport.height)
  const spacing = gridSpacing(viewBox.width)
  const background = scene.background
  const selected = (type, item) => selection?.type === type && selection?.id === item.id
  const showHandles = tool === 'select'
  const activeConfiguration = scene.configurations.find(configuration => configuration.id === activeConfigurationId)
  const configurations = [...scene.configurations].sort((a, b) =>
    Number(a.id === activeConfigurationId) - Number(b.id === activeConfigurationId))

  return <svg ref={svgRef} className={`sh-canvas sh-canvas--${tool}`} aria-label="Plano de la sala"
    role="img" tabIndex={0} viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
    preserveAspectRatio="xMidYMid meet" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
    onPointerUp={onPointerUp} onWheel={onWheel} onDoubleClick={onDoubleClick}
    style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none', userSelect: 'none', background: '#f8fafb' }}>
    <title>Plano de la sala</title>
    <desc>Editor de geometría temporal. El haz muestra su proyección en planta.</desc>
    <defs>
      <pattern id={gridId} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
        <path d={`M ${spacing} 0 H 0 V ${spacing}`} fill="none" stroke="#dde5e9"
          strokeWidth="0.65" vectorEffect="non-scaling-stroke" />
      </pattern>
      <marker id={arrowId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"
        markerUnits="strokeWidth"><path d="M 0 0 L 7 3.5 L 0 7 Z" fill={colors.beam} /></marker>
    </defs>
    <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height}
      fill={`url(#${gridId})`} pointerEvents="none" />
    {background && <image className="sh-canvas-background" href={background.url} x="0" y="0"
      width={background.width} height={background.height} opacity={backgroundOpacity}
      preserveAspectRatio="none" pointerEvents="none" />}

    {scene.rooms.map(room => {
      if (!room.vertices.length) return null
      const isSelected = selected('room', room)
      const center = room.vertices.reduce((sum, point) => ({
        x: sum.x + point.x / room.vertices.length,
        y: sum.y + point.y / room.vertices.length,
      }), { x: 0, y: 0 })
      return <g key={room.id} data-entity="room" data-id={room.id} className="sh-canvas-room">
        <title>{room.name}</title>
        <polygon points={pointsAttribute(room.vertices)} fill={colors.selected}
          fillOpacity={isSelected ? 0.075 : 0.025} stroke={isSelected ? colors.selected : '#8fa9b6'}
          strokeWidth={isSelected ? 2.5 : 1.5} strokeDasharray={isSelected ? undefined : '6 4'}
          vectorEffect="non-scaling-stroke" style={{ cursor: tool === 'select' ? 'move' : undefined }} />
        <Label x={center.x} y={center.y} anchor="middle" unit={unit} color="#6a808d">{room.name}</Label>
        {showHandles && isSelected && room.vertices.map((point, index) =>
          <Handle key={index} point={point} name={`vertex:${index}`} unit={unit} />)}
      </g>
    })}

    {activeConfiguration && <DirectionBeam configuration={activeConfiguration} viewBox={viewBox}
      unit={unit} markerId={arrowId} />}

    {scene.walls.map(wall => {
      const isSelected = selected('wall', wall)
      const length = lineLength(wall.start, wall.end)
      const center = midpoint(wall.start, wall.end)
      const color = isSelected ? colors.selected : colors[wall.kind] || colors.wall
      const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * 180 / Math.PI
      const labelAngle = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle
      const normal = length > 0 ? {
        x: -(wall.end.y - wall.start.y) / length * 3 * unit,
        y: (wall.end.x - wall.start.x) / length * 3 * unit,
      } : { x: 0, y: 0 }
      return <g key={wall.id} data-entity="wall" data-id={wall.id} className={`sh-canvas-wall sh-canvas-wall--${wall.kind}`}
        style={{ cursor: tool === 'select' ? 'move' : undefined }}>
        <title>{`${wall.name}${scene.calibrated ? ` · ${cleanNumber(length)} m` : ''}`}</title>
        <line x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y}
          stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" />
        {isSelected && <line x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y}
          stroke={colors.selected} strokeOpacity="0.13" strokeWidth="16" strokeLinecap="round"
          vectorEffect="non-scaling-stroke" />}
        <line x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y}
          stroke={wall.kind === 'window' ? '#fff' : color} strokeWidth={wall.kind === 'door' ? 3 : 7}
          strokeDasharray={wall.kind === 'door' ? '8 4' : undefined} strokeLinecap="round"
          vectorEffect="non-scaling-stroke" />
        {wall.kind === 'window' && [-1, 1].map(side => <line key={side}
          x1={wall.start.x + normal.x * side} y1={wall.start.y + normal.y * side}
          x2={wall.end.x + normal.x * side} y2={wall.end.y + normal.y * side}
          stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />)}
        {(scene.calibrated || isSelected) && <g transform={`translate(${center.x} ${center.y}) rotate(${labelAngle})`}>
          <Label x={0} y={-11 * unit} anchor="middle" unit={unit} color={color}>
            {scene.calibrated ? `${cleanNumber(length)} m` : wall.name}
          </Label>
        </g>}
        {showHandles && isSelected && <>
          <Handle point={wall.start} name="start" unit={unit} />
          <Handle point={wall.end} name="end" unit={unit} />
        </>}
      </g>
    })}

    {configurations.map(configuration => {
      if (!finitePoint(configuration.source)) return null
      const isSelected = selected('configuration', configuration)
      const isActive = configuration.id === activeConfigurationId
      const source = configuration.source
      const patient = configuration.patient
      return <g key={configuration.id} data-entity="configuration" data-id={configuration.id}
        className="sh-canvas-configuration" style={{ cursor: tool === 'select' ? 'move' : undefined }}>
        <title>{configuration.name}</title>
        {isSelected && <circle cx={source.x} cy={source.y} r={17 * unit} fill={colors.beam} fillOpacity="0.12" />}
        <circle cx={source.x} cy={source.y} r={(isActive ? 11 : 8) * unit}
          fill={isActive ? '#fff4dc' : '#fff'} stroke={colors.beam} strokeWidth={isActive ? 2 : 1.5}
          vectorEffect="non-scaling-stroke" />
        <text x={source.x} y={source.y + 3 * unit} textAnchor="middle" pointerEvents="none"
          fill={colors.beam} fontSize={(isActive ? 8 : 6) * unit} fontWeight="800">RX</text>
        {isActive && <Label x={source.x + 15 * unit} y={source.y - 14 * unit} unit={unit} color={colors.beam}>
          {`${configuration.name}${typeof configuration.usePercent === 'number' && Number.isFinite(configuration.usePercent) ? ` · ${cleanNumber(configuration.usePercent)} %` : ''}`}
        </Label>}
        {finitePoint(patient) && <g>
          {isActive && <line x1={source.x} y1={source.y} x2={patient.x} y2={patient.y}
            stroke={colors.patient} strokeOpacity="0.45" strokeDasharray="3 4" strokeWidth="1"
            vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          <circle cx={patient.x} cy={patient.y} r={8 * unit} fill="#fff" stroke={colors.patient}
            strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <circle cx={patient.x} cy={patient.y - 2.5 * unit} r={2 * unit} fill={colors.patient} pointerEvents="none" />
          <path d={`M ${patient.x - 3 * unit} ${patient.y + 4 * unit} Q ${patient.x} ${patient.y - 2 * unit} ${patient.x + 3 * unit} ${patient.y + 4 * unit}`}
            fill="none" stroke={colors.patient} strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          {isActive && <Label x={patient.x + 12 * unit} y={patient.y + 4 * unit} unit={unit} color={colors.patient}>Entrada al paciente</Label>}
        </g>}
        {showHandles && isSelected && <>
          <Handle point={source} name="source" unit={unit} color={colors.beam} />
          <Handle point={configuration.target} name="target" unit={unit} color={colors.beam} />
          <Handle point={patient} name="patient" unit={unit} color={colors.patient} />
        </>}
      </g>
    })}

    {scene.points.map(point => {
      const isSelected = selected('point', point)
      return <g key={point.id} data-entity="point" data-id={point.id} className="sh-canvas-point"
        style={{ cursor: tool === 'select' ? 'move' : undefined }}>
        <title>{point.name}</title>
        {isSelected && <circle cx={point.x} cy={point.y} r={14 * unit} fill={colors.point} fillOpacity="0.12" />}
        <circle cx={point.x} cy={point.y} r={6.5 * unit} fill="#fff" stroke={colors.point}
          strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <circle cx={point.x} cy={point.y} r={2.3 * unit} fill={colors.point} pointerEvents="none" />
        <Label x={point.x + 10 * unit} y={point.y + 4 * unit} unit={unit} color={colors.point}>{point.name}</Label>
      </g>
    })}

    <Draft tool={tool} draft={draft} cursor={cursor} unit={unit} calibrated={scene.calibrated} markerId={arrowId} />

    {scene.calibrated && <g className="sh-canvas-scale" pointerEvents="none"
      transform={`translate(${viewBox.x + 22 * unit} ${viewBox.y + viewBox.height - 21 * unit})`}>
      <rect x={-9 * unit} y={-26 * unit} width={spacing + 18 * unit} height={37 * unit} rx={6 * unit}
        fill="#fff" fillOpacity="0.92" />
      <path d={`M 0 ${-4 * unit} V 0 H ${spacing} V ${-4 * unit}`} fill="none"
        stroke="#526d7c" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <text x={spacing / 2} y={-9 * unit} fill="#526d7c" textAnchor="middle"
        fontSize={10 * unit} fontWeight="600">{cleanNumber(spacing)} m</text>
    </g>}
  </svg>
}
