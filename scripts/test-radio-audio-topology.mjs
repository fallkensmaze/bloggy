import assert from 'node:assert/strict'
import { FRAME_TYPES as T, encodeFrame, decodeFrame, seededRandom } from '../src/utils/emergencyRadioAudio.js'
import { AudioStationProtocol } from '../src/utils/radioAudioStation.js'
import { AudioTopology, TOPOLOGY, topologyPayload, readTopology } from '../src/utils/radioAudioTopology.js'
import { FskAudioReceiver, voxAudio } from '../src/utils/radioAudioModem.js'

let checks = 0
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`) }
const station = (id, options = {}) => new AudioStationProtocol({ id, epoch: id * 100, name: `Estación ${id}`, ...options }, seededRandom(id))
const report = (origin, neighbors = [], extra = {}) => ({ type: T.TOPOLOGY, origin, sender: origin, net: 17, dst: 255, next: 255,
  ttl: 4, epoch: origin * 100, seq: 1, attempt: 0, priority: 2,
  payload: topologyPayload(`Estación ${origin}`, new Map(neighbors.map(id => [id, { id, lastHeard: 0 }])), 0), ...extra })
const node = (s, id, now) => s.snapshot(now).topology.nodes.find(n => n.id === id)

// Serial, lossless synthetic channel: topology decisions see only delivered
// frames. This is deliberately not a collision or RF performance benchmark.
function exchange(stations, connected, until = 240, audio = false) {
  const history = []; let time = 0; let turn = 0
  while (time < until) {
    let emitted = false
    for (let i = 0; i < stations.length; i++) {
      const index = (turn + i) % stations.length; const s = stations[index]; const entry = s.take(time)
      if (!entry) continue
      const samples = audio ? voxAudio(entry.packet) : null
      const duration = samples ? samples.length / 9600 : (40 + entry.packet.payload.length) * 8 / s.config.baud + 0.82
      let packet = decodeFrame(encodeFrame(entry.packet))
      if (audio) {
        const rx = new FskAudioReceiver(300); const frames = []
        rx.push(new Float32Array(137))
        for (let n = 0; n < samples.length; n += 197) frames.push(...rx.push(samples.subarray(n, n + 197)))
        assert.equal(frames.length, 1); packet = frames[0].packet
      }
      time += duration; s.finish(entry, time); history.push({ time, sender: s.config.id, packet })
      for (const other of stations) if (other !== s && connected(s.config.id, other.config.id)) other.receive(packet, 1, time)
      time += 1.9; turn = (index + 1) % stations.length; emitted = true; break
    }
    if (!emitted) time += 0.2
  }
  return history
}

test('Versioned UTF-8 reports fit the modem and reject malformed, simulator or impossible envelopes', () => {
  const p = report(2, Array.from({ length: 32 }, (_, i) => i + 3))
  assert.ok(p.payload.length <= 134); assert.equal(readTopology(p).neighbors.length, 32)
  assert.deepEqual(decodeFrame(encodeFrame(p)), p)
  for (const bad of [{ ...p, ttl: 5 }, { ...p, ttl: 3 }, { ...p, origin: 0 }, { ...p, dst: 1 },
    { ...p, payload: [1, 2, 3] }, { ...p, payload: [...p.payload, 1] },
    { ...p, payload: p.payload.map((b, i) => i === 3 ? 255 : b) },
    { ...p, payload: p.payload.map((b, i) => i === 6 ? 255 : b) },
    report(2, [2]), report(2, [3], { sender: 1 })]) assert.equal(readTopology(bad), null)
})
test('No unsolicited periodic reports; HELLO starts one coalesced response and listen-only disables propagation', () => {
  const a = station(1); const b = station(2); const silent = station(3, { shareTopology: false })
  for (let t = 0; t < 600; t++) assert.equal(b.take(t), null)
  a.announce(600); const hello = a.take(601)
  b.receive(hello.packet, 1, 604); const due = b.topologyDue
  b.receive(hello.packet, 1, 605); assert.equal(b.topologyDue, due)
  silent.receive(hello.packet, 1, 604); assert.equal(silent.topologyDue, Infinity); assert.equal(silent.take(620), null)
  assert.equal(silent.peers.get(1).name, 'Estación 1')
})
test('A four-station chain builds a local map at every station, including nodes outside direct hearing', () => {
  const all = [1, 2, 3, 4].map(id => station(id)); all[0].announce(0)
  const history = exchange(all, (a, b) => Math.abs(a - b) === 1)
  for (const s of all) {
    assert.deepEqual(s.snapshot(240).topology.nodes.map(n => n.id).sort(), [1, 2, 3, 4])
    assert.equal(s.stats.acks, 0); assert.equal(s.inbox.length, 0)
  }
  assert.equal(node(all[0], 2, 240).kind, 'direct')
  assert.equal(node(all[0], 4, 240).kind, 'indirect')
  assert.equal(node(all[0], 4, 240).via, 2)
  assert.deepEqual(node(all[0], 4, 240).path, [1, 2, 3, 4])
  assert.ok(!all[0].peers.has(3)); assert.ok(!all[0].peers.has(4))
  assert.ok(history.every(e => e.packet.type !== T.ACK && e.packet.type !== T.DATA))
  assert.ok(history.at(-1).time < 180, 'Discovery must become silent')
})
test('Three stations propagate discovery through actual streaming BFSK frames', () => {
  const all = [1, 2, 3].map(id => station(id)); all[0].announce(0)
  exchange(all, (a, b) => Math.abs(a - b) === 1, 150, true)
  assert.equal(node(all[0], 3, 150).kind, 'indirect')
  assert.equal(node(all[2], 1, 150).kind, 'indirect')
  assert.equal(all[0].peers.has(3), false)
})
test('Reports never invent a reverse link, direct peer, RF quality or end-to-end ACK', () => {
  const a = station(1, { shareTopology: false })
  a.receive(report(2, [3]), 0.8, 10)
  const map = a.snapshot(11).topology
  assert.ok(map.links.some(e => e.from === 3 && e.to === 2))
  assert.ok(!map.links.some(e => e.from === 2 && e.to === 3))
  assert.equal(node(a, 3, 11).quality, undefined)
  const m = a.send('¿Me oyes?', 3, 11); const tx = a.take(12); assert.equal(tx.packet.ttl, 1); assert.equal(tx.packet.next, 3)
  a.finish(tx, 16); a.receive(report(3, [1], { sender: 2, ttl: 3 }), 1, 17)
  assert.equal(m.status, 'waitingAck'); assert.equal(a.stats.acks, 0)
})
test('Duplicate and out-of-order reports do not renew remote age; stale observations disappear', () => {
  const a = station(1, { shareTopology: false }); const p = report(3, [4], { sender: 2, ttl: 3 })
  a.receive(p, 1, 10); a.receive(p, 1, 200)
  assert.equal(node(a, 3, 200).age, 190)
  a.receive({ ...p, seq: 0 }, 1, 250)
  assert.equal(node(a, 3, 311).kind, 'stale')
  assert.equal(node(a, 3, 611), undefined); assert.equal(node(a, 4, 611), undefined)
  a.receive(p, 1, 612); assert.equal(node(a, 3, 612), undefined)
  a.receive({ ...p, seq: 2 }, 1, 613); assert.equal(node(a, 3, 613).kind, 'indirect')
})
test('Serial wrap and restarts replace old reports; retired epochs cannot restore old neighbors', () => {
  const map = new AudioTopology(1)
  for (const [epoch, seq] of [[300, 65535], [300, 0], [301, 1]]) {
    const p = report(3, [4], { sender: 2, ttl: 3, epoch, seq }); assert.equal(map.accept(p, readTopology(p), 10), true)
  }
  const old = report(3, [5], { sender: 2, ttl: 3, epoch: 300, seq: 1 })
  assert.equal(map.accept(old, readTopology(old), 11), false)
  const latest = report(3, [], { sender: 2, ttl: 3, epoch: 301, seq: 2 })
  map.accept(latest, readTopology(latest), 12)
  assert.deepEqual(map.snapshot(new Map(), 'A', 12).links, [])
})
test('Forwarding includes queue time and audio airtime, and per-link age is retained', () => {
  const b = station(2); const p = report(3, [4]); p.payload[4] = 100; p.payload[p.payload.length - 1] = 150
  b.receive(p, 1, 1000); b.topologyDue = Infinity
  const e = b.take(1050); assert.equal(e.packet.origin, 3); assert.equal(e.packet.sender, 2); assert.equal(e.packet.ttl, 3)
  const parsed = readTopology(e.packet); assert.ok(parsed.age >= 150); assert.equal(parsed.neighbors[0].age, 150)
  const a = station(1, { shareTopology: false }); a.receive(e.packet, 1, 1055)
  assert.ok(node(a, 4, 1055).age >= 300); assert.equal(node(a, 4, 1055).kind, 'stale')
  assert.ok(node(a, 3, 1055).age >= 150)
})
test('TTL, duplicate suppression, group isolation and self echoes bound forwarding', () => {
  const a = station(1); const p = report(3, [], { sender: 2, ttl: 1 })
  a.receive(p, 1, 1); assert.equal(a.queue.length, 0)
  a.receive({ ...p, seq: 2, ttl: 2 }, 1, 2); assert.equal(a.queue.length, 1)
  a.receive({ ...p, seq: 2, ttl: 2 }, 1, 3); assert.equal(a.queue.length, 1)
  a.receive(report(4, [], { net: 99 }), 1, 4); assert.equal(a.peers.has(4), false)
  a.receive(report(1, [], { sender: 2, ttl: 2, epoch: a.config.epoch }), 1, 5); assert.equal(a.conflict, false)
  const q = station(1); q.receive(report(1, [], { epoch: 999 }), 1, 6)
  assert.equal(q.conflict, true); assert.equal(q.take(100), null)
})
test('ACKs and DATA outrank topology; waiting for an ACK suppresses map transmissions', () => {
  const a = station(1); a.receive(report(3), 1, 0)
  const m = a.send('Texto', 2, 0); const data = a.take(10)
  assert.equal(data.packet.type, T.DATA); a.finish(data, 12)
  assert.equal(a.take(13), null)
  const incoming = station(4).packet(T.DATA, [65], 1); a.receive(incoming, 1, 13)
  const ack = a.take(16); assert.equal(ack.packet.type, T.ACK); a.finish(ack, 18)
  assert.equal(m.status, 'waitingAck')
  a.setShareTopology(false); assert.equal(a.topologyDue, Infinity); assert.ok(a.queue.every(e => e.packet.type !== T.TOPOLOGY))
})
test('Stopping cancels deferred discovery; occupied channels and full queues remain bounded', () => {
  const a = station(1); a.receive(report(2), 1, 0)
  assert.equal(a.take(15, 0.1), null); assert.equal(a.take(16, 2, true), null)
  for (let id = 3; id <= 40; id++) a.receive(report(id), 1, 17)
  assert.ok(a.queue.length <= TOPOLOGY.maxQueued)
  a.stop(18); assert.equal(a.topologyDue, Infinity); assert.equal(a.take(1000), null)
  a.receive(report(2, [], { seq: 2 }), 1, 1001); assert.equal(a.queue.length, 0)
})
test('A busy channel rearms random control backoff and expires a deferred discovery request', () => {
  const a = station(1); a.receive(report(2), 1, 0)
  assert.equal(a.take(10, 0.1), null)
  assert.equal(a.take(11, 1), null)
  assert.ok(a.controlReadyAt > 11)
  assert.ok(a.take(14, 4))
  const b = station(2); b.announce(0)
  for (let t = 0; t < 200; t++) assert.equal(b.take(t, 0.1), null)
  assert.equal(b.topologyDue, Infinity); assert.equal(b.queue.length, 0)
  assert.equal(b.take(205), null)
  const peers = new Map([[3, { id: 3, lastHeard: 0 }]])
  const p = report(2); p.payload = topologyPayload('Equipo', peers, 299.9)
  assert.deepEqual(readTopology(p).neighbors, [], 'Age rounding at expiry must not invalidate a whole report')
})
test('A dense 12-station discovery remains bounded and becomes silent without periodic beacons', () => {
  const all = Array.from({ length: 12 }, (_, i) => station(i + 1)); all[0].announce(0)
  const history = exchange(all, () => true, 600)
  assert.ok(history.length < 180, `Unexpected control storm: ${history.length} frames`)
  assert.ok(history.at(-1).time < 400)
  for (const s of all) {
    assert.ok(s.queue.length <= TOPOLOGY.maxQueued + 1)
    const relays = history.filter(e => e.sender === s.config.id && e.packet.origin !== s.config.id)
    assert.equal(new Set(relays.map(e => `${e.packet.origin}:${e.packet.epoch}:${e.packet.seq}`)).size, relays.length)
    assert.equal(s.take(1000), null)
  }
})
console.log(`\n${checks} topology checks passed.`)
