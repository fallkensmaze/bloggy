// Assertions for src/utils/aprsSigner.js (emisor APRS privado)
//
// Un emisor falla en silencio: si la firma difiere en un bit de la que calcula
// la pasarela de Apps Script, el mensaje sale por radio, aprs.fi lo muestra y la
// pasarela lo descarta como «firma inválida». Nada lanza una excepción. Por eso
// aquí hay tres anclas independientes de la implementación:
//   1. vectores calculados con el firmador original (firmador.html) que ya
//      coincidió con el script de Apps Script;
//   2. una réplica de Apps Script con node:crypto y bytes CON SIGNO (que es lo
//      que devuelve Utilities.computeHmacSha256Signature), para fijar el `& 255`;
//   3. la cadena completa firma → AX.25 → audio AFSK con ruido → demodulador →
//      parser → verificación, que exige recuperar el mensaje exacto.

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  ALFABETO_FIRMA, CONTADOR_MAX, MAX_TEXTO_APRS, TOCALL, VENTANA_CONTADOR,
  calcularFirma, construirMensaje, errorSecreto, errorTexto, infoMensajeAprs, limpiarTexto, normalizar,
  parseRuta, problemasConfig, tramaMensaje, verificarMensaje,
} from '../src/utils/aprsSigner.js'
import { decodeFrame, formatCall, tnc2 } from '../src/utils/ax25.js'
import { AfskDemodulator, afskModulate } from '../src/utils/aprsModem.js'
import { parseAprs } from '../src/utils/aprsParser.js'

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`  ok  ${name}`) }

const SECRETO = 'secreto-de-prueba'

// Réplica de calcularFirma_ de Apps Script: bytes con signo, `& 255`, mismo alfabeto.
function firmaAppsScript(secreto, letra, contador, texto) {
  const t = String(texto).trim().replace(/\s+/g, ' ').toUpperCase()
  const bytes = [...createHmac('sha256', secreto).update(`${contador}|${String(letra).toUpperCase()}|${t}`, 'utf8').digest()]
    .map(b => (b > 127 ? b - 256 : b)) // lo que ve Apps Script
  const n = (((bytes[0] & 255) << 24) | ((bytes[1] & 255) << 16) | ((bytes[2] & 255) << 8) | (bytes[3] & 255)) >>> 0
  let s = ''
  for (let i = 0; i < 6; i++) s += ALFABETO_FIRMA[(n >>> (27 - 5 * i)) & 31]
  return s
}

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647 }
function withNoise(audio, sampleRate, sigma, seed = 1) {
  const out = new Float32Array(audio.length + sampleRate)
  out.set(audio, Math.round(sampleRate * 0.4))
  const r = rng(seed)
  for (let i = 0; i < out.length; i++) out[i] += sigma * Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  return out
}
function demodulate(samples, sampleRate, chunk = 256) {
  const d = new AfskDemodulator(sampleRate)
  const frames = []
  for (let i = 0; i < samples.length; i += chunk) frames.push(...d.push(samples.subarray(i, i + chunk)))
  return [...frames, ...d.finish()]
}

