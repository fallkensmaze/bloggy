import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, auth } from '../firebase'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import '../styles/quiz.css'

function QuizList() {
  const navigate = useNavigate()
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    signInAnonymously(auth).catch(console.error)
    loadQuizzes()
  }, [])

  const loadQuizzes = async () => {
    try {
      const q = query(collection(db, 'QUIZZES'), where('publico', '==', true))
      const snapshot = await getDocs(q)
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      setQuizzes(data)
    } catch (err) {
      console.error('Error loading quizzes:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredQuizzes = filter === 'all' 
    ? quizzes 
    : quizzes.filter(q => q.topic === filter)

  const topics = [...new Set(quizzes.map(q => q.topic))]

  return (
    <div className="quiz-list-page">
      <div className="quiz-list-header">
        <a href="/" className="quiz-list-brand">
          <div className="admin-logo"></div>
          <span>Falken's Maze</span>
        </a>
      </div>

      <div className="quiz-list-container">
        <div className="quiz-list-hero">
          <h1>🎯 Quizzes</h1>
          <p>Pon a prueba tus conocimientos</p>
          <div style={{ marginTop: '24px', display: 'inline-flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              className="btn-play"
              style={{ padding: '12px 24px', fontSize: '1rem', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              onClick={() => navigate('/quiz-creator')}
            >
              <i className="bi bi-plus-circle"></i> Crear mi propio Quiz
            </button>
            <button
              className="btn-play"
              style={{ padding: '12px 24px', fontSize: '1rem', display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#2980b9' }}
              onClick={() => navigate('/exam-admin')}
            >
              <i className="bi bi-qr-code"></i> Examen por QR
            </button>
          </div>
        </div>

        <div className="quiz-filters">
          <button 
            className={filter === 'all' ? 'filter-btn active' : 'filter-btn'}
            onClick={() => setFilter('all')}
          >
            Todos
          </button>
          {topics.map(topic => (
            <button
              key={topic}
              className={filter === topic ? 'filter-btn active' : 'filter-btn'}
              onClick={() => setFilter(topic)}
            >
              {topic}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
            Cargando quizzes...
          </div>
        ) : filteredQuizzes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎯</div>
            <p>No hay quizzes disponibles todavía</p>
          </div>
        ) : (
          <div className="quiz-grid">
            {filteredQuizzes.map(quiz => (
              <div key={quiz.id} className="quiz-card">
                <div className="quiz-card-header">
                  <h3>{quiz.titulo}</h3>
                  <span className="quiz-topic">{quiz.topic}</span>
                </div>
                <p className="quiz-desc">{quiz.descripcion || 'Sin descripción'}</p>
                <div className="quiz-meta">
                  <span><i className="bi bi-question-circle"></i> {quiz.preguntas?.length || 0} preguntas</span>
                  <span><i className="bi bi-clock"></i> ~{Math.ceil((quiz.preguntas?.reduce((sum, p) => sum + p.tiempo, 0) || 0) / 60)} min</span>
                </div>
                <div className="quiz-card-actions">
                  <button
                    className="btn-host-small"
                    onClick={() => navigate(`/host/${quiz.id}`)}
                  >
                    <i className="bi bi-broadcast"></i> Jugar en Vivo
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default QuizList
