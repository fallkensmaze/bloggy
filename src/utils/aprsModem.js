// Bell 202 AFSK at 1200 bd (mark 1200 Hz, space 2200 Hz), NRZI and HDLC, the
// physical layer of VHF APRS. Pure and sample-rate agnostic so the same code
// runs in the AudioWorklet, on decoded WAV files and in the Node suite.
import { fcsValid } from './ax25.js'

export const AFSK = Object.freeze({ baud: 1200, mark: 1200, space: 2200 })
// FM receivers de-emphasise audio, so the 2200 Hz tone usually arrives weaker
// than the 1200 Hz one (or stronger, if the source was not pre-emphasised).
// One slicer per assumed space/mark gain: whichever matches the radio decodes.
export const TWIST_DB = Object.freeze([-9, -6, -3, 0, 3, 6, 9])
const MIN_FRAME = 18, MAX_FRAME_BITS = 8 * 400

class HdlcDecoder {
  constructor() { this.bits = []; this.ones = 0; this.sync = false; this.preamble = 0 }
  // Returns 'flag', 'preamble' or a candidate frame (bytes with valid FCS).
  push(bit) {
    if (bit) {
      if (++this.ones >= 7) { this.sync = false; this.bits.length = 0; this.preamble = 0; return null }
    } else {
      const ones = this.ones; this.ones = 0
      if (ones === 5) return null // stuffed zero
      if (ones === 6) return this.flag()
    }
    if (this.sync) { this.bits.push(bit); if (this.bits.length > MAX_FRAME_BITS) { this.sync = false; this.bits.length = 0 } }
    return null
  }
  flag() {
    // The opening zero and six ones of this flag were stored as data.
    const n = this.bits.length - 7
    const wasSync = this.sync
    this.sync = true
    let result = null
    if (wasSync && n === 0) result = ++this.preamble >= 2 ? 'preamble' : 'flag'
    else if (wasSync && n >= MIN_FRAME * 8 && n % 8 === 0) {
      const bytes = new Uint8Array(n / 8)
      for (let i = 0; i < n; i++) if (this.bits[i]) bytes[i >> 3] |= 1 << (i & 7)
      if (fcsValid(bytes)) result = bytes
    }
    if (n !== 0) this.preamble = 0
    this.bits.length = 0
    return result
  }
}

class Slicer {
  constructor(step, gain, twistDb) {
    this.step = step; this.gain = gain; this.twistDb = twistDb
    this.phase = 0; this.level = 0; this.sampled = 0; this.hdlc = new HdlcDecoder()
  }
  push(mark, space) {
    const level = mark > this.gain * space ? 1 : 0
    // Data transitions belong at phase 0; pull the bit clock towards them,
    // gently while a frame is being received and quickly while searching.
    if (level !== this.level) { this.phase *= this.hdlc.sync ? 0.75 : 0.5; this.level = level }
    this.phase += this.step
    if (this.phase < 0.5) return null
    this.phase -= 1
    const bit = level === this.sampled ? 1 : 0 // NRZI: no change is a one
    this.sampled = level
    return this.hdlc.push(bit)
  }
}

export class AfskDemodulator {
  constructor(sampleRate, { twists = TWIST_DB } = {}) {
    if (!(sampleRate >= 8000)) throw new Error('La frecuencia de muestreo debe ser de al menos 8 kHz.')
    this.sampleRate = sampleRate
    this.window = Math.round(sampleRate / AFSK.baud)
    this.ring = Array.from({ length: 4 }, () => new Float64Array(this.window))
    this.sums = new Float64Array(4)
    this.at = 0; this.n = 0
    this.wMark = 2 * Math.PI * AFSK.mark / sampleRate; this.wSpace = 2 * Math.PI * AFSK.space / sampleRate
    this.slicers = twists.map(db => new Slicer(AFSK.baud / sampleRate, 10 ** (-db / 20), db))
    this.dc = 0; this.dcAlpha = 1 - Math.exp(-2 * Math.PI * 100 / sampleRate)
    this.pending = []; this.recent = []
    this.lastCarrier = -Infinity
    this.stats = { frames: 0, duplicates: 0 }
  }
  reset() {
    const fresh = new AfskDemodulator(this.sampleRate, { twists: this.slicers.map(s => s.twistDb) })
    Object.assign(this, fresh)
  }
  get receiving() { return this.n - this.lastCarrier < this.sampleRate * 0.3 || this.pending.length > 0 }

