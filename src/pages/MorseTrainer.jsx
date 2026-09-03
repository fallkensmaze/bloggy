import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { playMorse, morseSupported, resumeAudio } from '../utils/morse'
import {
  DECKS,
  LCWO_DEFAULTS,
  MAX_LESSON,
  MIN_LESSON,
  charMasterySummary,
  deckEntries,
  kochChars,
  newestKochChar,
} from '../utils/morseTrainer'
import { MASTERY, accuracy, updateProgress } from '../utils/leitner'
import { readChoice, readJson, readNumber, writeValue } from '../utils/localSettings'
import LearnPanel from '../components/morse/LearnPanel'
import CopyPanel from '../components/morse/CopyPanel'
import KeyPanel from '../components/morse/KeyPanel'
import VisualPanel from '../components/morse/VisualPanel'
import ReferencePanel from '../components/morse/ReferencePanel'
import '../styles/morse.css'

const STATS_KEY    = 'morse_stats'
const PROGRESS_KEY = 'morse_progress'
const DECK_KEY     = 'morse_deck'
const LESSON_KEY   = 'morse_lesson'
const CHARWPM_KEY  = 'morse_charwpm'
const EFFWPM_KEY   = 'morse_effwpm'
const FREQ_KEY     = 'morse_freq'
const TAB_KEY      = 'morse_tab'
const MODE_KEY     = 'morse_mode'
const COURSE_VERSION_KEY = 'morse_course_version'
const COURSE_VERSION = 'lcwo-1'

const TABS = [
  { id: 'copiar',      label: 'Copiar al oído', icon: 'bi-ear' },
  { id: 'manipular',   label: 'Manipular',      icon: 'bi-broadcast' },
  { id: 'visual',      label: 'Ver el patrón',  icon: 'bi-eye' },
  { id: 'referencia',  label: 'Tabla y traductor', icon: 'bi-table' },
]

const MODES = [
  { id: 'curso',    label: 'Curso LCWO',   icon: 'bi-compass',   hint: 'Koch + Farnsworth, lección a lección' },
  { id: 'avanzado', label: 'Avanzado',     icon: 'bi-sliders',   hint: 'Prácticas sueltas, manipulador, tabla y todos los ajustes' },
]

const EMPTY_STATS = { correct: 0, wrong: 0, hinted: 0, streak: 0, best: 0 }

/**
 * Entrenador de código Morse. La página lleva los ajustes comunes (mazo,
 * velocidades, tono), el marcador, el progreso de Leitner y un único
 * reproductor de audio; cada pestaña pone su ejercicio.
 */
