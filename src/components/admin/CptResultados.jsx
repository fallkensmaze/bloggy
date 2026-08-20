// ── Resultados de la prueba de atención ─────────────────────────────────────
//
// Un CPT entrega números con muchos decimales, y esa precisión invita a leerlos
// como un diagnóstico. Aquí se presentan con lo que hace falta para no hacerlo:
// el aviso de que no diagnostican, los cortes en los que se apoya cada color, la
// calidad del propio registro y el historial, que es la única comparación
// realmente válida.

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { aCsv, interpretar, ISIS, TR_MINIMO } from '../../utils/cpt'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

const COLORES = {
  azul: '#88c0d0',
  ambar: '#ebcb8b',
  texto: '#c3ccda',
  suave: '#78849a',
  rejilla: 'rgba(120, 132, 154, 0.16)',
}

const ms = valor => (Number.isFinite(valor) ? `${Math.round(valor)} ms` : '—')
const pct = valor => (Number.isFinite(valor) ? `${(valor * 100).toFixed(1)} %` : '—')
const num = (valor, decimales = 2) =>
  Number.isFinite(valor) ? valor.toFixed(decimales) : '—'

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }))
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}

function Tarjeta({ etiqueta, valor, apoyo, nivel = 'nd' }) {
  return (
    <div className={`cpt-tarjeta cpt-nivel-${nivel}`}>
      <span className="cpt-tarjeta-etiqueta">{etiqueta}</span>
      <span className="cpt-tarjeta-valor">{valor}</span>
      {apoyo && <span className="cpt-tarjeta-apoyo">{apoyo}</span>}
    </div>
  )
}

