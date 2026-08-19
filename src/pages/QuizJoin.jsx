import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, auth } from '../firebase'
import { doc, collection, getDoc, setDoc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import { countCorrect } from '../utils/quizScoring'
import '../styles/quiz.css'

// Cada jugador necesita una identidad propia por pestaña. NO podemos usar el uid
// anónimo de Firebase como clave: la auth anónima reutiliza el mismo uid en todo el
// navegador, así que dos jugadores en el mismo navegador colisionarían bajo la misma
// clave y el segundo borraría al primero. Generamos un id aleatorio persistido en
// sessionStorage (sobrevive a recargas de la misma pestaña, distinto en cada pestaña).
function getOrCreatePlayerId(code) {
  const key = `quizPlayer_${code}`
  let id = sessionStorage.getItem(key)
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem(key, id)
  }
  return id
}

function QuizJoin() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState(null)
  const [participants, setParticipants] = useState({})
  const [playerId, setPlayerId] = useState(null)
  const [quiz, setQuiz] = useState(null)
  const [currentAnswer, setCurrentAnswer] = useState(null)
  const [hasAnswered, setHasAnswered] = useState(false)

  useEffect(() => {
    // Autenticar de forma anónima para que las reglas puedan limitar cambios al UID del jugador.
    signInAnonymously(auth).catch((error) => {
      console.error("Error signing in anonymously:", error);
    });
  }, []);

  useEffect(() => {
    if (session && session.estado === 'jugando') {
      setHasAnswered(false)
      setCurrentAnswer(null)
    }
  }, [session?.preguntaActual])

  useEffect(() => {
    if (code && playerId) {
      const unsubSession = onSnapshot(doc(db, 'QUIZ_SESSIONS', code), (docSnap) => {
        if (docSnap.exists()) {
          setSession(docSnap.data())
        } else {
          setError('La sesión ha finalizado')
          setSession(null)
        }
      })
      // La puntuación (puntos) la escribe el host en la subcolección; el jugador la
      // lee desde aquí para mostrar su resultado y posición finales.
      const unsubParticipants = onSnapshot(
        collection(db, 'QUIZ_SESSIONS', code, 'PARTICIPANTES'),
        (snap) => {
          const map = {}
          snap.forEach((d) => { map[d.id] = d.data() })
          setParticipants(map)
        }
      )
      return () => { unsubSession(); unsubParticipants() }
    }
  }, [code, playerId])

  useEffect(() => {
    if (session && session.quizId && !quiz) {
      loadQuiz(session.quizId)
    }
  }, [session])

  const loadQuiz = async (quizId) => {
    try {
      const docSnap = await getDoc(doc(db, 'QUIZZES', quizId))
      if (docSnap.exists()) {
        setQuiz({ id: docSnap.id, ...docSnap.data() })
      }
    } catch (err) {
      console.error('Error loading quiz:', err)
    }
  }

  const joinSession = async () => {
    if (!code.trim() || !playerName.trim()) {
      setError('Introduce el código y tu nombre')
      return
    }

    setLoading(true)
    setError('')

    const trimmedCode = code.trim()

    try {
      const sessionRef = doc(db, 'QUIZ_SESSIONS', trimmedCode)
      const sessionSnap = await getDoc(sessionRef)

      if (!sessionSnap.exists()) {
        setError('Código inválido')
        setLoading(false)
        return
      }

      const sessionData = sessionSnap.data()
      if (sessionData.estado !== 'lobby') {
        setError('La sesión ya ha comenzado')
        setLoading(false)
        return
      }

      if (!auth.currentUser) {
        await signInAnonymously(auth)
      }

      const pid = getOrCreatePlayerId(trimmedCode)
      setPlayerId(pid)

      // El jugador crea su propio documento en la subcolección. Solo declara nombre y
      // respuestas vacías; `puntos` arranca en 0 y a partir de ahí solo lo escribe el
      // host (las reglas impiden que el jugador toque `puntos`). Si el doc ya existe
      // (recarga de la misma pestaña = mismo playerId) se conserva tal cual: no se
      // reescribe, para no pisar los puntos ya calculados por el host.
      //
      // `owner` es el uid anónimo: es lo que ata el documento a quien lo creó. Sin él la
      // regla de actualización no puede distinguir al dueño de cualquier otro jugador, y
      // los participantes son de lectura pública, así que sus ids están a la vista.
      // Ojo: el uid anónimo es por navegador, no por pestaña, así que dos jugadores en el
      // mismo equipo comparten `owner`; separarlos sigue siendo cosa de `playerId`.
      const participantRef = doc(db, 'QUIZ_SESSIONS', trimmedCode, 'PARTICIPANTES', pid)
      const existing = await getDoc(participantRef)
      if (!existing.exists()) {
        await setDoc(participantRef, {
          nombre: playerName.trim().slice(0, 40),
          puntos: 0,
          respuestas: [],
          owner: auth.currentUser.uid,
          fechaUnion: serverTimestamp()
        })
      }

      setCode(trimmedCode)
      setLoading(false)
    } catch (err) {
      console.error('Error joining session:', err)
      setError('Error al unirse a la sesión')
      setLoading(false)
    }
  }

  const submitAnswer = async (opcionId) => {
    if (hasAnswered) return

    setCurrentAnswer(opcionId)
    setHasAnswered(true)

    const pregunta = quiz.preguntas[session.preguntaActual]

    // El jugador solo registra la opción elegida. La corrección y los puntos los
    // calcula el host al cerrar la pregunta; las reglas impiden escribir `puntos` aquí.
    try {
      const participantRef = doc(db, 'QUIZ_SESSIONS', code, 'PARTICIPANTES', playerId)
      const snap = await getDoc(participantRef)
      const playerData = snap.data() || {}

      const updatedAnswers = [...(playerData.respuestas || [])]
      updatedAnswers[session.preguntaActual] = {
        preguntaId: pregunta.id,
        respuesta: opcionId
      }

      await updateDoc(participantRef, { respuestas: updatedAnswers })
    } catch (err) {
      console.error('Error submitting answer:', err)
    }
  }

  if (!session) {
    return (
      <div className="quiz-play-container">
        <div className="quiz-start-screen">
          <div className="quiz-start-icon">🎮</div>
          <h1>Unirse al Quiz</h1>
          <p>Introduce el código de sesión</p>

          <div className="quiz-start-form">
            <input
              type="text"
              className="dark-input"
              placeholder="Código (6 dígitos)"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              autoFocus
            />
            <input
              type="text"
              className="dark-input"
              placeholder="Tu nombre..."
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && joinSession()}
            />
            {error && <div className="error-message">{error}</div>}
            <button onClick={joinSession} disabled={loading} className="btn-play">
              {loading ? 'Conectando...' : 'Unirse'}
            </button>
          </div>

          <button onClick={() => navigate('/quizzes')} className="btn-back">
            <i className="bi bi-arrow-left"></i> Volver
          </button>
        </div>
      </div>
    )
  }

  if (session.estado === 'lobby') {
    return (
      <div className="quiz-play-container">
        <div className="quiz-start-screen">
          <div className="quiz-start-icon">⏳</div>
          <h1>Esperando...</h1>
          <p>El host iniciará el juego pronto</p>
          <div className="player-name-display">{playerName}</div>
        </div>
      </div>
    )
  }

  if (session.estado === 'jugando' && quiz) {
    const pregunta = quiz.preguntas[session.preguntaActual]
    const mostrarResultados = session.mostrarResultados === true

    // La opción que eligió este jugador en la pregunta actual. Se toma del doc del
    // participante (sobrevive a recargas) y, si aún no llegó, del estado local.
    const miRespuesta =
      participants[playerId]?.respuestas?.[session.preguntaActual]?.respuesta ||
      currentAnswer
    const opcionCorrecta = pregunta.opciones.find((op) => op.correcta)
    const acerto = mostrarResultados && !!opcionCorrecta && miRespuesta === opcionCorrecta.id

    return (
      <div className="quiz-play-container">
        <div className="player-question-container">
          <div className="player-header">
            <span>{playerName}</span>
            <span>Pregunta {session.preguntaActual + 1}/{quiz.preguntas.length}</span>
          </div>

          <h2 className="player-question-text">{pregunta.pregunta}</h2>

          <div className="player-options">
            {pregunta.opciones.map((opcion) => {
              let className = 'player-option'
              if (mostrarResultados) {
                // Al revelar resultados: marcar la correcta en verde y, si el jugador
                // falló, su elección en rojo.
                if (opcion.correcta) className += ' player-option-correct'
                else if (opcion.id === miRespuesta) className += ' player-option-wrong'
              } else if (hasAnswered && currentAnswer === opcion.id) {
                className += ' player-option-selected'
              }

              return (
                <button
                  key={opcion.id}
                  className={className}
                  onClick={() => submitAnswer(opcion.id)}
                  disabled={hasAnswered || mostrarResultados}
                >
                  <span className="player-option-letter">{opcion.id.toUpperCase()}</span>
                  <span className="player-option-text">{opcion.texto}</span>
                </button>
              )
            })}
          </div>

          {mostrarResultados ? (
            <div className={`player-feedback ${acerto ? 'player-feedback-correct' : 'player-feedback-wrong'}`}>
              <div className="player-feedback-icon">{acerto ? '✓' : '✗'}</div>
              <p className="player-feedback-text">
                {!miRespuesta
                  ? 'No respondiste a tiempo'
                  : acerto
                    ? '¡Correcto!'
                    : 'Incorrecto'}
              </p>
              {!acerto && opcionCorrecta && (
                <p className="player-feedback-correct-answer">
                  Respuesta correcta: {opcionCorrecta.id.toUpperCase()}. {opcionCorrecta.texto}
                </p>
              )}
            </div>
          ) : hasAnswered ? (
            <div className="player-waiting">
              <div className="spinner"></div>
              <p>Esperando a los demás jugadores...</p>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (session.estado === 'finalizada') {
    const playerData = participants[playerId] || { puntos: 0, respuestas: [] }
    const ranking = Object.entries(participants)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (b.puntos || 0) - (a.puntos || 0))
    const position = ranking.findIndex(p => p.id === playerId) + 1
    const correctas = countCorrect(quiz?.preguntas || [], playerData.respuestas || [])

    return (
      <div className="quiz-play-container">
        <div className="quiz-results-screen">
          <div className="results-trophy">🏆</div>
          <h1>¡Juego Terminado!</h1>
          <div className="results-player-name">{playerName}</div>
          
          <div className="results-stats">
            <div className="result-stat">
              <div className="result-stat-value">#{position}</div>
              <div className="result-stat-label">Posición</div>
            </div>
            <div className="result-stat">
              <div className="result-stat-value">{playerData.puntos}</div>
              <div className="result-stat-label">Puntos</div>
            </div>
            <div className="result-stat">
              <div className="result-stat-value">
                {correctas}/{quiz.preguntas.length}
              </div>
              <div className="result-stat-label">Correctas</div>
            </div>
          </div>

          <button onClick={() => navigate('/quizzes')} className="btn-play">
            <i className="bi bi-grid"></i> Ver más quizzes
          </button>
        </div>
      </div>
    )
  }

  return null
}

export default QuizJoin
