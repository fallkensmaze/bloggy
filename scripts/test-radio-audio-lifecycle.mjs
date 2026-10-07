import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' })
const globals = ['window', 'document', 'navigator', 'AudioWorkletNode']
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
let checks = 0
try {
  // Load the real browser controller, including Vite's worklet URL transform.
  const { BrowserRadioAudio } = await server.ssrLoadModule('/src/utils/radioAudioBrowser.js')
  function fixture(options = {}) {
    const state = { mediaCalls: 0, moduleCalls: 0, resumes: 0, stopped: [], started: [], trackStops: 0 }
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
    }
    class Worklet extends Node { constructor() { super(); this.port = { postMessage() {}, close() {} } } }
    const win = Object.assign(new EventTarget(), { isSecureContext: true, AudioContext: Context, AudioWorkletNode: Worklet })
    const doc = Object.assign(new EventTarget(), { hidden: false })
    const nav = { mediaDevices: { getUserMedia: async () => {
      state.mediaCalls++
      if (options.mediaGate) await options.mediaGate.promise
      if (options.suspendOnPermission) state.context.state = 'suspended'
      return stream
    } } }
    for (const [key, value] of Object.entries({ window: win, document: doc, navigator: nav, AudioWorkletNode: Worklet })) Object.defineProperty(globalThis, key, { configurable: true, value })
    state.doc = doc; state.track = track
    state.radio = new BrowserRadioAudio({ id: 1, network: 17, name: 'Prueba', baud: 300 }, {
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
  console.log(`\n${checks} audio-lifecycle checks passed.`)
} finally {
  for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  await server.close()
}
