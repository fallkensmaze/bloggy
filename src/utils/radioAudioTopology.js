import { bytesText, textBytes } from './emergencyRadioAudio.js'

// Observations only: an arrow A -> B means B decoded A, not a usable route.
// Age is carried in seconds, so forwarding never renews an observation.
export const TOPOLOGY = { lifetime: 300, retain: 600, maxHops: 4, maxNeighbors: 32, ownInterval: 30, relayInterval: 8, maxQueued: 6 }
const validId = id => Number.isInteger(id) && id >= 1 && id <= 254
const word = (hi, lo) => hi * 256 + lo

export function readTopology(p) {
  const b = p.payload
  if (!validId(p.origin) || !validId(p.sender) || p.dst !== 255 || p.next !== 255 ||
    !Number.isInteger(p.ttl) || p.ttl < 1 || p.ttl > TOPOLOGY.maxHops ||
    (p.sender === p.origin ? p.ttl !== TOPOLOGY.maxHops : p.ttl === TOPOLOGY.maxHops) ||
    !Array.isArray(b) || b.length < 7 || b.some(v => !Number.isInteger(v) || v < 0 || v > 255) ||
    b[0] !== 0x52 || b[1] !== 0x41 || b[2] !== 1 || b[5] < 1 || b[5] > 32) return null
  const age = word(b[3], b[4]); const end = 6 + b[5]
  if (age >= TOPOLOGY.lifetime || end > b.length || (b.length - end) % 3 || (b.length - end) / 3 > TOPOLOGY.maxNeighbors) return null
  const name = bytesText(Uint8Array.from(b.slice(6, end)))
  if (!name?.trim()) return null
  const neighbors = []; const ids = new Set()
  for (let i = end; i < b.length; i += 3) {
    const id = b[i]; const heardAge = word(b[i + 1], b[i + 2])
    if (!validId(id) || id === p.origin || ids.has(id) || heardAge >= TOPOLOGY.lifetime) return null
    ids.add(id); neighbors.push({ id, age: heardAge })
  }
  return { name, age, neighbors }
}

export function topologyPayload(name, peers, now) {
  const bytes = [...textBytes(name.trim())]
  const recent = [...peers.values()].filter(p => Math.ceil(now - p.lastHeard) < TOPOLOGY.lifetime)
    .sort((a, b) => b.lastHeard - a.lastHeard || a.id - b.id).slice(0, TOPOLOGY.maxNeighbors)
  return [0x52, 0x41, 1, 0, 0, bytes.length, ...bytes, ...recent.flatMap(p => {
    const age = Math.ceil(Math.max(0, now - p.lastHeard))
    return [p.id, age >> 8, age & 255]
  })]
}

export function ageTopology(payload, seconds) {
  const age = word(payload[3], payload[4]) + Math.ceil(Math.max(0, seconds))
  if (age >= TOPOLOGY.lifetime) return null
  const aged = [...payload]; aged[3] = age >> 8; aged[4] = age & 255
  return aged
}

export class AudioTopology {
  constructor(id) { this.id = id; this.reports = new Map(); this.versions = new Map() }
  accept(p, report, now) {
    if (p.origin === this.id) return false
    const previous = this.versions.get(p.origin)
    if (previous) {
      if (previous.epoch === p.epoch) {
        const delta = (p.seq - previous.seq + 65536) % 65536
        if (delta === 0 || delta >= 32768) return false
      } else if (previous.retired.includes(p.epoch)) return false
    }
    // Keep a bounded restart history as well as the latest serial number. Old
    // packets cannot revive a disappeared node merely by circulating in a loop.
    const retired = previous?.epoch !== p.epoch && previous ? [...previous.retired, previous.epoch].slice(-8) : previous?.retired || []
    this.versions.set(p.origin, { epoch: p.epoch, seq: p.seq, retired })
    this.reports.set(p.origin, { ...report, origin: p.origin, epoch: p.epoch, seq: p.seq,
      via: p.sender, hops: TOPOLOGY.maxHops - p.ttl + 1, generatedAt: now - report.age,
      neighbors: report.neighbors.map(n => ({ id: n.id, heardAt: now - report.age - n.age })) })
    return true
  }
  isLatest(p) { const v = this.versions.get(p.origin); return v?.epoch === p.epoch && v?.seq === p.seq }
  snapshot(peers, name, now) {
    const nodes = new Map([[this.id, { id: this.id, name, kind: 'self', age: 0, hops: 0, path: [this.id] }]])
    const edges = new Map()
    const addNode = (id, at, info = {}) => {
      if (id === this.id || now - at >= TOPOLOGY.retain) return
      const old = nodes.get(id)
      nodes.set(id, { id, name: `Estación ${id}`, ...old, ...info, lastObserved: Math.max(old?.lastObserved ?? -Infinity, at) })
    }
    const addEdge = (from, to, at, reportedBy) => {
      if (now - at >= TOPOLOGY.retain) return
      const id = `${from}:${to}`; const old = edges.get(id)
      if (!old || old.observedAt < at) edges.set(id, { from, to, observedAt: at, reportedBy,
        age: Math.max(0, now - at), stale: now - at >= TOPOLOGY.lifetime })
    }
    for (const r of this.reports.values()) {
      if (now - r.generatedAt >= TOPOLOGY.retain) continue
      addNode(r.origin, r.generatedAt, { name: r.name, reportedVia: r.via, reportHops: r.hops })
      for (const n of r.neighbors) {
        addNode(n.id, n.heardAt, { reportedVia: r.via })
        addEdge(n.id, r.origin, n.heardAt, r.origin)
      }
    }
    for (const p of peers.values()) {
      addNode(p.id, p.lastHeard, { ...(p.named ? { name: p.name } : {}), lastHeard: p.lastHeard, confirmedAt: p.confirmedAt })
      addEdge(p.id, this.id, p.lastHeard, this.id)
    }
    // An undirected chain is only a display aid. Never use it to send DATA or
    // infer bidirectionality; the individual arrows retain their direction.
    const adjacent = new Map()
    for (const e of edges.values()) if (!e.stale) {
      for (const [from, to] of [[e.from, e.to], [e.to, e.from]]) {
        if (!adjacent.has(from)) adjacent.set(from, new Set())
        adjacent.get(from).add(to)
      }
    }
    const paths = new Map([[this.id, [this.id]]]); const todo = [this.id]
    for (let i = 0; i < todo.length; i++) {
      const id = todo[i]
      for (const next of adjacent.get(id) || []) {
        if (!paths.has(next)) { paths.set(next, [...paths.get(id), next]); todo.push(next) }
      }
    }
    for (const n of nodes.values()) {
      if (n.id === this.id) continue
      n.age = Math.max(0, now - n.lastObserved)
      n.kind = n.age >= TOPOLOGY.lifetime ? 'stale' : n.lastHeard != null && now - n.lastHeard < TOPOLOGY.lifetime ? 'direct' : 'indirect'
      n.path = paths.get(n.id) || []
      n.hops = n.path.length ? n.path.length - 1 : null
      n.via = n.kind === 'indirect' ? (n.path.length > 2 ? n.path[1] : n.reportedVia) : null
    }
    return { updatedAt: now, lifetime: TOPOLOGY.lifetime, maxHops: TOPOLOGY.maxHops,
      nodes: [...nodes.values()].sort((a, b) => (a.kind === 'self' ? -1 : b.kind === 'self' ? 1 : a.id - b.id)),
      links: [...edges.values()].filter(e => nodes.has(e.from) && nodes.has(e.to)) }
  }
}