  // Feeds mono samples; returns frames completed so far as { bytes, twists, time }.
  push(samples) {
    const out = []
    const { ring, sums, window, wMark, wSpace } = this
    for (let k = 0; k < samples.length; k++) {
      // One-pole high-pass: a DC offset would otherwise leak into the 2200 Hz
      // correlator, whose one-bit window does not hold a whole number of cycles.
      this.dc += this.dcAlpha * (samples[k] - this.dc)
      const x = samples[k] - this.dc
      const t = this.n
      const v0 = x * Math.cos(wMark * t), v1 = x * Math.sin(wMark * t)
      const v2 = x * Math.cos(wSpace * t), v3 = x * Math.sin(wSpace * t)
      const i = this.at
      sums[0] += v0 - ring[0][i]; ring[0][i] = v0
      sums[1] += v1 - ring[1][i]; ring[1][i] = v1
      sums[2] += v2 - ring[2][i]; ring[2][i] = v2
      sums[3] += v3 - ring[3][i]; ring[3][i] = v3
      this.at = i + 1 === window ? 0 : i + 1
      // Sliding sums drift by rounding error; rebuild them once per second.
      if (t % this.sampleRate === 0) for (let c = 0; c < 4; c++) sums[c] = ring[c].reduce((a, b) => a + b, 0)
      const mark = Math.hypot(sums[0], sums[1]), space = Math.hypot(sums[2], sums[3])
      for (const slicer of this.slicers) {
        const r = slicer.push(mark, space)
        if (r === null || r === 'flag') continue
        this.lastCarrier = t
        if (r !== 'preamble') this.collect(r, slicer.twistDb, t)
      }
      this.n = t + 1
      this.flush(out)
    }
    return out
  }
  collect(bytes, twistDb, t) {
    const key = bytes.join(',')
    const hit = this.pending.find(p => p.key === key)
    if (hit) { hit.twists.push(twistDb); return }
    // A frame decoded again by a slower slicer after it was reported is the same transmission.
    if (this.recent.some(r => r.key === key && t - r.t < this.sampleRate * 0.1)) { this.stats.duplicates++; return }
    this.pending.push({ key, bytes, twists: [twistDb], t })
  }
  // Slicers finish the same frame within a few samples; wait 20 ms to count them all.
  flush(out) {
    const t = this.n
    while (this.pending.length && t - this.pending[0].t >= this.sampleRate * 0.02) {
      const p = this.pending.shift()
      this.recent = this.recent.filter(r => t - r.t < this.sampleRate * 0.1)
      this.recent.push({ key: p.key, t: p.t })
      this.stats.frames++
      out.push({ bytes: p.bytes, twists: p.twists.sort((a, b) => a - b), time: p.t / this.sampleRate })
    }
  }
  // Ends the input (end of a file): reports frames still waiting for slicer votes.
  finish() {
    const out = []
    this.n += this.sampleRate
    this.flush(out)
    return out
  }
}

function stuffedBits(bytes) {
  const bits = []
  let ones = 0
  for (const byte of bytes) for (let k = 0; k < 8; k++) {
    const bit = (byte >> k) & 1
    bits.push(bit)
    if (bit) { if (++ones === 5) { bits.push(0); ones = 0 } } else ones = 0
  }
  return bits
}

// AFSK audio for one or more frames (with FCS), as a TNC would key it. Options
// let the suite reproduce what real radios do: twist, clock error, start phase.
export function afskModulate(frames, { sampleRate = 48000, baud = AFSK.baud, preambleFlags = 40, tailFlags = 4, amplitude = 0.5,
  spaceGainDb = 0, startPhase = 0 } = {}) {
  const flag = [0, 1, 1, 1, 1, 1, 1, 0]
  const bits = []
  for (let i = 0; i < preambleFlags; i++) bits.push(...flag)
  frames.forEach((frame, i) => {
    bits.push(...stuffedBits(frame))
    for (let k = 0; k < (i === frames.length - 1 ? tailFlags : 3); k++) bits.push(...flag)
  })
  const perBit = sampleRate / baud
  const out = new Float32Array(Math.ceil(bits.length * perBit))
  const spaceGain = 10 ** (spaceGainDb / 20)
  let tone = 1, phase = startPhase, s = 0
  bits.forEach((bit, b) => {
    if (!bit) tone ^= 1 // NRZI: a zero changes tone
    const f = tone ? AFSK.mark : AFSK.space, a = amplitude * (tone ? 1 : spaceGain)
    for (const end = Math.round((b + 1) * perBit); s < end; s++) {
      out[s] = a * Math.sin(phase); phase += 2 * Math.PI * f / sampleRate
    }
  })
  return out
}
