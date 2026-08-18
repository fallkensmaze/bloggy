import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  QCODES,
  GROUP_LABELS,
  QUIZ_MODES,
  LEVELS,
  MASTERY,
  buildQuestion,
  accuracy,
  masteryOf,
  masterySummary,
  updateProgress,
} from '../utils/qcodes'
import { morseOf, playMorse, morseSupported } from '../utils/morse'
import '../styles/qcodes.css'

const STATS_KEY    = 'qcodes_stats'
const MODE_KEY     = 'qcodes_mode'
const LEVEL_KEY    = 'qcodes_level'
const GROUP_KEY    = 'qcodes_group'
const PROGRESS_KEY = 'qcodes_progress'
const LETTERS      = ['A', 'B', 'C', 'D']
const ALL_GROUPS   = 'all'

// ── localStorage helpers ────────────────────────────────────────────────────

const EMPTY_STATS = { correct: 0, wrong: 0, hinted: 0, streak: 0, best: 0 }

function readStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY))
    if (s && typeof s.correct === 'number') return { ...EMPTY_STATS, ...s }
  } catch { /* ignore */ }
  return { ...EMPTY_STATS }
}

function readProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY))
    if (p && typeof p === 'object') return p
  } catch { /* ignore */ }
  return {}
}

function readChoice(key, valid, fallback) {
  const v = localStorage.getItem(key)
  return valid.includes(v) ? v : fallback
}

// ── Selección de mazos ──────────────────────────────────────────────────────

function poolsFor(level, group) {
  const levelPool = level === 'todos' ? QCODES : QCODES.filter(c => c.level === 'esencial')
  const pool = group === ALL_GROUPS ? levelPool : levelPool.filter(c => c.group === group)
  return { levelPool, pool: pool.length ? pool : levelPool }
}

// ── Componente ──────────────────────────────────────────────────────────────

