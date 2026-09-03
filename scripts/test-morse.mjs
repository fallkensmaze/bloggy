// Assertions for src/utils/morse.js and src/utils/morseTrainer.js
//
// The timing is the part worth guarding. A CW trainer that sends at the wrong
// speed is silently useless: nothing throws, the tone still sounds, and the
// student calibrates their ear against a lie. PARIS is the standard yardstick
// (the word plus its trailing word space takes exactly 60/wpm seconds), and
// Farnsworth splits the extra delay 3:7 between character and word gaps, so
// both are asserted numerically here.
//
// The quiz builders are checked for the invariants the UI relies on: options
// are unique, the answer is always among them, and no question offers a
// character outside the active deck (a Koch lesson must never leak a character
// the student has not been introduced to yet).

import {
  classifyGap,
  classifyPress,
  farnsworthGaps,
  morseOf,
  morseTimeline,
  morseToText,
  oppositeOf,
  prettyMorse,
  reverseOf,
  rhythmOf,
  symbolsFor,
  textToMorse,
  tokenize,
  MORSE_TABLE,
  PROSIGNS,
  REVERSE_TABLE,
} from '../src/utils/morse.js'
import {
  buildCopyDrill,
  buildKochSession,
  buildVisualQuestion,
  charsToIntroduce,
  deckEntries,
  gradeCopy,
  gradeKochSession,
  kochChars,
  newestKochChar,
  randomGroup,
  readyToAdvance,
  wordsFor,
  CW_WORDS,
  LCWO_DEFAULTS,
  KOCH_ORDER,
  MAX_LESSON,
  MIN_LESSON,
  MORSE_CHARS,
} from '../src/utils/morseTrainer.js'

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
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol

// ---- Table ----------------------------------------------------------------

function testTable() {
  section('Table')

  const chars = Object.keys(MORSE_TABLE)
  check('26 letters, 10 digits and punctuation are present',
    chars.filter(c => /[A-Z]/.test(c)).length === 26 && chars.filter(c => /[0-9]/.test(c)).length === 10,
    `${chars.length} entries`)

  const patterns = Object.values(MORSE_TABLE)
  check('no character shares a pattern with another',
    new Set(patterns).size === patterns.length)

  check('every pattern is made of dots and dashes only',
    patterns.every(p => /^[.-]+$/.test(p)))

  // Los prosignos que valen por un signo tienen que coincidir con él, o el
  // decodificador devolvería cosas distintas para el mismo sonido.
  const alt = Object.entries(PROSIGNS).filter(([, p]) => p.alt)
  check('prosigns with an equivalent sign share its pattern',
    alt.every(([, p]) => MORSE_TABLE[p.alt] === p.morse),
    alt.map(([n, p]) => `${n}=${p.alt}`).join(' '))

  check('the reverse table resolves shared patterns to the punctuation sign',
    REVERSE_TABLE['.-.-.'] === '+' && REVERSE_TABLE['...-.-'] === '<SK>')

  check('every table pattern decodes back to its own character',
    Object.entries(MORSE_TABLE).every(([c, m]) => REVERSE_TABLE[m] === c))
}

// ---- Encoding -------------------------------------------------------------

function testEncoding() {
  section('Encoding')

  check('morseOf keeps the historic two-space separator',
    morseOf('QRM') === '--.-  .-.  --', morseOf('QRM'))

  check('textToMorse separates words with a slash',
    textToMorse('CQ DE') === '-.-. --.- / -.. .', textToMorse('CQ DE'))

  check('prosigns are written between angle brackets and sent as one letter',
    textToMorse('<AR>') === '.-.-.' && tokenize('<SK>').join('') === 'SK')

  check('unknown characters are dropped instead of breaking the stream',
    textToMorse('A#B') === '.- -...', textToMorse('A#B'))

  check('morseToText accepts dot/dash glyphs and slashes',
    morseToText('·−·−· / −···−') === '+ =', morseToText('·−·−· / −···−'))

  check('unknown patterns decode to a hash',
    morseToText('.-.-.-.-.-') === '#')

  const texto = 'HOLA MUNDO 73 <AR>'
  check('text survives a full round trip',
    morseToText(textToMorse(texto)) === 'HOLA MUNDO 73 +',
    morseToText(textToMorse(texto)))

  check('prettyMorse only swaps the glyphs',
    prettyMorse('.-') === '·–')
}

// ---- Study helpers --------------------------------------------------------

