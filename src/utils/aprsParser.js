// APRS information-field parser (APRS101 + APRS 1.1/1.2 addenda).
// Pure and dependency-free. It receives the already decoded AX.25 pieces and
// never throws: malformed input yields a result with `error` set.

const KNOT_KMH = 1.852
const MPH_KMH = 1.609344
const FT_M = 0.3048
const IN_MM = 25.4
const MAX_THIRD_PARTY_DEPTH = 4

class AprsError extends Error {}
const fail = (msg) => { throw new AprsError(msg); }

const base91 = (s) => {
  let v = 0
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 33
    if (c < 0 || c > 90) return NaN
    v = v * 91 + c
  }
  return v
}

// Minutes from "MMhh" digits (spaces allowed); the last `amb` digits are
// discarded and the centre of the resulting ambiguity box is returned.
const AMBIGUITY_BOX_MIN = [0, 0.1, 1, 10, 60]
function ambiguousMinutes(mmhh, amb) {
  const digits = (mmhh.slice(0, 4 - amb) + '0'.repeat(amb)).replace(/ /g, '0')
  const value = Number(digits.slice(0, 2)) + Number(digits.slice(2)) / 100
  return value + AMBIGUITY_BOX_MIN[amb] / 2
}

function parseLat(s) {
  const m = /^(\d{2})([\d ]{2})\.([\d ]{2})([NS])$/i.exec(s)
  if (!m) fail('Latitud no válida')
  const mmhh = m[2] + m[3]
  const amb = mmhh.length - mmhh.trimEnd().length
  if (mmhh.trimEnd().includes(' ')) fail('Ambigüedad de posición no válida')
  if (Number(m[2].replace(/ /g, '0')) >= 60) fail('Minutos de latitud fuera de rango')
  const lat = (Number(m[1]) + ambiguousMinutes(mmhh, amb) / 60) * (/s/i.test(m[4]) ? -1 : 1)
  if (Math.abs(lat) > 90) fail('Latitud fuera de rango')
  return { lat, amb }
}

// Longitude ambiguity follows the latitude (APRS101 ch. 6).
function parseLon(s, amb) {
  const m = /^(\d{3})([\d ]{2})\.([\d ]{2})([EW])$/i.exec(s)
  if (!m) fail('Longitud no válida')
  if (Number(m[2].replace(/ /g, '0')) >= 60) fail('Minutos de longitud fuera de rango')
  const lon = (Number(m[1]) + ambiguousMinutes(m[2] + m[3], amb) / 60) * (/w/i.test(m[4]) ? -1 : 1)
  if (Math.abs(lon) > 180) fail('Longitud fuera de rango')
  return lon
}

function makePosition(lat, lon, amb = 0) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    fail('Coordenadas fuera de rango')
  }
  return amb ? { lat, lon, ambiguity: amb } : { lat, lon }
}

function makeSymbol(table, code) {
  const symbol = { table, code }
  if (table !== '/' && table !== '\\') symbol.overlay = table
  return symbol
}

function parseTimestamp(s) {
  const m = /^(\d{2})(\d{2})(\d{2})([zh/])$/.exec(s || '')
  if (!m) fail('Marca de tiempo no válida')
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (m[4] === 'h') {
    if (a > 23 || b > 59 || c > 59) fail('Marca de tiempo fuera de rango')
    return { format: 'hms', hour: a, minute: b, second: c }
  }
  if (a < 1 || a > 31 || b > 23 || c > 59) fail('Marca de tiempo fuera de rango')
  return { format: m[4] === 'z' ? 'zulu' : 'local', day: a, hour: b, minute: c }
}

