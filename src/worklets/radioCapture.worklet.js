import { AudioResampler, FskAudioReceiver } from '../utils/radioAudioModem.js'

class RadioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.receiver = new FskAudioReceiver(options.processorOptions.baud)
    this.resampler = new AudioResampler(sampleRate)
    this.muted = false; this.count = 0; this.power = 0; this.clips = 0
    this.port.onmessage = ({ data }) => {
      if (data.type === 'mute') { this.muted = data.value; this.receiver.reset(); this.resampler.reset() }
    }
  }
  process(inputs) {
    const samples = inputs[0]?.[0]
    if (!samples?.length) return true
    for (const x of samples) { this.power += x * x; this.count++; if (Math.abs(x) > 0.98) this.clips++ }
    if (!this.muted) for (const frame of this.receiver.push(this.resampler.push(samples))) this.port.postMessage({ type: 'frame', ...frame })
    if (this.count >= sampleRate / 10) {
      this.port.postMessage({ type: 'level', db: 10 * Math.log10(Math.max(1e-10, this.power / this.count)), clipping: this.clips > this.count * 0.01,
        receiving: !this.muted && this.receiver.receiving, rejected: this.receiver.rejected, accepted: this.receiver.accepted })
      this.count = 0; this.power = 0; this.clips = 0
    }
    // The capture node emits silence. Microphone monitoring is never connected
    // to speakers, preventing an audio feedback loop.
    return true
  }
}
registerProcessor('radio-audio-capture', RadioCaptureProcessor)
