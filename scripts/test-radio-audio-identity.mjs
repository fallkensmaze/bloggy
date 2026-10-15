import assert from 'node:assert/strict'
import { FRAME_TYPES as T, encodeFrame, decodeFrame, textBytes, seededRandom } from '../src/utils/emergencyRadioAudio.js'
import { voxAudio, FskAudioReceiver } from '../src/utils/radioAudioModem.js'
import { AutoAudioStationProtocol } from '../src/utils/radioAudioAutoStation.js'
import { AudioStationProtocol } from '../src/utils/radioAudioStation.js'
import { browserIdentity, chooseStationId, identityHello, readIdentityHello, identityEnvelope, readIdentityEnvelope, IDENTITY_STORAGE_KEY } from '../src/utils/radioAudioIdentity.js'
import { identityTopologyPayload, readIdentityTopology } from '../src/utils/radioAudioIdentityTopology.js'

let checks = 0
const test = (name, fn) => { fn(); checks++; console.log(`✓ ${name}`) }
const uid = id => id.toString(16).padStart(32, '0')
const station = (identity, id = 1, extra = {}) => new AutoAudioStationProtocol({ identity: uid(identity), id, epoch: 1000 + identity, name: `Equipo ${identity}`, ...extra }, seededRandom(identity))
const ready = (identity, id, extra = {}) => { const s = station(identity, id, extra); s.joinState = 'ready'; return s }
const heard = (from, to, now = 0) => to.receive(decodeFrame(encodeFrame(from.packet(T.HELLO, textBytes(from.config.name)))), 1, now)
const mapNode = (s, identity, now) => s.snapshot(now).topology.nodes.find(n => n.identity === uid(identity))

// Serialize a lossless synthetic channel. Physical delivery uses station array
// indices, never short IDs (which may collide), and is unavailable to protocol.
function exchange(stations, connected, start = 0, until = 240) {
  const history = []; let time = start; let turn = 0
  while (time < until) {
    let emitted = false
    for (let i = 0; i < stations.length; i++) {
      const index = (turn + i) % stations.length; const s = stations[index]; const entry = s.take(time)
      if (!entry) continue
      const duration = (40 + entry.packet.payload.length) * 8 / s.config.baud + 0.82
      const p = decodeFrame(encodeFrame(entry.packet)); time += duration
      s.finish(entry, time); history.push({ index, time, packet: p })
      stations.forEach((other, j) => { if (j !== index && connected(index, j)) other.receive(p, 1, time) })
      time += 1.9; turn = (index + 1) % stations.length; emitted = true; break
    }
    if (!emitted) time += 0.2
  }
  return history
}

