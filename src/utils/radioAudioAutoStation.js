import { FRAME_TYPES as T, textBytes, bytesText } from './emergencyRadioAudio.js'
import { AudioStationProtocol } from './radioAudioStation.js'
import { TOPOLOGY } from './radioAudioTopology.js'
import { validIdentity, chooseStationId, identityHello, readIdentityHello, identityEnvelope, readIdentityEnvelope, BROADCAST_IDENTITY } from './radioAudioIdentity.js'
import { IdentityTopology, readIdentityTopology, identityTopologyPayload, topologySender, legacyIdentity } from './radioAudioIdentityTopology.js'

const validId = id => Number.isInteger(id) && id >= 1 && id <= 254
const word = (a, b) => a * 256 + b
export const JOIN_LABELS = { idle: 'Sin incorporar', listening: 'Escuchando los identificadores ocupados', claiming: 'Anunciando mi identificador',
  settling: 'Comprobando coincidencias', ready: 'Incorporada', full: 'No quedan identificadores libres', failed: 'No se ha completado la incorporación' }

// The UID is stable, but the short address is a revocable local claim. It is
// never used as proof of who received a DATA or who returned an ACK.
export class AutoAudioStationProtocol extends AudioStationProtocol {
  constructor(options, random = Math.random) {
    if (!validIdentity(options.identity)) throw new Error('La identidad automática no es válida.')
    super({ ...options, id: validId(options.id) ? options.id : chooseStationId(new Set(), random),
      name: options.name?.trim() || `Equipo ${options.identity.slice(0, 4).toUpperCase()}`, autoId: true }, random)
    this.identity = options.identity; this.topology = new IdentityTopology(this.identity, this.config.id)
    this.joinState = 'idle'; this.joinDue = Infinity; this.joinExpires = 0; this.claimAttempts = 0; this.renumbers = 0
    this.nextDefenseAt = 0; this.oldEpochs = new Set(); this.identityConflict = false
  }
  join(now) {
    if (this.stopped) return
    this.joinState = 'listening'; this.joinDue = now + 3 + this.random() * 3; this.joinExpires = now + 120
    this.claimAttempts = 0; this.log('Incorporación automática: escuchando antes de anunciar el identificador.', now)
  }
  packet(type, payload, dst = 255, extra = {}) {
    const p = super.packet(type, payload, dst, extra)
    p.sourceIdentity = this.identity
    if (type === T.HELLO) p.payload = identityHello(this.identity, this.config.name)
    if (type === T.DATA || type === T.ACK) {
      const target = dst === 255 ? BROADCAST_IDENTITY : type === T.DATA ? this.sendingIdentity : this.ackIdentity
      if (!validIdentity(target) && target !== BROADCAST_IDENTITY) throw new Error('Falta la identidad del destinatario.')
      p.payload = identityEnvelope(this.identity, target, payload); p.destinationIdentity = target
    }
    return p
  }
  makeTopologyPayload(now) { return identityTopologyPayload(this.identity, this.config.name, this.peers, now) }
  canTransmitTopology() { return this.joinState === 'ready' }
  ackWaitSeconds() { return Math.max(10, (this.config.leadMs + this.config.tailMs + 2 * this.config.releaseMs) / 1000 + 81 * 8 / this.config.baud + 3) }
  requestTopology(now) {
    if (this.joinState === 'ready') super.requestTopology(now)
    else if (!['idle', 'full', 'failed'].includes(this.joinState)) this.mapAfterJoin = true
  }
  observePeer(p, quality, now) {
    const identity = p.sourceIdentity || legacyIdentity(p.sender, p.epoch)
    const old = this.peers.get(identity)
    const newlyHeard = !old || now - old.lastHeard >= TOPOLOGY.lifetime
    this.topology.binding(identity, p.sender, p.epoch, p.seq, now, true, p.peerName)
    const binding = this.topology.bindings.get(identity)
    const peer = { ...old, id: binding?.id ?? p.sender, identity, key: identity, legacy: !validIdentity(identity),
      epoch: binding?.epoch ?? p.epoch, seq: binding?.seq ?? p.seq, name: binding?.name || old?.name || `Equipo ${p.sender}`,
      named: true, lastHeard: now, quality }
    if (old && old.epoch !== peer.epoch) delete peer.confirmedAt
    this.peers.set(identity, peer)
    if (this.peers.size > 512) this.peers.delete(this.peers.keys().next().value)
    return { peer, newlyHeard }
  }
  cancelAddressTraffic(now) {
    this.queue = []; this.topologyDue = Infinity
    for (const m of this.messages) if (['queued', 'transmitting', 'waitingAck'].includes(m.status)) m.status = 'interrupted'
    this.log('Se han cancelado los envíos pendientes del identificador anterior.', now)
  }
  adoptId(id, now, conflict = false) {
    if (id === this.config.id) return
    const previous = this.config.id
    this.cancelAddressTraffic(now)
    this.oldEpochs.add(this.config.epoch)
    this.config.epoch = (this.config.epoch + 1) & 65535
    this.config.id = id; this.topology.alias = id
    if (conflict) this.renumbers++
    this.log(`ID ${previous} ocupado: se ha elegido automáticamente el ID ${id}. La identidad del equipo se conserva.`, now)
  }
  noAddress(now, state = 'full') {
    this.joinState = state; this.joinDue = Infinity; this.cancelAddressTraffic(now)
    this.log(state === 'full' ? 'No queda ningún ID libre en este grupo. Detén y vuelve a incorporarte cuando haya espacio.' : 'Incorporación interrumpida por demasiados conflictos o espera. Detén y vuelve a incorporarte.', now)
  }
  resolveAddress(now) {
    if (this.stopped || ['idle', 'full', 'failed', 'listening'].includes(this.joinState)) return
    const competing = [...this.topology.bindings.values()].filter(v => v.id === this.config.id && now - v.at < TOPOLOGY.lifetime)
    if (!competing.length) return
    if (competing.some(v => v.legacy || v.identity < this.identity)) {
      if (this.renumbers >= 8) { this.noAddress(now, 'failed'); return }
      const occupied = this.topology.occupied(now, this.peers); occupied.add(this.config.id)
      const next = chooseStationId(occupied, this.random)
      if (next == null) { this.noAddress(now); return }
      this.adoptId(next, now, true); this.join(now)
    } else if (now >= this.nextDefenseAt) {
      this.nextDefenseAt = now + 30; this.announce(now)
    }
  }
  ownIdentitySeen(p, identity, now) {
    if (identity !== this.identity) return false
    if (p.epoch !== this.config.epoch && !this.oldEpochs.has(p.epoch)) {
      this.identityConflict = true; this.conflict = true; this.stop(now)
      this.log('Esta identidad ya está activa en otra sesión. Cierra la otra pestaña o sesión antes de incorporarte.', now)
    }
    return true
  }
  receiveTopology(p, quality, now) {
    const report = readIdentityTopology(p)
    if (!report) return
    if (report.senderIdentity === this.identity) {
      if (report.identity === this.identity) this.ownIdentitySeen(p, this.identity, now)
      return
    }
    this.stats.rx++
    // The sender of a relayed report has its own UID, not the author's epoch.
    const binding = this.topology.bindings.get(report.senderIdentity)
    const direct = report.identity === report.senderIdentity
    const epoch = direct ? p.epoch : binding?.epoch ?? 0
    const seq = direct ? p.seq : binding?.seq ?? 0
    if (!direct && !binding) this.topology.binding(report.senderIdentity, p.sender, epoch, seq, now, false)
    const old = this.peers.get(report.senderIdentity)
    if (direct) this.observePeer({ ...p, sourceIdentity: report.senderIdentity, peerName: report.name }, quality, now)
    else {
      this.peers.set(report.senderIdentity, { ...old, id: p.sender, identity: report.senderIdentity, key: report.senderIdentity,
        epoch, seq, name: binding?.name || old?.name || `Equipo ${p.sender}`, named: true, lastHeard: now, quality })
      if (this.peers.size > 512) this.peers.delete(this.peers.keys().next().value)
    }
    if (!old || now - old.lastHeard >= TOPOLOGY.lifetime) this.requestTopology(now)
    const fresh = this.topology.accept(p, report, now)
    // Alias changes learned indirectly also update the label of an already
    // heard UID, without pretending to have heard a new radio transmission.
    for (const [uid, peer] of this.peers) {
      const current = this.topology.bindings.get(uid)
      if (current?.authored) { peer.id = current.id; peer.epoch = current.epoch; peer.seq = current.seq; if (current.name) peer.name = current.name }
    }
    this.resolveAddress(now)
    if (!fresh || !this.config.shareTopology || p.ttl <= 1 || this.stopped || ['full', 'failed'].includes(this.joinState)) return
    this.queue = this.queue.filter(e => e.packet.type !== T.TOPOLOGY || readIdentityTopology(e.packet)?.identity !== report.identity)
    if (this.queue.length >= 20 || this.queue.filter(e => e.packet.type === T.TOPOLOGY).length >= TOPOLOGY.maxQueued) return
    this.enqueue({ ...p, sender: this.config.id, ttl: p.ttl - 1, payload: topologySender(p.payload, this.identity) }, now,
      { topologyAt: now, ready: now + this.config.releaseMs / 1000 + 2 + this.random() * 6, expires: Math.min(now + 60, now + TOPOLOGY.lifetime - report.age) })
  }
  receive(p, quality, now) {
    this.time = now
    if (this.stopped || p.net !== this.config.network) return
    if (p.type === T.TOPOLOGY) { this.receiveTopology(p, quality, now); return }
    if (p.sender !== p.origin || p.next !== p.dst || p.ttl !== 1 || !validId(p.sender) || ![T.HELLO, T.DATA, T.ACK].includes(p.type)) return
    if (p.type === T.HELLO && p.dst !== 255) return
    const hello = p.type === T.HELLO ? readIdentityHello(p.payload) : null
    const envelope = p.type !== T.HELLO ? readIdentityEnvelope(p.payload) : null
    if (!hello && !envelope) {
      // Old/manual stations reserve their observed alias. Automatic mode never
      // accepts their unbound DATA/ACK as a message to a selected UID.
      const text = bytesText(Uint8Array.from(p.payload))
      const validLegacy = p.type === T.HELLO ? p.payload.length <= 32 && text?.trim() : p.type === T.DATA ? p.payload.length >= 1 && p.payload.length <= 96 && text != null : p.payload.length === 6
      if (validLegacy) {
        this.observePeer({ ...p, peerName: p.type === T.HELLO ? text : undefined }, quality, now)
        this.resolveAddress(now); this.requestTopology(now)
      }
      return
    }
    const uid = hello?.identity || envelope.source
    if (this.ownIdentitySeen(p, uid, now)) return
    if (envelope && ((p.dst === 255) !== (envelope.destination === BROADCAST_IDENTITY) || !(validId(p.dst) || p.dst === 255))) return
    if (p.type === T.DATA && (!envelope.payload.length || envelope.payload.length > 96 || bytesText(Uint8Array.from(envelope.payload)) == null)) return
    if (p.type === T.ACK && (envelope.payload.length !== 6 || envelope.destination === BROADCAST_IDENTITY)) return
    const { peer } = this.observePeer({ ...p, sourceIdentity: uid, peerName: hello?.name }, quality, now)
    this.resolveAddress(now)
    if (hello) { this.stats.rx++; this.log(`Anuncio recibido: ${hello.name} · ID ${p.sender}.`, now); this.requestTopology(now); return }
    if (this.joinState !== 'ready' || this.stopped || (envelope.destination !== this.identity && envelope.destination !== BROADCAST_IDENTITY)) return
    if (p.type === T.ACK) {
      this.stats.rx++
      const b = envelope.payload; const id = `${this.identity}:${word(b[1], b[2])}:${word(b[3], b[4])}`
      const m = this.messages.find(v => v.id === id)
      if (m && m.destinationIdentity === uid && b[0] === m.packet.origin && m.attempts > 0 && b[5] < m.attempts && now <= m.expires && m.status !== 'interrupted') {
        const first = m.status !== 'confirmed'; m.status = 'confirmed'; m.confirmedAt ??= now; peer.confirmedAt = now
        this.queue = this.queue.filter(e => `${e.packet.sourceIdentity}:${e.packet.epoch}:${e.packet.seq}` !== m.id)
        if (first) { this.stats.acks++; this.log(`Acuse recibido de ${peer.name}.`, now) }
      }
      return
    }
    // A temporary short-ID collision is resolved before processing DATA. It
    // never falls through to the legacy "another station is me" branch.
    if (p.sender === this.config.id) return
    this.ackIdentity = uid
    try { super.receive({ ...p, sourceIdentity: uid, payload: envelope.payload,
      dst: p.dst === 255 ? 255 : this.config.id, next: p.dst === 255 ? 255 : this.config.id }, quality, now) }
    finally { this.ackIdentity = null }
  }
  send(text, destination, now, priority = 1) {
    if (this.joinState !== 'ready') throw new Error('Espera a que termine la incorporación automática.')
    const broadcast = String(destination) === '255'
    const peer = this.peers.get(destination); const binding = this.topology.bindings.get(destination)
    if (!broadcast && (!validIdentity(destination) || !peer || now - peer.lastHeard >= TOPOLOGY.lifetime || !binding || binding.id === this.config.id)) throw new Error('Elige una estación directa con identidad conocida y sin conflicto de ID.')
    this.sendingIdentity = broadcast ? BROADCAST_IDENTITY : destination
    try {
      const m = super.send(text, broadcast ? 255 : binding.id, now, priority)
      m.destinationIdentity = this.sendingIdentity; m.destinationName = broadcast ? 'Grupo' : peer.name
      return m
    } finally { this.sendingIdentity = null }
  }
  take(now, idleFor = Infinity, receiving = false) {
    this.time = now
    if (this.stopped || ['idle', 'full', 'failed'].includes(this.joinState)) return null
    if (this.joinState !== 'ready' && now >= this.joinExpires) { this.noAddress(now, 'failed'); return null }
    if (this.joinState === 'listening' && now >= this.joinDue && idleFor >= 0.6 && !receiving) {
      const occupied = this.topology.occupied(now, this.peers)
      if (occupied.has(this.config.id)) {
        const id = chooseStationId(occupied, this.random)
        if (id == null) { this.noAddress(now); return null }
        this.adoptId(id, now)
      }
      this.joinState = 'claiming'; this.joinDue = Infinity; this.announce(now)
    } else if (this.joinState === 'settling' && now >= this.joinDue) {
      if (this.claimAttempts < 2) { this.joinState = 'claiming'; this.joinDue = Infinity; this.announce(now) }
      else {
        this.joinState = 'ready'; this.joinDue = Infinity; this.log(`Incorporación completada con ID ${this.config.id}.`, now)
        if (this.mapAfterJoin) { this.mapAfterJoin = false; this.requestTopology(now) }
      }
    }
    if (this.joinState === 'listening') return null
    for (const entry of this.queue) if (entry.packet.type === T.DATA && entry.packet.destinationIdentity !== BROADCAST_IDENTITY) {
      const binding = this.topology.bindings.get(entry.packet.destinationIdentity)
      if (binding) { entry.packet = { ...entry.packet, dst: binding.id, next: binding.id }; const m = this.messages.find(v => v.packet.seq === entry.packet.seq); if (m) m.dst = binding.id }
    }
    return super.take(now, idleFor, receiving)
  }
  finish(entry, now, success = true) {
    const current = this.transmitting === entry
    super.finish(entry, now, success)
    if (current && entry.packet.type === T.HELLO && this.joinState === 'claiming') {
      if (!success) { this.noAddress(now, 'failed'); return }
      this.claimAttempts++; this.joinState = 'settling'; this.joinDue = now + Math.max(4, this.config.releaseMs / 1000 + 2) + this.random() * 3
    }
  }
  stop(now) { this.joinDue = Infinity; if (this.joinState !== 'ready') this.joinState = 'idle'; super.stop(now) }
  snapshot(now = this.time) { return { ...super.snapshot(now), joinState: this.joinState, identityConflict: this.identityConflict, renumbers: this.renumbers } }
}
