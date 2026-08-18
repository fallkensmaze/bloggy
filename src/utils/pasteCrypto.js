export const PASTE_CODE_LENGTH = 8
export const PASTE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const MAX_PASTE_CHARS = 15000
export const MAX_CIPHERTEXT_CHARS = 30000

const KEY_PREFIX = 'falkens-maze-paste:'
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

async function derivePasteKey(pasteCode, usages) {
  if (!supportsPasteCrypto()) {
    throw new Error('crypto-unavailable')
  }

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${KEY_PREFIX}${pasteCode}`)
  )

  return globalThis.crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    usages
  )
}

export async function encryptPasteContent(content, pasteCode) {
  const iv = new Uint8Array(12)
  globalThis.crypto.getRandomValues(iv)

  const key = await derivePasteKey(pasteCode, ['encrypt'])
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

export async function decryptPasteContent(ciphertext, iv, pasteCode) {
  const key = await derivePasteKey(pasteCode, ['decrypt'])
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
    key,
    base64UrlToBytes(ciphertext)
  )

  return decoder.decode(decrypted)
}
