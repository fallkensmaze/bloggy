// AX.25 v2.2 UI frames as carried by APRS on 1200 bd AFSK. Frames here are the
// bytes between HDLC flags, after bit unstuffing, with the two FCS bytes last.

// CRC-16/X.25: reflected 0x1021, init and final XOR 0xFFFF, sent low byte first.
export function crc16x25(bytes, end = bytes.length) {
  let crc = 0xffff
  for (let i = 0; i < end; i++) {
    crc ^= bytes[i]
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1
  }
  return crc ^ 0xffff
}

export function fcsValid(bytes) {
  const n = bytes.length
  return n >= 3 && crc16x25(bytes, n - 2) === (bytes[n - 2] | (bytes[n - 1] << 8))
}

export function parseCall(text) {
  const match = /^([A-Z0-9]{1,6})(?:-(\d{1,2}))?(\*)?$/i.exec(String(text).trim())
  if (!match || Number(match[2] || 0) > 15) throw new Error(`Indicativo AX.25 no válido: ${text}`)
  return { call: match[1].toUpperCase(), ssid: Number(match[2] || 0), repeated: Boolean(match[3]) }
}

export const formatCall = ({ call, ssid }) => ssid ? `${call}-${ssid}` : call

function encodeAddress({ call, ssid, repeated }, last, command) {
  const out = new Uint8Array(7)
  for (let i = 0; i < 6; i++) out[i] = (call.charCodeAt(i) || 0x20) << 1
  out[6] = 0x60 | (ssid << 1) | (last ? 1 : 0) | (repeated || command ? 0x80 : 0)
  return out
}

// Builds a UI frame (control 0x03, PID 0xF0) with its FCS, for self-tests and test audio.
export function encodeUiFrame({ source, destination, path = [], info }) {
  const addresses = [parseCall(destination), parseCall(source), ...path.map(parseCall)]
  if (addresses.length > 10) throw new Error('AX.25 admite como máximo 8 digipetidores.')
  const payload = typeof info === 'string' ? new TextEncoder().encode(info) : Uint8Array.from(info)
  const body = new Uint8Array(addresses.length * 7 + 2 + payload.length + 2)
  addresses.forEach((a, i) => body.set(encodeAddress(a, i === addresses.length - 1, i === 0), i * 7))
  let at = addresses.length * 7
  body[at++] = 0x03; body[at++] = 0xf0; body.set(payload, at); at += payload.length
  const crc = crc16x25(body, at)
  body[at] = crc & 0xff; body[at + 1] = crc >>> 8
  return body
}

// Text in APRS is ASCII by spec, UTF-8 in practice; anything else is shown as Latin-1.
export function infoText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return String.fromCharCode(...bytes) }
}

// Returns null for anything that is not a well-formed AX.25 frame with a valid FCS.
export function decodeFrame(bytes) {
  if (bytes.length < 18 || !fcsValid(bytes)) return null
  const end = bytes.length - 2
  const addresses = []
  let at = 0
  for (;;) {
    if (at + 7 > end || addresses.length === 10) return null
    let call = ''
    for (let i = 0; i < 6; i++) {
      const b = bytes[at + i]
      if (b & 1) return null
      const c = String.fromCharCode(b >> 1)
      if (c !== ' ') { if (!/[A-Z0-9]/.test(c) || call.length < i) return null; call += c }
    }
    const s = bytes[at + 6]
    if (!call) return null
    addresses.push({ call, ssid: (s >> 1) & 0x0f, repeated: Boolean(s & 0x80) })
    at += 7
    if (s & 1) break
  }
  if (addresses.length < 2 || at >= end) return null
  const control = bytes[at++]
  const ui = (control & 0xef) === 0x03
  const pid = ui || (control & 1) === 0 ? bytes[at++] : null
  if (pid !== null && at > end) return null
  const [destination, source, ...path] = addresses
  // H bit on destination/source is the command/response flag, not "repeated".
  const info = bytes.slice(at, end)
  return { destination: { ...destination, repeated: false }, source: { ...source, repeated: false }, path, control, pid, ui, info, text: infoText(info) }
}

// Monitor format used by TNC2, Direwolf and APRS-IS: only the last repeater
// that has relayed the frame gets the asterisk.
export function tnc2(frame) {
  const lastRepeated = frame.path.map(p => p.repeated).lastIndexOf(true)
  const path = frame.path.map((p, i) => formatCall(p) + (i === lastRepeated ? '*' : ''))
  return `${formatCall(frame.source)}>${[formatCall(frame.destination), ...path].join(',')}:${frame.text}`
}
