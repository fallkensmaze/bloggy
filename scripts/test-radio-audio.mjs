import assert from 'node:assert/strict'
import { FRAME_TYPES as T, SAMPLE_RATE, textBytes, encodeFrame, modulate, seededRandom } from '../src/utils/emergencyRadioAudio.js'
import { FskAudioReceiver, AudioResampler, voxAudio } from '../src/utils/radioAudioModem.js'
import { AudioStationProtocol } from '../src/utils/radioAudioStation.js'

let checks = 0
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`) }
const message = 'Agua y atención en el punto de reunión.'
const packet = { type: T.DATA, net: 17, origin: 2, sender: 2, dst: 1, next: 1, ttl: 1, epoch: 1937, seq: 22, attempt: 0, priority: 1, payload: [...textBytes(message)] }
function stream(rx, samples, seed = 11) {
  const random = seededRandom(seed); const found = []
  for (let i = 0; i < samples.length;) { const n = 1 + Math.floor(random() * 1013); found.push(...rx.push(samples.subarray(i, i + n))); i += n }
  return found
}
function capture(samples, rate, ppm = 0, noise = 0, pad = 3197) {
  const step = SAMPLE_RATE / (rate * (1 + ppm * 1e-6)); const out = new Float32Array(pad + Math.ceil(samples.length / step) + 1000)
  const random = seededRandom(715)
  for (let i = 0; i < out.length; i++) {
    const pos = (i - pad) * step; const k = Math.floor(pos); const f = pos - k
    out[i] = (samples[k] || 0) * (1 - f) + (samples[k + 1] || 0) * f + (random() * 2 - 1) * noise
  }
  return out
}
function nativeStream(samples, rate, baud, seed = 71) {
  const resample = new AudioResampler(rate); const rx = new FskAudioReceiver(baud); const random = seededRandom(seed); const found = []
  for (let i = 0; i < samples.length;) { const n = 1 + Math.floor(random() * 1789); found.push(...rx.push(resample.push(samples.subarray(i, i + n)))); i += n }
  return found
}
const station = (id, options = {}) => new AudioStationProtocol({ id, epoch: id * 97, name: `Estación ${id}`, ...options }, () => 0)

test('Unknown frame start, symbol phase and arbitrary chunk boundaries at both rates', () => {
  for (const baud of [300, 600]) for (const offset of [1, 7, 19, 31]) {
    const audio = voxAudio(packet, { baud }); const samples = new Float32Array(audio.length + offset + 777); samples.set(audio, offset)
    const found = stream(new FskAudioReceiver(baud), samples, offset)
    assert.equal(found.length, 1); assert.deepEqual(found[0].packet, packet)
  }
})
// A one-symbol delayed path mixes the opposite tone into alternating training
// bits. Their contrast drops while their sign (and thus every bit) stays correct.
// This synthetic regression contains no microphone recording or user metadata.
function withEcho(audio, baud, offset = 19) {
  const delay = SAMPLE_RATE / baud
  return Float32Array.from({ length: audio.length + delay + offset + 77 }, (_, i) =>
    0.03 * ((audio[i - offset] || 0) + 0.75 * (audio[i - offset - delay] || 0)))
}
test('Exact prefix with low tone contrast still delivers a CRC-valid frame through an echo', () => {
  for (const baud of [300, 600]) for (const offset of [1, 7, 19, 31]) {
    const rx = new FskAudioReceiver(baud)
    const found = stream(rx, withEcho(voxAudio(packet, { baud }), baud, offset), offset)
    assert.equal(found.length, 1, `${baud} bit/s, offset ${offset}`)
    assert.deepEqual(found[0].packet, packet)
    assert.ok(rx.prefixes > 0); assert.equal(rx.accepted, 1)
  }
})
test('Low-contrast prefix never bypasses CRC or accepts a corrupt echoed payload', () => {
  for (const baud of [300, 600]) {
    const bad = encodeFrame(packet); bad[28] ^= 1
    const audio = modulate(Uint8Array.from([...Array(16).fill(170), ...bad]), baud)
    const rx = new FskAudioReceiver(baud)
    assert.equal(stream(rx, withEcho(audio, baud)).length, 0)
    assert.ok(rx.prefixes > 0); assert.ok(rx.rejected > 0); assert.equal(rx.accepted, 0)
    rx.push(new Float32Array(2000))
    const found = stream(rx, withEcho(voxAudio(packet, { baud }), baud))
    assert.equal(found.length, 1); assert.deepEqual(found[0].packet, packet)
  }
})
// A four-sample delayed tap has opposite signs at 1200 and 2400 Hz; it
// imposes a known tone imbalance without editing bits or using recorded audio.
// A second, one-symbol path smears transitions. Fractional arrival offsets
// exercise the timing search independently of stream chunk boundaries.
function withToneImbalance(audio, baud, db, offset = 19.5, echo = 0.75) {
  const ratio = 10 ** (db / 20); const tap = (ratio - 1) / (ratio + 1)
  const colored = Float32Array.from(audio, (x, i) => x + tap * (audio[i - 4] || 0))
  const delay = SAMPLE_RATE / baud
  const at = i => {
    const k = Math.floor(i); const f = i - k
    return (colored[k] || 0) * (1 - f) + (colored[k + 1] || 0) * f
  }
  return Float32Array.from({ length: audio.length + delay + Math.ceil(offset) + 77 }, (_, i) =>
    0.03 * (at(i - offset) + echo * at(i - offset - delay)))
}
test('Unequal tone levels and delayed paths decode at both rates without duplicate frames', () => {
  const p = { ...packet, payload: [...textBytes('Abcdefghijklmnopqrstuvwxyz0123456'.repeat(3))] }
  for (const baud of [300, 600]) for (const db of [-9, 9]) for (const offset of [1, 7.5, 19.5, 31]) {
    const rx = new FskAudioReceiver(baud)
    const found = stream(rx, withToneImbalance(voxAudio(p, { baud }), baud, db, offset))
    assert.equal(found.length, 1, `${baud} bit/s, ${db} dB, offset ${offset}`)
    assert.deepEqual(found[0].packet, p); assert.equal(rx.accepted, 1)
    assert.equal(rx.receiving, false)
  }
})
test('Tone compensation still rejects corrupted CRCs and reset clears every partial candidate', () => {
  for (const baud of [300, 600]) for (const db of [-9, 9]) {
    const bad = encodeFrame(packet); bad[28] ^= 1
    const audio = modulate(Uint8Array.from([...Array(16).fill(170), ...bad]), baud)
    const rx = new FskAudioReceiver(baud)
    assert.equal(stream(rx, withToneImbalance(audio, baud, db)).length, 0)
    assert.ok(rx.prefixes > 0); assert.ok(rx.rejected > 0); assert.equal(rx.accepted, 0)
    const partial = withToneImbalance(modulate(Uint8Array.from([...Array(16).fill(170), ...encodeFrame(packet)]), baud), baud, db)
    rx.push(partial.subarray(0, (16 + 8) * 8 * SAMPLE_RATE / baud))
    assert.equal(rx.receiving, true)
    const prefixes = rx.prefixes
    rx.reset(); assert.equal(rx.receiving, false); assert.equal(rx.prefixes, prefixes)
    const found = stream(rx, withToneImbalance(voxAudio(packet, { baud }), baud, db))
    assert.equal(found.length, 1); assert.deepEqual(found[0].packet, packet)
  }
})
test('Full-symbol tone compensation retains reception with noise, imbalance and moderate echo together', () => {
  for (const baud of [300, 600]) for (const db of [-6, 0, 6]) {
    const audio = withToneImbalance(voxAudio(packet, { baud }), baud, db, 19.5, 0.25)
    const start = Math.round(0.7 * SAMPLE_RATE) + 16 * 8 * SAMPLE_RATE / baud + 20
    const data = audio.subarray(start, start + encodeFrame(packet).length * 8 * SAMPLE_RATE / baud)
    const power = data.reduce((sum, x) => sum + x * x, 0) / data.length
    // Defined at the decoder input over frame data, before tone correlation:
    // 6 dB at 300 bit/s and 9 dB at 600 bit/s signal / white-noise power.
    // The slower rate integrates twice as many samples. This is synthetic,
    // not a calibrated acoustic SNR or a claim about speech/interference.
    const snrDb = baud === 300 ? 6 : 9
    const noisePeak = Math.sqrt(3 * power / 10 ** (snrDb / 10))
    for (let seed = 1; seed <= 8; seed++) {
      const random = seededRandom(seed)
      const noisy = Float32Array.from(audio, x => x + (random() * 2 - 1) * noisePeak)
      const found = stream(new FskAudioReceiver(baud), noisy, seed)
      assert.equal(found.length, 1, `${baud} bit/s, ${db} dB imbalance, noise seed ${seed}`)
      assert.deepEqual(found[0].packet, packet)
    }
  }
})
test('44.1 and 48 kHz capture, noise and ±200 ppm sample-clock mismatch on a 96-byte text', () => {
  const p = { ...packet, payload: [...textBytes('Abcdefghijklmnopqrstuvwxyz0123456'.repeat(3).slice(0, 96))] }
  assert.equal(p.payload.length, 96)
  for (const baud of [300, 600]) for (const rate of [44100, 48000]) for (const ppm of [-200, 200]) {
    const found = nativeStream(capture(voxAudio(p, { baud }), rate, ppm, 0.025), rate, baud)
    assert.equal(found.length, 1, `${rate} Hz, ${baud} bit/s, ${ppm} ppm`); assert.deepEqual(found[0].packet, p)
  }
})
test('Resampling is identical across chunk boundaries and retains its clock', () => {
  const input = capture(voxAudio(packet), 44100)
  const full = new AudioResampler(44100).push(input); const r = new AudioResampler(44100); const parts = []
  for (let i = 0; i < input.length; i += 127) parts.push(...r.push(input.subarray(i, i + 127)))
  assert.deepEqual(Float32Array.from(parts), full)
})
test('CRC corruption and truncation are rejected; a later good frame resynchronizes', () => {
  const bad = encodeFrame(packet); bad[28] ^= 1
  const broken = modulate(Uint8Array.from([...Array(16).fill(170), ...bad]), 300)
  const rx = new FskAudioReceiver(300)
  assert.equal(stream(rx, broken).length, 0); assert.ok(rx.rejected > 0)
  rx.push(new Float32Array(2000)); assert.equal(stream(rx, voxAudio(packet)).length, 1)
  const short = modulate(encodeFrame(packet).slice(0, -1), 300)
  assert.equal(stream(new FskAudioReceiver(300), short).length, 0)
})
test('Silence, unrelated tones, random noise and a mismatched bit rate do not invent text', () => {
  const noise = new Float32Array(SAMPLE_RATE * 8); const random = seededRandom(99)
  for (let i = 0; i < noise.length; i++) noise[i] = (random() * 2 - 1) * 0.3 + Math.sin(i * 2 * Math.PI * 710 / SAMPLE_RATE) * 0.2
  const rx = new FskAudioReceiver(300)
  assert.equal(stream(rx, new Float32Array(17000)).length, 0); assert.equal(stream(rx, noise).length, 0)
  assert.equal(stream(rx, voxAudio(packet, { baud: 600 })).length, 0)
})
test('VOX audio includes lead/training/tail, is bounded, and a clipped lead can still acquire', () => {
  const audio = voxAudio(packet, { leadMs: 1000, tailMs: 120, volume: 0.35 })
  assert.equal(audio.length, 9600 + (16 + encodeFrame(packet).length) * 8 * 32 + 1152)
  assert.ok(audio.every(x => Math.abs(x) <= 0.350001))
  assert.equal(stream(new FskAudioReceiver(300), audio.subarray(9600 + 16 * 8 * 32 / 2)).length, 1)
})
test('Two direct stations exchange actual streamed waveforms and confirm only the returned ACK', () => {
  const a = station(1); const b = station(2); const m = a.send(message, 2, 0)
  const data = a.take(1); assert.ok(data); a.finish(data, 4)
  const frames = nativeStream(capture(voxAudio(data.packet), 48000), 48000, 300)
  for (const f of frames) b.receive(f.packet, f.quality, 5)
  assert.equal(b.inbox[0].text, message); assert.equal(m.status, 'waitingAck')
  assert.equal(b.take(5.5), null, 'VOX release delay applies to ACK')
  const ack = b.take(7); assert.equal(ack.packet.type, T.ACK); b.finish(ack, 10)
  const returned = nativeStream(capture(voxAudio(ack.packet), 44100), 44100, 300)
  for (const f of returned) a.receive(f.packet, f.quality, 11)
  assert.equal(m.status, 'confirmed'); assert.equal(a.stats.acks, 1); assert.equal(a.queue.length, 0)
})
test('Wrong group, destination, identity, attempt or sender cannot confirm a message', () => {
  const a = station(1); const m = a.send(message, 2, 0); const e = a.take(1); a.finish(e, 4)
  const ack = station(2).packet(T.ACK, [1, 0, 97, 0, m.packet.seq, 0], 1)
  for (const wrong of [{ ...ack, net: 18 }, { ...ack, origin: 3, sender: 3 }, { ...ack, dst: 3, next: 3 },
    { ...ack, sender: 3 }, { ...ack, payload: [1, 0, 98, 0, m.packet.seq, 0] }, { ...ack, payload: [1, 0, 97, 0, m.packet.seq, 1] }]) {
    a.receive(wrong, 1, 5); assert.equal(m.status, 'waitingAck')
  }
  a.receive(ack, 1, 6); assert.equal(m.status, 'confirmed')
  a.receive({ ...ack, seq: ack.seq + 1 }, 1, 8); assert.equal(m.confirmedAt, 6)
})
test('Lost ACK retries retain message identity and duplicate DATA is rendered once but re-ACKed', () => {
  const a = station(1); const b = station(2); const m = a.send(message, 2, 0)
  const first = a.take(1); a.finish(first, 4); b.receive(first.packet, 1, 5)
  const lost = b.take(7); b.finish(lost, 9)
  a.take(m.due + 1); const repeated = a.take(m.due + 3)
  assert.equal(repeated.packet.seq, first.packet.seq); assert.equal(repeated.packet.epoch, first.packet.epoch); assert.equal(repeated.packet.attempt, 1)
  b.receive(repeated.packet, 1, 20); assert.equal(b.inbox.length, 1); assert.equal(b.queue.length, 1)
  a.finish(repeated, 22); const ack = b.take(23); a.receive(ack.packet, 1, 26); assert.equal(m.status, 'confirmed')
})
test('No ACK after three attempts leaves the message unconfirmed and bounds transmissions', () => {
  const a = station(1); const m = a.send(message, 2, 0)
  let t = 1
  for (let i = 0; i < 3; i++) {
    let e = a.take(t); if (!e) e = a.take(t + 2)
    assert.ok(e); a.finish(e, t + 4); t = m.due + 1
  }
  a.take(t); assert.equal(m.status, 'unconfirmed'); assert.equal(m.attempts, 3); assert.equal(a.queue.length, 0)
})
test('Group messages, third-party traffic and mesh frames are never relayed or broadcast-ACKed', () => {
  const b = station(2)
  b.receive({ ...packet, origin: 1, sender: 1, dst: 255, next: 255 }, 1, 0)
  assert.equal(b.inbox.length, 1); assert.equal(b.queue.length, 0)
  b.receive({ ...packet, dst: 3, next: 3 }, 1, 1); assert.equal(b.inbox.length, 1)
  b.receive({ ...packet, type: T.TOPOLOGY }, 1, 2); assert.equal(b.queue.length, 0)
  const a = station(1); const m = a.send(message, 255, 0); const e = a.take(1); a.finish(e, 3)
  a.take(90); assert.equal(m.status, 'broadcast'); assert.equal(m.attempts, 1)
})
test('Presence announcements are manual, and hearing a station is not a delivery confirmation', () => {
  const a = station(1); const b = station(2)
  for (let t = 0; t < 600; t++) assert.equal(a.take(t), null)
  a.announce(600); const e = a.take(601); b.receive(e.packet, 1, 604)
  assert.equal(b.peers.get(1).name, 'Estación 1'); assert.equal(b.peers.get(1).confirmedAt, undefined); assert.equal(b.queue.length, 0)
})
test('Carrier energy and frame reception defer transmissions; stopping cancels all retries', () => {
  const a = station(1); const m = a.send(message, 2, 0)
  assert.equal(a.take(1, 0.2), null); assert.equal(a.take(2, 5, true), null)
  const e = a.take(3, 1); a.finish(e, 6); a.stop(7)
  assert.equal(m.status, 'interrupted'); assert.equal(a.take(30), null)
})
test('Duplicate IDs block outgoing traffic; same-session self echo is ignored', () => {
  const a = station(1); a.announce(0)
  a.receive({ ...packet, origin: 1, sender: 1, epoch: 97 }, 1, 1); assert.equal(a.conflict, false)
  a.receive({ ...packet, origin: 1, sender: 1, epoch: 98 }, 1, 2)
  assert.equal(a.conflict, true); assert.equal(a.queue.length, 0); assert.equal(a.take(10), null)
})
test('Turning off automatic ACK removes queued replies; emergency data outranks normal data', () => {
  const b = station(1); b.receive(packet, 1, 0); assert.equal(b.queue.length, 1)
  b.setAutoAck(false); assert.equal(b.queue.length, 0)
  b.send('Normal', 2, 1, 2); b.send('Urgente', 2, 1, 0)
  assert.equal(b.take(2).packet.priority, 0)
})
test('Full queues, expiry and UTF-8 byte limits do not create permanent or unbounded retries', () => {
  const a = station(1); const m = a.send(message, 2, 0); const e = a.take(1); a.finish(e, 4)
  for (let i = 0; i < 24; i++) a.send(`Cola ${i}`, 2, 5)
  assert.throws(() => a.send('Sobra', 2, 6), /cola/)
  assert.doesNotThrow(() => a.take(m.due + 1, 0)); assert.equal(m.status, 'waitingAck')
  a.take(200, 0); assert.ok(a.messages.every(v => v.status === 'expired')); assert.equal(a.queue.length, 0)
  assert.throws(() => station(1).send('á'.repeat(49), 2, 0), /96 bytes/)
  assert.throws(() => station(1).send(message, 1, 0), /otra estación/)
})
console.log(`\n${checks} live-audio checks passed.`)
