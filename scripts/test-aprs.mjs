// Assertions for src/utils/ax25.js and src/utils/aprsModem.js
//
// A receiver fails silently: with the wrong NRZI sense, bit order, stuffing or
// FCS it simply never shows a packet, and noise never shows one either, so an
// empty list proves nothing. Every case here builds real AFSK audio with
// afskModulate() and demands the exact frame back, under the impairments a
// radio adds: tone twist from de-emphasis, sender clock error, DC offset,
// noise and arbitrary AudioWorklet block sizes. The CRC check value and a
// bit-flipped frame pin the FCS independently of the modulator.

import assert from 'node:assert/strict'
import { crc16x25, decodeFrame, encodeUiFrame, fcsValid, tnc2 } from '../src/utils/ax25.js'
import { AfskDemodulator, afskModulate } from '../src/utils/aprsModem.js'
import { parseAprs } from '../src/utils/aprsParser.js'
import { formatCall } from '../src/utils/ax25.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`) }

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647 }
function withNoise(audio, sampleRate, sigma, seed = 1, { lead = 0.5, dc = 0 } = {}) {
  const out = new Float32Array(audio.length + sampleRate)
  out.set(audio, Math.round(sampleRate * lead))
  const r = rng(seed)
  for (let i = 0; i < out.length; i++) out[i] += dc + sigma * Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  return out
}
function demodulate(samples, sampleRate, { chunk = 128, twists } = {}) {
  const d = new AfskDemodulator(sampleRate, twists ? { twists } : undefined)
  const frames = []
  for (let i = 0; i < samples.length; i += chunk) frames.push(...d.push(samples.subarray(i, i + chunk)))
  return [...frames, ...d.finish()]
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

const position = encodeUiFrame({ source: 'EA4XYZ-9', destination: 'APRS', path: ['WIDE1-1', 'WIDE2-1'], info: '!4024.38N/00341.31W>Prueba' })
const message = encodeUiFrame({ source: 'EB1ABC', destination: 'APZ001', path: [], info: ':EA4XYZ-9 :Hola{12' })

console.log('AX.25')
test('CRC-16/X.25 check value of "123456789" is 0x906E', () => {
  assert.equal(crc16x25(new TextEncoder().encode('123456789')), 0x906e)
})
test('UI frame round-trips with addresses, SSIDs and control/PID', () => {
  const f = decodeFrame(encodeUiFrame({ source: 'EA4XYZ-15', destination: 'APDR16', path: ['EA4RCH-3*', 'WIDE2-1'], info: 'x' }))
  assert.deepEqual(f.source, { call: 'EA4XYZ', ssid: 15, repeated: false })
  assert.deepEqual(f.destination, { call: 'APDR16', ssid: 0, repeated: false })
  assert.deepEqual(f.path, [{ call: 'EA4RCH', ssid: 3, repeated: true }, { call: 'WIDE2', ssid: 1, repeated: false }])
  assert.equal(f.control, 0x03); assert.equal(f.pid, 0xf0); assert.equal(f.ui, true); assert.equal(f.text, 'x')
})
test('TNC2 line marks only the last repeated digipeater', () => {
  const f = decodeFrame(encodeUiFrame({ source: 'A1B', destination: 'APRS', path: ['D1*', 'D2*', 'WIDE2-1'], info: '>hi' }))
  assert.equal(tnc2(f), 'A1B>APRS,D1,D2*,WIDE2-1:>hi')
})
test('any single flipped bit is rejected by the FCS', () => {
  for (let bit = 0; bit < position.length * 8; bit++) {
    const bad = position.slice(); bad[bit >> 3] ^= 1 << (bit & 7)
    assert.equal(fcsValid(bad), false, `bit ${bit}`); assert.equal(decodeFrame(bad), null)
  }
})
test('UTF-8 comments decode as UTF-8, other bytes as Latin-1', () => {
  assert.equal(decodeFrame(encodeUiFrame({ source: 'A1B', destination: 'APRS', info: '>Señal ñ' })).text, '>Señal ñ')
  assert.equal(decodeFrame(encodeUiFrame({ source: 'A1B', destination: 'APRS', info: [0x3e, 0xf1] })).text, '>ñ')
})

console.log('AFSK 1200 demodulator')
for (const rate of [8000, 22050, 44100, 48000]) test(`clean frame at ${rate} Hz`, () => {
  const frames = demodulate(withNoise(afskModulate([position], { sampleRate: rate }), rate, 0), rate)
  assert.equal(frames.length, 1); assert.ok(same(frames[0].bytes, position))
  assert.ok(Math.abs(frames[0].time - (0.5 + (40 * 8 + position.length * 8 + 16) / 1200)) < 0.05, 'reported time is the end of the frame')
})
test('flags and long runs of ones inside the data survive bit stuffing', () => {
  const tricky = encodeUiFrame({ source: 'A1B', destination: 'APRS', info: [0x7e, 0x7e, 0x7f, 0x7f, 0x3f, 0xfe] })
  const frames = demodulate(afskModulate([tricky]), 48000)
  assert.equal(frames.length, 1); assert.ok(same(frames[0].bytes, tricky))
})
test('two different and two identical frames in one transmission are all reported', () => {
  const frames = demodulate(afskModulate([position, message, message]), 48000)
  assert.equal(frames.length, 3)
  assert.ok(same(frames[0].bytes, position) && same(frames[1].bytes, message) && same(frames[2].bytes, message))
})
test('result does not depend on the AudioWorklet block size', () => {
  const audio = withNoise(afskModulate([position, message], { sampleRate: 44100 }), 44100, 0.2, 3)
  for (const chunk of [1, 37, 128, 4096, audio.length]) {
    const frames = demodulate(audio, 44100, { chunk })
    assert.equal(frames.length, 2, `chunk ${chunk}`)
  }
})
for (const db of [-9, -6, 6, 9]) test(`space tone ${db > 0 ? '+' : ''}${db} dB (de-emphasis twist) decodes with noise`, () => {
  const frames = demodulate(withNoise(afskModulate([position], { spaceGainDb: db, startPhase: 1 }), 48000, 0.15, 5), 48000)
  assert.equal(frames.length, 1); assert.ok(same(frames[0].bytes, position))
  assert.ok(frames[0].twists.includes(db) || frames[0].twists.some(t => Math.sign(t) === Math.sign(db)), `slicers ${frames[0].twists}`)
})
test('the twist slicers are what rescue a strongly de-emphasised signal', () => {
  // Space tone 15 dB down with noise: over ten noise realisations a single
  // balanced slicer decodes 1, the seven-slicer bank decodes all ten.
  let single = 0, bank = 0
  for (let seed = 1; seed <= 10; seed++) {
    const audio = withNoise(afskModulate([position], { spaceGainDb: -15 }), 48000, 0.1, seed)
    single += demodulate(audio, 48000, { twists: [0] }).length; bank += demodulate(audio, 48000).length
  }
  assert.ok(single <= 3, `single slicer ${single}/10`); assert.ok(bank >= 9, `slicer bank ${bank}/10`)
})
for (const baud of [1188, 1212]) test(`sender clock error of ${((baud / 1200 - 1) * 100).toFixed(0)} % is tracked`, () => {
  assert.equal(demodulate(withNoise(afskModulate([position, message], { baud }), 48000, 0.2, 2), 48000).length, 2)
})
test('DC offset from a cheap sound card does not prevent decoding', () => {
  assert.equal(demodulate(withNoise(afskModulate([position]), 48000, 0.05, 4, { dc: 0.3 }), 48000).length, 1)
})
test('ten seconds of noise produce no frames', () => {
  const d = new AfskDemodulator(48000)
  const noise = withNoise(new Float32Array(48000 * 9), 48000, 0.3, 11)
  assert.equal([...d.push(noise), ...d.finish()].length, 0)
})
test('frame end is reported within 50 ms and carrier detect clears after it', () => {
  const rate = 48000, audio = afskModulate([position], { sampleRate: rate, tailFlags: 1 })
  const d = new AfskDemodulator(rate)
  assert.equal(d.push(audio).length, 0)
  let frames = d.push(new Float32Array(rate * 0.05)); assert.equal(frames.length, 1)
  d.push(new Float32Array(rate)); assert.equal(d.receiving, false)
})

console.log('End to end')
test('noisy de-emphasised audio becomes a parsed APRS position', () => {
  const frame = encodeUiFrame({ source: 'EA4XYZ-9', destination: 'APRS', path: ['WIDE1-1*'], info: '!4903.50N/07201.75W>088/036/A=001234 Hola' })
  const [rx] = demodulate(withNoise(afskModulate([frame], { sampleRate: 44100, spaceGainDb: -6 }), 44100, 0.1, 21), 44100)
  const f = decodeFrame(rx.bytes)
  const aprs = parseAprs({ source: formatCall(f.source), destination: formatCall(f.destination), path: f.path.map(formatCall), info: f.text })
  assert.equal(aprs.type, 'position'); assert.equal(aprs.comment, 'Hola')
  assert.ok(Math.abs(aprs.position.lat - 49.058333) < 1e-5 && Math.abs(aprs.position.lon + 72.029167) < 1e-5)
  assert.ok(Math.abs(aprs.speed - 36 * 1.852) < 1e-6 && aprs.course === 88 && Math.abs(aprs.altitude - 1234 * 0.3048) < 1e-6)
})

console.log(`\n${passed} APRS modem/AX.25 assertions passed`)