console.log('Firma')
await test('vectores del firmador original', async () => {
  assert.equal(await calcularFirma(SECRETO, 'A', 1, 'TEST 73'), 'P3GJLF')
  assert.equal(await calcularFirma(SECRETO, 'a', 42, '  llego   tarde '), 'WX82JA')
  assert.equal(await calcularFirma('Kq3-_x9Zp0LmN8vB2cT7uYw4eRfGhJ1sDaQ5oIiX6yA', 'T', 999999, 'Estoy bien, llamame luego'), 'U5Z7VN')
  assert.equal(await calcularFirma('otro', 'C', 7, 'ABC def 123 .,:;!?-/()'), 'DW6785')
})
await test('coincide con la réplica de Apps Script en 300 combinaciones (bytes con signo)', async () => {
  const r = rng(7)
  const letras = 'ABCTZ'
  let altos = 0
  for (let i = 0; i < 300; i++) {
    const secreto = `s${Math.floor(r() * 1e9).toString(36)}-${i}`
    const letra = letras[Math.floor(r() * letras.length)]
    const contador = 1 + Math.floor(r() * CONTADOR_MAX)
    const texto = `msg ${Math.floor(r() * 1e6)}  x`
    const esperada = firmaAppsScript(secreto, letra, contador, texto)
    if (createHmac('sha256', secreto).update(normalizar(letra, contador, texto)).digest()[0] > 127) altos++
    assert.equal(await calcularFirma(secreto, letra, contador, texto), esperada, `${secreto} ${letra} ${contador}`)
  }
  assert.ok(altos > 50, 'la muestra debe incluir primeros bytes ≥ 128, donde falla un `& 255` omitido')
})
await test('mayúsculas y espacios no cambian la firma; cualquier otro cambio sí', async () => {
  const base = await calcularFirma(SECRETO, 'A', 5, 'llego tarde')
  assert.equal(await calcularFirma(SECRETO, 'a', 5, '  LLEGO    TARDE  '), base)
  for (const otra of [
    calcularFirma(SECRETO, 'B', 5, 'llego tarde'), calcularFirma(SECRETO, 'A', 6, 'llego tarde'),
    calcularFirma(SECRETO, 'A', 5, 'llego tard'), calcularFirma(SECRETO + 'x', 'A', 5, 'llego tarde'),
  ]) assert.notEqual(await otra, base)
})
await test('la firma usa solo el alfabeto sin I, O, 0 ni 1', async () => {
  for (let c = 1; c <= 200; c++) assert.match(await calcularFirma(SECRETO, 'A', c, 'x'), /^[A-HJ-NP-Z2-9]{6}$/)
})
await test('sin secreto o sin Web Crypto no firma en silencio', async () => {
  await assert.rejects(calcularFirma('', 'A', 1, 'x'), /secreto/i)
  await assert.rejects(calcularFirma(SECRETO, 'A', 1, 'x', null), /Web Crypto/)
})

console.log('Mensaje')
await test('construirMensaje da «letra contador firma texto» y recorta espacios', async () => {
  const m = await construirMensaje({ secreto: SECRETO, letra: 'a', contador: 1, texto: '  TEST   73 ' })
  assert.equal(m.linea, 'A 1 P3GJLF TEST 73')
  assert.deepEqual([m.letra, m.contador, m.firma, m.cuerpo], ['A', 1, 'P3GJLF', 'TEST 73'])
})
await test('el límite de 67 caracteres cuenta el prefijo y es exacto', async () => {
  const prefijo = 'A 12 XXXXXX '.length // 12
  const justo = 'x'.repeat(MAX_TEXTO_APRS - prefijo)
  const m = await construirMensaje({ secreto: SECRETO, letra: 'A', contador: 12, texto: justo })
  assert.equal(m.linea.length, MAX_TEXTO_APRS)
  await assert.rejects(construirMensaje({ secreto: SECRETO, letra: 'A', contador: 12, texto: justo + 'x' }), /67/)
})
await test('rechaza texto vacío, no ASCII, { | ~, letra y contador inválidos', async () => {
  const base = { secreto: SECRETO, letra: 'A', contador: 1, texto: 'ok' }
  await assert.rejects(construirMensaje({ ...base, texto: '   ' }), /texto/i)
  for (const t of ['mañana', 'adiós', 'hola 😀', 'a{b', 'a|b', 'a~b']) await assert.rejects(construirMensaje({ ...base, texto: t }), /ASCII|reservados/, t)
  for (const l of ['', 'AB', '1', 'ñ', undefined]) await assert.rejects(construirMensaje({ ...base, letra: l }), /letra/i)
  for (const c of [0, -1, 1.5, CONTADOR_MAX + 1, NaN, '3']) await assert.rejects(construirMensaje({ ...base, contador: c }), /contador/i)
  assert.equal(errorTexto('A-Z a-z 0-9 .,:;!?/()-'), null)
})
await test('errorSecreto acepta 16–200 caracteres (y el de Apps Script, de 43) y rechaza el resto', () => {
  assert.equal(errorSecreto('x'.repeat(16)), null); assert.equal(errorSecreto('x'.repeat(200)), null)
  assert.equal(errorSecreto('Kq3-_x9Zp0LmN8vB2cT7uYw4eRfGhJ1sDaQ5oIiX6yA'), null)
  assert.equal(errorSecreto('  ' + 'x'.repeat(16) + '  '), null, 'se recorta como al guardar')
  for (const mal of ['', '   ', 'x'.repeat(15), 'x'.repeat(201), null, undefined]) assert.match(errorSecreto(mal), /entre 16 y 200/, String(mal))
})
await test('limpiarTexto colapsa espacios y tolera null', () => {
  assert.equal(limpiarTexto('  a \t b\n c '), 'a b c'); assert.equal(limpiarTexto(null), '')
})