// Parses an uncompressed or compressed position at the start of `s` and
// fills r.position/r.symbol (and cs data). Returns the remaining text and
// whether it was compressed.
function parsePositionBlock(r, s) {
  if (/^\d/.test(s)) {
    if (s.length < 19) fail('Posición truncada')
    const { lat, amb } = parseLat(s.slice(0, 8))
    const lon = parseLon(s.slice(9, 18), amb)
    const table = s[8]
    if (!/[/\\0-9A-Z]/.test(table)) fail('Tabla de símbolos no válida')
    r.position = makePosition(lat, lon, amb)
    r.symbol = makeSymbol(table, s[18])
    return { rest: s.slice(19), compressed: false }
  }
  if (s.length < 13) fail('Posición comprimida truncada')
  let table = s[0]
  if (!/[/\\A-Za-j]/.test(table)) fail('Formato de posición no reconocido')
  if (/[a-j]/.test(table)) table = String(table.charCodeAt(0) - 97)
  const y = base91(s.slice(1, 5))
  const x = base91(s.slice(5, 9))
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail('Posición comprimida no válida')
  r.position = makePosition(90 - y / 380926, -180 + x / 190463)
  r.symbol = makeSymbol(table, s[9])
  const [c, sp, t] = [s.charCodeAt(10) - 33, s.charCodeAt(11) - 33, s.charCodeAt(12) - 33]
  if (s[10] !== ' ' && c >= 0 && c <= 90 && sp >= 0 && sp <= 90) {
    if (t >= 0 && ((t >> 3) & 3) === 2) {
      r.altitude = 1.002 ** (c * 91 + sp) * FT_M; // GGA source: cs is altitude
    } else if (c <= 89) {
      if (c > 0) r.course = c * 4
      r.speed = (1.08 ** sp - 1) * KNOT_KMH
    } else if (s[10] === '{') {
      r.range = 2 * 1.08 ** sp * MPH_KMH; // miles → km
    }
  }
  return { rest: s.slice(13), compressed: true }
}

const WX_FIELDS = { c: 3, s: 3, g: 3, t: 3, r: 3, p: 3, P: 3, h: 2, b: 5, L: 3, l: 3, '#': 3 }

// Consumes weather fields from the start of `s`; returns the leftover text.
function parseWeatherFields(s, wx, windSeen = false) {
  let i = 0
  while (i < s.length) {
    const key = s[i]
    const width = WX_FIELDS[key]
    if (!width) break
    const raw = s.slice(i + 1, i + 1 + width)
    if (raw.length < width) break
    const missing = /^[. ]+$/.test(raw)
    if (!missing && !/^-?\d+$/.test(raw)) break
    i += 1 + width
    if (key === 's') {
      if (!windSeen) { windSeen = true; if (!missing) wx.windSpeed = Number(raw) * MPH_KMH; }
      else if (!missing) wx.snow = Number(raw) * IN_MM / 10; // inches → cm
      continue
    }
    if (missing) continue
    const v = Number(raw)
    switch (key) {
      case 'c': wx.windDirection = v; break
      case 'g': wx.windGust = v * MPH_KMH; break
      case 't': wx.temperature = (v - 32) * 5 / 9; break
      case 'r': wx.rain1h = v * IN_MM / 100; break
      case 'p': wx.rain24h = v * IN_MM / 100; break
      case 'P': wx.rainSinceMidnight = v * IN_MM / 100; break
      case 'h': wx.humidity = v === 0 ? 100 : v; break
      case 'b': wx.pressure = v / 10; break
      case 'L': wx.luminosity = v; break
      case 'l': wx.luminosity = v + 1000; break
      case '#': wx.rainRaw = v; break
    }
  }
  return s.slice(i)
}

function extractAltitude(r, text) {
  const m = /\/A=(-\d{5}|\d{6})/.exec(text)
  if (!m) return text
  r.altitude = Number(m[1]) * FT_M
  return text.slice(0, m.index) + text.slice(m.index + m[0].length)
}

function setComment(r, text) {
  const comment = text.trim()
  if (comment) r.comment = comment
}

// Data extensions, altitude, weather and comment after a position block.
function finishPosition(r, rest, compressed) {
  const isWx = r.symbol?.code === '_'
  let wx = null
  if (isWx) {
    wx = {}
    if (r.course !== undefined) wx.windDirection = r.course
    if (r.speed !== undefined) wx.windSpeed = r.speed
    delete r.course
    delete r.speed
  }
  if (!compressed) {
    const ext = /^(\d{3}|\.{3}| {3})\/(\d{3}|\.{3}| {3})/.exec(rest)
    if (ext) {
      rest = rest.slice(7)
      const cse = /^\d+$/.test(ext[1]) ? Number(ext[1]) : null
      const spd = /^\d+$/.test(ext[2]) ? Number(ext[2]) : null
      if (isWx) {
        if (cse !== null) wx.windDirection = cse
        if (spd !== null) wx.windSpeed = spd * MPH_KMH
      } else {
        if (cse !== null && cse > 0 && cse <= 360) r.course = cse
        if (spd !== null) r.speed = spd * KNOT_KMH
        const df = /^\/(\d{3})\/(\d{3})/.exec(rest)
        if (df) { r.df = { bearing: Number(df[1]), nrq: df[2] }; rest = rest.slice(8); }
      }
    }
  }
  if (isWx) {
    rest = parseWeatherFields(rest, wx, wx.windSpeed !== undefined)
    r.type = 'weather'
    r.weather = wx
  }
  setComment(r, extractAltitude(r, rest))
}

