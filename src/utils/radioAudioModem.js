// Live audio modem, frame format v2. Symbol phase comes from the received
// sync word, not a simulator. The simulator keeps the uncoded v1 format.
//
// Noisy rooms were the design target: knocks, voices and hiss used to lose a
// whole frame to one wrong bit. v2 adds a K=7 rate-1/2 convolutional code
// (generators 171/133 octal) with soft-decision Viterbi decoding and a block
// interleaver, so isolated and bursty errors are corrected instead of
// rejected. Air time doubles at the same symbol rate.
import { SAMPLE_RATE, TONES, FRAME_TYPES, crc16 } from './emergencyRadioAudio.js'

export const LIVE_BAUDS = [300, 600]
export const AUDIO_MODEM_DEFAULTS = { baud: 300, leadMs: 700, tailMs: 120, releaseMs: 1200, volume: 0.35, busyDb: -32 }
const VERSION = 2
const MAX_PAYLOAD = 240
const PHASES = 8
const MAX_CANDIDATES = 4
// 64-bit sync word picked by search: against the alternating training and
// itself at any other offset its correlation never exceeds 9 of 64.
const SYNC = [0xdf, 0x9e, 0x14, 0xa3, 0x12, 0xc8, 0x3d, 0x19]
const toBits = bytes => [...bytes].flatMap(b => [7, 6, 5, 4, 3, 2, 1, 0].map(k => (b >> k) & 1))
const toBytes = bits => Uint8Array.from({ length: bits.length / 8 }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((a, b) => a * 2 + b, 0))
const SYNC_BITS = toBits(SYNC)
// 64 alternating training bits (AA bytes) settle the clock and give, with the
// sync word, 128 known symbols from which each frame measures its tone levels.
export const KNOWN = [...toBits(Array(8).fill(0xaa)), ...SYNC_BITS]
// Contrast of a symbol is uniform on [-1, 1] for noise alone (variance 1/3),
// so the sync correlation has σ = √(64/3) ≈ 4.6. 4.5σ gives roughly one false
// detection every two minutes; the header CRC then rejects it. Clean coded
// data has |contrast| ≈ 1 and σ = 8, so the score is also required to be a
// share of the total contrast that random bits reach only past 3σ.
const SYNC_THRESHOLD = 21
const SYNC_SHARE = 0.4

const G = [0o171, 0o133]
const parity = x => { x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return x & 1 }
const OUT = Array.from({ length: 128 }, (_, reg) => [parity(reg & G[0]), parity(reg & G[1])])
const codedLength = bytes => 2 * (bytes * 8 + 6)
const HEADER_BYTES = 18
const HEADER_CODED = codedLength(HEADER_BYTES)

export function convEncode(bits) {
  const out = []; let reg = 0
  for (const b of [...bits, 0, 0, 0, 0, 0, 0]) { reg = ((reg << 1) | b) & 127; out.push(...OUT[reg]) }
  return out
}

// soft[i] > 0 favours a coded 1; |soft| ≤ 1, so a click cannot outvote its
// neighbours however loud it is. Starts and ends in state 0 (six tail zeros).
export function viterbi(soft, count) {
  const steps = count + 6
  let metric = new Float64Array(64).fill(-Infinity); metric[0] = 0
  const from = new Uint8Array(steps * 64)
  for (let t = 0; t < steps; t++) {
    const r0 = soft[2 * t], r1 = soft[2 * t + 1]; const next = new Float64Array(64)
    for (let state = 0; state < 64; state++) {
      const b = state & 1; const p0 = state >> 1; const p1 = p0 | 32
      const o0 = OUT[(p0 << 1) | b], o1 = OUT[((p1 << 1) | b) & 127]
      const m0 = metric[p0] + (o0[0] ? r0 : -r0) + (o0[1] ? r1 : -r1)
      const m1 = metric[p1] + (o1[0] ? r0 : -r0) + (o1[1] ? r1 : -r1)
      if (m1 > m0) { next[state] = m1; from[t * 64 + state] = 1 } else next[state] = m0
    }
    metric = next
  }
  const bits = new Array(steps); let state = 0
  for (let t = steps - 1; t >= 0; t--) { bits[t] = state & 1; state = (state >> 1) | (from[t * 64 + state] ? 32 : 0) }
  return bits.slice(0, count)
}