console.log('Verificación (réplica de autenticar_)')
await test('acepta lo firmado y rechaza repetición, salto excesivo, manipulación y formato', async () => {
  const m = await construirMensaje({ secreto: SECRETO, letra: 'A', contador: 8, texto: 'estoy bien' })
  assert.deepEqual(await verificarMensaje(m.linea, SECRETO, 7), { ok: true, letra: 'A', contador: 8, cuerpo: 'estoy bien' })
  assert.equal((await verificarMensaje(m.linea, SECRETO, 8)).error, 'CONTADOR')              // repetición
  assert.equal((await verificarMensaje(m.linea, SECRETO, 9)).error, 'CONTADOR')
  assert.equal((await verificarMensaje(m.linea, SECRETO, 8 - VENTANA_CONTADOR - 1)).error, 'CONTADOR') // demasiado adelantado
  assert.equal((await verificarMensaje(m.linea, SECRETO, 8 - VENTANA_CONTADOR)).ok, true)             // borde de la ventana
  assert.equal((await verificarMensaje(m.linea.replace('bien', 'mal'), SECRETO, 7)).error, 'FIRMA')  // texto cambiado
  assert.equal((await verificarMensaje(m.linea.replace('A 8', 'B 8'), SECRETO, 7)).error, 'FIRMA')   // otro destinatario
  assert.equal((await verificarMensaje(m.linea, 'otro-secreto', 7)).error, 'FIRMA')
  assert.equal((await verificarMensaje('TEST 73', SECRETO, 0)).error, 'FORMATO')
  assert.equal((await verificarMensaje(m.linea.toLowerCase(), SECRETO, 7)).ok, true)                  // la pasarela no distingue mayúsculas
})

console.log('Paquete APRS')
await test('el mensaje APRS rellena el destinatario a 9 y el parser lo recupera', () => {
  assert.equal(infoMensajeAprs('alerta', 'A 1 P3GJLF TEST 73'), ':ALERTA   :A 1 P3GJLF TEST 73')
  assert.equal(infoMensajeAprs('EA4ABC-15', 'x'), ':EA4ABC-15:x')
  for (const mal of ['', 'DIEZCARACT', 'a b', 'ñ']) assert.throws(() => infoMensajeAprs(mal, 'x'), /destinatario/i, mal)
  const p = parseAprs({ source: 'EA4XYZ-7', destination: TOCALL, path: [], info: infoMensajeAprs('ALERTA', 'A 1 P3GJLF TEST 73') })
  assert.deepEqual(p.message, { addressee: 'ALERTA', text: 'A 1 P3GJLF TEST 73' })
})
await test('validación de configuración', () => {
  assert.deepEqual(problemasConfig({ indicativo: 'EA4ABC-7', destinatario: 'ALERTA', ruta: 'WIDE1-1, WIDE2-1' }), [])
  assert.deepEqual(problemasConfig({ indicativo: 'EA4ABC', destinatario: 'a', ruta: '' }), [])
  assert.equal(problemasConfig({ indicativo: '', destinatario: 'ALERTA', ruta: '' }).length, 1)
  assert.equal(problemasConfig({ indicativo: 'EA4ABC-16', destinatario: 'ALERTA', ruta: '' }).length, 1)
  assert.equal(problemasConfig({ indicativo: 'EA4ABC', destinatario: 'DIEZCARACT', ruta: 'WIDE1-1,@@' }).length, 2)
  assert.deepEqual(parseRuta(' wide1-1 , WIDE2-1,, '), ['WIDE1-1', 'WIDE2-1'])
})

