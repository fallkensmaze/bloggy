import { useState, useEffect, useRef, useCallback } from 'react'
import { prettyMorse, symbolsFor } from '../../utils/morse'
import {
  buildCopyDrill,
  gradeCopy,
  readyToAdvance,
  wordsFor,
  KOCH_TARGET,
  MAX_LESSON,
} from '../../utils/morseTrainer'
import { readChoice, readNumber, writeValue } from '../../utils/localSettings'

const MODES = [
  { id: 'caracter', label: 'Un carácter', hint: 'Suena un solo carácter: lo más parecido a la primera lección de Koch' },
  { id: 'grupo',    label: 'Grupos',      hint: 'Grupos al azar, como en los exámenes y en las prácticas clásicas' },
  { id: 'palabra',  label: 'Abreviaturas', hint: 'Voces reales de CW, si el mazo activo da para escribirlas' },
]
const SIZES = [3, 5, 7]

const MODE_KEY = 'morse_copy_mode'
const SIZE_KEY = 'morse_copy_size'

/**
 * Copiado al oído. Suena el ejercicio, se escribe lo que se ha entendido y se
 * corrige carácter a carácter; cada carácter alimenta su caja de Leitner.
 * Con el mazo Koch, tras varios grupos buenos se ofrece añadir el siguiente.
 */
