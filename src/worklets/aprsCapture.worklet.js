import { AfskDemodulator } from '../utils/aprsModem.js'

// Demodulates at the context's native rate: no resampling, no recording, and
// nothing is played back, so the microphone never reaches the speakers.
class AprsCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.demod = new AfskDemodulator(sampleRate)
    this.count = 0; this.power = 0; this.clips = 0
  }
  process(inputs) {
    const samples = inputs[0]?.[0]
    if (!samples?.length) return true
    for (const x of samples) { this.power += x * x; this.count++; if (Math.abs(x) > 0.98) this.clips++ }
    for (const frame of this.demod.push(samples)) this.port.postMessage({ type: 'frame', ...frame }, [frame.bytes.buffer])
    if (this.count >= sampleRate / 10) {
      this.port.postMessage({ type: 'level', db: 10 * Math.log10(Math.max(1e-10, this.power / this.count)),
        clipping: this.clips > this.count * 0.01, receiving: this.demod.receiving })
      this.count = 0; this.power = 0; this.clips = 0
    }
    return true
  }
}
registerProcessor('aprs-capture', AprsCaptureProcessor)
