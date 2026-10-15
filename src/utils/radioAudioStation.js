import { FRAME_TYPES as T, textBytes, bytesText } from './emergencyRadioAudio.js'
import { AUDIO_MODEM_DEFAULTS } from './radioAudioModem.js'
import { AudioTopology, TOPOLOGY, readTopology, topologyPayload, ageTopology } from './radioAudioTopology.js'

export const STATION_STATUS = { queued: 'En cola', transmitting: 'Emitiendo', waitingAck: 'Esperando acuse', confirmed: 'Recepción confirmada',
  broadcast: 'Emitido sin acuse', unconfirmed: 'Sin confirmación', expired: 'Caducado', interrupted: 'Interrumpido' }
const key = p => `${p.sourceIdentity || p.origin}:${p.epoch}:${p.seq}`
const ackKey = b => `${b[0]}:${b[1] * 256 + b[2]}:${b[3] * 256 + b[4]}`
const rank = p => p.type === T.ACK ? -1 : p.type === T.DATA ? p.priority : p.type === T.HELLO ? 4 : 5

// DATA and ACK remain direct. The map contains only received observations.
// The transport calls receive() only after demodulation and a valid frame CRC.
export class AudioStationProtocol {
  constructor(options = {}, random = Math.random) {
    this.config = { ...AUDIO_MODEM_DEFAULTS, id: 1, network: 17, name: 'Estación', autoAck: true, shareTopology: true, epoch: 1, ...options }
    const { id, network, name } = this.config
    if (!Number.isInteger(id) || id < 1 || id > 254 || !Number.isInteger(network) || network < 1 || network > 254) throw new Error('Estación y grupo deben estar entre 1 y 254.')
    if (!name.trim() || textBytes(name).length > 32) throw new Error('El nombre admite hasta 32 bytes UTF-8.')
    this.random = random; this.seq = 0; this.queue = []; this.messages = []; this.inbox = []; this.peers = new Map(); this.seen = new Map()
    this.logs = []; this.transmitting = null; this.conflict = false; this.stats = { tx: 0, rx: 0, retries: 0, acks: 0 }
    this.topology = new AudioTopology(id); this.topologyDue = Infinity; this.topologyExpires = 0; this.nextTopologyAt = 0; this.nextControlAt = 0
    this.controlWasBusy = false; this.controlReadyAt = 0
    this.time = 0; this.stopped = false
  }
  log(text, now) { this.logs.push({ text, time: now }); if (this.logs.length > 100) this.logs.shift() }
  packet(type, payload, dst = 255, extra = {}) {
    this.seq = (this.seq + 1) & 65535
    return { type, net: this.config.network, origin: this.config.id, sender: this.config.id, epoch: this.config.epoch,
      seq: this.seq, dst, next: dst, ttl: 1, priority: 2, attempt: 0, payload: Array.from(payload), ...extra }
  }
  enqueue(packet, now, options = {}) {
    if (this.queue.length >= 24) throw new Error('La cola está llena; espera antes de añadir mensajes.')
    this.queue.push({ packet, ready: now + 0.2 + this.random() * 0.6, expires: now + 120, ...options })
  }
  announce(now) {
    if (this.conflict) throw new Error('Cambia el identificador duplicado antes de transmitir.')
    if (this.queue.some(e => e.packet.type === T.HELLO)) return
    this.enqueue(this.packet(T.HELLO, textBytes(this.config.name.trim())), now)
    this.requestTopology(now)
  }
  requestTopology(now) {
    if (!this.config.shareTopology || this.conflict || this.stopped || this.topologyDue !== Infinity || this.queue.some(e => e.ownTopology)) return
    this.topologyDue = Math.max(this.nextTopologyAt, now + this.config.releaseMs / 1000 + 2 + this.random() * 6)
    this.topologyExpires = now + 120
  }
  makeTopologyPayload(now) { return topologyPayload(this.config.name, this.peers, now) }
  canTransmitTopology() { return true }
  ackWaitSeconds() { return Math.max(10, (this.config.leadMs + this.config.tailMs + 2 * this.config.releaseMs) / 1000 + 46 * 8 / this.config.baud + 3) }
  observePeer(p, quality, now) {
    const peer = this.peers.get(p.sender) || { id: p.sender, name: `Estación ${p.sender}` }
    const newlyHeard = peer.lastHeard == null || now - peer.lastHeard >= TOPOLOGY.lifetime
    if (p.origin === p.sender && peer.epoch != null && peer.epoch !== p.epoch) {
      delete peer.confirmedAt; peer.name = `Estación ${p.sender}`; peer.named = false
    }
    if (p.origin === p.sender) peer.epoch = p.epoch
    peer.lastHeard = now; peer.quality = quality; this.peers.set(p.sender, peer)
    return { peer, newlyHeard }
  }
  receiveTopology(p, quality, now) {
    const report = readTopology(p)
    if (!report || p.sender === this.config.id) return
    this.stats.rx++
    const { peer, newlyHeard } = this.observePeer(p, quality, now)
    if (p.origin === p.sender) { peer.name = report.name; peer.named = true }
    if (newlyHeard) this.requestTopology(now)
    if (!this.topology.accept(p, report, now)) return
    this.log(`Mapa recibido: ID ${p.origin}${p.sender !== p.origin ? ` a través de ID ${p.sender}` : ''}.`, now)
    if (!this.config.shareTopology || p.ttl <= 1) return
    // Coalesce each origin, reserve queue space for messages and ACKs, and
    // never forward an already forwarded identity a second time.
    this.queue = this.queue.filter(e => e.packet.type !== T.TOPOLOGY || e.packet.origin !== p.origin)
    if (this.queue.length >= 20 || this.queue.filter(e => e.packet.type === T.TOPOLOGY).length >= TOPOLOGY.maxQueued) return
    this.enqueue({ ...p, sender: this.config.id, ttl: p.ttl - 1, payload: [...p.payload] }, now,
      { topologyAt: now, ready: now + this.config.releaseMs / 1000 + 2 + this.random() * 6, expires: Math.min(now + 60, now + TOPOLOGY.lifetime - report.age) })
  }
  send(text, destination, now, priority = 1) {
    if (this.conflict) throw new Error('Cambia el identificador duplicado antes de transmitir.')
    const payload = textBytes(text.trim()); const dst = Number(destination)
    if (!payload.length || payload.length > 96) throw new Error('Escribe un mensaje de entre 1 y 96 bytes UTF-8.')
    if (!Number.isInteger(dst) || dst < 1 || dst > 255 || dst === this.config.id) throw new Error('Elige otra estación o 255 para enviar al grupo.')
    const packet = this.packet(T.DATA, payload, dst, { priority })
    const m = { id: key(packet), packet, text: text.trim(), dst, priority, created: now, expires: now + 120, attempts: 0, due: Infinity, status: 'queued' }
    this.enqueue(packet, now, { expires: m.expires }); this.messages.push(m)
    if (this.messages.length > 100) this.messages.shift()
    return m
  }
  receive(p, quality, now) {
    this.time = now
    if (this.stopped || p.net !== this.config.network) return
    if (p.type === T.TOPOLOGY) {
      if (p.sender === this.config.id && p.origin === this.config.id && p.epoch !== this.config.epoch && readTopology(p)) {
        this.conflict = true; this.stop(now); this.log('Se ha oído otra estación con tu ID. Cambia el ID y vuelve a activar.', now)
      } else this.receiveTopology(p, quality, now)
      return
    }
    if (p.net !== this.config.network || p.sender !== p.origin || p.next !== p.dst || p.ttl !== 1 || ![T.HELLO, T.DATA, T.ACK].includes(p.type)) return
    if (p.sender < 1 || p.sender > 254) return
    if (p.sender === this.config.id) {
      if (p.epoch !== this.config.epoch) { this.conflict = true; this.stop(now); this.log('Se ha oído otra estación con tu ID. Cambia el ID y vuelve a activar.', now) }
      return
    }
    if (p.type === T.HELLO && (p.dst !== 255 || p.payload.length > 32 || !bytesText(Uint8Array.from(p.payload))?.trim())) return
    if (p.type === T.DATA && (p.payload.length < 1 || p.payload.length > 96 || bytesText(Uint8Array.from(p.payload)) === null)) return
    if (p.type === T.ACK && p.payload.length !== 6) return
    this.stats.rx++
    const { peer } = this.observePeer(p, quality, now)
    if (p.type === T.HELLO) {
      peer.name = bytesText(Uint8Array.from(p.payload)); peer.named = true
      this.log(`Anuncio recibido: ${peer.name} · ID ${p.sender}.`, now); this.requestTopology(now); return
    }
    if (p.dst !== this.config.id && p.dst !== 255) return
    if (p.type === T.DATA) {
      const id = key(p)
      if (!this.seen.has(id)) {
        this.inbox.push({ id, origin: p.origin, originIdentity: p.sourceIdentity, text: bytesText(Uint8Array.from(p.payload)), time: now, quality, broadcast: p.dst === 255 })
        if (this.inbox.length > 100) this.inbox.shift()
        this.seen.set(id, now); if (this.seen.size > 256) this.seen.delete(this.seen.keys().next().value)
        this.log(`Texto recibido de la estación ${p.origin}.`, now)
      }
      if (p.dst === this.config.id && this.config.autoAck && !this.conflict && !this.queue.some(e => e.ackFor === id) && this.transmitting?.ackFor !== id) {
        const ack = this.packet(T.ACK, [p.origin, p.epoch >> 8, p.epoch & 255, p.seq >> 8, p.seq & 255, p.attempt], p.origin, { priority: 0 })
        if (this.queue.length < 24) this.enqueue(ack, now, { ackFor: id, ready: now + this.config.releaseMs / 1000 + 0.2 + this.random() * 0.6 })
        else this.log('No se pudo poner el acuse en cola: cola llena.', now)
      }
      // Broadcasts deliberately receive no ACK, avoiding an ACK storm.
      return
    }
    if (p.type === T.ACK && p.dst === this.config.id) {
      const m = this.messages.find(v => v.id === ackKey(p.payload))
      if (m && m.dst === p.origin && m.attempts > 0 && p.payload[5] < m.attempts && now <= m.expires && m.status !== 'interrupted') {
        const first = m.status !== 'confirmed'; m.status = 'confirmed'; m.confirmedAt ??= now
        this.queue = this.queue.filter(e => key(e.packet) !== m.id)
        peer.confirmedAt = now
        if (first) { this.stats.acks++; this.log(`Acuse recibido de la estación ${p.origin}.`, now) }
      }
    }
  }
  take(now, idleFor = Infinity, receiving = false) {
    this.time = now
    if (this.transmitting || this.conflict || this.stopped) return null
    for (const m of this.messages) {
      if (['confirmed', 'broadcast', 'interrupted', 'expired', 'unconfirmed'].includes(m.status)) continue
      if (now >= m.expires) { m.status = 'expired'; continue }
      if (m.status === 'waitingAck' && now >= m.due) {
        if (m.attempts >= 3) { m.status = 'unconfirmed'; this.log(`Sin acuse de la estación ${m.dst} tras tres intentos.`, now); continue }
        if (this.queue.length >= 24) continue
        m.status = 'queued'
        this.enqueue({ ...m.packet, attempt: m.attempts }, now, { expires: m.expires, ready: now + 0.6 + this.random() * 1.6 })
      }
    }
    this.queue = this.queue.filter(e => e.expires > now)
    if (now >= this.topologyExpires) this.topologyDue = Infinity
    if (idleFor < 0.6 || receiving) { this.controlWasBusy = true; return null }
    if (this.controlWasBusy) {
      // Queued nodes must contend again after a busy period instead of all
      // transmitting together as soon as the same carrier becomes quiet.
      this.controlReadyAt = now + 0.3 + this.random() * 2; this.controlWasBusy = false
    }
    if (now >= this.topologyDue && this.queue.length < 20) {
      this.enqueue(this.packet(T.TOPOLOGY, [], 255, { ttl: TOPOLOGY.maxHops }), now,
        { ownTopology: true, topologyAt: now, ready: now, expires: now + 60 })
      this.topologyDue = Infinity
    }
    // Do not fill the return window while a locally sent DATA awaits its ACK.
    const waitingAck = this.messages.some(m => m.status === 'waitingAck')
    const entry = this.queue.filter(e => e.ready <= now && (e.packet.type !== T.TOPOLOGY || (this.canTransmitTopology() && !waitingAck && now >= this.nextControlAt && now >= this.controlReadyAt)))
      .sort((a, b) => rank(a.packet) - rank(b.packet) || a.ready - b.ready)[0]
    if (!entry) return null
    this.queue.splice(this.queue.indexOf(entry), 1)
    if (entry.packet.type === T.TOPOLOGY) {
      if (!entry.ownTopology && !this.topology.isLatest(entry.packet)) return null
      const payload = entry.ownTopology ? this.makeTopologyPayload(now) : entry.packet.payload
      const duration = (this.config.leadMs + this.config.tailMs) / 1000 + (40 + payload.length) * 8 / this.config.baud
      const aged = ageTopology(payload, (entry.ownTopology ? 0 : now - entry.topologyAt) + duration)
      if (!aged) return null
      entry.packet = { ...entry.packet, payload: aged }
      this.nextControlAt = now + duration + TOPOLOGY.relayInterval
      if (entry.ownTopology) this.nextTopologyAt = now + TOPOLOGY.ownInterval
    }
    this.transmitting = entry; this.stats.tx++
    const m = this.messages.find(v => v.id === key(entry.packet))
    if (entry.packet.type === T.DATA && m) { m.status = 'transmitting'; m.attempts++; if (m.attempts > 1) this.stats.retries++ }
    return entry
  }
  finish(entry, now, success = true) {
    if (this.transmitting !== entry) return
    this.transmitting = null
    const m = this.messages.find(v => v.id === key(entry.packet))
    if (!m || entry.packet.type !== T.DATA || ['confirmed', 'interrupted'].includes(m.status)) return
    if (!success) { m.status = 'interrupted'; return }
    m.status = m.dst === 255 ? 'broadcast' : 'waitingAck'
    m.due = now + this.ackWaitSeconds()
  }
  stop(now) {
    this.time = now; this.stopped = true; this.topologyDue = Infinity; this.queue = []; this.transmitting = null
    for (const m of this.messages) if (['queued', 'transmitting', 'waitingAck'].includes(m.status)) m.status = 'interrupted'
    this.log('Estación detenida; no quedan emisiones ni reintentos pendientes.', now)
  }
  setAutoAck(value) { this.config.autoAck = Boolean(value); if (!value) this.queue = this.queue.filter(e => e.packet.type !== T.ACK) }
  setShareTopology(value) {
    this.config.shareTopology = Boolean(value)
    if (!value) { this.topologyDue = Infinity; this.queue = this.queue.filter(e => e.packet.type !== T.TOPOLOGY) }
  }
  snapshot(now = this.time) {
    return { version: 'RADIO_AUDIO_STATION_V1', config: { ...this.config }, stats: { ...this.stats }, conflict: this.conflict,
      topology: this.topology.snapshot(this.peers, this.config.name, now),
      messages: this.messages.map(({ packet, ...m }) => ({ ...m })), inbox: this.inbox.map(v => ({ ...v })), peers: [...this.peers.values()].map(v => ({ ...v })), logs: [...this.logs] }
  }
}
