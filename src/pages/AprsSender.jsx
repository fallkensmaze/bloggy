import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuthUser } from '../utils/adminAuth'
import { loginWithGoogle } from '../utils/authGoogle'
import { afskModulate } from '../utils/aprsModem'
import { CONTADOR_MAX, MAX_TEXTO_APRS, construirMensaje, errorTexto, limpiarTexto, parseRuta, problemasConfig, tramaMensaje, verificarMensaje } from '../utils/aprsSigner'
import { guardarConfig, leerConfigPublica, reservarContador } from '../utils/aprsSenderStore'
import { readNumber, writeValue } from '../utils/localSettings'
import '../styles/aprs.css'
import '../styles/aprs-sender.css'

const KEY_NIVEL = 'aprs_sender_nivel'
const KEY_PREAMBULO = 'aprs_sender_preambulo'
const KEY_RETARDO = 'aprs_sender_retardo'
const KEY_LETRA = 'aprs_sender_letra'

const CONFIG_VACIA = { indicativo: '', destinatario: 'ALERTA', ruta: 'WIDE1-1,WIDE2-1', contador: 0, secretoLargo: 0 }
const SEG_POR_FLAG = 8 / 1200

function mensajeError(e) {
  if (e?.code === 'permission-denied') return 'Firestore ha denegado el acceso a APRS_PRIVADO. Despliega la regla de APRS_EMISOR.md desde tu entorno privado.'
  return e?.message || String(e)
}

