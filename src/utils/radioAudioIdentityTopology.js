import { bytesText, textBytes } from './emergencyRadioAudio.js'
import { AudioTopology, TOPOLOGY } from './radioAudioTopology.js'
import { validIdentity, identityBytes, bytesIdentity, BROADCAST_IDENTITY } from './radioAudioIdentity.js'

export const IDENTITY_NEIGHBORS = 7
export const legacyIdentity = (id, epoch) => `legacy:${id}:${epoch}`
const validId = id => Number.isInteger(id) && id >= 1 && id <= 254
const word = (hi, lo) => hi * 256 + lo

export function readIdentityTopology(p) {
  const b = p.payload
  if (!validId(p.origin) || !validId(p.sender) || p.dst !== 255 || p.next !== 255 ||
    !Number.isInteger(p.ttl) || p.ttl < 1 || p.ttl > TOPOLOGY.maxHops || !Array.isArray(b) || b.length < 39 ||
    b.some(v => !Number.isInteger(v) || v < 0 || v > 255) || b[0] !== 82 || b[1] !== 65 || b[2] !== 2 || b[5] < 1 || b[5] > 32) return null
  const age = word(b[3], b[4]); const end = 38 + b[5]
  const identity = bytesIdentity(b.slice(6, 22)); const senderIdentity = bytesIdentity(b.slice(22, 38))
  if (!validIdentity(identity) || !validIdentity(senderIdentity) || age >= TOPOLOGY.lifetime || end > b.length ||
    (b.length - end) % 23 || (b.length - end) / 23 > IDENTITY_NEIGHBORS ||
    (identity === senderIdentity ? p.ttl !== 4 || p.origin !== p.sender : p.ttl === 4)) return null
  const name = bytesText(Uint8Array.from(b.slice(38, end)))
  if (!name?.trim()) return null
  const neighbors = []; const keys = new Set()
  for (let i = end; i < b.length; i += 23) {
    const id = b[i]; const uid = bytesIdentity(b.slice(i + 1, i + 17))
    const epoch = word(b[i + 17], b[i + 18]); const seq = word(b[i + 19], b[i + 20]); const heardAge = word(b[i + 21], b[i + 22])
    const key = uid === BROADCAST_IDENTITY ? legacyIdentity(id, epoch) : uid
    if (!validId(id) || !(validIdentity(uid) || uid === BROADCAST_IDENTITY) || uid === identity || keys.has(key) || heardAge >= TOPOLOGY.lifetime) return null
    keys.add(key); neighbors.push({ id, identity: key, epoch, seq, age: heardAge, legacy: uid === BROADCAST_IDENTITY })
  }
  return { identity, senderIdentity, name, age, neighbors }
}

export function identityTopologyPayload(identity, name, peers, now) {
  const bytes = [...textBytes(name.trim())]
  const recent = [...peers.values()].filter(p => p.identity !== identity && Math.ceil(now - p.lastHeard) < TOPOLOGY.lifetime)
    .sort((a, b) => b.lastHeard - a.lastHeard || a.identity.localeCompare(b.identity)).slice(0, IDENTITY_NEIGHBORS)
  return [82, 65, 2, 0, 0, bytes.length, ...identityBytes(identity), ...identityBytes(identity), ...bytes,
    ...recent.flatMap(p => {
      const age = Math.ceil(Math.max(0, now - p.lastHeard)); const epoch = p.epoch || 0; const seq = p.seq || 0
      return [p.id, ...identityBytes(p.legacy ? BROADCAST_IDENTITY : p.identity), epoch >> 8, epoch & 255, seq >> 8, seq & 255, age >> 8, age & 255]
    })]
}

export function topologySender(payload, identity) { const b = [...payload]; b.splice(22, 16, ...identityBytes(identity)); return b }

export class IdentityTopology extends AudioTopology {
  constructor(identity, alias) { super(identity); this.alias = alias; this.bindings = new Map() }
  binding(identity, id, epoch, seq, at, authored = true, name) {
    if (identity === this.id) return false
    const previous = this.bindings.get(identity)
    if (previous) {
      if (!authored && previous.authored) return false
      if (previous.epoch === epoch) {
        const delta = (seq - previous.seq + 65536) % 65536
        if (delta >= 32768 || (delta === 0 && !(authored && !previous.authored))) return false
      } else if (previous.retired.includes(epoch) || (!authored && at <= previous.at)) return false
    }
    const retired = previous && previous.epoch !== epoch ? [...previous.retired, previous.epoch].slice(-8) : previous?.retired || []
    this.bindings.set(identity, { identity, id, epoch, seq, at, authored, retired, name: name || previous?.name,
      legacy: !validIdentity(identity) })
    if (this.bindings.size > 512) {
      const oldest = [...this.bindings.values()].sort((a, b) => a.at - b.at)[0]
      this.bindings.delete(oldest.identity); this.reports.delete(oldest.identity); this.versions.delete(oldest.identity)
    }
    return true
  }
  accept(p, report, now) {
    if (report.identity === this.id || this.bindings.get(report.identity)?.retired.includes(p.epoch)) return false
    this.binding(report.identity, p.origin, p.epoch, p.seq, now - report.age, true, report.name)
    const accepted = super.accept({ ...p, origin: report.identity, sender: report.senderIdentity },
      { ...report, neighbors: report.neighbors.map(n => ({ id: n.identity, age: n.age })) }, now)
    if (accepted) for (const n of report.neighbors) this.binding(n.identity, n.id, n.epoch, n.seq, now - report.age - n.age, false)
    return accepted
  }
  isLatest(p) {
    const identity = bytesIdentity(p.payload.slice(6, 22))
    return !this.bindings.get(identity)?.retired.includes(p.epoch) && super.isLatest({ ...p, origin: identity })
  }
  occupied(now, peers) {
    return new Set([...this.bindings.values()].filter(v => now - v.at < TOPOLOGY.lifetime).map(v => v.id)
      .concat([...peers.values()].filter(v => now - v.lastHeard < TOPOLOGY.lifetime).map(v => v.id)))
  }
  snapshot(peers, name, now) {
    const view = super.snapshot(new Map([...peers].map(([key, p]) => [key, { ...p, id: key }])), name, now)
    const alias = key => key === this.id ? this.alias : this.bindings.get(key)?.id ?? peers.get(key)?.id
    const toAlias = path => path.map(alias).filter(id => id != null)
    const claims = [...this.bindings.values()].filter(v => now - v.at < TOPOLOGY.lifetime)
    view.nodes = view.nodes.map(n => ({ ...n, key: n.id, identity: n.id, id: alias(n.id),
      name: n.id === this.id ? name : this.bindings.get(n.id)?.name || peers.get(n.id)?.name || `Equipo ${alias(n.id)}`,
      path: toAlias(n.path || []), pathIdentities: n.path, via: n.via ? alias(n.via) : null,
      legacy: n.id !== this.id && !validIdentity(n.id),
      duplicateId: n.id !== this.id && (alias(n.id) === this.alias || claims.some(v => v.identity !== n.id && v.id === alias(n.id))) }))
    view.links = view.links.map(e => ({ ...e, fromId: alias(e.from), toId: alias(e.to), local: e.reportedBy === this.id, reporterId: alias(e.reportedBy) }))
    return { ...view, maxNeighbors: IDENTITY_NEIGHBORS }
  }
}
