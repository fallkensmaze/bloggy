// Assertions for src/utils/aprsParser.js
//
// Packets are the APRS101 examples where the spec gives one, so the expected
// numbers can be checked against the document instead of trusted. Unit
// conversions are pinned numerically: a parser that leaves knots as km/h or
// °F as °C still prints a plausible number, and nobody notices.

import assert from 'node:assert/strict'
import { distanceKm, formatCoordinate, maidenhead, parseAprs, symbolName } from '../src/utils/aprsParser.js'

let passed = 0
const test = (name, fn) => { fn(); passed += 1; }
const near = (actual, expected, tol, label) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    `${label}: expected ${expected} ± ${tol}, got ${actual}`)
}
const parse = (info, destination = 'APRS', source = 'N0CALL') => parseAprs({ source, destination, path: ['WIDE1-1'], info })

const LAT_4903 = 49 + 3.5 / 60; // 49.0583333
const LON_07201 = -(72 + 1.75 / 60); // -72.0291667

test('uncompressed position without timestamp', () => {
  const r = parse('!4903.50N/07201.75W-Test 001234')
  assert.equal(r.type, 'position')
  assert.equal(r.error, undefined)
  near(r.position.lat, LAT_4903, 1e-7, 'lat')
  near(r.position.lon, LON_07201, 1e-7, 'lon')
  assert.equal(r.position.ambiguity, undefined)
  assert.deepEqual(r.symbol, { table: '/', code: '-' })
  assert.equal(r.comment, 'Test 001234')
  assert.equal(r.messaging, false)
  assert.equal(r.raw, '!4903.50N/07201.75W-Test 001234')
})

test('messaging flag and empty comment', () => {
  const r = parse('=4903.50N/07201.75W-')
  assert.equal(r.messaging, true)
  assert.equal(r.comment, undefined)
})

test('timestamp, course and speed (knots to km/h)', () => {
  const r = parse('@092345z4903.50N/07201.75W>088/036')
  assert.equal(r.type, 'position')
  assert.equal(r.messaging, true)
  assert.deepEqual(r.timestamp, { format: 'zulu', day: 9, hour: 23, minute: 45 })
  assert.equal(r.course, 88)
  near(r.speed, 36 * 1.852, 1e-9, 'speed')
  assert.equal(symbolName(r.symbol.table, r.symbol.code), 'Coche')
})

test('local DHM and HMS timestamps', () => {
  assert.deepEqual(parse('/092345/4903.50N/07201.75W>').timestamp, { format: 'local', day: 9, hour: 23, minute: 45 })
  const r = parse('/234517h4903.50N/07201.75W>')
  assert.deepEqual(r.timestamp, { format: 'hms', hour: 23, minute: 45, second: 17 })
  assert.equal(r.messaging, false)
})

test('altitude extracted from comment (feet to m)', () => {
  const r = parse('!4903.50N/07201.75W-Test /A=001234 end')
  near(r.altitude, 1234 * 0.3048, 1e-9, 'altitude')
  assert.equal(r.comment, 'Test  end')
})

test('position ambiguity uses the centre of the box and applies to longitude', () => {
  const r = parse('!4903.  N/07201.75W-')
  assert.equal(r.position.ambiguity, 2)
  near(r.position.lat, 49 + 3.5 / 60, 1e-9, 'lat'); // 03' box → 03.5'
  near(r.position.lon, -(72 + 1.5 / 60), 1e-9, 'lon'); // 01.75 truncated to 01' → 01.5'
  const one = parse('!4903.5 N/07201.7 W-')
  assert.equal(one.position.ambiguity, 1)
  near(one.position.lat, 49 + 3.55 / 60, 1e-9, 'lat amb 1')
})

test('overlay table character', () => {
  const r = parse('!4903.50N\\07201.75W#')
  assert.deepEqual(r.symbol, { table: '\\', code: '#' })
  assert.deepEqual(parse('!4903.50ND07201.75W#').symbol, { table: 'D', code: '#', overlay: 'D' })
})

test('out-of-range coordinates set error without throwing', () => {
  for (const info of ['!9903.50N/07201.75W-', '!4960.00N/07201.75W-', '!4903.50N/18101.75W-', '!4903.50N/07201.75X-']) {
    const r = parse(info)
    assert.ok(r.error, `${info} should be an error`)
    assert.equal(r.type, 'position')
    assert.equal(r.position, undefined)
  }
})