export default function AprsSender() {
  const { user, loading, isAdmin } = useAuthUser()

  const [cfg, setCfg] = useState(CONFIG_VACIA)
  const [borrador, setBorrador] = useState({ ...CONFIG_VACIA, contador: '0' })
  const [secreto, setSecreto] = useState('')
  const [cargada, setCargada] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const [letra, setLetra] = useState(() => { try { return (localStorage.getItem(KEY_LETRA) || 'A').slice(0, 1).toUpperCase() } catch { return 'A' } })
  const [texto, setTexto] = useState('')
  const [nivel, setNivel] = useState(() => readNumber(KEY_NIVEL, { min: 5, max: 90, fallback: 40 }))
  const [preambulo, setPreambulo] = useState(() => readNumber(KEY_PREAMBULO, { min: 20, max: 200, fallback: 60 }))
  const [retardo, setRetardo] = useState(() => readNumber(KEY_RETARDO, { min: 0, max: 10, fallback: 3 }))

  const [ultimo, setUltimo] = useState(null)      // { linea, contador, trama, indicativo }
  const [estado, setEstado] = useState('reposo')  // reposo | espera | sonando
  const [duracion, setDuracion] = useState(null)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  const reproduccion = useRef(null)
  const montada = useRef(true)

  const detener = useCallback(() => {
    const r = reproduccion.current
    reproduccion.current = null
    if (r) { r.timers.forEach(clearTimeout); void r.context.close().catch(() => {}) }
    if (montada.current) setEstado('reposo')
  }, [])

  useEffect(() => { montada.current = true; return () => { montada.current = false; detener() } }, [detener])

  // ── Carga de la configuración (solo el propietario) ────────────────────────
  useEffect(() => {
    if (!isAdmin) return
    let vigente = true
    leerConfigPublica()
      .then(c => { if (vigente) { setCfg(c); setBorrador({ ...c, contador: String(c.contador) }); setCargada(true) } })
      .catch(e => { if (vigente) { setError(mensajeError(e)); setCargada(true) } })
    return () => { vigente = false }
  }, [isAdmin])

  const cambiar = (clave, valor) => setBorrador(b => ({ ...b, [clave]: valor }))

  async function guardar() {
    setError(''); setAviso('')
    const problemas = problemasConfig(borrador)
    const contador = Number(borrador.contador)
    if (!Number.isInteger(contador) || contador < 0 || contador >= CONTADOR_MAX) problemas.push(`El contador debe ser un entero entre 0 y ${CONTADOR_MAX - 1}.`)
    if (problemas.length) { setError(problemas.join(' ')); return }
    setGuardando(true)
    try {
      await guardarConfig({
        indicativo: borrador.indicativo.trim().toUpperCase(),
        destinatario: borrador.destinatario.trim().toUpperCase(),
        ruta: parseRuta(borrador.ruta).join(','),
        contador,
        secreto: secreto.trim(),
      })
      setSecreto('')
      const c = await leerConfigPublica()
      setCfg(c); setBorrador({ ...c, contador: String(c.contador) })
      setAviso('Configuración guardada en Firestore.')
    } catch (e) { setError(mensajeError(e)) } finally { setGuardando(false) }
  }

  // ── Audio ──────────────────────────────────────────────────────────────────
  async function reproducir(trama) {
    detener()
    const Contexto = window.AudioContext || window.webkitAudioContext
    if (!Contexto) throw new Error('Este navegador no tiene Web Audio.')
    const context = new Contexto()
    const audio = afskModulate([trama], { sampleRate: context.sampleRate, amplitude: nivel / 100, preambleFlags: preambulo })
    const buffer = context.createBuffer(1, audio.length, context.sampleRate)
    buffer.copyToChannel(audio, 0)
    const fuente = context.createBufferSource()
    fuente.buffer = buffer; fuente.connect(context.destination)
    const registro = { context, timers: [] }
    reproduccion.current = registro
    fuente.onended = () => { if (reproduccion.current === registro) detener() }
    await context.resume()
    fuente.start(context.currentTime + retardo)
    setDuracion(audio.length / context.sampleRate)
    if (retardo > 0) {
      setEstado('espera')
      registro.timers.push(setTimeout(() => { if (reproduccion.current === registro) setEstado('sonando') }, retardo * 1000))
    } else setEstado('sonando')
  }

  async function firmarYReproducir() {
    setError(''); setAviso('')
    const cuerpo = limpiarTexto(texto)
    const problema = errorTexto(cuerpo)
    if (problema) { setError(problema); return }
    if (!/^[A-Z]$/.test(letra)) { setError('El destinatario es una sola letra A–Z.'); return }
    setTrabajando(true)
    try {
      const r = await reservarContador()
      const problemas = problemasConfig(r)
      if (problemas.length) throw new Error(`Configuración incompleta: ${problemas.join(' ')}`)
      const m = await construirMensaje({ secreto: r.secreto, letra, contador: r.contador, texto: cuerpo })
      // Autocomprobación: lo que se va a emitir debe pasar la verificación de la pasarela.
      const v = await verificarMensaje(m.linea, r.secreto, r.contador - 1)
      if (!v.ok) throw new Error(`La autocomprobación de la firma ha fallado (${v.error}); no se emite nada.`)
      const trama = tramaMensaje({ origen: r.indicativo, destinatario: r.destinatario, ruta: parseRuta(r.ruta), linea: m.linea })
      setCfg(c => ({ ...c, contador: r.contador })); setBorrador(b => ({ ...b, contador: String(r.contador) }))
      setUltimo({ linea: m.linea, contador: r.contador, trama, indicativo: r.indicativo, destinatario: r.destinatario })
      await reproducir(trama)
    } catch (e) { detener(); setError(mensajeError(e)) } finally { if (montada.current) setTrabajando(false) }
  }

  async function repetir() {
    if (!ultimo) return
    setError(''); setAviso('')
    try { await reproducir(ultimo.trama) } catch (e) { detener(); setError(mensajeError(e)) }
  }

  // Caracteres que quedan para el texto con el contador que se reservará.
  const restantes = useMemo(() => {
    const prefijo = `${letra || 'A'} ${cfg.contador + 1} XXXXXX `.length
    return MAX_TEXTO_APRS - prefijo - limpiarTexto(texto).length
  }, [letra, cfg.contador, texto])

  const cabecera = (
    <header>
      <p className="aprs-eyebrow">Radioafición · APRS · emisor privado</p>
      <h1>Emisor APRS firmado</h1>
      <p>Firma un mensaje con el secreto guardado en Firestore y genera el audio AFSK 1200 baudios del paquete. Esta página no transmite por sí sola:
        reproduce el sonido y tú accionas el PTT de la radio. La pasarela de Apps Script comprueba la firma antes de reenviarlo por correo.</p>
    </header>
  )

  if (loading) return <div className="aprs-page">{cabecera}<p className="aprs-panel" role="status">Comprobando la sesión…</p></div>

  if (!isAdmin) {
    return <div className="aprs-page">{cabecera}
      <section className="aprs-panel aprs-gate">
        <i className="bi bi-lock aprs-gate-icon" />
        {!user ? <>
          <h2>Contenido privado</h2>
          <p>El secreto y el contador se guardan en Firestore y solo los lee la cuenta del sitio. Entra con Google aquí o desde el avatar de la barra lateral.</p>
          <div className="aprs-actions"><button type="button" className="aprs-primary" onClick={() => loginWithGoogle().catch(() => {})}><i className="bi bi-google" /> Entrar con Google</button></div>
        </> : <>
          <h2>Esta cuenta no tiene acceso</h2>
          <p>{user.email || 'La cuenta abierta'} no es la cuenta de administración del sitio.</p>
          <div className="aprs-actions"><button type="button" onClick={() => signOut(auth)}><i className="bi bi-box-arrow-right" /> Salir y probar con otra</button></div>
        </>}
      </section>
    </div>
  }

  const configurada = cfg.secretoLargo > 0 && cfg.indicativo
  const sonando = estado !== 'reposo'

  return <div className="aprs-page">
    {cabecera}
    {error && <p className="aprs-alert aprs-error" role="alert">{error}</p>}
    {aviso && <p className="aprs-alert" role="status">{aviso}</p>}

    <section className="aprs-panel"><h2>Emitir mensaje</h2>
      {cargada && !configurada && <p className="aprs-alert" role="status">Rellena y guarda abajo el indicativo y el secreto para poder firmar.</p>}
      <div className="aprs-sender-compose">
        <label>Destinatario (letra)
          <input value={letra} maxLength={1} autoCapitalize="characters" aria-label="Letra de destinatario"
            onChange={e => { const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); setLetra(v); writeValue(KEY_LETRA, v) }} />
          <small>La letra del directorio de la pasarela.</small></label>
        <label>Texto
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="llego tarde" autoComplete="off" spellCheck={false}
            onKeyDown={e => { if (e.key === 'Enter' && configurada && !trabajando) firmarYReproducir() }} />
          <small className={restantes < 0 ? 'aprs-sender-over' : ''}>{restantes >= 0 ? `Quedan ${restantes} caracteres` : `Sobran ${-restantes} caracteres`} (máximo {MAX_TEXTO_APRS} con la letra, el contador y la firma). Solo ASCII, sin {'{ } | ~'}.</small></label>
      </div>
      <div className="aprs-settings aprs-sender-audio">
        <label>Nivel de audio · {nivel} %
          <input type="range" min="5" max="90" value={nivel} onChange={e => { const v = Number(e.target.value); setNivel(v); writeValue(KEY_NIVEL, v) }} />
          <small>Con cable, mejor bajo para no saturar la entrada de micro; con altavoz, sube hasta que la radio lo module sin distorsión.</small></label>
        <label>Preámbulo · {preambulo} flags (≈ {(preambulo * SEG_POR_FLAG * 1000).toFixed(0)} ms)
          <input type="range" min="20" max="200" step="5" value={preambulo} onChange={e => { const v = Number(e.target.value); setPreambulo(v); writeValue(KEY_PREAMBULO, v) }} />
          <small>Tiempo de tonos antes de los datos, para cubrir lo que tarda la radio en emitir tras el PTT.</small></label>
        <label>Retardo de salida · {retardo} s
          <input type="range" min="0" max="10" value={retardo} onChange={e => { const v = Number(e.target.value); setRetardo(v); writeValue(KEY_RETARDO, v) }} />
          <small>Pausa entre pulsar el botón y que suene, para dar tiempo a mantener el PTT.</small></label>
      </div>
      <div className="aprs-actions">
        <button type="button" className="aprs-primary" disabled={trabajando || sonando || !configurada || restantes < 0 || !texto.trim()} onClick={firmarYReproducir}>
          <i className="bi bi-broadcast" /> {trabajando ? 'Firmando…' : 'Firmar y reproducir'}</button>
        <button type="button" disabled={!ultimo || trabajando || sonando} onClick={repetir}><i className="bi bi-arrow-repeat" /> Repetir el último</button>
        {sonando && <button type="button" className="aprs-stop" onClick={detener}><i className="bi bi-stop-circle" /> Detener</button>}
      </div>
      {estado === 'espera' && <p className="aprs-alert" role="status">Empieza a sonar en {retardo} s: pulsa y mantén el PTT ahora.</p>}
      {estado === 'sonando' && duracion !== null && <p className="aprs-alert" role="status">Sonando (≈ {duracion.toFixed(1)} s). Mantén el PTT hasta que termine.</p>}
      {ultimo && <div className="aprs-sender-last">
        <p className="aprs-hint">Último paquete · contador {ultimo.contador} · de {ultimo.indicativo} a «{ultimo.destinatario}»</p>
        <code className="aprs-line">{ultimo.linea}</code>
        <p className="aprs-hint">Cada «Firmar y reproducir» gasta un contador; «Repetir» reutiliza el mismo paquete. Si el primero ya llegó, la pasarela rechazará la repetición como contador repetido.</p>
      </div>}
    </section>

    <section className="aprs-panel"><h2>Configuración privada</h2>
      <div className="aprs-settings">
        <label>Indicativo emisor (con SSID)
          <input value={borrador.indicativo} placeholder="EA4ABC-7" onChange={e => cambiar('indicativo', e.target.value)} autoCapitalize="characters" /></label>
        <label>Destinatario APRS
          <input value={borrador.destinatario} onChange={e => cambiar('destinatario', e.target.value)} autoCapitalize="characters" />
          <small>Debe coincidir con <code>DESTINO_APRS</code> en el <code>CONFIG</code> de la pasarela.</small></label>
        <label>Ruta (digipetidores)
          <input value={borrador.ruta} onChange={e => cambiar('ruta', e.target.value)} placeholder="WIDE1-1,WIDE2-1" />
          <small>Separados por comas. Vacío para emitir sin digipetidores.</small></label>
        <label>Último contador usado
          <input type="number" min="0" max={CONTADOR_MAX - 1} value={borrador.contador} onChange={e => cambiar('contador', e.target.value)} />
          <small>El siguiente mensaje llevará este valor + 1. Debe ser mayor que <code>ULTIMO_CONTADOR</code> de la pasarela y no pasarse en más de 50.</small></label>
        <label>Secreto compartido {cfg.secretoLargo > 0 && <em>(guardado · {cfg.secretoLargo} caracteres)</em>}
          <input type="password" autoComplete="off" value={secreto} onChange={e => setSecreto(e.target.value)}
            placeholder={cfg.secretoLargo > 0 ? 'Déjalo vacío para conservar el actual' : 'El que muestra verSecreto() en Apps Script'} />
          <small>Se guarda en Firestore y no se vuelve a mostrar. No se escribe en localStorage.</small></label>
      </div>
      <div className="aprs-actions">
        <button type="button" className="aprs-primary" disabled={guardando} onClick={guardar}><i className="bi bi-cloud-check" /> {guardando ? 'Guardando…' : 'Guardar configuración'}</button>
      </div>
    </section>
  </div>
}
