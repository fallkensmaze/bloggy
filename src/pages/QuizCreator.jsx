import { useState, useEffect } from 'react'
import { auth, db } from '../firebase'
import { signOut, onAuthStateChanged } from 'firebase/auth'
import { collection, doc, setDoc, getDocs, deleteDoc, serverTimestamp, query, where } from 'firebase/firestore'
import { loginWithGoogle, consumeGoogleRedirect } from '../utils/authGoogle'
import '../styles/quiz.css'

function slugify(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

function QuizCreator() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // 'list' | 'create' | 'edit'
  
  // Quiz list
  const [quizzes, setQuizzes] = useState([])
  
  // Form fields
  const [titulo, setTitulo] = useState('')
  const [slug, setSlug] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [topic, setTopic] = useState('')
  // Privado por defecto: un quiz público es de lectura abierta para todo el mundo,
  // documento entero y con el flag `correcta` de cada opción. Publicarlo tiene que ser
  // una decisión explícita, no lo que pasa si no tocas el desplegable.
  const [publico, setPublico] = useState(false)
  const [preguntas, setPreguntas] = useState([])
  const [slugEdited, setSlugEdited] = useState(false)
  
  // Status
  const [status, setStatus] = useState({ show: false, msg: '', type: 'info' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    consumeGoogleRedirect()
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)
      if (user) loadQuizzes(user.uid)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!slugEdited && titulo) {
      setSlug(slugify(titulo))
    }
  }, [titulo, slugEdited])

  const loadQuizzes = async (uid = user?.uid) => {
    if (!uid) return
    try {
      const q = query(collection(db, 'QUIZZES'), where('autor', '==', uid))
      const snapshot = await getDocs(q)
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      setQuizzes(data)
    } catch (err) {
      console.error('Error loading quizzes:', err)
    }
  }

  const handleLogin = async () => {
    try {
      await loginWithGoogle()
    } catch (err) {
      console.error('Login error:', err)
    }
  }

  const handleLogout = () => {
    signOut(auth)
  }

  const showStatus = (msg, type) => {
    setStatus({ show: true, msg, type })
    if (type === 'ok') {
      setTimeout(() => setStatus({ show: false, msg: '', type: 'info' }), 3000)
    }
  }

  const addPregunta = () => {
    const newPregunta = {
      id: `q${Date.now()}`,
      pregunta: '',
      tipo: 'multiple',
      opciones: [
        { id: 'a', texto: '', correcta: false },
        { id: 'b', texto: '', correcta: false },
        { id: 'c', texto: '', correcta: false },
        { id: 'd', texto: '', correcta: false }
      ],
      tiempo: 20,
      puntos: 100,
      imagen: ''
    }
    setPreguntas([...preguntas, newPregunta])
  }

  const updatePregunta = (index, field, value) => {
    const updated = [...preguntas]
    updated[index][field] = value
    setPreguntas(updated)
  }

  const updateOpcion = (preguntaIndex, opcionIndex, field, value) => {
    const updated = [...preguntas]
    if (field === 'correcta' && value) {
      // Solo una respuesta correcta
      updated[preguntaIndex].opciones.forEach((op, i) => {
        op.correcta = i === opcionIndex
      })
    } else {
      updated[preguntaIndex].opciones[opcionIndex][field] = value
    }
    setPreguntas(updated)
  }

  const deletePregunta = (index) => {
    setPreguntas(preguntas.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    if (!titulo.trim()) {
      showStatus('El título es obligatorio', 'err')
      return
    }
    if (!slug.trim()) {
      showStatus('El slug es obligatorio', 'err')
      return
    }
    if (preguntas.length === 0) {
      showStatus('Añade al menos una pregunta', 'err')
      return
    }

    // Validar preguntas
    for (let i = 0; i < preguntas.length; i++) {
      const p = preguntas[i]
      if (!p.pregunta.trim()) {
        showStatus(`La pregunta ${i + 1} está vacía`, 'err')
        return
      }
      if (p.tipo === 'multiple') {
        const hasCorrect = p.opciones.some(op => op.correcta)
        if (!hasCorrect) {
          showStatus(`La pregunta ${i + 1} no tiene respuesta correcta`, 'err')
          return
        }
        const allFilled = p.opciones.every(op => op.texto.trim())
        if (!allFilled) {
          showStatus(`Completa todas las opciones de la pregunta ${i + 1}`, 'err')
          return
        }
      }
    }

    setSaving(true)
    showStatus('Guardando...', 'info')

    try {
      await setDoc(doc(db, 'QUIZZES', slug), {
        titulo,
        descripcion: descripcion.trim(),
        topic: topic.trim() || 'General',
        autor: user.uid,
        publico,
        preguntas,
        fechaCreacion: serverTimestamp()
      })

      showStatus('✓ Quiz guardado correctamente', 'ok')
      await loadQuizzes()
      setView('list')
      resetForm()
    } catch (err) {
      console.error('Save error:', err)
      showStatus('Error: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (quizId) => {
    if (!confirm('¿Eliminar este quiz?')) return
    
    try {
      await deleteDoc(doc(db, 'QUIZZES', quizId))
      showStatus('Quiz eliminado', 'ok')
      await loadQuizzes()
    } catch (err) {
      console.error('Delete error:', err)
      showStatus('Error al eliminar', 'err')
    }
  }

  const resetForm = () => {
    setTitulo('')
    setSlug('')
    setDescripcion('')
    setTopic('')
    setPublico(false)
    setPreguntas([])
    setSlugEdited(false)
  }

  const startNew = () => {
    resetForm()
    setView('create')
  }

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center' }}>Cargando...</div>
  }

  if (!user || user.isAnonymous) {
    return (
      <>
        <QuizTopbar user={null} />
        <div className="centered-view">
          <div className="auth-card">
            <div className="auth-card-icon">🎯</div>
            <h1>Quiz Creator</h1>
            <p>Inicia sesión con tu cuenta de Google para crear quizzes.</p>
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

  return (
    <>
      <QuizTopbar user={user} onLogout={handleLogout} />
      <div className="quiz-body">
        {view === 'list' && (
          <QuizList 
            quizzes={quizzes} 
            onNew={startNew}
            onDelete={handleDelete}
          />
        )}
        
        {view === 'create' && (
          <QuizForm
            titulo={titulo}
            setTitulo={setTitulo}
            slug={slug}
            setSlug={setSlug}
            setSlugEdited={setSlugEdited}
            descripcion={descripcion}
            setDescripcion={setDescripcion}
            topic={topic}
            setTopic={setTopic}
            publico={publico}
            setPublico={setPublico}
            preguntas={preguntas}
            addPregunta={addPregunta}
            updatePregunta={updatePregunta}
            updateOpcion={updateOpcion}
            deletePregunta={deletePregunta}
            onSave={handleSave}
            onCancel={() => setView('list')}
            saving={saving}
            status={status}
          />
        )}
      </div>
    </>
  )
}

function QuizTopbar({ user, onLogout }) {
  return (
    <header className="admin-topbar">
      <a href="/" className="admin-brand">
        <div className="admin-logo"></div>
        Falken's Maze
      </a>
      <span className="admin-badge" style={{ background: '#e74c3c' }}>Quiz</span>
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

function QuizList({ quizzes, onNew, onDelete }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Mis Quizzes</h1>
        <button onClick={onNew} className="btn-publish">
          <i className="bi bi-plus-lg"></i> Nuevo Quiz
        </button>
      </div>

      {quizzes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎯</div>
          <p>No hay quizzes todavía. ¡Crea el primero!</p>
        </div>
      ) : (
        <div className="quiz-grid">
          {quizzes.map(quiz => (
            <div key={quiz.id} className="quiz-card">
              <div className="quiz-card-header">
                <h3>{quiz.titulo}</h3>
                <span className="quiz-topic">{quiz.topic}</span>
              </div>
              <p className="quiz-desc">{quiz.descripcion || 'Sin descripción'}</p>
              <div className="quiz-meta">
                <span><i className="bi bi-question-circle"></i> {quiz.preguntas?.length || 0} preguntas</span>
                <span>{quiz.publico ? '🌐 Público' : '🔒 Privado'}</span>
              </div>
              <div className="quiz-actions">
                <button className="btn-sm" style={{ background: '#e74c3c' }} onClick={() => onDelete(quiz.id)}>
                  <i className="bi bi-trash"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function QuizForm({ 
  titulo, setTitulo, slug, setSlug, setSlugEdited,
  descripcion, setDescripcion, topic, setTopic,
  publico, setPublico, preguntas, addPregunta,
  updatePregunta, updateOpcion, deletePregunta,
  onSave, onCancel, saving, status
}) {
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <button onClick={onCancel} className="btn-sm" style={{ marginBottom: '16px' }}>
          <i className="bi bi-arrow-left"></i> Volver
        </button>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Nuevo Quiz</h1>
      </div>

      <div className="meta-grid">
        <div>
          <label className="field-label">Título</label>
          <input
            type="text"
            className="dark-input"
            placeholder="Nombre del quiz..."
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">Slug (ID)</label>
          <input
            type="text"
            className="dark-input"
            placeholder="mi-quiz"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setSlugEdited(!!e.target.value)
            }}
          />
        </div>
        <div>
          <label className="field-label">Topic</label>
          <input
            type="text"
            className="dark-input"
            placeholder="ej. Física"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">Visibilidad</label>
          <select 
            className="dark-input" 
            value={publico ? 'publico' : 'privado'}
            onChange={(e) => setPublico(e.target.value === 'publico')}
          >
            <option value="publico">🌐 Público</option>
            <option value="privado">🔒 Privado</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: '16px' }}>
        <label className="field-label">Descripción</label>
        <textarea
          className="dark-input"
          placeholder="Descripción breve del quiz..."
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows="2"
        />
      </div>

      <div style={{ marginTop: '32px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Preguntas ({preguntas.length})</h2>
        <button onClick={addPregunta} className="btn-sm" style={{ background: '#27ae60' }}>
          <i className="bi bi-plus-lg"></i> Añadir pregunta
        </button>
      </div>

      {preguntas.map((pregunta, index) => (
        <PreguntaEditor
          key={pregunta.id}
          pregunta={pregunta}
          index={index}
          updatePregunta={updatePregunta}
          updateOpcion={updateOpcion}
          onDelete={() => deletePregunta(index)}
        />
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '32px' }}>
        <button onClick={onSave} disabled={saving} className="btn-publish">
          <i className="bi bi-save"></i> Guardar Quiz
        </button>
        {status.show && (
          <div className={`status-msg status-${status.type}`}>
            {status.msg}
          </div>
        )}
      </div>
    </div>
  )
}

function PreguntaEditor({ pregunta, index, updatePregunta, updateOpcion, onDelete }) {
  return (
    <div className="pregunta-card">
      <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'start', gap: '16px', marginBottom: '16px' }}>
        <div style={{ flex: 1 }}>
          <label className="field-label">Pregunta {index + 1}</label>
          <input
            type="text"
            className="dark-input"
            placeholder="Escribe la pregunta..."
            value={pregunta.pregunta}
            onChange={(e) => updatePregunta(index, 'pregunta', e.target.value)}
          />
        </div>
        <button onClick={onDelete} className="btn-sm" style={{ background: '#e74c3c', marginTop: '24px' }}>
          <i className="bi bi-trash"></i>
        </button>
      </div>

      <div className="meta-grid" style={{ marginBottom: '16px' }}>
        <div>
          <label className="field-label">Tiempo (seg)</label>
          <input
            type="number"
            className="dark-input"
            value={pregunta.tiempo}
            onChange={(e) => updatePregunta(index, 'tiempo', parseInt(e.target.value) || 20)}
            min="5"
            max="120"
          />
        </div>
        <div>
          <label className="field-label">Puntos</label>
          <input
            type="number"
            className="dark-input"
            value={pregunta.puntos}
            onChange={(e) => updatePregunta(index, 'puntos', parseInt(e.target.value) || 100)}
            min="10"
            max="1000"
            step="10"
          />
        </div>
      </div>

      <label className="field-label">Opciones (marca la correcta)</label>
      <div className="opciones-grid">
        {pregunta.opciones.map((opcion, opIndex) => (
          <div key={opcion.id} className="opcion-item">
            <input
              type="radio"
              name={`correct-${pregunta.id}`}
              checked={opcion.correcta}
              onChange={() => updateOpcion(index, opIndex, 'correcta', true)}
            />
            <input
              type="text"
              className="dark-input"
              placeholder={`Opción ${opcion.id.toUpperCase()}`}
              value={opcion.texto}
              onChange={(e) => updateOpcion(index, opIndex, 'texto', e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default QuizCreator