function QCodes() {
  const [mode,  setMode]  = useState(() => readChoice(MODE_KEY, QUIZ_MODES.map(m => m.id), 'mixed'))
  const [level, setLevel] = useState(() => readChoice(LEVEL_KEY, LEVELS.map(l => l.id), 'esencial'))
  const [group, setGroup] = useState(() => readChoice(GROUP_KEY, [ALL_GROUPS, ...Object.keys(GROUP_LABELS)], ALL_GROUPS))

  const [stats, setStats]       = useState(readStats)
  const [progress, setProgress] = useState(readProgress)

  const [question, setQuestion] = useState(() => {
    const lvl = readChoice(LEVEL_KEY, LEVELS.map(l => l.id), 'esencial')
    const grp = readChoice(GROUP_KEY, [ALL_GROUPS, ...Object.keys(GROUP_LABELS)], ALL_GROUPS)
    const { levelPool, pool } = poolsFor(lvl, grp)
    return buildQuestion({
      pool,
      distractorPool: levelPool,
      mode: readChoice(MODE_KEY, QUIZ_MODES.map(m => m.id), 'mixed'),
      progress: readProgress(),
    })
  })
  const [selected, setSelected]   = useState(null)
  const [hintsUsed, setHintsUsed] = useState(0)
  const [showRef, setShowRef]     = useState(false)
  const [search, setSearch]       = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [playing, setPlaying]     = useState(null)

  const lastCodeRef  = useRef(question.entry.code)
  const answeredRef  = useRef(false)
  const progressRef  = useRef(progress)
  const hintsUsedRef = useRef(0)
  const stopAudioRef = useRef(null)

  const answered  = selected !== null
  const isCorrect = answered && selected === question.answer
  const total     = stats.correct + stats.wrong

  const { levelPool, pool } = useMemo(() => poolsFor(level, group), [level, group])
  const summary = useMemo(() => masterySummary(levelPool, progress), [levelPool, progress])

  const revealed   = useMemo(() => question.hints.slice(0, hintsUsed), [question, hintsUsed])
  const eliminated = useMemo(() => new Set(revealed.flatMap(h => h.eliminate)), [revealed])

  // ── Preguntas ──
  const newQuestion = useCallback((over = {}) => {
    const q = buildQuestion({
      pool:           over.pool ?? pool,
      distractorPool: over.distractorPool ?? levelPool,
      mode:           over.mode ?? mode,
      excludeCode:    lastCodeRef.current,
      progress:       progressRef.current,
    })
    lastCodeRef.current  = q.entry.code
    answeredRef.current  = false
    hintsUsedRef.current = 0
    setQuestion(q)
    setSelected(null)
    setHintsUsed(0)
  }, [pool, levelPool, mode])

  const handleModeChange = (m) => {
    setMode(m)
    localStorage.setItem(MODE_KEY, m)
    newQuestion({ mode: m })
  }

  const handleLevelChange = (l) => {
    setLevel(l)
    localStorage.setItem(LEVEL_KEY, l)
    const next = poolsFor(l, group)
    newQuestion({ pool: next.pool, distractorPool: next.levelPool })
  }

  const handleGroupChange = (g) => {
    setGroup(g)
    localStorage.setItem(GROUP_KEY, g)
    const next = poolsFor(level, g)
    newQuestion({ pool: next.pool, distractorPool: next.levelPool })
  }

  // ── Responder ──
  const handleSelect = useCallback((opt) => {
    if (opt == null || answeredRef.current) return
    if (eliminated.has(opt)) return
    answeredRef.current = true
    setSelected(opt)

    const ok     = opt === question.answer
    const hinted = hintsUsedRef.current > 0

    setProgress(p => {
      const next = updateProgress(p, question.entry.code, ok, hinted)
      progressRef.current = next
      return next
    })
    setStats(s => {
      // Una pista no rompe la racha, pero tampoco la hace crecer.
      const streak = ok ? (hinted ? s.streak : s.streak + 1) : 0
      return {
        correct: s.correct + (ok ? 1 : 0),
        wrong:   s.wrong + (ok ? 0 : 1),
        hinted:  s.hinted + (ok && hinted ? 1 : 0),
        streak,
        best:    Math.max(s.best, streak),
      }
    })
  }, [question, eliminated])

  const handleHint = useCallback(() => {
    if (answeredRef.current) return
    setHintsUsed(n => {
      const next = Math.min(n + 1, question.hints.length)
      hintsUsedRef.current = next
      return next
    })
  }, [question])

  const handleResetStats = () => {
    setStats({ ...EMPTY_STATS })
    setProgress({})
    progressRef.current = {}
    setConfirmReset(false)
  }

  // ── Audio CW ──
  const handlePlay = useCallback((code) => {
    if (stopAudioRef.current) stopAudioRef.current()
    setPlaying(code)
    stopAudioRef.current = playMorse(code, {
      onEnd: () => { setPlaying(null); stopAudioRef.current = null },
    })
  }, [])

  useEffect(() => () => { if (stopAudioRef.current) stopAudioRef.current() }, [])

  // ── Persistencia ──
  useEffect(() => { localStorage.setItem(STATS_KEY, JSON.stringify(stats)) }, [stats])
  useEffect(() => { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)) }, [progress])

  // ── Atajos de teclado ──
  // 1-4 / A-D responden · H pide pista · Enter o Espacio pasa a la siguiente
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (!answered) {
        if (e.key.toLowerCase() === 'h') { handleHint(); return }
        const num = parseInt(e.key, 10)
        if (num >= 1 && num <= 4) handleSelect(question.options[num - 1])
        const li = LETTERS.indexOf(e.key.toUpperCase())
        if (li >= 0) handleSelect(question.options[li])
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        newQuestion()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answered, question, handleSelect, handleHint, newQuestion])

  const optionClass = (opt) => {
    if (!answered) return eliminated.has(opt) ? 'qc-option qc-option--out' : 'qc-option'
    if (opt === question.answer) return 'qc-option qc-option--correct'
    if (opt === selected)        return 'qc-option qc-option--wrong'
    return 'qc-option qc-option--dim'
  }

  const { entry } = question
  const hintsLeft = question.hints.length - hintsUsed
  const canPlay   = morseSupported()

  const refList = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return QCODES
    return QCODES.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.meaning.toLowerCase().includes(q) ||
      c.question.toLowerCase().includes(q) ||
      c.example.toLowerCase().includes(q))
  }, [search])

  const masteryDot = (code) => {
    const m = masteryOf(code, progress)
    return <span className="qc-dot" style={{ background: MASTERY[m].color }} title={MASTERY[m].label} />
  }

  const morseBtn = (code) => canPlay && (
    <button
      className={`qc-morse-btn${playing === code ? ' qc-morse-btn--on' : ''}`}
      onClick={() => handlePlay(code)}
      title={`Escuchar ${code} en CW · ${morseOf(code)}`}
      aria-label={`Escuchar ${code} en Morse`}
    >
      <i className="bi bi-volume-up" />
    </button>
  )

  return (
    <div className="page-body" style={{ maxWidth: '860px' }}>
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-broadcast"></i></div>
        <h1 className="page-title">Códigos Q</h1>
        <p className="page-subtitle">
          Entrena los códigos Q de radioaficionado · pistas, repaso adaptativo y escucha en CW
        </p>
      </div>

      {/* ── Estadísticas ── */}
      <div className="calc-card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <span className="field-label" style={{ marginBottom: 0 }}>Tu progreso</span>
          {confirmReset ? (
            <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>¿Borrar marcador y repaso?</span>
              <button className="qc-btn" style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }} onClick={handleResetStats}>Sí</button>
              <button className="qc-btn" onClick={() => setConfirmReset(false)}>No</button>
            </span>
          ) : (
            <button className="qc-btn" onClick={() => setConfirmReset(true)} disabled={total === 0}>
              <i className="bi bi-arrow-counterclockwise" style={{ marginRight: '6px' }} />
              Reiniciar
            </button>
          )}
        </div>

        <div className="qc-stats-grid">
          <div className="qc-stat">
            <span className="qc-stat-value qc-stat-value--green">{stats.correct}</span>
            <span className="qc-stat-label">Aciertos{stats.hinted > 0 ? ` (${stats.hinted} con pista)` : ''}</span>
          </div>
          <div className="qc-stat">
            <span className="qc-stat-value qc-stat-value--red">{stats.wrong}</span>
            <span className="qc-stat-label">Fallos</span>
          </div>
          <div className="qc-stat">
            <span className="qc-stat-value qc-stat-value--blue">{accuracy(stats)}%</span>
            <span className="qc-stat-label">Precisión</span>
          </div>
          <div className="qc-stat">
            <span className="qc-stat-value qc-stat-value--orange">{stats.streak}</span>
            <span className="qc-stat-label">Racha (máx. {stats.best})</span>
          </div>
        </div>

        {/* Dominio del mazo activo */}
        <div className="qc-mastery">
          <div className="qc-mastery-head">
            <span>Dominio del mazo · {summary.dominado} de {summary.total} códigos</span>
            <span className="qc-mastery-legend">
              {['dominado', 'progreso', 'flojo', 'nuevo'].map(k => (
                <span key={k}>
                  <span className="qc-dot" style={{ background: MASTERY[k].color }} />
                  {MASTERY[k].label} {summary[k]}
                </span>
              ))}
            </span>
          </div>
          <div className="qc-bar">
            {['dominado', 'progreso', 'flojo'].map(k => (
              summary[k] > 0 && (
                <span
                  key={k}
                  className="qc-bar-seg"
                  style={{ width: `${(summary[k] / summary.total) * 100}%`, background: MASTERY[k].color }}
                />
              )
            ))}
          </div>
        </div>
      </div>

      {/* ── Ajustes de la sesión ── */}
      <div className="calc-card" style={{ marginBottom: '16px' }}>
        <span className="field-label" style={{ display: 'block', marginBottom: '10px' }}>Modo de pregunta</span>
        <div className="qc-chips">
          {QUIZ_MODES.map(m => (
            <button
              key={m.id}
              className={`qc-btn${mode === m.id ? ' qc-btn--active' : ''}`}
              onClick={() => handleModeChange(m.id)}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>

        <span className="field-label" style={{ display: 'block', margin: '18px 0 10px' }}>Mazo</span>
        <div className="qc-chips">
          {LEVELS.map(l => {
            const n = l.id === 'todos' ? QCODES.length : QCODES.filter(c => c.level === 'esencial').length
            return (
              <button
                key={l.id}
                className={`qc-btn${level === l.id ? ' qc-btn--active' : ''}`}
                onClick={() => handleLevelChange(l.id)}
                title={l.hint}
              >
                {l.label} ({n})
              </button>
            )
          })}
        </div>

        <span className="field-label" style={{ display: 'block', margin: '18px 0 10px' }}>Tema</span>
        <div className="qc-chips">
          <button
            className={`qc-btn qc-btn--sm${group === ALL_GROUPS ? ' qc-btn--active' : ''}`}
            onClick={() => handleGroupChange(ALL_GROUPS)}
          >
            Todos
          </button>
          {Object.entries(GROUP_LABELS).map(([g, label]) => {
            const n = levelPool.filter(c => c.group === g).length
            if (n === 0) return null
            return (
              <button
                key={g}
                className={`qc-btn qc-btn--sm${group === g ? ' qc-btn--active' : ''}`}
                onClick={() => handleGroupChange(g)}
              >
                {label} ({n})
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Pregunta ── */}
      <div className="calc-card" style={{ marginBottom: '16px' }}>
        <div className="qc-question-head">
          <span className="field-label" style={{ marginBottom: 0 }}>
            Pregunta · teclas 1-4 para responder, H para una pista
          </span>
          <span className="qc-mastery-tag" style={{ color: MASTERY[masteryOf(entry.code, progress)].color }}>
            {masteryDot(entry.code)}
            {MASTERY[masteryOf(entry.code, progress)].label}
          </span>
        </div>

        <p className="qc-prompt">{question.prompt}</p>
        {question.sentence && <p className="qc-sentence">{question.sentence}</p>}

        <div className="qc-options">
          {question.options.map((opt, i) => (
            <button
              key={opt}
              className={optionClass(opt)}
              disabled={answered || eliminated.has(opt)}
              onClick={() => handleSelect(opt)}
            >
              <span className="qc-option-letter">{LETTERS[i]}</span>
              <span className="qc-option-text">{opt}</span>
              {answered && opt === question.answer && (
                <i className="bi bi-check-lg qc-option-icon" />
              )}
              {answered && opt === selected && opt !== question.answer && (
                <i className="bi bi-x-lg qc-option-icon" />
              )}
            </button>
          ))}
        </div>

        {/* ── Pistas ── */}
        {!answered && (
          <div className="qc-hints">
            <button className="qc-btn qc-btn--hint" onClick={handleHint} disabled={hintsLeft === 0}>
              <i className="bi bi-life-preserver" style={{ marginRight: '6px' }} />
              {hintsLeft === 0
                ? 'No quedan pistas'
                : `Pista ${hintsUsed + 1} de ${question.hints.length} · ${question.hints[hintsUsed].label} (H)`}
            </button>
            {hintsUsed > 0 && (
              <span className="qc-hints-note">Con pista el acierto cuenta, pero la racha se queda como está.</span>
            )}
            {revealed.map(h => (
              <div key={h.id} className="qc-hint">
                <i className={`bi ${h.icon} qc-hint-icon`} />
                <div>
                  <span className="qc-info-label">{h.label}</span>
                  {h.text}
                </div>
              </div>
            ))}
          </div>
        )}

        {answered && (
          <>
            <div className={`qc-feedback ${isCorrect ? 'qc-feedback--correct' : 'qc-feedback--wrong'}`}>
              {isCorrect ? (
                <>
                  <i className="bi bi-check-circle" style={{ marginRight: '8px' }} />
                  ¡Correcto!{hintsUsed > 0 ? ' (con pista)' : ''}
                </>
              ) : (
                <><i className="bi bi-x-circle" style={{ marginRight: '8px' }} />Incorrecto — la respuesta era «{question.answer}»</>
              )}
            </div>

            {/* Explicación: significado, ejemplo de uso y mnemotecnia */}
            <div className="qc-info">
              <div className="qc-info-row">
                <i className="bi bi-book qc-info-icon" />
                <div>
                  <span className="qc-info-label">Significado</span>
                  <span className="qc-code-chip">{entry.code}</span>{' '}
                  {morseBtn(entry.code)}{' '}
                  <span className="qc-morse-dots">{morseOf(entry.code)}</span>
                  <br />
                  {entry.meaning}. Como pregunta («{entry.code}?»): <em>{entry.question}</em>
                </div>
              </div>
              <div className="qc-info-row">
                <i className="bi bi-chat-square-quote qc-info-icon" />
                <div>
                  <span className="qc-info-label">Ejemplo de uso</span>
                  {entry.example}
                </div>
              </div>
              <div className="qc-info-row">
                <i className="bi bi-lightbulb qc-info-icon" />
                <div>
                  <span className="qc-info-label">Mnemotecnia</span>
                  {entry.mnemonic}
                </div>
              </div>
            </div>

            <button
              className="qc-btn qc-btn--primary"
              style={{ width: '100%', marginTop: '16px', padding: '13px' }}
              onClick={() => newQuestion()}
            >
              <i className="bi bi-arrow-right-circle" style={{ marginRight: '8px' }} />
              Siguiente pregunta (Enter)
            </button>
          </>
        )}
      </div>

      {/* ── Lista de referencia ── */}
      <div className="calc-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span className="field-label" style={{ marginBottom: 0 }}>
            Lista de estudio · {QCODES.length} códigos
          </span>
          <button className="qc-btn" onClick={() => setShowRef(v => !v)}>
            <i className={`bi bi-chevron-${showRef ? 'up' : 'down'}`} style={{ marginRight: '6px' }} />
            {showRef ? 'Ocultar' : 'Ver lista'}
          </button>
        </div>

        {showRef && (
          <div style={{ marginTop: '18px' }}>
            <input
              className="qc-search"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por código, significado o ejemplo…"
            />

            {refList.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '13.5px', marginTop: '14px' }}>
                Ningún código coincide con «{search}».
              </p>
            )}

            {Object.entries(GROUP_LABELS).map(([g, label]) => {
              const entries = refList.filter(c => c.group === g)
              if (entries.length === 0) return null
              return (
                <div key={g} className="qc-ref-group">
                  <div className="qc-ref-group-title">{label}</div>
                  {entries.map(c => (
                    <div key={c.code} className="qc-ref-entry">
                      <div className="qc-ref-head">
                        {masteryDot(c.code)}
                        <span className="qc-code-chip">{c.code}</span>
                        {morseBtn(c.code)}
                        <span className="qc-ref-meaning">{c.meaning}</span>
                        {c.level === 'ampliado' && <span className="qc-ref-level">ampliado</span>}
                        <span className="qc-ref-question">«{c.code}?» = {c.question}</span>
                      </div>
                      <p className="qc-ref-detail"><i className="bi bi-chat-square-quote" />{c.example}</p>
                      <p className="qc-ref-mnemonic"><i className="bi bi-lightbulb" />{c.mnemonic}</p>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default QCodes
