import { useState, useEffect, useMemo, useCallback } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../firebase'
import { useAuthUser } from '../utils/adminAuth'
import { loginWithGoogle } from '../utils/authGoogle'
import { parseTemaXml } from '../utils/radioXml'
import { baraja, corrige, TODOS } from '../utils/radioExam'
import { MASTERY, accuracy, masterySummary, updateProgress } from '../utils/leitner'
import { readJson, readChoice, readNumber, writeValue } from '../utils/localSettings'
import PracticePanel from '../components/radio/PracticePanel'
import ExamPanel from '../components/radio/ExamPanel'
import '../styles/radio.css'

const COLECCION    = 'RADIO_TEMAS'
const PROGRESO_KEY = 'radio_progress'
const STATS_KEY    = 'radio_stats'
const TEMA_KEY     = 'radio_tema'
const MODO_KEY     = 'radio_modo'
const TAMANO_KEY   = 'radio_tamano'

const MODOS = [
  { id: 'practica',  label: 'Práctica',  icono: 'bi-lightning-charge', hint: 'Una pregunta cada vez, corregida al momento y con repaso adaptativo' },
  { id: 'simulacro', label: 'Simulacro', icono: 'bi-clipboard-check',  hint: 'Tanda de preguntas seguidas y nota al final, como el examen' },
]

const STATS_VACIAS = { correct: 0, wrong: 0, streak: 0, best: 0 }

/** Lee un documento de tema y lo convierte en preguntas, sin dejar caer la página. */
function leeTema(id, datos) {
  const base = { id, numero: null, titulo: id, preguntas: [], avisos: [], descartadas: 0, error: null }
  if (typeof datos?.xml !== 'string' || !datos.xml.trim()) {
    return { ...base, error: 'el documento no tiene un campo «xml» con contenido' }
  }
  try {
    const tema = parseTemaXml(datos.xml)
    return {
      ...base,
      numero: tema.numero,
      titulo: tema.titulo || id,
      preguntas: tema.preguntas,
      avisos: tema.avisos,
      descartadas: tema.descartadas,
    }
  } catch (err) {
    return { ...base, error: err.message }
  }
}

