// ── Mazos y tandas del examen de radioaficionado ────────────────────────────
//
// Lógica pura de /radioaficionado: aplanar los temas en una baraja, elegir la
// siguiente pregunta de práctica, montar un simulacro y corregir. La repetición
// espaciada se comparte con /q-codes y /morse a través de `leitner.js`; aquí la
// clave de progreso es `temaId#preguntaId`, para que dos temas puedan repetir
// una pregunta sin pisarse el historial.

import { pickWeighted, shuffle } from './leitner.js'

export const TODOS = 'todos'
export const TAMANOS_SIMULACRO = [10, 20, 40]

/** Listón de estudio, no un umbral oficial: sirve para saber si el tema está listo. */
export const OBJETIVO = 0.75

export const claveDe = (temaId, preguntaId) => `${temaId}#${preguntaId}`

/**
 * Aplana los temas cargados en una baraja de preguntas anotadas con su tema.
 * @param {Array<{id,numero,titulo,preguntas}>} temas
 * @param {string} temaId  id del tema, o TODOS
 */
export function baraja(temas = [], temaId = TODOS) {
  const elegidos = temaId === TODOS ? temas : temas.filter(t => t.id === temaId)
  return elegidos.flatMap(tema => tema.preguntas.map(pregunta => ({
    ...pregunta,
    key: claveDe(tema.id, pregunta.id),
    temaId: tema.id,
    temaNumero: tema.numero,
    temaTitulo: tema.titulo,
  })))
}

/**
 * Copia de la pregunta con las opciones barajadas. `orden` son los índices
 * originales en el orden en que se pintan, así que la respuesta sigue viviendo
 * en `correctas` y no en la posición: memorizar «la c» no sirve de nada.
 */
export function conOpcionesBarajadas(pregunta, rng = Math.random) {
  return { ...pregunta, orden: shuffle(pregunta.opciones.map((_, i) => i), rng) }
}

/**
 * Siguiente pregunta de práctica: sorteo ponderado por caja de Leitner, evitando
 * repetir la que se acaba de responder salvo que el mazo tenga una sola.
 */
export function buildPractica({ pool = [], progress = {}, excluirKey = null, rng = Math.random }) {
  if (pool.length === 0) return null
  const candidatas = pool.length > 1 && excluirKey ? pool.filter(p => p.key !== excluirKey) : pool
  return conOpcionesBarajadas(pickWeighted(candidatas, progress, rng, p => p.key), rng)
}

/** Tanda de examen: `tamano` preguntas al azar del mazo, sin repetir ninguna. */
export function buildSimulacro({ pool = [], tamano = 20, rng = Math.random }) {
  if (pool.length === 0) return []
  const n = Math.max(1, Math.min(Math.round(tamano) || pool.length, pool.length))
  return shuffle(pool, rng).slice(0, n).map(p => conOpcionesBarajadas(p, rng))
}

/**
 * Corrige una selección de índices ORIGINALES de opción.
 *
 * En las preguntas de varias respuestas se exige el conjunto exacto: en el
 * examen real marcar de más también resta, y dar por buena una respuesta a
 * medias enseñaría justo lo contrario de lo que hay que aprender.
 */
export function corrige(pregunta, seleccion = []) {
  const elegidas = [...new Set(seleccion)]
  const correctas = pregunta.correctas || []
  const aciertos = elegidas.filter(i => correctas.includes(i)).length
  const sobran = elegidas.length - aciertos
  const faltan = correctas.length - aciertos
  return {
    contestada: elegidas.length > 0,
    ok: elegidas.length > 0 && sobran === 0 && faltan === 0,
    aciertos,
    sobran,
    faltan,
  }
}

/**
 * Nota de un simulacro.
 * @param {Array} preguntas
 * @param {Array<Array<number>>} respuestas  selección por posición de la tanda
 */
