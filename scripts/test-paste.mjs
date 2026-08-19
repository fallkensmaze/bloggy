// Pruebas del cifrado del Secure Paste.
//
// Lo que se fija aquí no es que "cifre" —eso lo hace la WebCrypto del navegador— sino la
// propiedad que el módulo tuvo rota desde el principio: **el id del documento no puede
// abrir el contenido**. La clave se derivaba de `SHA-256(prefijo + código)` y el código
// era el nombre del documento en Firestore, así que quien podía leer el documento podía
// descifrarlo. Un fallo así no se nota en la interfaz: la página sigue mostrando "Cifrado
// AES-GCM" y el texto se lee igual. Solo lo detecta una prueba que intente descifrar con
// lo que el servidor conoce y exija que falle.

import assert from 'node:assert/strict'
import {
  MAX_CIPHERTEXT_CHARS,
  MAX_PASTE_CHARS,
  PASTE_CODE_CHARS,
  PASTE_CODE_LENGTH,
  decryptLegacyPasteContent,
  decryptPasteContent,
  encryptPasteContent,
  generatePasteCode,
  generatePasteKey,
} from '../src/utils/pasteCrypto.js'

let pasadas = 0
const prueba = async (nombre, fn) => {
  await fn()
  pasadas += 1
  console.log(`  ok  ${nombre}`)
}

const base64UrlABytes = (v) =>
  Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

// La derivación antigua, reproducida aquí a propósito: es exactamente lo que podría
// intentar quien tenga el volcado de la base de datos, porque solo necesita el id.
async function claveDerivadaDelId(pasteCode) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`falkens-maze-paste:${pasteCode}`)
  )
  return Buffer.from(digest).toString('base64url')
}

console.log('Secure Paste')

await prueba('la clave mide 256 bits y el código no la contiene', () => {
  const clave = generatePasteKey()
  assert.equal(base64UrlABytes(clave).length, 32)

  const codigo = generatePasteCode()
  assert.equal(codigo.length, PASTE_CODE_LENGTH)
  for (const c of codigo) assert.ok(PASTE_CODE_CHARS.includes(c), `carácter inesperado: ${c}`)
  assert.ok(!clave.includes(codigo), 'la clave no puede contener el código')
})

await prueba('ida y vuelta con la clave correcta', async () => {
  const clave = generatePasteKey()
  const texto = 'línea uno\nlínea dos — con acentos, ñ y 😀'
  const { ciphertext, iv } = await encryptPasteContent(texto, clave)

  assert.notEqual(ciphertext, texto)
  assert.equal(await decryptPasteContent(ciphertext, iv, clave), texto)
})

await prueba('el id del documento NO descifra el contenido', async () => {
  const codigo = generatePasteCode()
  const clave = generatePasteKey()
  const { ciphertext, iv } = await encryptPasteContent('secreto', clave)

  // Esto es lo que tiene el servidor: el documento y su nombre. No debe bastar.
  const claveDelServidor = await claveDerivadaDelId(codigo)
  await assert.rejects(() => decryptPasteContent(ciphertext, iv, claveDelServidor))
  await assert.rejects(() => decryptLegacyPasteContent(ciphertext, iv, codigo))
})

await prueba('otra clave no descifra', async () => {
  const { ciphertext, iv } = await encryptPasteContent('secreto', generatePasteKey())
  await assert.rejects(() => decryptPasteContent(ciphertext, iv, generatePasteKey()))
})

await prueba('una clave con longitud equivocada se rechaza antes de descifrar', async () => {
  const clave = generatePasteKey()
  const { ciphertext, iv } = await encryptPasteContent('secreto', clave)

  for (const mala of ['', 'abc', clave.slice(0, 20), clave + 'AA']) {
    await assert.rejects(
      () => decryptPasteContent(ciphertext, iv, mala),
      (err) => err.message === 'clave-invalida',
      `debería rechazarse por longitud: ${JSON.stringify(mala)}`
    )
  }
})

await prueba('cada cifrado usa un IV distinto', async () => {
  const clave = generatePasteKey()
  const a = await encryptPasteContent('mismo texto', clave)
  const b = await encryptPasteContent('mismo texto', clave)

  assert.notEqual(a.iv, b.iv, 'reutilizar el IV con la misma clave rompe AES-GCM')
  assert.notEqual(a.ciphertext, b.ciphertext)
  assert.equal(base64UrlABytes(a.iv).length, 12)
})

await prueba('el texto más largo admitido cabe en el límite de ciphertext', async () => {
  const { ciphertext } = await encryptPasteContent('a'.repeat(MAX_PASTE_CHARS), generatePasteKey())
  assert.ok(
    ciphertext.length < MAX_CIPHERTEXT_CHARS,
    `${ciphertext.length} caracteres no caben en ${MAX_CIPHERTEXT_CHARS}`
  )
})

await prueba('los pastes antiguos se siguen leyendo mientras no caduquen', async () => {
  // Cifrado con el esquema viejo (clave derivada del id) para comprobar que el respaldo
  // de compatibilidad funciona. Cuando pasen 7 días desde el despliegue, esta prueba y
  // `decryptLegacyPasteContent` se borran juntas.
  const codigo = generatePasteCode()
  const { ciphertext, iv } = await encryptPasteContent('de antes', await claveDerivadaDelId(codigo))
  assert.equal(await decryptLegacyPasteContent(ciphertext, iv, codigo), 'de antes')
})

console.log(`\n${pasadas} pruebas correctas`)
