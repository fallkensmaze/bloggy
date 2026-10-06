import { useEffect, useMemo, useRef, useState } from 'react'
import { EmergencyRadioSimulation, createScenario, PRIORITIES, RADIO_DEFAULTS, STATUS_LABELS, TYPE_LABELS } from '../utils/emergencyRadio'
import { normalizedAudio, SAMPLE_RATE, textBytes, wavBytes } from '../utils/emergencyRadioAudio'
import '../styles/emergency-radio.css'

const REASONS = { ok: 'CRC válido', overlap: 'Trama corrupta con solapamiento', noise: 'Trama corrupta por ruido', 'half-duplex': 'Estaba transmitiendo' }
const SCENARIOS = { neighborhood: 'Barrio · red distribuida', hidden: 'Terminal oculto · A, B y C', bridge: 'Dos grupos y un enlace' }
const sec = n => `${n.toFixed(1)} s`
const initial = () => new EmergencyRadioSimulation(createScenario())

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function EmergencyRadioLab() {
  const simRef = useRef(null)
  if (!simRef.current) simRef.current = initial()
  const [revision, setRevision] = useState(0)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(5)
  const [scenario, setScenario] = useState('neighborhood')
  const [count, setCount] = useState(25)
  const [config, setConfig] = useState({ ...RADIO_DEFAULTS })
  const [selected, setSelected] = useState(0)
  const [view, setView] = useState('physical')
  const [origin, setOrigin] = useState(0)
  const [destination, setDestination] = useState(24)
  const [message, setMessage] = useState('Necesitamos agua en el punto de encuentro.')
  const [priority, setPriority] = useState(1)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef(null)
  const sourceRef = useRef(null)
  const svgRef = useRef(null)
  const dragRef = useRef(null)
  const sim = simRef.current
  const node = sim.node(selected) || sim.nodes[0]
  const redraw = () => setRevision(v => v + 1)

  function stopAudio() {
    const source = sourceRef.current; sourceRef.current = null
    if (source) { source.onended = null; try { source.stop() } catch { /* already ended */ } }
    setPlaying(false)
  }
  useEffect(() => () => {
    try { sourceRef.current?.stop() } catch { /* already ended */ }
    audioRef.current?.close()
  }, [])
  useEffect(() => {
    if (!running) return
    let last = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      // No catch-up storm when a phone tab is backgrounded.
      simRef.current.advance(Math.min(0.25, (now - last) / 1000) * speed)
      last = now; redraw()
    }, 100)
    return () => clearInterval(id)
  }, [running, speed])

  function reset(name = scenario, nextConfig = config, nextCount = count) {
    stopAudio(); setRunning(false); setError('')
    const applied = { ...nextConfig, automatic: name !== 'hidden' }
    simRef.current = new EmergencyRadioSimulation(createScenario(name, nextCount), applied)
    simRef.current.advance(0.1)
    setScenario(name); setConfig(nextConfig); setCount(nextCount); setSelected(name === 'hidden' ? 1 : 0)
    setOrigin(0); setDestination(simRef.current.nodes.at(-1).id); redraw()
  }
  function parameter(key, value) { reset(scenario, { ...config, [key]: value }) }
  function step(seconds) { stopAudio(); setRunning(false); sim.advance(seconds); redraw() }

  function probe(simultaneous) {
    stopAudio(); setRunning(false); setError('')
    const positions = createScenario('hidden')
    if (scenario === 'hidden') positions[2].powerDb = sim.node(2).powerDb
    const next = new EmergencyRadioSimulation(positions, { ...config, automatic: false })
    next.advance(0.1); next.probe([0, 2], 1, simultaneous)
    next.advance(4 + 672 / config.baud)
    simRef.current = next; setScenario('hidden'); setSelected(1); setOrigin(0); setDestination(1); redraw()
  }

  const timeBucket = Math.floor(sim.time * 2)
  const audio = useMemo(() => sim.listenerAudio(node.id, 8), [sim, node.id, timeBucket, running ? 0 : revision])
  const normalized = useMemo(() => normalizedAudio(audio.samples), [audio])
  const waveform = useMemo(() => {
    const out = []; const block = Math.max(1, Math.floor(normalized.length / 220))
    for (let i = 0; i < 220; i++) {
      let power = 0; let count = 0
      for (let k = i * block; k < Math.min((i + 1) * block, normalized.length); k++) { power += normalized[k] ** 2; count++ }
      out.push(Math.min(34, Math.sqrt(power / Math.max(1, count)) * 180))
    }
    return [...out.map((v, i) => `${i * 3},${40 - v}`), ...out.map((v, i) => `${i * 3},${40 + v}`).reverse()].join(' ')
  }, [normalized])

  async function listen() {
    if (playing) { stopAudio(); return }
    setRunning(false); setError('')
    if (!audio.samples.length) return
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) throw new Error('Este navegador no admite reproducción de audio.')
      if (!audioRef.current) audioRef.current = new AudioContext()
      const ctx = audioRef.current; await ctx.resume()
      const buffer = ctx.createBuffer(1, normalized.length, SAMPLE_RATE)
      buffer.copyToChannel(normalized, 0)
      const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination)
      source.onended = () => { if (sourceRef.current === source) { sourceRef.current = null; setPlaying(false) } }
      sourceRef.current = source; source.start(); setPlaying(true)
    } catch (e) { setError(e.message || 'No se pudo activar el audio.'); stopAudio() }
  }

  function send(event) {
    event.preventDefault(); setError('')
    try { sim.sendMessage(origin, destination, message, priority); setRunning(true); redraw() }
    catch (e) { setError(e.message) }
  }
  function movePointer(event) {
    if (dragRef.current == null || !svgRef.current) return
    const point = svgRef.current.createSVGPoint(); point.x = event.clientX; point.y = event.clientY
    const matrix = svgRef.current.getScreenCTM(); if (!matrix) return
    const local = point.matrixTransform(matrix.inverse())
    sim.move(dragRef.current, Math.min(960, Math.max(30, local.x)), Math.min(610, Math.max(30, local.y))); redraw()
  }

  const active = sim.nodes.filter(n => n.online)
  const transmitting = sim.history.filter(tx => tx.start <= sim.time && tx.end > sim.time)
  const sym = sim.symmetricNeighbors(node)
  const incoming = sim.receptions.filter(r => r.receiver === node.id).slice(-8).reverse()
  const visibleTx = sim.history.filter(tx => tx.end > audio.start && (tx.sender === node.id || 20 * Math.log10(tx.gains[node.id] || 1e-9) - sim.config.noiseDb > -6))
  const timelineIds = [...new Set(visibleTx.slice().reverse().map(tx => tx.sender))].slice(0, 7).sort((a, b) => a - b)
  const edges = []
  if (view === 'physical') {
    for (const a of active) for (const b of active) if (a.id < b.id) {
      const ab = sim.linkDb(a, b) - sim.config.noiseDb >= sim.config.squelchDb
      const ba = sim.linkDb(b, a) - sim.config.noiseDb >= sim.config.squelchDb
      if (ab || ba) edges.push({ a, b, symmetric: ab && ba, reverse: !ab, mpr: (a.id === node.id && node.mpr.has(b.id)) || (b.id === node.id && node.mpr.has(a.id)) })
    }
  } else {
    for (const [aId, neighbors] of node.graph) for (const bId of neighbors) if (aId < bId) {
      const a = sim.node(aId); const b = sim.node(bId)
      if (a && b) edges.push({ a, b, symmetric: true, mpr: (a.id === node.id && node.mpr.has(b.id)) || (b.id === node.id && node.mpr.has(a.id)) })
    }
  }
  const confirmed = sim.messages.filter(m => m.status === 'confirmed').length
  const validPct = 100 * sim.stats.valid / Math.max(1, sim.stats.valid + sim.stats.corrupt + sim.stats.halfDuplex)
  const busyWindows = visibleTx.map(tx => [Math.max(audio.start, tx.start), Math.min(sim.time, tx.end)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  let busySeconds = 0; let lastEnd = audio.start
  for (const [a, b] of busyWindows) { busySeconds += Math.max(0, b - Math.max(a, lastEnd)); lastEnd = Math.max(lastEnd, b) }
  const occupancy = 100 * busySeconds / Math.max(0.1, audio.end - audio.start)

  return <div className="page-body emergency-lab">
    <header className="em-header">
      <div><div className="em-eyebrow">RADIOAFICIÓN <span>LABORATORIO · V0.1</span></div>
        <h1>Red de emergencia</h1><p>Descubre la red. Escucha cada estación. Comprueba qué mensajes llegan.</p></div>
      <span className="em-clock" aria-label={`Tiempo simulado ${sec(sim.time)}`}><i className={running ? 'em-live' : ''} />{sec(sim.time)}</span>
    </header>
    <p className="em-scope">Simulación experimental de datos por audio. Los acuses confirman recepción en la estación, no lectura ni asistencia.</p>
    {error && <p role="alert" className="em-error">{error}</p>}

    <div className="em-toolbar">
      <label>Escenario<select value={scenario} onChange={e => reset(e.target.value)}>{Object.entries(SCENARIOS).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
      <div className="em-controls"><button className="em-primary" onClick={() => { stopAudio(); setRunning(v => !v) }}>{running ? 'Pausar' : 'Iniciar'}</button>
        <button onClick={() => step(1)}>+1 s</button><button onClick={() => step(30)}>+30 s</button>
        <label className="em-speed">Velocidad<select value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[1, 5, 10, 30].map(x => <option value={x} key={x}>×{x}</option>)}</select></label>
        <button onClick={() => reset()}>Reiniciar</button></div>
    </div>

    <div className="em-metrics">
      <div><span>Estaciones activas</span><strong>{active.length}<small> / {sim.nodes.length}</small></strong></div>
      <div><span>Mensajes confirmados</span><strong>{confirmed}<small> / {sim.messages.length}</small></strong></div>
      <div><span>Recepciones válidas</span><strong>{validPct.toFixed(0)}<small> %</small></strong></div>
      <div><span>Canal audible en {node.label}</span><strong>{occupancy.toFixed(0)}<small> % · últimos 8 s</small></strong></div>
    </div>

    <div className="em-main-grid">
      <section className="em-map-panel">
        <div className="em-panel-heading"><h2>Quién puede escuchar a quién</h2><div className="em-segment" aria-label="Vista de la red">
          <button aria-pressed={view === 'physical'} onClick={() => setView('physical')}>Enlaces físicos</button>
          <button aria-pressed={view === 'learned'} onClick={() => setView('learned')}>Lo que sabe {node.label}</button></div></div>
        <svg ref={svgRef} className="em-network" viewBox="0 0 1000 650" role="group" aria-label="Red simulada. Selecciona o arrastra una estación. Las flechas del teclado también la desplazan."
          onPointerMove={movePointer} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}>
          <defs><pattern id="em-grid" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#455365" /></pattern>
            <marker id="em-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6" fill="#ddaa72" /></marker></defs>
          <rect width="1000" height="650" fill="url(#em-grid)" />
          {edges.map(({ a, b, symmetric, reverse, mpr }) => <line key={`${a.id}-${b.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            className={mpr ? 'em-edge em-mpr-edge' : symmetric ? 'em-edge' : 'em-edge em-oneway'}
            markerEnd={!symmetric && !reverse ? 'url(#em-arrow)' : undefined} markerStart={!symmetric && reverse ? 'url(#em-arrow)' : undefined} />)}
          {transmitting.map(tx => { const n = sim.node(tx.sender); return <circle key={tx.id} cx={n.x} cy={n.y} r={38 + ((sim.time - tx.start) * 90) % 140} className="em-wave" /> })}
          {sim.nodes.map(n => {
            const tx = transmitting.some(t => t.sender === n.id)
            const relay = [...n.neighbors.values()].some(v => v.report.some(r => r.id === n.id && r.mpr))
            return <g key={n.id} role="button" tabIndex={0} aria-label={`${n.label}, ${n.online ? 'encendida' : 'apagada'}`} aria-pressed={n.id === selected}
              className={`em-node ${n.online ? '' : 'em-off'} ${tx ? 'em-tx' : ''} ${n.id === selected ? 'em-selected' : ''} ${relay ? 'em-relay' : ''}`}
              transform={`translate(${n.x},${n.y})`} onClick={() => { stopAudio(); setSelected(n.id) }}
              onPointerDown={e => { stopAudio(); setSelected(n.id); dragRef.current = n.id; svgRef.current.setPointerCapture(e.pointerId) }}
              onKeyDown={e => {
                if (['Enter', ' '].includes(e.key)) { e.preventDefault(); stopAudio(); setSelected(n.id) }
                const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[e.key]
                if (delta) { e.preventDefault(); sim.move(n.id, Math.min(960, Math.max(30, n.x + delta[0])), Math.min(610, Math.max(30, n.y + delta[1]))); redraw() }
              }}><circle r="24" /><circle r="5" className="em-node-dot" /><text y="45" textAnchor="middle">{n.label}</text>
              {tx && <text y="-35" className="em-tx-label" textAnchor="middle">TX</text>}</g>
          })}
        </svg>
        <div className="em-legend"><span><i className="em-dot selected" />Estación seleccionada</span><span><i className="em-dot relay" />Retransmisor elegido</span><span><i className="em-dot tx" />Transmitiendo</span></div>
        <p className="em-help">Arrastra los nodos para cambiar la cobertura. Posiciones en un plano conceptual; los algoritmos solo conocen paquetes recibidos. Los enlaces físicos se calculan sin interferencias simultáneas.</p>
      </section>

      <aside className="em-inspector">
        <div className="em-panel-heading"><h2>Estación {node.label}</h2><span className={`em-status ${node.online ? 'on' : ''}`}>{node.online ? 'Encendida' : sim.time < node.joinAt ? 'Por incorporarse' : 'Apagada'}</span></div>
        <label>Escuchar e inspeccionar<select value={node.id} onChange={e => { stopAudio(); setSelected(Number(e.target.value)) }}>{sim.nodes.map(n => <option value={n.id} key={n.id}>{n.label}</option>)}</select></label>
        <div className="em-node-actions"><button onClick={() => { sim.setOnline(node.id, !node.online); redraw() }}>{node.online ? 'Apagar estación' : 'Encender estación'}</button>
          <label>Potencia relativa<select value={node.powerDb} onChange={e => { node.powerDb = Number(e.target.value); redraw() }}>{[-12, -6, 0, 6, 12].map(db => <option key={db} value={db}>{db > 0 ? '+' : ''}{db} dB</option>)}</select></label></div>
        <dl className="em-node-facts"><div><dt>Vecinos confirmados</dt><dd>{sym.map(v => sim.label(v.id)).join(', ') || 'Todavía ninguno'}</dd></div>
          <div><dt>Retransmisores que ha elegido</dt><dd>{[...node.mpr].map(id => sim.label(id)).join(', ') || 'Ninguno'}</dd></div>
          <div><dt>Destinos con ruta</dt><dd>{node.routes.size} · {node.queue.length} tramas en cola</dd></div></dl>
        <details className="em-routes"><summary>Tabla de rutas de {node.label}</summary><div className="em-table-scroll"><table><thead><tr><th>Destino</th><th>Siguiente</th><th>Saltos</th></tr></thead><tbody>
          {[...node.routes].sort(([a], [b]) => a - b).map(([id, r]) => <tr key={id}><td>{sim.label(id)}</td><td>{sim.label(r.next)}</td><td>{r.hops}</td></tr>)}
          {!node.routes.size && <tr><td colSpan="3">Las rutas aparecen al recibir información.</td></tr>}</tbody></table></div></details>
        <div className="em-hidden-demo"><h3>Prueba de terminal oculto</h3><p>A y C alcanzan a B, pero no se oyen entre sí. Compara el mismo mensaje de prueba con y sin solapamiento.</p>
          <button onClick={() => probe(true)}>A y C a la vez</button><button onClick={() => probe(false)}>A y C por turnos</button>
          <small>Abre el escenario de tres estaciones. No reproduce sonido automáticamente.</small></div>
      </aside>
    </div>

    <section className="em-listening">
      <div className="em-panel-heading"><div><h2>En el receptor de {node.label}</h2><p>La mezcla de tonos y ruido que recibe esta estación, entre {sec(audio.start)} y {sec(audio.end)}.</p></div>
        <div className="em-controls"><button className="em-primary" disabled={!audio.samples.length} onClick={listen}>{playing ? 'Detener audio' : 'Escuchar 8 s'}</button>
          <button disabled={!audio.samples.length} onClick={() => download(`radio-${node.label}-${sim.time.toFixed(0)}s.wav`, wavBytes(normalized), 'audio/wav')}>Guardar WAV</button></div></div>
      <svg className="em-waveform" viewBox="0 0 660 80" preserveAspectRatio="none" role="img" aria-label={`Envolvente de audio de ${node.label}`}><line x1="0" y1="40" x2="660" y2="40" /><polygon points={waveform} /></svg>
      <div className="em-timeline" aria-label={`Emisiones audibles en ${node.label}`}>
        {timelineIds.map(id => <div className="em-timeline-row" key={id}><span>{sim.label(id)}</span><div>{visibleTx.filter(tx => tx.sender === id).map(tx => {
          const reason = tx.outcomes[node.id]
          const a = Math.max(audio.start, tx.start); const b = Math.min(audio.end, tx.end)
          if (b <= a) return null
          return <span key={tx.id} className={`em-airtime ${reason === 'ok' ? 'ok' : reason ? 'lost' : ''}`} style={{ left: `${100 * (a - audio.start) / Math.max(0.1, audio.end - audio.start)}%`, width: `${100 * (b - a) / Math.max(0.1, audio.end - audio.start)}%` }}
            title={`${sim.label(id)} · ${TYPE_LABELS[tx.packet.type]} · ${sec(tx.start)}–${sec(tx.end)} · ${REASONS[reason] || (id === node.id ? 'Transmisión propia: receptor silenciado' : 'Por debajo del umbral o en curso')}`} />
        })}</div></div>)}
        {!timelineIds.length && <p className="em-empty">Aún no hay emisiones audibles. Inicia la red o prueba el terminal oculto.</p>}
      </div>
      <p className="em-help">Las barras que coinciden en el tiempo se solapan en este receptor. Verde: CRC válido; rojo: recepción perdida. Durante su propia transmisión, el receptor queda silenciado. El audio se normaliza para escucharlo a volumen moderado.</p>
      <details><summary>Últimas recepciones de {node.label}</summary><div className="em-table-scroll"><table><thead><tr><th>Tiempo</th><th>Emisor</th><th>Trama</th><th>Resultado</th></tr></thead><tbody>
        {incoming.map((r, i) => <tr key={`${r.txId}-${i}`}><td>{sec(r.time)}</td><td>{sim.label(r.sender)}</td><td>{TYPE_LABELS[r.type]}</td><td className={r.ok ? 'em-success' : 'em-danger'}>{REASONS[r.reason]}</td></tr>)}
        {!incoming.length && <tr><td colSpan="4">No hay recepciones por encima del umbral.</td></tr>}</tbody></table></div></details>
    </section>

    <div className="em-bottom-grid">
      <section className="em-message-panel"><h2>Enviar un mensaje de emergencia</h2>
        <form onSubmit={send}><div className="em-form-row"><label>Origen<select value={origin} onChange={e => setOrigin(Number(e.target.value))}>{sim.nodes.map(n => <option value={n.id} key={n.id}>{n.label}{n.online ? '' : ' · apagada'}</option>)}</select></label>
          <label>Destino<select value={destination} onChange={e => setDestination(Number(e.target.value))}>{sim.nodes.map(n => <option value={n.id} key={n.id}>{n.label}</option>)}</select></label>
          <label>Prioridad<select value={priority} onChange={e => setPriority(Number(e.target.value))}>{PRIORITIES.map((p, i) => <option value={i} key={p}>{p}</option>)}</select></label></div>
          <label>Mensaje breve<textarea rows="2" value={message} onChange={e => setMessage(e.target.value)} placeholder="Qué ocurre, dónde y qué se necesita." /></label>
          <div className="em-form-footer"><small>{textBytes(message.trim()).length} / 96 bytes UTF-8</small><button className="em-primary" type="submit" disabled={!sim.node(origin)?.online || origin === destination || !message.trim() || textBytes(message.trim()).length > 96}>Poner en cola</button></div>
        </form>
        <div className="em-message-list" aria-live="polite">{sim.messages.slice(-5).reverse().map(m => <article key={m.id}>
          <div><b>{sim.label(m.origin)} → {sim.label(m.dst)}</b><span>{PRIORITIES[m.priority]}</span></div><p>{m.text}</p>
          <small className={m.status === 'confirmed' ? 'em-success' : ''}>{STATUS_LABELS[m.status]} · {m.attempts} intento{m.attempts === 1 ? '' : 's'}{m.confirmedAt != null ? ` · ${sec(m.confirmedAt - m.createdAt)}` : ''}</small>
          {!!m.path.length && <small>Última ruta calculada: {m.path.map(id => sim.label(id)).join(' → ')}</small>}</article>)}
          {!sim.messages.length && <p className="em-empty">El origen conserva el mensaje mientras busca una ruta. La confirmación debe volver desde el destino.</p>}</div>
      </section>
      <section className="em-settings"><h2>Condiciones del ensayo</h2><p className="em-help">Cambiar estos parámetros reinicia el ensayo. La potencia de cada nodo y su posición se cambian desde el mapa.</p>
        <label>Estaciones del barrio<select value={count} disabled={scenario !== 'neighborhood'} onChange={e => reset(scenario, config, Number(e.target.value))}>{[20, 25, 30].map(n => <option key={n} value={n}>{n} estaciones</option>)}</select></label>
        <div className="em-form-row"><label>Ruido relativo<select value={config.noiseDb} onChange={e => parameter('noiseDb', Number(e.target.value))}>{[-12, -6, 0, 3, 6, 12].map(db => <option key={db} value={db}>{db > 0 ? '+' : ''}{db} dB</option>)}</select></label>
          <label>Velocidad de datos<select value={config.baud} onChange={e => parameter('baud', Number(e.target.value))}>{[100, 300, 600, 1200].map(b => <option key={b} value={b}>{b} bit/s · BFSK</option>)}</select></label></div>
        <div className="em-form-row"><label>Intervalo HELLO<select value={config.helloInterval} onChange={e => parameter('helloInterval', Number(e.target.value))}>{[20, 40, 60].map(s => <option key={s} value={s}>{s} s</option>)}</select></label>
          <label>Intervalo de topología<select value={config.topologyInterval} onChange={e => parameter('topologyInterval', Number(e.target.value))}>{[60, 120, 180].map(s => <option key={s} value={s}>{s} s</option>)}</select></label></div>
        <p className="em-help">Los intervalos llevan variación aleatoria. Alargarlos reduce anuncios periódicos, pero retrasa la detección de cambios; la congestión puede impedir la entrega.</p>
        <label>Difusión de la topología<select value={config.strategy} onChange={e => parameter('strategy', e.target.value)}><option value="mpr">Solo retransmisores MPR</option><option value="flood">Todos retransmiten una vez</option></select></label>
        <label className="em-checkbox"><input type="checkbox" checked={config.carrierSense} onChange={e => parameter('carrierSense', e.target.checked)} />Escuchar el canal antes de emitir</label>
        <div className="em-counter-grid"><span><b>{sim.stats.transmissions}</b> emisiones</span><span><b>{sim.stats.corrupt}</b> recepciones corruptas</span><span><b>{sim.stats.busy}</b> esperas por canal ocupado</span><span><b>{sim.stats.halfDuplex}</b> pérdidas por transmitir</span></div>
        <button onClick={() => download('ensayo-red-emergencia.json', JSON.stringify(sim.snapshot(), null, 2), 'application/json')}>Exportar ensayo JSON</button>
      </section>
    </div>

    <details className="em-protocol"><summary>Cómo funciona esta primera versión</summary>
      <div className="em-explanation"><p>Cada estación aprende vecinos mediante HELLO, comprueba enlaces en ambos sentidos y elige MPR con información a dos saltos. Los anuncios de topología viajan por esos retransmisores. Los mensajes dirigidos y sus acuses utilizan las rutas descubiertas.</p>
        <p>Las prioridades ordenan la cola local y no interrumpen una emisión ya iniciada. Hay espera aleatoria, hasta tres intentos y caducidad del mensaje a los 180 s. Un acuse perdido puede provocar un reenvío: el destino evita presentar duplicados y vuelve a confirmar.</p>
        <p>El escenario de terminal oculto desactiva las balizas para aislar el fenómeno. A y C pueden considerar libre el canal al mismo tiempo. Cambia la potencia de C para explorar cuándo una señal más fuerte permite recuperar una trama.</p>
        <p><b>Modelo físico:</b> mezcla lineal de tonos BFSK de 1200 y 2400 Hz y ruido blanco uniforme reproducible. Se demodulan las muestras y se comprueba CRC-16. La sincronización de símbolos es ideal; la geometría se fija al empezar cada transmisión. Este canal equivalente no reproduce un receptor FM real, el VOX, un módem con FEC ni la propagación de un lugar concreto.</p>
        <p>La simulación no usa micrófono ni transmite por radio. No es una implementación oficial de Romeo Echo ni de OLSR. La futura aplicación sobre equipos reales requiere validación del módem, funcionamiento sin conexión y condiciones de uso de la banda.</p>
        <p>Referencias: <a href="https://www.rfc-editor.org/rfc/rfc3626" target="_blank" rel="noreferrer">OLSR y MPR</a> · <a href="https://github.com/OpenResearchInstitute/ribbit_webapp" target="_blank" rel="noreferrer">Ribbit Web App</a></p></div>
    </details>
    <details className="em-log"><summary>Registro de eventos · {sim.logs.length} recientes</summary><ol>{sim.logs.slice(-60).reverse().map((item, i) => <li key={`${item.time}-${i}`} className={item.kind === 'loss' ? 'em-danger' : ''}><time>{sec(item.time)}</time>{item.text}</li>)}</ol></details>
  </div>
}
