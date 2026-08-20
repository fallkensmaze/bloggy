// Assertions for src/utils/cpt.js
//
// A continuous performance test measures milliseconds, so the parts worth
// guarding are the ones that fail silently. A sequence that lets two no-go
// trials sit next to each other, or that piles them into the 4 s interval, still
// runs and still produces a tidy number — a number about the sequence rather
// than about the person taking it. The same goes for the scoring: d' returns
// Infinity the moment somebody commits no false alarms, and Infinity renders as
// a blank cell rather than as an error, so the log-linear correction is pinned
// here numerically.
//
// The other invariant is that a keypress too early to be a reaction never counts
// as a hit. Without that rule, hammering the key at a steady rhythm scores as
// perfect attention.

import {
  aCsv,
  analizar,
  avanzarReloj,
  calendario,
  construirSecuencia,
  deteccionSenal,
  desviacion,
  duracionDe,
  ensayosDe,
  interpretar,
  media,
  mediana,
  nivelDe,
  pendiente,
  probit,
  secuenciaPractica,
  DURACION_ESTIMULO,
  ISIS,
  LETRAS_GO,
  LETRA_NOGO,
  PROPORCION_NOGO,
  PROTOCOLOS,
  REFERENCIAS,
  TR_MINIMO,
} from '../src/utils/cpt.js'

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
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol

