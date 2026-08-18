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

/** mm:ss a partir de milisegundos, para el cronómetro del simulacro. */
export function formatoReloj(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
