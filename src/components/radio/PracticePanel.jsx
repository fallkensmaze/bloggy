import { useState, useEffect, useCallback, useRef } from 'react'
import { buildPractica, corrige } from '../../utils/radioExam'
import { MASTERY, masteryOf } from '../../utils/leitner'

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/**
 * Práctica: una pregunta cada vez, corrección inmediata y repaso adaptativo.
 * Las preguntas de varias respuestas se corrigen al pulsar «Comprobar»; las de
 * una sola, al elegir opción.
 */
function PracticePanel({ pool, progress, onResponder }) {
  const progressRef = useRef(progress)
  useEffect(() => { progressRef.current = progress }, [progress])

  const [pregunta, setPregunta] = useState(() => buildPractica({ pool, progress }))
  const [seleccion, setSeleccion] = useState([])
  const [resultado, setResultado] = useState(null)

  // Espejos síncronos del estado: el teclado puede llegar antes de que React
  // vuelva a renderizar, y corregir dos veces la misma pregunta contaría doble.
  const preguntaRef = useRef(pregunta)
  const resultadoRef = useRef(null)

  const plantea = useCallback((nueva) => {
    preguntaRef.current = nueva
    resultadoRef.current = null
    setPregunta(nueva)
    setSeleccion([])
    setResultado(null)
  }, [])

  // Cambiar de tema cambia el mazo: se rehace la pregunta con el nuevo.
  useEffect(() => {
    plantea(buildPractica({ pool, progress: progressRef.current }))
  }, [pool, plantea])

  const siguiente = useCallback(() => {
    plantea(buildPractica({
      pool,
      progress: progressRef.current,
      excluirKey: preguntaRef.current?.key,
    }))
  }, [pool, plantea])

  const comprobar = useCallback((sel) => {
    const actual = preguntaRef.current
    if (!actual || resultadoRef.current) return
    const r = corrige(actual, sel)
    if (!r.contestada) return
    resultadoRef.current = r
    setResultado(r)
    onResponder(actual, r.ok)
  }, [onResponder])

  const elegir = useCallback((idx) => {
    if (resultadoRef.current || idx == null || !pregunta) return
    if (pregunta.multi) {
      setSeleccion(s => (s.includes(idx) ? s.filter(i => i !== idx) : [...s, idx]))
    } else {
      setSeleccion([idx])
      comprobar([idx])
    }
  }, [pregunta, comprobar])

  // Teclado: 1-8 o A-H eligen, Enter comprueba o pasa a la siguiente.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.ctrlKey || e.altKey || e.metaKey || !pregunta) return

      if (e.key === 'Enter' || (e.key === ' ' && resultado)) {
        e.preventDefault()
        if (resultado) siguiente()
        else if (pregunta.multi && seleccion.length > 0) comprobar(seleccion)
        return
      }
      if (resultado) return

      const pos = /^[1-8]$/.test(e.key)
        ? Number(e.key) - 1
        : LETRAS.indexOf(e.key.toUpperCase())
      if (pos >= 0 && pos < pregunta.orden.length) elegir(pregunta.orden[pos])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pregunta, resultado, seleccion, elegir, comprobar, siguiente])

  if (!pregunta) {
    return (
      <div className="calc-card">
        <p className="ra-vacio">Este tema no tiene preguntas utilizables todavía.</p>
      </div>
    )
  }

  const dominio = masteryOf(pregunta.key, progress)

  const claseOpcion = (idx) => {
    const elegida = seleccion.includes(idx)
    if (!resultado) return `ra-option${elegida ? ' ra-option--sel' : ''}`
    if (pregunta.correctas.includes(idx)) return 'ra-option ra-option--correct'
    if (elegida) return 'ra-option ra-option--wrong'
    return 'ra-option ra-option--dim'
  }

  return (
    <div className="calc-card">
      <div className="ra-question-head">
        <span className="field-label" style={{ marginBottom: 0 }}>
          {pregunta.multi ? 'Varias respuestas correctas' : 'Una sola respuesta'}
          {' · teclas 1-'}{pregunta.orden.length}{' y Enter'}
        </span>
        <span className="ra-tags">
          <span className="ra-tema-tag">
            Tema {pregunta.temaNumero ?? '?'}{pregunta.temaTitulo ? ` · ${pregunta.temaTitulo}` : ''}
          </span>
          <span className="ra-mastery-tag" style={{ color: MASTERY[dominio].color }}>
            <span className="ra-dot" style={{ background: MASTERY[dominio].color }} />
            {MASTERY[dominio].label}
          </span>
        </span>
      </div>

      <p className="ra-prompt">{pregunta.enunciado}</p>

      <div className="ra-options">
        {pregunta.orden.map((idx, pos) => (
          <button
            key={idx}
            type="button"
            className={claseOpcion(idx)}
            disabled={Boolean(resultado)}
            onClick={() => elegir(idx)}
          >
            <span className="ra-option-letter">{LETRAS[pos]}</span>
            <span className="ra-option-text">{pregunta.opciones[idx].texto}</span>
            {resultado && pregunta.correctas.includes(idx) && <i className="bi bi-check-lg ra-option-icon" />}
            {resultado && seleccion.includes(idx) && !pregunta.correctas.includes(idx) && (
              <i className="bi bi-x-lg ra-option-icon" />
            )}
          </button>
        ))}
      </div>

      {!resultado && pregunta.multi && (
        <button
          className="ra-btn ra-btn--primary ra-btn--full"
          onClick={() => comprobar(seleccion)}
          disabled={seleccion.length === 0}
        >
          <i className="bi bi-check2-square" /> Comprobar {seleccion.length > 0 ? `(${seleccion.length} marcadas)` : ''}
        </button>
      )}

      {resultado && (
        <>
          <div className={`ra-feedback ${resultado.ok ? 'ra-feedback--correct' : 'ra-feedback--wrong'}`}>
            {resultado.ok ? (
              <><i className="bi bi-check-circle" /> ¡Correcto!</>
            ) : (
              <>
                <i className="bi bi-x-circle" />
                {resultado.faltan > 0 && resultado.sobran === 0
                  ? ` Te faltaban ${resultado.faltan} de ${pregunta.correctas.length} respuestas.`
                  : ' Incorrecto.'}
              </>
            )}
          </div>

          <div className="ra-info">
            <span className="ra-info-label">
              {pregunta.correctas.length > 1 ? 'Respuestas correctas' : 'Respuesta correcta'}
            </span>
            <ul className="ra-info-list">
              {pregunta.correctas.map(i => <li key={i}>{pregunta.opciones[i].texto}</li>)}
            </ul>
            {pregunta.nota && <p className="ra-info-nota"><i className="bi bi-lightbulb" /> {pregunta.nota}</p>}
          </div>

          <button className="ra-btn ra-btn--primary ra-btn--full" onClick={siguiente}>
            <i className="bi bi-arrow-right-circle" /> Siguiente pregunta (Enter)
          </button>
        </>
      )}
    </div>
  )
}

export default PracticePanel
