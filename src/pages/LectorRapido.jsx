import { useState, useEffect, useRef, useCallback } from 'react'
import {
  tokenize,
  getORPIndex,
  getWordDelay,
  fileHash,
  estimateRemainingSeconds,
  formatTime,
} from '../utils/rsvp'
import '../styles/lector.css'

const STORAGE_WPM_KEY   = 'rsvp_wpm'
const STORAGE_INDEX_KEY = 'rsvp_index'   // array of { key, name, totalWords, savedAt }
const CONTEXT_SIZE      = 15

// ── localStorage helpers ────────────────────────────────────────────────────

function readIndex() {
  try { return JSON.parse(localStorage.getItem(STORAGE_INDEX_KEY)) || [] }
  catch { return [] }
}

function writeIndex(arr) {
  localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(arr))
}

/**
 * Persist full text + update index entry.
 * Returns false if localStorage quota is exceeded (large files).
 */
function saveTextToStorage(key, name, text, totalWords) {
  try {
    localStorage.setItem(`rsvp_text_${key}`, text)
    const idx   = readIndex()
    const entry = { key, name, totalWords, savedAt: new Date().toISOString() }
    const next  = [entry, ...idx.filter(e => e.key !== key)]
    writeIndex(next)
    return true
  } catch {
    // QuotaExceededError — text too large for localStorage
    return false
  }
}

function deleteTextFromStorage(key) {
  localStorage.removeItem(`rsvp_text_${key}`)
  localStorage.removeItem(`rsvp_pos_${key}`)
  writeIndex(readIndex().filter(e => e.key !== key))
}

function readPosition(key) {
  try {
    const raw = localStorage.getItem(`rsvp_pos_${key}`)
    if (!raw) return 0
    const { position } = JSON.parse(raw)
    return position || 0
  } catch { return 0 }
}

function savePosition(key, position) {
  localStorage.setItem(`rsvp_pos_${key}`, JSON.stringify({ position }))
}

// ── Component ───────────────────────────────────────────────────────────────