function testStudyHelpers() {
  section('Study helpers')

  check('rhythmOf uses di in the middle and dit at the end',
    rhythmOf('.-.') === 'di-dah-dit' && rhythmOf('.') === 'dit',
    rhythmOf('.-.'))

  check('reverseOf pairs the mirrored characters',
    reverseOf('A') === 'N' && reverseOf('N') === 'A' && reverseOf('D') === 'U')

  check('a symmetric pattern has no mirror',
    reverseOf('E') === null && reverseOf('K') === null)

  check('oppositeOf swaps dots and dashes',
    oppositeOf('U') === 'G' && oppositeOf('E') === 'T')

  check('symbolsFor takes characters and prosigns alike',
    symbolsFor('a') === '.-' && symbolsFor('AR') === '.-.-.')
}

// ---- Timing ---------------------------------------------------------------

function testTiming() {
  section('Timing')

  // PARIS es la palabra patrón: a N palabras por minuto ocupa 60/N segundos
  // contando el espacio de palabra que la sigue.
  for (const wpm of [5, 12, 18, 20, 25, 40]) {
    const tl = morseTimeline('PARIS', { wpm, effWpm: wpm })
    const { wordGap } = farnsworthGaps(wpm, wpm)
    check(`PARIS at ${wpm} wpm lasts 60/${wpm} s`,
      near(tl.duration + wordGap, 60 / wpm),
      `${(tl.duration + wordGap).toFixed(4)} s`)
  }

  // Con Farnsworth el texto sale a la velocidad efectiva, aunque cada carácter
  // se envíe al ritmo rápido.
  for (const [charWpm, effWpm] of [[20, 10], [25, 5], [18, 13], [20, 8]]) {
    const tl = morseTimeline('PARIS', { wpm: charWpm, effWpm })
    const { wordGap } = farnsworthGaps(charWpm, effWpm)
    check(`PARIS at ${charWpm}/${effWpm} wpm lasts 60/${effWpm} s`,
      near(tl.duration + wordGap, 60 / effWpm),
      `${(tl.duration + wordGap).toFixed(4)} s`)
  }

  const std = farnsworthGaps(20, 20)
  check('standard gaps are 3 and 7 dots',
    near(std.charGap, 3 * std.unit) && near(std.wordGap, 7 * std.unit))

  const fw = farnsworthGaps(20, 8)
  check('Farnsworth stretches the silences, never the elements',
    near(fw.unit, std.unit) && fw.charGap > std.charGap && fw.wordGap > std.wordGap,
    `charGap ${(fw.charGap / fw.unit).toFixed(2)} dots`)

  check('the extra delay keeps the 3:7 ratio between gaps',
    near(fw.wordGap / fw.charGap, 7 / 3, 1e-12))

  check('an effective speed above the character speed falls back to standard',
    near(farnsworthGaps(20, 30).charGap, std.charGap))

  const tl = morseTimeline('EE', { wpm: 20, effWpm: 20 })
  check('elements last one and three dots',
    tl.events.length === 2 && near(tl.events[0].dur, tl.unit),
    `${tl.events.length} events`)
  check('the first element starts at zero',
    near(tl.events[0].start, 0))
  check('the character gap is not added before the first character',
    near(tl.events[1].start, tl.unit + 3 * tl.unit))

  const dash = morseTimeline('T', { wpm: 20 })
  check('a dash is three dots long', near(dash.events[0].dur, 3 * dash.unit))

  check('an empty text produces no events',
    morseTimeline('', { wpm: 20 }).events.length === 0)
}

// ---- Straight key ---------------------------------------------------------

function testKeying() {
  section('Straight key')

  const unit = 60   // ms, 20 wpm
  check('a short press is a dot and a long one a dash',
    classifyPress(unit, unit) === '.' && classifyPress(unit * 3, unit) === '-')
  check('the dot/dash threshold sits at two dots',
    classifyPress(unit * 1.9, unit) === '.' && classifyPress(unit * 2.1, unit) === '-')
  check('gaps separate symbols, characters and words',
    classifyGap(unit, unit) === 'symbol' &&
    classifyGap(unit * 3, unit) === 'char' &&
    classifyGap(unit * 7, unit) === 'word')
}

// ---- Koch progression -----------------------------------------------------