// Rows of 16 written in order and sent column by column: neighbouring coded
// bits leave the air at least rows symbols apart, so a burst lands spread out.
const orders = new Map()
function interleaving(n) {
  if (!orders.has(n)) {
    const rows = Math.ceil(n / 16); const order = []
    for (let c = 0; c < 16; c++) for (let r = 0; r < rows; r++) if (r * 16 + c < n) order.push(r * 16 + c)
    orders.set(n, order)
  }
  return orders.get(n)
}
const blockBits = bytes => { const coded = convEncode(toBits(bytes)); return interleaving(coded.length).map(i => coded[i]) }
function decodeBlock(soft, bytes) {
  const order = interleaving(soft.length); const coded = new Float64Array(soft.length)
  for (let k = 0; k < soft.length; k++) coded[order[k]] = soft[k]
  return toBytes(viterbi(coded, bytes * 8))
}

// Header block: the 16 header bytes of v1 (version 2) plus their own CRC, so
// the payload length is trusted before waiting for it. Body block: payload
// plus a CRC over header and payload together.
export function encodeCodedFrame(packet) {
  const payload = Uint8Array.from(packet.payload || [])
  if (payload.length > MAX_PAYLOAD) throw new Error('La trama supera 240 bytes de contenido.')
  const header = [VERSION, packet.type, packet.net ?? 7, packet.origin, packet.sender,
    packet.dst ?? 255, packet.next ?? 255, packet.ttl ?? 12, packet.priority ?? 2,
    (packet.epoch ?? 1) >> 8, (packet.epoch ?? 1) & 255,
    packet.seq >> 8, packet.seq & 255, packet.attempt ?? 0, payload.length >> 8, payload.length & 255]
  const hcrc = crc16(header); const bcrc = crc16([...header, ...payload])
  return { header: Uint8Array.from([...header, hcrc >> 8, hcrc & 255]), body: Uint8Array.from([...payload, bcrc >> 8, bcrc & 255]) }
}
export const airBits = ({ header, body }) => [...KNOWN, ...blockBits(header), ...blockBits(body)]

function readHeader(h) {
  if (crc16(h.subarray(0, 16)) !== (h[16] << 8 | h[17]) || h[0] !== VERSION || !Object.values(FRAME_TYPES).includes(h[1])) return null
  const length = h[14] << 8 | h[15]
  return length > MAX_PAYLOAD ? null : length
}
function packetOf(h, body) {
  return { type: h[1], net: h[2], origin: h[3], sender: h[4], dst: h[5], next: h[6], ttl: h[7], priority: h[8],
    epoch: h[9] << 8 | h[10], seq: h[11] << 8 | h[12], attempt: h[13], payload: Array.from(body.subarray(0, -2)) }
}

// Seconds on air for a frame with this payload, VOX lead and tail included.
export function frameSeconds(payloadLength, { baud, leadMs, tailMs } = AUDIO_MODEM_DEFAULTS) {
  return (leadMs + tailMs) / 1000 + (KNOWN.length + HEADER_CODED + codedLength(payloadLength + 2)) / baud
}

export const voxAudio = (packet, options = {}) => voxBits(airBits(encodeCodedFrame(packet)), options)

// Any bit sequence as transmitted audio; tests use it to send frames whose
// CRC was broken before coding, which the code cannot repair.
export function voxBits(bits, options = {}) {
  const c = { ...AUDIO_MODEM_DEFAULTS, ...options }
  if (!LIVE_BAUDS.includes(c.baud)) throw new Error('Usa 300 o 600 bit/s.')
  const lead = Math.round(SAMPLE_RATE * Math.max(0, c.leadMs) / 1000)
  const tail = Math.round(SAMPLE_RATE * Math.max(0, c.tailMs) / 1000)
  const spb = SAMPLE_RATE / c.baud
  const samples = new Float32Array(lead + bits.length * spb + tail)
  const gain = Math.max(0, Math.min(0.9, c.volume))
  // Phase-continuous throughout: lead tone, data, then the trailing tone that
  // protects the last coded bits against an early VOX release.
  let phase = 0, k = 0
  const tone = (f, n) => { for (let i = 0; i < n; i++) { samples[k++] = gain * Math.sin(phase); phase = (phase + 2 * Math.PI * f / SAMPLE_RATE) % (2 * Math.PI) } }
  tone(TONES[0], lead)
  for (const b of bits) tone(TONES[b], spb)
  tone(TONES[0], tail)
  const fade = Math.min(48, lead, tail)
  for (let i = 0; i < fade; i++) { samples[i] *= i / fade; samples[samples.length - 1 - i] *= i / fade }
  return samples
}