function LectorRapido() {
  // ── Tokens & position ──────────────────────────────────────────────────
  const [tokens, setTokens]             = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)

  // ── Playback ───────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false)
  const [wpm, setWpm] = useState(() => {
    const saved = localStorage.getItem(STORAGE_WPM_KEY)
    return saved ? parseInt(saved, 10) : 300
  })

  // ── UI state ───────────────────────────────────────────────────────────
  const [showContext, setShowContext]     = useState(true)
  const [showHelp, setShowHelp]           = useState(false)
  const [showTextInput, setShowTextInput] = useState(false)
  const [pastedText, setPastedText]       = useState('')
  const [isDragging, setIsDragging]       = useState(false)
  const [fileName, setFileName]           = useState('')
  const [resumeInfo, setResumeInfo]       = useState(null) // {position, total}
  const [jumpTarget, setJumpTarget]       = useState('')
  const [storageWarning, setStorageWarning] = useState(false)
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null) // key pending deletion

  // ── Saved-texts index ─────────────────────────────────────────────────
  const [savedTexts, setSavedTexts] = useState(() => readIndex())

  const refreshIndex = () => setSavedTexts(readIndex())

  // ── Refs ───────────────────────────────────────────────────────────────
  const isPlayingRef    = useRef(false)
  const currentIndexRef = useRef(0)
  const tokensRef       = useRef([])
  const wpmRef          = useRef(wpm)
  const fileKeyRef      = useRef(null)
  const timeoutRef      = useRef(null)
  const scheduleRef     = useRef(null)

  useEffect(() => { wpmRef.current = wpm },             [wpm])
  useEffect(() => { tokensRef.current = tokens },       [tokens])
  useEffect(() => { currentIndexRef.current = currentIndex }, [currentIndex])
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])

  // ── Recursive play loop ────────────────────────────────────────────────
  scheduleRef.current = () => {
    const idx  = currentIndexRef.current
    const toks = tokensRef.current
    if (!isPlayingRef.current || idx >= toks.length) return

    const delay = getWordDelay(toks[idx], wpmRef.current)
    timeoutRef.current = setTimeout(() => {
      const next = idx + 1
      if (next >= toks.length) {
        setIsPlaying(false)
        isPlayingRef.current = false
        return
      }
      currentIndexRef.current = next
      setCurrentIndex(next)

      if (fileKeyRef.current) savePosition(fileKeyRef.current, next)

      scheduleRef.current()
    }, delay)
  }

  // ── Playback controls ──────────────────────────────────────────────────
  const play = useCallback(() => {
    if (tokensRef.current.length === 0) return
    isPlayingRef.current = true
    setIsPlaying(true)
    scheduleRef.current()
  }, [])

  const pause = useCallback(() => {
    isPlayingRef.current = false
    setIsPlaying(false)
    clearTimeout(timeoutRef.current)
  }, [])

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) pause()
    else play()
  }, [play, pause])

  // ── Navigation ─────────────────────────────────────────────────────────
  const goTo = useCallback((idx) => {
    const clamped = Math.max(0, Math.min(idx, tokensRef.current.length - 1))
    currentIndexRef.current = clamped
    setCurrentIndex(clamped)
    if (fileKeyRef.current) savePosition(fileKeyRef.current, clamped)
    if (isPlayingRef.current) {
      clearTimeout(timeoutRef.current)
      scheduleRef.current()
    }
  }, [])

  const goHome = useCallback(() => goTo(0), [goTo])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      switch (e.key) {
        case ' ':
          e.preventDefault(); togglePlay(); break
        case 'ArrowRight':
          e.preventDefault(); goTo(currentIndexRef.current + (e.shiftKey ? 10 : 1)); break
        case 'ArrowLeft':
          e.preventDefault(); goTo(currentIndexRef.current - (e.shiftKey ? 10 : 1)); break
        case 'ArrowUp':
          e.preventDefault()
          setWpm(w => {
            const next = Math.min(1000, w + 20)
            wpmRef.current = next; localStorage.setItem(STORAGE_WPM_KEY, next); return next
          }); break
        case 'ArrowDown':
          e.preventDefault()
          setWpm(w => {
            const next = Math.max(100, w - 20)
            wpmRef.current = next; localStorage.setItem(STORAGE_WPM_KEY, next); return next
          }); break
        case 'Home':
          e.preventDefault(); goHome(); break
        default: break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [togglePlay, goTo, goHome])

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  // ── Internal: activate a loaded set of tokens ──────────────────────────
  const activateTokens = useCallback((toks, key, name, startPosition) => {
    setTokens(toks)
    tokensRef.current = toks
    setFileName(name)
    fileKeyRef.current = key
    setShowTextInput(false)
    setStorageWarning(false)

    const pos = startPosition || 0
    if (pos > 0 && pos < toks.length) {
      setResumeInfo({ position: pos, total: toks.length })
      setCurrentIndex(0)
      currentIndexRef.current = 0
    } else {
      setCurrentIndex(0)
      currentIndexRef.current = 0
      setResumeInfo(null)
    }
  }, [])

  // ── Auto-load last text on mount ──────────────────────────────────────
  // Runs once after mount. activateTokens is stable (useCallback with []),
  // so capturing it here is safe.
  useEffect(() => {
    const idx = readIndex()
    if (idx.length === 0) return
    const last = idx[0]                                      // most-recent-first
    const raw  = localStorage.getItem(`rsvp_text_${last.key}`)
    if (!raw) return                                         // text was never saved (quota error)
    const toks = tokenize(raw)
    if (toks.length === 0) return
    const pos = readPosition(last.key)
    activateTokens(toks, last.key, last.name, pos)
  }, [activateTokens])

  // ── Load text from string (new file / paste) ───────────────────────────
  const loadText = useCallback((text, name, size) => {
    pause()
    const toks = tokenize(text)
    if (toks.length === 0) return

    const key = fileHash(name, size, text.slice(0, 200))

    // Save text to localStorage (may fail for very large files)
    const saved = saveTextToStorage(key, name, text, toks.length)
    if (!saved) setStorageWarning(true)
    refreshIndex()

    const pos = readPosition(key)
    activateTokens(toks, key, name, pos)
  }, [pause, activateTokens])

  // ── Load text from a saved entry ──────────────────────────────────────
  const loadSaved = useCallback((entry) => {
    pause()
    const raw = localStorage.getItem(`rsvp_text_${entry.key}`)
    if (!raw) return // text was deleted externally
    const toks = tokenize(raw)
    if (toks.length === 0) return
    const pos = readPosition(entry.key)
    activateTokens(toks, entry.key, entry.name, pos)
  }, [pause, activateTokens])

  const handleFileInput = useCallback((file) => {
    if (!file || !file.name.toLowerCase().endsWith('.txt')) return
    const reader = new FileReader()
    reader.onload = (e) => loadText(e.target.result, file.name, file.size)
    reader.readAsText(file, 'utf-8')
  }, [loadText])

  const handleLoadPasted = useCallback(() => {
    if (!pastedText.trim()) return
    loadText(pastedText, 'texto-pegado', pastedText.length)
  }, [pastedText, loadText])

  // ── Drag & drop ────────────────────────────────────────────────────────
  const handleDragOver  = (e) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = ()  => setIsDragging(false)
  const handleDrop      = (e) => {
    e.preventDefault(); setIsDragging(false); handleFileInput(e.dataTransfer.files[0])
  }

  // ── Resume / restart ───────────────────────────────────────────────────
  const handleResume = () => {
    const pos = resumeInfo.position
    setCurrentIndex(pos); currentIndexRef.current = pos; setResumeInfo(null)
  }

  const handleRestart = () => {
    setCurrentIndex(0); currentIndexRef.current = 0; setResumeInfo(null)
    if (fileKeyRef.current) savePosition(fileKeyRef.current, 0)
  }

  // ── Delete saved text ──────────────────────────────────────────────────
  const handleDelete = (key) => {
    deleteTextFromStorage(key)
    refreshIndex()
    setConfirmDeleteKey(null)
    // If the deleted text is the one currently loaded, unload it
    if (fileKeyRef.current === key) {
      pause(); setTokens([]); setResumeInfo(null)
    }
  }

  // ── Speed ──────────────────────────────────────────────────────────────
  const handleWpmChange = (val) => {
    const v = parseInt(val, 10)
    setWpm(v); wpmRef.current = v; localStorage.setItem(STORAGE_WPM_KEY, v)
    if (isPlayingRef.current) { clearTimeout(timeoutRef.current); scheduleRef.current() }
  }

  // ── Jump ───────────────────────────────────────────────────────────────
  const handleJump = (e) => {
    e.preventDefault()
    const n = parseInt(jumpTarget, 10)
    if (!isNaN(n)) goTo(n - 1)
    setJumpTarget('')
  }

  // ── Derived display values ─────────────────────────────────────────────
  const token     = tokens[currentIndex] || null
  const word      = token?.word || '···'
  const orpIdx    = token ? getORPIndex(word) : 0
  const prePart   = word.slice(0, orpIdx)
  const orpLetter = word[orpIdx] || ''
  const postPart  = word.slice(orpIdx + 1)

  const progress  = tokens.length > 1 ? (currentIndex / (tokens.length - 1)) * 100 : 0
  const pct       = Math.round(progress)
  const remaining = tokens.length > 0 ? estimateRemainingSeconds(tokens, currentIndex, wpm) : 0

  const ctxStart   = Math.max(0, currentIndex - CONTEXT_SIZE)
  const ctxEnd     = Math.min(tokens.length, currentIndex + CONTEXT_SIZE + 1)
  const ctxTokens  = tokens.slice(ctxStart, ctxEnd)
  const ctxCurrent = currentIndex - ctxStart

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="page-body" style={{ maxWidth: '860px' }}>
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-speedometer2"></i></div>
        <h1 className="page-title">Lector rápido</h1>
        <p className="page-subtitle">RSVP · Rapid Serial Visual Presentation</p>
      </div>

      {/* ── File loading area ── */}
      {tokens.length === 0 && (
        <>
          <div className="calc-card" style={{ marginBottom: '20px' }}>
            <div
              className={`rsvp-dropzone${isDragging ? ' rsvp-dropzone--active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <i className="bi bi-file-earmark-text"
                style={{ fontSize: '2.5rem', color: 'var(--accent-blue)', marginBottom: '12px' }} />
              <p style={{ color: 'var(--text-secondary)', marginBottom: '14px' }}>
                Arrastra un archivo <strong>.txt</strong> aquí, o
              </p>
              <label className="rsvp-btn rsvp-btn--primary" style={{ cursor: 'pointer' }}>
                <i className="bi bi-folder2-open" style={{ marginRight: '6px' }} />
                Abrir archivo
                <input type="file" accept=".txt" style={{ display: 'none' }}
                  onChange={e => handleFileInput(e.target.files[0])} />
              </label>
            </div>

            <div style={{ textAlign: 'center', marginTop: '14px' }}>
              <button className="rsvp-btn rsvp-btn--ghost" onClick={() => setShowTextInput(v => !v)}>
                <i className={`bi bi-chevron-${showTextInput ? 'up' : 'down'}`}
                  style={{ marginRight: '6px' }} />
                {showTextInput ? 'Ocultar área de texto' : 'Pegar texto directamente'}
              </button>
            </div>

            {showTextInput && (
              <div style={{ marginTop: '14px' }}>
                <textarea
                  className="dark-input"
                  style={{ minHeight: '160px', resize: 'vertical', fontFamily: 'inherit' }}
                  placeholder="Pega tu texto aquí…"
                  value={pastedText}
                  onChange={e => setPastedText(e.target.value)}
                />
                <button className="rsvp-btn rsvp-btn--primary"
                  style={{ marginTop: '10px' }}
                  onClick={handleLoadPasted}
                  disabled={!pastedText.trim()}>
                  Cargar texto
                </button>
              </div>
            )}
          </div>

          {/* ── Saved texts list ── */}
          {savedTexts.length > 0 && (
            <div className="calc-card">
              <span className="field-label" style={{ display: 'block', marginBottom: '14px' }}>
                Textos guardados
              </span>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {savedTexts.map(entry => {
                  const pos     = readPosition(entry.key)
                  const entryPct = entry.totalWords > 1
                    ? Math.round((pos / (entry.totalWords - 1)) * 100)
                    : 0
                  const date = new Date(entry.savedAt).toLocaleDateString('es-ES', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })

                  return (
                    <div key={entry.key} className="rsvp-saved-entry">
                      <div className="rsvp-saved-info">
                        <span className="rsvp-saved-name">
                          <i className="bi bi-file-text" style={{ marginRight: '7px', color: 'var(--accent-blue)' }} />
                          {entry.name}
                        </span>
                        <span className="rsvp-saved-meta">
                          {entry.totalWords.toLocaleString()} palabras · {date}
                        </span>
                        {/* Mini progress bar */}
                        <div className="rsvp-saved-bar-wrap">
                          <div className="rsvp-saved-bar" style={{ width: `${entryPct}%` }} />
                        </div>
                        <span className="rsvp-saved-pct">{entryPct}% leído</span>
                      </div>

                      <div className="rsvp-saved-actions">
                        <button className="rsvp-btn rsvp-btn--primary"
                          onClick={() => loadSaved(entry)}>
                          <i className="bi bi-play-fill" style={{ marginRight: '5px' }} />
                          Abrir
                        </button>

                        {confirmDeleteKey === entry.key ? (
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>¿Borrar?</span>
                            <button
                              className="rsvp-btn rsvp-btn--ghost"
                              style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}
                              onClick={() => handleDelete(entry.key)}>
                              Sí
                            </button>
                            <button className="rsvp-btn rsvp-btn--ghost"
                              onClick={() => setConfirmDeleteKey(null)}>
                              No
                            </button>
                          </div>
                        ) : (
                          <button className="rsvp-btn rsvp-btn--icon"
                            title="Eliminar texto guardado"
                            aria-label="Eliminar texto guardado"
                            onClick={() => setConfirmDeleteKey(entry.key)}>
                            <i className="bi bi-trash3" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Resume prompt ── */}
      {resumeInfo && (
        <div className="calc-card" style={{ marginBottom: '20px' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '14px' }}>
            <i className="bi bi-bookmark-check" style={{ color: 'var(--accent-blue)', marginRight: '8px' }} />
            Continuar en palabra{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{resumeInfo.position.toLocaleString()}</strong>
            {' '}de{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{resumeInfo.total.toLocaleString()}</strong>
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="rsvp-btn rsvp-btn--primary" onClick={handleResume}>
              <i className="bi bi-play-fill" style={{ marginRight: '6px' }} />Continuar
            </button>
            <button className="rsvp-btn rsvp-btn--ghost" onClick={handleRestart}>
              <i className="bi bi-skip-start" style={{ marginRight: '6px' }} />Empezar de cero
            </button>
          </div>
        </div>
      )}

      {/* ── Main reader ── */}
      {tokens.length > 0 && !resumeInfo && (
        <>
          {/* File info bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '14px', flexWrap: 'wrap', gap: '10px',
          }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              <i className="bi bi-file-earmark-text" style={{ marginRight: '6px' }} />
              {fileName}
              {storageWarning && (
                <span style={{ marginLeft: '10px', color: 'var(--accent-orange)', fontSize: '12px' }}>
                  <i className="bi bi-exclamation-triangle" style={{ marginRight: '4px' }} />
                  Archivo grande — posición guardada pero no el texto
                </span>
              )}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="rsvp-btn rsvp-btn--ghost"
                onClick={() => { pause(); setTokens([]); setResumeInfo(null); setPastedText(''); refreshIndex() }}>
                <i className="bi bi-folder2-open" style={{ marginRight: '6px' }} />
                Cargar otro
              </button>
              <button className="rsvp-btn rsvp-btn--ghost"
                onClick={() => setShowHelp(v => !v)}
                title="Atajos de teclado" aria-label="Mostrar atajos de teclado">
                <i className="bi bi-question-circle" />
              </button>
            </div>
          </div>

          {/* Keyboard help */}
          {showHelp && (
            <div className="calc-card" style={{ marginBottom: '14px' }}>
              <span className="field-label" style={{ display: 'block', marginBottom: '12px' }}>
                Atajos de teclado
              </span>
              <div className="rsvp-help-grid">
                {[
                  ['Espacio',    'Play / Pausa'],
                  ['← →',       '±1 palabra'],
                  ['Shift+← →', '±10 palabras'],
                  ['↑ ↓',       '±20 ppm de velocidad'],
                  ['Home',      'Ir al inicio'],
                ].map(([key, desc]) => (
                  <div key={key} className="rsvp-help-row">
                    <kbd className="rsvp-kbd">{key}</kbd>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── RSVP display card ── */}
          <div className="calc-card">
            <div className="rsvp-focal-area"
              aria-live="polite" aria-atomic="true"
              aria-label={`Palabra actual: ${word}`}>
              <div className="rsvp-guide rsvp-guide--top" aria-hidden="true" />
              <div className="rsvp-word-area">
                <div className="rsvp-word-inner" style={{ '--orp-idx': orpIdx }}>
                  <span className="rsvp-pre">{prePart}</span>
                  <span className="rsvp-orp">{orpLetter}</span>
                  <span className="rsvp-post">{postPart}</span>
                </div>
              </div>
              <div className="rsvp-guide rsvp-guide--bottom" aria-hidden="true" />
            </div>

            <div className="rsvp-stats">
              <span>{pct}% leído</span>
              <span>{wpm} ppm</span>
              <span>~{formatTime(remaining)} restante</span>
            </div>

            <div style={{ marginTop: '14px' }}>
              <input type="range" className="rsvp-slider"
                min={0} max={tokens.length - 1} value={currentIndex}
                onChange={e => goTo(parseInt(e.target.value, 10))}
                aria-label="Posición en el texto" />
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: '11px', color: 'var(--text-muted)',
                marginTop: '4px', fontVariantNumeric: 'tabular-nums',
              }}>
                <span>Palabra {(currentIndex + 1).toLocaleString()}</span>
                <span>{tokens.length.toLocaleString()} palabras</span>
              </div>
            </div>

            <div className="rsvp-controls-row" style={{ marginTop: '20px' }}>
              <button className="rsvp-btn rsvp-btn--icon" onClick={goHome}
                title="Ir al inicio (Home)" aria-label="Ir al inicio">
                <i className="bi bi-skip-start-fill" />
              </button>
              <button className="rsvp-btn rsvp-btn--icon" onClick={() => goTo(currentIndex - 10)}
                title="−10 palabras (Shift+←)" aria-label="Retroceder 10 palabras">
                <i className="bi bi-skip-backward-fill" />
              </button>
              <button className="rsvp-btn rsvp-btn--icon" onClick={() => goTo(currentIndex - 1)}
                title="−1 palabra (←)" aria-label="Retroceder 1 palabra">
                <i className="bi bi-chevron-left" />
              </button>
              <button className="rsvp-btn rsvp-btn--play" onClick={togglePlay}
                title="Play / Pausa (Espacio)" aria-label={isPlaying ? 'Pausar' : 'Reproducir'}>
                <i className={`bi bi-${isPlaying ? 'pause-fill' : 'play-fill'}`} />
              </button>
              <button className="rsvp-btn rsvp-btn--icon" onClick={() => goTo(currentIndex + 1)}
                title="+1 palabra (→)" aria-label="Avanzar 1 palabra">
                <i className="bi bi-chevron-right" />
              </button>
              <button className="rsvp-btn rsvp-btn--icon" onClick={() => goTo(currentIndex + 10)}
                title="+10 palabras (Shift+→)" aria-label="Avanzar 10 palabras">
                <i className="bi bi-skip-forward-fill" />
              </button>
            </div>

            <div style={{ marginTop: '20px' }}>
              <label className="field-label">Velocidad de lectura</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                <input type="range" className="rsvp-slider"
                  min={100} max={1000} step={10} value={wpm}
                  onChange={e => handleWpmChange(e.target.value)}
                  aria-label="Velocidad en palabras por minuto" />
                <span style={{
                  color: 'var(--accent-blue)', fontVariantNumeric: 'tabular-nums',
                  minWidth: '64px', fontSize: '14px', fontWeight: 600, textAlign: 'right',
                }}>
                  {wpm} ppm
                </span>
              </div>
            </div>

            <div style={{
              marginTop: '18px', display: 'flex', gap: '10px',
              alignItems: 'flex-end', flexWrap: 'wrap',
            }}>
              <form onSubmit={handleJump} style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                <div>
                  <label className="field-label">Ir a palabra #</label>
                  <input type="number" className="dark-input" style={{ width: '110px' }}
                    min={1} max={tokens.length}
                    value={jumpTarget} onChange={e => setJumpTarget(e.target.value)}
                    placeholder={`1 – ${tokens.length}`} />
                </div>
                <button type="submit" className="rsvp-btn rsvp-btn--ghost">Ir</button>
              </form>

              <button className="rsvp-btn rsvp-btn--ghost"
                onClick={() => setShowContext(v => !v)}
                style={{ marginLeft: 'auto' }}>
                <i className={`bi bi-eye${showContext ? '-slash' : ''}`} style={{ marginRight: '6px' }} />
                {showContext ? 'Ocultar' : 'Mostrar'} contexto
              </button>
            </div>
          </div>

          {/* ── Context window ── */}
          {showContext && ctxTokens.length > 0 && (
            <div className="calc-card" style={{ marginTop: '14px' }}>
              <span className="field-label" style={{ display: 'block', marginBottom: '10px' }}>
                Contexto
              </span>
              <p className="rsvp-context-text">
                {ctxTokens.map((t, i) => (
                  <span key={ctxStart + i}
                    className={i === ctxCurrent ? 'rsvp-context-current' : 'rsvp-context-word'}>
                    {t.word}{' '}
                  </span>
                ))}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default LectorRapido
