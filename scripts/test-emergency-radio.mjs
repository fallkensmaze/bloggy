import assert from 'node:assert/strict'
import { EmergencyRadioSimulation as Sim, createScenario, computeRoutes, selectMpr } from '../src/utils/emergencyRadio.js'
import { FRAME_TYPES as T, SAMPLE_RATE, crc16, encodeFrame, decodeFrame, modulate, demodulate,
  mixReceiverAudio, normalizedAudio, textBytes, wavBytes } from '../src/utils/emergencyRadioAudio.js'

let checks = 0
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`) }
const packet = { type: T.DATA, net: 7, origin: 2, sender: 1, dst: 0, next: 0,
  epoch: 1, seq: 14, attempt: 0, ttl: 5, priority: 0, payload: Array.from(textBytes('Agua en reunión')) }
const line = n => Array.from({ length: n }, (_, id) => ({ id, label: `N${id}`, x: 80 + id * 230, y: 250, joinAt: id }))

test('CRC-16/CCITT-FALSE known check vector and complete frame round trip', () => {
  assert.equal(crc16(textBytes('123456789')), 0x29b1)
  assert.deepEqual(decodeFrame(encodeFrame(packet)), packet)
  const bad = encodeFrame(packet); bad[24] ^= 1
  assert.equal(decodeFrame(bad), null)
  assert.equal(decodeFrame(encodeFrame(packet).slice(0, -1)), null)
})
test('BFSK waveform is decoded at all offered bit rates, including arbitrary phase', () => {
  for (const baud of [100, 300, 600, 1200]) {
    const encoded = encodeFrame(packet)
    const audio = modulate(encoded, baud, 1.27)
    assert.equal(audio.length / SAMPLE_RATE, encoded.length * 8 / baud)
    assert.deepEqual(decodeFrame(demodulate(audio, baud)), packet)
  }
})
test('Hidden A and C both sense idle, overlap at B and fail CRC independently', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false })
  sim.advance(0.2); sim.probe(); sim.advance(4)
  assert.equal(sim.history.length, 2)
  assert.equal(sim.history[0].start, sim.history[1].start)
  const received = sim.receptions.filter(r => r.receiver === 1)
  assert.equal(received.length, 2)
  assert.ok(received.every(r => !r.ok && r.reason === 'overlap'))
  assert.equal(sim.stats.busy, 0, 'carrier sense cannot detect the hidden station')
})
test('The same two transmissions separated in time are both decoded at B', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false })
  sim.advance(0.2); sim.probe([0, 2], 1, false); sim.advance(4)
  assert.equal(sim.receptions.filter(r => r.receiver === 1 && r.ok).length, 2)
})
test('Unequal received powers can recover the stronger overlapping frame', () => {
  const nodes = createScenario('hidden'); nodes[2].powerDb = 12
  // Disable carrier sense to hold overlap fixed when the stronger station
  // becomes detectable at A; this tests reception, not MAC deferral.
  const sim = new Sim(nodes, { automatic: false, carrierSense: false })
  sim.advance(0.2); sim.probe(); sim.advance(4)
  assert.ok(sim.receptions.some(r => r.receiver === 1 && r.sender === 2 && r.ok))
  assert.ok(sim.receptions.some(r => r.receiver === 1 && r.sender === 0 && !r.ok))
})
test('A listener already transmitting cannot decode another frame', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false, carrierSense: false })
  sim.advance(0.2); sim.probe([0, 1], 2); sim.advance(4)
  assert.ok(sim.receptions.some(r => r.receiver === 1 && r.reason === 'half-duplex'))
})
test('Nearby transmitters defer when carrier sense is enabled', () => {
  const nodes = createScenario('hidden'); nodes[2].x = 200
  const sim = new Sim(nodes, { automatic: false })
  sim.advance(0.2); sim.probe(); sim.advance(5)
  assert.equal(sim.history.length, 2)
  assert.ok(sim.history[1].start >= sim.history[0].end)
  assert.ok(sim.stats.busy > 0)
})
test('High noise produces a CRC failure, not an invented received message', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false, noiseDb: 30, squelchDb: -100 })
  sim.advance(0.2); sim.probe([0], 1); sim.advance(4)
  assert.ok(sim.receptions.some(r => r.receiver === 1 && !r.ok && r.reason === 'noise'))
})
test('Replay and decoder use exactly the same deterministic receiver samples', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false })
  sim.advance(0.2); sim.probe([0], 1); sim.advance(4)
  const tx = sim.history[0]
  const samples = mixReceiverAudio(sim.history, 1, tx.start, tx.end - tx.start, 0, 42)
  assert.deepEqual(decodeFrame(demodulate(samples, tx.baud)), decodeFrame(tx.bytes))
  const longer = mixReceiverAudio(sim.history, 1, 0, 4, 0, 42)
  assert.deepEqual(samples, longer.slice(Math.round(tx.start * SAMPLE_RATE), Math.round(tx.end * SAMPLE_RATE)))
  const wave = wavBytes(normalizedAudio(samples))
  assert.equal(new DataView(wave).getUint32(24, true), SAMPLE_RATE)
  assert.equal(wave.byteLength, 44 + samples.length * 2)
})
test('MPR coverage uses strict two-hop neighbors and deterministic selection', () => {
  const neighbors = [
    { id: 1, report: [{ id: 0, symmetric: true }, { id: 2, symmetric: true }, { id: 3, symmetric: true }] },
    { id: 2, report: [{ id: 0, symmetric: true }, { id: 3, symmetric: true }, { id: 4, symmetric: true }] },
  ]
  assert.deepEqual([...selectMpr(neighbors, 0)], [2])
  assert.equal(selectMpr([{ id: 1, report: [{ id: 0, symmetric: true }] }], 0).size, 0)
})
test('Routes require confirmed first hops; node zero is a valid next hop', () => {
  const result = computeRoutes(2, [{ id: 0, report: [{ id: 1, symmetric: true }] }], new Map())
  assert.equal(result.routes.get(1).next, 0)
  assert.equal(computeRoutes(2, [], new Map([[0, { neighbors: [2, 1] }]])).routes.size, 0)
})
test('One-way radio reception never becomes a symmetric neighbor', () => {
  const sim = new Sim([{ id: 0, label: 'A', x: 100, y: 100, powerDb: 12 }, { id: 1, label: 'B', x: 580, y: 100 }])
  sim.advance(100)
  assert.ok(sim.node(1).neighbors.has(0))
  assert.equal(sim.symmetricNeighbors(sim.node(0)).length, 0)
  assert.equal(sim.symmetricNeighbors(sim.node(1)).length, 0)
})
test('Stations arriving gradually discover a four-hop route and return a real ACK', () => {
  const sim = new Sim(line(5)); sim.advance(150)
  assert.equal(sim.node(0).routes.get(4).hops, 4)
  const message = sim.sendMessage(0, 4, 'Necesitamos agua', 0); sim.advance(100)
  assert.equal(message.status, 'confirmed')
  assert.equal(sim.node(4).inbox.size, 1)
  assert.ok(sim.receptions.some(r => r.receiver === 0 && r.type === T.ACK && r.ok))
})
test('Turning off a relay does not give other stations instant global knowledge', () => {
  const sim = new Sim(line(5)); sim.advance(150)
  const before = [...sim.node(0).routes]
  sim.setOnline(2, false)
  assert.deepEqual([...sim.node(0).routes], before)
  const message = sim.sendMessage(0, 4, 'Prueba de partición', 0)
  sim.advance(220)
  assert.notEqual(message.status, 'confirmed')
  assert.equal(sim.node(0).routes.has(4), false)
  sim.setOnline(2, true); sim.advance(150)
  assert.ok(sim.node(0).routes.has(4))
})
test('Messages without a route expire instead of claiming delivery', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false, messageLifetime: 8 })
  sim.advance(0.2); const m = sim.sendMessage(0, 2, 'Sin enlace', 0); sim.advance(10)
  assert.equal(m.status, 'expired'); assert.equal(m.attempts, 0)
})
test('Duplicate DATA is delivered once and is acknowledged again', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false }); sim.advance(0.2)
  const target = sim.node(0)
  sim.receive(target, packet); sim.receive(target, packet)
  assert.equal(target.inbox.size, 1)
  assert.equal(target.queue.filter(q => q.packet.type === T.ACK).length, 2)
})
test('TTL prevents forwarding beyond the configured hop budget', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false }); sim.advance(0.2)
  sim.receive(sim.node(1), { ...packet, origin: 0, sender: 0, next: 1, dst: 2, ttl: 1 })
  assert.equal(sim.node(1).queue.length, 0)
})
test('An urgent frame precedes routine traffic when both are ready', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false }); sim.advance(0.2)
  const n = sim.node(0)
  sim.enqueue(n, sim.packet(n, T.PROBE, [1], { priority: 2 }), { ready: 1 })
  sim.enqueue(n, sim.packet(n, T.PROBE, [2], { priority: 0 }), { ready: 1 })
  sim.advance(4)
  assert.deepEqual(sim.history.map(tx => tx.packet.priority), [0, 2])
})
test('Seeds reproduce radio receptions and protocol evolution', () => {
  const a = new Sim(line(5)); const b = new Sim(line(5)); a.advance(80); b.advance(80)
  assert.deepEqual(a.snapshot(), b.snapshot())
})
console.log(`${checks} emergency-radio checks passed.`)
