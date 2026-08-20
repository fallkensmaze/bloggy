// ── Pasada de la prueba de atención ─────────────────────────────────────────
//
// Todo lo que mide tiempo está aquí. El reloj es `requestAnimationFrame`, no
// `setTimeout`: los temporizadores encadenados acumulan retraso y al cabo de 360
// ensayos la prueba dura otra cosa. Cada letra guarda el instante del fotograma
// en el que se pintó de verdad, y el tiempo de reacción se mide contra ese
// instante y no contra el horario previsto, así que un fotograma tardío alarga
// el hueco pero no inventa milisegundos de reacción.
//
// Los ensayos que el navegador se saltó enteros no se anotan como omisiones sino
// como descartados: nadie puede responder a una letra que nunca llegó a la
// pantalla, y contarla como despiste sería inventarse un síntoma.

import { useEffect, useRef, useState } from 'react'
import { avanzarReloj, calendario } from '../../utils/cpt'

/**
 * Instante de la pulsación.
 *
 * `timeStamp` de un evento de confianza lo pone el navegador cuando llega el
 * evento del sistema, antes de que la pestaña tenga tiempo de atenderlo, así que
 * es más fiel que leer el reloj dentro del manejador. Si el navegador lo diera
 * en otra época (los antiguos usaban tiempo Unix), la resta saldría absurda y se
 * cae al reloj de la pestaña.
 */
function marcaDe(evento) {
  const ahora = performance.now()
  const marca = evento.timeStamp
  return Number.isFinite(marca) && Math.abs(ahora - marca) < 5000 ? marca : ahora
}

export default function CptPasada({ secuencia, practica = false, onFin, onAbortar }) {
  const [pantalla, setPantalla] = useState({ indice: -1, visible: false })
  const [cuenta, setCuenta] = useState(3)
  const [aviso, setAviso] = useState(null)
  const pantallaRef = useRef(pantalla)
  const barraRef = useRef(null)

  // Las salidas viven en refs para que el motor dependa sólo de la secuencia. Si
  // el efecto dependiera de las funciones, un render del padre con una función
  // nueva reiniciaría la prueba a mitad de pasada.
  const finRef = useRef(onFin)
  const abortarRef = useRef(onAbortar)
  finRef.current = onFin
  abortarRef.current = onAbortar

  useEffect(() => {
    const inicios = calendario(secuencia)
    const total = inicios[inicios.length - 1] + secuencia[secuencia.length - 1].isi

    const estado = {
      t0: 0,
      indice: -1,
      onsets: new Array(secuencia.length).fill(null),
      desfases: [],
      respuestas: [],
      descartados: [],
      desenfoques: 0,
    }

    let raf = 0
    let cuentaAtras = 0
    let limpiaAviso = 0
    let vivo = true

    const pintar = (indice, visible) => {
      const previo = pantallaRef.current
      if (previo.indice === indice && previo.visible === visible) return
      pantallaRef.current = { indice, visible }
      setPantalla({ indice, visible })
    }

    const avisar = (tipo, texto) => {
      if (!practica) return
      setAviso({ tipo, texto })
      clearTimeout(limpiaAviso)
      limpiaAviso = setTimeout(() => setAviso(null), 700)
    }

    const terminar = () => {
      if (!vivo) return
      vivo = false
      cancelAnimationFrame(raf)
      finRef.current({
        secuencia,
        respuestas: estado.respuestas,
        descartados: estado.descartados,
        desfases: estado.desfases,
        desenfoques: estado.desenfoques,
      })
    }

    const abortar = motivo => {
      if (!vivo) return
      vivo = false
      cancelAnimationFrame(raf)
      clearInterval(cuentaAtras)
      abortarRef.current(motivo)
    }

    const tick = ahora => {
      if (!vivo) return
      if (!estado.t0) estado.t0 = ahora
      const t = ahora - estado.t0

      const paso = avanzarReloj({ indice: estado.indice, t, inicios })

      if (paso.avances > 0) {
        for (let j = estado.indice + 1; j <= paso.indice; j++) {
          estado.onsets[j] = ahora
          estado.desfases.push(t - inicios[j])
        }
        estado.descartados.push(...paso.descartados)

        if (practica) {
          const cerrado = paso.indice - paso.avances
          if (cerrado >= 0) {
            const ensayo = secuencia[cerrado]
            const respondido = estado.respuestas.some(r => r.indice === cerrado)
            if (!ensayo.nogo && !respondido) avisar('fallo', 'Se te ha escapado')
            else if (ensayo.nogo && !respondido) avisar('bien', 'Bien, era una X')
          }
        }
        estado.indice = paso.indice
      }

      pintar(estado.indice, paso.visible)
      // La barra se toca por el nodo y no por estado: sesenta renders por segundo
      // durante catorce minutos competirían con el propio bucle.
      if (barraRef.current) {
        barraRef.current.style.width = `${Math.min(100, (t / total) * 100).toFixed(2)}%`
      }

      if (t >= total) {
        terminar()
        return
      }
      raf = requestAnimationFrame(tick)
    }

    const responder = evento => {
      if (!vivo || estado.indice < 0) return
      const onset = estado.onsets[estado.indice]
      if (onset == null) return
      estado.respuestas.push({ indice: estado.indice, tr: marcaDe(evento) - onset })
      avisar(
        secuencia[estado.indice].nogo ? 'fallo' : 'bien',
        secuencia[estado.indice].nogo ? 'Era una X' : 'Bien'
      )
    }

    const onKeyDown = evento => {
      if (evento.key === 'Escape') {
        abortar('cancelada')
        return
      }
      if (evento.code !== 'Space' && evento.key !== ' ') return
      evento.preventDefault()
      if (evento.repeat) return
      responder(evento)
    }

    const onPointerDown = evento => {
      evento.preventDefault()
      responder(evento)
    }

    // Con la pestaña oculta el navegador congela el bucle de fotogramas: la
    // prueba no se pausa, se corrompe. Mejor tirarla que entregar un número que
    // mide la distracción de mirar otra ventana.
    const onVisibilidad = () => {
      if (document.hidden) abortar('foco')
    }
    const onBlur = () => { estado.desenfoques++ }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibilidad)

    let restante = 3
    setCuenta(restante)
    cuentaAtras = setInterval(() => {
      restante -= 1
      setCuenta(restante)
      if (restante <= 0) {
        clearInterval(cuentaAtras)
        raf = requestAnimationFrame(tick)
      }
    }, 1000)

    return () => {
      vivo = false
      cancelAnimationFrame(raf)
      clearInterval(cuentaAtras)
      clearTimeout(limpiaAviso)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibilidad)
    }
  }, [secuencia, practica])

  const letra = pantalla.visible && pantalla.indice >= 0
    ? secuencia[pantalla.indice].letra
    : null

  return (
    <div className="cpt-pasada" role="application" aria-label="Prueba en curso">
      <div className="cpt-escena">
        {cuenta > 0 ? (
          <div className="cpt-cuenta">{cuenta}</div>
        ) : (
          <>
            <span className="cpt-fijacion" aria-hidden="true" />
            <span className="cpt-letra">{letra}</span>
          </>
        )}
      </div>

      {aviso && <div className={`cpt-aviso cpt-aviso-${aviso.tipo}`}>{aviso.texto}</div>}

      <div className="cpt-pie">
        {practica && <span className="cpt-pie-nota">Práctica · no se puntúa</span>}
        <span className="cpt-pie-nota">Espacio para responder · Esc para abandonar</span>
      </div>

      <div className="cpt-barra"><div ref={barraRef} className="cpt-barra-relleno" /></div>
    </div>
  )
}
