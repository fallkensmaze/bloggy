import { useState, useEffect } from 'react'
import { auth } from '../firebase'
import { signOut, onAuthStateChanged } from 'firebase/auth'
import { loginWithGoogle, consumeGoogleRedirect } from '../utils/authGoogle'
import { esAdmin } from '../utils/adminAuth'
import BlogEditor from '../components/admin/BlogEditor'
import CptTest from '../components/admin/CptTest'
import '../styles/admin.css'

// Cada pestaña es una herramienta privada del panel. La puerta de verdad la
// guardan las reglas de Firestore; esto sólo decide qué se enseña.
const PESTANAS = [
  { id: 'blog',     etiqueta: 'Blog',     icono: 'bi-pencil-square' },
  { id: 'atencion', etiqueta: 'Atención', icono: 'bi-activity' },
]

function Admin() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pestana, setPestana] = useState('blog')

  useEffect(() => {
    consumeGoogleRedirect()
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)
    })
    return unsubscribe
  }, [])

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

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
  }

  if (!esAdmin(user)) {
    return (
      <>
        <AdminTopbar user={null} />
        <div className="centered-view">
          <div className="auth-card">
            <div className="auth-card-icon">✏️</div>
            <h1>Área de administración</h1>
            <p>Inicia sesión con tu cuenta de Google para crear entradas del blog.</p>
            {user && !user.isAnonymous && (
              <p style={{ color: 'var(--accent-red)', fontSize: '0.85rem' }}>
                {user.email} no es la cuenta de administración del sitio.
              </p>
            )}
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
      <AdminTopbar user={user} onLogout={handleLogout} />
      <div className="admin-body">
        <nav className="admin-tabs" aria-label="Herramientas del panel">
          {PESTANAS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`admin-tab${pestana === item.id ? ' activa' : ''}`}
              aria-current={pestana === item.id ? 'page' : undefined}
              onClick={() => setPestana(item.id)}
            >
              <i className={`bi ${item.icono}`}></i> {item.etiqueta}
            </button>
          ))}
        </nav>

        {pestana === 'blog' ? <BlogEditor /> : <CptTest />}
      </div>
    </>
  )
}

function AdminTopbar({ user, onLogout }) {
  const [copiado, setCopiado] = useState(false)

  const copiarUid = async () => {
    try {
      await navigator.clipboard.writeText(user.uid)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch (err) {
      console.error('Clipboard error:', err)
    }
  }

  return (
    <header className="admin-topbar">
      <a href="/" className="admin-brand">
        <div className="admin-logo"></div>
        Falken's Maze
      </a>
      <span className="admin-badge">Admin</span>
      {user && (
        <div className="user-chip">
          {user.photoURL && <img src={user.photoURL} alt="" />}
          <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.displayName || user.email}
          </span>
          <button
            onClick={copiarUid}
            className={`btn-sm${copiado ? ' copied' : ''}`}
            title="Tu UID para las reglas de Firestore"
          >
            <i className="bi bi-key"></i> {copiado ? 'Copiado' : `${user.uid.slice(0, 10)}…`}
          </button>
          <button onClick={onLogout} className="btn-sm">Salir</button>
        </div>
      )}
    </header>
  )
}

export default Admin
