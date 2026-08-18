import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { auth, db } from '../firebase'
import { signOut, onAuthStateChanged } from 'firebase/auth'
import {
  doc, getDoc, updateDoc, onSnapshot,
  collection, getDocs, writeBatch, serverTimestamp
} from 'firebase/firestore'
import { sanitizeQuestion, gradeAnswer, correctOptionId, buildResultsCsv, downloadCsv } from '../utils/exam'
import { loginWithGoogle, consumeGoogleRedirect } from '../utils/authGoogle'
import '../styles/quiz.css'
import '../styles/exam.css'

function ExamHost() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  // Auth
  const [user, setUser]       = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  // Datos
  const [session, setSession] = useState(null)       // doc EXAM_SESSIONS/sessionId
  const [quiz, setQuiz]       = useState(null)       // doc QUIZZES/quizId (completo, con correcta)
  const [tickets, setTickets] = useState([])         // TICKETS subcolección
  const [answers, setAnswers] = useState([])         // ANSWERS subcolección

  // UI
  const [error, setError]     = useState(null)
  const [correcting, setCorrecting] = useState(false)

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    consumeGoogleRedirect()
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u)
      setAuthLoading(false)
    })
    return unsub
  }, [])

  const handleLogin = async () => {
    try { await loginWithGoogle() }
    catch (e) { console.error('Login error:', e) }
  }

  const handleLogout = () => signOut(auth)

  // ── Suscripción sesión ───────────────────────────────────────────────────────
  // Las reglas exigen signedIn() para leer la sesión y soyAdmin() para listar
  // TICKETS/ANSWERS, así que esperamos a tener un usuario no anónimo antes de
  // suscribir; de lo contrario los listeners reciben permission-denied y mueren
  // sin reintentar tras el login.
  useEffect(() => {
    if (!sessionId || !user || user.isAnonymous) return
    const ref = doc(db, 'EXAM_SESSIONS', sessionId)
    const unsub = onSnapshot(ref, snap => {
      if (!snap.exists()) { setError('Sesión no encontrada.'); return }
      setSession({ id: snap.id, ...snap.data() })
    }, err => { setError('Error leyendo sesión: ' + err.message) })
    return unsub
  }, [sessionId, user])

  // ── Carga quiz completo (una sola vez cuando tengamos session.quizId) ────────
  useEffect(() => {
    if (!session?.quizId || quiz) return
    getDoc(doc(db, 'QUIZZES', session.quizId))
      .then(snap => {
        if (snap.exists()) setQuiz({ id: snap.id, ...snap.data() })
        else setError('Quiz no encontrado.')
      })
      .catch(e => setError('Error cargando quiz: ' + e.message))
  }, [session?.quizId, quiz])

  // ── Suscripción TICKETS ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !user || user.isAnonymous) return
    const ref = collection(db, 'EXAM_SESSIONS', sessionId, 'TICKETS')
    const unsub = onSnapshot(ref, snap => {
      setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [sessionId, user])

  // ── Suscripción ANSWERS ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !user || user.isAnonymous) return
    const ref = collection(db, 'EXAM_SESSIONS', sessionId, 'ANSWERS')
    const unsub = onSnapshot(ref, snap => {
      setAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [sessionId, user])

  // ── Acción: abrir pregunta i ─────────────────────────────────────────────────
  const abrirPregunta = async (i) => {
    const p = quiz.preguntas[i]
    await updateDoc(doc(db, 'EXAM_SESSIONS', sessionId), {
      estado: 'pregunta_abierta',
      preguntaActual: i,
      // sanitizeQuestion elimina el campo `correcta` de las opciones
      preguntaVisible: sanitizeQuestion(p),
      respuestaCorrectaPublicada: false,
      opcionCorrectaPublicada: null,
      abiertaEn: serverTimestamp(),
      cerradaEn: null,
    })
  }

  // ── Acción: cerrar pregunta ──────────────────────────────────────────────────
  const cerrarPregunta = async () => {
    await updateDoc(doc(db, 'EXAM_SESSIONS', sessionId), {
      estado: 'pregunta_cerrada',
      cerradaEn: serverTimestamp(),
    })
  }

  // ── Acción: publicar corrección ──────────────────────────────────────────────
  const publicarCorreccion = async () => {
    if (correcting) return
    setCorrecting(true)
    try {
      const i = session.preguntaActual
      const p = quiz.preguntas[i]

      // Respuestas de esta pregunta
      const pregAnswers = answers.filter(a => a.preguntaIndex === i)

      const batch = writeBatch(db)
      for (const ans of pregAnswers) {
        // Id del doc: `${ticketSecret}_${preguntaIndex}`
        const { correcta, puntos } = gradeAnswer(p, ans.respuesta)
        const ansRef = doc(db, 'EXAM_SESSIONS', sessionId, 'ANSWERS', `${ans.ticketSecret}_${i}`)
        batch.update(ansRef, { correcta, puntos })
      }
      await batch.commit()

      await updateDoc(doc(db, 'EXAM_SESSIONS', sessionId), {
        respuestaCorrectaPublicada: true,
        opcionCorrectaPublicada: correctOptionId(p),
      })
    } catch (e) {
      console.error('Error publicando corrección:', e)
      setError('Error al publicar corrección: ' + e.message)
    } finally {
      setCorrecting(false)
    }
  }

  // ── Acción: siguiente pregunta o finalizar ───────────────────────────────────
  const siguientePregunta = async () => {
    const next = session.preguntaActual + 1
    if (next < session.totalPreguntas) {
      await abrirPregunta(next)
    } else {
      await updateDoc(doc(db, 'EXAM_SESSIONS', sessionId), { estado: 'finalizada' })
    }
  }

  // ── Acción: exportar CSV ─────────────────────────────────────────────────────
  const exportarResultados = () => {
    // Mapeamos tickets al formato que espera buildResultsCsv
    const ticketsData = tickets.map(t => ({
      displayCode:   t.displayCode,
      nombre:        t.nombre || '',
      entradaEn:     t.entradaEn,
      ultimaEntrada: t.ultimaEntrada,
      reingresos:    t.reingresos || 0,
      uidHistory:    t.uidHistory || [],
      ticketSecret:  t.id,  // id del doc = ticketSecret
    }))
    // answers ya tienen ticketSecret, correcta, puntos
    const answersData = answers.map(a => ({
      ticketSecret: a.ticketSecret,
      correcta:     a.correcta,
      puntos:       a.puntos || 0,
    }))
    downloadCsv('resultados-' + sessionId + '.csv', buildResultsCsv(ticketsData, answersData))
  }

  // ── Renders auxiliares ───────────────────────────────────────────────────────

  // Topbar con usuario
  const Topbar = () => (
    <header className="exam-topbar">
      <a href="/" className="admin-brand" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="admin-logo"></div>
        <span style={{ fontWeight: 700 }}>Falken's Maze</span>
      </a>
      <span className="admin-badge" style={{ background: '#2980b9' }}>Examen</span>
      <h1 style={{ flex: 1 }}>{session?.titulo || sessionId}</h1>
      {user && (
        <div className="user-chip">
          {user.photoURL && <img src={user.photoURL} alt="" />}
          <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.displayName || user.email}
          </span>
          <button onClick={handleLogout} className="btn-sm">Salir</button>
        </div>
      )}
    </header>
  )

  // Panel de asistencia (siempre visible)
  const PanelAsistencia = () => {
    const presentes = tickets.filter(t => t.estado === 'presente').length
    return (
      <div className="exam-card">
        <h2>Asistencia — {presentes}/{tickets.length} presentes</h2>
        {tickets.length === 0
          ? <p className="exam-empty">Sin tickets registrados.</p>
          : (
            <div className="exam-attendance-grid">
              {tickets.map(t => {
                const isPresent  = t.estado === 'presente'
                const isConflict = (t.reingresos || 0) > 0
                let cls = 'exam-attendance-item'
                if (isConflict) cls += ' conflict'
                else if (isPresent) cls += ' present'
                return (
                  <span key={t.id} className={cls} title={isConflict ? `${t.reingresos} reingreso(s)` : ''}>
                    {t.displayCode}
                    {t.nombre ? ` · ${t.nombre}` : ''}
                    {isConflict && (
                      <span style={{
                        background: 'var(--accent-orange)', color: '#000',
                        borderRadius: '50%', fontSize: '0.7rem', fontWeight: 700,
                        padding: '0 5px', minWidth: 16, textAlign: 'center'
                      }}>
                        {t.reingresos}
                      </span>
                    )}
                  </span>
                )
              })}
            </div>
          )
        }
      </div>
    )
  }

  // ── Guards ───────────────────────────────────────────────────────────────────
  if (authLoading) {
    return <div style={{ padding: 48, textAlign: 'center' }}>Cargando...</div>
  }

  // Gate de autenticación Google
  if (!user || user.isAnonymous) {
    return (
      <>
        <header className="exam-topbar">
          <div className="admin-logo"></div>
          <span style={{ fontWeight: 700 }}>Falken's Maze</span>
          <span className="admin-badge" style={{ background: '#2980b9' }}>Examen</span>
        </header>
        <div className="centered-view">
          <div className="auth-card">
            <div className="auth-card-icon">📋</div>
            <h1>Panel del Examinador</h1>
            <p>Inicia sesión con Google para acceder al panel de examen.</p>
            <button onClick={handleLogin} className="btn-google">
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
                <path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16 19.3 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2c-7.6 0-14.2 4.3-17.7 10.7z"/>
                <path fill="#FBBC05" d="M24 46c5.9 0 10.9-2 14.5-5.4l-6.7-5.5C29.8 36.7 27 38 24 38c-6 0-11.1-4-12.9-9.5l-7 5.4C7.7 41.6 15.3 46 24 46z"/>
                <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.8 2.7-2.6 5-5 6.6l6.7 5.5C41.7 37.1 45 31 45 24c0-1.3-.2-2.7-.5-4z"/>
              </svg>
              Continuar con Google
            </button>
          </div>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--accent-red)' }}>
        {error}
      </div>
    )
  }

  if (!session || !quiz) {
    return <div style={{ padding: 48, textAlign: 'center' }}>Cargando sesión...</div>
  }

  // Verificar que el usuario sea el host
  if (session.host !== user.uid) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--accent-red)' }}>
        No autorizado: no eres el host de esta sesión.
      </div>
    )
  }

  // ── Render principal ─────────────────────────────────────────────────────────
  const { estado, preguntaActual, respuestaCorrectaPublicada, totalPreguntas } = session
  const i = preguntaActual ?? 0
  const preguntaCompleta = quiz.preguntas?.[i]   // con campo `correcta` (solo host la ve)

  // Respuestas de la pregunta actual
  const answersActual = answers.filter(a => a.preguntaIndex === i)
  const presentes = tickets.filter(t => t.estado === 'presente').length
  // Aciertos publicados (tras corrección)
  const aciertos = answersActual.filter(a => a.correcta === true).length

  return (
    <>
      <Topbar />
      <div className="exam-container">

        {/* ── PANEL ASISTENCIA (siempre visible) ─────────────────── */}
        <PanelAsistencia />

        {/* ── CONTROLES SEGÚN ESTADO ──────────────────────────────── */}

        {/* LOBBY: aún no ha comenzado */}
        {estado === 'lobby' && (
          <div className="exam-card">
            <h2>Sesión en espera</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
              Esperando que los alumnos se conecten con sus tickets QR.
              Cuando estés listo, abre la primera pregunta.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                className="exam-btn"
                onClick={() => abrirPregunta(0)}
                disabled={tickets.length === 0}
              >
                Abrir pregunta 1
              </button>
              <button
                className="exam-btn exam-btn-secondary"
                onClick={() => navigate(`/exam-admin/${sessionId}/print`)}
              >
                Imprimir QR
              </button>
            </div>
          </div>
        )}

        {/* PREGUNTA ABIERTA */}
        {estado === 'pregunta_abierta' && preguntaCompleta && (
          <div className="host-container">
            <div className="host-question">
              <div className="host-header">
                <span>Pregunta {i + 1} / {totalPreguntas}</span>
                <span>{answersActual.length} / {presentes} respondieron</span>
              </div>

              <h2 className="host-question-text">{preguntaCompleta.pregunta}</h2>

              {/* Opciones: el host ve cuál es la correcta */}
              <div className="host-options">
                {preguntaCompleta.opciones.map(op => (
                  <div
                    key={op.id}
                    className="host-option"
                    style={op.correcta ? { borderColor: 'var(--accent-green)', background: 'color-mix(in srgb,var(--accent-green) 15%,var(--bg-secondary))' } : {}}
                  >
                    <span className="host-option-letter">{op.id.toUpperCase()}</span>
                    <span className="host-option-text">{op.texto}</span>
                    {op.correcta && (
                      <span style={{ marginLeft: 'auto', color: 'var(--accent-green)', fontSize: '0.8rem', fontWeight: 700 }}>
                        Correcta
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <button className="btn-play" onClick={cerrarPregunta}>
                Cerrar pregunta
              </button>
            </div>
          </div>
        )}

        {/* PREGUNTA CERRADA */}
        {estado === 'pregunta_cerrada' && preguntaCompleta && (
          <div className="host-container">
            <div className="host-question">
              <div className="host-header">
                <span>Pregunta {i + 1} / {totalPreguntas} — CERRADA</span>
                <span>{answersActual.length} respuestas recibidas</span>
              </div>

              <h2 className="host-question-text">{preguntaCompleta.pregunta}</h2>

              {!respuestaCorrectaPublicada ? (
                <>
                  <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
                    La pregunta está cerrada. Publica la corrección para que los alumnos
                    vean cuál era la respuesta correcta y actualizar los puntos.
                  </p>
                  <div className="host-options" style={{ marginBottom: 20 }}>
                    {preguntaCompleta.opciones.map(op => (
                      <div
                        key={op.id}
                        className="host-option"
                        style={op.correcta ? { borderColor: 'var(--accent-green)', background: 'color-mix(in srgb,var(--accent-green) 15%,var(--bg-secondary))' } : {}}
                      >
                        <span className="host-option-letter">{op.id.toUpperCase()}</span>
                        <span className="host-option-text">{op.texto}</span>
                        {op.correcta && (
                          <span style={{ marginLeft: 'auto', color: 'var(--accent-green)', fontSize: '0.8rem', fontWeight: 700 }}>
                            Correcta
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn-play"
                    onClick={publicarCorreccion}
                    disabled={correcting}
                  >
                    {correcting ? 'Corrigiendo...' : 'Publicar corrección'}
                  </button>
                </>
              ) : (
                <>
                  {/* Resumen de la pregunta tras corrección */}
                  <div className="exam-card" style={{ margin: '16px 0' }}>
                    <h2>Resumen</h2>
                    <p>
                      Respuesta correcta:{' '}
                      <strong style={{ color: 'var(--accent-green)' }}>
                        {session.opcionCorrectaPublicada?.toUpperCase()} —{' '}
                        {preguntaCompleta.opciones.find(o => o.id === session.opcionCorrectaPublicada)?.texto}
                      </strong>
                    </p>
                    <p style={{ marginTop: 8 }}>
                      Aciertos: <strong>{aciertos}</strong> / {answersActual.length} respuestas
                      {presentes > 0 && ` (${presentes} presentes)`}
                    </p>
                  </div>

                  {i < totalPreguntas - 1 ? (
                    <button className="btn-play" onClick={siguientePregunta}>
                      Siguiente pregunta
                    </button>
                  ) : (
                    <button className="btn-play" onClick={siguientePregunta}>
                      Finalizar examen
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* FINALIZADA */}
        {estado === 'finalizada' && (
          <div className="exam-card" style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.4rem', marginBottom: 12 }}>Examen finalizado</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
              Puedes descargar los resultados en CSV para su análisis.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="exam-btn" onClick={exportarResultados}>
                Descargar resultados CSV
              </button>
              <button
                className="exam-btn exam-btn-secondary"
                onClick={() => navigate('/')}
              >
                Volver al inicio
              </button>
            </div>
          </div>
        )}

      </div>
    </>
  )
}

export default ExamHost
