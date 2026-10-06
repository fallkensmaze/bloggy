import { FRAME_TYPES as T, SAMPLE_RATE, bytesText, decodeFrame, demodulate, encodeFrame,
  mixReceiverAudio, modulate, receivedDb, seededRandom, textBytes } from './emergencyRadioAudio.js'

export const RADIO_DEFAULTS = Object.freeze({ seed: 42, baud: 600, noiseDb: 0, senseDb: 4,
  squelchDb: 4, helloInterval: 20, topologyInterval: 60, strategy: 'mpr', carrierSense: true,
  automatic: true, ttl: 12, messageLifetime: 180, maxAttempts: 3 })
export const TYPE_LABELS = { 1: 'HELLO', 2: 'TOPOLOGÍA', 3: 'MENSAJE', 4: 'ACUSE', 5: 'PRUEBA' }
export const PRIORITIES = ['Socorro', 'Urgente', 'Rutina']
export const STATUS_LABELS = { waiting: 'Esperando ruta', queued: 'En cola', sent: 'Esperando acuse',
  confirmed: 'Recepción confirmada', unconfirmed: 'Sin confirmación', expired: 'Caducado' }

const keyOf = p => `${p.origin}:${p.epoch}:${p.seq}`
const frameKey = p => `${p.type}:${keyOf(p)}:${p.attempt || 0}`
const overlaps = (a, b) => a.start < b.end - 1e-8 && b.start < a.end - 1e-8
const sorted = iterable => [...iterable].sort((a, b) => a - b)

export function createScenario(name = 'neighborhood', count = 25, seed = 42) {
  const rng = seededRandom(seed)
  if (name === 'hidden') return [
    { id: 0, x: 160, y: 260, label: 'A', joinAt: 0 },
    { id: 1, x: 400, y: 260, label: 'B', joinAt: 0 },
    { id: 2, x: 640, y: 260, label: 'C', joinAt: 0 },
  ]
  if (name === 'bridge') return [[70, 180], [155, 340], [230, 230], [490, 230], [750, 230], [815, 340], [890, 180]]
    .map(([x, y], id) => ({ id, x, y, label: id === 3 ? 'Enlace' : `N${id + 1}`, joinAt: id * 1.1 }))
  count = Math.min(40, Math.max(3, count))
  const columns = Math.min(7, Math.ceil(Math.sqrt(count * 1.7)))
  const rowSpacing = Math.min(140, 490 / Math.max(1, Math.ceil(count / columns) - 1))
  return Array.from({ length: count }, (_, id) => ({ id, label: `N${String(id + 1).padStart(2, '0')}`,
    x: 60 + (id % columns) * 140 + rng() * 22, y: 65 + Math.floor(id / columns) * rowSpacing + rng() * 22,
    joinAt: id * 1.3 }))
}

export function selectMpr(neighbors, selfId, previous = new Set()) {
  const direct = new Set(neighbors.map(n => n.id))
  const coverage = new Map(neighbors.map(n => [n.id, new Set((n.report || [])
    .filter(r => r.symmetric && r.id !== selfId && !direct.has(r.id)).map(r => r.id))]))
  const uncovered = new Set([...coverage.values()].flatMap(v => [...v]))
  const selected = new Set()
  const include = id => { selected.add(id); for (const v of coverage.get(id)) uncovered.delete(v) }
  for (const target of [...uncovered]) {
    const choices = [...coverage].filter(([, set]) => set.has(target)).map(([id]) => id)
    if (choices.length === 1) include(choices[0])
  }
  while (uncovered.size) {
    const candidates = [...coverage].filter(([id]) => !selected.has(id)).map(([id, set]) => ({ id,
      gain: [...set].filter(v => uncovered.has(v)).length, degree: set.size, stable: previous.has(id) ? 1 : 0 }))
      .sort((a, b) => b.gain - a.gain || b.stable - a.stable || b.degree - a.degree || a.id - b.id)
    if (!candidates[0]?.gain) break
    include(candidates[0].id)
  }
  return selected
}