function testKoch() {
  section('Koch progression')

  check('the Koch order has no repeats',
    new Set(KOCH_ORDER).size === KOCH_ORDER.length, `${KOCH_ORDER.length} characters`)

  check('the course uses the exact LCWO order',
    KOCH_ORDER.join(' ') === 'K M U R E S N A P T L W I . J Z = F O Y , V G 5 / Q 9 2 H 3 8 B ? 4 7 C 1 D 6 0 X',
    KOCH_ORDER.join(' '))

  check('LCWO has 40 lessons and 41 characters',
    MAX_LESSON === 40 && KOCH_ORDER.length === 41)

  check('every Koch character exists in the table',
    KOCH_ORDER.every(c => !!MORSE_TABLE[c]))

  check('the first lesson brings two characters',
    kochChars(MIN_LESSON).length === 2, kochChars(MIN_LESSON).join(''))

  check('each lesson adds exactly one character',
    kochChars(5).length === 6 && kochChars(6).length === 7)

  check('the last lesson covers the whole Koch order',
    kochChars(MAX_LESSON).length === KOCH_ORDER.length)

  check('lessons out of range are clamped',
    kochChars(0).length === 2 && kochChars(999).length === KOCH_ORDER.length)

  check('a lesson never drops a character from the previous one',
    kochChars(9).slice(0, kochChars(8).length).join('') === kochChars(8).join(''))

  check('the first lesson has no newly introduced character',
    newestKochChar(MIN_LESSON) === null && newestKochChar(5) === KOCH_ORDER[5])

  check('advancing needs a full window above the target',
    readyToAdvance([100, 100, 100, 100, 100]) === true &&
    readyToAdvance([100, 100, 100]) === false &&
    readyToAdvance([60, 60, 60, 60, 60]) === false)
}

// ---- Decks and drills -----------------------------------------------------

function testDecks() {
  section('Decks and drills')

  check('the alphanumeric deck holds the 36 characters of a callsign',
    deckEntries('alfanumerico').length === 36)

  check('the full deck matches the table',
    deckEntries('todo').length === MORSE_CHARS.length)

  check('an unknown deck falls back to the full table',
    deckEntries('inventado').length === MORSE_CHARS.length)

  const koch8 = deckEntries('koch', 8)
  check('the Koch deck follows the lesson', koch8.length === 9, koch8.map(e => e.char).join(''))

  for (const size of [1, 3, 5, 7]) {
    const group = randomGroup({ pool: koch8, size })
    check(`a group of ${size} has that many characters from the deck`,
      group.length === size && group.split('').every(c => koch8.some(e => e.char === c)),
      group)
  }

  check('an empty deck yields an empty group', randomGroup({ pool: [], size: 5 }) === '')

  // Tres repeticiones seguidas convertirían el grupo en un ejercicio inútil.
  let tripled = 0
  for (let i = 0; i < 400; i++) {
    const g = randomGroup({ pool: deckEntries('koch', MIN_LESSON), size: 7 })
    if (/(.)\1\1/.test(g)) tripled++
  }
  check('groups avoid three identical characters in a row even with two available',
    tripled === 0, `${tripled} of 400`)

  check('every CW abbreviation can be written with the table',
    CW_WORDS.every(w => w.text.split('').every(c => !!MORSE_TABLE[c])))

  check('the abbreviation list is filtered by the active deck',
    wordsFor(['K', 'M']).length === 0 && wordsFor(deckEntries('alfanumerico').map(e => e.char)).length === CW_WORDS.length)

  const wordDrill = buildCopyDrill({ pool: deckEntries('alfanumerico'), mode: 'palabra' })
  check('the word drill returns a real abbreviation with its meaning',
    !!wordDrill.meaning && CW_WORDS.some(w => w.text === wordDrill.text),
    `${wordDrill.text}: ${wordDrill.meaning}`)

  const fallback = buildCopyDrill({ pool: deckEntries('koch', MIN_LESSON), mode: 'palabra' })
  check('with no abbreviation available the drill falls back to a group',
    fallback.meaning === null && fallback.text.length === 5, fallback.text)

  const single = buildCopyDrill({ pool: deckEntries('koch', 4), mode: 'caracter' })
  check('the single-character drill sends exactly one', single.text.length === 1, single.text)
}

// ---- Grading --------------------------------------------------------------

function testGrading() {
  section('Grading')

  const perfect = gradeCopy('KMRSU', 'kmrsu')
  check('grading ignores case', perfect.perfect && perfect.correct === 5)

  const oneOff = gradeCopy('KMRSU', 'KMRXU')
  check('one wrong character is counted once',
    oneOff.correct === 4 && oneOff.total === 5 && !oneOff.perfect)
  check('the failing cell keeps what was typed',
    oneOff.cells[3].expected === 'S' && oneOff.cells[3].got === 'X')

  const short = gradeCopy('KMRSU', 'KMR')
  check('a short answer leaves the missing cells empty',
    short.correct === 3 && short.cells.length === 5 && short.cells[4].got === null)

  const long = gradeCopy('KM', 'KMR')
  check('an extra character is not a perfect copy',
    long.correct === 2 && !long.perfect && long.cells.length === 3)

  check('spaces are ignored so a group can be typed loosely',
    gradeCopy('KMRSU', 'KM RSU').perfect)

  check('an empty answer scores zero without crashing',
    gradeCopy('KMRSU', '').correct === 0)
}

