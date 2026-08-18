import { useState, useEffect } from 'react'
import { auth, db } from '../firebase'
import { signOut, onAuthStateChanged } from 'firebase/auth'
import { loginWithGoogle, consumeGoogleRedirect } from '../utils/authGoogle'
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import DOMPurify from 'dompurify'
import '../styles/admin.css'

marked.use(markedKatex({ throwOnError: false }))

function renderMarkdown(markdown) {
  return DOMPurify.sanitize(marked.parse(markdown || ''), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'referrerpolicy']
  })
}

function slugify(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
}

function Admin() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // Form fields
  const [titulo, setTitulo] = useState('')
  const [slug, setSlug] = useState('')
  const [topic, setTopic] = useState('')
  const [minutos, setMinutos] = useState(5)
  const [contenido, setContenido] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  
  // Status
  const [status, setStatus] = useState({ show: false, msg: '', type: 'info' })
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    consumeGoogleRedirect()
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!slugEdited) {
      const s = slugify(titulo)
      setSlug(s)
    }
  }, [titulo, slugEdited])

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

  const copyUID = () => {
    navigator.clipboard.writeText(user.uid)
    showStatus('UID copiado al portapapeles', 'ok')
  }

  const showStatus = (msg, type) => {
    setStatus({ show: true, msg, type })
    if (type === 'ok') {
      setTimeout(() => setStatus({ show: false, msg: '', type: 'info' }), 5000)
    }
  }

  const handlePublish = async () => {
    if (!titulo.trim()) {
      showStatus('El título es obligatorio.', 'err')
      return
    }
    if (!slug.trim()) {
      showStatus('El slug (ID del documento) es obligatorio.', 'err')
      return
    }
    if (!contenido.trim()) {
      showStatus('El contenido no puede estar vacío.', 'err')
      return
    }

    setPublishing(true)
    showStatus('Verificando…', 'info')

    try {
      const docRef = doc(db, 'BLOG', slug)
      const existing = await getDoc(docRef)
      
      if (existing.exists()) {
        showStatus(`Ya existe un post con el slug "${slug}". Elige otro ID.`, 'err')
        setPublishing(false)
        return
      }

      showStatus('Publicando…', 'info')
      
      await setDoc(docRef, {
        titulo,
        contenido,
        topic: topic.trim() || 'GENERAL',
        minutos: Math.max(1, parseInt(minutos) || 5),
        fecha: serverTimestamp(),
        fechaCreacion: serverTimestamp()
      })

      showStatus('✓ Post publicado correctamente.', 'ok')
      
      // Clear form
      setTitulo('')
      setSlug('')
      setTopic('')
      setMinutos(5)
      setContenido('')
      setSlugEdited(false)
      
    } catch (err) {
      console.error('Publish error:', err)
      if (err.code === 'permission-denied') {
        showStatus('Permiso denegado. ¿Has puesto tu UID en las reglas de Firestore?', 'err')
      } else {
        showStatus('Error: ' + err.message, 'err')
      }
    } finally {
      setPublishing(false)
    }
  }

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
  }

  if (!user || user.isAnonymous) {
    return (
      <>
        <AdminTopbar user={null} />
        <div className="centered-view">
          <div className="auth-card">
            <div className="auth-card-icon">✏️</div>
            <h1>Área de administración</h1>
            <p>Inicia sesión con tu cuenta de Google para crear entradas del blog.</p>
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

  const preview = contenido ? renderMarkdown(contenido) : '<p style="color:var(--text-muted);font-style:italic;font-size:14px;">La vista previa aparece aquí mientras escribes…</p>'

  return (
    <>
      <AdminTopbar user={user} onLogout={handleLogout} onCopyUID={copyUID} />
      <div className="admin-body">
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '4px' }}>Nueva entrada del blog</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Escribe en Markdown con vista previa en tiempo real.
            Los cambios no se guardan hasta que pulses <strong style={{ color: 'var(--text-secondary)' }}>Publicar</strong>.
          </p>
        </div>

        <div className="meta-grid">
          <div>
            <label className="field-label">Título</label>
            <input
              type="text"
              className="dark-input"
              placeholder="El título del post…"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Slug <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(ID en Firestore)</span></label>
            <input
              type="text"
              className="dark-input"
              placeholder="mi-primer-post"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setSlugEdited(!!e.target.value)
              }}
            />
            <div className="slug-hint">{slug ? `doc ID: "${slug}"` : ''}</div>
          </div>
          <div>
            <label className="field-label">Topic</label>
            <input
              type="text"
              className="dark-input"
              placeholder="ej. Lu-177"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Min. lectura</label>
            <input
              type="number"
              className="dark-input"
              value={minutos}
              onChange={(e) => setMinutos(e.target.value)}
              min="1"
              max="120"
            />
          </div>
        </div>

        <div className="editor-split">
          <div className="editor-pane">
            <div className="editor-pane-header">
              <i className="bi bi-code-slash"></i> Markdown
            </div>
            <textarea
              className="editor-textarea"
              placeholder="# Título&#10;&#10;Escribe aquí en **Markdown**…&#10;&#10;Soporta tablas, código, fórmulas LaTeX ($E=mc^2$), etc."
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
            />
          </div>
          <div className="editor-pane">
            <div className="editor-pane-header">
              <i className="bi bi-eye"></i> Vista previa
            </div>
            <div className="preview-body" dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="btn-publish"
          >
            <i className="bi bi-send-fill"></i> Publicar
          </button>
          {status.show && (
            <div className={`status-msg status-${status.type}`}>
              {status.msg}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function AdminTopbar({ user, onLogout, onCopyUID }) {
  const uidShort = user ? user.uid.slice(0, 10) + '…' : ''

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
          <button onClick={onCopyUID} className="btn-sm" title="Tu UID para las reglas de Firestore">
            <i className="bi bi-key"></i> {uidShort}
          </button>
          <button onClick={onLogout} className="btn-sm">Salir</button>
        </div>
      )}
    </header>
  )
}

export default Admin
