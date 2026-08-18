import { useState, useEffect, useRef, useCallback } from 'react'
import {
  REVERSE_TABLE,
  classifyGap,
  classifyPress,
  createSidetone,
  prettyMorse,
  symbolsFor,
} from '../../utils/morse'
import { buildCopyDrill, gradeCopy } from '../../utils/morseTrainer'
import { readChoice, writeValue } from '../../utils/localSettings'

const MODES = [
  { id: 'caracter', label: 'Un carácter',  hint: 'Manipula un solo carácter del mazo' },
  { id: 'grupo',    label: 'Grupos',       hint: 'Grupos de cinco caracteres' },
  { id: 'palabra',  label: 'Abreviaturas', hint: 'Voces reales de CW' },
  { id: 'libre',    label: 'Libre',        hint: 'Sin objetivo: manipula lo que quieras y mira qué sale' },
]
const MODE_KEY = 'morse_key_mode'

/**
 * Manipulador recto. La barra espaciadora (o el ratón sobre la pletina) abre y
 * cierra el circuito; la duración de cada pulsación decide punto o raya y la de
 * cada silencio, si se cierra el carácter o la palabra. Lo manipulado se
 * decodifica en vivo y se compara con el objetivo.
 */
function KeyPanel({ pool, progressRef, charWpm, freq, recordChars, canPlay }) {
  const [mode, setMode]   = useState(() => readChoice(MODE_KEY, MODES.map(m => m.id), 'caracter'))
  const [target, setTarget] = useState(null)
  const [text, setText]   = useState('')
  const [buffer, setBuffer] = useState('')
  const [down, setDown]   = useState(false)
  const [grade, setGrade] = useState(null)
  const [cheat, setCheat] = useState(false)

  const toneRef   = useRef(null)
  const downRef   = useRef(false)
  const startRef  = useRef(0)
  const lastUpRef = useRef(null)
  const bufRef    = useRef('')
  const textRef   = useRef('')
  const timerRef  = useRef(null)
  const unitRef   = useRef(1200 / charWpm)

  useEffect(() => { unitRef.current = 1200 / charWpm }, [charWpm])
  useEffect(() => { toneRef.current?.setFreq(freq) }, [freq])
  useEffect(() => () => { toneRef.current?.close(); clearTimeout(timerRef.current) }, [])

  const libre = mode === 'libre'

  // ── Objetivo ──
  const nextTarget = useCallback((over = {}) => {
    const m = over.mode ?? mode
    clearTimeout(timerRef.current)
    bufRef.current = ''
    textRef.current = ''
    lastUpRef.current = null
    setBuffer('')
    setText('')
    setGrade(null)
    setTarget(m === 'libre'
      ? null
      : buildCopyDrill({ pool, progress: progressRef.current, mode: m, size: 5 }))
  }, [pool, mode, progressRef])

  useEffect(() => { nextTarget() }, [nextTarget])

  // ── Decodificación ──
  const commitChar = useCallback(() => {
    if (!bufRef.current) return
    textRef.current += REVERSE_TABLE[bufRef.current] || '#'
    bufRef.current = ''
    setBuffer('')
    setText(textRef.current)
  }, [])

  const commitWord = useCallback(() => {
    if (!textRef.current || textRef.current.endsWith(' ')) return
    textRef.current += ' '
    setText(textRef.current)
  }, [])

  /** Cierre automático cuando el operador deja de manipular. */
  const scheduleIdle = useCallback(() => {
    const unit = unitRef.current
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      commitChar()
      timerRef.current = setTimeout(commitWord, unit * 4)
    }, unit * 3)
  }, [commitChar, commitWord])

  const keyDown = useCallback(() => {
    if (downRef.current || grade) return
    const now = performance.now()
    clearTimeout(timerRef.current)

    // El silencio que acaba de terminar es el que separa símbolos, caracteres
    // o palabras: se mide contra la unidad de la velocidad elegida.
    if (lastUpRef.current !== null) {
      const kind = classifyGap(now - lastUpRef.current, unitRef.current)
      if (kind === 'char') commitChar()
      else if (kind === 'word') { commitChar(); commitWord() }
    }

    if (!toneRef.current) toneRef.current = createSidetone({ freq })
    toneRef.current?.down()
    downRef.current = true
    startRef.current = now
    setDown(true)
  }, [grade, freq, commitChar, commitWord])

  const keyUp = useCallback(() => {
    if (!downRef.current) return
    const now = performance.now()
    toneRef.current?.up()
    downRef.current = false
    setDown(false)
    lastUpRef.current = now

    bufRef.current += classifyPress(now - startRef.current, unitRef.current)
    setBuffer(bufRef.current)
    scheduleIdle()
  }, [scheduleIdle])

  // Barra espaciadora como manipulador. `repeat` descarta la repetición
  // automática del teclado, que si no convertiría cada punto en una raya.
  useEffect(() => {
    const onDown = (e) => {
      if (e.code !== 'Space' || e.repeat) return
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      keyDown()
    }
    const onUp = (e) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      keyUp()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [keyDown, keyUp])

  // ── Corrección ──
  const check = useCallback(() => {
    if (!target || grade) return
    clearTimeout(timerRef.current)
    commitChar()
    const enviado = (textRef.current || '').trim()
    const g = gradeCopy(target.text, enviado)
    setGrade(g)
    recordChars(g.cells.filter(c => c.expected !== null).map(c => ({ char: c.expected, ok: c.ok })))
  }, [target, grade, commitChar, recordChars])

  const clear = () => {
    clearTimeout(timerRef.current)
    bufRef.current = ''
    textRef.current = ''
    lastUpRef.current = null
    setBuffer('')
    setText('')
    setGrade(null)
  }

  const handleModeChange = (m) => {
    setMode(m)
    writeValue(MODE_KEY, m)
  }

  const unitMs = Math.round(1200 / charWpm)

  return (
    <>
      <span className="field-label">Qué manipular</span>
      <div className="mr-chips">
        {MODES.map(m => (
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

      {!canPlay && (
        <p className="mr-slider-note">
          Sin Web Audio no hay tono lateral, pero la decodificación de lo que manipules sigue funcionando.
        </p>
      )}

      {target && (
        <div className="mr-drill">
          <span className="field-label">Envía esto</span>
          <div className="mr-key-target">{target.text}</div>
          {target.meaning && <p className="mr-drill-hint">{target.meaning}</p>}
          {cheat && (
            <p className="mr-pattern" style={{ marginTop: '10px' }}>
              {target.text.split('').map(c => prettyMorse(symbolsFor(c) || '')).join('   ')}
            </p>
          )}
          <button className="mr-btn mr-btn--sm" style={{ marginTop: '12px' }} onClick={() => setCheat(v => !v)}>
            <i className={`bi bi-eye${cheat ? '-slash' : ''}`} style={{ marginRight: '6px' }} />
            {cheat ? 'Ocultar la chuleta' : 'Ver la chuleta'}
          </button>
        </div>
      )}

      <button
        type="button"
        className={`mr-key-pad${down ? ' mr-key-pad--down' : ''}`}
        onPointerDown={(e) => { e.preventDefault(); keyDown() }}
        onPointerUp={keyUp}
        onPointerLeave={keyUp}
        onPointerCancel={keyUp}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Pletina del manipulador"
      >
        <i className="bi bi-broadcast" style={{ fontSize: '1.8rem', display: 'block', marginBottom: '8px' }} />
        {down ? 'Transmitiendo…' : 'Mantén pulsada la barra espaciadora o esta pletina'}
        <span className="mr-slider-note" style={{ display: 'block', marginTop: '6px' }}>
          A {charWpm} PPM el punto dura {unitMs} ms y la raya {unitMs * 3} ms
        </span>
      </button>

      <div className="mr-key-readout">
        <span className="mr-key-buffer">{prettyMorse(buffer) || '·'}</span>
        <span className="mr-key-text">{text || <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
        <button className="mr-btn" onClick={clear}>
          <i className="bi bi-eraser" style={{ marginRight: '6px' }} />
          Borrar
        </button>
        {!libre && !grade && (
          <button className="mr-btn mr-btn--primary" style={{ flex: 1 }} onClick={check} disabled={!text && !buffer}>
            <i className="bi bi-check2-square" style={{ marginRight: '8px' }} />
            Comprobar
          </button>
        )}
        {!libre && grade && (
          <button className="mr-btn mr-btn--primary" style={{ flex: 1 }} onClick={() => nextTarget()}>
            <i className="bi bi-arrow-right-circle" style={{ marginRight: '8px' }} />
            Siguiente
          </button>
        )}
      </div>

      {grade && target && (
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
          <div className={`mr-feedback ${grade.perfect ? 'mr-feedback--correct' : 'mr-feedback--wrong'}`}>
            <i className={`bi ${grade.perfect ? 'bi-check-circle' : 'bi-x-circle'}`} style={{ marginRight: '8px' }} />
            {grade.perfect
              ? '¡Manipulado limpio!'
              : `${grade.correct} de ${grade.total} — se leyó «${textRef.current.trim() || '—'}»`}
          </div>
        </>
      )}

      <div className="mr-feedback mr-feedback--info" style={{ marginTop: '14px', fontWeight: 400 }}>
        <i className="bi bi-info-circle" style={{ marginRight: '8px' }} />
        El ritmo manda: raya = tres puntos, hueco entre símbolos = un punto, entre
        caracteres = tres y entre palabras = siete. Si sale «#» es que el patrón no
        existe en la tabla, casi siempre por quedarse corto o largo con una raya.
      </div>
    </>
  )
}

export default KeyPanel
