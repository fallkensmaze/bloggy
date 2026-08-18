import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, auth } from '../firebase'
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import {
  encryptPasteContent,
  generatePasteCode,
  MAX_CIPHERTEXT_CHARS,
  MAX_PASTE_CHARS,
  normalizePasteCode,
  PASTE_CODE_LENGTH,
  supportsPasteCrypto
} from '../utils/pasteCrypto'

const EXPIRATION_MS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
}

async function getAnonymousUser() {
  if (auth.currentUser) {
    return auth.currentUser
  }

  const credential = await signInAnonymously(auth)
  return credential.user
}

function getExpirationDate(expiration) {
  return new Date(Date.now() + (EXPIRATION_MS[expiration] || EXPIRATION_MS['24h']))
}

function PasteCreate() {
  const navigate = useNavigate()
  const [contenido, setContenido] = useState('')
  const [titulo, setTitulo] = useState('')
  const [expiracion, setExpiracion] = useState('24h')
  const [codigoAbrir, setCodigoAbrir] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    signInAnonymously(auth).catch(console.error)
  }, [])

  const handleOpenCode = (event) => {
    event.preventDefault()

    const code = normalizePasteCode(codigoAbrir)
    if (code.length >= 5) {
      navigate(`/ptb/${code}`)
    }
  }

  const handleSave = async () => {
    if (!contenido.trim()) {
      setError('El contenido no puede estar vacío.')
      return
    }

    if (contenido.length > MAX_PASTE_CHARS) {
      setError(`El texto excede el límite de ${MAX_PASTE_CHARS} caracteres.`)
      return
    }

    if (!supportsPasteCrypto()) {
      setError('Tu navegador no permite cifrado seguro en esta página.')
      return
    }

    setSaving(true)
    setError('')

    const pasteId = generatePasteCode()
    const expireDate = getExpirationDate(expiracion)

    try {
      const user = await getAnonymousUser()
      const encrypted = await encryptPasteContent(contenido, pasteId)

      if (encrypted.ciphertext.length >= MAX_CIPHERTEXT_CHARS) {
        setError('El texto ocupa demasiado al cifrarlo. Prueba con un fragmento más corto.')
        setSaving(false)
        return
      }

      const batch = writeBatch(db)
      const pasteRef = doc(db, 'PASTES', pasteId)
      const limitRef = doc(db, 'USER_LIMITS', user.uid)

      batch.set(pasteRef, {
        titulo: titulo.trim() || 'Sin título',
        encrypted: true,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        plainLength: contenido.length,
        fechaCreacion: serverTimestamp(),
        fechaExpiracion: expireDate,
        uid: user.uid
      })

      batch.set(limitRef, { lastPaste: serverTimestamp() }, { merge: true })
      await batch.commit()
      navigate(`/ptb/${pasteId}`)
    } catch (err) {
      console.error('Error saving paste:', err)
      if (err.code === 'permission-denied' || err.message.includes('Missing or insufficient permissions')) {
        setError('Por seguridad, debes esperar 5 minutos antes de poder crear otro documento.')
      } else if (err.message === 'crypto-unavailable') {
        setError('Tu navegador no permite cifrado seguro en esta página.')
      } else {
        setError('No se pudo crear el paste: ' + err.message)
      }
      setSaving(false)
    }
  }

  const codigoNormalizado = normalizePasteCode(codigoAbrir)

  return (
    <div className="page-body" style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '8px' }}>
          <i className="bi bi-file-earmark-lock"></i> Pastebin corto
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Crea fragmentos temporales con un código de {PASTE_CODE_LENGTH} caracteres.
        </p>
      </div>

      <form
        onSubmit={handleOpenCode}
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '24px',
          flexWrap: 'wrap',
          alignItems: 'flex-end'
        }}
      >
        <div style={{ flex: '1 1 220px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
            Abrir por código
          </label>
          <input
            type="text"
            className="dark-input"
            placeholder="Ej. A7KD3Q9M"
            value={codigoAbrir}
            onChange={(e) => setCodigoAbrir(normalizePasteCode(e.target.value))}
            maxLength={PASTE_CODE_LENGTH}
            style={{ width: '100%', textTransform: 'uppercase', letterSpacing: '0.08em' }}
          />
        </div>
        <button
          type="submit"
          className="btn-back"
          disabled={codigoNormalizado.length < 5}
          style={{ margin: 0 }}
        >
          <i className="bi bi-box-arrow-in-right"></i> Abrir
        </button>
      </form>

      {error && (
        <div style={{ background: 'rgba(231, 76, 60, 0.1)', color: '#e74c3c', padding: '12px', borderRadius: '6px', marginBottom: '16px', border: '1px solid rgba(231,76,60,0.3)' }}>
          <i className="bi bi-exclamation-triangle-fill"></i> {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>Título (opcional, no cifrado)</label>
          <input
            type="text"
            className="dark-input"
            placeholder="Ej. Configuración Nginx"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={100}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>Autodestrucción en</label>
          <select
            className="dark-input"
            value={expiracion}
            onChange={(e) => setExpiracion(e.target.value)}
          >
            <option value="1h">1 hora</option>
            <option value="24h">24 horas</option>
            <option value="7d">7 días</option>
          </select>
        </div>
      </div>

      <div style={{ position: 'relative', marginBottom: '24px' }}>
        <textarea
          className="dark-input"
          placeholder="Pega tu texto o código aquí..."
          value={contenido}
          onChange={(e) => setContenido(e.target.value)}
          style={{ width: '100%', minHeight: '400px', fontFamily: 'monospace', resize: 'vertical' }}
        />
        <div style={{
          position: 'absolute',
          bottom: '12px',
          right: '12px',
          fontSize: '12px',
          color: contenido.length > MAX_PASTE_CHARS ? '#e74c3c' : 'var(--text-muted)',
          background: 'var(--bg-secondary)',
          padding: '4px 8px',
          borderRadius: '4px'
        }}>
          {contenido.length} / {MAX_PASTE_CHARS}
        </div>
      </div>

      <button
        className="btn-play"
        onClick={handleSave}
        disabled={saving || !contenido.trim() || contenido.length > MAX_PASTE_CHARS}
        style={{ width: '100%', justifyContent: 'center' }}
      >
        {saving ? 'Cifrando y guardando...' : 'Crear código corto'} <i className="bi bi-lock-fill"></i>
      </button>
    </div>
  )
}

export default PasteCreate
