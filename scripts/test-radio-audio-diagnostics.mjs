import assert from 'node:assert/strict'
import { SAMPLE_RATE, encodeFrame, modulate, wavBytes } from '../src/utils/emergencyRadioAudio.js'
import { FskAudioReceiver, voxAudio } from '../src/utils/radioAudioModem.js'

let checks = 0
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`) }
const packet = { type: 1, net: 17, origin: 2, sender: 2, dst: 255, next: 255, ttl: 1, epoch: 51, seq: 1, attempt: 0, priority: 2, payload: [65] }

test('Tone meters recover known sine RMS and distinguish the two carriers at both rates', () => {
  for (const baud of [300, 600]) for (const [tone, frequency] of [1200, 2400].entries()) {
    const rx = new FskAudioReceiver(baud)
    const amplitude = 0.2
    rx.push(Float32Array.from({ length: 9600 }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / SAMPLE_RATE)))
    const d = rx.diagnostics()
    // A sine with peak A has mean square A²/2, independent of bit rate.
    assert.ok(Math.abs(d.tonesDb[tone] - 10 * Math.log10(amplitude ** 2 / 2)) < 0.001)
    assert.ok(d.tonesDb[1 - tone] <= -99)
    assert.equal(d.prefixes, 0); assert.equal(d.accepted, 0)
    assert.deepEqual(rx.diagnostics().tonesDb, [-100, -100], 'interval peaks are consumed, not stale')
  }
})
test('Prefix acquisition survives reporting and mute resets, independently of CRC rejection', () => {
  const rx = new FskAudioReceiver(300)
  rx.push(modulate(encodeFrame(packet).slice(0, 8), 300))
  const partial = rx.diagnostics()
  assert.ok(partial.prefixes > 0); assert.equal(partial.accepted, 0); assert.equal(partial.rejected, 0)
  rx.reset()
  assert.equal(rx.diagnostics().prefixes, partial.prefixes)
  const bad = encodeFrame(packet); bad[22] ^= 1
  rx.push(modulate(bad, 300))
  const rejected = rx.diagnostics()
  assert.ok(rejected.rejected > 0); assert.equal(rejected.accepted, 0)
  rx.reset()
  assert.equal(rx.push(voxAudio(packet)).length, 1)
  assert.equal(rx.diagnostics().accepted, 1)
})

// Exercise the actual worklet at native sample rates without any browser-only
// text encoders. Port messages are cloned/transferred just like a real worklet.
let Processor
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = []; this.port = { postMessage: (data, transfer = []) => this.messages.push(structuredClone(data, { transfer })) } }
}
globalThis.registerProcessor = (name, klass) => { assert.equal(name, 'radio-audio-capture'); Processor = klass }
const textEncoder = globalThis.TextEncoder; const textDecoder = globalThis.TextDecoder
try {
  globalThis.TextEncoder = undefined; globalThis.TextDecoder = undefined
  await import('../src/worklets/radioCapture.worklet.js')
} finally { globalThis.TextEncoder = textEncoder; globalThis.TextDecoder = textDecoder }
const processor = rate => { globalThis.sampleRate = rate; return new Processor({ processorOptions: { baud: 300 } }) }
const command = (p, data) => p.port.onmessage({ data })
function feed(p, count, rate, frequency = 1200) {
  for (let i = 0; i < count; i += 128) {
    const samples = Float32Array.from({ length: Math.min(128, count - i) }, (_, j) => 0.2 * Math.sin(2 * Math.PI * frequency * (i + j) / rate))
    const output = new Float32Array(128)
    assert.equal(p.process([[samples]], [[output]]), true)
    assert.ok(output.every(x => x === 0), 'no microphone monitoring through speakers')
  }
}
try {
  test('No recording without opt-in; exactly ten seconds of PCM at 44.1/48 kHz, with no duplicate delivery', () => {
    for (const rate of [44100, 48000]) {
      const p = processor(rate)
      feed(p, rate, rate)
      assert.equal(p.recording, null)
      assert.equal(p.messages.some(m => m.type === 'recording'), false)
      command(p, { type: 'record', id: 7 })
      feed(p, rate * 11, rate)
      const results = p.messages.filter(m => m.type === 'recording')
      assert.equal(results.length, 1)
      const r = results[0]
      assert.equal(r.id, 7); assert.equal(r.samples.length, 96000); assert.equal(r.sampleRate, 9600)
      assert.equal(p.recording, null)
      // A 1.2 kHz sine has period 8 samples after resampling; no normalization.
      assert.ok(Math.abs(r.samples[2] - 0.2) < 0.003)
      assert.equal(r.before.accepted, 0); assert.equal(r.after.accepted, 0)
      const wav = new DataView(wavBytes(r.samples))
      assert.equal(wav.getUint32(24, true), 9600); assert.equal(wav.getUint32(40, true), 192000)
      assert.ok(p.messages.some(m => m.type === 'level' && m.recordingSeconds > 0))
    }
  })
  test('Cancellation and TX discard partial audio; muted recording requests are ignored', () => {
    const p = processor(48000)
    command(p, { type: 'record', id: 1 }); feed(p, 4800, 48000)
    command(p, { type: 'cancel-record' }); feed(p, 48000, 48000)
    assert.equal(p.recording, null); assert.equal(p.messages.some(m => m.type === 'recording'), false)
    command(p, { type: 'record', id: 2 }); feed(p, 4800, 48000)
    command(p, { type: 'mute', value: true }); command(p, { type: 'record', id: 3 })
    assert.equal(p.recording, null)
    feed(p, 48000, 48000)
    assert.equal(p.messages.some(m => m.type === 'recording'), false)
    const last = p.messages.at(-1)
    assert.deepEqual(last.tonesDb, [-100, -100]); assert.equal(last.receiving, false)
  })
} finally {
  delete globalThis.AudioWorkletProcessor; delete globalThis.registerProcessor; delete globalThis.sampleRate
}
console.log(`\n${checks} audio-diagnostic checks passed.`)