// ---- Visual quiz ----------------------------------------------------------

function testVisualQuiz() {
  section('Visual quiz')

  const decks = [deckEntries('todo'), deckEntries('alfanumerico'), deckEntries('koch', 3)]
  let bad = 0
  let outside = 0
  for (const pool of decks) {
    const chars = new Set(pool.map(e => e.char))
    const patterns = new Set(pool.map(e => e.morse))
    for (let i = 0; i < 300; i++) {
      const q = buildVisualQuestion({ pool, mode: 'mixed' })
      if (new Set(q.options).size !== q.options.length) bad++
      if (!q.options.includes(q.answer)) bad++
      if (q.options.length !== Math.min(4, pool.length)) bad++
      const known = q.mode === 'char2morse' ? patterns : chars
      if (!q.options.every(o => known.has(o))) outside++
    }
  }
  check('options are unique and always contain the answer', bad === 0, `${bad} bad questions`)
  check('no question offers anything outside the active deck', outside === 0, `${outside} leaks`)

  // La lección 1 sólo tiene dos caracteres: la pregunta se queda en dos
  // opciones y el 50/50 no puede dejar una sola en pie.
  const tiny = buildVisualQuestion({ pool: deckEntries('koch', MIN_LESSON), mode: 'morse2char' })
  check('a two-character deck asks with two options', tiny.options.length === 2)
  check('the 50/50 hint disappears when there is nothing to strike out',
    tiny.hints.every(h => h.id !== '5050'), tiny.hints.map(h => h.id).join(' '))

  const full = buildVisualQuestion({ pool: deckEntries('todo'), mode: 'morse2char' })
  check('the full hint ladder has three steps', full.hints.length === 3)
  const fifty = full.hints.find(h => h.id === '5050')
  check('the 50/50 strikes out two wrong options and leaves two standing',
    fifty.eliminate.length === 2 && !fifty.eliminate.includes(full.answer))

  const repetidas = new Set()
  for (let i = 0; i < 200; i++) {
    repetidas.add(buildVisualQuestion({ pool: deckEntries('todo'), excludeChar: 'A' }).entry.char)
  }
  check('the excluded character never comes back next', !repetidas.has('A'))

  // Los cajones de Leitner tienen que sesgar el sorteo hacia lo flojo.
  const pool = deckEntries('letras')
  const progress = {}
  for (const e of pool) progress[e.char] = { box: 4, correct: 9, wrong: 0, seen: 9 }
  progress.Q = { box: 0, correct: 0, wrong: 3, seen: 3 }
  let quinientos = 0
  for (let i = 0; i < 500; i++) {
    if (buildVisualQuestion({ pool, progress }).entry.char === 'Q') quinientos++
  }
  check('a weak character comes up far more often than an even share',
    quinientos > (500 / pool.length) * 3, `${quinientos} of 500, even share is ${Math.round(500 / pool.length)}`)
}

// ---- Stored settings ------------------------------------------------------
// localStorage no existe en Node, asi que se sustituye por un doble. Merece la
// pena: la primera visita se quedaba con el minimo del intervalo en vez del
// valor por defecto, porque Number(null) es 0 y 0 es finito.