test('compressed position (APRS101 ch. 9 example)', () => {
  const r = parse('!/5L!!<*e7>7P[')
  assert.equal(r.error, undefined)
  near(r.position.lat, 49.5, 1e-9, 'lat')
  near(r.position.lon, -72.75, 1e-5, 'lon'); // base-91 resolution, spec rounds
  assert.deepEqual(r.symbol, { table: '/', code: '>' })
  // c='7' → (55-33)*4 = 88°, s='P' → 1.08^47 - 1 = 36.2 knots
  assert.equal(r.course, 88)
  near(r.speed, (1.08 ** 47 - 1) * 1.852, 1e-9, 'speed')
  near(r.speed / 1.852, 36.2, 0.05, 'speed knots')
})

test('compressed altitude and range', () => {
  // T='1' → 16 = 0b00010000: NMEA source bits = 10 (GGA), so cs='S]' is altitude.
  // cs = 50*91 + 60 = 4610 → 1.002^4610 ≈ 10004 ft.
  const alt = parse('!/5L!!<*e7>S]1')
  near(alt.altitude / 0.3048, 10004, 1, 'altitude ft')
  assert.equal(alt.course, undefined)
  // c='{', s='?' → 2 * 1.08^30 ≈ 20.1 miles
  const rng = parse('!/5L!!<*e7>{?!')
  near(rng.range / 1.609344, 20.125, 0.01, 'range miles')
  // a-j table chars are numeric overlays
  assert.deepEqual(parse('=a5L!!<*e7# sT').symbol, { table: '0', code: '#', overlay: '0' })
})

// Mic-E, APRS101 ch. 10 example. Destination S32U6T:
//   S → digit 3, message bit A = 1 (standard)
//   3 → digit 3, B = 0;  2 → digit 2, C = 0          → A,B,C = 100 → M3 Returning
//   U → digit 5, North;  6 → digit 6, offset 0;  T → digit 4, West
//   latitude = 33° 25.64' N = 33.4273333
// Info `(_fn"Oj/ (each byte minus 28):
//   '(' 40 → 12°;  '_' 95 → 67 ≥ 60 → 7';  'f' 102 → 74 hundredths
//   with S32U6T (offset +0) longitude = 12° 07.74' W = -12.129
//   with S32UVT ('V' = digit 6 with offset +100) longitude = 112° 07.74' W = -112.129
//   (the spec shows the destination and info examples separately; '(' is its
//   112° example, which only holds with the +100 offset)
//   'n' 110 → SP 82, '"' 34 → DC 6, 'O' 79 → SE 51
//   speed = 82*10 + floor(6/10) = 820 → -800 = 20 knots
//   course = (6 % 10)*100 + 51 = 651 → -400 = 251°
//   symbol 'j' (jeep) from the primary table '/'
test('Mic-E spec example', () => {
  const r = parse('`(_fn"Oj/', 'S32UVT-2')
  assert.equal(r.type, 'mic-e')
  assert.equal(r.error, undefined)
  near(r.position.lat, 33 + 25.64 / 60, 1e-9, 'lat')
  near(r.position.lon, -(112 + 7.74 / 60), 1e-9, 'lon')
  const noOffset = parse('`(_fn"Oj/', 'S32U6T')
  near(noOffset.position.lat, 33 + 25.64 / 60, 1e-9, 'lat')
  near(noOffset.position.lon, -(12 + 7.74 / 60), 1e-9, 'lon without offset')
  assert.deepEqual(noOffset.micE, r.micE)
  near(r.speed, 20 * 1.852, 1e-9, 'speed')
  assert.equal(r.course, 251)
  assert.deepEqual(r.symbol, { table: '/', code: 'j' })
  assert.deepEqual(r.micE, { messageCode: 'M3', messageType: 'Returning', custom: false })
})

test('Mic-E altitude, Yaesu prefix/suffix and ambiguity', () => {
  // '"4T}' → (1*91 + 19)*91 + 51 = 10061 → 10061 - 10000 = 61 m
  const r = parse('`(_fn"Oj/`"4T}Hello_%', 'S32U6T')
  assert.equal(r.altitude, 61)
  assert.equal(r.comment, 'Hello')
  // Kenwood D700: ']' prefix and '=' suffix
  assert.equal(parse('`(_fn"Oj/]Mobile=', 'S32U6T').comment, 'Mobile')
  // Z as last digit: hundredths ambiguous → 25.6' box centre 25.65', same on longitude
  const amb = parse('`(_fn"Oj/', 'S32UVZ')
  assert.equal(amb.position.ambiguity, 1)
  near(amb.position.lat, 33 + 25.65 / 60, 1e-9, 'lat')
  near(amb.position.lon, -(112 + 7.75 / 60), 1e-9, 'lon')
})