// Protocol state contains only received reports. Coordinates and RF truth are
// deliberately absent from this function (and from MPR selection).
export function computeRoutes(selfId, neighbors, topology) {
  const graph = new Map([[selfId, new Set(neighbors.map(n => n.id))]])
  const direct = new Set(neighbors.map(n => n.id))
  const add = (a, b) => {
    if (a === b || (a === selfId && !direct.has(b)) || (b === selfId && !direct.has(a))) return
    if (!graph.has(a)) graph.set(a, new Set())
    if (!graph.has(b)) graph.set(b, new Set())
    graph.get(a).add(b); graph.get(b).add(a)
  }
  for (const n of neighbors) {
    add(selfId, n.id)
    for (const r of n.report || []) if (r.symmetric) add(n.id, r.id)
  }
  for (const [id, tc] of topology) for (const other of tc.neighbors) add(id, other)
  const queue = [selfId]; const routes = new Map(); const visited = new Set(queue)
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]
    for (const id of sorted(graph.get(current) || [])) if (!visited.has(id)) {
      visited.add(id); queue.push(id)
      const before = routes.get(current)
      routes.set(id, { next: current === selfId ? id : before.next,
        hops: current === selfId ? 1 : before.hops + 1,
        path: [...(before?.path || [selfId]), id] })
    }
  }
  return { routes, graph }
}