function parsePositionPacket(r, info) {
  r.type = 'position'
  const dti = info[0]
  r.messaging = dti === '=' || dti === '@'
  let body = info.slice(1)
  if (dti === '/' || dti === '@') {
    r.timestamp = parseTimestamp(body.slice(0, 7))
    body = body.slice(7)
  }
  const { rest, compressed } = parsePositionBlock(r, body)
  finishPosition(r, rest, compressed)
}

const MICE_STANDARD = ['Off Duty', 'En Route', 'In Service', 'Returning', 'Committed', 'Special', 'Priority']

function parseMicE(r, destination, info) {
  r.type = 'mic-e'
  const dest = String(destination || '').toUpperCase().replace(/\*$/, '').replace(/-\d+$/, '')
  if (!/^[0-9A-LP-Z]{3}[0-9LP-Z]{3}$/.test(dest)) fail('Destino Mic-E no válido')
  if (info.length < 9) fail('Mic-E truncado')

  const digits = [...dest].map((ch) => {
    if (/[0-9]/.test(ch)) return ch
    if (/[A-J]/.test(ch)) return String(ch.charCodeAt(0) - 65)
    if (/[P-Y]/.test(ch)) return String(ch.charCodeAt(0) - 80)
    return ' '; // K, L, Z
  }).join('')
  const north = dest[3] >= 'P'
  const { lat, amb } = parseLat(`${digits.slice(0, 4)}.${digits.slice(4)}${north ? 'N' : 'S'}`)

  const bits = [...dest.slice(0, 3)].map((ch) => (/[A-K]/.test(ch) ? 'c' : /[P-Z]/.test(ch) ? 's' : '0'))
  const abc = bits.reduce((n, b) => n * 2 + (b === '0' ? 0 : 1), 0)
  const index = 7 - abc
  if (abc === 0) r.micE = { messageCode: 'M7', messageType: 'Emergency', custom: false }
  else if (bits.includes('c') && bits.includes('s')) r.micE = { messageCode: null, messageType: 'Unknown', custom: false }
  else if (bits.includes('c')) r.micE = { messageCode: `C${index}`, messageType: `Custom-${index}`, custom: true }
  else r.micE = { messageCode: `M${index}`, messageType: MICE_STANDARD[index], custom: false }

  const b = (i) => info.charCodeAt(i) - 28
  let deg = b(1) + (dest[4] >= 'P' ? 100 : 0)
  if (deg >= 180 && deg <= 189) deg -= 80
  else if (deg >= 190 && deg <= 199) deg -= 190
  let min = b(2)
  if (min >= 60) min -= 60
  const hun = b(3)
  if (deg < 0 || deg > 179 || min < 0 || min > 59 || hun < 0 || hun > 99) fail('Longitud Mic-E no válida')
  const mmhh = String(min).padStart(2, '0') + String(hun).padStart(2, '0')
  const lon = (deg + ambiguousMinutes(mmhh, amb) / 60) * (dest[5] >= 'P' ? -1 : 1)
  r.position = makePosition(lat, lon, amb)

  const sp = b(4), dc = b(5), se = b(6)
  if (sp >= 0 && dc >= 0 && se >= 0) {
    let speed = sp * 10 + Math.floor(dc / 10)
    if (speed >= 800) speed -= 800
    let course = (dc % 10) * 100 + se
    if (course >= 400) course -= 400
    r.speed = speed * KNOT_KMH
    if (course > 0 && course <= 360) r.course = course
  }
  const table = info[8]
  if (!/[/\\0-9A-Z]/.test(table)) fail('Tabla de símbolos Mic-E no válida')
  r.symbol = makeSymbol(table, info[7])

  let rest = info.slice(9)
  const prefix = /^[>\]`']/.test(rest) ? rest[0] : ''
  if (prefix) rest = rest.slice(1)
  const alt = /^([!-{]{3})\}/.exec(rest)
  if (alt) {
    r.altitude = base91(alt[1]) - 10000
    rest = rest.slice(4)
  }
  // Radio/tracker identification suffixes (Kenwood '=' '^', Yaesu '_x', Byonics '|3'...)
  if ((prefix === '>' || prefix === ']') && /[=^&]$/.test(rest)) rest = rest.slice(0, -1)
  else if ((prefix === '`' || prefix === "'") && /[_|^:~\\/*][!-~]$/.test(rest)) rest = rest.slice(0, -2)
  setComment(r, rest)
}

