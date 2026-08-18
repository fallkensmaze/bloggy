import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { prettyMorse, rhythmOf, reverseOf, oppositeOf } from '../../utils/morse'
import { buildVisualQuestion, VISUAL_MODES } from '../../utils/morseTrainer'
import { MASTERY, masteryOf } from '../../utils/leitner'
import { readChoice, writeValue } from '../../utils/localSettings'

const LETTERS  = ['A', 'B', 'C', 'D']
const MODE_KEY = 'morse_visual_mode'

/**
 * Quiz de opción múltiple sobre la tabla, en los dos sentidos, con la misma
 * escalera de pistas que el de códigos Q. Memoriza rápido, pero no sustituye al
 * copiado al oído: para eso está la primera pestaña.
 */
function VisualPanel({ pool, progress, progressRef, play, recordChars, canPlay }) {
  const [mode, setMode] = useState(() => readChoice(MODE_KEY, VISUAL_MODES.map(m => m.id), 'mixed'))
  const [question, setQuestion]   = useState(null)
  const [selected, setSelected]   = useState(null)
  const [hintsUsed, setHintsUsed] = useState(0)

  const lastCharRef  = useRef(null)
  const answeredRef  = useRef(false)
  const hintsUsedRef = useRef(0)

  const newQuestion = useCallback((over = {}) => {
    const q = buildVisualQuestion({
      pool: over.pool ?? pool,
      mode: over.mode ?? mode,
      excludeChar: lastCharRef.current,
      progress: progressRef.current,
    })
    lastCharRef.current  = q.entry.char
    answeredRef.current  = false
    hintsUsedRef.current = 0
    setQuestion(q)
    setSelected(null)
    setHintsUsed(0)
  }, [pool, mode, progressRef])

  useEffect(() => { newQuestion() }, [newQuestion])

  const answered  = selected !== null
  const isCorrect = answered && question && selected === question.answer

  const revealed   = useMemo(() => (question ? question.hints.slice(0, hintsUsed) : []), [question, hintsUsed])
  const eliminated = useMemo(() => new Set(revealed.flatMap(h => h.eliminate)), [revealed])

  const handleSelect = useCallback((opt) => {
    if (opt == null || answeredRef.current || !question) return
    if (eliminated.has(opt)) return
    answeredRef.current = true
    setSelected(opt)
    const ok = opt === question.answer
    recordChars([{ char: question.entry.char, ok, hinted: hintsUsedRef.current > 0 }])
    if (ok && canPlay) play(question.entry.char)
  }, [question, eliminated, recordChars, play, canPlay])

  const handleHint = useCallback(() => {
    if (answeredRef.current || !question) return
    setHintsUsed(n => {
      const next = Math.min(n + 1, question.hints.length)
      hintsUsedRef.current = next
      return next
    })
  }, [question])

  const handleModeChange = (m) => {
    setMode(m)
    writeValue(MODE_KEY, m)
  }

  // 1-4 o A-D responden · H pide pista · Intro o espacio pasan de pregunta
  useEffect(() => {
    if (!question) return
    const onKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (!answered) {
        if (e.key.toLowerCase() === 'h') { handleHint(); return }
        const num = parseInt(e.key, 10)
        if (num >= 1 && num <= question.options.length) handleSelect(question.options[num - 1])
        const li = LETTERS.indexOf(e.key.toUpperCase())
        if (li >= 0 && li < question.options.length) handleSelect(question.options[li])
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        newQuestion()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answered, question, handleSelect, handleHint, newQuestion])

  if (!question) return null

  const { entry } = question
  const hintsLeft = question.hints.length - hintsUsed
  const esPatron  = question.mode === 'char2morse'
  const espejo    = reverseOf(entry.char)
  const inverso   = oppositeOf(entry.char)

  const optionClass = (opt) => {
    if (!answered) return eliminated.has(opt) ? 'mr-option mr-option--out' : 'mr-option'
    if (opt === question.answer) return 'mr-option mr-option--correct'
    if (opt === selected)        return 'mr-option mr-option--wrong'
    return 'mr-option mr-option--dim'
  }

  return (
    <>
      <span className="field-label">Sentido de la pregunta</span>
      <div className="mr-chips">
        {VISUAL_MODES.map(m => (
          <button
            key={m.id}
            className={`mr-btn mr-btn--sm${mode === m.id ? ' mr-btn--active' : ''}`}
            onClick={() => handleModeChange(m.id)}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mr-question-head" style={{ marginTop: '20px' }}>
        <span className="field-label" style={{ marginBottom: 0 }}>
          Teclas 1-{question.options.length} para responder, H para una pista
        </span>
        <span className="mr-mastery-tag" style={{ color: MASTERY[masteryOf(entry.char, progress)].color }}>
          <span className="mr-dot" style={{ background: MASTERY[masteryOf(entry.char, progress)].color }} />
          {MASTERY[masteryOf(entry.char, progress)].label}
        </span>
      </div>

      <p className="mr-prompt">{question.prompt}</p>

      <div className="mr-stage">
        {esPatron
          ? <span className="mr-stage-char">{entry.char}</span>
          : <span className="mr-pattern mr-pattern--lg">{prettyMorse(entry.morse)}</span>}
      </div>

      <div className="mr-options">
        {question.options.map((opt, i) => (
          <button
            key={opt}
            className={optionClass(opt)}
            disabled={answered || eliminated.has(opt)}
            onClick={() => handleSelect(opt)}
          >
            <span className="mr-option-letter">{LETTERS[i]}</span>
            <span className="mr-option-text">{esPatron ? prettyMorse(opt) : opt}</span>
            {answered && opt === question.answer && <i className="bi bi-check-lg mr-option-icon" />}
            {answered && opt === selected && opt !== question.answer && <i className="bi bi-x-lg mr-option-icon" />}
          </button>
        ))}
      </div>

      {!answered && (
        <div className="mr-hints">
          <button className="mr-btn mr-btn--hint" onClick={handleHint} disabled={hintsLeft === 0}>
            <i className="bi bi-life-preserver" style={{ marginRight: '6px' }} />
            {hintsLeft === 0
              ? 'No quedan pistas'
              : `Pista ${hintsUsed + 1} de ${question.hints.length} · ${question.hints[hintsUsed].label} (H)`}
          </button>
          {hintsUsed > 0 && (
            <span className="mr-hints-note">Con pista el acierto cuenta, pero la racha se queda como está.</span>
          )}
          {revealed.map(h => (
            <div key={h.id} className="mr-hint">
              <i className={`bi ${h.icon} mr-hint-icon`} />
              <div>
                <span className="mr-info-label">{h.label}</span>
                {h.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {answered && (
        <>
          <div className={`mr-feedback ${isCorrect ? 'mr-feedback--correct' : 'mr-feedback--wrong'}`} style={{ marginTop: '16px' }}>
            <i className={`bi ${isCorrect ? 'bi-check-circle' : 'bi-x-circle'}`} style={{ marginRight: '8px' }} />
            {isCorrect
              ? `¡Correcto!${hintsUsed > 0 ? ' (con pista)' : ''}`
              : `Incorrecto — era «${esPatron ? prettyMorse(question.answer) : question.answer}»`}
          </div>

          <div className="mr-info">
            <div className="mr-info-row">
              <i className="bi bi-soundwave mr-info-icon" />
              <div>
                <span className="mr-info-label">El carácter</span>
                <span className="mr-char-chip">{entry.char}</span>{' '}
                <span className="mr-pattern">{prettyMorse(entry.morse)}</span>{' '}
                {canPlay && (
                  <button className="mr-play-btn" onClick={() => play(entry.char)} aria-label={`Escuchar ${entry.char}`}>
                    <i className="bi bi-volume-up" />
                  </button>
                )}
                <br />
                <span className="mr-rhythm">Suena «{rhythmOf(entry.morse)}»</span>
              </div>
            </div>
            {(espejo || inverso) && (
              <div className="mr-info-row">
                <i className="bi bi-arrow-left-right mr-info-icon" />
                <div>
                  <span className="mr-info-label">Con qué se confunde</span>
                  {espejo && <>Leído del revés sale «{espejo}» ({prettyMorse(entry.morse.split('').reverse().join(''))}). </>}
                  {inverso && <>Cambiando puntos por rayas sale «{inverso}».</>}
                </div>
              </div>
            )}
          </div>

          <button
            className="mr-btn mr-btn--primary"
            style={{ width: '100%', marginTop: '16px', padding: '13px' }}
            onClick={() => newQuestion()}
          >
            <i className="bi bi-arrow-right-circle" style={{ marginRight: '8px' }} />
            Siguiente pregunta (Intro)
          </button>
        </>
      )}
    </>
  )
}

export default VisualPanel
