import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'
import {
  decryptPasteContent,
  normalizePasteCode,
  PASTE_CODE_LENGTH,
  supportsPasteCrypto
} from '../utils/pasteCrypto'

function resolvePasteId(rawId) {
  if (!rawId) {
    return ''
  }

  return rawId.length <= PASTE_CODE_LENGTH ? normalizePasteCode(rawId) : rawId
}

function PasteView() {
  const { pasteId } = useParams()
  const [paste, setPaste] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const codeRef = useRef(null)

  useEffect(() => {
    loadPaste()
  }, [pasteId])

  useEffect(() => {
    if (paste && codeRef.current) {
      try {
        codeRef.current.removeAttribute('data-highlighted')
        hljs.highlightElement(codeRef.current)
      } catch (e) {
        console.error('Highlight error:', e)
      }
    }
  }, [paste])

  const loadPaste = async () => {
    setLoading(true)
    setError('')
    setPaste(null)

    const resolvedPasteId = resolvePasteId(pasteId)
    if (!resolvedPasteId) {
      setError('El código no es válido.')
      setLoading(false)
      return
    }

    try {
      const docSnap = await getDoc(doc(db, 'PASTES', resolvedPasteId))

      if (!docSnap.exists()) {
        setError('El documento no existe o el código es incorrecto.')
        return
      }

      const data = docSnap.data()

      if (data.fechaExpiracion) {
        const expireDate = data.fechaExpiracion.toDate()
        if (expireDate < new Date()) {
          setError('Este documento ha caducado y ya no está disponible.')
          return
        }
      }

      let contenido = ''
      if (data.encrypted === true) {
        if (!supportsPasteCrypto()) {
          throw new Error('crypto-unavailable')
        }
        contenido = await decryptPasteContent(data.ciphertext, data.iv, docSnap.id)
      } else if (typeof data.contenido === 'string') {
        contenido = data.contenido
      } else {
        setError('El documento no tiene un formato compatible.')
        return
      }

      setPaste({ id: docSnap.id, ...data, contenido })
    } catch (err) {
      console.error('Error loading paste:', err)
      if (err.code === 'permission-denied') {
        setError('El documento no existe, ha caducado o el código no tiene acceso.')
      } else if (err.message === 'crypto-unavailable') {
        setError('Tu navegador no permite descifrar este documento.')
      } else {
        setError('No se pudo cargar o descifrar el documento.')
      }
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = async (value, type) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(type)
      setTimeout(() => setCopied(''), 3000)
    } catch (err) {
      console.error('Clipboard error:', err)
      setError('No se pudo copiar al portapapeles.')
    }
  }

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando paste...</div>
  }

  if (error) {
    return (
      <div className="page-body" style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center', paddingTop: '10vh' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px', color: 'var(--text-muted)' }}>
          <i className="bi bi-lock-fill"></i>
        </div>
        <h2 style={{ marginBottom: '16px' }}>Acceso denegado</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '32px' }}>{error}</p>
        <Link to="/ptb" className="btn-play" style={{ display: 'inline-flex', textDecoration: 'none' }}>
          Crear nuevo paste
        </Link>
      </div>
    )
  }

  const fecha = paste.fechaCreacion?.toDate?.() || new Date()
  const expira = paste.fechaExpiracion?.toDate?.()
  const pasteUrl = `${window.location.origin}/ptb/${paste.id}`

  return (
    <div className="page-body" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '8px', wordBreak: 'break-word' }}>
            {paste.titulo || 'Paste sin título'}
          </h1>
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <span><i className="bi bi-key"></i> Código: <strong style={{ color: 'var(--text-primary)', letterSpacing: '0.08em' }}>{paste.id}</strong></span>
            <span><i className="bi bi-calendar3"></i> Creado: {fecha.toLocaleString('es-ES')}</span>
            {expira && (
              <span style={{ color: '#e67e22' }}>
                <i className="bi bi-hourglass-split"></i> Expira: {expira.toLocaleString('es-ES')}
              </span>
            )}
            <span><i className="bi bi-file-earmark-text"></i> {paste.contenido.length} caracteres</span>
            {paste.encrypted && <span><i className="bi bi-shield-lock"></i> Cifrado AES-GCM</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button onClick={() => copyToClipboard(paste.id, 'code')} className="btn-back" style={{ margin: 0 }}>
            <i className={`bi ${copied === 'code' ? 'bi-check2' : 'bi-key'}`}></i> {copied === 'code' ? 'Código copiado' : 'Copiar código'}
          </button>
          <button onClick={() => copyToClipboard(pasteUrl, 'link')} className="btn-back" style={{ margin: 0 }}>
            <i className={`bi ${copied === 'link' ? 'bi-check2' : 'bi-link-45deg'}`}></i> {copied === 'link' ? 'Enlace copiado' : 'Copiar enlace'}
          </button>
          <button onClick={() => copyToClipboard(paste.contenido, 'content')} className="btn-back" style={{ margin: 0 }}>
            <i className={`bi ${copied === 'content' ? 'bi-check2' : 'bi-clipboard'}`}></i> {copied === 'content' ? 'Texto copiado' : 'Copiar texto'}
          </button>
          <Link to="/ptb" className="btn-play" style={{ textDecoration: 'none', margin: 0, padding: '8px 16px', fontSize: '14px' }}>
            Nuevo
          </Link>
        </div>
      </div>

      <div style={{
        background: '#1a1b26',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        position: 'relative'
      }}>
        <pre style={{ margin: 0, padding: '20px', overflowX: 'auto' }}>
          <code
            ref={codeRef}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', lineHeight: '1.5' }}
          >
            {paste.contenido}
          </code>
        </pre>
      </div>
    </div>
  )
}

export default PasteView