test('Mic-E message bits', () => {
  assert.equal(parse('`(_fn"Oj/', '332U6T').micE.messageType, 'Emergency')
  assert.deepEqual(parse('`(_fn"Oj/', 'PQRU6T').micE, { messageCode: 'M0', messageType: 'Off Duty', custom: false })
  assert.deepEqual(parse('`(_fn"Oj/', 'D32U6T').micE, { messageCode: 'C3', messageType: 'Custom-3', custom: true })
  assert.equal(parse('`(_fn"Oj/', 'DQ2U6T').micE.messageType, 'Unknown')
  const bad = parse('`(_fn"Oj/', 'APRS')
  assert.equal(bad.type, 'mic-e')
  assert.ok(bad.error)
})

test('messages, acks, rejects, bulletins, reply-ack', () => {
  const m = parse(':WU2Z     :Testing{003').message
  assert.deepEqual(m, { addressee: 'WU2Z', text: 'Testing', id: '003' })
  assert.deepEqual(parse(':KB2ICI-14:ack003').message, { addressee: 'KB2ICI-14', ack: '003' })
  assert.deepEqual(parse(':KB2ICI-14:rej003').message, { addressee: 'KB2ICI-14', rej: '003' })
  assert.deepEqual(parse(':BLN3     :Snow expected in Tampa RSN').message,
    { addressee: 'BLN3', bulletin: true, text: 'Snow expected in Tampa RSN' })
  assert.deepEqual(parse(':EA4ABC   :Hola{MM}AA').message, { addressee: 'EA4ABC', text: 'Hola', id: 'MM', replyAck: 'AA' })
  assert.equal(parse(':EA4ABC   :Sin id').message.text, 'Sin id')
  const bad = parse(':SHORT:text')
  assert.equal(bad.type, 'message')
  assert.ok(bad.error)
})

test('status with and without timestamp', () => {
  const r = parse('>092345zNet Control Center')
  assert.equal(r.type, 'status')
  assert.equal(r.status, 'Net Control Center')
  assert.equal(r.timestamp.day, 9)
  assert.equal(parse('>Hola').status, 'Hola')
})

test('objects, uncompressed and compressed, alive and killed', () => {
  const r = parse(';LEADER   *092345z4903.50N/07201.75W>088/036')
  assert.equal(r.type, 'object')
  assert.deepEqual(r.object, { name: 'LEADER', alive: true })
  near(r.position.lat, LAT_4903, 1e-7, 'lat')
  assert.equal(r.course, 88)
  near(r.speed, 36 * 1.852, 1e-9, 'speed')
  const c = parse(';LEADER   _092345z/5L!!<*e7>7P[')
  assert.equal(c.object.alive, false)
  near(c.position.lon, -72.75, 1e-5, 'lon')
})

test('items', () => {
  const r = parse(')AID #2!4903.50N/07201.75WA')
  assert.equal(r.type, 'item')
  assert.deepEqual(r.item, { name: 'AID #2', alive: true })
  near(r.position.lon, LON_07201, 1e-7, 'lon')
  assert.equal(parse(')G/WB4APR_4903.50N/07201.75WA').item.alive, false)
})

test('positionless weather (metric output)', () => {
  const r = parse('_10090556c220s004g005t077r000p000P000h50b09900wRSW')
  assert.equal(r.type, 'weather')
  assert.deepEqual(r.timestamp, { format: 'mdhm', month: 10, day: 9, hour: 5, minute: 56 })
  const w = r.weather
  assert.equal(w.windDirection, 220)
  near(w.windSpeed, 4 * 1.609344, 1e-9, 'wind')
  near(w.windGust, 5 * 1.609344, 1e-9, 'gust')
  near(w.temperature, 25, 1e-9, 'temp')
  assert.equal(w.rain1h, 0)
  assert.equal(w.rain24h, 0)
  assert.equal(w.rainSinceMidnight, 0)
  assert.equal(w.humidity, 50)
  near(w.pressure, 990, 1e-9, 'pressure')
  assert.equal(w.software, 'w')
  assert.equal(w.unit, 'RSW')
})

test('missing weather fields are absent, not zero', () => {
  const w = parse('_10090556c...s   g005t-05r010h00b.....').weather
  assert.equal('windDirection' in w, false)
  assert.equal('windSpeed' in w, false)
  assert.equal('pressure' in w, false)
  near(w.temperature, (-5 - 32) * 5 / 9, 1e-9, 'temp')
  near(w.rain1h, 2.54, 1e-9, 'rain')
  assert.equal(w.humidity, 100)
})

test('position with weather', () => {
  const r = parse('!4903.50N/07201.75W_220/004g005t077r001p000P000h50b09900wRSW')
  assert.equal(r.type, 'weather')
  near(r.position.lat, LAT_4903, 1e-7, 'lat')
  assert.equal(r.course, undefined)
  assert.equal(r.weather.windDirection, 220)
  near(r.weather.windSpeed, 4 * 1.609344, 1e-9, 'wind')
  near(r.weather.rain1h, 0.254, 1e-9, 'rain')
  near(r.weather.pressure, 990, 1e-9, 'pressure')
  assert.equal(r.comment, 'wRSW')
  assert.equal(symbolName('/', '_'), 'Estación meteorológica')
})

