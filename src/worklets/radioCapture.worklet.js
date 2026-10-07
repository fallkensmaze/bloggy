import { AudioResampler, FskAudioReceiver } from '../utils/radioAudioModem.js'
import { SAMPLE_RATE } from '../utils/emergencyRadioAudio.js'

class RadioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.receiver = new FskAudioReceiver(options.processorOptions.baud)
    this.resampler = new AudioResampler(sampleRate)
    this.muted = false; this.count = 0; this.power = 0; this.clips = 0
    this.recording = null
    this.port.onmessage = ({ data }) => {
      if (data.type === 'mute') { this.muted = data.value; this.receiver.reset(); this.resampler.reset(); this.recording = null }
      if (data.type === 'record' && !this.muted) {
        // Explicit opt-in only: bounded to ten seconds, never a rolling recording.
        this.recording = { id: data.id, samples: new Float32Array(SAMPLE_RATE * 10), count: 0, before: this.receiver.diagnostics() }
      }
      if (data.type === 'cancel-record') this.recording = null
    }
  }
  process(inputs) {
    const samples = inputs[0]?.[0]
    if (!samples?.length) return true
    for (const x of samples) { this.power += x * x; this.count++; if (Math.abs(x) > 0.98) this.clips++ }
    if (!this.muted) {
      const pcm = this.resampler.push(samples)
      for (const frame of this.receiver.push(pcm)) this.port.postMessage({ type: 'frame', ...frame })
      if (this.recording) {
        const r = this.recording
        const n = Math.min(pcm.length, r.samples.length - r.count)
        r.samples.set(pcm.subarray(0, n), r.count); r.count += n
        if (r.count === r.samples.length) {
          this.recording = null
          this.port.postMessage({ type: 'recording', id: r.id, samples: r.samples, sampleRate: SAMPLE_RATE,
            before: r.before, after: this.receiver.diagnostics() }, [r.samples.buffer])
        }
      }
    }
    if (this.count >= sampleRate / 10) {
      this.port.postMessage({ type: 'level', db: 10 * Math.log10(Math.max(1e-10, this.power / this.count)), clipping: this.clips > this.count * 0.01,
        receiving: !this.muted && this.receiver.receiving, ...this.receiver.diagnostics(),
        recordingSeconds: this.recording ? this.recording.count / SAMPLE_RATE : null })
      this.count = 0; this.power = 0; this.clips = 0
    }
    // The capture node emits silence. Microphone monitoring is never connected
    // to speakers, preventing an audio feedback loop.
    return true
  }
}
registerProcessor('radio-audio-capture', RadioCaptureProcessor)
