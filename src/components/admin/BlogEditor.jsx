// ── Editor de entradas del blog ─────────────────────────────────────────────
//
// El formulario que estaba en `pages/Admin.jsx` antes de que el panel tuviera
// pestañas. Escribe en la colección BLOG, con el slug como identificador del
// documento, y no pisa nunca una entrada existente: si el slug ya está cogido,
// avisa en lugar de sobreescribir.

import { useEffect, useState } from 'react'
import { db } from '../../firebase'
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import DOMPurify from 'dompurify'

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

export default function BlogEditor() {
  const [titulo, setTitulo] = useState('')
  const [slug, setSlug] = useState('')
  const [topic, setTopic] = useState('')
  const [minutos, setMinutos] = useState(5)
  const [contenido, setContenido] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)

  const [status, setStatus] = useState({ show: false, msg: '', type: 'info' })
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!slugEdited) setSlug(slugify(titulo))
  }, [titulo, slugEdited])

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

  const preview = contenido
    ? renderMarkdown(contenido)
    : '<p style="color:var(--text-muted);font-style:italic;font-size:14px;">La vista previa aparece aquí mientras escribes…</p>'

  return (
    <>
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
    </>
  )
}
