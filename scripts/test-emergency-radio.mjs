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
  sim.advance(3 * Math.max(sim.config.helloInterval, sim.config.topologyInterval) + 30)
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
  const firstAck = target.queue.find(q => q.packet.type === T.ACK).packet
  assert.equal(target.queue.filter(q => q.packet.type === T.ACK).length, 1, 'coalesce an end ACK that has not yet left')
  target.queue = target.queue.filter(q => q.packet.type !== T.ACK)
  sim.receive(target, packet)
  assert.notEqual(target.queue.find(q => q.packet.type === T.ACK).packet.seq, firstAck.seq, 're-ACK after the previous ACK left')
  assert.equal(target.inbox.size, 1)
})
test('TTL prevents forwarding beyond the configured hop budget', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false }); sim.advance(0.2)
  sim.receive(sim.node(1), { ...packet, origin: 0, sender: 0, next: 1, dst: 2, ttl: 1 })
  assert.equal(sim.node(1).queue.filter(e => e.packet.type === T.DATA).length, 0)
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

function quietLine(count = 2) {
  const sim = new Sim(line(count)); sim.advance(150); sim.config.automatic = false
  for (const n of sim.nodes) n.queue = n.queue.filter(e => ![T.HELLO, T.TOPOLOGY].includes(e.packet.type))
  sim.advance(5)
  return sim
}
test('A lost DATA is recovered on its hop without consuming another end-to-end attempt', () => {
  const sim = quietLine(); const original = sim.startTransmission.bind(sim); let faded = false
  sim.startTransmission = (n, p, entry) => {
    original(n, p, entry)
    if (!faded && p.type === T.DATA) { sim.history.at(-1).gains[1] = 0; faded = true }
  }
  const m = sim.sendMessage(0, 1, 'Recuperar este salto', 0); sim.advance(40)
  assert.equal(m.status, 'confirmed'); assert.equal(m.attempts, 1)
  assert.ok(sim.stats.linkRetries >= 1)
  assert.equal(sim.node(1).inbox.size, 1)
  assert.ok(sim.messageTrace(m.id).some(r => r.type === T.DATA && !r.ok))
})
test('A link ACK must match both the expected neighbor and the exact frame', () => {
  const sim = quietLine(); const m = sim.sendMessage(0, 1, 'Identificar acuse', 0)
  const source = sim.node(0)
  for (let i = 0; i < 30 && !source.hopWait; i++) sim.advance(0.1)
  const wait = source.hopWait; assert.ok(wait)
  const p = wait.packet
  const payload = [p.type, p.origin, p.epoch >> 8, p.epoch & 255, p.seq >> 8, p.seq & 255, p.attempt]
  const ack = sim.packet(sim.node(1), T.LINK_ACK, payload, { dst: 0, next: 0, ttl: 1 })
  sim.receive(source, { ...ack, origin: 2, sender: 2 }); assert.equal(source.hopWait, wait)
  sim.receive(source, { ...ack, payload: [...payload.slice(0, 6), 9] }); assert.equal(source.hopWait, wait)
  sim.receive(source, ack); assert.equal(source.hopWait, null)
  assert.notEqual(m.status, 'confirmed', 'a hop ACK cannot confirm delivery to the user')
})
test('Final ACK follows the received DATA path even without a generic route back', () => {
  const sim = quietLine(3); const refresh = sim.refresh.bind(sim)
  sim.refresh = n => { refresh(n); if (n.id !== 0) n.routes.delete(0) }
  for (const n of sim.nodes) sim.refresh(n)
  const m = sim.sendMessage(0, 2, 'Usar el camino recibido', 0); sim.advance(30)
  assert.equal(m.status, 'confirmed')
  assert.equal(sim.node(2).routes.has(0), false)
  assert.ok(sim.messageTrace(m.id).some(r => r.type === T.ACK && r.sender === 2 && r.next === 1 && r.ok))
  assert.ok(sim.messageTrace(m.id).some(r => r.type === T.ACK && r.sender === 1 && r.next === 0 && r.ok))
})
test('Losing all final ACKs leaves a received text unconfirmed, with observer evidence', () => {
  const sim = quietLine(); const original = sim.startTransmission.bind(sim)
  sim.startTransmission = (n, p, entry) => { original(n, p, entry); if (p.type === T.ACK) sim.history.at(-1).gains[0] = 0 }
  const m = sim.sendMessage(0, 1, 'El texto sí ha llegado', 0); sim.advance(180)
  assert.equal(sim.node(1).inbox.size, 1)
  assert.notEqual(m.status, 'confirmed'); assert.equal(m.confirmedAt, undefined)
  assert.ok(sim.stats.linkAck > 0)
  const saved = sim.snapshot().messages.find(saved => saved.id === m.id)
  assert.ok(saved.observedAtDestination != null)
  assert.ok(saved.trace.some(r => r.type === T.ACK && !r.ok))
})
test('Later end ACKs preserve the time of the first confirmation', () => {
  const sim = quietLine(); const m = sim.sendMessage(0, 1, 'Un solo tiempo de entrega', 0); sim.advance(20)
  assert.equal(m.status, 'confirmed'); const first = m.confirmedAt; const p = m.packet
  sim.receive(sim.node(0), sim.packet(sim.node(1), T.ACK,
    [0, p.epoch >> 8, p.epoch & 255, p.seq >> 8, p.seq & 255, 0], { dst: 0, next: 0 }))
  assert.equal(m.confirmedAt, first)
})
test('A new MPR selector triggers an update even when the node was already a relay', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false }); sim.advance(0.2)
  const n = sim.node(1)
  for (const id of [0, 2]) n.neighbors.set(id, { id, heardAt: sim.time, helloAt: sim.time, report: [{ id: 1, symmetric: true, mpr: id === 0 }] })
  sim.refresh(n); n.lastTc = sim.time; n.tcDue = sim.time + 1000
  n.neighbors.get(2).report[0].mpr = true; sim.refresh(n)
  assert.ok(n.tcDue < sim.time + sim.config.topologyInterval)
})
test('Queued topology is superseded and stale copies do not get flooded', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false, strategy: 'flood' }); sim.advance(0.2)
  const p = { ...packet, type: T.TOPOLOGY, origin: 2, sender: 1, next: 255, dst: 255, payload: [1], seq: 10 }
  const n = sim.node(0)
  sim.receive(n, p); sim.receive(n, { ...p, seq: 11 }); sim.receive(n, { ...p, seq: 9 })
  assert.deepEqual(n.queue.filter(e => e.packet.type === T.TOPOLOGY).map(e => e.packet.seq), [11])
})
test('A later eligible TC copy can still authorize MPR forwarding', () => {
  const sim = new Sim(createScenario('hidden'), { automatic: false }); sim.advance(0.2)
  const n = sim.node(1)
  for (const id of [0, 2]) n.neighbors.set(id, { id, heardAt: sim.time, helloAt: sim.time, report: [{ id: 1, symmetric: true, mpr: id === 2 }] })
  const p = { ...packet, type: T.TOPOLOGY, origin: 9, sender: 0, dst: 255, next: 255, payload: [8] }
  sim.receive(n, p); assert.equal(n.queue.filter(e => e.packet.type === T.TOPOLOGY).length, 0)
  sim.receive(n, { ...p, sender: 2 }); assert.equal(n.queue.filter(e => e.packet.type === T.TOPOLOGY).length, 1)
})
test('25-node regression: maintenance stays bounded and all nine seeded transfers return ACKs', () => {
  for (const seed of [42, 73, 101]) {
    const sim = new Sim(createScenario(), { seed }); sim.advance(120)
    const before = sim.stats.control; sim.advance(120)
    assert.ok(sim.stats.control - before < 250, `seed ${seed}: control storm returned`)
    assert.ok(sim.stats.control > before, 'maintenance must still discover changes')
    for (const n of sim.nodes) {
      const txs = sim.history.filter(tx => tx.sender === n.id && [T.HELLO, T.TOPOLOGY].includes(tx.packet.type))
      for (let i = 1; i < txs.length; i++) assert.ok(txs[i].start - txs[i - 1].start >= (txs[i - 1].end - txs[i - 1].start) / sim.config.controlDuty - 0.002)
    }
    for (const dst of [16, 6, 24]) {
      const m = sim.sendMessage(0, dst, 'Necesitamos agua en el punto de encuentro.', 1); sim.advance(180)
      assert.equal(m.status, 'confirmed', `seed ${seed}, destination ${dst}`)
      assert.ok(sim.messageTrace(m.id).some(r => r.type === T.ACK && r.next === 0 && r.ok))
    }
  }
})
console.log(`${checks} emergency-radio checks passed.`)
