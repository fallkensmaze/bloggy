import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { db, auth } from '../firebase'
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  serverTimestamp, increment, arrayUnion
} from 'firebase/firestore'
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import '../styles/quiz.css'
import '../styles/exam.css'

// Página del alumno accesible por QR. Nunca lee la colección QUIZZES.
// Los IDs de ANSWERS usan el patrón `${ticketSecret}_${preguntaIndex}`.
function ExamJoin() {
  const { sessionId, ticketSecret } = useParams()

  // Estado de autenticación
  const [uid, setUid] = useState(null)

  // Datos del ticket
  const [displayCode, setDisplayCode] = useState(null)
  const [ticketError, setTicketError] = useState(null)
  const [claimed, setClaimed] = useState(false)

  // Datos de la sesión en tiempo real
  const [session, setSession] = useState(undefined) // undefined = cargando

  // Control de respuestas por índice de pregunta
  // { [preguntaIndex]: { respondido: bool, opcionElegida: string } }
  const [respuestasLocales, setRespuestasLocales] = useState({})

  // Resumen final
  const [resumenFinal, setResumenFinal] = useState(null)

  const pingInterval = useRef(null)
  const unsubSession = useRef(null)

  // ── 1. signInAnonymously al montar ──────────────────────────────
  useEffect(() => {
    signInAnonymously(auth).catch(console.error)

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) setUid(user.uid)
    })

    return () => {
      unsubAuth()
      if (unsubSession.current) unsubSession.current()
      if (pingInterval.current) clearInterval(pingInterval.current)
    }
  }, [])

  // ── 2. Claim del ticket cuando hay UID ──────────────────────────
  useEffect(() => {
    if (!uid || claimed) return
    claimTicket(uid)
  }, [uid])

  const claimTicket = async (currentUid) => {
    try {
      const ticketRef = doc(db, 'EXAM_SESSIONS', sessionId, 'TICKETS', ticketSecret)
      const ticketSnap = await getDoc(ticketRef)

      if (!ticketSnap.exists()) {
        setTicketError('Ticket no válido. Verifica el enlace QR.')
        return
      }

      const ticket = ticketSnap.data()

      if (ticket.bloqueado === true) {
        setTicketError('Ticket bloqueado. Contacta con el examinador.')
        return
      }

      setDisplayCode(ticket.displayCode || ticketSecret)

      const { uidActual } = ticket

      if (!uidActual) {
        // Primer claim
        await updateDoc(ticketRef, {
          uidActual: currentUid,
          claimed: true,
          estado: 'presente',
          entradaEn: serverTimestamp(),
          ultimaEntrada: serverTimestamp(),
          ultimoPing: serverTimestamp(),
          uidHistory: arrayUnion(currentUid)
        })
      } else if (uidActual === currentUid) {
        // Reanudación en el mismo dispositivo
        await updateDoc(ticketRef, {
          estado: 'presente',
          ultimaEntrada: serverTimestamp(),
          ultimoPing: serverTimestamp()
        })
      } else {
        // Reentrada automática desde otro dispositivo
        await updateDoc(ticketRef, {
          uidActual: currentUid,
          reingresos: increment(1),
          estado: 'presente',
          ultimaEntrada: serverTimestamp(),
          ultimoPing: serverTimestamp(),
          uidHistory: arrayUnion(currentUid)
        })
      }

      setClaimed(true)
      iniciarSesion()
      iniciarPing()
    } catch (err) {
      console.error('Error al reclamar ticket:', err)
      setTicketError('Error al conectar con el examen. Intenta recargar.')
    }
  }

  // ── 3. onSnapshot de la sesión ───────────────────────────────────
  const iniciarSesion = () => {
    const sessionRef = doc(db, 'EXAM_SESSIONS', sessionId)
    unsubSession.current = onSnapshot(sessionRef, (snap) => {
      if (!snap.exists()) {
        setSession(null) // sesión eliminada
      } else {
        setSession(snap.data())
      }
    })
  }

  // ── 4. Ping periódico cada 20s ───────────────────────────────────
  const iniciarPing = () => {
    pingInterval.current = setInterval(async () => {
      try {
        const ticketRef = doc(db, 'EXAM_SESSIONS', sessionId, 'TICKETS', ticketSecret)
        await updateDoc(ticketRef, { ultimoPing: serverTimestamp() })
      } catch (err) {
        console.error('Error en ping:', err)
      }
    }, 20000)
  }

  // ── 5. Verificar si ya respondió al cambiar de pregunta ──────────
  useEffect(() => {
    if (!session || session.estado !== 'pregunta_abierta') return
    const idx = session.preguntaActual
    if (respuestasLocales[idx] !== undefined) return // ya sabemos

    comprobarRespuestaPrevia(idx)
  }, [session?.preguntaActual, session?.estado])

  const comprobarRespuestaPrevia = async (idx) => {
    try {
      const answerId = `${ticketSecret}_${idx}`
      const answerRef = doc(db, 'EXAM_SESSIONS', sessionId, 'ANSWERS', answerId)
      const answerSnap = await getDoc(answerRef)

      if (answerSnap.exists()) {
        const data = answerSnap.data()
        setRespuestasLocales(prev => ({
          ...prev,
          [idx]: { respondido: true, opcionElegida: data.respuesta }
        }))
      } else {
        setRespuestasLocales(prev => ({
          ...prev,
          [idx]: { respondido: false, opcionElegida: null }
        }))
      }
    } catch (err) {
      console.error('Error verificando respuesta previa:', err)
    }
  }

  // ── Enviar respuesta ─────────────────────────────────────────────
  const enviarRespuesta = async (opcion) => {
    if (!session || !uid) return
    const idx = session.preguntaActual
    const local = respuestasLocales[idx]
    if (local && local.respondido) return // ya respondió

    // Optimistic UI: marcamos antes de esperar Firestore
    setRespuestasLocales(prev => ({
      ...prev,
      [idx]: { respondido: true, opcionElegida: opcion.id }
    }))

    try {
      const answerId = `${ticketSecret}_${idx}`
      const answerRef = doc(db, 'EXAM_SESSIONS', sessionId, 'ANSWERS', answerId)
      // setDoc con id determinista impide doble respuesta
      await setDoc(answerRef, {
        ticketSecret,
        displayCode,
        uid,
        preguntaIndex: idx,
        preguntaId: session.preguntaVisible.id,
        respuesta: opcion.id,
        respondidaEn: serverTimestamp(),
        correcta: null,
        puntos: 0
      })
    } catch (err) {
      console.error('Error enviando respuesta:', err)
      // Revertimos si falla
      setRespuestasLocales(prev => ({
        ...prev,
        [idx]: { respondido: false, opcionElegida: null }
      }))
    }
  }

  // ── Cargar resumen final ─────────────────────────────────────────
  useEffect(() => {
    if (session?.estado === 'finalizada' && !resumenFinal) {
      cargarResumen()
    }
  }, [session?.estado])

  const cargarResumen = async () => {
    try {
      // Leemos SOLO las respuestas propias por id determinista
      // (`${ticketSecret}_${i}`); no listamos la subcolección porque las
      // reglas reservan el `list` de ANSWERS al examinador.
      const total = session?.totalPreguntas || 0
      const refs = []
      for (let i = 0; i < total; i++) {
        refs.push(getDoc(doc(db, 'EXAM_SESSIONS', sessionId, 'ANSWERS', `${ticketSecret}_${i}`)))
      }
      const snaps = await Promise.all(refs)
      const propias = snaps.filter(s => s.exists()).map(s => s.data())

      const respondidas = propias.length
      const correctas = propias.filter(a => a.correcta === true).length
      const puntos = propias.reduce((acc, a) => acc + (a.puntos || 0), 0)

      setResumenFinal({ respondidas, correctas, puntos })
    } catch (err) {
      console.error('Error cargando resumen:', err)
      setResumenFinal({ respondidas: 0, correctas: 0, puntos: 0 })
    }
  }

  // ── Pequeño spinner reutilizable ─────────────────────────────────
  const Spinner = () => <div className="spinner" style={{ margin: '0 auto' }} />

  // ── Bloque de error de ticket ────────────────────────────────────
  if (ticketError) {
    return (
      <div className="quiz-play-container">
        <div className="quiz-start-screen">
          <div className="quiz-start-icon">⛔</div>
          <h1>Acceso denegado</h1>
          <p style={{ color: 'var(--accent-red)' }}>{ticketError}</p>
        </div>
      </div>
    )
  }

  // ── Cargando / conectando ────────────────────────────────────────
  if (!claimed || session === undefined) {
    return (
      <div className="quiz-play-container">
        <div className="quiz-start-screen">
          <Spinner />
          <p style={{ marginTop: 16 }}>Conectando...</p>
          {displayCode && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Tu código: <strong>{displayCode}</strong>
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Sesión no existe o fue eliminada ─────────────────────────────
  if (session === null) {
    return (
      <div className="quiz-play-container">
        <div className="quiz-start-screen">
          <div className="quiz-start-icon">📭</div>
          <h1>Examen no disponible</h1>
          <p>El examen ha finalizado o no existe.</p>
          {displayCode && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Tu código: <strong>{displayCode}</strong>
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── LOBBY ────────────────────────────────────────────────────────
  if (session.estado === 'lobby') {
    return (
      <div className="quiz-play-container">
        <div className="quiz-start-screen">
          <div className="quiz-start-icon">⏳</div>
          <h1>El examen comenzará pronto</h1>
          <p>Espera a que el examinador inicie la sesión.</p>
          {displayCode && (
            <div className="player-name-display" style={{ marginTop: 16 }}>
              Tu código: {displayCode}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── PREGUNTA ABIERTA ─────────────────────────────────────────────
  if (session.estado === 'pregunta_abierta' && session.preguntaVisible) {
    const idx = session.preguntaActual
    const local = respuestasLocales[idx]
    const yaRespondio = local?.respondido === true

    return (
      <div className="quiz-play-container">
        <div className="player-question-container">
          <div className="player-header">
            <span>{displayCode}</span>
            <span>Pregunta {idx + 1}</span>
          </div>

          <h2 className="player-question-text">{session.preguntaVisible.pregunta}</h2>

          {yaRespondio ? (
            <div className="player-waiting">
              <p style={{ fontSize: '1.2rem', marginBottom: 12 }}>Respuesta registrada</p>
              <Spinner />
              <p>Esperando al examinador...</p>
            </div>
          ) : (
            <div className="player-options">
              {session.preguntaVisible.opciones.map((opcion) => (
                <button
                  key={opcion.id}
                  className="player-option"
                  onClick={() => enviarRespuesta(opcion)}
                  disabled={yaRespondio}
                >
                  <span className="player-option-letter">{opcion.id.toUpperCase()}</span>
                  <span className="player-option-text">{opcion.texto}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── PREGUNTA CERRADA ─────────────────────────────────────────────
  if (session.estado === 'pregunta_cerrada') {
    const idx = session.preguntaActual
    const local = respuestasLocales[idx]

    // Aún no sabemos si respondió (puede que el fetch aún no terminó)
    if (!local) {
      return (
        <div className="quiz-play-container">
          <div className="quiz-start-screen">
            <Spinner />
            <p style={{ marginTop: 16 }}>Pregunta cerrada. Esperando corrección...</p>
            {displayCode && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Tu código: <strong>{displayCode}</strong>
              </p>
            )}
          </div>
        </div>
      )
    }

    // Corrección aún no publicada
    if (!session.respuestaCorrectaPublicada) {
      return (
        <div className="quiz-play-container">
          <div className="quiz-start-screen">
            <div className="quiz-start-icon">🔒</div>
            <h1>Pregunta cerrada</h1>
            <p>Esperando corrección del examinador...</p>
            {displayCode && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Tu código: <strong>{displayCode}</strong>
              </p>
            )}
          </div>
        </div>
      )
    }

    // Corrección publicada
    const opcionCorrecta = session.opcionCorrectaPublicada
    let resultadoTexto, resultadoColor

    if (!local.respondido) {
      resultadoTexto = 'No respondiste esta pregunta.'
      resultadoColor = 'var(--text-muted)'
    } else if (local.opcionElegida === opcionCorrecta) {
      resultadoTexto = 'Correcto'
      resultadoColor = 'var(--accent-green)'
    } else {
      resultadoTexto = 'Incorrecto'
      resultadoColor = 'var(--accent-red)'
    }

    return (
      <div className="quiz-play-container">
        <div className="quiz-start-screen">
          <div className="quiz-start-icon" style={{ fontSize: '2.5rem' }}>
            {!local.respondido ? '—' : local.opcionElegida === opcionCorrecta ? '✅' : '❌'}
          </div>
          <h1 style={{ color: resultadoColor }}>{resultadoTexto}</h1>
          {local.respondido && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Tu respuesta: <strong>{local.opcionElegida?.toUpperCase()}</strong>
              {' · '}
              Correcta: <strong>{opcionCorrecta?.toUpperCase()}</strong>
            </p>
          )}
          {displayCode && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
              Tu código: <strong>{displayCode}</strong>
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── FINALIZADA ───────────────────────────────────────────────────
  if (session.estado === 'finalizada') {
    if (!resumenFinal) {
      return (
        <div className="quiz-play-container">
          <div className="quiz-start-screen">
            <Spinner />
            <p style={{ marginTop: 16 }}>Cargando resultados...</p>
          </div>
        </div>
      )
    }

    return (
      <div className="quiz-play-container">
        <div className="quiz-results-screen">
          <div className="results-trophy">📋</div>
          <h1>Examen finalizado</h1>
          {displayCode && (
            <div className="results-player-name">{displayCode}</div>
          )}

          <div className="results-stats">
            <div className="result-stat">
              <div className="result-stat-value">{resumenFinal.respondidas}</div>
              <div className="result-stat-label">Respondidas</div>
            </div>
            <div className="result-stat">
              <div className="result-stat-value">{resumenFinal.correctas}</div>
              <div className="result-stat-label">Correctas</div>
            </div>
            <div className="result-stat">
              <div className="result-stat-value">{resumenFinal.puntos}</div>
              <div className="result-stat-label">Puntos</div>
            </div>
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
            Puedes cerrar esta ventana.
          </p>
        </div>
      </div>
    )
  }

  // Estado inesperado de sesión — esperar
  return (
    <div className="quiz-play-container">
      <div className="quiz-start-screen">
        <Spinner />
        <p style={{ marginTop: 16 }}>Conectando con el examen...</p>
        {displayCode && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Tu código: <strong>{displayCode}</strong>
          </p>
        )}
      </div>
    </div>
  )
}

export default ExamJoin
