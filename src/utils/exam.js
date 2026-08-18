/**
 * exam.js — Utilidades puras para el módulo "Examen por QR".
 * Sin dependencias de React ni Firebase; facilita testeo aislado.
 */

// ── Identificadores ──────────────────────────────────────────────────────────

/**
 * Genera un secreto de ticket aleatorio y largo.
 * Usa crypto.randomUUID() si está disponible; si no, 32 hex chars.
 */
export function generateTicketSecret() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Convierte un índice 0-based al código visible del ticket: A001, A002, ...
 * @param {number} i  Índice 0-based
 * @returns {string}
 */
export function buildDisplayCode(i) {
  return 'A' + String(i + 1).padStart(3, '0')
}

// ── Preguntas ────────────────────────────────────────────────────────────────

/**
 * Devuelve una versión de la pregunta SIN la propiedad `correcta` en las opciones.
 * Nunca exponer la respuesta correcta al cliente.
 * @param {{ id, pregunta, opciones: Array<{id,texto,correcta}>, puntos, tiempo }} pregunta
 */
export function sanitizeQuestion(pregunta) {
  return {
    id: pregunta.id,
    pregunta: pregunta.pregunta,
    opciones: pregunta.opciones.map(o => ({ id: o.id, texto: o.texto })),
  }
}

/**
 * Califica una respuesta comparándola con la opción correcta.
 * @param {{ opciones: Array<{id,correcta,puntos?}>, puntos?: number }} pregunta  Pregunta COMPLETA (con `correcta`)
 * @param {string} respuesta  id de la opción elegida por el alumno
 * @returns {{ correcta: boolean, puntos: number }}
 */
export function gradeAnswer(pregunta, respuesta) {
  const opcionCorrecta = pregunta.opciones.find(o => o.correcta)
  const correcta = respuesta === opcionCorrecta?.id
  const puntos = correcta ? (pregunta.puntos || 0) : 0
  return { correcta, puntos }
}

/**
 * Devuelve el id de la opción correcta de una pregunta, o null si no hay ninguna.
 * @param {{ opciones: Array<{id,correcta}> }} pregunta
 * @returns {string|null}
 */
export function correctOptionId(pregunta) {
  return pregunta.opciones.find(o => o.correcta)?.id ?? null
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Escapa un valor para CSV: si contiene coma, punto y coma, comilla o salto de línea,
 * lo envuelve en comillas dobles y duplica las comillas internas.
 * @param {*} value
 * @returns {string}
 */
export function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",;\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/**
 * Genera un CSV con los tickets del examen (código, secreto y URL de acceso).
 * @param {Array<{ticketSecret:string, displayCode:string}>} tickets
 * @param {string} baseUrl  URL base de la app (p. ej. 'https://example.com/')
 * @param {string} sessionId  ID de la sesión en Firestore
 * @returns {string} CSV completo con saltos \n
 */
export function buildTicketsCsv(tickets, baseUrl, sessionId) {
  const header = 'displayCode,ticketSecret,url'
  const rows = tickets.map(t => {
    const url = `${baseUrl}exam/join/${sessionId}/${t.ticketSecret}`
    return [
      csvEscape(t.displayCode),
      csvEscape(t.ticketSecret),
      csvEscape(url),
    ].join(',')
  })
  return [header, ...rows].join('\n')
}

/**
 * Genera un CSV de resultados con estadísticas por ticket.
 * @param {Array<{displayCode,nombre,entradaEn,ultimaEntrada,reingresos,uidHistory,ticketSecret}>} tickets
 * @param {Array<{ticketSecret,correcta,puntos}>} answers
 * @returns {string} CSV completo con saltos \n
 */
export function buildResultsCsv(tickets, answers) {
  const header = 'displayCode,nombre,entradaEn,ultimaEntrada,reingresos,preguntasRespondidas,correctas,puntos,uidHistory'

  /**
   * Convierte un valor de fecha (Timestamp Firestore, Date o string) a ISO string.
   * @param {*} val
   * @returns {string}
   */
  function formatDate(val) {
    if (!val) return ''
    if (typeof val.toDate === 'function') return val.toDate().toISOString()
    if (val instanceof Date) return val.toISOString()
    return String(val)
  }

  const rows = tickets.map(t => {
    const myAnswers = answers.filter(a => a.ticketSecret === t.ticketSecret)
    const preguntasRespondidas = myAnswers.length
    const correctas = myAnswers.filter(a => a.correcta === true).length
    const puntos = myAnswers.reduce((sum, a) => sum + (a.puntos || 0), 0)
    const uidHistoryStr = Array.isArray(t.uidHistory) ? t.uidHistory.join('|') : (t.uidHistory || '')

    return [
      csvEscape(t.displayCode),
      csvEscape(t.nombre),
      csvEscape(formatDate(t.entradaEn)),
      csvEscape(formatDate(t.ultimaEntrada)),
      csvEscape(t.reingresos),
      csvEscape(preguntasRespondidas),
      csvEscape(correctas),
      csvEscape(puntos),
      csvEscape(uidHistoryStr),
    ].join(',')
  })

  return [header, ...rows].join('\n')
}

// ── Descarga ─────────────────────────────────────────────────────────────────

/**
 * Descarga un string CSV como archivo en el navegador.
 * Añade BOM UTF-8 para compatibilidad con Excel.
 * @param {string} filename
 * @param {string} csvString
 */
export function downloadCsv(filename, csvString) {
  const bom = '﻿'
  const blob = new Blob([bom + csvString], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