console.log('Cadena completa por audio')
for (const sampleRate of [48000, 44100]) {
  await test(`firma → AX.25 → AFSK ${sampleRate} Hz con ruido → decodificación → verificación`, async () => {
    const m = await construirMensaje({ secreto: SECRETO, letra: 'A', contador: 3, texto: 'llego tarde, cena sin mi' })
    const trama = tramaMensaje({ origen: 'EA4XYZ-7', destinatario: 'ALERTA', ruta: parseRuta('WIDE1-1,WIDE2-1'), linea: m.linea })
    assert.ok(trama.length < 128, 'una trama típica ocupa unos 100 bytes')
    const audio = afskModulate([trama], { sampleRate, amplitude: 0.4, preambleFlags: 60 })
    const frames = demodulate(withNoise(audio, sampleRate, 0.05), sampleRate)
    assert.equal(frames.length, 1, 'debe recuperar exactamente una trama')
    const f = decodeFrame(frames[0].bytes ?? frames[0])
    assert.ok(f, 'la trama recuperada debe tener FCS válido')
    assert.equal(tnc2(f), `EA4XYZ-7>${TOCALL},WIDE1-1,WIDE2-1:${':ALERTA   :' + m.linea}`)
    assert.equal(formatCall(f.source), 'EA4XYZ-7')
    const p = parseAprs({ source: formatCall(f.source), destination: formatCall(f.destination), path: f.path.map(formatCall), info: f.text })
    assert.equal(p.type, 'message'); assert.equal(p.message.addressee, 'ALERTA')
    // Lo que recogería aprs.fi pasa la verificación de la pasarela con el contador anterior
    const v = await verificarMensaje(p.message.text, SECRETO, 2)
    assert.deepEqual(v, { ok: true, letra: 'A', contador: 3, cuerpo: 'llego tarde, cena sin mi' })
  })
}
await test('el audio de un preámbulo más largo dura más y sigue decodificando', async () => {
  const m = await construirMensaje({ secreto: SECRETO, letra: 'B', contador: 1, texto: 'hola' })
  const trama = tramaMensaje({ origen: 'EA4XYZ', destinatario: 'ALERTA', ruta: [], linea: m.linea })
  const corto = afskModulate([trama], { sampleRate: 48000, preambleFlags: 20 })
  const largo = afskModulate([trama], { sampleRate: 48000, preambleFlags: 120 })
  assert.ok(largo.length > corto.length + 48000 * 0.5, '100 flags más son ≈ 0,67 s')
  assert.equal(demodulate(withNoise(largo, 48000, 0.02), 48000).length, 1)
})
await test('una trama con un bit alterado se descarta (no se firma lo que no llega entero)', async () => {
  const m = await construirMensaje({ secreto: SECRETO, letra: 'A', contador: 1, texto: 'x' })
  const trama = tramaMensaje({ origen: 'EA4XYZ', destinatario: 'ALERTA', ruta: [], linea: m.linea })
  const rota = Uint8Array.from(trama); rota[20] ^= 0x04
  assert.equal(decodeFrame(rota), null)
})

console.log(`\n${passed} pruebas correctas`)