function parseMessage(r, info) {
  r.type = 'message'
  const m = /^:(.{9}):([\s\S]*)$/.exec(info)
  if (!m) fail('Mensaje mal formado')
  const addressee = m[1].trim()
  const text = m[2]
  const msg = { addressee }
  if (/^BLN/i.test(addressee)) msg.bulletin = true
  const ackRej = /^(ack|rej)([A-Za-z0-9]{1,5})(?:\}[A-Za-z0-9]{0,5})?\s*$/.exec(text)
  if (ackRej) {
    msg[ackRej[1]] = ackRej[2]
  } else {
    const withId = /^([\s\S]*?)\{([A-Za-z0-9]{1,5})(?:\}([A-Za-z0-9]{0,5}))?\s*$/.exec(text)
    if (withId) {
      msg.text = withId[1]
      msg.id = withId[2]
      if (withId[3]) msg.replyAck = withId[3]
    } else {
      msg.text = text
    }
    const tdef = /^(PARM|UNIT|EQNS|BITS)\./.exec(msg.text)
    if (tdef) msg.telemetryDefinition = tdef[1]
  }
  r.message = msg
}

function parseStatus(r, info) {
  r.type = 'status'
  let text = info.slice(1)
  if (/^\d{6}z/.test(text)) {
    r.timestamp = parseTimestamp(text.slice(0, 7))
    text = text.slice(7)
  }
  r.status = text
}

function parseObject(r, info) {
  r.type = 'object'
  const m = /^;(.{9})([*_])/.exec(info)
  if (!m) fail('Objeto mal formado')
  r.object = { name: m[1].trim(), alive: m[2] === '*' }
  r.timestamp = parseTimestamp(info.slice(11, 18))
  const { rest, compressed } = parsePositionBlock(r, info.slice(18))
  finishPosition(r, rest, compressed)
  if (r.weather) r.type = 'object'
}

function parseItem(r, info) {
  r.type = 'item'
  const m = /^\)([^!_]{3,9})([!_])/.exec(info)
  if (!m) fail('Ítem mal formado')
  r.item = { name: m[1].trim(), alive: m[2] === '!' }
  const { rest, compressed } = parsePositionBlock(r, info.slice(m[0].length))
  finishPosition(r, rest, compressed)
  if (r.weather) r.type = 'item'
}

function parsePositionlessWeather(r, info) {
  r.type = 'weather'
  const m = /^_(\d{2})(\d{2})(\d{2})(\d{2})/.exec(info)
  if (!m) fail('Marca de tiempo meteorológica no válida')
  const [month, day, hour, minute] = m.slice(1).map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) fail('Marca de tiempo fuera de rango')
  r.timestamp = { format: 'mdhm', month, day, hour, minute }
  const wx = {}
  const rest = parseWeatherFields(info.slice(9), wx).trim()
  const sw = /^(\S)(\S{2,4})$/.exec(rest)
  if (sw) { wx.software = sw[1]; wx.unit = sw[2]; }
  else if (rest) r.comment = rest
  r.weather = wx
}

function parseTelemetry(r, info) {
  r.type = 'telemetry'
  const m = /^T#([^,]*),([\s\S]*)$/.exec(info)
  if (!m) fail('Telemetría mal formada')
  const parts = m[2].split(',')
  const analog = parts.slice(0, 5).map((p) => (p.trim() === '' ? null : Number(p)))
  if (analog.some((v) => v !== null && !Number.isFinite(v))) fail('Valor analógico no válido')
  const telemetry = { sequence: m[1].trim(), analog }
  const dig = /^([01]{8})([\s\S]*)$/.exec(parts.slice(5).join(','))
  if (dig) {
    telemetry.digital = dig[1]
    setComment(r, dig[2])
  }
  r.telemetry = telemetry
}

function parseThirdParty(r, info, depth) {
  r.type = 'third-party'
  if (depth >= MAX_THIRD_PARTY_DEPTH) fail('Demasiados niveles de terceros')
  const body = info.slice(1)
  const colon = body.indexOf(':')
  const header = colon > 0 ? /^([^>,:]+)>([^,:]+)(?:,([^:]*))?$/.exec(body.slice(0, colon)) : null
  if (!header) fail('Cabecera de terceros mal formada')
  const [source, destination] = [header[1], header[2]]
  const path = header[3] ? header[3].split(',').filter(Boolean) : []
  r.thirdParty = {
    source,
    destination,
    path,
    packet: parseInner({ source, destination, path, info: body.slice(colon + 1) }, depth + 1),
  }
}

