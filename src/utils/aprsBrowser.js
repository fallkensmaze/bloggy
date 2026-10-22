import captureUrl from '../worklets/aprsCapture.worklet.js?worker&url'
import { AfskDemodulator } from './aprsModem.js'

// Receive only: the microphone is demodulated inside an AudioWorklet and
// nothing is uploaded, recorded or forwarded to APRS-IS.
export class BrowserAprsReceiver {
  constructor({ deviceId = '' } = {}, callbacks = {}) {
    this.deviceId = deviceId; this.callbacks = callbacks; this.closed = false; this.active = false
  }
  async start() {
    const Audio = window.AudioContext || window.webkitAudioContext
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('El micrófono necesita HTTPS o localhost.')
    if (!Audio || !window.AudioWorkletNode) throw new Error('Este navegador no ofrece AudioWorklet. Prueba un navegador actualizado.')
    this.context = new Audio({ latencyHint: 'interactive' })
    try {
      await this.context.resume()
      // Browser voice processing distorts AFSK: echo cancellation and noise
      // suppression treat the tones as noise and AGC pumps between frames.
      this.stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: {
        channelCount: { ideal: 1 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {})
      } })
      if (this.closed) { this.stream.getTracks().forEach(t => t.stop()); return }
      await this.context.audioWorklet.addModule(captureUrl)
      if (this.closed) return
      this.capture = new AudioWorkletNode(this.context, 'aprs-capture', { channelCount: 1, channelCountMode: 'explicit',
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      this.capture.onprocessorerror = () => this.stopWithReason('El procesador de audio ha fallado. Vuelve a iniciar la escucha.')
      this.input = this.context.createMediaStreamSource(this.stream)
      // The worklet outputs silence; it is connected only so the graph keeps pulling audio.
      this.input.connect(this.capture).connect(this.context.destination)
      this.capture.port.onmessage = ({ data }) => {
        if (!this.active) return
        if (data.type === 'level') this.callbacks.onLevel?.(data)
        else if (data.type === 'frame') this.callbacks.onFrame?.({ bytes: data.bytes, twists: data.twists, receivedAt: Date.now() })
      }
      await this.context.resume()
      const track = this.stream.getAudioTracks()[0]
      if (this.closed) return
      if (this.context.state !== 'running') throw new Error('No se ha podido activar el audio después del permiso. Pulsa Escuchar de nuevo.')
      if (!track || track.readyState === 'ended') throw new Error('El micrófono se ha desconectado durante el inicio.')
      this.active = true
      track.onended = () => this.stopWithReason('El micrófono se ha desconectado.')
      this.context.onstatechange = () => { if (this.active && this.context.state !== 'running') this.stopWithReason('El navegador ha suspendido el audio. Vuelve a pulsar Escuchar.') }
      this.pageHandler = () => this.stop()
      window.addEventListener('pagehide', this.pageHandler)
      if (navigator.wakeLock?.request) {
        try { this.wakeLock = await navigator.wakeLock.request('screen'); if (this.closed) await this.wakeLock.release() } catch { /* screen lock is optional */ }
      }
      if (this.closed) return
      this.callbacks.onStarted?.({ sampleRate: this.context.sampleRate, settings: track.getSettings() })
    } catch (error) { await this.stop(); throw error }
  }
  stopWithReason(reason) { void this.stop(); this.callbacks.onStopped?.(reason) }
  async stop() {
    if (this.closed) return
    this.closed = true; this.active = false
    window.removeEventListener('pagehide', this.pageHandler)
    if (this.capture) { this.capture.port.onmessage = null; this.capture.port.close(); this.capture.disconnect() }
    this.input?.disconnect()
    this.stream?.getTracks().forEach(t => { t.onended = null; t.stop() })
    if (this.context) { this.context.onstatechange = null; try { await this.context.close() } catch { /* closed */ } }
    try { await this.wakeLock?.release() } catch { /* already released */ }
  }
}

// Decodes a recording (WAV, MP3, OGG… whatever the browser can open) in slices
// so a long file does not freeze the page. Uses the file's own sample rate.
export async function decodeAudioFile(file, onProgress) {
  const Audio = window.AudioContext || window.webkitAudioContext
  const context = new Audio()
  let buffer
  try { buffer = await context.decodeAudioData(await file.arrayBuffer()) }
  catch { throw new Error('El navegador no puede leer ese archivo de audio.') }
  finally { void context.close() }
  const samples = buffer.getChannelData(0)
  const demod = new AfskDemodulator(buffer.sampleRate)
  const frames = []
  const slice = buffer.sampleRate * 5
  for (let i = 0; i < samples.length; i += slice) {
    frames.push(...demod.push(samples.subarray(i, i + slice)))
    onProgress?.(Math.min(1, (i + slice) / samples.length))
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  frames.push(...demod.finish())
  return { frames, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels }
}