/** Seeded generator, so a failure can be reproduced from the seed alone. */
function mulberry32(seed) {
  let a = seed >>> 0
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const seeds = Array.from({ length: 40 }, (_, i) => 1000 + i * 7)

// ---- Protocols ------------------------------------------------------------

function testProtocolos() {
  section('Protocols')

  check('the full protocol is the length of the Conners CPT',
    ensayosDe(PROTOCOLOS.completo) === 360 && duracionDe(PROTOCOLOS.completo) === 14 * 60_000,
    `${ensayosDe(PROTOCOLOS.completo)} trials, ${duracionDe(PROTOCOLOS.completo) / 60_000} min`)

  check('every protocol lasts trials x mean ISI',
    Object.values(PROTOCOLOS).every(p =>
      duracionDe(p) === ensayosDe(p) * media(ISIS)),
    Object.values(PROTOCOLOS).map(p => `${p.id}:${(duracionDe(p) / 60_000).toFixed(1)}min`).join(' '))

  check('the stimulus fits inside the shortest interval',
    DURACION_ESTIMULO < Math.min(...ISIS))

  check('the shortest protocol still has enough no-go trials to score',
    Math.round(ensayosDe(PROTOCOLOS.breve) * PROPORCION_NOGO) >= 9)
}

// ---- Sequence -------------------------------------------------------------

function testSecuencia() {
  section('Sequence')

  const problemas = {
    recuento: [], seguidos: [], primero: [], repetida: [], letra: [],
    isiPorBloque: [], balanceIsi: [], tamanoBloque: [],
  }

  for (const seed of seeds) {
    for (const protocolo of Object.values(PROTOCOLOS)) {
      const s = construirSecuencia(protocolo, mulberry32(seed))
      const esperados = Math.round(ensayosDe(protocolo) * PROPORCION_NOGO)

      if (s.filter(e => e.nogo).length !== esperados) problemas.recuento.push(seed)
      if (s.some((e, i) => i > 0 && e.nogo && s[i - 1].nogo)) problemas.seguidos.push(seed)
      if (s[0].nogo) problemas.primero.push(seed)
      if (s.some((e, i) => i > 0 && e.letra === s[i - 1].letra)) problemas.repetida.push(seed)
      if (s.some(e => (e.nogo ? e.letra !== LETRA_NOGO : !LETRAS_GO.includes(e.letra)))) {
        problemas.letra.push(seed)
      }

      // Each block must serve each ISI exactly once, or "block" would stop
      // meaning the same amount of waiting for everyone.
      for (let b = 0; b < protocolo.bloques; b++) {
        const delBloque = s.filter(e => e.bloque === b)
        if (delBloque.length !== ISIS.length * protocolo.porSubbloque) problemas.tamanoBloque.push(seed)
        const isisDelBloque = [...new Set(delBloque.map(e => e.isi))].sort((x, y) => x - y)
        if (isisDelBloque.join() !== [...ISIS].sort((x, y) => x - y).join()) {
          problemas.isiPorBloque.push(seed)
        }
      }

      // No-go trials spread across the three intervals: bunched into the 4 s
      // interval, the commission rate would be measuring the wait, not the person.
      const porIsi = ISIS.map(isi => s.filter(e => e.isi === isi && e.nogo).length)
      if (Math.max(...porIsi) - Math.min(...porIsi) > 1) problemas.balanceIsi.push(seed)
    }
  }

  check('the no-go count is exactly the requested proportion', problemas.recuento.length === 0,
    problemas.recuento.slice(0, 3).join())
  check('no two no-go trials are ever adjacent', problemas.seguidos.length === 0,
    problemas.seguidos.slice(0, 3).join())
  check('the first trial is never a no-go', problemas.primero.length === 0,
    problemas.primero.slice(0, 3).join())
  check('no letter repeats on consecutive trials', problemas.repetida.length === 0,
    problemas.repetida.slice(0, 3).join())
  check('go trials use go letters and no-go trials use the X', problemas.letra.length === 0,
    problemas.letra.slice(0, 3).join())
  check('every block serves each ISI exactly once', problemas.isiPorBloque.length === 0,
    problemas.isiPorBloque.slice(0, 3).join())
  check('every block has the same number of trials', problemas.tamanoBloque.length === 0,
    problemas.tamanoBloque.slice(0, 3).join())
  check('no-go trials are balanced across the three intervals', problemas.balanceIsi.length === 0,
    problemas.balanceIsi.slice(0, 3).join())

  const a = construirSecuencia(PROTOCOLOS.breve, mulberry32(7))
  const b = construirSecuencia(PROTOCOLOS.breve, mulberry32(7))
  check('the same seed rebuilds the same sequence',
    JSON.stringify(a) === JSON.stringify(b))

  const c = construirSecuencia(PROTOCOLOS.breve, mulberry32(8))
  check('a different seed gives a different sequence',
    JSON.stringify(a) !== JSON.stringify(c))

  const indices = a.map(e => e.indice)
  check('indices are consecutive from zero',
    indices.every((n, i) => n === i))
}

function testCalendario() {
  section('Schedule')

  const s = construirSecuencia(PROTOCOLOS.breve, mulberry32(3))
  const inicios = calendario(s)

  check('the first letter appears at time zero', inicios[0] === 0)

  check('each onset is the previous one plus the previous interval',
    inicios.every((t, i) => i === 0 || t === inicios[i - 1] + s[i - 1].isi))

  check('the schedule ends exactly at the protocol duration',
    inicios.at(-1) + s.at(-1).isi === duracionDe(PROTOCOLOS.breve),
    `${(inicios.at(-1) + s.at(-1).isi) / 1000} s`)

  const practica = secuenciaPractica(18, mulberry32(5))
  check('practice runs at one fixed pace and is not scored against the protocol',
    practica.length === 18 && practica.every(e => e.isi === 1500 && e.bloque === 0),
    `${practica.filter(e => e.nogo).length} no-go`)

  check('practice still contains no-go trials to practise withholding',
    practica.some(e => e.nogo))
}

// ---- Frame clock ----------------------------------------------------------

function testReloj() {
  section('Frame clock')

  // Three trials at 1 s: onsets at 0, 1000 and 2000 ms.
  const inicios = [0, 1000, 2000]

  const arranque = avanzarReloj({ indice: -1, t: 0, inicios })
  check('the first frame shows the first letter',
    arranque.indice === 0 && arranque.visible && arranque.avances === 1 &&
    arranque.descartados.length === 0)

  check('the letter is still up inside its display window',
    avanzarReloj({ indice: 0, t: 200, inicios }).visible)

  const apagada = avanzarReloj({ indice: 0, t: 300, inicios })
  check('the letter is gone once its display window ends, without advancing',
    !apagada.visible && apagada.indice === 0 && apagada.avances === 0)

  check('a frame between trials drops nothing',
    avanzarReloj({ indice: 0, t: 800, inicios }).descartados.length === 0)

  // A frame that lands 20 ms into the third trial: the second was crossed whole.
  const salto = avanzarReloj({ indice: 0, t: 2020, inicios })
  check('a stall that crosses a trial reports it as never painted',
    salto.indice === 2 && salto.avances === 2 &&
    salto.descartados.join() === '1' && salto.visible,
    `dropped ${salto.descartados.join()}`)

  // A frame landing after the third letter would already have vanished.
  const tarde = avanzarReloj({ indice: 0, t: 2400, inicios })
  check('a trial whose window had already closed on arrival is dropped too',
    tarde.indice === 2 && !tarde.visible && tarde.descartados.join() === '1,2',
    `dropped ${tarde.descartados.join()}`)

  check('the clock never runs past the last trial',
    avanzarReloj({ indice: 2, t: 99_999, inicios }).indice === 2)

  // Walking a real schedule frame by frame must visit every trial exactly once:
  // a trial silently skipped here would be scored as a lapse of attention.
  const secuencia = construirSecuencia(PROTOCOLOS.breve, mulberry32(11))
  const horario = calendario(secuencia)
  const vistos = []
  let indice = -1
  let descartados = 0
  for (let t = 0; t <= horario.at(-1) + secuencia.at(-1).isi; t += 1000 / 60) {
    const paso = avanzarReloj({ indice, t, inicios: horario })
    if (paso.avances > 0) vistos.push(paso.indice)
    descartados += paso.descartados.length
    indice = paso.indice
  }
  check('a steady 60 Hz frame walk paints every trial and drops none',
    vistos.length === secuencia.length && descartados === 0 &&
    vistos.every((n, i) => n === i),
    `${vistos.length} of ${secuencia.length}`)
}

// ---- Descriptive statistics -----------------------------------------------

function testEstadistica() {
  section('Statistics')

  check('media, mediana and desviacion agree with the textbook values',
    media([2, 4, 4, 4, 5, 5, 7, 9]) === 5 &&
    mediana([2, 4, 4, 4, 5, 5, 7, 9]) === 4.5 &&
    near(desviacion([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7)))

  check('a single value has no dispersion to report', desviacion([500]) === null)
  check('an empty set has no mean to report', media([]) === null)

  const rampa = [0, 1, 2, 3, 4, 5].map(x => ({ x, y: 300 + 12.5 * x }))
  check('pendiente recovers the exact slope of a straight line',
    near(pendiente(rampa), 12.5), String(pendiente(rampa)))

  check('pendiente ignores points with no mean to plot',
    near(pendiente([...rampa, { x: 6, y: null }]), 12.5))

  check('pendiente needs two points', pendiente([{ x: 1, y: 1 }]) === null)

  // The tabulated z values: if the approximation drifts, d' drifts with it.
  check('probit matches the tabulated normal quantiles',
    near(probit(0.5), 0, 1e-12) &&
    near(probit(0.975), 1.959963985, 1e-8) &&
    near(probit(0.95), 1.644853627, 1e-8) &&
    near(probit(0.025), -1.959963985, 1e-8),
    `z(0.975)=${probit(0.975).toFixed(9)}`)

  check('probit is symmetric about the median',
    near(probit(0.1), -probit(0.9), 1e-9))
}

// ---- Signal detection -----------------------------------------------------

function testDeteccionSenal() {
  section('Signal detection')

  // A flawless run is the case that used to produce Infinity: z(1) diverges.
  const perfecto = deteccionSenal({ aciertos: 324, nGo: 324, falsasAlarmas: 0, nNogo: 36 })
  check("a flawless run gives a finite d', not Infinity",
    Number.isFinite(perfecto.dPrima) && perfecto.dPrima > 3,
    `d'=${perfecto.dPrima.toFixed(3)}`)

  const nulo = deteccionSenal({ aciertos: 162, nGo: 324, falsasAlarmas: 18, nNogo: 36 })
  check('responding at chance gives d′ = 0',
    near(nulo.dPrima, 0, 1e-9), `d'=${nulo.dPrima}`)

  check('chance performance has a neutral criterion',
    near(nulo.criterio, 0, 1e-9) && near(nulo.beta, 1, 1e-9))

  const bueno = deteccionSenal({ aciertos: 310, nGo: 324, falsasAlarmas: 6, nNogo: 36 })
  const regular = deteccionSenal({ aciertos: 290, nGo: 324, falsasAlarmas: 14, nNogo: 36 })
  check("d' falls when either kind of error rises",
    bueno.dPrima > regular.dPrima,
    `${bueno.dPrima.toFixed(2)} > ${regular.dPrima.toFixed(2)}`)

  // z(0.99) - z(0.05) with the log-linear counts, worked out by hand.
  const zA = probit((89 + 0.5) / (90 + 1))
  const zF = probit((1 + 0.5) / (10 + 1))
  const manual = deteccionSenal({ aciertos: 89, nGo: 90, falsasAlarmas: 1, nNogo: 10 })
  check("d' is z(hits) - z(false alarms) over the corrected rates",
    near(manual.dPrima, zA - zF, 1e-12), manual.dPrima.toFixed(6))

  check('no no-go trials means no discrimination to report',
    deteccionSenal({ aciertos: 10, nGo: 10, falsasAlarmas: 0, nNogo: 0 }).dPrima === null)
}

// ---- Scoring --------------------------------------------------------------

/** Hand-built run: 8 go trials and 2 no-go, one per block. */
function sesionDePrueba() {
  const patron = [
    // bloque 0
    { nogo: false, isi: 1000 }, { nogo: false, isi: 1000 }, { nogo: true, isi: 1000 },
    { nogo: false, isi: 2000 }, { nogo: false, isi: 2000 },
    // bloque 1
    { nogo: false, isi: 1000 }, { nogo: true, isi: 1000 }, { nogo: false, isi: 1000 },
    { nogo: false, isi: 2000 }, { nogo: false, isi: 2000 },
  ]
  return patron.map((p, i) => ({
    indice: i,
    bloque: i < 5 ? 0 : 1,
    subbloque: i < 5 ? 0 : 1,
    isi: p.isi,
    letra: p.nogo ? LETRA_NOGO : 'B',
    nogo: p.nogo,
  }))
}

function testPuntuacion() {
  section('Scoring')

  const secuencia = sesionDePrueba()

  // Hits on 0,1,3,4,5,8 - trial 9 missed - commission on 2 - correct rejection on 6.
  const respuestas = [
    { indice: 0, tr: 400 }, { indice: 1, tr: 500 }, { indice: 2, tr: 350 },
    { indice: 3, tr: 300 }, { indice: 4, tr: 600 }, { indice: 5, tr: 450 },
    { indice: 7, tr: 550 }, { indice: 8, tr: 500 },
  ]
  const m = analizar(secuencia, respuestas)

  check('hits, omissions, commissions and correct rejections add up',
    m.aciertos === 7 && m.omisiones === 1 && m.comisiones === 1 && m.nNogo === 2,
    `${m.aciertos} hits / ${m.omisiones} omissions / ${m.comisiones} commissions`)

  check('the omission rate is over the go trials only',
    near(m.tasaOmision, 1 / 8) && near(m.tasaComision, 1 / 2),
    `${(m.tasaOmision * 100).toFixed(1)}% / ${(m.tasaComision * 100).toFixed(1)}%`)

  check('the reaction time only averages the hits',
    near(m.tr.media, (400 + 500 + 300 + 600 + 450 + 550 + 500) / 7) && m.tr.n === 7,
    `${m.tr.media.toFixed(1)} ms over ${m.tr.n}`)

  check('the commission response time never enters the mean',
    !m.ensayos.find(e => e.indice === 2).acierto &&
    m.ensayos.find(e => e.indice === 2).comision)

  check('the coefficient of variation is the SD over the mean',
    near(m.tr.cv, m.tr.desviacion / m.tr.media))

  check('per-block totals add back up to the whole run',
    m.porBloque.reduce((s, b) => s + b.n, 0) === secuencia.length &&
    m.porBloque.reduce((s, b) => s + b.aciertos, 0) === m.aciertos,
    `${m.porBloque.length} blocks`)

  check('per-ISI totals add back up to the whole run',
    m.porIsi.reduce((s, b) => s + b.n, 0) === secuencia.length,
    m.porIsi.map(b => `${b.isi}:${b.n}`).join(' '))

  check('the exported table has one row per trial plus the header',
    aCsv(m).trim().split('\n').length === secuencia.length + 1)

  check('the exported table labels each trial with its outcome',
    aCsv(m).split('\n')[3].endsWith('comision'),
    aCsv(m).split('\n')[3])
}

function testAnticipaciones() {
  section('Anticipations')

  const secuencia = sesionDePrueba()

  const temprana = analizar(secuencia, [{ indice: 0, tr: TR_MINIMO - 1 }])
  check('a press too early to be a reaction is not a hit',
    temprana.aciertos === 0 && temprana.anticipaciones === 1 &&
    temprana.ensayos[0].omision,
    `${temprana.anticipaciones} anticipation`)

  const rescatada = analizar(secuencia, [{ indice: 0, tr: 40 }, { indice: 0, tr: 480 }])
  check('a valid press after an early one still scores as a hit',
    rescatada.aciertos === 1 && near(rescatada.tr.media, 480) &&
    rescatada.anticipaciones === 1)

  check('the extra press counts once as a repeated response',
    rescatada.multiples === 1)

  const martilleo = analizar(secuencia, secuencia.map(e => ({ indice: e.indice, tr: 50 })))
  check('hammering the key at a fixed rhythm scores no hits at all',
    martilleo.aciertos === 0 && martilleo.anticipaciones === secuencia.length,
    `${martilleo.anticipaciones} anticipations, ${martilleo.aciertos} hits`)

  const dobles = analizar(secuencia, [
    { indice: 0, tr: 300 }, { indice: 0, tr: 420 }, { indice: 0, tr: 700 },
  ])
  check('several presses in one trial are still a single hit, timed by the first',
    dobles.aciertos === 1 && near(dobles.tr.media, 300) && dobles.multiples === 2)

  check('presses are read in time order, not arrival order',
    near(analizar(secuencia, [{ indice: 1, tr: 700 }, { indice: 1, tr: 300 }]).tr.media, 300))
}

function testDescartados() {
  section('Dropped frames')

  const secuencia = sesionDePrueba()
  const respuestas = [{ indice: 0, tr: 400 }, { indice: 5, tr: 400 }]

  const completo = analizar(secuencia, respuestas)
  const recortado = analizar(secuencia, respuestas, { descartados: [1, 3] })

  check('a trial the browser never painted is not counted as an omission',
    recortado.n === completo.n - 2 && recortado.omisiones === completo.omisiones - 2,
    `${recortado.omisiones} vs ${completo.omisiones}`)

  check('the number of dropped trials is reported instead of hidden',
    recortado.descartados === 2)

  const conRespuesta = analizar(secuencia, [...respuestas, { indice: 1, tr: 400 }],
    { descartados: [1] })
  check('a response to a dropped trial is discarded with it',
    conRespuesta.aciertos === 2 && conRespuesta.multiples === 0,
    `${conRespuesta.aciertos} hits`)
}

function testDerivas() {
  section('Drift')

  // Two blocks, second one 100 ms slower: the slope must read exactly that.
  const secuencia = sesionDePrueba()
  const respuestas = secuencia
    .filter(e => !e.nogo)
    .map(e => ({ indice: e.indice, tr: e.bloque === 0 ? 400 : 500 }))
  const m = analizar(secuencia, respuestas)

  check('the block drift is the millisecond change per block',
    near(m.derivaBloques, 100), `${m.derivaBloques} ms/block`)

  check('the between-block variability is the SD of the block means',
    near(m.variabilidadEntreBloques, desviacion([400, 500])),
    m.variabilidadEntreBloques.toFixed(2))

  const constante = analizar(secuencia,
    secuencia.filter(e => !e.nogo).map(e => ({ indice: e.indice, tr: 420 })))
  check('a run with no change in pace drifts by zero',
    near(constante.derivaBloques, 0) && constante.tr.desviacion === 0)

  // 1 s and 2 s intervals, 60 ms apart: 60 ms of reaction time per second of wait.
  const porIsi = analizar(secuencia, secuencia
    .filter(e => !e.nogo)
    .map(e => ({ indice: e.indice, tr: e.isi === 1000 ? 400 : 460 })))
  check('the ISI drift is read per second of waiting',
    near(porIsi.derivaIsi, 60), `${porIsi.derivaIsi} ms/s`)
}

// ---- Reading --------------------------------------------------------------

function testInterpretacion() {
  section('Reading')

  check('a level is only assigned when there is a number to assign it to',
    nivelDe(null, REFERENCIAS.cv) === 'nd' && nivelDe(Infinity, REFERENCIAS.cv) === 'nd')

  check('the thresholds order the three levels',
    nivelDe(0.02, REFERENCIAS.tasaOmision) === 'ok' &&
    nivelDe(0.07, REFERENCIAS.tasaOmision) === 'atencion' &&
    nivelDe(0.20, REFERENCIAS.tasaOmision) === 'alerta')

  // d' is the one metric where lower is worse; a copied threshold would invert it.
  check("d' is read the other way round: lower is worse",
    nivelDe(3.5, REFERENCIAS.dPrima) === 'ok' &&
    nivelDe(2.0, REFERENCIAS.dPrima) === 'atencion' &&
    nivelDe(1.0, REFERENCIAS.dPrima) === 'alerta')

  const secuencia = sesionDePrueba()
  const lectura = interpretar(analizar(secuencia,
    secuencia.filter(e => !e.nogo).map(e => ({ indice: e.indice, tr: 420 }))))

  check('every reading carries a value, a level and an explanation',
    lectura.length === 6 &&
    lectura.every(l => l.clave && l.etiqueta && l.texto &&
      ['ok', 'atencion', 'alerta', 'nd'].includes(l.nivel)),
    lectura.map(l => `${l.clave}:${l.nivel}`).join(' '))

  check('a clean run reads clean on omissions and commissions',
    lectura.find(l => l.clave === 'omisiones').nivel === 'ok' &&
    lectura.find(l => l.clave === 'comisiones').nivel === 'ok')

  const distraido = interpretar(analizar(secuencia,
    secuencia.filter(e => !e.nogo).slice(0, 3).map(e => ({ indice: e.indice, tr: 420 }))))
  check('a run with most letters missed is flagged on omissions',
    distraido.find(l => l.clave === 'omisiones').nivel === 'alerta')
}

const suites = [
  testProtocolos,
  testSecuencia,
  testCalendario,
  testReloj,
  testEstadistica,
  testDeteccionSenal,
  testPuntuacion,
  testAnticipaciones,
  testDescartados,
  testDerivas,
  testInterpretacion,
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
  console.error(`CPT assertions FAILED: ${failures.length} of ${failures.length + passed.length} checks`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`CPT assertions passed: ${passed.length} checks.`)
