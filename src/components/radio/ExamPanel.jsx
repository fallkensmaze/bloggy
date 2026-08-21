import { useState, useEffect, useCallback } from 'react'
import {
  buildSimulacro,
  corrige,
  formatoReloj,
  notaSimulacro,
  OBJETIVO,
  TAMANOS_SIMULACRO,
} from '../../utils/radioExam'

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/** Clase de una opción en la revisión: correcta, marcada por error o descartada. */
function claseRevision(pregunta, elegidas, idx) {
  if (pregunta.correctas.includes(idx)) return 'ra-option ra-option--correct'
  if (elegidas.includes(idx)) return 'ra-option ra-option--wrong'
  return 'ra-option ra-option--dim'
}

/**
 * Simulacro: tanda de preguntas seguidas, sin corrección hasta el final, y luego
 * nota y revisión pregunta a pregunta. Los fallos alimentan el repaso adaptativo
 * de la práctica, igual que si se hubieran fallado allí.
 */
function ExamPanel({ pool, tamano, onTamano, onFin }) {
  const [fase, setFase] = useState('config')      // config · curso · resultado
  const [tanda, setTanda] = useState([])
  const [respuestas, setRespuestas] = useState([])
  const [actual, setActual] = useState(0)
  const [inicio, setInicio] = useState(0)
  const [ahora, setAhora] = useState(0)
  const [nota, setNota] = useState(null)
  const [confirmar, setConfirmar] = useState(false)

  // Cambiar de tema invalida la tanda en curso.
  useEffect(() => { setFase('config'); setConfirmar(false) }, [pool])

  useEffect(() => {
    if (fase !== 'curso') return
    const id = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(id)
  }, [fase])

  const arrancar = useCallback((preguntas) => {
    if (preguntas.length === 0) return
    setTanda(preguntas)
    setRespuestas(preguntas.map(() => []))
    setActual(0)
    setInicio(Date.now())
    setAhora(Date.now())
    setNota(null)
    setConfirmar(false)
    setFase('curso')
  }, [])

  const marcar = (idx) => {
    setRespuestas(prev => {
      const copia = [...prev]
      const pregunta = tanda[actual]
      const previa = copia[actual] || []
      copia[actual] = pregunta.multi
        ? (previa.includes(idx) ? previa.filter(i => i !== idx) : [...previa, idx])
        : [idx]
      return copia
    })
  }

  const terminar = () => {
    const resultado = notaSimulacro(tanda, respuestas)
    setNota({ ...resultado, ms: Date.now() - inicio })
    setFase('resultado')
    setConfirmar(false)
    onFin(tanda, respuestas)
  }

  const maximo = pool.length
  const contestadas = respuestas.filter(r => r.length > 0).length

  // ── Configuración ─────────────────────────────────────────────────────────
  if (fase === 'config') {
    return (
      <div className="calc-card">
        <span className="field-label" style={{ display: 'block', marginBottom: '10px' }}>
          Preguntas del simulacro · el mazo tiene {maximo}
        </span>
        <div className="ra-chips">
          {TAMANOS_SIMULACRO.filter(n => n < maximo).map(n => (
            <button
              key={n}
              className={`ra-btn${tamano === n ? ' ra-btn--active' : ''}`}
              onClick={() => onTamano(n)}
            >
              {n}
            </button>
          ))}
          <button
            className={`ra-btn${tamano >= maximo ? ' ra-btn--active' : ''}`}
            onClick={() => onTamano(maximo)}
          >
            Todas ({maximo})
          </button>
        </div>

        <p className="ra-nota-config">
          Las preguntas y las opciones salen barajadas y no se corrige nada hasta el final.
          El listón para darlo por preparado está en el {Math.round(OBJETIVO * 100)} %.
        </p>

        <button
          className="ra-btn ra-btn--primary ra-btn--full"
          onClick={() => arrancar(buildSimulacro({ pool, tamano: Math.min(tamano, maximo) }))}
          disabled={maximo === 0}
        >
          <i className="bi bi-play-circle" /> Empezar simulacro
        </button>
        {maximo === 0 && <p className="ra-vacio">Este tema no tiene preguntas utilizables todavía.</p>}
      </div>
    )
  }

  // ── Tanda en curso ────────────────────────────────────────────────────────
  if (fase === 'curso') {
    const pregunta = tanda[actual]
    const elegidas = respuestas[actual] || []

    return (
      <div className="calc-card">
        <div className="ra-exam-head">
          <span className="field-label" style={{ marginBottom: 0 }}>
            Pregunta {actual + 1} de {tanda.length} · {contestadas} contestadas
          </span>
          <span className="ra-reloj"><i className="bi bi-stopwatch" /> {formatoReloj(ahora - inicio)}</span>
        </div>

        <div className="ra-progress">
          <span className="ra-progress-fill" style={{ width: `${((actual + 1) / tanda.length) * 100}%` }} />
        </div>

        <p className="ra-prompt">{pregunta.enunciado}</p>
        {pregunta.multi && <p className="ra-multi-aviso"><i className="bi bi-check2-square" /> Varias respuestas correctas</p>}

        <div className="ra-options">
          {pregunta.orden.map((idx, pos) => (
            <button
              key={idx}
              type="button"
              className={`ra-option${elegidas.includes(idx) ? ' ra-option--sel' : ''}`}
              onClick={() => marcar(idx)}
            >
              <span className="ra-option-letter">{LETRAS[pos]}</span>
              <span className="ra-option-text">{pregunta.opciones[idx].texto}</span>
            </button>
          ))}
        </div>

        <div className="ra-exam-nav">
          <button className="ra-btn" onClick={() => setActual(i => Math.max(0, i - 1))} disabled={actual === 0}>
            <i className="bi bi-chevron-left" /> Anterior
          </button>
          <button
            className="ra-btn"
            onClick={() => setActual(i => Math.min(tanda.length - 1, i + 1))}
            disabled={actual === tanda.length - 1}
          >
            Siguiente <i className="bi bi-chevron-right" />
          </button>
          {confirmar ? (
            <span className="ra-confirm">
              <span>¿Terminar con {tanda.length - contestadas} sin contestar?</span>
              <button className="ra-btn ra-btn--danger" onClick={terminar}>Sí, corregir</button>
              <button className="ra-btn" onClick={() => setConfirmar(false)}>No</button>
            </span>
          ) : (
            <button
              className="ra-btn ra-btn--primary"
              onClick={() => (contestadas === tanda.length ? terminar() : setConfirmar(true))}
            >
              <i className="bi bi-clipboard-check" /> Terminar
            </button>
          )}
        </div>

        <div className="ra-grid-nav">
          {tanda.map((_, i) => (
            <button
              key={i}
              className={`ra-grid-cell${i === actual ? ' ra-grid-cell--actual' : ''}${respuestas[i]?.length ? ' ra-grid-cell--hecha' : ''}`}
              onClick={() => setActual(i)}
              title={`Pregunta ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Resultado ─────────────────────────────────────────────────────────────
  const fallos = tanda.filter((p, i) => !corrige(p, respuestas[i]).ok)

  return (
    <>
      <div className="calc-card" style={{ marginBottom: '16px' }}>
        <div className={`ra-nota ${nota.superado ? 'ra-nota--ok' : 'ra-nota--ko'}`}>
          <span className="ra-nota-valor">{nota.porcentaje}%</span>
          <span className="ra-nota-detalle">
            {nota.correctas} de {nota.total} correctas · {nota.falladas} falladas · {nota.enBlanco} en blanco
            <br />
            Tiempo {formatoReloj(nota.ms)} · listón {Math.round(OBJETIVO * 100)} %
          </span>
        </div>

        <div className="ra-exam-nav" style={{ marginTop: '16px' }}>
          <button className="ra-btn ra-btn--primary" onClick={() => setFase('config')}>
            <i className="bi bi-arrow-repeat" /> Otro simulacro
          </button>
          <button
            className="ra-btn"
            onClick={() => arrancar(buildSimulacro({ pool: fallos, tamano: fallos.length }))}
            disabled={fallos.length === 0}
          >
            <i className="bi bi-arrow-counterclockwise" /> Repetir los {fallos.length} fallos
          </button>
        </div>
      </div>

      <div className="calc-card">
        <span className="field-label" style={{ display: 'block', marginBottom: '12px' }}>Revisión</span>
        {tanda.map((pregunta, i) => {
          const elegidas = respuestas[i] || []
          const r = corrige(pregunta, elegidas)
          return (
            <div key={pregunta.key + i} className={`ra-review${r.ok ? ' ra-review--ok' : ''}`}>
              <div className="ra-review-head">
                <span className={`ra-review-badge${r.ok ? ' ra-review-badge--ok' : ''}`}>
                  {r.ok ? <i className="bi bi-check-lg" /> : <i className="bi bi-x-lg" />} {i + 1}
                </span>
                <span className="ra-review-enunciado">{pregunta.enunciado}</span>
              </div>

              {/* El acierto se resume en una línea y el fallo abre las opciones con su
                  marca, como en la práctica: leer «tu respuesta» y «la correcta» como
                  dos textos sueltos obliga a reconstruir de memoria cuál se marcó. */}
              {r.ok ? (
                <p className="ra-review-resumen">
                  Tu respuesta · {elegidas.map(idx => pregunta.opciones[idx].texto).join(' · ')}
                </p>
              ) : (
                <div className="ra-review-body">
                  {elegidas.length === 0 && <p className="ra-review-blanco">Sin contestar</p>}
                  <div className="ra-options">
                    {pregunta.orden.map((idx, pos) => (
                      <div key={idx} className={claseRevision(pregunta, elegidas, idx)}>
                        <span className="ra-option-letter">{LETRAS[pos]}</span>
                        <span className="ra-option-text">{pregunta.opciones[idx].texto}</span>
                        {pregunta.correctas.includes(idx) && <i className="bi bi-check-lg ra-option-icon" />}
                        {!pregunta.correctas.includes(idx) && elegidas.includes(idx) && (
                          <i className="bi bi-x-lg ra-option-icon" />
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Las dos correctas salen en verde marques una o las dos, así que el
                      recuento es lo único que distingue «acerté a medias» de «me dejé una». */}
                  {r.contestada && r.faltan > 0 && r.sobran === 0 && (
                    <p className="ra-review-falta">
                      <i className="bi bi-check2-square" />
                      Te faltaba{r.faltan === 1 ? '' : 'n'} {r.faltan} de {pregunta.correctas.length} respuestas
                    </p>
                  )}
                </div>
              )}

              {pregunta.nota && (
                <p className="ra-info-nota ra-review-nota"><i className="bi bi-lightbulb" /> {pregunta.nota}</p>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

export default ExamPanel