export class EmergencyRadioSimulation {
  constructor(nodes = createScenario(), config = {}) {
    this.config = { ...RADIO_DEFAULTS, ...config }
    this.random = seededRandom(this.config.seed)
    this.time = 0; this.events = []; this.eventSequence = 0; this.txSequence = 0
    this.history = []; this.receptions = []; this.logs = []; this.messages = []; this.losses = new Map()
    this.stats = { transmissions: 0, valid: 0, corrupt: 0, halfDuplex: 0, suppressed: 0, busy: 0, discarded: 0 }
    this.nodes = nodes.map(n => ({ ...n, powerDb: n.powerDb || 0, online: false, epoch: 0, seq: 0,
      neighbors: new Map(), topology: new Map(), mpr: new Set(), routes: new Map(), graph: new Map(),
      queue: [], seen: new Map(), forwarded: new Map(), inbox: new Map(), pending: new Map(), txUntil: 0,
      helloDue: Infinity, tcDue: Infinity, fingerprint: '', topologyFingerprint: '', lastHello: -Infinity,
      lastTc: -Infinity, advertised: false, tickScheduled: false }))
    for (const node of this.nodes) this.schedule(node.joinAt || 0, 'join', () => { if (!node.epoch) this.setOnline(node.id, true) })
  }
  node(id) { return this.nodes.find(n => n.id === Number(id)) }
  label(id) { return this.node(id)?.label || `N${id}` }
  schedule(at, kind, run) {
    this.events.push({ at, kind, run, seq: this.eventSequence++ })
    this.events.sort((a, b) => a.at - b.at || Number(b.kind === 'end') - Number(a.kind === 'end') || a.seq - b.seq)
  }
  advance(seconds) {
    const until = this.time + Math.max(0, seconds)
    let processed = 0
    while (this.events.length && this.events[0].at <= until && processed++ < 100000) {
      const event = this.events.shift(); this.time = event.at; event.run()
    }
    this.time = until
    this.history = this.history.filter(tx => tx.end > this.time - 120)
    this.receptions = this.receptions.slice(-500); this.logs = this.logs.slice(-250)
    return this
  }
  log(text, kind = 'info', node = null) { this.logs.push({ time: this.time, text, kind, node }); if (this.logs.length > 300) this.logs.shift() }
  setOnline(id, online) {
    const n = this.node(id)
    if (!n || n.online === online) return
    n.online = online
    if (!online) {
      n.queue = []
      for (const tx of this.history) if (tx.sender === id && tx.end > this.time) { tx.end = this.time; tx.aborted = true }
      for (const m of n.pending.values()) if (!['confirmed', 'expired'].includes(m.status)) m.status = 'unconfirmed'
      this.log(`${n.label} se apaga. Los demás lo descubrirán por sus mensajes o por caducidad.`, 'change', id)
      return
    }
    n.epoch++; n.seq = 0; n.txUntil = this.time
    n.neighbors.clear(); n.topology.clear(); n.mpr.clear(); n.routes.clear(); n.graph.clear()
    n.seen.clear(); n.forwarded.clear(); n.pending.clear(); n.fingerprint = ''; n.topologyFingerprint = ''
    n.lastHello = -Infinity; n.lastTc = -Infinity; n.advertised = false
    n.helloDue = this.time + this.random() * 5; n.tcDue = this.time + 10 + this.random() * 8
    this.log(`${n.label} entra y comienza a escuchar.`, 'change', id)
    if (!n.tickScheduled) { n.tickScheduled = true; this.schedule(this.time + 0.1, 'tick', () => this.tick(n)) }
  }
  move(id, x, y) { const n = this.node(id); if (n) { n.x = x; n.y = y } }
  linkDb(a, b) { return receivedDb(a, b, this.losses.get(`${a.id}:${b.id}`) || 0) }
  symmetricNeighbors(n) {
    const hold = 3 * this.config.helloInterval + 5
    return [...n.neighbors.values()].filter(v => this.time - v.heardAt <= hold && this.time - v.helloAt <= hold && v.report.some(r => r.id === n.id))
  }
  refresh(n) {
    const hold = 3 * this.config.helloInterval + 5
    for (const [id, v] of n.neighbors) if (this.time - v.heardAt > hold) n.neighbors.delete(id)
    for (const [id, v] of n.topology) if (this.time - v.receivedAt > 3 * this.config.topologyInterval) n.topology.delete(id)
    for (const map of [n.seen, n.forwarded]) for (const [k, at] of map) if (this.time - at > 300) map.delete(k)
    const neighbors = this.symmetricNeighbors(n)
    const previous = sorted(n.mpr).join(',')
    n.mpr = selectMpr(neighbors, n.id, n.mpr)
    const fingerprint = `${neighbors.map(v => v.id).sort((a, b) => a - b)}|${sorted(n.mpr)}`
    if (fingerprint !== n.fingerprint) {
      n.fingerprint = fingerprint
      n.helloDue = Math.min(n.helloDue, Math.max(n.lastHello + 5, this.time + 2 + this.random() * 5))
      if (previous !== sorted(n.mpr).join(',')) this.log(`${n.label} selecciona enlaces: ${sorted(n.mpr).map(id => this.label(id)).join(', ') || 'ninguno necesario'}.`, 'mpr', n.id)
    }
    const selectedByNeighbor = neighbors.some(v => v.report.some(r => r.id === n.id && r.mpr))
    const topologyFingerprint = `${neighbors.map(v => v.id).sort((a, b) => a - b)}|${selectedByNeighbor}`
    if (topologyFingerprint !== n.topologyFingerprint) {
      n.topologyFingerprint = topologyFingerprint
      n.tcDue = Math.min(n.tcDue, Math.max(n.lastTc + 15, this.time + 5 + this.random() * 6))
    }
    Object.assign(n, computeRoutes(n.id, neighbors, n.topology))
  }
  packet(n, type, payload = [], extra = {}) {
    n.seq = (n.seq + 1) & 0xffff
    return { type, net: 7, origin: n.id, sender: n.id, epoch: n.epoch, seq: n.seq,
      ttl: this.config.ttl, priority: type === T.TOPOLOGY ? 3 : 2, dst: 255, next: 255, attempt: 0, payload, ...extra }
  }
  hello(n) {
    const sym = new Set(this.symmetricNeighbors(n).map(v => v.id))
    const payload = [...n.neighbors.values()].flatMap(v => [v.id, (sym.has(v.id) ? 1 : 0) | (n.mpr.has(v.id) ? 2 : 0)])
    this.enqueue(n, this.packet(n, T.HELLO, payload, { ttl: 1 }), { replaceType: T.HELLO })
  }
  tick(n) {
    n.tickScheduled = false
    if (!n.online) return
    this.refresh(n)
    if (this.config.automatic) {
      if (this.time >= n.helloDue) { this.hello(n); n.lastHello = this.time; n.helloDue = this.time + this.config.helloInterval * (0.8 + 0.4 * this.random()) }
      if (this.time >= n.tcDue) {
        const neighbors = this.symmetricNeighbors(n)
        const relay = neighbors.some(v => v.report.some(r => r.id === n.id && r.mpr))
        // Leaves are represented in the announcements of their neighboring
        // relays. Avoid a global flood originating at every leaf.
        if (relay || n.advertised) {
          this.enqueue(n, this.packet(n, T.TOPOLOGY, relay ? neighbors.map(v => v.id) : []), { replaceType: T.TOPOLOGY })
          n.lastTc = this.time; n.advertised = relay
        }
        n.tcDue = this.time + this.config.topologyInterval * (0.8 + 0.4 * this.random())
      }
    }
    for (const m of n.pending.values()) {
      if (['confirmed', 'expired', 'unconfirmed'].includes(m.status)) continue
      if (this.time >= m.expires) { m.status = 'expired'; continue }
      if (this.time < m.due) continue
      if (m.attempts >= this.config.maxAttempts) { m.status = 'unconfirmed'; this.log(`${n.label}: ${m.id} queda sin confirmación.`, 'loss', n.id); continue }
      const route = n.routes.get(m.dst)
      if (!route) { m.status = 'waiting'; m.due = this.time + 2; continue }
      m.status = 'queued'; m.due = Infinity
      this.enqueue(n, { ...m.packet, attempt: m.attempts, next: route.next }, { expires: m.expires })
    }
    n.tickScheduled = true; this.schedule(this.time + 1, 'tick', () => this.tick(n))
  }
  enqueue(n, packet, options = {}) {
    if (!n.online) return
    if (options.replaceType) n.queue = n.queue.filter(e => !(e.packet.type === options.replaceType && e.packet.origin === n.id))
    if (n.queue.length >= 48) { this.stats.discarded++; return }
    n.queue.push({ packet: { ...packet }, added: this.time, expires: options.expires ?? this.time + 60,
      ready: options.ready ?? this.time + 0.12 + this.random() * (packet.priority === 0 ? 0.2 : 0.65) })
    this.schedule(Math.max(this.time + 0.001, Math.min(...n.queue.map(e => e.ready))), 'try', () => this.tryTransmit(n))
  }
  tryTransmit(n) {
    if (!n.online || this.time < n.txUntil) return
    n.queue = n.queue.filter(e => e.expires > this.time)
    const entry = n.queue.filter(e => e.ready <= this.time + 1e-8)
      .sort((a, b) => a.packet.priority - b.packet.priority || a.added - b.added)[0]
    if (!entry) return
    if (this.config.carrierSense && this.channelBusy(n)) {
      this.stats.busy++; entry.ready = this.time + 0.15 + this.random() * 1.2
      this.schedule(entry.ready, 'try', () => this.tryTransmit(n)); return
    }
    const p = entry.packet
    if (p.type === T.DATA || p.type === T.ACK) {
      const route = n.routes.get(p.dst)
      if (!route) {
        entry.ready = this.time + 2
        this.schedule(entry.ready, 'try', () => this.tryTransmit(n)); return
      }
      p.next = route.next
    }
    n.queue.splice(n.queue.indexOf(entry), 1)
    this.startTransmission(n, p)
  }
  channelBusy(n) {
    let power = 0
    for (const tx of this.history) if (tx.start <= this.time && tx.end > this.time && tx.sender !== n.id) power += (tx.gains[n.id] || 0) ** 2
    return power > 10 ** ((this.config.noiseDb + this.config.senseDb) / 10)
  }
  startTransmission(n, packet) {
    const p = { ...packet, sender: n.id }
    const bytes = encodeFrame(p)
    const samples = modulate(bytes, this.config.baud, this.random() * Math.PI * 2)
    // Align all channel events to the audio sample grid.
    const start = Math.round(this.time * SAMPLE_RATE) / SAMPLE_RATE
    const gains = {}; const receivers = {}
    for (const other of this.nodes) if (other.online && other.id !== n.id) {
      gains[other.id] = 10 ** (this.linkDb(n, other) / 20); receivers[other.id] = other.epoch
    }
    const tx = { id: ++this.txSequence, sender: n.id, start, end: start + samples.length / SAMPLE_RATE,
      packet: p, bytes, samples, gains, receivers, baud: this.config.baud, noiseDb: this.config.noiseDb, outcomes: {} }
    n.txUntil = tx.end + 0.15; this.history.push(tx); this.stats.transmissions++
    const own = n.pending.get(keyOf(p))
    if (p.type === T.DATA && p.origin === n.id && own) {
      own.attempts++; own.status = 'sent'
      own.due = this.time + Math.max(25, 4 * (n.routes.get(p.dst)?.hops || 1) * (tx.end - tx.start + 0.8))
      own.path = n.routes.get(p.dst)?.path || []
    }
    this.schedule(tx.end, 'end', () => this.finishTransmission(tx))
    this.schedule(n.txUntil + 0.01, 'try', () => this.tryTransmit(n))
  }
  finishTransmission(tx) {
    if (tx.aborted) return
    for (const [idString, epoch] of Object.entries(tx.receivers)) {
      const id = Number(idString); const n = this.node(id)
      if (!n.online || n.epoch !== epoch) continue
      const snr = 20 * Math.log10(tx.gains[id]) - tx.noiseDb
      if (snr < this.config.squelchDb) continue
      const half = this.history.some(other => other.sender === id && overlaps(other, tx))
      const interfering = this.history.filter(other => other !== tx && other.sender !== id && overlaps(other, tx) && (other.gains[id] || 0) ** 2 > 10 ** ((tx.noiseDb - 6) / 10))
      let packet = null
      if (!half) {
        const samples = mixReceiverAudio(this.history, id, tx.start, tx.end - tx.start, tx.noiseDb, this.config.seed)
        packet = decodeFrame(demodulate(samples, tx.baud))
      }
      // A valid CRC is necessary, and the header must be the intended frame.
      const ok = !!packet && frameKey(packet) === frameKey(tx.packet) && packet.sender === tx.sender
      const reason = ok ? 'ok' : half ? 'half-duplex' : interfering.length ? 'overlap' : 'noise'
      tx.outcomes[id] = reason
      this.receptions.push({ time: this.time, start: tx.start, end: tx.end, sender: tx.sender, receiver: id,
        type: tx.packet.type, ok, reason, snr, txId: tx.id, interfering: interfering.map(t => t.sender) })
      if (ok) { this.stats.valid++; this.receive(n, packet) }
      else {
        this.stats[half ? 'halfDuplex' : 'corrupt']++
        if ([T.DATA, T.ACK, T.PROBE].includes(tx.packet.type)) this.log(`${n.label} pierde ${TYPE_LABELS[tx.packet.type]} de ${this.label(tx.sender)}: ${half ? 'estaba transmitiendo' : interfering.length ? 'solapamiento' : 'ruido'}.`, 'loss', id)
      }
    }
  }
  receive(n, p) {
    if (p.net !== 7 || p.sender === n.id || p.ttl === 0) return
    const neighbor = n.neighbors.get(p.sender) || { id: p.sender, helloAt: -Infinity, report: [] }
    neighbor.heardAt = this.time; n.neighbors.set(p.sender, neighbor)
    if (p.type === T.HELLO) {
      if (p.payload.length % 2) return
      neighbor.helloAt = this.time; neighbor.report = []
      for (let i = 0; i < p.payload.length; i += 2) neighbor.report.push({ id: p.payload[i], symmetric: !!(p.payload[i + 1] & 1), mpr: !!(p.payload[i + 1] & 2) })
      this.refresh(n); return
    }
    if (p.type === T.PROBE) { this.log(`${n.label} decodifica la prueba de ${this.label(p.sender)} (CRC válido).`, 'received', n.id); return }
    const key = frameKey(p)
    if (p.type === T.TOPOLOGY) {
      const old = n.topology.get(p.origin)
      if (p.origin !== n.id && (!old || p.epoch > old.epoch || (p.epoch === old.epoch && ((p.seq - old.seq + 65536) % 65536) < 32768 && p.seq !== old.seq))) {
        n.topology.set(p.origin, { neighbors: p.payload, epoch: p.epoch, seq: p.seq, receivedAt: this.time })
        this.refresh(n)
      }
      // Processing and retransmission duplicates are separate: a later copy
      // from a selector can still authorize forwarding.
      const selected = this.symmetricNeighbors(n).some(v => v.id === p.sender && v.report.some(r => r.id === n.id && r.mpr))
      if (p.origin !== n.id && p.ttl > 1 && !n.forwarded.has(key) && (this.config.strategy === 'flood' || selected)) {
        n.forwarded.set(key, this.time)
        this.enqueue(n, { ...p, ttl: p.ttl - 1 })
      } else this.stats.suppressed++
      return
    }
    if (p.next !== n.id) return
    if (p.dst === n.id && p.type === T.DATA) {
      const id = keyOf(p)
      const text = bytesText(Uint8Array.from(p.payload))
      if (text == null) return
      if (!n.inbox.has(id)) {
        n.inbox.set(id, { id, origin: p.origin, text, priority: p.priority, time: this.time })
        if (n.inbox.size > 100) n.inbox.delete(n.inbox.keys().next().value)
        this.log(`${n.label} recibe de ${this.label(p.origin)}: ${text}`, 'received', n.id)
      }
      // Re-ACK duplicate DATA: the first ACK may have been lost.
      this.enqueue(n, this.packet(n, T.ACK, [p.origin, p.epoch >> 8, p.epoch & 255, p.seq >> 8, p.seq & 255], { dst: p.origin, priority: 0 }))
      return
    }
    if (n.seen.has(key)) return
    n.seen.set(key, this.time)
    if (p.dst === n.id && p.type === T.ACK) {
      const b = p.payload
      if (b.length !== 5) return
      const own = n.pending.get(`${b[0]}:${b[1] << 8 | b[2]}:${b[3] << 8 | b[4]}`)
      if (own && own.dst === p.origin && this.time <= own.expires) {
        own.status = 'confirmed'; own.confirmedAt = this.time
        this.log(`${n.label} recibe el acuse de ${this.label(p.origin)}.`, 'confirmed', n.id)
      }
    } else if (p.ttl > 1) this.enqueue(n, { ...p, ttl: p.ttl - 1 })
  }
  sendMessage(origin, dst, text, priority = 1) {
    const n = this.node(origin)
    const payload = textBytes(text.trim())
    if (!n?.online) throw new Error('La estación de origen debe estar encendida.')
    if (Number(dst) === n.id || !this.node(dst)) throw new Error('Selecciona otra estación como destino.')
    if (!payload.length || payload.length > 96) throw new Error('El mensaje debe ocupar entre 1 y 96 bytes UTF-8.')
    const packet = this.packet(n, T.DATA, Array.from(payload), { dst: Number(dst), priority })
    const m = { id: keyOf(packet), origin: n.id, dst: Number(dst), text: text.trim(), priority, packet,
      createdAt: this.time, expires: this.time + this.config.messageLifetime, due: this.time, attempts: 0, status: 'waiting', path: [] }
    n.pending.set(m.id, m); this.messages.push(m)
    if (this.messages.length > 100) this.messages.shift()
    // Retain terminal states in the visible log, bound protocol storage too.
    if (n.pending.size > 100) for (const [id, old] of n.pending) if (['confirmed', 'expired', 'unconfirmed'].includes(old.status)) { n.pending.delete(id); break }
    return m
  }
  probe(senders = [0, 2], destination = 1, simultaneous = true) {
    senders.forEach((id, i) => {
      const n = this.node(id)
      if (!n?.online) return
      const payload = Array.from(textBytes(i ? 'CCCC 01010101 CCCC' : 'AAAA 10101010 AAAA'))
      const packet = this.packet(n, T.PROBE, payload, { dst: destination, next: destination, priority: 0 })
      const duration = encodeFrame(packet).length * 8 / this.config.baud
      this.enqueue(n, packet, { ready: this.time + 0.5 + (simultaneous ? 0 : i * (duration + 0.7)) })
    })
  }
  listenerAudio(id, duration = 8) {
    const end = this.time; const start = Math.max(0, end - duration)
    return { start, end, samples: mixReceiverAudio(this.history, Number(id), start, end - start, this.config.noiseDb, this.config.seed) }
  }
  snapshot() {
    return { version: 'EMERGENCY_RADIO_LAB_V1', scope: 'Simulación de canal equivalente de audio; reloj de símbolos ideal; no transmisión RF.',
      time: this.time, config: { ...this.config }, stats: { ...this.stats },
      nodes: this.nodes.map(n => ({ id: n.id, label: n.label, x: n.x, y: n.y, powerDb: n.powerDb, online: n.online,
        neighbors: this.symmetricNeighbors(n).map(v => v.id), mpr: sorted(n.mpr), routes: [...n.routes], inbox: [...n.inbox.values()] })),
      messages: this.messages.map(({ packet, ...m }) => m), receptions: this.receptions, logs: this.logs }
  }
}
