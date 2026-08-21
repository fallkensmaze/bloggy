// Assertions for src/utils/radioXml.js and src/utils/radioExam.js
//
// The questions of /radioaficionado are pasted by hand into Firestore as XML, so
// the reader is the only thing standing between a bad paste and a study session
// that teaches the wrong answer. Two failures would be silent without these
// checks: a question whose correct option is not marked at all (it would just
// look like a question nobody can pass) and a shuffle that loses or duplicates an
// option (the right answer disappears from the list while everything still
// renders). Both are asserted here, together with the discard rules that keep a
// half-pasted question out of the deck instead of inside it.
//
// The fixtures below are invented on purpose: the real topics are private and
// must not live in a public repository.

import {
  decodeEntities,
  hashPregunta,
  parseTemaXml,
  parseXml,
} from '../src/utils/radioXml.js'
import {
  baraja,
  buildPractica,
  buildSimulacro,
  claveDe,
  conOpcionesBarajadas,
  corrige,
  CHAT_BASE,
  formatoReloj,
  notaSimulacro,
  OBJETIVO,
  promptExplicacion,
  TODOS,
  urlExplicacion,
} from '../src/utils/radioExam.js'

const failures = []
const passed = []
let currentSection = ''

function section(name) {
  currentSection = name
  console.log(`\n${name}`)
}
function check(label, ok, detail = '') {
  if (ok) {
    passed.push(label)
    console.log(`  ok   ${label}${detail ? ` (${detail})` : ''}`)
  } else {
    failures.push(`${currentSection} :: ${label}${detail ? ` -> ${detail}` : ''}`)
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`)
  }
}

/** Generador determinista, para que un fallo se pueda reproducir. */
function lcg(seed = 1) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const XML_TEMA = `<?xml version="1.0" encoding="UTF-8"?>
<!-- tema de prueba -->
<tema numero="7" titulo="Propagación &amp; antenas">
  <pregunta>
    <enunciado>¿Qué mide el ROE?</enunciado>
    <opcion>La potencia de salida del equipo</opcion>
    <opcion correcta="si">La relación de ondas estacionarias en la línea</opcion>
    <opcion>La ganancia de la antena</opcion>
  </pregunta>
  <pregunta tipo="multiple">
    <enunciado>¿Cuáles de estas bandas son de HF?</enunciado>
    <opcion correcta="si">La banda de 20 metros</opcion>
    <opcion correcta="si">La banda de 40 metros</opcion>
    <opcion>La banda de 2 metros</opcion>
    <opcion>La banda de 70 centímetros</opcion>
  </pregunta>
  <pregunta>
    <enunciado><![CDATA[¿Se cumple que a < b en un divisor?]]></enunciado>
    <opcion correcta="si">Sí, la tensión de salida es menor</opcion>
    <opcion>No, la tensión de salida es mayor</opcion>
    <nota>La caída se reparte entre las dos resistencias.</nota>
  </pregunta>
</tema>`

// ---- XML -------------------------------------------------------------------

function testXml() {
  section('XML')

  const tema = parseTemaXml(XML_TEMA)
  check('lee número y título de la raíz', tema.numero === 7 && tema.titulo === 'Propagación & antenas',
    `${tema.numero} · ${tema.titulo}`)
  check('lee las tres preguntas', tema.preguntas.length === 3 && tema.descartadas === 0)
  check('no hay avisos en un tema bien formado', tema.avisos.length === 0, tema.avisos.join(' | '))

  const [roe, bandas, divisor] = tema.preguntas
  check('la pregunta de una respuesta no es múltiple', roe.multi === false && roe.correctas.length === 1)
  check('la correcta apunta a la opción marcada',
    roe.opciones[roe.correctas[0]].texto.startsWith('La relación de ondas'))
  check('tipo="multiple" con dos correctas', bandas.multi === true && bandas.correctas.join(',') === '0,1')
  check('CDATA conserva el «<» del enunciado', divisor.enunciado.includes('a < b'), divisor.enunciado)
  check('la nota se lee aparte del enunciado', divisor.nota.startsWith('La caída se reparte'))

  // Invariante central: si `correctas` no apuntara a las opciones marcadas, la
  // corrección daría por buena otra respuesta sin que nada fallara.
  const coherente = tema.preguntas.every(p =>
    p.correctas.every(i => p.opciones[i].correcta === true) &&
    p.opciones.filter(o => o.correcta).length === p.correctas.length)
  check('todo índice de `correctas` es una opción marcada correcta="si"', coherente)

  check('varias correctas sin tipo="multiple" también son múltiples',
    parseTemaXml('<tema><pregunta><enunciado>E</enunciado>' +
      '<opcion correcta="si">A</opcion><opcion correcta="sí">B</opcion><opcion>C</opcion>' +
      '</pregunta></tema>').preguntas[0].multi === true)

  check('decodifica entidades numéricas y nombradas',
    decodeEntities('a&#241;o &amp; d&#xed;a &lt;x&gt;') === 'año & día <x>')
}

function testDescartes() {
  section('Descartes')

  const xml = `<tema numero="1">
    <pregunta><enunciado>Sin marcar</enunciado><opcion>A</opcion><opcion>B</opcion></pregunta>
    <pregunta><enunciado>Una sola opción</enunciado><opcion correcta="si">A</opcion></pregunta>
    <pregunta><enunciado>Todas valen</enunciado><opcion correcta="si">A</opcion><opcion correcta="si">B</opcion></pregunta>
    <pregunta><opcion correcta="si">A</opcion><opcion>B</opcion></pregunta>
    <pregunta><enunciado>Buena</enunciado><opcion correcta="si">A</opcion><opcion>B</opcion></pregunta>
  </tema>`
  const tema = parseTemaXml(xml)

  check('solo sobrevive la pregunta utilizable', tema.preguntas.length === 1 && tema.descartadas === 4)
  check('cada descarte deja su aviso', tema.avisos.length === 4, tema.avisos.join(' | '))
  check('avisa de la que no tiene ninguna correcta',
    tema.avisos.some(a => a.includes('correcta="si"')))
  check('avisa de la que tiene menos de dos opciones',
    tema.avisos.some(a => a.includes('menos de dos')))
  check('avisa de la que tiene todas correctas',
    tema.avisos.some(a => a.includes('todas las opciones')))
  check('avisa de la que no tiene enunciado',
    tema.avisos.some(a => a.includes('sin <enunciado>')))

  check('un tema vacío avisa en lugar de romperse',
    parseTemaXml('<tema numero="2"></tema>').avisos.length === 1)
}

function testXmlRoto() {
  section('XML roto')

  const rompe = (xml, etiqueta) => {
    let lanzo = false
    try { parseTemaXml(xml) } catch { lanzo = true }
    check(etiqueta, lanzo)
  }

  rompe('', 'el XML vacío da error')
  rompe('<tema><pregunta></tema>', 'una etiqueta sin cerrar da error')
  rompe('<otra><pregunta/></otra>', 'sin raíz <tema> da error')
  rompe('<tema><pregunta><enunciado>E</enunciado></tema>', 'un cierre que no casa da error')

  // Un pegado con texto suelto delante no debería tumbar la página entera.
  const nodos = parseXml('<tema><pregunta/></tema>')
  check('el árbol solo tiene la raíz esperada', nodos.children.length === 1 && nodos.children[0].name === 'tema')
}

function testIdentidad() {
  section('Identidad de las preguntas')

  const base = hashPregunta('¿Qué mide el ROE?')
  check('el id no depende de mayúsculas, acentos ni espacios',
    base === hashPregunta('  ¿QUE   mide el ROE?  '))
  check('enunciados distintos dan ids distintos', base !== hashPregunta('¿Qué mide el vatímetro?'))

  // Volver a pegar el tema con las opciones en otro orden no puede cambiar el id:
  // el progreso de repaso se guarda contra él.
  const uno = parseTemaXml('<tema><pregunta><enunciado>Misma</enunciado>' +
    '<opcion correcta="si">A</opcion><opcion>B</opcion></pregunta></tema>')
  const otro = parseTemaXml('<tema><pregunta><enunciado>Misma</enunciado>' +
    '<opcion>B</opcion><opcion correcta="si">A</opcion></pregunta></tema>')
  check('reordenar las opciones no cambia el id', uno.preguntas[0].id === otro.preguntas[0].id)
  check('reordenar las opciones sí mueve el índice correcto',
    uno.preguntas[0].correctas[0] === 0 && otro.preguntas[0].correctas[0] === 1)

  const repes = parseTemaXml('<tema>' +
    '<pregunta><enunciado>Igual</enunciado><opcion correcta="si">A</opcion><opcion>B</opcion></pregunta>' +
    '<pregunta><enunciado>Igual</enunciado><opcion correcta="si">C</opcion><opcion>D</opcion></pregunta>' +
    '</tema>')
  check('dos enunciados idénticos no comparten id',
    repes.preguntas[0].id !== repes.preguntas[1].id)
}

// ---- Mazos -----------------------------------------------------------------

function temaFalso(id, numero, cuantas) {
  const preguntas = Array.from({ length: cuantas }, (_, i) => ({
    id: `${id}-p${i}`,
    enunciado: `Pregunta ${i} de ${id}`,
    multi: false,
    opciones: [{ texto: 'A', correcta: true }, { texto: 'B', correcta: false }, { texto: 'C', correcta: false }],
    correctas: [0],
    nota: '',
  }))
  return { id, numero, titulo: `Tema ${numero}`, preguntas, avisos: [] }
}

function testBaraja() {
  section('Mazos')

  const temas = [temaFalso('tema-01', 1, 4), temaFalso('tema-02', 2, 6)]

  const todo = baraja(temas, TODOS)
  check('«Aleatorio» junta todos los temas', todo.length === 10)
  check('cada pregunta lleva su tema', todo.filter(p => p.temaNumero === 2).length === 6)
  check('la clave de progreso lleva el tema delante',
    todo[0].key === claveDe('tema-01', 'tema-01-p0'))
  check('no hay dos preguntas con la misma clave', new Set(todo.map(p => p.key)).size === todo.length)

  const soloUno = baraja(temas, 'tema-02')
  check('elegir un tema deja solo sus preguntas',
    soloUno.length === 6 && soloUno.every(p => p.temaId === 'tema-02'))
  check('un tema que ya no existe da un mazo vacío', baraja(temas, 'tema-99').length === 0)
}

function testBarajado() {
  section('Barajado de opciones')

  const rng = lcg(42)
  const pregunta = baraja([temaFalso('t', 1, 1)], TODOS)[0]

  // Perder o duplicar una opción al barajar sacaría la respuesta correcta de la
  // lista sin que nada fallara en pantalla.
  let siempreCompleto = true
  for (let i = 0; i < 200; i++) {
    const { orden } = conOpcionesBarajadas(pregunta, rng)
    const ordenado = [...orden].sort((a, b) => a - b).join(',')
    if (ordenado !== '0,1,2') siempreCompleto = false
  }
  check('`orden` siempre es una permutación de todas las opciones', siempreCompleto)

  const barajada = conOpcionesBarajadas(pregunta, rng)
  check('las opciones y las correctas no se tocan',
    barajada.opciones === pregunta.opciones && barajada.correctas === pregunta.correctas)
}

function testPractica() {
  section('Práctica')

  const rng = lcg(7)
  const pool = baraja([temaFalso('tema-01', 1, 5)], TODOS)

  check('sin preguntas no hay pregunta', buildPractica({ pool: [], rng }) === null)

  const excluida = pool[2].key
  let repitio = false
  for (let i = 0; i < 200; i++) {
    const q = buildPractica({ pool, excluirKey: excluida, rng })
    if (q.key === excluida) repitio = true
  }
  check('nunca repite la pregunta que se acaba de responder', !repitio)

  const unica = baraja([temaFalso('tema-01', 1, 1)], TODOS)
  check('con una sola pregunta la vuelve a plantear en vez de quedarse en blanco',
    buildPractica({ pool: unica, excluirKey: unica[0].key, rng })?.key === unica[0].key)

  const claves = new Set(pool.map(p => p.key))
  let fuera = false
  for (let i = 0; i < 200; i++) {
    if (!claves.has(buildPractica({ pool, rng }).key)) fuera = true
  }
  check('nunca sale una pregunta de fuera del mazo activo', !fuera)
}

function testSimulacro() {
  section('Simulacro')

  const rng = lcg(11)
  const pool = baraja([temaFalso('tema-01', 1, 12)], TODOS)

  const tanda = buildSimulacro({ pool, tamano: 5, rng })
  check('respeta el tamaño pedido', tanda.length === 5)
  check('no repite ninguna pregunta en la tanda', new Set(tanda.map(p => p.key)).size === 5)
  check('todas vienen barajadas', tanda.every(p => Array.isArray(p.orden) && p.orden.length === 3))

  check('pedir más preguntas de las que hay devuelve todas',
    buildSimulacro({ pool, tamano: 100, rng }).length === 12)
  check('un mazo vacío devuelve una tanda vacía',
    buildSimulacro({ pool: [], tamano: 10, rng }).length === 0)
}

function testCorreccion() {
  section('Corrección')

  const simple = { correctas: [1], opciones: [{}, {}, {}] }
  check('acierto simple', corrige(simple, [1]).ok === true)
  check('fallo simple', corrige(simple, [0]).ok === false)
  check('sin contestar no cuenta como fallo de opción',
    corrige(simple, []).contestada === false && corrige(simple, []).ok === false)

  const multi = { correctas: [0, 2], opciones: [{}, {}, {}] }
  check('acierto múltiple exacto', corrige(multi, [2, 0]).ok === true)
  check('marcar de menos no es acierto',
    corrige(multi, [0]).ok === false && corrige(multi, [0]).faltan === 1)
  check('marcar de más no es acierto',
    corrige(multi, [0, 1, 2]).ok === false && corrige(multi, [0, 1, 2]).sobran === 1)
  check('repetir la misma opción no infla los aciertos', corrige(multi, [0, 0, 2]).ok === true)

  const preguntas = [simple, simple, multi, multi]
  const nota = notaSimulacro(preguntas, [[1], [0], [0, 2], []])
  check('la nota cuenta aciertos, fallos y blancos',
    nota.correctas === 2 && nota.falladas === 1 && nota.enBlanco === 1 && nota.porcentaje === 50,
    JSON.stringify(nota))
  check('el listón se aplica sobre el porcentaje',
    notaSimulacro([simple], [[1]]).superado === (100 >= OBJETIVO * 100))
  check('una tanda vacía no divide por cero', notaSimulacro([], []).porcentaje === 0)
}

// The prompt that goes out to the chat is study material, not decoration: the
// options are reshuffled on every run, so numbering them by their XML index
// would describe a "B" that was never on the student's screen, and the answer
// would come back explaining the wrong option with total confidence. Nothing
// would throw. These checks pin the letters to `orden`.
function testExplicacion() {
  section('Explicación externa')

  // En pantalla se pintó C, A, B: la del índice original 2 es la «A» del alumno.
  const pregunta = {
    enunciado: '¿Qué anchura ocupa una emisión A1A?',
    opciones: [{ texto: 'Unos 500 Hz' }, { texto: 'Unos 6 kHz' }, { texto: 'Unos 100 Hz' }],
    correctas: [2],
    orden: [2, 0, 1],
    temaTitulo: 'Técnica',
  }

  const fallo = promptExplicacion(pregunta, [0])
  check('las letras siguen el orden barajado, no el del XML',
    fallo.includes('A) Unos 100 Hz') && fallo.includes('B) Unos 500 Hz'))
  check('la correcta se nombra con la letra que se vio',
    fallo.includes('Respuesta correcta: A) Unos 100 Hz'))
  check('lo marcado se nombra con la letra que se vio',
    fallo.includes('Lo que marqué: B) Unos 500 Hz'))
  check('el fallo pide en qué se equivocó', fallo.includes('Me equivoqué'))
  check('el tema entra como contexto', fallo.includes('Tema: Técnica'))

  const acierto = promptExplicacion(pregunta, [2])
  check('el acierto pide descartar la eliminación', acierto.includes('por eliminación'))

  const blanco = promptExplicacion(pregunta, [])
  check('en blanco no inventa una opción marcada', blanco.includes('Lo que marqué: nada'))
  check('en blanco pide el razonamiento', blanco.includes('La dejé en blanco'))

  const multi = {
    enunciado: '¿Cuáles son ciertas?',
    opciones: [{ texto: 'Una' }, { texto: 'Otra' }, { texto: 'Tercera' }],
    correctas: [2, 0],
    orden: [1, 0, 2],
  }
  const varias = promptExplicacion(multi, [2, 1])
  check('varias correctas se anuncian en plural', varias.includes('Respuestas correctas:'))
  check('la petición también concuerda en plural', varias.includes('las correctas lo son'))
  check('varias correctas salen en el orden de pantalla',
    varias.includes('Respuestas correctas: B) Una | C) Tercera'))
  check('lo marcado también sale en el orden de pantalla',
    varias.includes('Lo que marqué: A) Otra | C) Tercera'))
  check('sin tema no se cuela una línea vacía', !varias.includes('Tema:'))

  // Sin `orden` (una pregunta que nunca pasó por el barajado) el prompt no
  // puede quedarse sin letras: cae al orden del XML.
  const sinOrden = promptExplicacion({ ...pregunta, orden: undefined }, [0])
  check('sin orden barajado cae al del XML', sinOrden.includes('A) Unos 500 Hz'))

  const url = urlExplicacion(pregunta, [0])
  check('la url apunta al chat', url.startsWith(CHAT_BASE))
  check('la url no lleva saltos de línea ni espacios crudos',
    !/[\s]/.test(url.slice(CHAT_BASE.length)))
  check('el prompt sobrevive al viaje de ida y vuelta',
    decodeURIComponent(url.slice(CHAT_BASE.length)) === fallo)
}

function testReloj() {
  section('Reloj')
  check('cero', formatoReloj(0) === '00:00')
  check('un minuto y cinco segundos', formatoReloj(65000) === '01:05')
  check('más de diez minutos', formatoReloj(12 * 60000 + 3000) === '12:03')
  check('negativo no da guiones', formatoReloj(-500) === '00:00')
}

const suites = [
  testXml,
  testDescartes,
  testXmlRoto,
  testIdentidad,
  testBaraja,
  testBarajado,
  testPractica,
  testSimulacro,
  testCorreccion,
  testExplicacion,
  testReloj,
]

for (const suite of suites) {
  try {
    await suite()
  } catch (error) {
    currentSection = suite.name
    check(`${suite.name} threw`, false, error.stack || error.message)
  }
}

console.log('')
if (failures.length > 0) {
  console.error(`Radio exam assertions FAILED: ${failures.length} of ${failures.length + passed.length} checks`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`Radio exam assertions passed: ${passed.length} checks.`)
