// Live audio modem. Symbol phase comes from the received prefix, not a simulator.
import { SAMPLE_RATE, TONES, encodeFrame, decodeFrame, modulate } from './emergencyRadioAudio.js'

export const LIVE_BAUDS = [300, 600]
export const AUDIO_MODEM_DEFAULTS = { baud: 300, leadMs: 700, tailMs: 120, releaseMs: 1200, volume: 0.35, busyDb: -32 }
const PREFIX = [0xaa, 0xaa, 0xaa, 0xaa, 0xd3, 0x91]
const SHORT_WINDOW = 8 // One complete 1200 Hz cycle at 9600 samples/s.
const TONE_BALANCES = Array.from({ length: 17 }, (_, i) => 10 ** ((i * 1.5 - 12) / 10))
const makeBank = (balance = 1) => ({ balance, hi: 0, lo: 0, frame: null, byte: 0, bits: 0, total: null, score: 0, scored: 0 })

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

// Full-symbol integration with tone balancing preserves sensitivity in noise.
// A short-window path
// also searches half-sample phases and tone balances for acoustic links where
// echoes smear transitions and the two tones arrive with unequal amplitudes.
// Both paths require the exact 48-bit prefix, bounded header and valid CRC.
// Samples are never labelled with packet start/end by the caller.
export class FskAudioReceiver {
  constructor(baud = 300) {
    if (!LIVE_BAUDS.includes(baud)) throw new Error('Usa 300 o 600 bit/s.')
    this.baud = baud; this.spb = SAMPLE_RATE / baud; this.hop = this.spb / 8
    this.kernels = TONES.map(f => Array.from({ length: this.spb }, (_, i) => [Math.cos(2 * Math.PI * f * i / SAMPLE_RATE), Math.sin(2 * Math.PI * f * i / SAMPLE_RATE)]))
    this.rejected = 0; this.accepted = 0; this.prefixes = 0; this.reset()
  }
  reset() {
    this.index = 0; this.window = new Float32Array(this.spb); this.power = 0
    this.sums = [[0, 0], [0, 0]]
    this.tonePeaks = [0, 0]
    this.banks = Array.from({ length: 8 }, () => TONE_BALANCES.map(makeBank))
    this.shortWindow = new Float32Array(SHORT_WINDOW); this.shortPower = 0
    this.shortSums = [[0, 0], [0, 0]]; this.previousShortEnergies = [0, 0]
    this.shortBanks = Array.from({ length: this.spb * 2 }, () => TONE_BALANCES.map(makeBank))
    this.allBanks = [...this.banks.flat(), ...this.shortBanks.flat()]
  }
  get receiving() { return this.allBanks.some(b => b.frame) }
  // Peak symbol-window RMS in each report interval, after the capture filters.
  // These are tone levels, not acoustic SPL, calibrated SNR or proof of a frame.
  diagnostics() {
    const tonesDb = this.tonePeaks.map(power => 10 * Math.log10(Math.max(1e-10, power)))
    this.tonePeaks = [0, 0]
    return { tonesDb, prefixes: this.prefixes, rejected: this.rejected, accepted: this.accepted }
  }
  clearBank(b) { b.hi = 0; b.lo = 0; b.frame = null; b.bits = 0; b.byte = 0; b.total = null; b.score = 0; b.scored = 0 }
  symbol(b, energy0, energy1, frames) {
    const balanced0 = energy0 * b.balance
    const bit = energy1 > balanced0 ? 1 : 0
    if (!b.frame) {
      b.hi = ((b.hi << 1) | (b.lo >>> 31)) & 0xffff
      b.lo = ((b.lo << 1) | bit) >>> 0
      if (b.hi === 0xaaaa && b.lo === 0xaaaad391) { b.frame = [...PREFIX]; this.prefixes++ }
      return false
    }
    b.score += Math.abs(energy1 - balanced0) / (balanced0 + energy1 + 1e-20)
    b.scored++; b.byte = (b.byte << 1) | bit
    if (++b.bits !== 8) return false
    b.frame.push(b.byte); b.bits = 0; b.byte = 0
    if (b.frame.length === 22) {
      const length = b.frame[20] * 256 + b.frame[21]
      if (b.frame[6] !== 1 || length > 240) { this.rejected++; this.clearBank(b); return false }
      b.total = 24 + length
    }
    if (!b.total || b.frame.length !== b.total) return false
    const packet = decodeFrame(Uint8Array.from(b.frame))
    if (!packet) { this.rejected++; this.clearBank(b); return false }
    frames.push({ packet, quality: b.score / b.scored }); this.accepted++
    // All paths observe the same audio; deliver a physical frame only once.
    for (const bank of this.allBanks) this.clearBank(bank)
    return true
  }
  push(samples) {
    const frames = []
    sample: for (const x of samples) {
      const slot = this.index % this.spb; const old = this.window[slot]
      this.window[slot] = x; this.power = Math.max(0, this.power + x * x - old * old)
      const shortSlot = this.index % SHORT_WINDOW; const shortOld = this.shortWindow[shortSlot]
      this.shortWindow[shortSlot] = x; this.shortPower = Math.max(0, this.shortPower + x * x - shortOld * shortOld)
      for (let t = 0; t < 2; t++) {
        this.sums[t][0] += (x - old) * this.kernels[t][slot][0]
        this.sums[t][1] += (x - old) * this.kernels[t][slot][1]
        this.shortSums[t][0] += (x - shortOld) * this.kernels[t][slot][0]
        this.shortSums[t][1] += (x - shortOld) * this.kernels[t][slot][1]
      }
      this.index++
      const energy0 = this.shortSums[0][0] ** 2 + this.shortSums[0][1] ** 2
      const energy1 = this.shortSums[1][0] ** 2 + this.shortSums[1][1] ** 2
      const half0 = (this.previousShortEnergies[0] + energy0) / 2
      const half1 = (this.previousShortEnergies[1] + energy1) / 2
      this.previousShortEnergies[0] = energy0; this.previousShortEnergies[1] = energy1
      if (this.index >= this.spb && this.index % this.hop === 0) {
        const banks = this.banks[(this.index % this.spb) / this.hop]
        if (this.power / this.spb < 1e-10) { for (const b of banks) this.clearBank(b) }
        else {
          const energies = this.sums.map(([re, im]) => re * re + im * im)
          for (let t = 0; t < 2; t++) this.tonePeaks[t] = Math.max(this.tonePeaks[t], 2 * energies[t] / (this.spb * this.spb))
          for (const b of banks) if (this.symbol(b, energies[0], energies[1], frames)) continue sample
        }
      }
      if (this.index <= SHORT_WINDOW) continue
      // Interpolate energies, not audio: both integer and half-sample windows
      // retain quadrature phase independence. Each bank advances once per bit.
      let delivered = false
      for (let half = 0; half < 2 && !delivered; half++) {
        const banks = this.shortBanks[(this.index * 2 - 1 + half) % (this.spb * 2)]
        for (const b of banks) {
          if (this.shortPower / SHORT_WINDOW < 1e-10) this.clearBank(b)
          else if (this.symbol(b, half ? energy0 : half0, half ? energy1 : half1, frames)) { delivered = true; break }
        }
      }
    }
    return frames
  }
}
