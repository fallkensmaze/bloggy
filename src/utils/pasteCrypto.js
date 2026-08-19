// ── Cifrado del Secure Paste ────────────────────────────────────────────────
//
// La regla del módulo: **la clave no puede derivarse de nada que llegue al servidor**.
//
// Antes se derivaba de `SHA-256("falkens-maze-paste:" + código)`, y el código era el id
// del documento. Es decir, el mismo valor que hay que enviar a Firestore para pedir el
// documento servía para descifrarlo: cualquiera con acceso a la base de datos —o a los
// registros de acceso, o a una cabecera Referer— tenía a la vez el sobre y la llave. El
// cifrado no protegía de nada; solo lo parecía.
//
// Ahora hay dos valores independientes:
//
//   - `pasteCode`: id del documento, 8 caracteres. Viaja al servidor, no abre nada.
//   - `pasteKey` : 256 bits aleatorios en base64url. Vive en el fragmento de la URL
//                  (`/ptb/CODIGO#k=...`), que los navegadores NO envían en la petición.
//
// Consecuencia de diseño, asumida: sin el enlace completo no hay descifrado. Teclear el
// código a mano ya no basta, porque un secreto tecleable de 8 caracteres son 40 bits y
// eso no aguanta un ataque sin conexión contra el ciphertext.

export const PASTE_CODE_LENGTH = 8
export const PASTE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const MAX_PASTE_CHARS = 15000
export const MAX_CIPHERTEXT_CHARS = 30000

const KEY_BYTES = 32
const IV_BYTES = 12

// Solo para descifrar los pastes creados con el esquema antiguo, que siguen vivos como
// mucho 7 días (la caducidad máxima). Pasado ese plazo desde el despliegue se puede
// borrar junto con `decryptLegacyPasteContent`.
const LEGACY_KEY_PREFIX = 'falkens-maze-paste:'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function supportsPasteCrypto() {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues)
}

export function normalizePasteCode(value) {
  return value
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, PASTE_CODE_LENGTH)
}

export function generatePasteCode(length = PASTE_CODE_LENGTH) {
  if (!supportsPasteCrypto()) {
    throw new Error('crypto-unavailable')
  }

  const randomValues = new Uint32Array(length)
  globalThis.crypto.getRandomValues(randomValues)

  let result = ''
  for (let i = 0; i < randomValues.length; i += 1) {
    result += PASTE_CODE_CHARS[randomValues[i] % PASTE_CODE_CHARS.length]
  }
  return result
}

/** Clave de 256 bits en base64url. Es lo que se guarda en el fragmento de la URL. */
export function generatePasteKey() {
  if (!supportsPasteCrypto()) {
    throw new Error('crypto-unavailable')
  }

  const bytes = new Uint8Array(KEY_BYTES)
  globalThis.crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

function bytesToBase64Url(bytes) {
  let binary = ''
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

async function importPasteKey(pasteKey, usages) {
  if (!supportsPasteCrypto()) {
    throw new Error('crypto-unavailable')
  }

  let bytes
  try {
    bytes = base64UrlToBytes(pasteKey || '')
  } catch {
    throw new Error('clave-invalida')
  }

  // La clave ya es aleatoria y uniforme, así que no hay nada que derivar: se importa tal
  // cual. Lo único que hace falta comprobar es que mide lo que debe.
  if (bytes.length !== KEY_BYTES) {
    throw new Error('clave-invalida')
  }

  return globalThis.crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'AES-GCM' },
    false,
    usages
  )
}

export async function encryptPasteContent(content, pasteKey) {
  const iv = new Uint8Array(IV_BYTES)
  globalThis.crypto.getRandomValues(iv)

  const key = await importPasteKey(pasteKey, ['encrypt'])
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(content)
  )

  return {
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
    iv: bytesToBase64Url(iv)
  }
}

export async function decryptPasteContent(ciphertext, iv, pasteKey) {
  const key = await importPasteKey(pasteKey, ['decrypt'])
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
    key,
    base64UrlToBytes(ciphertext)
  )

  return decoder.decode(decrypted)
}

/**
 * Descifra un paste del esquema antiguo, donde la clave se derivaba del id del documento.
 * Existe solo para no romper los enlaces ya repartidos; esos pastes nunca tuvieron
 * confidencialidad real frente a quien lee la base de datos. Caducan como mucho a los 7
 * días: pasado ese plazo desde el despliegue, borrar esta función y sus llamadas.
 */
export async function decryptLegacyPasteContent(ciphertext, iv, pasteCode) {
  if (!supportsPasteCrypto()) {
    throw new Error('crypto-unavailable')
  }

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${LEGACY_KEY_PREFIX}${pasteCode}`)
  )
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
    key,
    base64UrlToBytes(ciphertext)
  )

  return decoder.decode(decrypted)
}
