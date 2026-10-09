import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { AUDIO_MODEM_DEFAULTS } from '../src/utils/radioAudioModem.js'
import { AudioStationProtocol } from '../src/utils/radioAudioStation.js'
import { FRAME_TYPES as T } from '../src/utils/emergencyRadioAudio.js'

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' })
const globals = ['window', 'document', 'navigator', 'AudioWorkletNode', 'performance']
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const originalPerformance = globalThis.performance
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
let checks = 0
try {
  // Load the real browser controller, including Vite's worklet URL transform.
  const { BrowserRadioAudio } = await server.ssrLoadModule('/src/utils/radioAudioBrowser.js')
  function fixture(options = {}) {
    const state = { mediaCalls: 0, moduleCalls: 0, resumes: 0, stopped: [], started: [], trackStops: 0, time: 100, sources: [], commands: [] }
    const track = { readyState: 'live', getSettings: () => ({ sampleRate: 48000 }), stop() { this.readyState = 'ended'; state.trackStops++ } }
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
    class Node { connect(node) { return node }; disconnect() {} }
    class Context {
      constructor() {
        state.context = this; this.state = 'suspended'; this.sampleRate = 48000; this.destination = new Node()
        this.audioWorklet = { addModule: async () => { state.moduleCalls++; if (options.moduleGate) await options.moduleGate.promise } }
      }
      async resume() {
        state.resumes++
        if (state.resumes === 1 && options.resumeGate) await options.resumeGate.promise
        if (this.state === 'closed') return
        this.state = 'running'
      }
      async close() { this.state = 'closed' }
      createMediaStreamSource() { return new Node() }
      createBiquadFilter() { return Object.assign(new Node(), { frequency: {}, Q: {} }) }
      createBuffer(channels, length, rate) { return { duration: length / rate, copyToChannel() {} } }
      createBufferSource() {
        const source = Object.assign(new Node(), { start() {}, stop() {} })
        state.sources.push(source); return source
      }
    }
    class Worklet extends Node { constructor() { super(); state.capture = this; this.port = { postMessage: data => state.commands.push(data), close() {} } } }
    const win = Object.assign(new EventTarget(), { isSecureContext: true, AudioContext: Context, AudioWorkletNode: Worklet })
    const doc = Object.assign(new EventTarget(), { hidden: false })
    const nav = { mediaDevices: { getUserMedia: async () => {
      state.mediaCalls++
      if (options.mediaGate) await options.mediaGate.promise
      if (options.suspendOnPermission) state.context.state = 'suspended'
      return stream
    } } }
    const performance = options.clock ? new Proxy(originalPerformance, { get(target, key) {
      if (key === 'now') return () => state.time * 1000
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value
    } }) : originalPerformance
    for (const [key, value] of Object.entries({ window: win, document: doc, navigator: nav, AudioWorkletNode: Worklet, performance })) Object.defineProperty(globalThis, key, { configurable: true, value })
    state.doc = doc; state.track = track
    state.radio = new BrowserRadioAudio({ ...AUDIO_MODEM_DEFAULTS, id: 1, network: 17, name: 'Prueba', baud: 300, shareTopology: false, ...options.config }, {
      onStarted: info => state.started.push(info), onStopped: reason => state.stopped.push(reason)
    })
    return state
  }
  async function test(name, options, fn) {
    const f = fixture(options)
    try { await fn(f); checks++; console.log(`✓ ${name}`) } finally { await f.radio.stop() }
  }
  await test('Audio suspended while granting microphone permission is resumed before the station becomes active', { suspendOnPermission: true }, async f => {
    await f.radio.start()
    assert.equal(f.context.state, 'running')
    assert.equal(f.radio.active, true); assert.equal(f.radio.closed, false)
    assert.equal(f.started.length, 1); assert.equal(f.stopped.length, 0)
    assert.ok(f.resumes >= 2)
  })
  const mediaGate = deferred()
  await test('Stopping during permission request releases a late microphone stream without starting reception', { mediaGate }, async f => {
    const start = f.radio.start()
    await Promise.resolve(); await Promise.resolve()
    await f.radio.stop(); mediaGate.resolve(); await start
    assert.equal(f.trackStops, 1); assert.equal(f.moduleCalls, 0)
    assert.equal(f.radio.active, false); assert.equal(f.started.length, 0)
  })
  const resumeGate = deferred()
  await test('Stopping during initial audio activation cannot open a later microphone permission request', { resumeGate }, async f => {
    const start = f.radio.start()
    await f.radio.stop(); resumeGate.resolve(); await start
    assert.equal(f.mediaCalls, 0); assert.equal(f.started.length, 0)
  })
  await test('A genuine suspension after startup still stops immediately and never resumes automatically', {}, async f => {
    await f.radio.start(); const resumes = f.resumes
    f.context.state = 'suspended'; f.context.onstatechange()
    assert.equal(f.radio.active, false); assert.equal(f.radio.closed, true)
    assert.equal(f.trackStops, 1); assert.equal(f.stopped.length, 1)
    assert.equal(f.resumes, resumes)
  })
  await test('Hiding an active page stops capture and returning does not restart it', {}, async f => {
    await f.radio.start(); f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange'))
    assert.equal(f.radio.closed, true); assert.equal(f.trackStops, 1)
    f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange'))
    assert.equal(f.radio.active, false); assert.equal(f.mediaCalls, 1)
  })
  await test('An ACK during the post-transmit guard is received while new transmissions still wait', { clock: true, config: { releaseMs: 3000 } }, async f => {
    await f.radio.start()
    const m = f.radio.protocol.send('Prueba de retorno', 2, f.time)
    f.time += 1
    const entry = f.radio.protocol.take(f.time)
    f.radio.transmit(entry)
    const peer = new AudioStationProtocol({ id: 2, epoch: 77, shareTopology: false })
    const p = m.packet
    const ack = peer.packet(T.ACK, [1, p.epoch >> 8, p.epoch & 255, p.seq >> 8, p.seq & 255, 0], 1)
    const deliver = packet => f.capture.port.onmessage({ data: { type: 'frame', packet, quality: 1 } })
    deliver(ack)
    assert.equal(m.status, 'transmitting', 'frames arriving during local playback remain ignored')
    const source = f.sources[0]
    f.time += source.buffer.duration
    source.onended()
    assert.deepEqual(f.commands.at(-1), { type: 'mute', value: false }, 'resume capture when playback ends, without waiting for the TX guard')
    assert.equal(m.status, 'waitingAck')
    deliver(p)
    assert.equal(f.radio.protocol.conflict, false, 'same-session acoustic echo remains ignored')
    deliver({ ...ack, payload: [1, p.epoch >> 8, p.epoch & 255, p.seq >> 8, (p.seq + 1) & 255, 0] })
    assert.equal(m.status, 'waitingAck', 'a different message cannot confirm this one')
    deliver(ack)
    assert.equal(m.status, 'confirmed'); assert.equal(f.radio.protocol.stats.acks, 1)
    f.radio.send('Segundo mensaje', 2, 1)
    f.time += 2.5; f.radio.tick()
    assert.equal(f.sources.length, 1, 'hearing the ACK does not shorten the configured TX guard')
    f.time += 0.6; f.radio.tick()
    assert.equal(f.sources.length, 2, 'the next queued message can transmit after the guard')
  })
  console.log(`\n${checks} audio-lifecycle checks passed.`)
} finally {
  for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  await server.close()
}