export function notaSimulacro(preguntas = [], respuestas = []) {
  let correctas = 0
  let falladas = 0
  let enBlanco = 0
  preguntas.forEach((pregunta, i) => {
    const r = corrige(pregunta, respuestas[i] || [])
    if (!r.contestada) enBlanco++
    else if (r.ok) correctas++
    else falladas++
  })
  const total = preguntas.length
  const porcentaje = total === 0 ? 0 : Math.round((correctas / total) * 100)
  return { total, correctas, falladas, enBlanco, porcentaje, superado: porcentaje >= OBJETIVO * 100 }
}

// ── Explicación en un chat externo ──────────────────────────────────────────
//
// El sitio se publica estático en GitHub Pages, así que no puede llamar a
// ninguna API de chat: la clave viajaría dentro del bundle y `audit:public`
// está precisamente para que eso no ocurra. Lo que sí puede es abrir el chat
// con el prompt ya escrito, que es lo que monta `urlExplicacion`.

const LETRAS_PROMPT = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/** Chat que acepta el prompt en la propia URL y lo envía al abrirse. */
export const CHAT_BASE = 'https://chatgpt.com/?q='

/**
 * Prompt para que un asistente explique una pregunta ya corregida.
 *
 * Las letras tienen que ser LAS QUE VIO el alumno, es decir las de `orden` y no
 * las del XML: las opciones se barajan en cada tanda, así que numerar por el
 * índice original haría que la explicación hablara de una «B» que en su
 * pantalla era otra cosa. Por eso vive aquí y no suelto dentro del JSX.
 */
export function promptExplicacion(pregunta, seleccion = []) {
  const opciones = pregunta.opciones || []
  const orden = pregunta.orden?.length ? pregunta.orden : opciones.map((_, i) => i)
  const correctas = pregunta.correctas || []
  const elegidas = [...new Set(seleccion)]
  const r = corrige(pregunta, elegidas)

  const porPantalla = ids => [...ids].sort((a, b) => orden.indexOf(a) - orden.indexOf(b))
  const nombra = idx => `${LETRAS_PROMPT[orden.indexOf(idx)] || '?'}) ${opciones[idx]?.texto ?? ''}`
  const lista = orden.map((idx, pos) => `${LETRAS_PROMPT[pos]}) ${opciones[idx]?.texto ?? ''}`).join('\n')

  const varias = correctas.length > 1
  const cierre = !r.contestada
    ? `La dejé en blanco: explícame cómo se razona hasta ${varias ? 'las correctas' : 'la correcta'} y qué descarta a las demás.`
    : r.ok
      ? `Acerté, pero quiero descartar que fuera por eliminación: confírmame por qué ${varias ? 'esas son las buenas' : 'esa es la buena'} y qué falla en las otras.`
      : `Me equivoqué: explícame por qué ${varias ? 'las correctas lo son' : 'la correcta lo es'} y qué falla exactamente en lo que marqué.`

  return [
    'Estoy preparando el examen de radioaficionado en España y quiero entender esta pregunta.',
    pregunta.temaTitulo ? `Tema: ${pregunta.temaTitulo}` : null,
    `Pregunta: ${pregunta.enunciado}`,
    `Opciones:\n${lista}`,
    `${varias ? 'Respuestas correctas' : 'Respuesta correcta'}: ${porPantalla(correctas).map(nombra).join(' | ')}`,
    `Lo que marqué: ${r.contestada ? porPantalla(elegidas).map(nombra).join(' | ') : 'nada'}`,
    `${cierre} Sé breve y concreto, y responde en español.`,
  ].filter(Boolean).join('\n\n')
}

/** La misma explicación, ya como enlace al chat. */
export function urlExplicacion(pregunta, seleccion = []) {
  return CHAT_BASE + encodeURIComponent(promptExplicacion(pregunta, seleccion))
}

/** mm:ss a partir de milisegundos, para el cronómetro del simulacro. */
export function formatoReloj(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