function MorseTrainer() {
  const [modo, setModo]     = useState(() => readChoice(MODE_KEY, MODES.map(m => m.id), 'curso'))
  const [tab, setTab]       = useState(() => readChoice(TAB_KEY, TABS.map(t => t.id), 'copiar'))
  const [deck, setDeck]     = useState(() => readChoice(DECK_KEY, DECKS.map(d => d.id), 'koch'))
  const [lesson, setLesson] = useState(() => {
    // La secuencia anterior no era la de LCWO y sólo tenía 39 lecciones. No se
    // puede trasladar una lección antigua sin mezclar caracteres no aprendidos.
    if (readChoice(COURSE_VERSION_KEY, [COURSE_VERSION], null) !== COURSE_VERSION) {
      writeValue(COURSE_VERSION_KEY, COURSE_VERSION)
      writeValue(LESSON_KEY, MIN_LESSON)
      return MIN_LESSON
    }
    return readNumber(LESSON_KEY, { min: MIN_LESSON, max: MAX_LESSON, fallback: MIN_LESSON })
  })

  const [charWpm, setCharWpm] = useState(() => readNumber(CHARWPM_KEY, { min: 5,   max: 40,   fallback: LCWO_DEFAULTS.charWpm }))
  const [effWpm, setEffWpm]   = useState(() => readNumber(EFFWPM_KEY,  { min: 4,   max: 40,   fallback: LCWO_DEFAULTS.effWpm }))
  const [freq, setFreq]       = useState(() => readNumber(FREQ_KEY,    { min: 300, max: 1000, fallback: LCWO_DEFAULTS.tone }))

  const [stats, setStats]       = useState(() => ({ ...EMPTY_STATS, ...readJson(STATS_KEY, {}) }))
  const [progress, setProgress] = useState(() => readJson(PROGRESS_KEY, {}))
  const [playing, setPlaying]   = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const progressRef = useRef(progress)
  const stopRef     = useRef(null)

  const canPlay = morseSupported()
  const pool    = useMemo(() => deckEntries(deck, lesson), [deck, lesson])
  const summary = useMemo(() => charMasterySummary(pool, progress), [pool, progress])
  const total   = stats.correct + stats.wrong

  // La velocidad efectiva nunca supera a la de carácter: por encima, Farnsworth
  // no tiene nada que estirar.
  const efectiva = Math.min(effWpm, charWpm)

  // ── Audio ──
  const stop = useCallback(() => {
    if (stopRef.current) stopRef.current()
    stopRef.current = null
    setPlaying(false)
  }, [])

  const play = useCallback((text, {
    onSymbol,
    onEnd,
    startDelay = 0,
    extraWordGap = 0,
  } = {}) => {
    if (stopRef.current) stopRef.current()
    resumeAudio()
    setPlaying(true)
    stopRef.current = playMorse(text, {
      wpm: charWpm,
      effWpm: efectiva,
      freq,
      startDelay,
      extraWordGap,
      onSymbol,
      onEnd: () => {
        stopRef.current = null
        setPlaying(false)
        if (onEnd) onEnd()
      },
    })
  }, [charWpm, efectiva, freq])

  useEffect(() => () => { if (stopRef.current) stopRef.current() }, [])

  const handleModo = (id) => {
    stop()
    setModo(id)
    writeValue(MODE_KEY, id)
  }

  // Cambiar de pestaña corta lo que estuviera sonando.
  const handleTab = (id) => {
    stop()
    setTab(id)
    writeValue(TAB_KEY, id)
  }

  // ── Marcador y repaso ──
  const recordChars = useCallback((results) => {
    if (!results || results.length === 0) return
    setProgress(prev => {
      let next = prev
      for (const r of results) next = updateProgress(next, r.char, r.ok, r.hinted)
      progressRef.current = next
      return next
    })
    setStats(s => {
      let { correct, wrong, hinted, streak, best } = s
      for (const r of results) {
        if (r.ok) {
          correct++
          if (r.hinted) hinted++
          // Una pista no rompe la racha, pero tampoco la hace crecer.
          if (!r.hinted) streak++
        } else {
          wrong++
          streak = 0
        }
        best = Math.max(best, streak)
      }
      return { correct, wrong, hinted, streak, best }
    })
  }, [])

  const resetAll = () => {
    setStats({ ...EMPTY_STATS })
    setProgress({})
    progressRef.current = {}
    setConfirmReset(false)
  }

  // ── Ajustes ──
  const handleDeck = (id) => {
    stop()
    setDeck(id)
    writeValue(DECK_KEY, id)
  }

  const handleLesson = (n) => {
    const next = Math.min(Math.max(n, MIN_LESSON), MAX_LESSON)
    stop()
    setLesson(next)
    writeValue(LESSON_KEY, next)
  }

  const handleCharWpm = (n) => { setCharWpm(n); writeValue(CHARWPM_KEY, n) }
  const handleEffWpm  = (n) => { setEffWpm(n);  writeValue(EFFWPM_KEY, n) }
  const handleFreq    = (n) => { setFreq(n);    writeValue(FREQ_KEY, n) }

  // ── Persistencia ──
  useEffect(() => { writeValue(STATS_KEY, stats) }, [stats])
  useEffect(() => { writeValue(PROGRESS_KEY, progress) }, [progress])

  const nuevo = deck === 'koch' ? newestKochChar(lesson) : null
  const panelProps = { pool, progress, progressRef, play, stop, playing, recordChars, canPlay }

  return (
    <div className="page-body" style={{ maxWidth: '880px' }}>
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-soundwave"></i></div>
        <h1 className="page-title">Código Morse</h1>
        <p className="page-subtitle">
          Aprender telegrafía desde cero, al oído y sin contar puntos: curso
          LCWO con Koch y Farnsworth, manipulador, repaso adaptativo y tabla completa
        </p>
      </div>

      {/* ── Curso o práctica suelta ── */}
      <div className="mr-mode">
        {MODES.map(m => (
          <button
            key={m.id}
            className={`mr-btn${modo === m.id ? ' mr-btn--active' : ''}`}
            onClick={() => handleModo(m.id)}
            title={m.hint}
          >
            <i className={`bi ${m.icon}`} style={{ marginRight: '8px' }} />
            {m.label}
          </button>
        ))}
      </div>

      {/* ── Marcador ── */}
      <div className="calc-card mr-card">
        <div className="mr-row-between" style={{ marginBottom: '14px' }}>
          <span className="field-label" style={{ marginBottom: 0 }}>Tu progreso</span>
          {confirmReset ? (
            <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>¿Borrar marcador y repaso?</span>
              <button className="mr-btn mr-btn--sm mr-btn--danger" onClick={resetAll}>Sí</button>
              <button className="mr-btn mr-btn--sm" onClick={() => setConfirmReset(false)}>No</button>
            </span>
          ) : (
            <button className="mr-btn mr-btn--sm" onClick={() => setConfirmReset(true)} disabled={total === 0}>
              <i className="bi bi-arrow-counterclockwise" style={{ marginRight: '6px' }} />
              Reiniciar
            </button>
          )}
        </div>

        <div className="mr-stats-grid">
          <div className="mr-stat">
            <span className="mr-stat-value mr-stat-value--green">{stats.correct}</span>
            <span className="mr-stat-label">Aciertos{stats.hinted > 0 ? ` (${stats.hinted} con pista)` : ''}</span>
          </div>
          <div className="mr-stat">
            <span className="mr-stat-value mr-stat-value--red">{stats.wrong}</span>
            <span className="mr-stat-label">Fallos</span>
          </div>
          <div className="mr-stat">
            <span className="mr-stat-value mr-stat-value--blue">{accuracy(stats)}%</span>
            <span className="mr-stat-label">Precisión</span>
          </div>
          <div className="mr-stat">
            <span className="mr-stat-value mr-stat-value--orange">{stats.streak}</span>
            <span className="mr-stat-label">Racha (máx. {stats.best})</span>
          </div>
        </div>

        <div className="mr-mastery">
          <div className="mr-mastery-head">
            <span>Dominio del mazo · {summary.dominado} de {summary.total} caracteres</span>
            <span className="mr-mastery-legend">
              {['dominado', 'progreso', 'flojo', 'nuevo'].map(k => (
                <span key={k}>
                  <span className="mr-dot" style={{ background: MASTERY[k].color }} />
                  {MASTERY[k].label} {summary[k]}
                </span>
              ))}
            </span>
          </div>
          <div className="mr-bar">
            {['dominado', 'progreso', 'flojo'].map(k => summary[k] > 0 && (
              <span
                key={k}
                className="mr-bar-seg"
                style={{ width: `${(summary[k] / summary.total) * 100}%`, background: MASTERY[k].color }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Ajustes: sólo en modo avanzado, para no recibir a nadie con una
           pared de deslizadores el primer día ── */}
      {modo === 'avanzado' && (
        <div className="calc-card mr-card">
          <span className="field-label">Mazo</span>
          <div className="mr-chips">
            {DECKS.map(d => (
              <button
                key={d.id}
                className={`mr-btn mr-btn--sm${deck === d.id ? ' mr-btn--active' : ''}`}
                onClick={() => handleDeck(d.id)}
                title={d.hint}
              >
                {d.label} ({deckEntries(d.id, lesson).length})
              </button>
            ))}
          </div>

          {deck === 'koch' && (
            <>
              <div className="mr-lesson">
                <button className="mr-btn mr-btn--sm" onClick={() => handleLesson(lesson - 1)} disabled={lesson <= MIN_LESSON}>
                  <i className="bi bi-dash-lg" />
                </button>
                <span style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>
                  Lección {lesson} de {MAX_LESSON}
                </span>
                <button className="mr-btn mr-btn--sm" onClick={() => handleLesson(lesson + 1)} disabled={lesson >= MAX_LESSON}>
                  <i className="bi bi-plus-lg" />
                </button>
                <span className="mr-lesson-chars">
                  {kochChars(lesson).map(c => (
                    <span key={c} className={c === nuevo ? 'mr-new-char' : undefined}>{c}</span>
                  ))}
                </span>
              </div>
              <p className="mr-slider-note">
                Orden de LCWO: se empieza con K y M, y se añade un carácter
                cuando se copia al menos el 90 %{nuevo ? ` · el nuevo de esta lección es «${nuevo}»` : ''}.
              </p>
            </>
          )}

          <div className="mr-sliders">
            <div>
              <div className="mr-slider-head">
                <span>Velocidad de carácter</span>
                <span className="mr-slider-value">{charWpm} PPM</span>
              </div>
              <input
                className="mr-slider"
                type="range" min="5" max="40" step="1"
                value={charWpm}
                onChange={e => handleCharWpm(Number(e.target.value))}
              />
              <p className="mr-slider-note">A qué ritmo suena cada carácter por dentro. Conviene no bajar de 18.</p>
            </div>

            <div>
              <div className="mr-slider-head">
                <span>Velocidad efectiva</span>
                <span className="mr-slider-value">{efectiva} PPM</span>
              </div>
              <input
                className="mr-slider"
                type="range" min="4" max={charWpm} step="1"
                value={efectiva}
                onChange={e => handleEffWpm(Number(e.target.value))}
              />
              <p className="mr-slider-note">
                {efectiva < charWpm
                  ? 'Farnsworth: mismos caracteres, más silencio entre ellos para poder pensar.'
                  : 'Al igualar las dos velocidades desaparece el respiro de Farnsworth.'}
              </p>
            </div>

            <div>
              <div className="mr-slider-head">
                <span>Tono</span>
                <span className="mr-slider-value">{freq} Hz</span>
              </div>
              <input
                className="mr-slider"
                type="range" min="300" max="1000" step="10"
                value={freq}
                onChange={e => handleFreq(Number(e.target.value))}
              />
              <button className="mr-btn mr-btn--sm" style={{ marginTop: '6px' }} onClick={() => play('V')} disabled={!canPlay}>
                <i className="bi bi-volume-up" style={{ marginRight: '6px' }} />
                Probar el tono
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Curso guiado ── */}
      {modo === 'curso' && (
        <div className="calc-card">
          <LearnPanel
            {...panelProps}
            deck={deck}
            lesson={lesson}
            charWpm={charWpm}
            effWpm={efectiva}
            freq={freq}
            onCharWpmChange={handleCharWpm}
            onEffWpmChange={handleEffWpm}
            onFreqChange={handleFreq}
            onAdvance={() => handleLesson(lesson + 1)}
            onLessonChange={handleLesson}
            onUseKoch={() => handleDeck('koch')}
          />
        </div>
      )}

      {/* ── Práctica suelta ── */}
      {modo === 'avanzado' && (
        <div className="calc-card">
          <div className="mr-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`mr-tab${tab === t.id ? ' mr-tab--active' : ''}`}
                onClick={() => handleTab(t.id)}
              >
                <i className={`bi ${t.icon}`} style={{ marginRight: '7px' }} />
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'copiar' && (
            <CopyPanel
              {...panelProps}
              deck={deck}
              lesson={lesson}
              onAdvance={() => handleLesson(lesson + 1)}
            />
          )}
          {tab === 'manipular'  && <KeyPanel {...panelProps} charWpm={charWpm} freq={freq} />}
          {tab === 'visual'     && <VisualPanel {...panelProps} />}
          {tab === 'referencia' && <ReferencePanel {...panelProps} />}
        </div>
      )}

    </div>
  )
}

export default MorseTrainer