function RadioExam() {
  const { user, loading, isAdmin } = useAuthUser()

  const [temas, setTemas]       = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError]       = useState('')
  const [verEstado, setVerEstado] = useState(false)

  // El tema guardado es un id de documento, así que no hay lista cerrada contra la
  // que validarlo aquí: se comprueba luego contra los temas que existan de verdad.
  const [temaId, setTemaId] = useState(() => {
    try { return localStorage.getItem(TEMA_KEY) || TODOS } catch { return TODOS }
  })
  const [modo, setModo]     = useState(() => readChoice(MODO_KEY, MODOS.map(m => m.id), 'practica'))
  const [tamano, setTamano] = useState(() => readNumber(TAMANO_KEY, { min: 1, max: 400, fallback: 20 }))

  const [progress, setProgress] = useState(() => readJson(PROGRESO_KEY, {}))
  const [stats, setStats]       = useState(() => ({ ...STATS_VACIAS, ...readJson(STATS_KEY, {}) }))
  const [confirmarReset, setConfirmarReset] = useState(false)

  // ── Carga de los temas ────────────────────────────────────────────────────
  const cargarTemas = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      const snap = await getDocs(collection(db, COLECCION))
      const lista = snap.docs.map(d => leeTema(d.id, d.data()))
      lista.sort((a, b) => (a.numero ?? 9999) - (b.numero ?? 9999) || a.id.localeCompare(b.id))
      setTemas(lista)
    } catch (err) {
      setError(err?.code === 'permission-denied'
        ? `Esta cuenta no puede leer ${COLECCION}. Despliega las reglas de Firestore con el bloque de esta colección.`
        : `No se han podido cargar los temas: ${err.message}`)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { if (isAdmin) cargarTemas() }, [isAdmin, cargarTemas])

  // ── Persistencia de preferencias y progreso ───────────────────────────────
  useEffect(() => { writeValue(PROGRESO_KEY, progress) }, [progress])
  useEffect(() => { writeValue(STATS_KEY, stats) }, [stats])
  useEffect(() => { writeValue(TEMA_KEY, temaId) }, [temaId])
  useEffect(() => { writeValue(MODO_KEY, modo) }, [modo])
  useEffect(() => { writeValue(TAMANO_KEY, tamano) }, [tamano])

  // Un tema borrado en Firestore no puede dejar la página con un mazo vacío.
  const temaActivo = temaId === TODOS || temas.some(t => t.id === temaId) ? temaId : TODOS
  const pool = useMemo(() => baraja(temas, temaActivo), [temas, temaActivo])
  const resumen = useMemo(() => masterySummary(pool, progress, p => p.key), [pool, progress])
  const total = stats.correct + stats.wrong

  const apunta = useCallback((aciertos, fallos) => {
    setStats(s => {
      const racha = fallos > 0 ? 0 : s.streak + aciertos
      return {
        correct: s.correct + aciertos,
        wrong: s.wrong + fallos,
        streak: racha,
        best: Math.max(s.best, racha),
      }
    })
  }, [])

  const registraPractica = useCallback((pregunta, ok) => {
    setProgress(p => updateProgress(p, pregunta.key, ok))
    apunta(ok ? 1 : 0, ok ? 0 : 1)
  }, [apunta])

  const registraSimulacro = useCallback((tanda, respuestas) => {
    setProgress(p => {
      let siguiente = p
      tanda.forEach((pregunta, i) => {
        siguiente = updateProgress(siguiente, pregunta.key, corrige(pregunta, respuestas[i] || []).ok)
      })
      return siguiente
    })
    const aciertos = tanda.filter((p, i) => corrige(p, respuestas[i] || []).ok).length
    apunta(aciertos, tanda.length - aciertos)
  }, [apunta])

  const reiniciar = () => {
    setProgress({})
    setStats({ ...STATS_VACIAS })
    setConfirmarReset(false)
  }

  // ── Puertas de acceso ─────────────────────────────────────────────────────
  const cabecera = (
    <div className="page-header">
      <div className="page-icon"><i className="bi bi-mortarboard"></i></div>
      <h1 className="page-title">Examen de radioaficionado</h1>
      <p className="page-subtitle">
        Temario privado por temas · práctica con repaso adaptativo y simulacros con nota
      </p>
    </div>
  )

  if (loading) {
    return (
      <div className="page-body" style={{ maxWidth: '860px' }}>
        {cabecera}
        <div className="calc-card"><p className="ra-vacio">Comprobando la sesión…</p></div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="page-body" style={{ maxWidth: '860px' }}>
        {cabecera}
        <div className="calc-card ra-gate">
          <i className="bi bi-lock ra-gate-icon" />
          {!user ? (
            <>
              <p className="ra-gate-title">Contenido privado</p>
              <p className="ra-gate-text">
                Las preguntas se guardan en Firestore y solo las lee la cuenta del sitio.
                Entra con Google aquí o desde el avatar de la barra lateral.
              </p>
              <button className="ra-btn ra-btn--primary" onClick={() => loginWithGoogle().catch(() => {})}>
                <i className="bi bi-google" /> Entrar con Google
              </button>
            </>
          ) : (
            <>
              <p className="ra-gate-title">Esta cuenta no tiene acceso</p>
              <p className="ra-gate-text">
                {user.email || 'La cuenta abierta'} no es la cuenta de administración del sitio.
              </p>
              <button className="ra-btn" onClick={() => signOut(auth)}>
                <i className="bi bi-box-arrow-right" /> Salir y probar con otra
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Página ────────────────────────────────────────────────────────────────
  const conProblemas = temas.filter(t => t.error || t.avisos.length > 0)

  return (
    <div className="page-body" style={{ maxWidth: '860px' }}>
      {cabecera}

      {error && (
        <div className="calc-card ra-error">
          <i className="bi bi-exclamation-triangle" /> {error}
        </div>
      )}

      {!cargando && temas.length === 0 && !error && (
        <div className="calc-card">
          <p className="ra-gate-title">Todavía no hay temas</p>
          <p className="ra-gate-text">
            Cada tema es un documento de la colección <code>{COLECCION}</code> con un único campo
            de texto llamado <code>xml</code>. Pega dentro el temario en este formato:
          </p>
          {/* Ejemplo con preguntas inventadas: el temario real vive solo en Firestore. */}
          <pre className="ra-ejemplo">{`<?xml version="1.0" encoding="UTF-8"?>
<tema numero="1" titulo="Título del tema">
  <pregunta>
    <enunciado>Enunciado de una pregunta de respuesta única</enunciado>
    <opcion>Una opción incorrecta</opcion>
    <opcion correcta="si">La opción correcta</opcion>
    <opcion>Otra opción incorrecta</opcion>
  </pregunta>
  <pregunta tipo="multiple">
    <enunciado>Enunciado de una pregunta de varias respuestas</enunciado>
    <opcion correcta="si">Una respuesta correcta</opcion>
    <opcion correcta="si">Otra respuesta correcta</opcion>
    <opcion>Una opción incorrecta</opcion>
  </pregunta>
</tema>`}</pre>
          <button className="ra-btn" onClick={cargarTemas}>
            <i className="bi bi-arrow-clockwise" /> Recargar
          </button>
        </div>
      )}

      {temas.length > 0 && (
        <>
          {/* ── Marcador ── */}
          <div className="calc-card" style={{ marginBottom: '16px' }}>
            <div className="ra-card-head">
              <span className="field-label" style={{ marginBottom: 0 }}>Tu progreso</span>
              {confirmarReset ? (
                <span className="ra-confirm">
                  <span>¿Borrar marcador y repaso?</span>
                  <button className="ra-btn ra-btn--danger" onClick={reiniciar}>Sí</button>
                  <button className="ra-btn" onClick={() => setConfirmarReset(false)}>No</button>
                </span>
              ) : (
                <button className="ra-btn" onClick={() => setConfirmarReset(true)} disabled={total === 0}>
                  <i className="bi bi-arrow-counterclockwise" /> Reiniciar
                </button>
              )}
            </div>

            <div className="ra-stats-grid">
              <div className="ra-stat">
                <span className="ra-stat-value ra-stat-value--green">{stats.correct}</span>
                <span className="ra-stat-label">Aciertos</span>
              </div>
              <div className="ra-stat">
                <span className="ra-stat-value ra-stat-value--red">{stats.wrong}</span>
                <span className="ra-stat-label">Fallos</span>
              </div>
              <div className="ra-stat">
                <span className="ra-stat-value ra-stat-value--blue">{accuracy(stats)}%</span>
                <span className="ra-stat-label">Precisión</span>
              </div>
              <div className="ra-stat">
                <span className="ra-stat-value ra-stat-value--orange">{stats.streak}</span>
                <span className="ra-stat-label">Racha (máx. {stats.best})</span>
              </div>
            </div>

            <div className="ra-mastery">
              <div className="ra-mastery-head">
                <span>Dominio del mazo · {resumen.dominado} de {resumen.total} preguntas</span>
                <span className="ra-mastery-legend">
                  {['dominado', 'progreso', 'flojo', 'nuevo'].map(k => (
                    <span key={k}>
                      <span className="ra-dot" style={{ background: MASTERY[k].color }} />
                      {MASTERY[k].label} {resumen[k]}
                    </span>
                  ))}
                </span>
              </div>
              <div className="ra-bar">
                {['dominado', 'progreso', 'flojo'].map(k => (
                  resumen[k] > 0 && (
                    <span
                      key={k}
                      className="ra-bar-seg"
                      style={{ width: `${(resumen[k] / resumen.total) * 100}%`, background: MASTERY[k].color }}
                    />
                  )
                ))}
              </div>
            </div>
          </div>

          {/* ── Tema y modo ── */}
          <div className="calc-card" style={{ marginBottom: '16px' }}>
            <div className="ra-card-head">
              <span className="field-label" style={{ marginBottom: 0 }}>Tema</span>
              <button className="ra-btn ra-btn--sm" onClick={cargarTemas} disabled={cargando}>
                <i className="bi bi-arrow-clockwise" /> {cargando ? 'Cargando…' : 'Recargar'}
              </button>
            </div>

            <div className="ra-chips" style={{ marginTop: '10px' }}>
              <button
                className={`ra-btn ra-btn--sm${temaActivo === TODOS ? ' ra-btn--active' : ''}`}
                onClick={() => setTemaId(TODOS)}
              >
                <i className="bi bi-shuffle" /> Aleatorio ({temas.reduce((n, t) => n + t.preguntas.length, 0)})
              </button>
              {temas.map(t => (
                <button
                  key={t.id}
                  className={`ra-btn ra-btn--sm${temaActivo === t.id ? ' ra-btn--active' : ''}`}
                  onClick={() => setTemaId(t.id)}
                  disabled={t.preguntas.length === 0}
                  title={t.error || `${t.preguntas.length} preguntas`}
                >
                  {t.numero != null ? `Tema ${t.numero}` : t.id}
                  {t.titulo && t.titulo !== t.id ? ` · ${t.titulo}` : ''} ({t.preguntas.length})
                </button>
              ))}
            </div>

            <span className="field-label" style={{ display: 'block', margin: '18px 0 10px' }}>Modo</span>
            <div className="ra-chips">
              {MODOS.map(m => (
                <button
                  key={m.id}
                  className={`ra-btn${modo === m.id ? ' ra-btn--active' : ''}`}
                  onClick={() => setModo(m.id)}
                  title={m.hint}
                >
                  <i className={`bi ${m.icono}`} /> {m.label}
                </button>
              ))}
            </div>

            {conProblemas.length > 0 && (
              <div className="ra-estado">
                <button className="ra-btn ra-btn--sm" onClick={() => setVerEstado(v => !v)}>
                  <i className={`bi bi-chevron-${verEstado ? 'up' : 'down'}`} /> {conProblemas.length} tema(s) con avisos
                </button>
                {verEstado && (
                  <ul className="ra-estado-lista">
                    {conProblemas.map(t => (
                      <li key={t.id}>
                        <strong>{t.id}</strong>
                        {t.error
                          ? <span className="ra-estado-error"> · no se pudo leer: {t.error}</span>
                          : <span> · {t.preguntas.length} preguntas, {t.descartadas} descartadas</span>}
                        {t.avisos.length > 0 && (
                          <ul>{t.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* ── Panel activo ── */}
          {modo === 'practica' ? (
            <PracticePanel pool={pool} progress={progress} onResponder={registraPractica} />
          ) : (
            <ExamPanel pool={pool} tamano={tamano} onTamano={setTamano} onFin={registraSimulacro} />
          )}
        </>
      )}
    </div>
  )
}

export default RadioExam