// Stateful resampling; chunk boundaries never restart the sample clock. A
// Hamming windowed-sinc low-pass (3.84 kHz, 2.4 kHz transition) runs at the
// capture rate first: linear interpolation alone barely attenuates 7.2 and
// 8.4 kHz, which alias exactly onto the 2400 and 1200 Hz tones at 9600 Hz.
// Output times are compensated for the filter delay, so the clock is unchanged.
export class AudioResampler {
  constructor(inputRate, outputRate = SAMPLE_RATE) {
    if (!(inputRate >= outputRate)) throw new Error('Frecuencia de captura no admitida.')
    this.step = inputRate / outputRate
    const taps = inputRate === outputRate ? 1 : Math.ceil(3.3 * inputRate / (0.25 * outputRate)) | 1
    const cutoff = 0.4 * outputRate / inputRate; const mid = (taps - 1) / 2
    const kernel = Array.from({ length: taps }, (_, k) => {
      const x = k - mid
      return (x ? Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x) : 2 * cutoff) * (taps > 1 ? 0.54 - 0.46 * Math.cos(2 * Math.PI * k / (taps - 1)) : 1)
    })
    const sum = kernel.reduce((a, b) => a + b, 0)
    this.kernel = Float64Array.from(kernel, v => v / sum); this.delay = mid
    this.history = new Float64Array(taps)
    this.reset()
  }
  reset() { this.index = 0; this.next = 0; this.previous = 0; this.history.fill(0); this.at = 0 }
  push(input) {
    const out = []
    const { kernel, history } = this; const n = kernel.length
    for (const x of input) {
      history[this.at] = x
      let y = 0
      for (let k = 0, j = this.at; k < n; k++) { y += kernel[k] * history[j]; j = j ? j - 1 : n - 1 }
      this.at = this.at + 1 === n ? 0 : this.at + 1
      const t = this.index - this.delay // capture time that the filtered sample y represents
      if (t === 0) { out.push(y); this.next += this.step }
      else if (t > 0) while (this.next <= t + 1e-9) {
        const f = Math.max(0, Math.min(1, this.next - (t - 1)))
        out.push(this.previous + f * (y - this.previous)); this.next += this.step
      }
      this.previous = y; this.index++
    }
    return Float32Array.from(out)
  }
}

