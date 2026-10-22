import { useEffect, useRef, useState } from 'react'
import { BrowserAprsReceiver, decodeAudioFile } from '../utils/aprsBrowser'
import { AfskDemodulator, afskModulate } from '../utils/aprsModem'
import { decodeFrame, encodeUiFrame, formatCall, tnc2 } from '../utils/ax25'
import { parseAprs, symbolName, formatCoordinate, maidenhead, distanceKm } from '../utils/aprsParser'
import '../styles/aprs.css'

const SETTINGS_KEY = 'aprs_receiver_settings_v1'
const MAX_PACKETS = 500
const TYPE_LABELS = { position: 'Posición', 'mic-e': 'Mic-E', message: 'Mensaje', status: 'Estado', object: 'Objeto', item: 'Ítem',
  weather: 'Meteo', telemetry: 'Telemetría', 'third-party': 'Terceros', capabilities: 'Capacidades', unknown: 'Otro' }
const SAMPLE_INFO = '!4024.38N/00341.31W>088/036/A=002100 Prueba del receptor APRS'

function loadSettings() {
  try { return { deviceId: '', home: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } } catch { return { deviceId: '', home: '' } }
}
function parseHome(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text || '')
  if (!m) return null
  const lat = Number(m[1]), lon = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}
const clock = ms => new Date(ms).toLocaleTimeString('es-ES')
const fixed = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : null
const two = n => String(n).padStart(2, '0')
function stamp(t) {
  if (!t) return null
  if (t.format === 'hms') return `${two(t.hour)}:${two(t.minute)}:${two(t.second)} UTC`
  if (t.format === 'mdhm') return `${two(t.day)}/${two(t.month)} ${two(t.hour)}:${two(t.minute)}`
  return `día ${t.day}, ${two(t.hour)}:${two(t.minute)} ${t.format === 'zulu' ? 'UTC' : 'hora local'}`
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a')
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Ordered human-readable facts about one decoded APRS payload.
function details(aprs, home) {
  const rows = []
  const add = (label, value) => { if (value !== null && value !== undefined && value !== '') rows.push([label, value]) }
  const p = aprs.position
  if (p) {
    add('Posición', formatCoordinate(p.lat, p.lon) + (p.ambiguity ? ` (ambigüedad ${p.ambiguity})` : ''))
    add('Locator', maidenhead(p.lat, p.lon))
    if (home) add('Distancia', `${fixed(distanceKm(home, p), 1)} km`)
  }
  if (aprs.symbol) add('Símbolo', `${symbolName(aprs.symbol.table, aprs.symbol.code) || 'Sin descripción'} (${aprs.symbol.table}${aprs.symbol.code})`)
  if (Number.isFinite(aprs.speed)) add('Velocidad', `${fixed(aprs.speed)} km/h`)
  if (Number.isFinite(aprs.course)) add('Rumbo', `${fixed(aprs.course)}°`)
  if (Number.isFinite(aprs.altitude)) add('Altitud', `${fixed(aprs.altitude)} m`)
  if (aprs.micE?.messageType) add('Mic-E', aprs.micE.messageType)
  if (aprs.object) add('Objeto', `${aprs.object.name}${aprs.object.alive === false ? ' (eliminado)' : ''}`)
  if (aprs.item) add('Ítem', `${aprs.item.name}${aprs.item.alive === false ? ' (eliminado)' : ''}`)
  if (aprs.message) {
    const m = aprs.message
    add('Para', m.addressee)
    add(m.ack ? 'Acuse' : m.rej ? 'Rechazo' : 'Mensaje', m.ack || m.rej || m.text)
    add('Id. mensaje', m.id)
  }
  if (aprs.status) add('Estado', aprs.status)
  const w = aprs.weather
  if (w) {
    add('Viento', Number.isFinite(w.windSpeed) ? `${fixed(w.windSpeed)} km/h${Number.isFinite(w.windDirection) ? ` desde ${fixed(w.windDirection)}°` : ''}` : null)
    add('Racha', Number.isFinite(w.windGust) ? `${fixed(w.windGust)} km/h` : null)
    add('Temperatura', Number.isFinite(w.temperature) ? `${fixed(w.temperature, 1)} °C` : null)
    add('Humedad', Number.isFinite(w.humidity) ? `${fixed(w.humidity)} %` : null)
    add('Presión', Number.isFinite(w.pressure) ? `${fixed(w.pressure, 1)} hPa` : null)
    add('Lluvia 1 h', Number.isFinite(w.rain1h) ? `${fixed(w.rain1h, 1)} mm` : null)
    add('Lluvia 24 h', Number.isFinite(w.rain24h) ? `${fixed(w.rain24h, 1)} mm` : null)
    add('Lluvia hoy', Number.isFinite(w.rainSinceMidnight) ? `${fixed(w.rainSinceMidnight, 1)} mm` : null)
  }
  if (aprs.telemetry) {
    const t = aprs.telemetry
    add('Telemetría', `#${t.sequence} · ${t.analog.map(v => v ?? '—').join(', ')}${t.digital ? ` · ${t.digital}` : ''}`)
  }
  add('Marca de tiempo', stamp(aprs.timestamp))
  add('Comentario', aprs.comment)
  if (aprs.error) add('Aviso', aprs.error)
  return rows
}

export default function AprsReceiver() {
  const [settings, setSettings] = useState(loadSettings)
  const [active, setActive] = useState(false); const [starting, setStarting] = useState(false)
  const [level, setLevel] = useState({ db: -100, receiving: false, clipping: false })
  const [packets, setPackets] = useState([]); const [rejected, setRejected] = useState(0)
  const [devices, setDevices] = useState([]); const [capture, setCapture] = useState(null)
  const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [fileProgress, setFileProgress] = useState(null); const [filter, setFilter] = useState('')
  const controller = useRef(null); const mounted = useRef(true); const nextId = useRef(1)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; void controller.current?.stop() } }, [])

  const home = parseHome(settings.home)
  function change(key, value) {
    setSettings(s => { const next = { ...s, [key]: value }; try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch { /* preferences optional */ } return next })
  }
  // Valid FCS but not an AX.25 address field happens with corrupt-but-lucky
  // noise; those are counted, never shown as stations.
  function addFrames(frames, origin) {
    const decoded = []
    for (const f of frames) {
      const frame = decodeFrame(f.bytes)
      if (!frame) { setRejected(n => n + 1); continue }
      const aprs = frame.ui && frame.pid === 0xf0
        ? parseAprs({ source: formatCall(frame.source), destination: formatCall(frame.destination), path: frame.path.map(formatCall), info: frame.text })
        : { type: 'unknown', raw: frame.text, error: 'Trama AX.25 que no es UI/APRS.' }
      decoded.push({ id: nextId.current++, receivedAt: f.receivedAt ?? Date.now(), origin: f.origin || origin, twists: f.twists, frame, aprs, line: tnc2(frame) })
    }
    if (decoded.length) setPackets(list => [...decoded.reverse(), ...list].slice(0, MAX_PACKETS))
    return decoded.length
  }

  async function start() {
    setError(''); setNotice(''); setStarting(true); setCapture(null)
    let session
    try {
      session = new BrowserAprsReceiver({ deviceId: settings.deviceId }, {
        onLevel: v => { if (mounted.current && controller.current === session) setLevel(v) },
        onFrame: f => { if (mounted.current && controller.current === session) addFrames([f], 'micrófono') },
        onStarted: v => { if (mounted.current && controller.current === session) setCapture(v) },
        onStopped: reason => { if (mounted.current && controller.current === session) { setActive(false); setStarting(false); setNotice(reason) } }
      })
      controller.current = session; await session.start()
      if (!mounted.current || session.closed || controller.current !== session) return
      setActive(true)
      try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput')) } catch { /* default mic remains usable */ }
    } catch (e) {
      if (mounted.current && (!session || controller.current === session)) {
        setError(e.name === 'NotAllowedError' ? 'Permite el micrófono en el navegador y vuelve a pulsar Escuchar.' : e.name === 'NotFoundError' ? 'No se encuentra un micrófono. Conecta uno o elige otra entrada.' : e.message)
        setActive(false)
      }
    } finally { if (mounted.current && (!session || controller.current === session)) setStarting(false) }
  }
  async function stop() { await controller.current?.stop(); controller.current = null; setActive(false); setStarting(false); setLevel({ db: -100, receiving: false, clipping: false }) }

  function testFrame() { return encodeUiFrame({ source: 'N0CALL-9', destination: 'APZ001', path: ['WIDE1-1', 'WIDE2-1'], info: SAMPLE_INFO }) }
  function selfTest() {
    setError(''); setNotice('')
    const rate = capture?.sampleRate || 48000
    const audio = afskModulate([testFrame()], { sampleRate: rate, spaceGainDb: -6 })
    const demod = new AfskDemodulator(rate)
    const frames = [...demod.push(audio), ...demod.finish()]
    if (frames.length !== 1 || addFrames(frames, 'autoprueba') !== 1) { setError('La autoprueba no ha recuperado la trama.'); return }
    setNotice(`Autoprueba correcta: ${(audio.length / rate).toFixed(2)} s de AFSK a ${rate} Hz con el tono de 2200 Hz 6 dB más bajo, decodificado sin micrófono ni altavoz.`)
  }
  async function playTest() {
    setError('')
    const Audio = window.AudioContext || window.webkitAudioContext
    const context = new Audio()
    try {
      const audio = afskModulate([testFrame()], { sampleRate: context.sampleRate, amplitude: 0.4 })
      const buffer = context.createBuffer(1, audio.length, context.sampleRate); buffer.copyToChannel(audio, 0)
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination)
      source.onended = () => void context.close()
      await context.resume(); source.start()
      setNotice('Reproduciendo un paquete de prueba por el altavoz. Otro dispositivo escuchando debería decodificar N0CALL-9.')
    } catch (e) { void context.close(); setError(e.message) }
  }
  async function decodeFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(''); setNotice(''); setFileProgress(0)
    try {
      const result = await decodeAudioFile(file, p => { if (mounted.current) setFileProgress(p) })
      if (!mounted.current) return
      const now = Date.now()
      const count = addFrames(result.frames.map(f => ({ ...f, receivedAt: now, origin: `${file.name} · ${f.time.toFixed(1)} s` })), 'archivo')
      setNotice(`${file.name}: ${result.duration.toFixed(1)} s a ${result.sampleRate} Hz${result.channels > 1 ? ' (canal izquierdo)' : ''} · ${count} paquete${count === 1 ? '' : 's'} decodificado${count === 1 ? '' : 's'}.`)
    } catch (e) { if (mounted.current) setError(e.message) } finally { if (mounted.current) setFileProgress(null) }
  }

  const stations = new Map()
  for (const p of [...packets].reverse()) {
    const call = formatCall(p.frame.source)
    const s = stations.get(call) || { call, count: 0, first: p.receivedAt }
    s.count++; s.last = p.receivedAt; s.lastType = p.aprs.type
    const pos = p.aprs.position ? p.aprs : null
    if (pos) { s.position = pos.position; s.symbol = pos.symbol }
    if (p.frame.path.some(d => d.repeated)) s.digipeated = true; else s.direct = true
    stations.set(call, s)
  }
  const stationList = [...stations.values()].sort((a, b) => b.last - a.last)
  const needle = filter.trim().toUpperCase()
  const shown = needle ? packets.filter(p => p.line.toUpperCase().includes(needle)) : packets
  const bar = Math.max(0, Math.min(100, (level.db + 80) / 80 * 100))
  const locked = active || starting
  const state = !active ? (starting ? 'Esperando permiso del micrófono…' : 'Detenido') : level.receiving ? 'Recibiendo portadora AFSK' : 'Escuchando'

  return <div className="aprs-page">
    <header><p className="aprs-eyebrow">Radioafición · APRS · solo recepción</p><h1>Receptor APRS por micrófono</h1>
      <p>Decodifica paquetes APRS de 1200 baudios (AFSK Bell 202, AX.25) a partir del audio de un receptor de VHF —normalmente 144,800 MHz en Europa—
        captado por el micrófono o por un cable de audio. Todo el procesado ocurre en tu navegador: no se graba, no se sube y no se reenvía a APRS-IS.</p></header>
    {error && <p className="aprs-alert aprs-error" role="alert">{error}</p>}
    {notice && <p className="aprs-alert" role="status">{notice}</p>}

    <section className="aprs-panel"><h2>Entrada de audio</h2>
      <div className="aprs-settings">
        <label>Micrófono<select disabled={locked} value={settings.deviceId} onChange={e => change('deviceId', e.target.value)}><option value="">Entrada predeterminada</option>
          {devices.filter(d => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Micrófono ${i + 1}`}</option>)}</select></label>
        <label>Mi posición (opcional, para distancias)<input placeholder="40.4168, -3.7038" value={settings.home} onChange={e => change('home', e.target.value)} />
          <small>{settings.home && !home ? 'Formato: latitud, longitud en grados decimales.' : home ? `Locator ${maidenhead(home.lat, home.lon)} · solo se guarda en este navegador.` : 'Solo se guarda en este navegador.'}</small></label>
      </div>
      <div className="aprs-actions">
        {locked ? <button type="button" className="aprs-stop" onClick={stop}><i className="bi bi-stop-circle" /> Detener</button>
          : <button type="button" className="aprs-primary" onClick={start}><i className="bi bi-mic" /> Escuchar</button>}
        <button type="button" onClick={selfTest}><i className="bi bi-check2-circle" /> Autoprueba</button>
        <button type="button" onClick={playTest}><i className="bi bi-volume-up" /> Emitir paquete de prueba</button>
        <label className="aprs-file"><i className="bi bi-file-earmark-music" /> {fileProgress === null ? 'Decodificar grabación…' : `Decodificando ${(fileProgress * 100).toFixed(0)} %`}
          <input type="file" accept="audio/*,.wav" disabled={fileProgress !== null} onChange={decodeFile} /></label>
      </div>
      <p className="aprs-hint">El squelch puede quedar cerrado: basta con que abra con cada paquete. Con un cable, ajusta el volumen del receptor para que el medidor quede entre −30 y −10 dBFS sin saturar.
        Se prueban siete compensaciones de tono (de −9 a +9 dB entre 2200 y 1200 Hz) a la vez, porque el de-énfasis de cada radio desequilibra los tonos.</p>
    </section>

    <section className="aprs-console" aria-label="Estado de la recepción">
      <div><span className={`aprs-dot ${active ? level.receiving ? 'aprs-rx' : 'aprs-on' : ''}`} /><strong aria-live="polite">{state}</strong>
        <p className="aprs-hint">{capture ? `${capture.sampleRate} Hz · ${capture.settings?.echoCancellation ? 'cancelación de eco ACTIVA (puede impedir la decodificación)' : 'sin procesado de voz'}` : 'Pulsa Escuchar para abrir el micrófono.'}</p></div>
      <div><div className="aprs-meter"><div style={{ width: `${bar}%` }} className={level.clipping ? 'aprs-clipping' : ''} /></div>
        <p className="aprs-hint">{level.db > -99 ? `${level.db.toFixed(0)} dBFS` : 'Sin señal'}{level.clipping ? ' · Saturación: baja el volumen.' : ''}</p></div>
      <div className="aprs-counters"><span><b>{packets.length}</b> paquetes</span><span><b>{stationList.length}</b> estaciones</span><span><b>{rejected}</b> tramas no AX.25</span>
        {packets[0] && <span>Último: <b>{clock(packets[0].receivedAt)}</b></span>}</div>
    </section>

    <section className="aprs-panel"><h2>Estaciones oídas</h2>
      {stationList.length === 0 ? <p className="aprs-empty">Todavía no se ha decodificado ninguna estación.</p>
        : <div className="aprs-table-wrap"><table className="aprs-table"><thead><tr><th>Indicativo</th><th>Paquetes</th><th>Último</th><th>Posición</th>{home && <th>Distancia</th>}<th>Vía</th></tr></thead>
          <tbody>{stationList.map(s => <tr key={s.call}><td><button type="button" className="aprs-link" onClick={() => setFilter(s.call)}>{s.call}</button>
            {s.symbol && <small> {symbolName(s.symbol.table, s.symbol.code) || ''}</small>}</td>
            <td>{s.count}</td><td>{clock(s.last)}</td>
            <td>{s.position ? <a href={`https://www.openstreetmap.org/?mlat=${s.position.lat}&mlon=${s.position.lon}#map=13/${s.position.lat}/${s.position.lon}`} target="_blank" rel="noreferrer">{maidenhead(s.position.lat, s.position.lon)}</a> : '—'}</td>
            {home && <td>{s.position ? `${fixed(distanceKm(home, s.position), 1)} km` : '—'}</td>}
            <td>{s.direct && s.digipeated ? 'directa y digi' : s.direct ? 'directa' : 'digipetidor'}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="aprs-panel"><div className="aprs-log-head"><h2>Paquetes</h2>
      <input placeholder="Filtrar (indicativo, texto…)" value={filter} onChange={e => setFilter(e.target.value)} />
      <button type="button" disabled={!packets.length} onClick={() => download(`aprs-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.txt`,
        [...packets].reverse().map(p => `${new Date(p.receivedAt).toISOString()} ${p.line}`).join('\n') + '\n')}><i className="bi bi-download" /> Exportar TNC2</button>
      <button type="button" disabled={!packets.length} onClick={() => { setPackets([]); setRejected(0); setFilter('') }}>Vaciar</button></div>
      {shown.length === 0 ? <p className="aprs-empty">{packets.length ? 'Ningún paquete coincide con el filtro.' : 'Los paquetes aparecerán aquí al decodificarse.'}</p>
        : <div className="aprs-log">{shown.map(p => <article key={p.id}>
          <div className="aprs-packet-head"><strong>{formatCall(p.frame.source)}</strong><span className={`aprs-badge aprs-${p.aprs.type}`}>{TYPE_LABELS[p.aprs.type] || p.aprs.type}</span>
            <span className="aprs-hint">→ {formatCall(p.frame.destination)}{p.frame.path.length ? ` vía ${p.frame.path.map((d, i, all) => formatCall(d) + (d.repeated && !all.slice(i + 1).some(x => x.repeated) ? '*' : '')).join(', ')}` : ''}</span>
            <time>{clock(p.receivedAt)} · {p.origin}</time></div>
          <dl>{details(p.aprs, home).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          <code>{p.line}</code>
          {p.twists && <small className="aprs-hint">Decodificado por {p.twists.length}/7 compensaciones ({p.twists[0]} a {p.twists[p.twists.length - 1]} dB)</small>}
        </article>)}</div>}
    </section>
  </div>
}
