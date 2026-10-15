import { bytesText, textBytes } from './emergencyRadioAudio.js'

export const IDENTITY_STORAGE_KEY = 'radio_audio_identity_v1'
export const BROADCAST_IDENTITY = '0'.repeat(32)
export const validIdentity = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) && value !== BROADCAST_IDENTITY
export const identityBytes = uid => Array.from({ length: 16 }, (_, i) => parseInt(uid.slice(i * 2, i * 2 + 2), 16))
export const bytesIdentity = bytes => bytes.length === 16 ? bytes.map(b => b.toString(16).padStart(2, '0')).join('') : ''
const validBytes = b => Array.isArray(b) && b.every(v => Number.isInteger(v) && v >= 0 && v <= 255)
let temporaryIdentity

// A random browser preference, not a hardware identifier or authentication key.
// Storage failure still permits a session, with an explicitly temporary UID.
export function browserIdentity(storage, cryptoProvider = globalThis.crypto) {
  try {
    const saved = storage?.getItem(IDENTITY_STORAGE_KEY)
    if (validIdentity(saved)) return { identity: saved, persistent: true }
  } catch { /* storage is optional */ }
  const candidate = cryptoProvider.randomUUID().replaceAll('-', '').toLowerCase()
  try {
    if (storage) { storage.setItem(IDENTITY_STORAGE_KEY, candidate); return { identity: candidate, persistent: true } }
  } catch { /* use the in-memory identity */ }
  temporaryIdentity ||= candidate
  return { identity: temporaryIdentity, persistent: false }
}

export function chooseStationId(occupied, random = Math.random) {
  const free = Array.from({ length: 254 }, (_, i) => i + 1).filter(id => !occupied.has(id))
  return free.length ? free[Math.min(free.length - 1, Math.floor(random() * free.length))] : null
}

// The invalid UTF-8 prefix prevents old clients from displaying these bytes as
// a legacy text/HELLO. Old six-byte ACK parsers reject the longer ACK envelope.
export function identityHello(uid, name) { return [255, 73, 1, ...identityBytes(uid), ...textBytes(name)] }
export function readIdentityHello(payload) {
  if (!validBytes(payload) || payload.length < 20 || payload.length > 51 || payload[0] !== 255 || payload[1] !== 73 || payload[2] !== 1) return null
  const identity = bytesIdentity(payload.slice(3, 19)); const name = bytesText(Uint8Array.from(payload.slice(19)))
  return validIdentity(identity) && name?.trim() ? { identity, name } : null
}
export function identityEnvelope(source, destination, payload) {
  return [255, 73, 1, ...identityBytes(source), ...identityBytes(destination), ...payload]
}
export function readIdentityEnvelope(payload) {
  if (!validBytes(payload) || payload.length < 35 || payload[0] !== 255 || payload[1] !== 73 || payload[2] !== 1) return null
  const source = bytesIdentity(payload.slice(3, 19)); const destination = bytesIdentity(payload.slice(19, 35))
  if (!validIdentity(source) || !(validIdentity(destination) || destination === BROADCAST_IDENTITY)) return null
  return { source, destination, payload: payload.slice(35) }
}
