// ── Prueba de atención sostenida (CPT) ──────────────────────────────────────
//
// Panel privado del área de administración. Encadena las fases —instrucciones,
// práctica, pasada real y resultados— y guarda un historial local para poder
// comparar una sesión con las anteriores, que es la única comparación con
// sentido mientras no haya un baremo detrás.
//
// El historial no sale del navegador: nada de esto se escribe en Firestore.

import { useCallback, useMemo, useState } from 'react'
import {
  analizar,
  construirSecuencia,
  duracionDe,
  ensayosDe,
  media,
  secuenciaPractica,
  ISIS,
  PROPORCION_NOGO,
  PROTOCOLOS,
} from '../../utils/cpt'
import { readJson, writeValue } from '../../utils/localSettings'
import CptPasada from './CptPasada'
import CptResultados from './CptResultados'
import '../../styles/cpt.css'

const CLAVE_HISTORIAL = 'cpt.historial'
const MAX_HISTORIAL = 20

function leerHistorial() {
  const guardado = readJson(CLAVE_HISTORIAL, { sesiones: [] })
  return Array.isArray(guardado.sesiones) ? guardado.sesiones : []
}

function minutos(ms) {
  const total = Math.round(ms / 1000)
  const min = Math.floor(total / 60)
  const seg = total % 60
  return seg ? `${min} min ${seg} s` : `${min} min`
}

const MOTIVOS = {
  foco: 'La prueba se ha detenido porque la pestaña dejó de estar visible. Con la pestaña oculta el navegador congela el reloj de fotogramas, así que los tiempos de la segunda mitad no medirían nada.',
  cancelada: 'Has abandonado la prueba. No se guarda nada de lo que llevabas.',
}