function parseCapabilities(r, info) {
  r.type = 'capabilities'
  const caps = {}
  for (const token of info.slice(1).split(',')) {
    const t = token.trim()
    if (!t) continue
    const eq = t.indexOf('=')
    if (eq > 0) caps[t.slice(0, eq)] = t.slice(eq + 1)
    else caps[t] = true
  }
  r.capabilities = caps
}

function parseInner({ destination, info }, depth) {
  const r = { type: 'unknown', raw: info }
  try {
    if (typeof info !== 'string') {
      if (info instanceof Uint8Array) r.raw = info = String.fromCharCode(...info)
      else { r.raw = ''; fail('Campo de información ausente'); }
    }
    if (!info.length) fail('Campo de información vacío')
    const dti = info[0]
    switch (dti) {
      case '!': case '=': case '/': case '@': parsePositionPacket(r, info); break
      case '`': case "'": case '\x1c': case '\x1d': parseMicE(r, destination, info); break
      case ':': parseMessage(r, info); break
      case '>': parseStatus(r, info); break
      case ';': parseObject(r, info); break
      case ')': parseItem(r, info); break
      case '_': parsePositionlessWeather(r, info); break
      case 'T': if (info.startsWith('T#')) parseTelemetry(r, info); break
      case '}': parseThirdParty(r, info, depth); break
      case '<': parseCapabilities(r, info); break
    }
    if (r.type === 'unknown') {
      // APRS101: a '!' position may appear up to 40 characters into the field.
      const idx = info.indexOf('!')
      if (idx > 0 && idx <= 40) {
        const probe = { type: 'unknown', raw: info }
        try {
          parsePositionPacket(probe, info.slice(idx))
          return probe
        } catch { /* stays unknown */ }
      }
    }
  } catch (err) {
    r.error = err instanceof AprsError ? err.message : `Error interno: ${err?.message ?? err}`
  }
  return r
}

export function parseAprs({ source, destination, path = [], info } = {}) {
  return parseInner({ source, destination, path, info }, 0)
}

const PRIMARY_SYMBOLS = {
  '!': 'Policía', '#': 'Digipeater', '$': 'Teléfono', '%': 'Clúster DX', '&': 'Pasarela HF',
  "'": 'Avioneta', '(': 'Satélite móvil', '+': 'Cruz Roja', '-': 'Casa', ';': 'Acampada',
  '<': 'Moto', '=': 'Tren', '>': 'Coche', '?': 'Servidor', 'I': 'Nodo TCP/IP',
  'K': 'Escuela', 'O': 'Globo', 'R': 'Autocaravana', 'U': 'Autobús', 'X': 'Helicóptero',
  'Y': 'Velero', '[': 'Persona', '^': 'Avión', '_': 'Estación meteorológica',
  '`': 'Antena parabólica', 'a': 'Ambulancia', 'b': 'Bicicleta', 'f': 'Bomberos',
  'h': 'Hospital', 'j': 'Jeep', 'k': 'Camión', 'l': 'Portátil', 'n': 'Nodo',
  'r': 'Repetidor', 's': 'Barco', 'u': 'Camión pesado', 'v': 'Furgoneta', 'y': 'Casa con Yagi',
}
const ALTERNATE_SYMBOLS = {
  '!': 'Emergencia', '#': 'Digipeater', '&': 'iGate', '-': 'Casa (HF)', '>': 'Coche',
  '^': 'Avión', '_': 'Estación meteorológica', 'a': 'ARES/RACES', 'k': 'Todoterreno',
  'n': 'Triángulo', 's': 'Barco', 'u': 'Camión', 'v': 'Furgoneta',
}

export function symbolName(table, code) {
  const dict = table === '/' ? PRIMARY_SYMBOLS : ALTERNATE_SYMBOLS
  return dict[code] ?? null
}

export function formatCoordinate(lat, lon, digits = 4) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(digits)}° ${lon < 0 ? 'W' : 'E'}`
}

export function maidenhead(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const x = Math.min(lon + 180, 359.999999)
  const y = Math.min(lat + 90, 179.999999)
  const A = 65, a = 97
  return String.fromCharCode(A + Math.floor(x / 20), A + Math.floor(y / 10))
    + Math.floor((x % 20) / 2) + Math.floor(y % 10)
    + String.fromCharCode(a + Math.floor((x % 2) * 12), a + Math.floor((y % 1) * 24))
}

export function distanceKm(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)))
}