async function testSettings() {
  section('Stored settings')

  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }

  const { readChoice, readJson, readNumber, writeValue } = await import('../src/utils/localSettings.js')

  check('a missing key returns the fallback, not the range minimum',
    readNumber('ausente', { min: 5, max: 40, fallback: 20 }) === 20,
    String(readNumber('ausente', { min: 5, max: 40, fallback: 20 })))

  writeValue('vacia', '')
  check('an empty string returns the fallback',
    readNumber('vacia', { min: 5, max: 40, fallback: 20 }) === 20)

  writeValue('texto', 'veinte')
  check('a non-numeric value returns the fallback',
    readNumber('texto', { min: 5, max: 40, fallback: 20 }) === 20)

  writeValue('cero', 0)
  check('a stored zero is honoured and clamped, not treated as missing',
    readNumber('cero', { min: 5, max: 40, fallback: 20 }) === 5)

  writeValue('alta', 999)
  writeValue('baja', -3)
  check('stored values are clamped to the range',
    readNumber('alta', { min: 5, max: 40, fallback: 20 }) === 40 &&
    readNumber('baja', { min: 5, max: 40, fallback: 20 }) === 5)

  writeValue('modo', 'grupo')
  check('a choice outside the allowed list falls back',
    readChoice('modo', ['caracter', 'grupo'], 'caracter') === 'grupo' &&
    readChoice('modo', ['caracter'], 'caracter') === 'caracter' &&
    readChoice('ausente', ['caracter', 'grupo'], 'grupo') === 'grupo')

  writeValue('progreso', { K: { box: 2 } })
  check('an object round-trips and a broken one falls back',
    readJson('progreso', {}).K.box === 2 &&
    readJson('ausente', { vacio: true }).vacio === true)

  writeValue('roto', 'no-json')
  check('unparseable JSON returns the fallback',
    readJson('roto', { vacio: true }).vacio === true)

  // Los valores por defecto que ve una pestaña nueva son los de /morse.
  check('a fresh browser opens with the LCWO 20/10 wpm, 600 Hz defaults and lesson 1',
    readNumber('morse_charwpm', { min: 5, max: 40, fallback: LCWO_DEFAULTS.charWpm }) === 20 &&
    readNumber('morse_effwpm', { min: 4, max: 40, fallback: LCWO_DEFAULTS.effWpm }) === 10 &&
    readNumber('morse_freq', { min: 300, max: 1000, fallback: LCWO_DEFAULTS.tone }) === 600 &&
    readNumber('morse_lesson', { min: MIN_LESSON, max: MAX_LESSON, fallback: MIN_LESSON }) === MIN_LESSON &&
    readNumber('morse_copy_size', { min: 3, max: 7, fallback: 5 }) === 5)

  delete globalThis.localStorage
}

// ---- LCWO course ----------------------------------------------------------
// The course is made of timed random groups, graded as a complete copy. These
// checks pin the LCWO character order, active deck and 90% promotion rule.

function testGuidedCourse() {
  section('LCWO course')

  check('lesson 1 introduces both characters, later lessons only the new one',
    charsToIntroduce(MIN_LESSON).join('') === 'KM' &&
    charsToIntroduce(7).length === 1 && charsToIntroduce(7)[0] === KOCH_ORDER[7])

  const pool = deckEntries('koch', MIN_LESSON)
  const fixed = buildKochSession({ pool, minutes: 1, groupLength: 5, wpm: 20, effWpm: 10 })
  check('a one-minute practice is never cut short',
    fixed.seconds >= 60 && fixed.seconds < 75,
    `${fixed.seconds.toFixed(2)} seconds`)
  check('fixed LCWO groups contain five active-lesson characters',
    fixed.groups.every(group => group.length === 5 && /^[KM]+$/.test(group)),
    `${fixed.groups.length} groups`)

  const random = buildKochSession({ pool, minutes: 1, randomLength: true, wpm: 20, effWpm: 10 })
  check('random LCWO groups stay between two and seven characters',
    random.groups.every(group => group.length >= 2 && group.length <= 7))

  const empty = buildKochSession({ pool: [], minutes: 5 })
  check('an empty lesson creates an empty safe session',
    empty.text === '' && empty.groups.length === 0 && empty.seconds === 0)

  const perfect = gradeKochSession('KMUKM UKMKM', 'kmukm ukmkm')
  check('a complete LCWO copy scores 100%', perfect.accuracy === 100 && perfect.passed)

  const noSpaces = gradeKochSession('KMUKM UKMKM', 'KMUKMUKMKM')
  check('the sequence score forgives omitted group spaces',
    noSpaces.accuracy === 100 && noSpaces.sequenceErrors === 0)

  const ninety = gradeKochSession('KMUKM UKMKM', 'KMUKM UKMKA')
  check('90% is enough to unlock the next lesson',
    ninety.accuracy === 90 && ninety.passed)

  const below = gradeKochSession('KMUKM UKMKM', 'KMUKM UKAAA')
  check('a copy below 90% stays in the same lesson',
    below.accuracy < 90 && !below.passed)

  check('LCWO keyboard substitution accepts semicolon for question mark',
    gradeKochSession('?', ';').accuracy === 100)
}

const suites = [
  testTable,
  testEncoding,
  testStudyHelpers,
  testTiming,
  testKeying,
  testKoch,
  testDecks,
  testGrading,
  testVisualQuiz,
  testGuidedCourse,
  testSettings,
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
  console.error(`Morse trainer assertions FAILED: ${failures.length} of ${failures.length + passed.length} checks`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`Morse trainer assertions passed: ${passed.length} checks.`)