// Streaming receiver. Full-symbol correlation at both tones is read at eight
// phases per symbol. Each phase keeps the last 128 symbols; a soft
// correlation with the sync word finds frames without any external start
// mark, and the best phase within one symbol wins. A candidate then:
// - weighs each tone by its level measured on the 128 known symbols, which
//   compensates tone imbalance from speakers, microphones and FM emphasis;
// - tracks the sender's clock with an early/late gate on bit changes, moving
//   one phase at a time (sound cards differ by hundreds of ppm);
// - decodes the header block, trusts its length only after its CRC, then
//   decodes the body and checks the CRC over header and payload.
export class FskAudioReceiver {
  constructor(baud = 300) {
    if (!LIVE_BAUDS.includes(baud)) throw new Error('Usa 300 o 600 bit/s.')
    this.baud = baud; this.spb = SAMPLE_RATE / baud; this.hop = this.spb / PHASES
    this.kernels = TONES.map(f => Array.from({ length: this.spb }, (_, i) => [Math.cos(2 * Math.PI * f * i / SAMPLE_RATE), Math.sin(2 * Math.PI * f * i / SAMPLE_RATE)]))
    this.rejected = 0; this.accepted = 0; this.prefixes = 0; this.reset()
  }
  reset() {
    this.index = 0; this.window = new Float32Array(this.spb); this.power = 0
    this.sums = [[0, 0], [0, 0]]; this.tonePeaks = [0, 0]
    this.latest = Array.from({ length: PHASES }, () => [0, 0])
    this.history = Array.from({ length: PHASES }, () => ({ e0: new Float64Array(KNOWN.length), e1: new Float64Array(KNOWN.length), at: 0 }))
    this.candidates = []; this.peak = null
  }
  get receiving() { return this.candidates.length > 0 || this.peak !== null }
  // Peak symbol-window RMS in each report interval, after the capture filters.
  // These are tone levels, not acoustic SPL, calibrated SNR or proof of a frame.
  diagnostics() {
    const tonesDb = this.tonePeaks.map(power => 10 * Math.log10(Math.max(1e-10, power)))
    this.tonePeaks = [0, 0]
    return { tonesDb, prefixes: this.prefixes, rejected: this.rejected, accepted: this.accepted }
  }
  syncScore(h) {
    let score = 0, total = 0
    for (let i = 0; i < SYNC_BITS.length; i++) {
      const j = (h.at + KNOWN.length - SYNC_BITS.length + i) % KNOWN.length
      const c = (h.e1[j] - h.e0[j]) / (h.e1[j] + h.e0[j] + 1e-20)
      score += SYNC_BITS[i] ? c : -c; total += Math.abs(c)
    }
    return score >= SYNC_THRESHOLD && score >= SYNC_SHARE * total ? score : 0
  }
  // Tone weights from the 128 known symbols that end at this phase's latest
  // window: 1 / mean energy of each tone where the known bit selects it.
  weights(h) {
    let on0 = 0, on1 = 0, n0 = 0, n1 = 0
    for (let i = 0; i < KNOWN.length; i++) {
      const j = (h.at + i) % KNOWN.length
      if (KNOWN[i]) { on1 += h.e1[j]; n1++ } else { on0 += h.e0[j]; n0++ }
    }
    return { w0: n0 / (on0 + 1e-20), w1: n1 / (on1 + 1e-20) }
  }
  spawn() {
    const { slot, score, w0, w1 } = this.peak
    this.peak = null; this.prefixes++
    this.candidates.push({ slot, score, w0, w1, soft: [], need: HEADER_CODED, header: null,
      last: SYNC_BITS.at(-1) ? 1 : -1, timing: 0, skip: false, confidence: 0, symbols: 0 })
    if (this.candidates.length > MAX_CANDIDATES) this.candidates.splice(this.candidates.indexOf(this.candidates.reduce((a, b) => b.score < a.score ? b : a)), 1)
  }
  // Returns true when a frame was delivered (all candidates are then dropped).
  advance(c, slot, frames) {
    const weighted = ([e0, e1]) => [e0 * c.w0, e1 * c.w1]
    const [a0, a1] = weighted(this.latest[slot])
    // Tone contrast, discounted when the symbol carries more than 1.5× the
    // energy the frame's own known symbols had: a voice or knock on top of
    // the tone must not vote with full confidence. Searched over 1–3; 1.5
    // added 3 dB against voices without costing anything against hiss.
    const s = (a1 - a0) / (a1 + a0 + 1e-20) * Math.min(1, 1.5 / (a1 + a0 + 1e-20))
    c.soft.push(s); c.confidence += Math.abs(s); c.symbols++
    if (Math.sign(s) !== c.last && s !== 0) {
      // Early: the phase a hop before ended this symbol a hop sooner. Late: the
      // phase a hop after last ended the previous symbol a hop past its end.
      // Both straddle the boundary just crossed, so only a bit change informs.
      const contrast = e => { const [x0, x1] = weighted(e); return Math.abs(x1 - x0) / (x1 + x0 + 1e-20) }
      c.timing += (contrast(this.latest[(slot + PHASES - 1) % PHASES]) - contrast(this.latest[(slot + 1) % PHASES]) - c.timing) / 16
      if (Math.abs(c.timing) > 0.08) {
        // Later phase fires a hop from now, inside the symbol just read: skip it.
        const later = c.timing < 0
        c.slot = (slot + (later ? 1 : PHASES - 1)) % PHASES; c.skip = later; c.timing = 0
      }
    }
    if (s !== 0) c.last = Math.sign(s)
    if (c.soft.length < c.need) return false
    if (!c.header) {
      const header = decodeBlock(c.soft, HEADER_BYTES); const length = readHeader(header)
      if (length === null) { this.rejected++; this.candidates.splice(this.candidates.indexOf(c), 1); return false }
      c.header = header; c.soft = []; c.bodyBytes = length + 2; c.need = codedLength(c.bodyBytes)
      return false
    }
    const body = decodeBlock(c.soft, c.bodyBytes)
    if (crc16([...c.header.subarray(0, 16), ...body.subarray(0, -2)]) !== (body.at(-2) << 8 | body.at(-1))) {
      this.rejected++; this.candidates.splice(this.candidates.indexOf(c), 1); return false
    }
    this.accepted++
    frames.push({ packet: packetOf(c.header, body), quality: c.confidence / c.symbols })
    // Every candidate observed the same audio; deliver a physical frame once.
    this.candidates = []; this.peak = null
    return true
  }
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
      const phase = (this.index % this.spb) / this.hop
      if (this.power / this.spb < 1e-10) { this.candidates = []; this.peak = null; continue }
      const energies = this.sums.map(([re, im]) => re * re + im * im)
      for (let t = 0; t < 2; t++) this.tonePeaks[t] = Math.max(this.tonePeaks[t], 2 * energies[t] / (this.spb * this.spb))
      this.latest[phase] = energies
      const h = this.history[phase]
      h.e0[h.at] = energies[0]; h.e1[h.at] = energies[1]; h.at = (h.at + 1) % KNOWN.length
      // A peak spawns one symbol after it was found, when its phase fires
      // again: that is exactly the first coded symbol.
      if (this.peak && this.index - this.peak.index >= this.spb && phase === this.peak.slot) this.spawn()
      const score = this.syncScore(h)
      if (score && (!this.peak || score > this.peak.score)) this.peak = { slot: phase, score, index: this.index, ...this.weights(h) }
      for (const c of [...this.candidates]) {
        if (c.slot !== phase) continue
        if (c.skip) { c.skip = false; continue }
        if (this.advance(c, phase, frames)) break
      }
    }
    return frames
  }
}
