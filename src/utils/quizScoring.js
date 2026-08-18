// Lógica pura de puntuación del quiz en vivo.
//
// El scoring lo hace el HOST, no el jugador: el jugador solo escribe su opción
// elegida (`respuesta`) y el host recalcula los puntos de forma IDEMPOTENTE a partir
// del array de respuestas + las preguntas del quiz. Recalcular el total absoluto (en
// vez de sumar incrementos) hace que reabrir/repetir una pregunta no duplique puntos.
//
// Esto permite que las reglas Firestore prohíban al jugador escribir `puntos`: ya no
// puede inflarse la puntuación, porque la puntuación no la calcula su navegador.

export function isAnswerCorrect(pregunta, respuesta) {
  if (!pregunta || !respuesta) return false
  const correcta = pregunta.opciones?.find((op) => op.correcta)
  return !!correcta && correcta.id === respuesta
}

export function questionPoints(pregunta, respuesta) {
  return isAnswerCorrect(pregunta, respuesta) ? (pregunta?.puntos || 0) : 0
}

// respuestas[i] = { respuesta } | null   (indexado por posición de pregunta)
export function totalPoints(preguntas, respuestas) {
  if (!Array.isArray(preguntas) || !Array.isArray(respuestas)) return 0
  return preguntas.reduce((sum, pregunta, i) => {
    const r = respuestas[i]
    return sum + questionPoints(pregunta, r && r.respuesta)
  }, 0)
}

export function countCorrect(preguntas, respuestas) {
  if (!Array.isArray(preguntas) || !Array.isArray(respuestas)) return 0
  return preguntas.reduce((n, pregunta, i) => {
    const r = respuestas[i]
    return n + (isAnswerCorrect(pregunta, r && r.respuesta) ? 1 : 0)
  }, 0)
}