export default function CptResultados({ metricas, protocolo, calidad, historial, onRepetir }) {
  const lectura = interpretar(metricas)
  const nivel = clave => lectura.find(l => l.clave === clave)?.nivel || 'nd'

  const datos = {
    labels: metricas.porBloque.map(b => `Bloque ${b.bloque + 1}`),
    datasets: [
      {
        label: 'TR medio (ms)',
        data: metricas.porBloque.map(b => b.tr.media),
        borderColor: COLORES.azul,
        backgroundColor: COLORES.azul,
        tension: 0.25,
        yAxisID: 'y',
      },
      {
        label: 'Errores (%)',
        data: metricas.porBloque.map(b => ((b.omisiones + b.comisiones) / b.n) * 100),
        borderColor: COLORES.ambar,
        backgroundColor: COLORES.ambar,
        borderDash: [5, 4],
        tension: 0.25,
        yAxisID: 'y1',
      },
    ],
  }

  const opciones = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: COLORES.texto, boxWidth: 12, font: { size: 11 } } },
      tooltip: { backgroundColor: '#262b34', titleColor: COLORES.texto, bodyColor: COLORES.texto },
    },
    scales: {
      x: { ticks: { color: COLORES.suave }, grid: { color: COLORES.rejilla } },
      y: {
        position: 'left',
        ticks: { color: COLORES.suave },
        grid: { color: COLORES.rejilla },
        title: { display: true, text: 'TR medio (ms)', color: COLORES.suave },
      },
      y1: {
        position: 'right',
        beginAtZero: true,
        ticks: { color: COLORES.suave },
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'Errores (%)', color: COLORES.suave },
      },
    },
  }

  const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')

  const exportarJson = () => {
    const { ensayos, ...resumen } = metricas
    descargar(
      `atencion-${sello}.json`,
      JSON.stringify({ fecha: new Date().toISOString(), protocolo: protocolo.id, calidad, resumen, ensayos }, null, 2),
      'application/json'
    )
  }

  return (
    <div className="cpt-resultados">
      <div className="cpt-descargo">
        <strong>Esto no es un diagnóstico.</strong> Un CPT mide cómo respondiste a esta
        tarea, durante estos minutos, en este ordenador. El TDAH se diagnostica con
        historia clínica y criterios del DSM-5 recogidos en más de un contexto; ninguna
        prueba de ordenador, ni siquiera las normalizadas, basta por sí sola. Los colores
        de abajo señalan dónde mirar, no lo que tienes.
      </div>

      <div className="cpt-tarjetas">
        <Tarjeta
          etiqueta="Omisiones"
          valor={pct(metricas.tasaOmision)}
          apoyo={`${metricas.omisiones} de ${metricas.nGo} letras`}
          nivel={nivel('omisiones')}
        />
        <Tarjeta
          etiqueta="Comisiones"
          valor={pct(metricas.tasaComision)}
          apoyo={`${metricas.comisiones} de ${metricas.nNogo} X`}
          nivel={nivel('comisiones')}
        />
        <Tarjeta
          etiqueta="TR medio"
          valor={ms(metricas.tr.media)}
          apoyo={`mediana ${ms(metricas.tr.mediana)}`}
        />
        <Tarjeta
          etiqueta="Variabilidad"
          valor={Number.isFinite(metricas.tr.cv) ? num(metricas.tr.cv) : '—'}
          apoyo={`CV · SD ${ms(metricas.tr.desviacion)}`}
          nivel={nivel('variabilidad')}
        />
        <Tarjeta
          etiqueta="Discriminación"
          valor={num(metricas.dPrima)}
          apoyo={`d' · sesgo β ${num(metricas.beta)}`}
          nivel={nivel('discriminacion')}
        />
        <Tarjeta
          etiqueta="Deriva"
          valor={Number.isFinite(metricas.derivaBloques) ? `${metricas.derivaBloques > 0 ? '+' : ''}${Math.round(metricas.derivaBloques)} ms` : '—'}
          apoyo="por bloque"
          nivel={nivel('vigilancia')}
        />
      </div>

      <section className="cpt-seccion">
        <h3>Qué mide cada número</h3>
        <ul className="cpt-lectura">
          {lectura.map(item => (
            <li key={item.clave} className={`cpt-nivel-${item.nivel}`}>
              <span className="cpt-lectura-punto" aria-hidden="true" />
              <div>
                <strong>{item.etiqueta}</strong>
                <p>{item.texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="cpt-seccion">
        <h3>Evolución a lo largo de la prueba</h3>
        <p className="cpt-nota">
          Si la línea azul sube hacia la derecha, el rendimiento se deteriora con los
          minutos: eso es el decremento de vigilancia, y dice más que el promedio de
          toda la sesión.
        </p>
        <div className="cpt-grafica"><Line data={datos} options={opciones} /></div>
      </section>

      <section className="cpt-seccion">
        <h3>Por intervalo entre letras</h3>
        <p className="cpt-nota">
          Los huecos largos exigen mantener el estado de alerta sin nada que lo sostenga.
          Un tiempo de reacción que se dispara sólo con {ISIS[ISIS.length - 1] / 1000} s de
          espera apunta a la vigilancia, no a la velocidad.
        </p>
        <div className="cpt-tabla-envoltorio">
          <table className="cpt-tabla">
            <thead>
              <tr><th>Intervalo</th><th>Ensayos</th><th>TR medio</th><th>SD</th><th>Omisiones</th><th>Comisiones</th></tr>
            </thead>
            <tbody>
              {metricas.porIsi.map(fila => (
                <tr key={fila.isi}>
                  <td>{fila.isi / 1000} s</td>
                  <td>{fila.n}</td>
                  <td>{ms(fila.tr.media)}</td>
                  <td>{ms(fila.tr.desviacion)}</td>
                  <td>{pct(fila.tasaOmision)}</td>
                  <td>{pct(fila.tasaComision)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cpt-nota">
          Deriva por segundo de espera: <strong>{Number.isFinite(metricas.derivaIsi) ? `${Math.round(metricas.derivaIsi)} ms/s` : '—'}</strong>.
        </p>
      </section>

      <section className="cpt-seccion">
        <h3>Calidad del registro</h3>
        <p className="cpt-nota">
          Antes de creerse las cifras conviene mirar aquí: son las condiciones en las que
          se tomaron.
        </p>
        <div className="cpt-tabla-envoltorio">
          <table className="cpt-tabla">
            <tbody>
              <tr>
                <th>Desfase del programador</th>
                <td>{ms(calidad.desfaseMedio)} de media, {ms(calidad.desfaseMax)} el peor</td>
                <td className="cpt-tabla-nota">Retraso entre la aparición prevista y la real. Se descuenta del tiempo de reacción.</td>
              </tr>
              <tr>
                <th>Ensayos descartados</th>
                <td>{metricas.descartados}</td>
                <td className="cpt-tabla-nota">Letras que el navegador nunca llegó a pintar. No cuentan como omisiones.</td>
              </tr>
              <tr>
                <th>Anticipaciones</th>
                <td>{metricas.anticipaciones}</td>
                <td className="cpt-tabla-nota">Pulsaciones antes de {TR_MINIMO} ms. Si son muchas, se respondió al ritmo y la sesión no vale.</td>
              </tr>
              <tr>
                <th>Pulsaciones repetidas</th>
                <td>{metricas.multiples}</td>
                <td className="cpt-tabla-nota">Teclas de más dentro del mismo ensayo.</td>
              </tr>
              <tr>
                <th>Pérdidas de foco</th>
                <td>{calidad.desenfoques}</td>
                <td className="cpt-tabla-nota">Veces que la ventana dejó de estar activa sin llegar a ocultarse.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {historial.length > 1 && (
        <section className="cpt-seccion">
          <h3>Sesiones anteriores</h3>
          <p className="cpt-nota">
            La comparación que sí vale. Una sola sesión no distingue el rasgo de haber
            dormido mal; la misma persona, a la misma hora, sesión tras sesión, sí.
          </p>
          <div className="cpt-tabla-envoltorio">
            <table className="cpt-tabla">
              <thead>
                <tr><th>Fecha</th><th>Protocolo</th><th>Omis.</th><th>Comis.</th><th>TR</th><th>CV</th><th>d'</th></tr>
              </thead>
              <tbody>
                {historial.map(sesion => (
                  <tr key={sesion.fecha}>
                    <td>{new Date(sesion.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{sesion.protocolo}</td>
                    <td>{pct(sesion.tasaOmision)}</td>
                    <td>{pct(sesion.tasaComision)}</td>
                    <td>{ms(sesion.trMedio)}</td>
                    <td>{num(sesion.cv)}</td>
                    <td>{num(sesion.dPrima)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="cpt-acciones">
        <button type="button" className="btn-publish" onClick={onRepetir}>
          <i className="bi bi-arrow-repeat"></i> Otra sesión
        </button>
        <button type="button" className="btn-sm" onClick={() => descargar(`atencion-${sello}.csv`, aCsv(metricas), 'text/csv')}>
          <i className="bi bi-filetype-csv"></i> Ensayos en CSV
        </button>
        <button type="button" className="btn-sm" onClick={exportarJson}>
          <i className="bi bi-filetype-json"></i> Sesión en JSON
        </button>
      </div>
    </div>
  )
}