test('telemetry', () => {
  const r = parse('T#005,199,000,255,073,123,01101001')
  assert.equal(r.type, 'telemetry')
  assert.deepEqual(r.telemetry, { sequence: '005', analog: [199, 0, 255, 73, 123], digital: '01101001' })
})

test('third party recursion', () => {
  const r = parse('}KB2ZE-1>APRS,TCPIP,WIDE:!4903.50N/07201.75W-Test')
  assert.equal(r.type, 'third-party')
  assert.equal(r.thirdParty.source, 'KB2ZE-1')
  assert.equal(r.thirdParty.destination, 'APRS')
  assert.deepEqual(r.thirdParty.path, ['TCPIP', 'WIDE'])
  assert.equal(r.thirdParty.packet.type, 'position')
  near(r.thirdParty.packet.position.lat, LAT_4903, 1e-7, 'inner lat')
  // Mic-E inside uses the inner destination
  const m = parse('}EA4ABC>S32U6T,TCPIP*:`(_fn"Oj/')
  assert.equal(m.thirdParty.packet.type, 'mic-e')
  assert.equal(m.thirdParty.packet.course, 251)
  assert.ok(parse('}garbage').error)
  let deep = parse('}A>B:}C>D:}E>F:}G>H:}I>J:>x')
  while (deep.thirdParty) deep = deep.thirdParty.packet
  assert.equal(deep.type, 'third-party')
  assert.ok(deep.error, 'depth limit reported on the innermost packet')
})

test('capabilities and unknown', () => {
  const r = parse('<IGATE,MSG_CNT=43,LOC_CNT=14')
  assert.equal(r.type, 'capabilities')
  assert.deepEqual(r.capabilities, { IGATE: true, MSG_CNT: '43', LOC_CNT: '14' })
  const u = parse('$GPRMC,whatever')
  assert.equal(u.type, 'unknown')
  assert.equal(u.raw, '$GPRMC,whatever')
  // '!' position up to 40 chars into the field
  const late = parse('TNC BEACON !4903.50N/07201.75W-')
  assert.equal(late.type, 'position')
})

test('garbage never throws', () => {
  assert.equal(parseAprs().type, 'unknown')
  assert.ok(parseAprs({ info: 42 }).error)
  assert.ok(parse('').error)
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)
  const prefixes = ['!', '=', '/', '@', '`', "'", '\x1c', ':', '>', ';', ')', '_', 'T#', '}', '<', '', '!/', ';ABC      *']
  for (let i = 0; i < 20000; i++) {
    const len = Math.floor(rnd() * 60)
    let s = prefixes[i % prefixes.length]
    for (let j = 0; j < len; j++) s += String.fromCharCode(Math.floor(rnd() * 256))
    const dest = Array.from({ length: 6 }, () => String.fromCharCode(48 + Math.floor(rnd() * 43))).join('')
    const r = parseAprs({ source: 'X', destination: dest, info: s })
    assert.equal(typeof r.type, 'string')
    assert.equal(r.raw, s)
    if (r.position) {
      assert.ok(Math.abs(r.position.lat) <= 90 && Math.abs(r.position.lon) <= 180)
    }
    assert.ok(!r.error?.startsWith('Error interno'), `internal error for ${JSON.stringify(s)}: ${r.error}`)
  }
})

test('helpers', () => {
  assert.equal(formatCoordinate(40.4168, -3.7038), '40.4168° N, 3.7038° W')
  assert.equal(formatCoordinate(-33.8688, 151.2093, 2), '33.87° S, 151.21° E')
  assert.equal(formatCoordinate(91, 0), null)
  assert.equal(maidenhead(40.4168, -3.7038), 'IN80dk')
  assert.equal(maidenhead(41.714775, -72.72726), 'FN31pr')
  assert.equal(maidenhead(90, 180), 'RR99xx')
  near(distanceKm({ lat: 40.4168, lon: -3.7038 }, { lat: 41.3874, lon: 2.1686 }), 505, 5, 'Madrid–Barcelona')
  assert.equal(distanceKm({ lat: 10, lon: 10 }, { lat: 10, lon: 10 }), 0)
  assert.equal(symbolName('\\', '&'), 'iGate')
  assert.equal(symbolName('/', '#'), 'Digipeater')
  assert.equal(symbolName('/', '[') , 'Persona')
  assert.equal(symbolName('/', '~'), null)
})

console.log(`APRS parser: ${passed} test groups passed`)
