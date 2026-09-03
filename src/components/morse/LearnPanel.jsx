import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildKochSession,
  charsToIntroduce,
  gradeKochSession,
  kochChars,
  LCWO_DEFAULTS,
  KOCH_TARGET,
  MAX_LESSON,
  MIN_LESSON,
} from '../../utils/morseTrainer'
import { readChoice, readJson, readNumber, writeValue } from '../../utils/localSettings'

const INTRO_KEY = 'morse_lcwo_intro'
const MINUTES_KEY = 'morse_lcwo_minutes'
const GROUPS_KEY = 'morse_lcwo_groups'
const ATTEMPTS_KEY = 'morse_lcwo_attempts'
const START_DELAY_KEY = 'morse_lcwo_start_delay'
const GROUP_DELAY_KEY = 'morse_lcwo_group_delay'

const MINUTE_OPTIONS = [1, 2, 3, 4, 5]
const GROUP_OPTIONS = ['fixed', 'random']
const START_DELAY_OPTIONS = [0, 1, 3, 5]
const GROUP_DELAY_OPTIONS = [0, 0.5, 1, 2]

const formatTime = (seconds) => {
  const safe = Math.max(0, Math.ceil(seconds || 0))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

/**
 * Curso de recepción que reproduce el flujo de LCWO.net: escuchar el carácter
 * nuevo, copiar durante 1–5 minutos grupos aleatorios de la lección activa y
 * añadir el siguiente al alcanzar el 90 %.
 */
function LearnPanel({
  pool,
  lesson,
  deck,
  play,
  stop,
  playing,
  recordChars,
  canPlay,
  charWpm,
  effWpm,
  freq,
  onCharWpmChange,
  onEffWpmChange,
  onFreqChange,
  onAdvance,
  onLessonChange,
  onUseKoch,
}) {
  const [intro, setIntro] = useState(() => readJson(INTRO_KEY, {}).visto !== true)
  const [minutes, setMinutes] = useState(() => readNumber(MINUTES_KEY, {
    min: 1,
    max: 5,
    fallback: LCWO_DEFAULTS.minutes,
  }))
  const [groupMode, setGroupMode] = useState(() => readChoice(
    GROUPS_KEY,
    GROUP_OPTIONS,
    'fixed',
  ))
  const [attempts, setAttempts] = useState(() => {
    const stored = readJson(ATTEMPTS_KEY, [])
    return Array.isArray(stored) ? stored : []
  })
  const [startDelay, setStartDelay] = useState(() => readNumber(START_DELAY_KEY, {
    min: 0,
    max: 10,
    fallback: LCWO_DEFAULTS.startDelay,
  }))
  const [extraGroupGap, setExtraGroupGap] = useState(() => readNumber(GROUP_DELAY_KEY, {
    min: 0,
    max: 3,
    fallback: LCWO_DEFAULTS.extraGroupGap,
  }))

  const [session, setSession] = useState(null)
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [countdown, setCountdown] = useState(0)

  const startedAtRef = useRef(0)
  const answerRef = useRef(null)
  const newChars = useMemo(() => (deck === 'koch' ? charsToIntroduce(lesson) : []), [deck, lesson])
  const lessonAttempts = useMemo(
    () => attempts.filter(item => item.lesson === lesson).slice(-5).reverse(),
    [attempts, lesson],
  )

  const resetSession = useCallback(() => {
    stop()
    setSession(null)
    setAnswer('')
    setResult(null)
    setRunning(false)
    setFinished(false)
    setElapsed(0)
    setCountdown(0)
    startedAtRef.current = 0
  }, [stop])

  useEffect(() => resetSession(), [
    lesson,
    minutes,
    groupMode,
    charWpm,
    effWpm,
    extraGroupGap,
    startDelay,
    resetSession,
  ])
  useEffect(() => () => stop(), [stop])

  useEffect(() => {
    if (!running) return undefined
    const update = () => {
      const untilStart = (startedAtRef.current - Date.now()) / 1000
      setCountdown(Math.max(0, untilStart))
      setElapsed(Math.max(0, -untilStart))
    }
    update()
    const timer = setInterval(update, 250)
    return () => clearInterval(timer)
  }, [running])

  const makeSession = useCallback(() => buildKochSession({
    pool,
    minutes,
    groupLength: LCWO_DEFAULTS.groupLength,
    randomLength: groupMode === 'random',
    wpm: charWpm,
    effWpm,
    extraGroupGap,
  }), [pool, minutes, groupMode, charWpm, effWpm, extraGroupGap])

  const startSession = () => {
    const next = session || makeSession()
    if (!next.text) return
    if (!session) setSession(next)
    setResult(null)
    setFinished(false)
    setElapsed(0)
    setCountdown(startDelay)
    startedAtRef.current = Date.now() + startDelay * 1000
    setRunning(true)
    play(next.text, {
      startDelay,
      extraWordGap: extraGroupGap,
      onEnd: () => {
        setRunning(false)
        setFinished(true)
        setElapsed(next.seconds)
        setCountdown(0)
        answerRef.current?.focus()
      },
    })
    answerRef.current?.focus()
  }

  const stopSession = () => {
    stop()
    setRunning(false)
    setFinished(false)
    setElapsed(0)
    setCountdown(0)
    startedAtRef.current = 0
  }

  const submitSession = () => {
    if (!session || result) return
    stop()
    setRunning(false)
    setFinished(true)
    const graded = gradeKochSession(session.text, answer)
    setResult(graded)
    recordChars(graded.characterResults)

    const attempt = {
      lesson,
      accuracy: graded.accuracy,
      charWpm,
      effWpm,
      startDelay,
      extraGroupGap,
      at: Date.now(),
    }
    setAttempts(previous => {
      const next = [...previous, attempt].slice(-80)
      writeValue(ATTEMPTS_KEY, next)
      return next
    })
  }

  const changeMinutes = (value) => {
    setMinutes(value)
    writeValue(MINUTES_KEY, value)
  }

  const changeGroupMode = (value) => {
    setGroupMode(value)
    writeValue(GROUPS_KEY, value)
  }

  const changeStartDelay = (value) => {
    setStartDelay(value)
    writeValue(START_DELAY_KEY, value)
  }

  const changeGroupDelay = (value) => {
    setExtraGroupGap(value)
    writeValue(GROUP_DELAY_KEY, value)
  }

  const resetSettings = () => {
    onCharWpmChange(LCWO_DEFAULTS.charWpm)
    onEffWpmChange(LCWO_DEFAULTS.effWpm)
    onFreqChange(LCWO_DEFAULTS.tone)
    changeMinutes(LCWO_DEFAULTS.minutes)
    changeGroupMode('fixed')
    changeStartDelay(LCWO_DEFAULTS.startDelay)
    changeGroupDelay(LCWO_DEFAULTS.extraGroupGap)
  }

  const preview = (char) => {
    if (running) return
    play(char.repeat(10))
  }

  if (deck !== 'koch') {
    return (
      <div className="mr-feedback mr-feedback--info" style={{ fontWeight: 400 }}>
        <i className="bi bi-info-circle" style={{ marginRight: '8px' }} />
        El curso LCWO usa su propia progresión Koch. Ahora tienes elegido otro mazo.{' '}
        <button className="mr-btn mr-btn--sm" style={{ marginLeft: '8px' }} onClick={onUseKoch}>
          Volver a LCWO / Koch
        </button>
      </div>
    )
  }

  const remaining = session ? Math.max(0, session.seconds - elapsed) : minutes * 60
  const progress = session?.seconds ? Math.min(100, (elapsed / session.seconds) * 100) : 0
  const activeChars = kochChars(lesson)

  return (
    <>
      {intro && (
        <div className="mr-intro">
          <div className="mr-row-between">
            <strong><i className="bi bi-headphones" style={{ marginRight: '8px' }} />Método LCWO</strong>
            <button
              className="mr-btn mr-btn--sm"
              onClick={() => { setIntro(false); writeValue(INTRO_KEY, { visto: true }) }}
            >
              Entendido
            </button>
          </div>
          <ol>
            <li>Empiezas sólo con <strong>K y M</strong>; cada lección añade un carácter en el orden de LCWO.</li>
            <li>Los caracteres suenan rápidos ({charWpm} PPM) y el espaciado baja el conjunto a {effWpm} PPM: es temporización Farnsworth.</li>
            <li>Copias grupos aleatorios sin detenerte si pierdes uno. No cuentes puntos y rayas: reconoce el sonido completo.</li>
            <li>Con <strong>{KOCH_TARGET} % o más</strong> puedes pasar a la siguiente lección. El curso tiene 40 lecciones y 41 caracteres.</li>
          </ol>
        </div>
      )}

      <div className="mr-lcwo-head">
        <div>
          <span className="mr-kicker">Curso LCWO / Koch</span>
          <h2>Lección {lesson} de {MAX_LESSON}</h2>
          <p>
            {lesson === MIN_LESSON
              ? 'Primeros sonidos: K y M'
              : `Carácter nuevo: ${newChars[0]}`}
          </p>
        </div>
        <label className="mr-lesson-select">
          <span>Ir a la lección</span>
          <select value={lesson} onChange={event => onLessonChange(Number(event.target.value))} disabled={running}>
            {Array.from({ length: MAX_LESSON }, (_, index) => index + 1).map(value => (
              <option key={value} value={value}>
                {value}{value === 1 ? ' · K M' : ` · +${kochChars(value).at(-1)}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mr-lcwo-chars" aria-label="Caracteres de la lección">
        {activeChars.map(char => (
          <button
            key={char}
            className={`mr-lcwo-char${newChars.includes(char) ? ' mr-lcwo-char--new' : ''}`}
            onClick={() => preview(char)}
            disabled={!canPlay || running}
            title={`Escuchar ${char}`}
          >
            <span>{char}</span>
            {newChars.includes(char) && <small>nuevo</small>}
          </button>
        ))}
      </div>
      <p className="mr-slider-note">Pulsa un carácter para oírlo diez veces. En el curso no se muestran puntos y rayas.</p>

      <section className="mr-lcwo-config" aria-labelledby="lcwo-settings-title">
        <div className="mr-lcwo-config-head">
          <div>
            <span className="mr-kicker">Audio y sesión</span>
            <h3 id="lcwo-settings-title">
              <i className="bi bi-sliders" aria-hidden="true" /> Configuración de la práctica
            </h3>
          </div>
          <button className="mr-btn mr-btn--sm" onClick={resetSettings} disabled={running}>
            Restaurar 20/10 PPM
          </button>
        </div>

        <div className="mr-lcwo-config-grid">
          <div className="mr-lcwo-control">
            <span className="mr-slider-head">
              <span>Velocidad de carácter</span>
              <strong>{charWpm} PPM</strong>
            </span>
            <input
              className="mr-slider"
              type="range"
              min="5"
              max="40"
              step="1"
              value={charWpm}
              onChange={event => onCharWpmChange(Number(event.target.value))}
              disabled={running}
              aria-label="Velocidad de carácter en palabras por minuto"
            />
            <small>Rapidez real de cada letra. LCWO recomienda mantenerla alta.</small>
          </div>

          <div className="mr-lcwo-control">
            <span className="mr-slider-head">
              <span>Velocidad efectiva</span>
              <strong>{effWpm} PPM</strong>
            </span>
            <input
              className="mr-slider"
              type="range"
              min="4"
              max={charWpm}
              step="1"
              value={effWpm}
              onChange={event => onEffWpmChange(Number(event.target.value))}
              disabled={running}
              aria-label="Velocidad efectiva en palabras por minuto"
            />
            <small>Controla el retardo Farnsworth entre caracteres y grupos.</small>
          </div>

          <div className="mr-lcwo-control">
            <span className="mr-slider-head">
              <span>Tono</span>
              <strong>{freq} Hz</strong>
            </span>
            <input
              className="mr-slider"
              type="range"
              min="300"
              max="1000"
              step="10"
              value={freq}
              onChange={event => onFreqChange(Number(event.target.value))}
              disabled={running}
              aria-label="Frecuencia del tono en hercios"
            />
            <button
              type="button"
              className="mr-btn mr-btn--sm mr-lcwo-test-tone"
              onClick={() => play('V')}
              disabled={!canPlay || running}
            >
              <i className="bi bi-volume-up" aria-hidden="true" /> Probar
            </button>
          </div>
        </div>

        <div className="mr-lcwo-config-grid mr-lcwo-config-grid--session">
          <div className="mr-lcwo-control">
            <span className="field-label">Duración</span>
            <div className="mr-chips">
              {MINUTE_OPTIONS.map(value => (
                <button
                  key={value}
                  className={`mr-btn mr-btn--sm${minutes === value ? ' mr-btn--active' : ''}`}
                  onClick={() => changeMinutes(value)}
                  disabled={running}
                >
                  {value} min
                </button>
              ))}
            </div>
          </div>

          <div className="mr-lcwo-control">
            <span className="field-label">Longitud de grupo</span>
            <div className="mr-chips">
              <button
                className={`mr-btn mr-btn--sm${groupMode === 'fixed' ? ' mr-btn--active' : ''}`}
                onClick={() => changeGroupMode('fixed')}
                disabled={running}
              >
                5 fija
              </button>
              <button
                className={`mr-btn mr-btn--sm${groupMode === 'random' ? ' mr-btn--active' : ''}`}
                onClick={() => changeGroupMode('random')}
                disabled={running}
              >
                2–7 aleatoria
              </button>
            </div>
          </div>

          <div className="mr-lcwo-control">
            <span className="field-label">Retardo antes de empezar</span>
            <div className="mr-chips">
              {START_DELAY_OPTIONS.map(value => (
                <button
                  key={value}
                  className={`mr-btn mr-btn--sm${startDelay === value ? ' mr-btn--active' : ''}`}
                  onClick={() => changeStartDelay(value)}
                  disabled={running}
                >
                  {value} s
                </button>
              ))}
            </div>
          </div>

          <div className="mr-lcwo-control">
            <span className="field-label">Pausa extra entre grupos</span>
            <div className="mr-chips">
              {GROUP_DELAY_OPTIONS.map(value => (
                <button
                  key={value}
                  className={`mr-btn mr-btn--sm${extraGroupGap === value ? ' mr-btn--active' : ''}`}
                  onClick={() => changeGroupDelay(value)}
                  disabled={running}
                >
                  {value ? `+${value} s` : 'Ninguna'}
                </button>
              ))}
            </div>
            <small>Se suma al espaciado Farnsworth; no ralentiza los puntos y rayas.</small>
          </div>
        </div>

        <div className="mr-lcwo-config-summary">
          <i className="bi bi-soundwave" aria-hidden="true" />
          {charWpm}/{effWpm} PPM · {freq} Hz · inicio {startDelay} s
          {extraGroupGap > 0 ? ` · +${extraGroupGap} s entre grupos` : ''}
        </div>
      </section>

      <div className="mr-lcwo-console">
        <div className="mr-row-between">
          <span className="field-label" style={{ marginBottom: 0 }}>Texto de práctica</span>
          <span className="mr-lcwo-clock">
            {running && countdown > 0
              ? `Comienza en ${Math.ceil(countdown)} s`
              : running
                ? `En curso · ${formatTime(remaining)}`
                : `${finished ? 'Finalizado' : 'Preparado'} · ${formatTime(remaining)}`}
          </span>
        </div>
        <div className="mr-bar mr-lcwo-progress" aria-hidden="true">
          <span className="mr-bar-seg" style={{ width: `${progress}%`, background: 'var(--accent-blue)' }} />
        </div>

        <textarea
          ref={answerRef}
          className="mr-lcwo-answer"
          value={answer}
          onChange={event => setAnswer(event.target.value.toUpperCase())}
          disabled={!!result}
          placeholder="Escribe lo que oigas, separando los grupos con espacios…"
          spellCheck="false"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          aria-label="Texto copiado al oído"
        />

        <div className="mr-lcwo-actions">
          {!running && !finished && !result && (
            <button className="mr-btn mr-btn--primary" onClick={startSession} disabled={!canPlay}>
              <i className={`bi ${playing ? 'bi-soundwave' : 'bi-play-circle'}`} style={{ marginRight: '8px' }} />
              {session ? 'Reiniciar audio' : 'Comenzar práctica'}
            </button>
          )}
          {running && (
            <button className="mr-btn" onClick={stopSession}>
              <i className="bi bi-stop-circle" style={{ marginRight: '8px' }} />
              Detener y reiniciar
            </button>
          )}
          {session && !result && (
            <button className="mr-btn mr-btn--primary" onClick={submitSession} disabled={running}>
              <i className="bi bi-check2-square" style={{ marginRight: '8px' }} />
              Corregir copia
            </button>
          )}
        </div>
        {!canPlay && <p className="mr-slider-note">Este navegador no admite Web Audio; no puede reproducir la práctica.</p>}
      </div>

      {result && (
        <div className={`mr-lcwo-result ${result.passed ? 'mr-lcwo-result--pass' : 'mr-lcwo-result--retry'}`}>
          <div className="mr-lcwo-score">
            <span>{result.accuracy}%</span>
            <div>
              <strong>{result.passed ? 'Lección superada' : 'Repite esta lección'}</strong>
              <small>
                {result.groupErrors} errores por grupos · {result.sequenceErrors} por secuencia · {result.total} caracteres
              </small>
            </div>
          </div>

          <div className="mr-lcwo-groups" role="table" aria-label="Corrección por grupos">
            <div className="mr-lcwo-group mr-lcwo-group--head" role="row">
              <span>Enviado</span><span>Copiado</span><span>Errores</span>
            </div>
            {result.rows.map((row, index) => (
              <div key={index} className={`mr-lcwo-group${row.errors ? ' mr-lcwo-group--bad' : ''}`} role="row">
                <span>{row.expected || '—'}</span>
                <span>{row.got || '—'}</span>
                <span>{row.errors}</span>
              </div>
            ))}
          </div>

          <div className="mr-lcwo-actions">
            <button className="mr-btn" onClick={resetSession}>
              <i className="bi bi-arrow-repeat" style={{ marginRight: '8px' }} />
              Nueva práctica
            </button>
            {result.passed && lesson < MAX_LESSON && (
              <button className="mr-btn mr-btn--primary" onClick={onAdvance}>
                Añadir «{kochChars(lesson + 1).at(-1)}»
                <i className="bi bi-arrow-right" style={{ marginLeft: '8px' }} />
              </button>
            )}
            {result.passed && lesson === MAX_LESSON && (
              <strong className="mr-lcwo-complete">Curso completo: 40 lecciones</strong>
            )}
          </div>
        </div>
      )}

      {lessonAttempts.length > 0 && (
        <div className="mr-lcwo-history">
          <span className="field-label">Últimos intentos de esta lección</span>
          <div>
            {lessonAttempts.map(item => (
              <span key={item.at} className={item.accuracy >= KOCH_TARGET ? 'is-pass' : undefined}>
                {item.accuracy}% <small>{item.charWpm}/{item.effWpm}</small>
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export default LearnPanel
