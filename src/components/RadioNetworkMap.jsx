import { useEffect, useRef, useState } from 'react'

const labels = { self: 'Este móvil', direct: 'Oída directamente', indirect: 'Conocida por otras estaciones', stale: 'Sin noticias recientes' }
const ageLabel = seconds => seconds < 60 ? `${Math.floor(seconds)} s` : `${Math.floor(seconds / 60)} min`

export default function RadioNetworkMap({ topology, config, active, sharing, onSharingChange }) {
  const [selectedId, setSelectedId] = useState(null)
  const [compact, setCompact] = useState(false); const canvas = useRef(null)
  useEffect(() => {
    const observer = new ResizeObserver(entries => setCompact(entries[0].contentRect.width < 520))
    observer.observe(canvas.current); return () => observer.disconnect()
  }, [])
  const nodes = topology?.nodes || [{ id: config.id, name: config.name, kind: 'self', age: 0 }]
  const selected = nodes.find(n => n.id === selectedId)
  const counts = kind => nodes.filter(n => n.kind === kind).length
  // Limit the drawing, not the accessible list. These are logical columns,
  // never geographic coordinates or a radio-range estimate.
  const shown = [...nodes].sort((a, b) => ['self', 'direct', 'indirect', 'stale'].indexOf(a.kind) - ['self', 'direct', 'indirect', 'stale'].indexOf(b.kind)).slice(0, 25)
  const columns = [shown.filter(n => n.kind === 'self'), shown.filter(n => n.kind === 'direct'), shown.filter(n => !['self', 'direct'].includes(n.kind))]
  const rows = Math.max(2, ...columns.map(c => c.length))
  let height = 65 + rows * 76
  let positions = new Map(columns.flatMap((column, c) => column.map((n, i) => [n.id, { x: 75 + c * 245, y: 70 + (i + (rows - column.length) / 2) * 76 }])))
  if (compact) {
    positions = new Map(); let y = 48
    for (const column of columns.filter(c => c.length)) {
      column.forEach((n, i) => positions.set(n.id, { x: column.length === 1 ? 180 : 90 + i % 2 * 180, y: y + Math.floor(i / 2) * 90 }))
      y += Math.ceil(column.length / 2) * 90 + 24
    }
    height = y - 12
  }
  return <section className="ra-panel ra-network" aria-label="Mapa de la red">
    <div className="ra-network-heading"><div><h2>Mapa de la red</h2><p className="ra-hint">{active ? 'Se construye con los anuncios que recibe este móvil.' : 'Instantánea de la sesión. Activa la estación para recibir novedades.'}</p></div>
      <label className="ra-check"><input type="checkbox" checked={sharing} onChange={e => onSharingChange(e.target.checked)} /> Compartir y propagar el mapa</label></div>
    <div className="ra-network-counts"><span><b>{counts('direct')}</b> directas</span><span><b>{counts('indirect')}</b> indirectas</span><span><b>{counts('stale')}</b> antiguas</span></div>
    <p className="ra-hint">Pulsa «Anunciar mi presencia» para iniciar el intercambio. Las estaciones que comparten el mapa responden y difunden sus observaciones hasta cuatro saltos, sin balizas periódicas.</p>
    <div className="ra-network-canvas" ref={canvas}><svg className="ra-network-graph" viewBox={`0 0 ${compact ? 360 : 640} ${height}`} role="img" aria-label="Conexiones observadas entre estaciones. La flecha apunta al equipo que ha oído al otro.">
      <defs><marker id="ra-heard-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
      {!compact && ['Mi móvil', 'Escucha directa', 'Referencias recibidas'].map((s, i) => <text key={s} x={75 + 245 * i} y="24" textAnchor="middle" className="ra-network-column">{s}</text>)}
      {(topology?.links || []).map(e => {
        const a = positions.get(e.from); const b = positions.get(e.to)
        if (!a || !b) return null
        const d = Math.hypot(b.x - a.x, b.y - a.y); const dx = (b.x - a.x) / d; const dy = (b.y - a.y) / d
        return <line key={`${e.from}:${e.to}`} x1={a.x + 24 * dx} y1={a.y + 24 * dy} x2={b.x - 28 * dx} y2={b.y - 28 * dy}
          markerEnd="url(#ra-heard-arrow)" className={`ra-network-edge ${e.reportedBy === config.id ? 'local' : 'reported'} ${e.stale ? 'stale' : ''}`}>
          <title>ID {e.to} ha oído a ID {e.from}; {e.reportedBy === config.id ? 'observación de este móvil' : `informado por ID ${e.reportedBy}`}{e.stale ? '; enlace antiguo' : ''}</title></line>
      })}
      {shown.map(n => { const p = positions.get(n.id); return <g key={n.id} className={`ra-network-node ${n.kind} ${selectedId === n.id ? 'selected' : ''}`}>
        <title>{n.name} · ID {n.id} · {labels[n.kind]}</title><circle cx={p.x} cy={p.y} r="22" /><text x={p.x} y={p.y + 5} textAnchor="middle">{n.id}</text>
        <text x={p.x} y={p.y + 39} textAnchor="middle" className="ra-network-name">{n.kind === 'self' && compact ? 'Yo · ' : ''}{n.name.length > 22 ? `${n.name.slice(0, 20)}…` : n.name}</text>
      </g> })}
    </svg></div>
    <div className="ra-network-legend ra-hint"><span>Flecha hacia quien escucha</span><span>Continua: observación local</span><span>Discontinua: informada por otro</span><span>Gris: más de 5 min</span></div>
    {shown.length < nodes.length && <p className="ra-hint">El dibujo muestra {shown.length} de {nodes.length} estaciones; la lista contiene todas.</p>}
    <div className="ra-network-list" aria-label="Estaciones conocidas">{nodes.filter(n => n.kind !== 'self').map(n => <button type="button" key={n.id} className={`ra-network-card ${n.kind}`} aria-pressed={selectedId === n.id} onClick={() => setSelectedId(n.id)}>
      <b>{n.name} · ID {n.id}</b><span>{labels[n.kind]}{n.kind === 'indirect' && n.via ? ` · vía ID ${n.via}` : ''}</span>
      <small>Última noticia: hace {ageLabel(n.age)}{n.kind === 'direct' && n.confirmedAt != null && topology.updatedAt - n.confirmedAt < topology.lifetime ? ' · acuse directo recibido' : ''}</small>
    </button>)}</div>
    {nodes.length === 1 && <p className="ra-empty">Aún no hay otras estaciones. Activa los otros móviles y anuncia tu presencia en uno de ellos.</p>}
    {selected && <p className="ra-network-detail"><b>{selected.name} · ID {selected.id}.</b> {selected.kind === 'direct' ? 'Este móvil ha decodificado una transmisión suya.' : selected.kind === 'stale' ? 'No hay noticias recientes; anuncia de nuevo para actualizar.' : 'Su existencia se conoce por informes recibidos de otras estaciones.'}
      {selected.path?.length > 2 && <> Cadena observada: {selected.path.map(id => `ID ${id}`).join(' — ')}.</>}</p>}
    <p className="ra-hint">Es un mapa de conexiones observadas, sin posiciones GPS ni distancias. Una referencia indirecta no confirma un camino de ida y vuelta.
      Los mensajes y acuses siguen siendo directos. Solo aparecen estaciones anunciadas o mencionadas por otras: una red aislada no se puede descubrir desde aquí.
      Los enlaces pasan a antiguos a los 5 min y se ocultan a los 10 min; cada informe incluye hasta 32 vecinos recientes.</p>
  </section>
}
