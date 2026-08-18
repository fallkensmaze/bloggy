import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db } from '../firebase'
import {
  signOut, onAuthStateChanged
} from 'firebase/auth'
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, where, serverTimestamp, writeBatch
} from 'firebase/firestore'
import { generateTicketSecret, buildDisplayCode } from '../utils/exam'
import { loginWithGoogle, consumeGoogleRedirect } from '../utils/authGoogle'
import '../styles/quiz.css'
import '../styles/exam.css'

// ── Topbar de administración ─────────────────────────────────────────────────
function ExamTopbar({ user, onLogout }) {
  return (
    <header className="admin-topbar">
      <a href="/" className="admin-brand">
        <div className="admin-logo"></div>
        Falken's Maze
      </a>
      <span className="admin-badge" style={{ background: '#2ecc71' }}>Examen</span>
      {user && (
        <div className="user-chip">
          {user.photoURL && <img src={user.photoURL} alt="" />}
          <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.displayName || user.email}
          </span>
          <button onClick={onLogout} className="btn-sm">Salir</button>
        </div>
      )}
    </header>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────
function ExamAdminList() {
  const navigate = useNavigate()

  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView]       = useState('list') // 'list' | 'create'

  // Lista de sesiones
  const [sesiones, setSesiones] = useState([])

  // Formulario de creación
  const [titulo, setTitulo]         = useState('')
  const [quizId, setQuizId]         = useState('')
  const [numTickets, setNumTickets] = useState(30)
  const [quizzes, setQuizzes]       = useState([])

  // Estado de carga/errores
  const [creando, setCreando]   = useState(false)
  const [error, setError]       = useState('')

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    consumeGoogleRedirect()
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
      if (u && !u.isAnonymous) {
        cargarSesiones(u.uid)
        cargarQuizzes(u.uid)
      }
    })
    return unsub
  }, [])

  const handleLogin = async () => {
    try {
      await loginWithGoogle()
    } catch (err) {
      console.error('Login error:', err)
    }
  }

  const handleLogout = () => signOut(auth)

  // ── Carga de datos ────────────────────────────────────────────────────────
  const cargarSesiones = async (uid) => {
    try {
      const q = query(collection(db, 'EXAM_SESSIONS'), where('host', '==', uid))
      const snap = await getDocs(q)
      setSesiones(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (err) {
      console.error('Error cargando sesiones:', err)
    }
  }

  const cargarQuizzes = async (uid) => {
    try {
      const q = query(collection(db, 'QUIZZES'), where('autor', '==', uid))
      const snap = await getDocs(q)
      setQuizzes(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (err) {
      console.error('Error cargando quizzes:', err)
    }
  }

  // ── Eliminar sesión ───────────────────────────────────────────────────────
  const handleEliminar = async (sessionId) => {
    if (!confirm('¿Eliminar esta sesión de examen?')) return
    try {
      await deleteDoc(doc(db, 'EXAM_SESSIONS', sessionId))
      setSesiones(prev => prev.filter(s => s.id !== sessionId))
    } catch (err) {
      console.error('Error eliminando sesión:', err)
      setError('Error al eliminar: ' + err.message)
    }
  }

  // ── Crear sesión ──────────────────────────────────────────────────────────
  const handleCrear = async () => {
    setError('')

    // Validación
    if (!titulo.trim()) {
      setError('El título es obligatorio.')
      return
    }
    if (!quizId) {
      setError('Selecciona un quiz.')
      return
    }
    const n = parseInt(numTickets, 10)
    if (!n || n < 1 || n > 500) {
      setError('El número de tickets debe estar entre 1 y 500.')
      return
    }

    setCreando(true)
    try {
      // Leer el quiz para obtener el nº de preguntas
      const quizSnap = await getDoc(doc(db, 'QUIZZES', quizId))
      if (!quizSnap.exists()) {
        setError('El quiz seleccionado no existe.')
        setCreando(false)
        return
      }
      const quizData = quizSnap.data()
      const totalPreguntas = quizData.preguntas?.length ?? 0

      // Generar sessionId
      const sessionId = generateTicketSecret().slice(0, 12)

      // Crear doc de sesión
      await setDoc(doc(db, 'EXAM_SESSIONS', sessionId), {
        titulo:                    titulo.trim(),
        quizId,
        host:                      user.uid,
        estado:                    'lobby',
        preguntaActual:            0,
        preguntaVisible:           null,
        respuestaCorrectaPublicada: false,
        opcionCorrectaPublicada:   null,
        totalPreguntas,
        numTickets:                n,
        abiertaEn:                 null,
        cerradaEn:                 null,
        fechaCreacion:             serverTimestamp(),
      })

      // Crear tickets en un solo batch (N ≤ 500)
      const batch = writeBatch(db)
      for (let i = 0; i < n; i++) {
        const ticketSecret = generateTicketSecret()
        const displayCode  = buildDisplayCode(i)
        const ticketRef    = doc(db, 'EXAM_SESSIONS', sessionId, 'TICKETS', ticketSecret)
        batch.set(ticketRef, {
          displayCode,
          uidActual:    '',
          uidHistory:   [],
          claimed:      false,
          entradaEn:    null,
          ultimaEntrada: null,
          ultimoPing:   null,
          reingresos:   0,
          nombre:       '',
          estado:       'pendiente',
          bloqueado:    false,
        })
      }
      await batch.commit()

      // Navegar a la página de impresión
      navigate(`/exam-admin/${sessionId}/print`)
    } catch (err) {
      console.error('Error creando sesión:', err)
      setError('Error al crear la sesión: ' + err.message)
    } finally {
      setCreando(false)
    }
  }

  const resetForm = () => {
    setTitulo('')
    setQuizId('')
    setNumTickets(30)
    setError('')
  }

  const irACrear = () => {
    resetForm()
    setView('create')
  }

  // ── Pantalla de carga ─────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center' }}>Cargando...</div>
  }

  // ── Pantalla de login ─────────────────────────────────────────────────────
  if (!user || user.isAnonymous) {
    return (
      <>
        <ExamTopbar user={null} />
        <div className="centered-view">
          <div className="auth-card">
            <div className="auth-card-icon">📋</div>
            <h1>Examen por QR</h1>
            <p>Inicia sesión con tu cuenta de Google para administrar sesiones de examen.</p>
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

  // ── Vista principal (autenticado) ─────────────────────────────────────────
  return (
    <>
      <ExamTopbar user={user} onLogout={handleLogout} />

      <div className="exam-container">

        {/* ── Vista: LISTA ── */}
        {view === 'list' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Mis Exámenes</h1>
              <button onClick={irACrear} className="btn-publish">
                + Nueva sesión de examen
              </button>
            </div>

            {sesiones.length === 0 ? (
              <div className="exam-empty">
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>📋</div>
                <p>No hay sesiones de examen. Crea la primera.</p>
              </div>
            ) : (
              <div className="quiz-grid">
                {sesiones.map(s => (
                  <div key={s.id} className="quiz-card exam-card">
                    <div className="quiz-card-header">
                      <h3>{s.titulo}</h3>
                      <span className="quiz-topic">{s.estado}</span>
                    </div>
                    <div className="quiz-meta" style={{ marginBottom: '12px' }}>
                      <span>{s.numTickets} tickets</span>
                      <span>{s.totalPreguntas} preguntas</span>
                      {s.fechaCreacion?.toDate && (
                        <span>{s.fechaCreacion.toDate().toLocaleDateString()}</span>
                      )}
                    </div>
                    <div className="quiz-actions">
                      <button
                        className="btn-sm"
                        onClick={() => navigate(`/exam-admin/${s.id}`)}
                      >
                        Panel
                      </button>
                      <button
                        className="btn-sm"
                        style={{ background: '#2980b9' }}
                        onClick={() => navigate(`/exam-admin/${s.id}/print`)}
                      >
                        Imprimir QR
                      </button>
                      <button
                        className="btn-sm"
                        style={{ background: '#e74c3c' }}
                        onClick={() => handleEliminar(s.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Vista: CREAR ── */}
        {view === 'create' && (
          <div>
            <button
              onClick={() => { setView('list'); setError('') }}
              className="btn-sm"
              style={{ marginBottom: '20px' }}
            >
              Volver
            </button>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '24px' }}>
              Nueva sesión de examen
            </h1>

            <div className="meta-grid">
              {/* Título */}
              <div>
                <label className="field-label">Título de la sesión</label>
                <input
                  type="text"
                  className="dark-input"
                  placeholder="Ej. Parcial 1 — Grupo A"
                  value={titulo}
                  onChange={e => setTitulo(e.target.value)}
                />
              </div>

              {/* Quiz */}
              <div>
                <label className="field-label">Quiz asociado</label>
                <select
                  className="dark-input"
                  value={quizId}
                  onChange={e => setQuizId(e.target.value)}
                >
                  <option value="">— Selecciona un quiz —</option>
                  {quizzes.map(q => (
                    <option key={q.id} value={q.id}>{q.titulo}</option>
                  ))}
                </select>
                {quizzes.length === 0 && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    No tienes quizzes. Crea uno primero en <a href="/quiz-creator">/quiz-creator</a>.
                  </p>
                )}
              </div>

              {/* Número de tickets */}
              <div>
                <label className="field-label">Número de tickets</label>
                <input
                  type="number"
                  className="dark-input"
                  value={numTickets}
                  onChange={e => setNumTickets(e.target.value)}
                  min={1}
                  max={500}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="status-msg status-err" style={{ marginTop: '16px' }}>
                {error}
              </div>
            )}

            {/* Acciones */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '28px' }}>
              <button
                onClick={handleCrear}
                disabled={creando}
                className="btn-publish"
              >
                {creando ? 'Creando...' : 'Crear sesión y ver QR'}
              </button>
              <button
                onClick={() => { setView('list'); setError('') }}
                className="btn-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default ExamAdminList
