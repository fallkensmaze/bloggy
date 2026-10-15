import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrowserRadioAudio } from '../utils/radioAudioBrowser'
import { AUDIO_MODEM_DEFAULTS, voxAudio, FskAudioReceiver } from '../utils/radioAudioModem'
import { STATION_STATUS } from '../utils/radioAudioStation'
import { JOIN_LABELS } from '../utils/radioAudioAutoStation'
import { validIdentity, identityEnvelope, readIdentityEnvelope, BROADCAST_IDENTITY } from '../utils/radioAudioIdentity'
import RadioNetworkMap from '../components/RadioNetworkMap'
import { FRAME_TYPES as T, textBytes, bytesText, wavBytes } from '../utils/emergencyRadioAudio'
import '../styles/radio-audio-station.css'

const defaults = { ...AUDIO_MODEM_DEFAULTS, id: 1, network: 17, name: '', deviceId: '', autoAck: true, shareTopology: true, autoId: true }
const initial = () => { try {
  const saved = JSON.parse(localStorage.getItem('radio_audio_station_settings_v1') || '{}')
  if (saved.autoId == null && /^Estación(?: \d+)?$/.test(saved.name || '')) saved.name = ''
  return { ...defaults, ...saved }
} catch { return defaults } }
const empty = { messages: [], inbox: [], peers: [], logs: [], stats: { tx: 0, rx: 0, retries: 0, acks: 0 }, conflict: false }
const clock = time => new Date(Date.now() - performance.now() + time * 1000).toLocaleTimeString('es-ES')
const typeLabel = type => type === T.ACK ? 'acuse' : type === T.HELLO ? 'anuncio' : type === T.TOPOLOGY ? 'mapa de red' : 'mensaje'
const toneLevel = db => Number.isFinite(db) && db > -99 ? `${db.toFixed(0)} dBFS` : 'sin nivel medible'
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a')
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function RadioAudioStation() {
  const [config, setConfig] = useState(initial)
  const [active, setActive] = useState(false); const [starting, setStarting] = useState(false)
  const [snapshot, setSnapshot] = useState(empty); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [text, setText] = useState('Necesitamos agua en el punto de encuentro.')
  const [destination, setDestination] = useState(''); const [priority, setPriority] = useState(1)
  const [level, setLevel] = useState({ db: -100, receiving: false, clipping: false, accepted: 0, rejected: 0 })
  const [transmitting, setTransmitting] = useState(false); const [txType, setTxType] = useState(T.DATA)
  const [devices, setDevices] = useState([]); const [capture, setCapture] = useState(null); const [test, setTest] = useState('')
  const [recording, setRecording] = useState(false); const [recorded, setRecorded] = useState(null)
  const controller = useRef(null); const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; void controller.current?.stop() } }, [])
  function change(key, value) {
    setConfig(c => { const next = { ...c, [key]: value }; try { localStorage.setItem('radio_audio_station_settings_v1', JSON.stringify(next)) } catch { /* preferences optional */ } return next })
    if (key === 'autoAck') controller.current?.setAutoAck(value)
    if (key === 'shareTopology') controller.current?.setShareTopology(value)
  }
  async function start() {
    setError(''); setNotice(''); setStarting(true); setLevel({ db: -100, accepted: 0, rejected: 0 })
    setRecorded(null); setRecording(false); setCapture(null)
    setDestination(config.autoId ? '' : 2)
    let session
    try {
      session = new BrowserRadioAudio(config, {
        onChange: s => { if (mounted.current && controller.current === session) setSnapshot(s) },
        onLevel: v => { if (mounted.current && controller.current === session) setLevel(v) },
        onTransmit: (v, type) => { if (mounted.current && controller.current === session) { setTransmitting(v); if (type) setTxType(type) } },
        onStarted: v => { if (mounted.current && controller.current === session) setCapture(v) },
        onAddress: id => { if (mounted.current && controller.current === session) change('automaticId', id) },
        onRecording: v => { if (mounted.current && controller.current === session) { setRecorded(v); setRecording(false) } },
        onRecordingError: reason => { if (mounted.current && controller.current === session) { setRecording(false); setError(reason) } },
        onStopped: reason => { if (mounted.current && controller.current === session) { setActive(false); setStarting(false); setRecording(false); setNotice(reason) } }
      })
      controller.current = session; await session.start()
      if (!mounted.current || session.closed || controller.current !== session) return
      setActive(true)
      try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput')) } catch { /* default mic remains usable */ }
    } catch (e) {
      if (mounted.current && (!session || controller.current === session)) {
        setError(e.name === 'NotAllowedError' ? 'Permite el micrófono en el navegador y vuelve a activar la estación.' : e.name === 'NotFoundError' ? 'No se encuentra un micrófono. Conecta uno o elige otra entrada.' : e.message)
        setActive(false)
      }
    } finally { if (mounted.current && (!session || controller.current === session)) setStarting(false) }
  }
  async function stop() { await controller.current?.stop(); setActive(false); setStarting(false); setRecording(false); setNotice('Micrófono y emisiones detenidos. Las grabaciones incompletas se han descartado.') }
  function recordDiagnostic() {
    setError('')
    try { controller.current.recordDiagnostic(); setRecorded(null); setRecording(true) }
    catch (e) { setError(e.message) }
  }
  function send(e) { e.preventDefault(); setError(''); try { controller.current.send(text, destination, priority) } catch (e) { setError(e.message) } }
  function announce() { setError(''); try { controller.current.announce() } catch (e) { setError(e.message) } }
  function examplePacket() {
    if (config.autoId) {
      if (!Number.isInteger(config.network) || config.network < 1 || config.network > 254) throw new Error('Revisa el grupo de tramas.')
      const own = controller.current?.protocol.config
      const target = validIdentity(destination) ? destination : BROADCAST_IDENTITY
      const peer = snapshot.peers.find(p => p.identity === target)
      const dst = target === BROADCAST_IDENTITY ? 255 : peer?.id
      if (!dst) throw new Error('Elige una estación directa para la prueba.')
      return { type: T.DATA, net: config.network, origin: own?.id || 1, sender: own?.id || 1, dst, next: dst, ttl: 1,
        epoch: crypto.getRandomValues(new Uint16Array(1))[0], seq: 1, attempt: 0, priority,
        payload: identityEnvelope(own?.identity || crypto.randomUUID().replaceAll('-', ''), target, [...textBytes(text.trim())]) }
    }
    if (![config.id, config.network].every(v => Number.isInteger(v) && v >= 1 && v <= 254) || !Number.isInteger(Number(destination)) || Number(destination) < 1 || Number(destination) > 255) throw new Error('Revisa los identificadores de estación, grupo y destino.')
    return { type: T.DATA, net: config.network, origin: config.id, sender: config.id, dst: Number(destination), next: Number(destination), ttl: 1,
      epoch: crypto.getRandomValues(new Uint16Array(1))[0], seq: 1, attempt: 0, priority, payload: [...textBytes(text.trim())] }
  }
  function selfTest() {
    setError(''); setTest('')
    try {
      const p = examplePacket(); const samples = voxAudio(p, config); const rx = new FskAudioReceiver(config.baud); const frames = []
      rx.push(new Float32Array(137))
      for (let i = 0; i < samples.length; i += 173) frames.push(...rx.push(samples.subarray(i, i + 173)))
      if (frames.length !== 1 || bytesText(Uint8Array.from(readIdentityEnvelope(frames[0].packet.payload)?.payload || frames[0].packet.payload)) !== text.trim()) throw new Error('La autoprueba no ha recuperado el texto.')
      setTest(`Autoprueba correcta: sincronismo y CRC válidos; ${(samples.length / 9600).toFixed(2)} s de audio. No se ha usado el micrófono ni se ha emitido sonido.`)
    } catch (e) { setError(e.message) }
  }
  const locked = active || starting
  const canSend = active && !snapshot.conflict && !recording && (!config.autoId || snapshot.joinState === 'ready')
  const currentId = snapshot.config?.id ?? config.id
  const bytes = textBytes(text.trim()).length
  const bar = Math.max(0, Math.min(100, (level.db + 80) / 80 * 100))
  const state = !active ? 'Detenida' : snapshot.conflict ? 'Conflicto de identidad · emisión bloqueada' : transmitting ? `Emitiendo ${typeLabel(txType)}` : config.autoId && snapshot.joinState !== 'ready' ? JOIN_LABELS[snapshot.joinState] || 'Incorporándose' : recording ? 'Grabando prueba de recepción' : level.receiving ? 'Recibiendo trama' : level.db > config.busyDb ? 'Canal con audio' : 'Escuchando'

  return <div className="ra-station">
    <header className="ra-header"><div><p className="ra-eyebrow">Radioafición · audio real · versión 0.3</p><h1>Estación de audio · VOX</h1>
      <p>El micrófono escucha el walkie; el altavoz reproduce los mensajes codificados. Cada navegador trabaja como una estación independiente.</p></div>
      <Link to="/red-emergencia" className="ra-lab-link"><i className="bi bi-diagram-3" /> Ir al simulador de red</Link></header>
    <div className="ra-intro"><span><i className="bi bi-laptop" /> Audio y mensajes procesados en tu dispositivo</span><span><i className="bi bi-broadcast" /> Comunicación directa por sonido</span></div>
    <p className="ra-description">Mensajes directos y mapa compartido de las estaciones conocidas. El audio no se sube a Internet.
      Una vez cargada la página, el intercambio utiliza el canal de audio; para volver a cargarla necesitas conexión.</p>
    {error && <p className="ra-alert ra-error" role="alert">{error}</p>}
    {notice && <p className="ra-alert" role="status">{notice}</p>}
    {snapshot.conflict && <p className="ra-alert ra-error" role="alert">{snapshot.identityConflict ? 'Esta identidad está activa en otra sesión. Detén la otra pestaña o sesión y vuelve a incorporarte.' : 'Otra estación usa tu ID manual. Detén la estación y activa la asignación automática o elige otro identificador.'}</p>}
    {active && ['full', 'failed'].includes(snapshot.joinState) && <p className="ra-alert ra-error" role="alert">{JOIN_LABELS[snapshot.joinState]}. Detén y vuelve a incorporarte cuando el canal o el grupo estén disponibles.</p>}

    <section className="ra-panel"><h2>1. Prepara la estación</h2>
      <div className="ra-settings"><label className="ra-check"><input type="checkbox" checked={config.autoId} disabled={locked} onChange={e => { change('autoId', e.target.checked); setDestination(e.target.checked ? '' : 2) }} /> Asignar ID automáticamente</label>
        <label>Nombre {config.autoId ? '(opcional)' : ''}<input value={config.name} placeholder={config.autoId ? 'Ej. Equipo norte' : 'Escribe un nombre'} disabled={locked} onChange={e => change('name', e.target.value)} maxLength="32" /></label>
        <label>Grupo de tramas<input type="number" min="1" max="254" value={config.network} disabled={locked} onChange={e => change('network', Number(e.target.value))} /></label>
        <label>Tasa de datos<select value={config.baud} disabled={locked} onChange={e => change('baud', Number(e.target.value))}><option value="300">300 bit/s · comenzar aquí</option><option value="600">600 bit/s · menor duración</option></select></label></div>
      {!config.autoId && <label className="ra-manual-id">ID manual · modo anterior<input type="number" min="1" max="254" value={config.id} disabled={locked} onChange={e => change('id', Number(e.target.value))} /></label>}
      <p className="ra-hint">{config.autoId ? 'Al unirte, el móvil escucha, elige un número disponible y se anuncia. Las coincidencias se resuelven automáticamente. Todos los participantes deben usar esta versión en modo automático.' : 'En modo manual hay que coordinar IDs distintos; los mensajes no llevan identidad estable.'}
        {' '}Usa el mismo grupo y la misma tasa en todos los equipos. El grupo no selecciona la frecuencia del walkie.</p>
      <div className="ra-audio-config"><label>Micrófono<select disabled={locked} value={config.deviceId} onChange={e => change('deviceId', e.target.value)}><option value="">Entrada predeterminada</option>
        {devices.filter(d => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Micrófono ${i + 1}`}</option>)}</select></label>
        <label className="ra-check"><input type="checkbox" checked={config.autoAck} onChange={e => change('autoAck', e.target.checked)} /> Acuses automáticos al recibir un mensaje dirigido a mí</label></div>
      <div className="ra-actions">{locked ? <button type="button" className="ra-stop" onClick={stop}><i className="bi bi-stop-circle" /> Detener todo</button> : <button type="button" className="ra-primary" onClick={start}><i className="bi bi-mic" /> {config.autoId ? 'Unirme a la red' : 'Activar estación'}</button>}
        <button type="button" disabled={!canSend} onClick={announce}>Anunciar mi presencia</button><span className="ra-hint">{starting ? 'Esperando permiso del micrófono…' : config.shareTopology ? 'El anuncio inicia un intercambio acotado del mapa.' : 'Mapa en escucha; no se comparte ni se propaga.'}</span></div>
    </section>

    <section className="ra-console" aria-label="Estado del audio"><div className="ra-live"><span className={`ra-dot ${active ? transmitting ? 'ra-tx' : 'ra-on' : ''}`} /><strong aria-live="polite">{state}</strong>
        <p>{active ? `${snapshot.config?.name || config.name} · ID ${currentId}${config.autoId && snapshot.joinState !== 'ready' ? ' provisional' : ''} · grupo ${config.network} · ${config.baud} bit/s` : 'Únete a la red para escuchar y enviar.'}</p>
        {active && snapshot.renumbers > 0 && <p>Coincidencias resueltas automáticamente: {snapshot.renumbers}.</p>}
        {active && snapshot.config?.identityPersistent === false && <p>Identidad temporal: este navegador no permite guardarla.</p>}</div>
      <div><div className="ra-meter"><div style={{ width: `${bar}%` }} className={level.clipping ? 'ra-clipping' : ''} /></div>
        <p className="ra-hint">Micrófono: {level.db > -99 ? `${level.db.toFixed(0)} dBFS` : 'sin señal'} · {level.clipping ? 'Saturación: baja el volumen del walkie.' : 'Nivel después del filtro de audio'}</p></div>
      <div className="ra-counters"><span><b>{snapshot.stats.tx}</b> emisiones</span><span><b>{snapshot.stats.rx}</b> tramas del grupo</span><span><b>{snapshot.stats.acks}</b> confirmados</span><span><b>{snapshot.stats.retries}</b> reintentos</span></div>
    </section>

    <RadioNetworkMap topology={snapshot.topology} config={snapshot.config || config} active={active} sharing={config.shareTopology} onSharingChange={v => change('shareTopology', v)} />

    <section className="ra-panel ra-diagnostics" aria-label="Diagnóstico de recepción"><h2>Diagnóstico de recepción</h2>
      <p className="ra-hint">{active && !transmitting ? 'Niveles de los tonos recibidos, actualizados durante la escucha.' : 'Lectura pausada; los niveles mostrados corresponden a la última escucha.'}
        {' '}Un nivel alto no garantiza que el sonido contenga una trama.</p>
      <div className="ra-tones">{[1200, 2400].map((hz, i) => <div key={hz}>
        <span>{hz} Hz · tono {i}</span><strong>{toneLevel(level.tonesDb?.[i])}</strong>
        <div className="ra-meter" aria-hidden="true"><div style={{ width: `${Math.max(0, Math.min(100, ((level.tonesDb?.[i] ?? -100) + 80) / 80 * 100))}%` }} /></div>
      </div>)}</div>
      <div className="ra-counters"><span><b>{level.prefixes || 0}</b> candidatos con prefijo</span><span><b>{level.rejected || 0}</b> candidatos rechazados</span><span><b>{level.accepted || 0}</b> tramas válidas de cualquier grupo</span></div>
      <p className="ra-hint">Se prueban distintas alineaciones y compensaciones de tonos: una emisión puede producir varios candidatos.
        {' '}Los niveles son máximos por intervalo de 0,1 s después del filtro, no una medida de señal/ruido.</p>
      <p className="ra-hint">{level.accepted > 0 ? 'Se han descifrado tramas. Si no aparece el mensaje esperado, comprueba su grupo y destino.'
        : level.prefixes > 0 ? 'Se ha reconocido al menos un prefijo, pero todavía no hay tramas válidas. Prueba con menos volumen y otra posición entre los equipos.'
        : 'Todavía no se ha reconocido un prefijo. Comprueba 300 bit/s en ambos equipos y observa si llegan los dos tonos durante el anuncio remoto.'}</p>
      <p>Para investigar un fallo: desactiva «Compartir y propagar el mapa» en ambos equipos, pulsa «Grabar recepción · 10 s» aquí y después «Anunciar mi presencia» en el otro dispositivo.
        Mantén esta página visible. Durante la grabación se aplazan las emisiones y los acuses de esta estación.</p>
      <div className="ra-actions"><button type="button" disabled={!canSend || transmitting} onClick={recordDiagnostic}>Grabar recepción · 10 s</button>
        {recording && <><span role="status">Grabando {Math.min(10, level.recordingSeconds ?? 0).toFixed(1)} / 10 s…</span>
          <button type="button" onClick={() => { controller.current?.cancelRecording(); setRecording(false) }}>Cancelar grabación</button></>}
        {recorded && <><button type="button" onClick={() => download('radio-recepcion-10s.wav', wavBytes(recorded.samples), 'audio/wav')}>Descargar audio recibido</button>
          <button type="button" onClick={() => { const { samples, type, id, ...metadata } = recorded; download('radio-recepcion-diagnostico.json', JSON.stringify({ version: 'RADIO_AUDIO_RX_DIAGNOSTIC_V1', ...metadata,
            durationSeconds: samples.length / recorded.sampleRate, scope: 'Audio recibido tras filtros y remuestreo a 9600 Hz. No es audio crudo del micrófono. Contadores de sesión antes y después de la grabación.' }, null, 2), 'application/json') }}>Descargar datos de la prueba</button>
          <button type="button" onClick={() => setRecorded(null)}>Descartar grabación</button></>}
      </div>
      {recorded && <p role="status">Grabación lista: {recorded.after.prefixes - recorded.before.prefixes} candidatos con prefijo y {recorded.after.accepted - recorded.before.accepted} tramas válidas durante la prueba.</p>}
      <p className="ra-hint">Solo se graba al pulsar el botón. Son 10 s de audio recibido tras el filtro y remuestreo a 9600 Hz; puede incluir voces del entorno.
        No se sube a Internet ni se guarda automáticamente. Puedes descargarlo o descartarlo. Una sesión nueva borra la grabación anterior.</p>
    </section>

    <div className="ra-columns"><section className="ra-panel"><h2>2. Envía un mensaje</h2>
      <form onSubmit={send}><div className="ra-message-options"><label>Destino<select aria-label="Destino" value={destination} onChange={e => setDestination(config.autoId ? e.target.value : Number(e.target.value))}>
        <option value="">Elige una estación</option><option value="255">Alcance directo · sin acuse</option>
        {config.autoId ? snapshot.peers.filter(p => validIdentity(p.identity)).map(p => <option key={p.identity} value={p.identity}>{p.name} · ID {p.id} · {p.identity.slice(-4)}</option>) :
          [...new Set([2, ...snapshot.peers.map(p => p.id), Number(destination)])].filter(id => id >= 1 && id < 255 && id !== config.id).sort((a, b) => a - b).map(id => <option key={id} value={id}>{snapshot.peers.find(p => p.id === id)?.name || `Estación ${id}`} · ID {id}</option>)}</select></label>
        {!config.autoId && <label>ID de destino<input type="number" min="1" max="255" value={destination} onChange={e => setDestination(Number(e.target.value))} /></label>}
        <label>Prioridad<select value={priority} onChange={e => setPriority(Number(e.target.value))}><option value="0">Emergencia</option><option value="1">Urgente</option><option value="2">Normal</option></select></label></div>
        <label>Mensaje breve<textarea rows="3" value={text} onChange={e => setText(e.target.value)} placeholder="Escribe hasta 96 bytes UTF-8" /></label>
        <div className="ra-actions"><span className={bytes > 96 ? 'ra-invalid' : 'ra-hint'}>{bytes} / 96 bytes UTF-8</span><button className="ra-primary" disabled={!canSend || !destination || !bytes || bytes > 96}>Enviar por audio</button></div>
      </form><p className="ra-hint">Se escucha el canal antes de emitir. Un envío dirigido se intenta como máximo tres veces; solo el acuse recibido confirma la entrega.
        Los equipos indirectos del mapa todavía no reciben mensajes a través de intermediarios.</p>
      <div className="ra-history" aria-label="Mensajes enviados">{[...snapshot.messages].reverse().map(m => <article key={m.id}><div className="ra-message-heading"><b>Yo → {m.destinationName || (m.dst === 255 ? 'Grupo' : `ID ${m.dst}`)}</b><time>{clock(m.created)}</time></div><p>{m.text}</p>
        <small className={m.status === 'confirmed' ? 'ra-confirmed' : ''}>{STATION_STATUS[m.status]} · {m.attempts} intento(s){m.confirmedAt != null ? ` · ${(m.confirmedAt - m.created).toFixed(1)} s` : ''}</small></article>)}
        {!snapshot.messages.length && <p className="ra-empty">Los envíos y sus acuses aparecerán aquí.</p>}</div>
    </section><section className="ra-panel"><h2>3. Escucha a las otras estaciones</h2>
      <div className="ra-history ra-inbox" aria-label="Mensajes recibidos">{[...snapshot.inbox].reverse().map(m => <article key={m.id}><div className="ra-message-heading"><b>{snapshot.peers.find(p => m.originIdentity ? p.identity === m.originIdentity : p.id === m.origin)?.name || `Estación ${m.origin}`} · ID {m.origin}</b><time>{clock(m.time)}</time></div>
        <p>{m.text}</p><small>CRC válido · {m.broadcast ? 'Mensaje al grupo, sin acuse' : config.autoAck ? 'Acuse automático habilitado' : 'Acuse automático desactivado'}</small></article>)}
        {!snapshot.inbox.length && <p className="ra-empty">Esperando mensajes decodificados del micrófono. El ruido y la voz no se presentan como texto.</p>}</div>
      <h3>Historial de escucha directa</h3><div className="ra-peers">{snapshot.peers.map(p => <button key={p.identity || p.id} type="button" disabled={config.autoId && !validIdentity(p.identity)} onClick={() => setDestination(config.autoId ? p.identity : p.id)}><b>{p.name}</b><span>ID {p.id} · {clock(p.lastHeard)}{p.legacy ? ' · modo manual' : ''}</span></button>)}
        {!snapshot.peers.length && <p className="ra-hint">Pulsa «Anunciar mi presencia» en el otro equipo. Oír a una estación no demuestra todavía que te oiga a ti.</p>}</div>
    </section></div>

    <details className="ra-panel"><summary>Ajustar VOX y recepción</summary><div className="ra-settings ra-calibration">
      <label>Tono previo VOX · {config.leadMs} ms<input type="range" min="200" max="2000" step="100" value={config.leadMs} disabled={locked} onChange={e => change('leadMs', Number(e.target.value))} /></label>
      <label>Espera de retorno · {config.releaseMs} ms<input type="range" min="400" max="3000" step="100" value={config.releaseMs} disabled={locked} onChange={e => change('releaseMs', Number(e.target.value))} /></label>
      <label>Volumen digital · {Math.round(config.volume * 100)} %<input type="range" min="0.05" max="0.8" step="0.05" value={config.volume} disabled={locked} onChange={e => change('volume', Number(e.target.value))} /></label>
      <label>Canal ocupado por encima de {config.busyDb} dBFS<input type="range" min="-60" max="-15" step="1" value={config.busyDb} disabled={locked} onChange={e => change('busyDb', Number(e.target.value))} /></label></div>
      <p>El tono previo activa VOX antes de la trama. La espera de retorno retrasa la siguiente emisión y debe superar el tiempo que el walkie mantiene la transmisión después del sonido.
        Si falla el acuse, aumenta esa espera en ambos equipos. Si el ambiente mantiene el canal ocupado, ajusta el umbral por encima de su nivel de reposo.
        Ese umbral controla cuándo emitir; no cambia la sensibilidad del decodificador.</p>
      <p>El altavoz de salida se elige en el dispositivo. Se pide captura sin cancelación de eco, supresión de ruido ni ganancia automática, porque pueden alterar los tonos.
        La escucha se reactiva al terminar el audio, también durante la espera de retorno, para recibir los acuses. Durante la emisión local se bloquea la recepción. Nunca se reproduce el micrófono por el altavoz.</p>
      {capture && <p className="ra-hint">Captura: {capture.sampleRate} muestras/s. Procesamiento informado por el navegador: eco {String(capture.settings.echoCancellation ?? 'no informado')},
        {' '}ruido {String(capture.settings.noiseSuppression ?? 'no informado')}, ganancia {String(capture.settings.autoGainControl ?? 'no informado')}. {level.rejected || 0} candidatos rechazados por cabecera/CRC.</p>}
    </details>
    <section className="ra-panel"><h2>Prueba sin walkie</h2><p>Comprueba primero el módem local. Después prueba entre dos dispositivos cercanos: el altavoz de uno transmite y el micrófono del otro recibe.</p>
      <div className="ra-actions"><button type="button" onClick={selfTest} disabled={!bytes || bytes > 96}>Autoprueba local · sin emitir</button>
        <button type="button" disabled={!bytes || bytes > 96} onClick={() => { try { download('radio-audio-prueba.wav', wavBytes(voxAudio(examplePacket(), config)), 'audio/wav') } catch (e) { setError(e.message) } }}>Descargar WAV del mensaje</button>
        <button type="button" onClick={() => download('estacion-audio-ensayo.json', JSON.stringify({ version: 'RADIO_AUDIO_STATION_V1', ...snapshot, config: snapshot.config || config, scope: 'Estado local; sin grabación del micrófono ni garantía de entrega.' }, null, 2), 'application/json')}>Exportar estado JSON</button></div>
      {test && <p className="ra-test-result" role="status">{test}</p>}<p className="ra-hint">El WAV permite probar la recepción desde un reproductor. Esta descarga no registra un envío confirmado en la estación.</p>
    </section>
    <details className="ra-panel ra-guide" open><summary>Cómo probar con dos walkies</summary><ol>
      <li>Usa el mismo canal y subtono en ambos walkies, activa VOX y coloca cada dispositivo cerca de su walkie. Empieza con volumen moderado.</li>
      <li>Abre esta versión en cada dispositivo: asignación automática, grupo 17 y tasa 300 bit/s. Escribe un nombre si quieres, pulsa «Unirme a la red» y permite el micrófono.</li>
      <li>Espera a que termine la incorporación. Se hacen dos anuncios con esperas aleatorias; si hay coincidencias, el número cambia automáticamente. Con «Compartir y propagar el mapa» activado también se descubren conflictos entre equipos que no se oyen directamente. En redes de varios equipos el intercambio puede tardar más de un minuto.</li>
      <li>Elige la estación destinataria y envía un texto breve. La selección se conserva aunque cambie su número. Espera a «Recepción confirmada». «Sin confirmación» puede significar que se perdió el mensaje o el acuse.</li>
      <li>Ajusta el tono previo, el retorno y el volumen si el VOX recorta la trama. Mantén la app visible y la pantalla encendida.</li></ol>
      <p>La página se detiene al pasar a segundo plano o suspenderse el audio, para evitar emisiones acumuladas al volver. Los mensajes quedan en memoria;
        se borran al recargar o iniciar una sesión nueva. Se guardan las preferencias, la identidad aleatoria de este navegador y su último ID automático; no las identidades de otros equipos.
        Usa una sola pestaña de la estación. La identidad no autentica a una persona y no es un número de hardware.</p>
      <p>Modulación BFSK de 1200/2400 Hz, entrenamiento de 16 bytes AA, prefijo AA AA AA AA D3 91, cabecera de 16 bytes y CRC-16/CCITT-FALSE.
        El receptor busca el prefijo con distintas alineaciones y compensa diferencias entre tonos; acepta únicamente tramas con CRC válido. Los mensajes y acuses usan TTL 1;
        los informes del mapa se propagan hasta cuatro saltos, con caducidad y supresión de duplicados. Grupo 17 por defecto; no es interoperable con el protocolo del simulador.
        No hay FEC, autenticación ni confirmación de lectura humana.</p>
      <p>Esta versión necesita pruebas con grabaciones y equipos reales; la autoprueba no valida la transmisión por RF. En España, la <a href="https://www.boe.es/buscar/act.php?id=BOE-A-2026-15661" target="_blank" rel="noreferrer">UN-110 del CNAF</a>
        {' '}excluye el uso de PMR446 como repetidor o estación base. Compartir el mapa incluye retransmitir informes recibidos: desactiva esa opción para ensayos de escucha y mensajes directos.</p>
      <p>El objetivo es estudiar comunicaciones de socorro. El artículo 4.9 del <a href="https://www.itu.int/pub/R-REG-RR-2024" target="_blank" rel="noreferrer">Reglamento de Radiocomunicaciones de la UIT</a>
        {' '}contempla el uso de los medios disponibles por una estación en peligro o que la asiste para pedir o prestar auxilio. La intención de uso en emergencias no es una autorización general para los ensayos.
        El envío de mensajes y acuses por varios saltos requiere una fase posterior de desarrollo y pruebas.</p>
    </details>
    <details className="ra-panel"><summary>Eventos de esta estación</summary><ol className="ra-events">{[...snapshot.logs].reverse().map((v, i) => <li key={i}><time>{clock(v.time)}</time> {v.text}</li>)}
      {!snapshot.logs.length && <li>Todavía no hay eventos.</li>}</ol></details>
  </div>
}