export default function CptTest() {
  const [protocoloId, setProtocoloId] = useState('estandar')
  const [fase, setFase] = useState('inicio')
  const [secuencia, setSecuencia] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [motivo, setMotivo] = useState(null)
  const [historial, setHistorial] = useState(leerHistorial)

  const protocolo = PROTOCOLOS[protocoloId]

  const lanzar = useCallback(siguiente => {
    setResultado(null)
    setMotivo(null)
    setSecuencia(siguiente === 'practica'
      ? secuenciaPractica()
      : construirSecuencia(PROTOCOLOS[protocoloId]))
    setFase(siguiente)
  }, [protocoloId])

  const alAbortar = useCallback(razon => {
    setMotivo(razon)
    setSecuencia(null)
    setFase('abortada')
  }, [])

  const alTerminarPractica = useCallback(() => {
    setSecuencia(null)
    setFase('listo')
  }, [])

  const alTerminar = useCallback(datos => {
    const metricas = analizar(datos.secuencia, datos.respuestas, { descartados: datos.descartados })
    const calidad = {
      desfaseMedio: media(datos.desfases),
      desfaseMax: datos.desfases.length ? Math.max(...datos.desfases) : null,
      desenfoques: datos.desenfoques,
    }

    // En el historial va sólo el resumen: guardar los 360 ensayos de cada sesión
    // llenaría el almacenamiento local sin que nadie lo lea desde ahí.
    const sesiones = [
      {
        fecha: new Date().toISOString(),
        protocolo: PROTOCOLOS[protocoloId].nombre,
        tasaOmision: metricas.tasaOmision,
        tasaComision: metricas.tasaComision,
        trMedio: metricas.tr.media,
        cv: metricas.tr.cv,
        dPrima: metricas.dPrima,
      },
      ...historial,
    ].slice(0, MAX_HISTORIAL)

    writeValue(CLAVE_HISTORIAL, { sesiones })
    setHistorial(sesiones)
    setResultado({ metricas, calidad })
    setSecuencia(null)
    setFase('resultados')
  }, [historial, protocoloId])

  const olvidarHistorial = () => {
    writeValue(CLAVE_HISTORIAL, { sesiones: [] })
    setHistorial([])
  }

  const resumenProtocolos = useMemo(() => Object.values(PROTOCOLOS).map(p => ({
    ...p,
    ensayos: ensayosDe(p),
    duracion: minutos(duracionDe(p)),
  })), [])

  if (fase === 'practica' && secuencia) {
    return <CptPasada secuencia={secuencia} practica onFin={alTerminarPractica} onAbortar={alAbortar} />
  }

  if (fase === 'corriendo' && secuencia) {
    return <CptPasada secuencia={secuencia} onFin={alTerminar} onAbortar={alAbortar} />
  }

  if (fase === 'resultados' && resultado) {
    return (
      <div className="cpt-panel">
        <header className="cpt-cabecera">
          <h2>Resultados</h2>
          <p>
            {protocolo.nombre} · {ensayosDe(protocolo)} ensayos · {minutos(duracionDe(protocolo))}
          </p>
        </header>
        <CptResultados
          metricas={resultado.metricas}
          protocolo={protocolo}
          calidad={resultado.calidad}
          historial={historial}
          onRepetir={() => setFase('inicio')}
        />
        {historial.length > 0 && (
          <button type="button" className="cpt-olvidar" onClick={olvidarHistorial}>
            Borrar el historial de este navegador
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="cpt-panel">
      <header className="cpt-cabecera">
        <h2>Prueba de atención sostenida</h2>
        <p>
          Tarea X-CPT: pasan letras de una en una y hay que pulsar en todas menos en la
          X. Mide atención sostenida, control de impulsos y, sobre todo, lo regular que
          es el tiempo de reacción a lo largo de varios minutos.
        </p>
      </header>

      {fase === 'abortada' && (
        <div className="cpt-alerta">{MOTIVOS[motivo] || 'La prueba se interrumpió.'}</div>
      )}

      {fase === 'listo' && (
        <div className="cpt-listo">
          Práctica terminada. La prueba de verdad no avisa de los fallos y no se puede
          parar a la mitad: empieza cuando puedas dedicarle {minutos(duracionDe(protocolo))} seguidos.
        </div>
      )}

      <div className="cpt-descargo">
        <strong>No es una prueba diagnóstica.</strong> El TDAH se diagnostica con
        entrevista clínica y criterios del DSM-5 recogidos en más de un contexto, no con
        una tarea de ordenador. Un CPT aporta una medida objetiva de rendimiento
        atencional que un clínico puede usar como <em>una</em> pieza más, y ni siquiera
        los normalizados (Conners, TOVA) deciden por sí solos. Esto es una reimplementación
        del paradigma, sin baremo poblacional detrás: sirve para verse a uno mismo a lo
        largo del tiempo, no para compararse con nadie.
      </div>

      <section className="cpt-seccion">
        <h3>Cómo se hace</h3>
        <ol className="cpt-pasos">
          <li>Aparecerá una letra cada vez, durante un cuarto de segundo.</li>
          <li>Pulsa <kbd>Espacio</kbd> en <strong>cualquier letra</strong>, lo más rápido que puedas.</li>
          <li><strong>No pulses cuando salga la X.</strong> Es {Math.round(PROPORCION_NOGO * 100)} % de las veces.</li>
          <li>El hueco entre letras cambia ({ISIS.map(i => i / 1000).join(', ')} s): es parte de la prueba, no un fallo.</li>
          <li>Rápido pero sin fallar. Ir a toda velocidad dispara las X respondidas; ir sobrado dispara las omisiones.</li>
        </ol>
        <p className="cpt-nota">
          Necesitas terminar de una sentada, sin cambiar de ventana: si la pestaña se
          oculta, la prueba se anula. También puedes pulsar con el ratón o el dedo, y
          salir con <kbd>Esc</kbd>.
        </p>
      </section>

      <section className="cpt-seccion">
        <h3>Duración</h3>
        <div className="cpt-protocolos">
          {resumenProtocolos.map(opcion => (
            <button
              type="button"
              key={opcion.id}
              className={`cpt-protocolo${opcion.id === protocoloId ? ' activo' : ''}`}
              onClick={() => setProtocoloId(opcion.id)}
            >
              <strong>{opcion.nombre}</strong>
              <span>{opcion.duracion}</span>
              <span className="cpt-protocolo-nota">{opcion.ensayos} ensayos</span>
            </button>
          ))}
        </div>
        <p className="cpt-nota">
          El completo reproduce la longitud del Conners CPT. Los cortos son más cómodos,
          pero acortar la prueba es justo lo que borra el decremento de vigilancia: si lo
          que quieres ver es si te desinflas con los minutos, hacen falta los catorce.
        </p>
      </section>

      <div className="cpt-acciones">
        <button type="button" className="btn-publish" onClick={() => lanzar('corriendo')}>
          <i className="bi bi-play-fill"></i> Empezar la prueba
        </button>
        <button type="button" className="btn-sm" onClick={() => lanzar('practica')}>
          Practicar antes (18 ensayos con corrección)
        </button>
      </div>

      {historial.length > 0 && (
        <section className="cpt-seccion">
          <h3>Sesiones guardadas</h3>
          <p className="cpt-nota">
            {historial.length} {historial.length === 1 ? 'sesión guardada' : 'sesiones guardadas'} en
            este navegador. La última, el{' '}
            {new Date(historial[0].fecha).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })}.
          </p>
          <button type="button" className="cpt-olvidar" onClick={olvidarHistorial}>
            Borrar el historial de este navegador
          </button>
        </section>
      )}
    </div>
  )
}
