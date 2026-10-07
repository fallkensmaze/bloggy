import captureUrl from '../worklets/radioCapture.worklet.js?worker&url'
import { SAMPLE_RATE } from './emergencyRadioAudio.js'
import { voxAudio } from './radioAudioModem.js'
import { AudioStationProtocol } from './radioAudioStation.js'

const now = () => performance.now() / 1000

// All capture, demodulation and transmission are local. No audio upload, API,
// speech recognition, WebRTC peer or server is part of the radio transport.
export class BrowserRadioAudio {
  constructor(config, callbacks = {}) {
    this.config = config; this.callbacks = callbacks; this.closed = false; this.active = false
    const epoch = crypto.getRandomValues(new Uint16Array(1))[0]
    this.protocol = new AudioStationProtocol({ ...config, epoch })
    this.lastEnergy = now(); this.muteUntil = 0; this.source = null; this.receiving = false
  }
  notify() { this.callbacks.onChange?.(this.protocol.snapshot()) }
  async start() {
    const Audio = window.AudioContext || window.webkitAudioContext
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('El micrófono necesita HTTPS o localhost.')
    if (!Audio || !window.AudioWorkletNode) throw new Error('Este navegador no ofrece AudioWorklet. Prueba un navegador actualizado.')
    this.context = new Audio({ latencyHint: 'interactive' })
    try {
      await this.context.resume()
      this.stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: {
        channelCount: { ideal: 1 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        ...(this.config.deviceId ? { deviceId: { exact: this.config.deviceId } } : {})
      } })
      if (this.closed) { this.stream.getTracks().forEach(t => t.stop()); return }
      await this.context.audioWorklet.addModule(captureUrl)
      if (this.closed) return
      this.capture = new AudioWorkletNode(this.context, 'radio-audio-capture', { channelCount: 1, channelCountMode: 'explicit',
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { baud: this.config.baud } })
      this.capture.onprocessorerror = () => this.stopWithReason('El procesador de audio ha fallado. Detén y vuelve a activar la estación.')
      this.input = this.context.createMediaStreamSource(this.stream)
      this.highpass = this.context.createBiquadFilter(); this.highpass.type = 'highpass'; this.highpass.frequency.value = 300
      this.lowpass = this.context.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 3000
      this.lowpass.Q.value = 0.7
      this.input.connect(this.highpass).connect(this.lowpass).connect(this.capture).connect(this.context.destination)
      this.capture.port.onmessage = ({ data }) => {
        if (!this.active) return
        if (data.type === 'level') {
          if (now() < this.muteUntil) return
          this.receiving = data.receiving
          if (data.db > this.config.busyDb || data.receiving) this.lastEnergy = now()
          this.callbacks.onLevel?.(data)
        } else if (data.type === 'frame' && now() >= this.muteUntil) {
          this.lastEnergy = now(); this.protocol.receive(data.packet, data.quality, now()); this.notify()
        }
      }
      this.active = true
      const track = this.stream.getAudioTracks()[0]
      track.onended = () => this.stopWithReason('El micrófono se ha desconectado. Vuelve a activar la estación.')
      this.context.onstatechange = () => { if (this.active && this.context.state !== 'running') this.stopWithReason('El navegador ha suspendido el audio. Vuelve a activar la estación.') }
      this.visibilityHandler = () => { if (document.hidden) this.stopWithReason('Se ha detenido la estación al ocultar la pestaña. Mantén la app en primer plano.') }
      this.pageHandler = () => this.stop()
      document.addEventListener('visibilitychange', this.visibilityHandler)
      window.addEventListener('pagehide', this.pageHandler)
      this.timer = setInterval(() => this.tick(), 100)
      if (navigator.wakeLock?.request) {
        try { this.wakeLock = await navigator.wakeLock.request('screen'); if (this.closed) await this.wakeLock.release() } catch { /* screen lock is optional */ }
      }
      if (this.closed) return
      this.callbacks.onStarted?.({ sampleRate: this.context.sampleRate, settings: track.getSettings() }); this.notify()
    } catch (error) { await this.stop(); throw error }
  }
  tick() {
    if (!this.active || this.context.state !== 'running' || now() < this.muteUntil || this.source) return
    try {
      const entry = this.protocol.take(now(), now() - this.lastEnergy, this.receiving)
      this.notify()
      if (entry) this.transmit(entry)
    } catch (error) { this.stopWithReason(error.message) }
  }
  transmit(entry) {
    const audio = voxAudio(entry.packet, this.config)
    const buffer = this.context.createBuffer(1, audio.length, SAMPLE_RATE); buffer.copyToChannel(audio, 0)
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.context.destination)
    this.source = source; this.capture.port.postMessage({ type: 'mute', value: true })
    this.muteUntil = Infinity; this.receiving = false
    this.callbacks.onTransmit?.(true, entry.packet.type)
    source.onended = () => {
      if (!this.active || this.source !== source) return
      this.source = null; source.disconnect()
      this.protocol.finish(entry, now()); this.notify()
      this.muteUntil = now() + this.config.releaseMs / 1000
      this.releaseTimer = setTimeout(() => {
        if (!this.active) return
        this.capture.port.postMessage({ type: 'mute', value: false }); this.lastEnergy = now()
        this.callbacks.onTransmit?.(false)
      }, this.config.releaseMs)
    }
    try { source.start() } catch (error) { this.protocol.finish(entry, now(), false); throw error }
    this.notify()
  }
  send(text, destination, priority) {
    if (!this.active) throw new Error('Activa el micrófono antes de enviar.')
    this.protocol.send(text, destination, now(), priority); this.notify()
  }
  announce() {
    if (!this.active) throw new Error('Activa el micrófono antes de anunciarte.')
    this.protocol.announce(now()); this.notify()
  }
  setAutoAck(value) { this.protocol.setAutoAck(value); this.notify() }
  stopWithReason(reason) { void this.stop(); this.callbacks.onStopped?.(reason) }
  async stop() {
    if (this.closed) return
    this.closed = true; this.active = false; clearInterval(this.timer); clearTimeout(this.releaseTimer)
    document.removeEventListener('visibilitychange', this.visibilityHandler)
    window.removeEventListener('pagehide', this.pageHandler)
    if (this.source) { this.source.onended = null; try { this.source.stop() } catch { /* already ended */ } this.source.disconnect(); this.source = null }
    if (this.capture) { this.capture.port.onmessage = null; this.capture.port.close(); this.capture.disconnect() }
    this.input?.disconnect(); this.highpass?.disconnect(); this.lowpass?.disconnect()
    this.stream?.getTracks().forEach(t => { t.onended = null; t.stop() })
    this.protocol.stop(now()); this.callbacks.onTransmit?.(false); this.notify()
    if (this.context) { this.context.onstatechange = null; try { await this.context.close() } catch { /* closed */ } }
    try { await this.wakeLock?.release() } catch { /* already released */ }
  }
}
