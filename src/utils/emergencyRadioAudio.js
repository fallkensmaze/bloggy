// A reproducible equivalent AUDIO channel, not an RF/FM receiver model.
// The channel model supplies ideal symbol timing. This is not a live modem.
export const SAMPLE_RATE = 9600
export const TONES = [1200, 2400]
export const FRAME_TYPES = { HELLO: 1, TOPOLOGY: 2, DATA: 3, ACK: 4, PROBE: 5 }
const PREFIX = [0xaa, 0xaa, 0xaa, 0xaa, 0xd3, 0x91]
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function crc16(bytes) {
  let crc = 0xffff
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

export function textBytes(text) { return encoder.encode(text) }
export function bytesText(bytes) { try { return decoder.decode(bytes) } catch { return null } }

export function encodeFrame(packet) {
  const payload = Uint8Array.from(packet.payload || [])
  if (payload.length > 240) throw new Error('La trama supera 240 bytes de contenido.')
  const header = [1, packet.type, packet.net ?? 7, packet.origin, packet.sender,
    packet.dst ?? 255, packet.next ?? 255, packet.ttl ?? 12, packet.priority ?? 2,
    (packet.epoch ?? 1) >> 8, (packet.epoch ?? 1) & 255,
    packet.seq >> 8, packet.seq & 255, packet.attempt ?? 0, payload.length >> 8, payload.length & 255]
  const body = Uint8Array.from([...header, ...payload])
  const crc = crc16(body)
  return Uint8Array.from([...PREFIX, ...body, crc >> 8, crc & 255])
}

export function decodeFrame(bytes) {
  if (bytes.length < 24 || !PREFIX.every((b, i) => bytes[i] === b)) return null
  const b = bytes.slice(6, -2)
  if (b[0] !== 1 || !Object.values(FRAME_TYPES).includes(b[1])) return null
  if (b.length !== 16 + (b[14] << 8 | b[15]) || crc16(b) !== (bytes.at(-2) << 8 | bytes.at(-1))) return null
  return { type: b[1], net: b[2], origin: b[3], sender: b[4], dst: b[5], next: b[6],
    ttl: b[7], priority: b[8], epoch: b[9] << 8 | b[10], seq: b[11] << 8 | b[12],
    attempt: b[13], payload: Array.from(b.slice(16)) }
}

export function modulate(bytes, baud = 600, phase = 0) {
  if (![100, 300, 600, 1200].includes(baud)) throw new Error('Velocidad no admitida.')
  const samplesPerBit = SAMPLE_RATE / baud
  const samples = new Float32Array(bytes.length * 8 * samplesPerBit)
  let k = 0
  for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) {
    const omega = 2 * Math.PI * TONES[(byte >> bit) & 1] / SAMPLE_RATE
    for (let j = 0; j < samplesPerBit; j++) {
      samples[k++] = Math.SQRT2 * Math.sin(phase)
      phase += omega
    }
    phase %= 2 * Math.PI
  }
  return samples
}

export function demodulate(samples, baud = 600) {
  const spb = SAMPLE_RATE / baud
  const bytes = new Uint8Array(Math.floor(samples.length / spb / 8))
  const kernels = TONES.map(freq => Array.from({ length: spb }, (_, j) =>
    [Math.cos(2 * Math.PI * freq * j / SAMPLE_RATE), Math.sin(2 * Math.PI * freq * j / SAMPLE_RATE)]))
  for (let b = 0; b < bytes.length * 8; b++) {
    const energies = kernels.map(kernel => {
      let re = 0; let im = 0
      for (let j = 0; j < spb; j++) { const x = samples[b * spb + j]; re += x * kernel[j][0]; im += x * kernel[j][1] }
      return re * re + im * im
    })
    bytes[b >> 3] = (bytes[b >> 3] << 1) | (energies[1] > energies[0] ? 1 : 0)
  }
  return bytes
}

export function seededRandom(seed) {
  let s = seed >>> 0
  return () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}

// Stateless white noise: the same receiver and time produce the same samples
// for packet decoding, listening and WAV export. Uniform distribution, RMS=1.
function noiseAt(sample, salt) {
  let x = (sample ^ Math.imul(salt, 0x45d9f3b)) | 0
  x = Math.imul(x ^ x >>> 16, 0x7feb352d)
  x = Math.imul(x ^ x >>> 15, 0x846ca68b)
  return (((x ^ x >>> 16) >>> 0) / 4294967296 * 2 - 1) * Math.sqrt(3)
}

export function receivedDb(sender, receiver, lossDb = 0) {
  const distance = Math.max(20, Math.hypot(sender.x - receiver.x, sender.y - receiver.y))
  return 18 + (sender.powerDb || 0) - 30 * Math.log10(distance / 100) - lossDb
}

export function mixReceiverAudio(history, receiverId, start, duration, noiseDb = 0, seed = 42) {
  const first = Math.round(start * SAMPLE_RATE)
  const samples = new Float32Array(Math.round(duration * SAMPLE_RATE))
  const noiseGain = 10 ** (noiseDb / 20)
  for (let i = 0; i < samples.length; i++) samples[i] = noiseGain * noiseAt(first + i, seed + receiverId * 997)
  for (const tx of history) {
    const gain = tx.gains[receiverId]
    if (gain == null || tx.end <= start || tx.start >= start + duration) continue
    const txFirst = Math.round(tx.start * SAMPLE_RATE)
    const from = Math.max(0, txFirst - first)
    const to = Math.min(samples.length, Math.round(tx.end * SAMPLE_RATE) - first)
    for (let i = from; i < to; i++) samples[i] += gain * (tx.samples[first + i - txFirst] || 0)
  }
  // A radio cannot listen while its own transmitter is keyed (half duplex).
  for (const tx of history) if (tx.sender === receiverId && tx.end > start && tx.start < start + duration) {
    const from = Math.max(0, Math.round(tx.start * SAMPLE_RATE) - first)
    const to = Math.min(samples.length, Math.round(tx.end * SAMPLE_RATE) - first)
    samples.fill(0, from, to)
  }
  return samples
}

export function normalizedAudio(samples, peak = 0.3) {
  let max = 1
  for (const x of samples) max = Math.max(max, Math.abs(x))
  return Float32Array.from(samples, x => x * peak / max)
}

export function wavBytes(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const str = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  str(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true)
  return buffer
}
