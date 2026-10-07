// Live audio modem. Symbol phase comes from the received prefix, not a simulator.
import { SAMPLE_RATE, TONES, encodeFrame, decodeFrame, modulate } from './emergencyRadioAudio.js'

export const LIVE_BAUDS = [300, 600]
export const AUDIO_MODEM_DEFAULTS = { baud: 300, leadMs: 700, tailMs: 120, releaseMs: 1200, volume: 0.35, busyDb: -32 }
const PREFIX = [0xaa, 0xaa, 0xaa, 0xaa, 0xd3, 0x91]

export function voxAudio(packet, options = {}) {
  const c = { ...AUDIO_MODEM_DEFAULTS, ...options }
  if (!LIVE_BAUDS.includes(c.baud)) throw new Error('Usa 300 o 600 bit/s.')
  const lead = Math.round(SAMPLE_RATE * Math.max(0, c.leadMs) / 1000)
  const tail = Math.round(SAMPLE_RATE * Math.max(0, c.tailMs) / 1000)
  const bytes = Uint8Array.from([...Array(16).fill(0xaa), ...encodeFrame(packet)])
  const phase = lead * 2 * Math.PI * TONES[0] / SAMPLE_RATE
  const data = modulate(bytes, c.baud, phase)
  const samples = new Float32Array(lead + data.length + tail)
  const gain = Math.max(0, Math.min(0.9, c.volume))
  for (let i = 0; i < lead; i++) samples[i] = gain * Math.sin(i * 2 * Math.PI * TONES[0] / SAMPLE_RATE)
  for (let i = 0; i < data.length; i++) samples[lead + i] = data[i] * gain / Math.SQRT2
  // The trailing tone protects the last CRC bits against an early VOX release.
  for (let i = 0; i < tail; i++) samples[lead + data.length + i] = gain * Math.sin(i * 2 * Math.PI * TONES[0] / SAMPLE_RATE)
  const fade = Math.min(48, lead, tail)
  for (let i = 0; i < fade; i++) { samples[i] *= i / fade; samples[samples.length - 1 - i] *= i / fade }
  return samples
}

// Stateful linear resampling; chunk boundaries never restart the sample clock.
// The browser applies an anti-alias low-pass before handing us microphone audio.
export class AudioResampler {
  constructor(inputRate, outputRate = SAMPLE_RATE) {
    if (!(inputRate >= outputRate)) throw new Error('Frecuencia de captura no admitida.')
    this.step = inputRate / outputRate
    this.reset()
  }
  reset() { this.index = 0; this.next = 0; this.previous = 0 }
  push(input) {
    const out = []
    for (const current of input) {
      if (this.index === 0) { out.push(current); this.next += this.step }
      else while (this.next <= this.index + 1e-9) {
        const f = Math.max(0, Math.min(1, this.next - (this.index - 1)))
        out.push(this.previous + f * (current - this.previous)); this.next += this.step
      }
      this.previous = current; this.index++
    }
    return Float32Array.from(out)
  }
}

// Eight symbol-phase hypotheses run in parallel. A 48-bit prefix acquires the
// byte boundary; header length bounds the candidate and CRC decides acceptance.
// Samples are never labelled with packet start/end by the caller.
export class FskAudioReceiver {
  constructor(baud = 300) {
    if (!LIVE_BAUDS.includes(baud)) throw new Error('Usa 300 o 600 bit/s.')
    this.baud = baud; this.spb = SAMPLE_RATE / baud; this.hop = this.spb / 8
    this.kernels = TONES.map(f => Array.from({ length: this.spb }, (_, i) => [Math.cos(2 * Math.PI * f * i / SAMPLE_RATE), Math.sin(2 * Math.PI * f * i / SAMPLE_RATE)]))
    this.rejected = 0; this.accepted = 0; this.reset()
  }
  reset() {
    this.index = 0; this.window = new Float32Array(this.spb); this.power = 0
    this.sums = [[0, 0], [0, 0]]
    this.banks = Array.from({ length: 8 }, () => ({ hi: 0, lo: 0, quality: 0, frame: null, byte: 0, bits: 0, total: null, score: 0, scored: 0 }))
  }
  get receiving() { return this.banks.some(b => b.frame) }
  clearBank(b) { b.hi = 0; b.lo = 0; b.frame = null; b.bits = 0; b.byte = 0; b.total = null; b.score = 0; b.scored = 0 }
  push(samples) {
    const frames = []
    for (const x of samples) {
      const slot = this.index % this.spb; const old = this.window[slot]
      this.window[slot] = x; this.power = Math.max(0, this.power + x * x - old * old)
      for (let t = 0; t < 2; t++) {
        this.sums[t][0] += (x - old) * this.kernels[t][slot][0]
        this.sums[t][1] += (x - old) * this.kernels[t][slot][1]
      }
      this.index++
      if (this.index < this.spb || this.index % this.hop) continue
      const b = this.banks[(this.index % this.spb) / this.hop]
      if (this.power / this.spb < 1e-10) { this.clearBank(b); continue }
      const energies = this.sums.map(([re, im]) => re * re + im * im)
      const confidence = Math.abs(energies[1] - energies[0]) / (energies[0] + energies[1] + 1e-20)
      const bit = energies[1] > energies[0] ? 1 : 0
      b.quality = b.quality * 0.95 + confidence * 0.05
      if (!b.frame) {
        b.hi = ((b.hi << 1) | (b.lo >>> 31)) & 0xffff
        b.lo = ((b.lo << 1) | bit) >>> 0
        if (b.hi === 0xaaaa && b.lo === 0xaaaad391 && b.quality > 0.55) b.frame = [...PREFIX]
        continue
      }
      b.score += confidence; b.scored++; b.byte = (b.byte << 1) | bit
      if (++b.bits !== 8) continue
      b.frame.push(b.byte); b.bits = 0; b.byte = 0
      if (b.frame.length === 22) {
        const length = b.frame[20] * 256 + b.frame[21]
        if (b.frame[6] !== 1 || length > 240) { this.rejected++; this.clearBank(b); continue }
        b.total = 24 + length
      }
      if (!b.total || b.frame.length !== b.total) continue
      const packet = decodeFrame(Uint8Array.from(b.frame))
      if (packet) {
        frames.push({ packet, quality: b.score / b.scored })
        this.accepted++
        // Other phases of the same physical frame must not deliver duplicates.
        for (const bank of this.banks) this.clearBank(bank)
      } else { this.rejected++; this.clearBank(b) }
    }
    return frames
  }
}
