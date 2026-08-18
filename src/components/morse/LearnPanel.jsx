import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { prettyMorse, rhythmOf, symbolsFor } from '../../utils/morse'
import {
  buildCopyDrill,
  charsToIntroduce,
  copyStepPassed,
  gradeCopy,
  kochChars,
  pickRecognition,
  recognitionOptions,
  COPY_GROUPS_TO_PASS,
  LEARN_STEPS,
  LISTENS_TO_PASS,
  MAX_LESSON,
  RECOGNITION_STREAK,
} from '../../utils/morseTrainer'
import { readJson, writeValue } from '../../utils/localSettings'

const LEARN_KEY = 'morse_learn'
const INTRO_KEY = 'morse_intro'

/**
 * Curso guiado para empezar de cero.
 *
 * Koch da por sabido que alguien te presenta el carácter antes de examinarte:
 * sin ese paso, la primera lección es oír ruido. Aquí cada lección va en tres
 * tiempos — conocer el sonido, distinguirlo de los ya sabidos y copiarlo en
 * grupos — y no se añade un carácter nuevo hasta que el anterior se sostiene.
 */
function LearnPanel({ pool, lesson, deck, progressRef, play, stop, playing, recordChars, canPlay, onAdvance, onUseKoch }) {
  const guardado = readJson(LEARN_KEY, {})
  const [paso, setPaso] = useState(() => (
    guardado.lesson === lesson && LEARN_STEPS.some(s => s.id === guardado.paso) ? guardado.paso : 'conoce'
  ))
  const [intro, setIntro] = useState(() => readJson(INTRO_KEY, {}).visto !== true)

  const [escuchas, setEscuchas]     = useState({})
  const [pregunta, setPregunta]     = useState(null)
  const [elegido, setElegido]       = useState(null)
  const [racha, setRacha]           = useState(0)
  const [drill, setDrill]           = useState(null)
  const [respuesta, setRespuesta]   = useState('')
  const [correccion, setCorreccion] = useState(null)
  const [historial, setHistorial]   = useState([])
  const [lampara, setLampara]       = useState(false)

  const timerRef = useRef(null)
  const inputRef = useRef(null)
  const pasoRef  = useRef(paso)

  const nuevos = useMemo(() => (deck === 'koch' ? charsToIntroduce(lesson) : []), [deck, lesson])
  const sonar = useCallback((texto) => {
    play(texto, { onSymbol: ({ on }) => setLampara(on), onEnd: () => setLampara(false) })
  }, [play])

  useEffect(() => () => { clearTimeout(timerRef.current); stop() }, [stop])

  // Cambiar de lección devuelve el curso a su primer tiempo. El primer montaje
  // se salta el reinicio: ahí manda el paso que se recuperó de localStorage.
  const primeraRef = useRef(true)
  useEffect(() => {
    clearTimeout(timerRef.current)
    setEscuchas({})
    setRacha(0)
    setHistorial([])
    setPregunta(null)
    setElegido(null)
    setDrill(null)
    setRespuesta('')
    setCorreccion(null)
    if (primeraRef.current) { primeraRef.current = false; return }
    pasoRef.current = 'conoce'
    setPaso('conoce')
    writeValue(LEARN_KEY, { lesson, paso: 'conoce' })
  }, [lesson])

  const irA = useCallback((siguiente) => {
    clearTimeout(timerRef.current)
    stop()
    setLampara(false)
    pasoRef.current = siguiente
    setPaso(siguiente)
    writeValue(LEARN_KEY, { lesson, paso: siguiente })
  }, [lesson, stop])

  // ── 1. Conoce ──
  const escuchar = (char) => {
    setEscuchas(e => ({ ...e, [char]: (e[char] || 0) + 1 }))
    sonar(char)
  }
  const conocidos = nuevos.every(c => (escuchas[c] || 0) >= LISTENS_TO_PASS)

  // ── 2. Reconoce ──
  const nuevaPregunta = useCallback(() => {
    clearTimeout(timerRef.current)
    const entry = pickRecognition({
      pool,
      nuevos,
      progress: progressRef.current,
      exclude: pregunta?.entry.char ?? null,
    })
    if (!entry) return
    const q = { entry, options: recognitionOptions(entry, pool) }
    setPregunta(q)
    setElegido(null)
    sonar(entry.char)
  // `pregunta` sólo se lee para no repetir el carácter anterior.
  }, [pool, nuevos, progressRef, sonar])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (paso === 'reconoce' && !pregunta) nuevaPregunta()
  }, [paso, pregunta, nuevaPregunta])

  const responder = (char) => {
    if (!pregunta || elegido) return
    setElegido(char)
    const ok = char === pregunta.entry.char
    recordChars([{ char: pregunta.entry.char, ok }])
    setRacha(r => (ok ? r + 1 : 0))
    if (ok) timerRef.current = setTimeout(nuevaPregunta, 850)
  }

  // ── 3. Copia ──
  const nuevoGrupo = useCallback(() => {
    setDrill(buildCopyDrill({ pool, progress: progressRef.current, mode: 'grupo', size: 5 }))
    setRespuesta('')
    setCorreccion(null)
  }, [pool, progressRef])

  useEffect(() => {
    if (paso === 'copia' && !drill) nuevoGrupo()
  }, [paso, drill, nuevoGrupo])

  useEffect(() => {
    if (paso === 'copia' && drill && !correccion) {
      sonar(drill.text)
      inputRef.current?.focus()
    }
  // Suena una vez por grupo; repetir es cosa del botón.
  }, [paso, drill])   // eslint-disable-line react-hooks/exhaustive-deps

  const corregir = () => {
    if (!drill || correccion) return
    stop()
    setLampara(false)
    const g = gradeCopy(drill.text, respuesta)
    setCorreccion(g)
    recordChars(g.cells.filter(c => c.expected !== null).map(c => ({ char: c.expected, ok: c.ok })))
    setHistorial(h => [...h, g.total === 0 ? 0 : Math.round((g.correct / g.total) * 100)].slice(-10))
  }

  const superado = {
    conoce:   conocidos,
    reconoce: racha >= RECOGNITION_STREAK,
    copia:    copyStepPassed(historial),
  }

  // ── Interfaz ──
  if (deck !== 'koch') {
    return (
      <div className="mr-feedback mr-feedback--info" style={{ fontWeight: 400 }}>
        <i className="bi bi-info-circle" style={{ marginRight: '8px' }} />
        El curso va por lecciones de Koch, que es la progresión pensada para
        empezar de cero. Ahora tienes elegido otro mazo.{' '}
        <button className="mr-btn mr-btn--sm" style={{ marginLeft: '8px' }} onClick={onUseKoch}>
          Volver al mazo Koch
        </button>
      </div>
    )
  }

  const paso1 = (
    <>
      <p className="mr-prompt">
        {nuevos.length > 1
          ? 'Estos son tus dos primeros caracteres. Escucha cada uno hasta que puedas tararearlo.'
          : `La lección ${lesson} estrena un carácter. Escúchalo hasta que lo reconozcas sin mirar.`}
      </p>

      <div className="mr-learn-cards">
        {nuevos.map(char => {
          const morse = symbolsFor(char)
          const veces = escuchas[char] || 0
          return (
            <div key={char} className={`mr-learn-card${veces >= LISTENS_TO_PASS ? ' mr-learn-card--done' : ''}`}>
              <span className="mr-stage-char">{char}</span>
              <span className="mr-pattern mr-pattern--lg">{prettyMorse(morse)}</span>
              <span className="mr-rhythm">«{rhythmOf(morse)}»</span>
              <button className="mr-btn mr-btn--primary" onClick={() => escuchar(char)} disabled={!canPlay}>
                <i className="bi bi-volume-up" style={{ marginRight: '8px' }} />
                Escuchar
              </button>
              <span className="mr-learn-count">
                {veces >= LISTENS_TO_PASS
                  ? <><i className="bi bi-check-circle" /> Escuchado</>
                  : `${veces} de ${LISTENS_TO_PASS} escuchas`}
              </span>
            </div>
          )
        })}
      </div>

      {lesson > 1 && (
        <p className="mr-slider-note">
          Ya sabes: <span className="mr-lesson-chars">{kochChars(lesson - 1).join(' ')}</span>
        </p>
      )}
    </>
  )

  const paso2 = pregunta && (
    <>
      <p className="mr-prompt">¿Qué carácter ha sonado?</p>

      <div className="mr-drill">
        <div className={`mr-lamp${lampara ? ' mr-lamp--on' : ''}`} />
        <button className="mr-btn" style={{ marginTop: '16px' }} onClick={() => sonar(pregunta.entry.char)} disabled={!canPlay}>
          <i className={`bi ${playing ? 'bi-soundwave' : 'bi-arrow-repeat'}`} style={{ marginRight: '6px' }} />
          Repetir
        </button>
      </div>

      <div className="mr-options">
        {pregunta.options.map(char => {
          let clase = 'mr-option mr-option--char'
          if (elegido) {
            if (char === pregunta.entry.char) clase += ' mr-option--correct'
            else if (char === elegido) clase += ' mr-option--wrong'
            else clase += ' mr-option--dim'
          }
          return (
            <button key={char} className={clase} disabled={!!elegido} onClick={() => responder(char)}>
              <span className="mr-option-text" style={{ fontSize: '1.4rem', textAlign: 'center' }}>{char}</span>
            </button>
          )
        })}
      </div>

      {elegido && elegido !== pregunta.entry.char && (
        <>
          <div className="mr-feedback mr-feedback--wrong" style={{ marginTop: '14px' }}>
            <i className="bi bi-x-circle" style={{ marginRight: '8px' }} />
            Era «{pregunta.entry.char}» ({prettyMorse(pregunta.entry.morse)}), que suena «{rhythmOf(pregunta.entry.morse)}».
          </div>
          <button className="mr-btn mr-btn--primary" style={{ width: '100%', marginTop: '12px', padding: '12px' }} onClick={nuevaPregunta}>
            Otra vez
          </button>
        </>
      )}

      <div className="mr-learn-streak">
        <span>Aciertos seguidos: {Math.min(racha, RECOGNITION_STREAK)} de {RECOGNITION_STREAK}</span>
        <div className="mr-bar">
          <span
            className="mr-bar-seg"
            style={{ width: `${Math.min(racha / RECOGNITION_STREAK, 1) * 100}%`, background: 'var(--accent-green)' }}
          />
        </div>
      </div>
    </>
  )

  const paso3 = (
    <>
      <p className="mr-prompt">
        Suenan cinco caracteres seguidos. Escribe los que cojas y no te pares en
        el que se te escape: perder uno y seguir es justo lo que hay que aprender.
      </p>

      <div className="mr-drill">
        <div className={`mr-lamp${lampara ? ' mr-lamp--on' : ''}`} />
        <button className="mr-btn" style={{ marginTop: '16px' }} onClick={() => drill && sonar(drill.text)} disabled={!canPlay || !drill}>
          <i className={`bi ${playing ? 'bi-soundwave' : 'bi-arrow-repeat'}`} style={{ marginRight: '6px' }} />
          Repetir
        </button>
      </div>

      <input
        ref={inputRef}
        className="mr-answer"
        value={respuesta}
        onChange={e => setRespuesta(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); correccion ? nuevoGrupo() : corregir() } }}
        disabled={!!correccion}
        placeholder="· · ·"
        autoComplete="off"
        spellCheck="false"
        aria-label="Lo que has copiado"
      />

      {!correccion ? (
        <button className="mr-btn mr-btn--primary" style={{ width: '100%', marginTop: '14px', padding: '13px' }} onClick={corregir} disabled={!drill}>
          Comprobar (Intro)
        </button>
      ) : (
        <>
          <div className="mr-cells">
            {correccion.cells.map((c, i) => (
              <div key={i} className={`mr-cell ${c.ok ? 'mr-cell--ok' : 'mr-cell--bad'}`}>
                <span className="mr-cell-char">{c.expected ?? '–'}</span>
                <span className="mr-cell-got">{!c.ok && c.got ? c.got : ''}</span>
                <span className="mr-cell-pattern">{c.expected ? prettyMorse(symbolsFor(c.expected) || '') : ''}</span>
              </div>
            ))}
          </div>
          <div className={`mr-feedback ${correccion.perfect ? 'mr-feedback--correct' : 'mr-feedback--wrong'}`}>
            <i className={`bi ${correccion.perfect ? 'bi-check-circle' : 'bi-x-circle'}`} style={{ marginRight: '8px' }} />
            {correccion.correct} de {correccion.total} · era «{drill.text}»
          </div>
          <button className="mr-btn mr-btn--primary" style={{ width: '100%', marginTop: '14px', padding: '13px' }} onClick={nuevoGrupo}>
            Otro grupo (Intro)
          </button>
        </>
      )}

      <div className="mr-learn-streak">
        <span>
          Grupos por encima del 90 %: {historial.slice(-COPY_GROUPS_TO_PASS).filter(n => n >= 90).length} de {COPY_GROUPS_TO_PASS}
        </span>
      </div>
    </>
  )

  const fin = (
    <div className="mr-learn-done">
      <i className="bi bi-mortarboard" />
      <h3>Lección {lesson} superada</h3>
      <p>
        Ya distingues <span className="mr-lesson-chars">{kochChars(lesson).join(' ')}</span> al oído.
      </p>
      {lesson < MAX_LESSON ? (
        <button className="mr-btn mr-btn--primary" style={{ padding: '13px 22px' }} onClick={() => { onAdvance(); irA('conoce') }}>
          <i className="bi bi-plus-circle" style={{ marginRight: '8px' }} />
          Añadir «{kochChars(lesson + 1).slice(-1)[0]}» y seguir
        </button>
      ) : (
        <p>Has llegado al final del curso: los 40 caracteres de la progresión de Koch.</p>
      )}
    </div>
  )

  const indice = paso === 'hecho' ? LEARN_STEPS.length : LEARN_STEPS.findIndex(s => s.id === paso)
  const actual = LEARN_STEPS[indice]

  return (
    <>
      {intro && (
        <div className="mr-intro">
          <div className="mr-row-between">
            <strong><i className="bi bi-compass" style={{ marginRight: '8px' }} />Empezar de cero</strong>
            <button
              className="mr-btn mr-btn--sm"
              onClick={() => { setIntro(false); writeValue(INTRO_KEY, { visto: true }) }}
            >
              Entendido
            </button>
          </div>
          <ul>
            <li>El Morse <strong>se aprende de oído</strong>. Verás los puntos y rayas como apoyo, pero lo que hay que memorizar es el sonido, no el dibujo.</li>
            <li>Sólo hay dos sonidos: uno corto, <em>dit</em> (·), y uno largo, <em>dah</em> (–). La K es «dah-di-dah».</li>
            <li><strong>No cuentes los puntos.</strong> Si te da tiempo a contarlos vas por mal camino. Por eso cada carácter suena rápido y lo que se alarga es el silencio entre ellos.</li>
            <li>Se avanza de uno en uno: empiezas con dos caracteres y añades el siguiente cuando copias el 90 %. Son 40 en total.</li>
            <li>PPM son palabras por minuto. Los ajustes están más abajo, pero puedes dejarlos como vienen.</li>
          </ul>
        </div>
      )}

      <div className="mr-steps">
        {LEARN_STEPS.map((s, i) => (
          <button
            key={s.id}
            className={`mr-step${paso === s.id ? ' mr-step--active' : ''}${i < indice ? ' mr-step--done' : ''}`}
            onClick={() => irA(s.id)}
            title={s.hint}
          >
            <i className={`bi ${i < indice ? 'bi-check-circle-fill' : s.icon}`} />
            <span>{i + 1}. {s.label}</span>
          </button>
        ))}
      </div>

      {paso === 'conoce'   && paso1}
      {paso === 'reconoce' && paso2}
      {paso === 'copia'    && paso3}
      {paso === 'hecho'    && fin}

      {paso !== 'hecho' && (
        <div className="mr-learn-next">
          <span className="mr-slider-note" style={{ margin: 0 }}>{actual?.hint}</span>
          <button
            className="mr-btn mr-btn--primary"
            onClick={() => irA(indice === LEARN_STEPS.length - 1 ? 'hecho' : LEARN_STEPS[indice + 1].id)}
            disabled={!superado[paso]}
          >
            {superado[paso] ? 'Continuar' : 'Termina este paso'}
            <i className="bi bi-arrow-right" style={{ marginLeft: '8px' }} />
          </button>
        </div>
      )}
    </>
  )
}

export default LearnPanel