function CopyPanel({ pool, deck, lesson, progressRef, play, stop, playing, recordChars, onAdvance, canPlay }) {
  const [mode, setMode] = useState(() => readChoice(MODE_KEY, MODES.map(m => m.id), 'grupo'))
  const [size, setSize] = useState(() => readNumber(SIZE_KEY, { min: 3, max: 7, fallback: 5 }))

  const [drill, setDrill]     = useState(null)
  const [answer, setAnswer]   = useState('')
  const [grade, setGrade]     = useState(null)
  const [history, setHistory] = useState([])
  const [lamp, setLamp]       = useState(false)
  const [started, setStarted] = useState(false)

  const inputRef  = useRef(null)
  const playedRef = useRef(null)   // id del ejercicio ya reproducido
  const gradeRef  = useRef(null)

  const words = wordsFor(pool.map(e => e.char))

  const nextDrill = useCallback((over = {}) => {
    const d = buildCopyDrill({
      pool,
      progress: progressRef.current,
      mode: over.mode ?? mode,
      size: over.size ?? size,
    })
    setDrill({ ...d, id: Date.now() + Math.random() })
    setAnswer('')
    setGrade(null)
    gradeRef.current = null
  }, [pool, mode, size, progressRef])

  // Ejercicio nuevo al entrar y cada vez que cambian el mazo o los ajustes.
  useEffect(() => { nextDrill() }, [nextDrill])

  const listen = useCallback(() => {
    if (!drill) return
    playedRef.current = drill.id
    setStarted(true)
    play(drill.text, {
      onSymbol: ({ on }) => setLamp(on),
      onEnd: () => setLamp(false),
    })
    inputRef.current?.focus()
  }, [drill, play])

  // Reproducción automática del ejercicio siguiente. El primero espera a que el
  // usuario pulse: sin un gesto suyo el navegador no deja sonar nada.
  useEffect(() => {
    if (!drill || playedRef.current === null) return
    if (playedRef.current === drill.id) return
    playedRef.current = drill.id
    play(drill.text, {
      onSymbol: ({ on }) => setLamp(on),
      onEnd: () => setLamp(false),
    })
    inputRef.current?.focus()
  }, [drill, play])

  const check = useCallback(() => {
    if (!drill || gradeRef.current) return
    stop()
    setLamp(false)
    const g = gradeCopy(drill.text, answer)
    gradeRef.current = g
    setGrade(g)
    recordChars(g.cells
      .filter(c => c.expected !== null)
      .map(c => ({ char: c.expected, ok: c.ok })))
    setHistory(h => [...h, g.total === 0 ? 0 : Math.round((g.correct / g.total) * 100)].slice(-20))
  }, [drill, answer, stop, recordChars])

  // Al corregir se deshabilita la casilla, así que el Intro que encadena con el
  // ejercicio siguiente hay que escucharlo en la ventana.
  useEffect(() => {
    if (!grade) return
    const onKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        nextDrill()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [grade, nextDrill])

  const handleModeChange = (m) => {
    setMode(m)
    writeValue(MODE_KEY, m)
  }

  const handleSizeChange = (s) => {
    setSize(s)
    writeValue(SIZE_KEY, s)
  }

  const onKeyDown = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (grade) nextDrill()
    else check()
  }

  const puedeSubir = deck === 'koch' && lesson < MAX_LESSON && readyToAdvance(history)
  const media = history.length
    ? Math.round(history.slice(-5).reduce((a, b) => a + b, 0) / Math.min(history.length, 5))
    : null

  return (
    <>
      <div className="mr-row-between">
        <span className="field-label" style={{ marginBottom: 0 }}>Qué se envía</span>
        {media !== null && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Últimos {Math.min(history.length, 5)} ejercicios: {media}% copiado
          </span>
        )}
      </div>

      <div className="mr-chips" style={{ marginTop: '10px' }}>
        {MODES.map(m => (
          <button
            key={m.id}
            className={`mr-btn mr-btn--sm${mode === m.id ? ' mr-btn--active' : ''}`}
            onClick={() => handleModeChange(m.id)}
            title={m.hint}
            disabled={m.id === 'palabra' && words.length === 0}
            aria-pressed={mode === m.id}
          >
            {m.label}
            {m.id === 'palabra' && ` (${words.length})`}
          </button>
        ))}
        {mode === 'grupo' && SIZES.map(s => (
          <button
            key={s}
            className={`mr-btn mr-btn--sm${size === s ? ' mr-btn--active' : ''}`}
            onClick={() => handleSizeChange(s)}
            title={`Grupos de ${s} caracteres`}
            aria-pressed={size === s}
          >
            {s} caracteres
          </button>
        ))}
      </div>

      {mode === 'palabra' && words.length === 0 && (
        <p className="mr-slider-note">
          Todavía no hay abreviaturas que se puedan escribir con los caracteres de este mazo.
        </p>
      )}

      <div className="mr-drill">
        <div className={`mr-lamp${lamp ? ' mr-lamp--on' : ''}`} />
        <div style={{ marginTop: '18px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="mr-btn mr-btn--primary" onClick={listen} disabled={!canPlay || !drill}>
            <i className={`bi ${playing ? 'bi-soundwave' : 'bi-play-circle'}`} style={{ marginRight: '8px' }} />
            {started ? 'Repetir' : 'Empezar a escuchar'}
          </button>
          {playing && (
            <button className="mr-btn" onClick={() => { stop(); setLamp(false) }}>
              <i className="bi bi-stop-circle" style={{ marginRight: '6px' }} />
              Parar
            </button>
          )}
        </div>
        <p className="mr-drill-hint">
          {canPlay
            ? 'Escribe lo que oigas y pulsa Intro. No pasa nada por repetir el envío.'
            : 'Este navegador no trae Web Audio, así que no hay sonido que copiar.'}
        </p>
      </div>

      <input
        ref={inputRef}
        className="mr-answer"
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={!!grade}
        placeholder="· · ·"
        autoComplete="off"
        spellCheck="false"
        aria-label="Lo que has copiado"
      />

      {!grade && (
        <button
          className="mr-btn mr-btn--primary"
          style={{ width: '100%', marginTop: '14px', padding: '13px' }}
          onClick={check}
          disabled={!drill}
        >
          <i className="bi bi-check2-square" style={{ marginRight: '8px' }} />
          Comprobar (Intro)
        </button>
      )}

      {grade && drill && (
        <>
          <div className="mr-cells">
            {grade.cells.map((c, i) => (
              <div key={i} className={`mr-cell ${c.ok ? 'mr-cell--ok' : 'mr-cell--bad'}`}>
                <span className="mr-cell-char">{c.expected ?? '–'}</span>
                <span className="mr-cell-got">{!c.ok && c.got ? c.got : ''}</span>
                <span className="mr-cell-pattern">
                  {c.expected ? prettyMorse(symbolsFor(c.expected) || '') : ''}
                </span>
              </div>
            ))}
          </div>

          <div className={`mr-feedback ${grade.perfect ? 'mr-feedback--correct' : 'mr-feedback--wrong'}`} role="status" aria-live="polite">
            <i className={`bi ${grade.perfect ? 'bi-check-circle' : 'bi-x-circle'}`} style={{ marginRight: '8px' }} />
            {grade.perfect
              ? `¡Copiado entero! (${drill.text})`
              : `${grade.correct} de ${grade.total} caracteres — era «${drill.text}»`}
            {drill.meaning && ` · ${drill.meaning}`}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
            <button className="mr-btn" onClick={() => play(drill.text, { onSymbol: ({ on }) => setLamp(on), onEnd: () => setLamp(false) })} disabled={!canPlay}>
              <i className="bi bi-arrow-repeat" style={{ marginRight: '6px' }} />
              Volver a oírlo
            </button>
            <button
              className="mr-btn mr-btn--primary"
              style={{ flex: 1, padding: '13px' }}
              onClick={() => nextDrill()}
            >
              <i className="bi bi-arrow-right-circle" style={{ marginRight: '8px' }} />
              Siguiente (Intro)
            </button>
          </div>
        </>
      )}

      {puedeSubir && (
        <div className="mr-advance" role="status">
          <i className="bi bi-mortarboard" style={{ color: 'var(--accent-green)', fontSize: '1.2rem' }} />
          <span style={{ flex: 1 }}>
            Llevas más del {KOCH_TARGET}% en los últimos ejercicios: toca estrenar carácter.
          </span>
          <button className="mr-btn mr-btn--primary mr-btn--sm" onClick={() => { onAdvance(); setHistory([]) }}>
            Lección {lesson + 1}
          </button>
        </div>
      )}
    </>
  )
}

export default CopyPanel