test('A browser keeps its random identity, independent browsers differ, and denied storage remains usable', () => {
  const makeStorage = () => { const data = new Map(); return { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) } }
  let count = 0; const crypto = { randomUUID: () => `${uid(++count).slice(0, 8)}-${uid(count).slice(8, 12)}-${uid(count).slice(12, 16)}-${uid(count).slice(16, 20)}-${uid(count).slice(20)}` }
  const a = makeStorage(); const b = makeStorage()
  assert.equal(browserIdentity(a, crypto).identity, browserIdentity(a, crypto).identity)
  assert.notEqual(browserIdentity(a, crypto).identity, browserIdentity(b, crypto).identity)
  a.setItem(IDENTITY_STORAGE_KEY, 'invalid'); assert.equal(browserIdentity(a, crypto).identity, uid(3))
  const denied = { getItem() { throw Error('denied') }, setItem() { throw Error('denied') } }
  const fallback = browserIdentity(denied, crypto); assert.equal(fallback.persistent, false)
  assert.equal(browserIdentity(denied, crypto).identity, fallback.identity)
})
test('Allocation excludes occupied IDs, including 254, and explicitly reports exhaustion', () => {
  const all = new Set(Array.from({ length: 254 }, (_, i) => i + 1))
  assert.equal(chooseStationId(all, () => 0), null)
  all.delete(254); assert.equal(chooseStationId(all, () => 0.5), 254)
  assert.equal(chooseStationId(new Set([1]), () => 0), 2)
})
test('All participants may start at ID 1 and converge without manual edits', () => {
  const all = [1, 2, 3, 4, 5, 6].map(i => station(i)); all.forEach(s => s.join(0))
  const history = exchange(all, () => true, 0, 600)
  assert.ok(all.every(s => s.joinState === 'ready'), JSON.stringify(all.map(s => ({ id: s.config.id, state: s.joinState, logs: s.logs.slice(-5) }))))
  assert.equal(new Set(all.map(s => s.config.id)).size, all.length)
  assert.deepEqual(all.map(s => s.identity), [1, 2, 3, 4, 5, 6].map(uid))
  assert.ok(history.length < 100); assert.ok(history.at(-1).time < 500)
  for (const s of all) assert.equal(s.take(650), null)
})
test('Hidden stations with the same ID resolve it through a relay when two networks meet', () => {
  const a = ready(1, 7); const relay = ready(2, 9); const c = ready(3, 7)
  const all = [a, relay, c]; all.forEach(s => s.announce(0))
  exchange(all, (i, j) => Math.abs(i - j) === 1, 0, 220)
  assert.equal(a.config.id, 7); assert.notEqual(c.config.id, 7)
  assert.equal(c.renumbers, 1); assert.equal(c.identity, uid(3)); assert.equal(c.joinState, 'ready')
  assert.equal(mapNode(a, 3, 220).kind, 'indirect')
  assert.equal(mapNode(a, 3, 220).id, c.config.id)
  assert.equal(a.peers.has(uid(3)), false)
})
test('The map keeps distinct UIDs separate while their short IDs still coincide', () => {
  const b = ready(2, 9, { shareTopology: false }); const a = ready(1, 7); const c = ready(3, 7)
  heard(a, b, 1); heard(c, b, 2)
  const nodes = b.snapshot(3).topology.nodes.filter(n => n.id === 7)
  assert.equal(nodes.length, 2); assert.notEqual(nodes[0].key, nodes[1].key)
  assert.ok(nodes.every(n => n.duplicateId)); assert.equal(b.peers.size, 2)
})
test('Directed DATA is delivered only to the selected UID, even with a shared alias', () => {
  const a = ready(1, 1, { shareTopology: false }); const b = ready(2, 7, { shareTopology: false }); const wrong = ready(3, 7, { shareTopology: false })
  heard(b, a, 0); const m = a.send('Solo para B', uid(2), 1); const tx = a.take(2); a.finish(tx, 5)
  const packet = decodeFrame(encodeFrame(tx.packet))
  wrong.receive(packet, 1, 6); assert.equal(wrong.inbox.length, 0); assert.equal(wrong.queue.length, 0)
  b.receive(packet, 1, 6); assert.equal(b.inbox.length, 1); assert.equal(b.inbox[0].originIdentity, uid(1))
  const ack = b.take(9); assert.equal(ack.packet.type, T.ACK)
  a.receive(decodeFrame(encodeFrame(ack.packet)), 1, 12); assert.equal(m.status, 'confirmed')
})
test('An ACK from another UID or the old protocol cannot confirm the message', () => {
  const a = ready(1, 1, { shareTopology: false }); const b = ready(2, 7, { shareTopology: false })
  heard(b, a); const m = a.send('Prueba', uid(2), 1); const tx = a.take(2); a.finish(tx, 5)
  b.receive(decodeFrame(encodeFrame(tx.packet)), 1, 6); const ack = b.take(9).packet
  const inner = readIdentityEnvelope(ack.payload).payload
  a.receive({ ...ack, payload: identityEnvelope(uid(3), uid(1), inner) }, 1, 10)
  assert.equal(m.status, 'waitingAck')
  a.receive({ ...ack, payload: inner }, 1, 11); assert.equal(m.status, 'waitingAck')
  a.receive({ ...ack, payload: identityEnvelope(uid(2), uid(4), inner) }, 1, 12); assert.equal(m.status, 'waitingAck')
  a.receive(ack, 1, 13); assert.equal(m.status, 'confirmed')
})
test('Renumbering interrupts pending messages and cannot revive them with a late ACK', () => {
  const a = ready(3, 7, { shareTopology: false }); const b = ready(4, 8, { shareTopology: false }); const winner = ready(1, 7)
  heard(b, a); const m = a.send('Prueba', uid(4), 1); const tx = a.take(2); a.finish(tx, 5)
  b.receive(decodeFrame(encodeFrame(tx.packet)), 1, 6); const ack = b.take(9).packet
  const epoch = a.config.epoch; heard(winner, a, 10)
  assert.equal(m.status, 'interrupted'); assert.notEqual(a.config.id, 7); assert.notEqual(a.config.epoch, epoch)
  a.joinState = 'ready'; a.receive(ack, 1, 11); assert.equal(m.status, 'interrupted')
  assert.equal(a.stats.acks, 0)
})
test('A late audio completion cannot revive a message cancelled during renumbering', () => {
  const a = ready(3, 7, { shareTopology: false }); const b = ready(4, 8, { shareTopology: false })
  heard(b, a); const m = a.send('Interrumpido', uid(4), 1); const tx = a.take(2)
  assert.equal(m.status, 'transmitting'); a.adoptId(9, 3)
  assert.equal(m.status, 'interrupted'); a.finish(tx, 5)
  assert.equal(m.status, 'interrupted'); assert.equal(a.transmitting, null)
  assert.equal(a.take(30), null)
})
test('Equal aliases, epochs and sequences from distinct UIDs are separate messages and ACKs', () => {
  const b = ready(2, 9, { shareTopology: false }); const a = ready(1, 7); const c = ready(3, 7)
  const packet = source => ({ type: T.DATA, net: 17, origin: 7, sender: 7, epoch: 10, seq: 10, dst: 9, next: 9, ttl: 1, priority: 1, attempt: 0,
    payload: identityEnvelope(source.identity, b.identity, [...textBytes(source.config.name)]) })
  const first = packet(a); const second = packet(c)
  b.receive(first, 1, 1); b.receive(second, 1, 2); b.receive(first, 1, 3)
  assert.equal(b.inbox.length, 2); assert.notEqual(b.inbox[0].id, b.inbox[1].id)
  assert.equal(b.queue.length, 2)
  assert.deepEqual(new Set(b.queue.map(e => readIdentityEnvelope(e.packet.payload).destination)), new Set([a.identity, c.identity]))
})
test('A selected recipient keeps its identity when its alias changes before transmission', () => {
  const a = ready(1, 1, { shareTopology: false }); const b = ready(2, 7, { shareTopology: false })
  heard(b, a); const m = a.send('Mismo equipo', uid(2), 1)
  b.adoptId(8, 2); heard(b, a, 3)
  const tx = a.take(4); assert.equal(tx.packet.dst, 8); assert.equal(readIdentityEnvelope(tx.packet.payload).destination, uid(2))
  a.finish(tx, 7); b.receive(decodeFrame(encodeFrame(tx.packet)), 1, 8)
  const ack = b.take(11); a.receive(ack.packet, 1, 14); assert.equal(m.status, 'confirmed')
})
test('Manual stations reserve their alias, while incomplete identity payloads are rejected', () => {
  const a = ready(3, 7, { shareTopology: false }); const old = new AudioStationProtocol({ id: 7, epoch: 90, name: 'Manual' })
  old.announce(0); a.receive(old.take(1).packet, 1, 3); assert.notEqual(a.config.id, 7)
  const p = ready(5, 10).packet(T.HELLO, [])
  for (const payload of [p.payload.slice(0, 10), [...p.payload, ...Array(40).fill(65)], [255, 73, 2, ...p.payload.slice(3)]]) {
    const b = ready(4, 11); b.receive({ ...p, payload }, 1, 1); assert.equal(b.peers.size, 0)
  }
  assert.equal(readIdentityHello(identityHello(uid(9), 'Árbol')).name, 'Árbol')
})
test('A full group, busy channel and shutdown cannot produce endless joining transmissions', () => {
  const a = station(1); a.join(0)
  for (let id = 1; id <= 254; id++) a.topology.binding(uid(id + 10), id, 1, 1, 0)
  assert.equal(a.take(10), null); assert.equal(a.joinState, 'full'); assert.equal(a.take(300), null)
  const b = station(2); b.join(0)
  for (let t = 0; t < 130; t++) assert.equal(b.take(t, 0), null)
  assert.equal(b.joinState, 'failed'); assert.equal(b.take(150), null)
  const c = station(3); c.join(0); c.stop(1)
  assert.equal(c.take(50), null); assert.equal(c.queue.length, 0); assert.equal(c.joinDue, Infinity)
})
test('A repeated browser identity is blocked instead of treating another session as the same station', () => {
  const a = ready(1, 7); const duplicate = ready(1, 8); duplicate.config.epoch++
  heard(duplicate, a, 2); assert.equal(a.identityConflict, true); assert.equal(a.stopped, true)
})
test('UID reports retain ages, fit 240 bytes, tolerate equal aliases and ignore old epochs after a change', () => {
  const a = ready(1, 1); const b = ready(2, 9)
  for (let n = 3; n <= 12; n++) heard(ready(n, 7), b, 10)
  const p = b.packet(T.TOPOLOGY, identityTopologyPayload(b.identity, 'N'.repeat(32), b.peers, 11), 255, { ttl: 4 })
  assert.ok(p.payload.length <= 240); assert.equal(readIdentityTopology(p).neighbors.length, 7)
  a.receive(p, 1, 12); a.receive(p, 1, 200)
  assert.ok(mapNode(a, 3, 312)?.kind === 'stale' || !mapNode(a, 3, 312))
  const oldAlias = b.config.id; b.adoptId(10, 201); heard(b, a, 202)
  a.receive(p, 1, 203); assert.equal(a.topology.bindings.get(uid(2)).id, 10); assert.notEqual(oldAlias, 10)
})
test('Maximum identity DATA, ACK and topology payloads round-trip through streaming audio at both rates', () => {
  for (const baud of [300, 600]) {
    const a = ready(1, 1, { shareTopology: false, baud }); const b = ready(2, 2, { shareTopology: false, baud })
    heard(b, a); const m = a.send('A'.repeat(96), uid(2), 1); const tx = a.take(2); a.finish(tx, 8)
    const decode = p => {
      const samples = voxAudio(p, { baud }); const rx = new FskAudioReceiver(baud); const frames = []
      rx.push(new Float32Array(137))
      for (let i = 0; i < samples.length; i += 251) frames.push(...rx.push(samples.subarray(i, i + 251)))
      assert.equal(frames.length, 1); return frames[0].packet
    }
    b.receive(decode(tx.packet), 1, 9); const ack = b.take(12); a.receive(decode(ack.packet), 1, 15)
    assert.equal(m.status, 'confirmed'); assert.equal(b.inbox[0].text.length, 96)
    for (let n = 3; n <= 9; n++) heard(ready(n, n), b, 16)
    const topo = b.packet(T.TOPOLOGY, identityTopologyPayload(b.identity, 'N'.repeat(32), b.peers, 17), 255, { ttl: 4 })
    assert.deepEqual(decode(topo), decodeFrame(encodeFrame(topo)))
  }
})
console.log(`\n${checks} automatic-identity checks passed.`)
