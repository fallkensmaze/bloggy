// ── Firma y paquete APRS del emisor privado ─────────────────────────────────
//
// El texto que se manda por radio es `<letra> <contador> <firma> <texto>`. La firma
// es HMAC-SHA256 sobre `contador|LETRA|TEXTO EN MAYÚSCULAS` con un secreto que solo
// conocen el propietario y la pasarela de Google Apps Script que vigila aprs.fi.
// El texto viaja en claro: la firma autentica, no cifra.
//
// Este módulo debe seguir siendo idéntico, bit a bit, a `normalizar_`,
// `calcularFirma_` y `autenticar_` del script de Apps Script. Una diferencia no
// lanza ningún error: el mensaje sale por radio, la pasarela lo rechaza como
// firma inválida y nadie sabe por qué. `scripts/test-aprs-sender.mjs` fija un
// vector calculado con el firmador original y recorre la cadena completa
// (firma → AX.25 → audio → demodulador → verificación).

import { encodeUiFrame, parseCall } from './ax25.js'

export const ALFABETO_FIRMA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 símbolos, sin I/O/0/1
export const LARGO_FIRMA = 6          // 6 símbolos × 5 bits = 30 bits de los 32 primeros del HMAC
export const MAX_TEXTO_APRS = 67      // límite del texto de un mensaje APRS
export const VENTANA_CONTADOR = 50    // adelanto que tolera la pasarela
export const CONTADOR_MAX = 999999    // la pasarela lee como mucho seis cifras
export const TOCALL = 'APZ001'        // APZ…: software experimental, sin registrar

// Mismo criterio que el script: espacios repetidos fuera, mayúsculas, letra en mayúscula.
export function normalizar(letra, contador, texto) {
  const t = String(texto).trim().replace(/\s+/g, ' ').toUpperCase()
  return `${contador}|${String(letra).toUpperCase()}|${t}`
}

export async function calcularFirma(secreto, letra, contador, texto, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('Este navegador no ofrece Web Crypto (requiere HTTPS).')
  if (!secreto) throw new Error('Falta el secreto compartido.')
  const enc = new TextEncoder()
  const clave = await subtle.importKey('raw', enc.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await subtle.sign('HMAC', clave, enc.encode(normalizar(letra, contador, texto))))
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  let firma = ''
  for (let i = 0; i < LARGO_FIRMA; i++) firma += ALFABETO_FIRMA[(n >>> (27 - 5 * i)) & 31]
  return firma
}

// Lo que la pasarela firmará es el texto con los espacios colapsados: se envía ya así.
export const limpiarTexto = texto => String(texto ?? '').trim().replace(/\s+/g, ' ')

// `{` abre el número de mensaje APRS (la pasarela lo recorta), `|` y `~` están
// reservados por el protocolo, y fuera del ASCII imprimible cada receptor decide
// una codificación distinta: la firma ya no coincidiría.
export function errorTexto(texto) {
  if (!texto) return 'Escribe el texto del mensaje.'
  if (/[^\x20-\x7e]/.test(texto)) return 'Solo ASCII imprimible: sin tildes, ñ ni emojis.'
  if (/[{|~]/.test(texto)) return 'Los caracteres { | ~ están reservados por APRS.'
  return null
}

/**
 * Firma un mensaje y devuelve la línea que viaja por radio.
 * Lanza Error con un texto apto para mostrar si algo no es válido.
 */
export async function construirMensaje({ secreto, letra, contador, texto }, subtle) {
  if (!/^[a-zA-Z]$/.test(String(letra ?? ''))) throw new Error('El destinatario es una sola letra A–Z.')
  if (!Number.isInteger(contador) || contador < 1 || contador > CONTADOR_MAX) {
    throw new Error(`El contador debe ser un entero entre 1 y ${CONTADOR_MAX}.`)
  }
  const cuerpo = limpiarTexto(texto)
  const problema = errorTexto(cuerpo)
  if (problema) throw new Error(problema)
  const firma = await calcularFirma(secreto, letra, contador, cuerpo, subtle)
  const linea = `${String(letra).toUpperCase()} ${contador} ${firma} ${cuerpo}`
  if (linea.length > MAX_TEXTO_APRS) {
    throw new Error(`El mensaje ocupa ${linea.length} caracteres y APRS admite ${MAX_TEXTO_APRS}: quedan ${MAX_TEXTO_APRS - (linea.length - cuerpo.length)} para el texto.`)
  }
  return { linea, letra: String(letra).toUpperCase(), contador, firma, cuerpo }
}

/**
 * Réplica de `autenticar_` de la pasarela, para comprobar en el navegador (y en
 * los tests) que lo emitido pasaría su verificación. No modifica ningún estado.
 */
export async function verificarMensaje(texto, secreto, ultimoContador = 0, subtle) {
  const m = String(texto).match(/^([a-zA-Z])\s+(\d{1,6})\s+([a-zA-Z0-9]{6})\s+(.+)$/)
  if (!m) return { ok: false, error: 'FORMATO' }
  const letra = m[1].toUpperCase()
  const contador = parseInt(m[2], 10)
  const cuerpo = m[4].trim()
  if (contador <= ultimoContador || contador > ultimoContador + VENTANA_CONTADOR) return { ok: false, error: 'CONTADOR' }
  const esperada = await calcularFirma(secreto, letra, contador, cuerpo, subtle)
  if (esperada !== m[3].toUpperCase()) return { ok: false, error: 'FIRMA' }
  return { ok: true, letra, contador, cuerpo }
}

// ── Paquete APRS ────────────────────────────────────────────────────────────

const RE_DESTINATARIO = /^[A-Z0-9-]{1,9}$/

/** Información de un mensaje APRS: `:` + destinatario relleno a 9 + `:` + texto (sin número de mensaje). */
export function infoMensajeAprs(destinatario, texto) {
  const d = String(destinatario).trim().toUpperCase()
  if (!RE_DESTINATARIO.test(d)) throw new Error('El destinatario APRS son 1–9 caracteres A–Z, 0–9 o guion.')
  return `:${d.padEnd(9, ' ')}:${texto}`
}

export const parseRuta = ruta => String(ruta ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

/** Trama AX.25 UI (con FCS) lista para `afskModulate`. */
export function tramaMensaje({ origen, destinatario, ruta = [], linea }) {
  return encodeUiFrame({ source: origen, destination: TOCALL, path: ruta, info: infoMensajeAprs(destinatario, linea) })
}

/** Valida la configuración antes de guardarla; devuelve una lista de problemas (vacía si es válida). */
export function problemasConfig({ indicativo, destinatario, ruta }) {
  const problemas = []
  try { parseCall(indicativo) } catch { problemas.push('Indicativo no válido (por ejemplo EA4ABC-7).') }
  if (!RE_DESTINATARIO.test(String(destinatario ?? '').trim().toUpperCase())) {
    problemas.push('El destinatario APRS son 1–9 caracteres A–Z, 0–9 o guion.')
  }
  const digis = parseRuta(ruta)
  if (digis.length > 8) problemas.push('Máximo 8 digipetidores.')
  for (const d of digis) { try { parseCall(d) } catch { problemas.push(`Digipetidor no válido: ${d}`) } }
  return problemas
}
