// ── Entrenador de Morse ─────────────────────────────────────────────────────
// Datos y lógica pura de /morse: progresión Koch, mazos, generación de grupos,
// corrección del copiado y preguntas del quiz visual. Sin React ni DOM.
//
// El repaso espaciado es el de ./leitner, con el carácter como clave: el
// progreso es { [char]: { box, correct, wrong, seen } }.

import {
  MORSE_TABLE,
  PROSIGNS,
  symbolsFor,
  rhythmOf,
  reverseOf,
  oppositeOf,
  morseTimeline,
} from './morse.js'
import { shuffle, pickWeighted, masterySummary as summarize } from './leitner.js'

/**
 * Orden usado por el curso de LCWO.net. La lección 1 presenta K y M; las 39
 * siguientes añaden un carácter cada una, hasta completar 41 caracteres en
 * 40 lecciones.
 */
export const KOCH_ORDER = [
  'K', 'M', 'U', 'R', 'E', 'S', 'N', 'A', 'P', 'T',
  'L', 'W', 'I', '.', 'J', 'Z', '=', 'F', 'O', 'Y',
  ',', 'V', 'G', '5', '/', 'Q', '9', '2', 'H', '3',
  '8', 'B', '?', '4', '7', 'C', '1', 'D', '6', '0',
  'X',
]

/** La lección 1 arranca con dos caracteres; a partir de ahí, uno por lección. */
export const MIN_LESSON = 1
export const MAX_LESSON = KOCH_ORDER.length - 1

export const GROUP_LABELS = {
  letras:     'Letras',
  numeros:    'Números',
  puntuacion: 'Puntuación',
}

const groupOf = (char) => (/[A-Z]/.test(char) ? 'letras' : /[0-9]/.test(char) ? 'numeros' : 'puntuacion')

/** Catálogo completo: un registro por carácter de la tabla. */
export const MORSE_CHARS = Object.keys(MORSE_TABLE).map(char => ({
  char,
  morse:  MORSE_TABLE[char],
  group:  groupOf(char),
  rhythm: rhythmOf(MORSE_TABLE[char]),
  koch:   KOCH_ORDER.indexOf(char),          // -1 si Koch no lo cubre
}))

const BY_CHAR = new Map(MORSE_CHARS.map(e => [e.char, e]))

export function entryOf(char) {
  return BY_CHAR.get(String(char).toUpperCase()) || null
}

/** Lista de prosignos para la referencia, con su patrón y su equivalente. */
export const PROSIGN_LIST = Object.entries(PROSIGNS).map(([name, p]) => ({
  char:   `<${name}>`,
  name,
  morse:  p.morse,
  rhythm: rhythmOf(p.morse),
  label:  p.label,
  alt:    p.alt,
}))

// ── Mazos ───────────────────────────────────────────────────────────────────

export const DECKS = [
  { id: 'koch',         label: 'LCWO / Koch',     hint: 'Orden de LCWO: K, M y un carácter nuevo por lección' },
  { id: 'letras',       label: 'Letras',          hint: 'Las 26 letras del alfabeto' },
  { id: 'numeros',      label: 'Números',         hint: 'Las diez cifras' },
  { id: 'alfanumerico', label: 'Letras y cifras', hint: 'Alfabeto y números, lo que basta para un indicativo' },
  { id: 'puntuacion',   label: 'Puntuación',      hint: 'Signos y separadores del tráfico habitual' },
  { id: 'todo',         label: 'Todo',            hint: 'La tabla completa' },
]

/** Caracteres cubiertos por una lección de Koch (la 1 ya trae dos). */
export function kochChars(lesson) {
  const n = Math.min(Math.max(lesson, MIN_LESSON), MAX_LESSON) + 1
  return KOCH_ORDER.slice(0, n)
}

/** Entradas del mazo activo. `lesson` sólo se usa con el mazo Koch. */
export function deckEntries(deckId, lesson = MIN_LESSON) {
  switch (deckId) {
    case 'koch':         return kochChars(lesson).map(entryOf).filter(Boolean)
    case 'letras':       return MORSE_CHARS.filter(e => e.group === 'letras')
    case 'numeros':      return MORSE_CHARS.filter(e => e.group === 'numeros')
    case 'alfanumerico': return MORSE_CHARS.filter(e => e.group !== 'puntuacion')
    case 'puntuacion':   return MORSE_CHARS.filter(e => e.group === 'puntuacion')
    default:             return MORSE_CHARS
  }
}

/** El carácter que estrena la lección actual, para destacarlo en la interfaz. */
export function newestKochChar(lesson) {
  const chars = kochChars(lesson)
  return lesson <= MIN_LESSON ? null : chars[chars.length - 1]
}

// ── Material de práctica ────────────────────────────────────────────────────

/**
 * Abreviaturas y voces de uso corriente en CW, todas de dos caracteres o más:
 * las de una sola letra («K» de cambio, «R» de recibido) repetirían el modo de
 * un carácter. Se filtran por el mazo activo, así que en las primeras lecciones
 * de Koch no hay ninguna disponible y el generador recae en grupos aleatorios.
 */
export const CW_WORDS = [
  { text: 'CQ',   meaning: 'Llamada general' },
  { text: 'DE',   meaning: 'De (aquí la estación…)' },
  { text: 'TU',   meaning: 'Gracias (thank you)' },
  { text: 'TNX',  meaning: 'Gracias' },
  { text: 'PSE',  meaning: 'Por favor (please)' },
  { text: 'AGN',  meaning: 'Otra vez (again)' },
  { text: 'ES',   meaning: 'Y (and)' },
  { text: 'UR',   meaning: 'Tu / tuyo (your)' },
  { text: 'HR',   meaning: 'Aquí (here)' },
  { text: 'FB',   meaning: 'Estupendo (fine business)' },
  { text: 'GUD',  meaning: 'Bien (good)' },
  { text: 'VY',   meaning: 'Muy (very)' },
  { text: 'HI',   meaning: 'Risa en CW' },
  { text: 'OM',   meaning: 'Colega operador (old man)' },
  { text: 'YL',   meaning: 'Operadora (young lady)' },
  { text: 'WX',   meaning: 'Meteorología (weather)' },
  { text: 'RIG',  meaning: 'El equipo' },
  { text: 'ANT',  meaning: 'Antena' },
  { text: 'PWR',  meaning: 'Potencia' },
  { text: 'NAME', meaning: 'Nombre del operador' },
  { text: 'CUL',  meaning: 'Hasta luego (see you later)' },
  { text: 'DX',   meaning: 'Estación lejana' },
  { text: 'RST',  meaning: 'Reporte de señal' },
  { text: 'QTH',  meaning: 'Situación de la estación' },
  { text: 'QRZ',  meaning: '¿Quién me llama?' },
  { text: 'QSL',  meaning: 'Recibido conforme' },
  { text: 'QSO',  meaning: 'Contacto' },
  { text: 'QRM',  meaning: 'Interferencia de otras estaciones' },
  { text: 'QRN',  meaning: 'Ruido atmosférico' },
  { text: 'QRP',  meaning: 'Poca potencia' },
  { text: 'QSY',  meaning: 'Cambio de frecuencia' },
  { text: 'QRT',  meaning: 'Cierro la estación' },
  { text: '73',   meaning: 'Saludos cordiales' },
  { text: '88',   meaning: 'Besos' },
  { text: '599',  meaning: 'Reporte perfecto' },
  { text: '5NN',  meaning: '599 abreviado en concurso' },
]

/** Voces del repertorio que se pueden escribir con los caracteres dados. */
export function wordsFor(chars) {
  const set = new Set(chars)
  return CW_WORDS.filter(w => w.text.split('').every(c => set.has(c)))
}

// ── Generación de ejercicios ────────────────────────────────────────────────

/**
 * Grupo de práctica sorteado con el peso de Leitner: los caracteres flojos y
 * los recién estrenados salen más. Evita tres repeticiones seguidas para que
 * el grupo no degenere en «KKKKK».
 */
export function randomGroup({ pool, progress = {}, size = 5, rng = Math.random } = {}) {
  if (!pool || pool.length === 0) return ''
  const out = []
  const sortear = () => pickWeighted(pool, progress, rng, e => e.char).char
  const triplica = (c) => out.length >= 2 && out[out.length - 1] === c && out[out.length - 2] === c

  for (let i = 0; i < size; i++) {
    let pick = sortear()
    for (let intento = 0; intento < 6 && triplica(pick); intento++) pick = sortear()
    // En la primera lección sólo hay dos caracteres y el sorteo ponderado puede
    // insistir en el mismo las seis veces: entonces se fuerza cualquier otro.
    if (triplica(pick)) {
      const otros = pool.filter(e => e.char !== pick)
      if (otros.length > 0) pick = otros[Math.floor(rng() * otros.length)].char
    }
    out.push(pick)
  }
  return out.join('')
}

/**
 * Ejercicio de copiado según el modo:
 *   'caracter' — un solo carácter
 *   'grupo'    — grupo de `size` caracteres al azar
 *   'palabra'  — abreviatura real de CW, si el mazo da para alguna
 * Devuelve { text, meaning } — `meaning` sólo en el modo palabra.
 */
export function buildCopyDrill({ pool, progress = {}, mode = 'grupo', size = 5, rng = Math.random } = {}) {
  if (mode === 'palabra') {
    const words = wordsFor(pool.map(e => e.char))
    if (words.length > 0) {
      const w = words[Math.floor(rng() * words.length)]
      return { text: w.text, meaning: w.meaning }
    }
    // Sin vocabulario disponible todavía: se practica con grupos.
  }
  const n = mode === 'caracter' ? 1 : size
  return { text: randomGroup({ pool, progress, size: n, rng }), meaning: null }
}

/**
 * Corrige lo copiado carácter a carácter. Compara por posición, así que una
 * letra de más desplaza el resto: es justo lo que pasa al copiar de verdad.
 * Devuelve { cells, correct, total, perfect }.
 */
export function gradeCopy(target, typed) {
  const want = String(target).toUpperCase().replace(/\s+/g, '')
  const got  = String(typed).toUpperCase().replace(/\s+/g, '')
  const cells = []
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    const expected = want[i] ?? null
    const answer   = got[i] ?? null
    cells.push({ expected, got: answer, ok: expected !== null && expected === answer })
  }
  const correct = cells.filter(c => c.ok).length
  return { cells, correct, total: want.length, perfect: correct === want.length && got.length === want.length }
}

// ── Progresión Koch ─────────────────────────────────────────────────────────

export const KOCH_TARGET = 90      // % de acierto para añadir el siguiente carácter
const KOCH_WINDOW = 5              // grupos recientes que se miran

export const LCWO_DEFAULTS = Object.freeze({
  charWpm: 20,
  effWpm: 10,
  tone: 600,
  minutes: 1,
  groupLength: 5,
  startDelay: 3,
  extraGroupGap: 0,
})

/** ¿Toca ampliar la lección? Mira los últimos grupos copiados. */
export function readyToAdvance(history = [], target = KOCH_TARGET, window = KOCH_WINDOW) {
  if (history.length < window) return false
  const recent = history.slice(-window)
  const media = recent.reduce((a, b) => a + b, 0) / recent.length
  return media >= target
}

// ── Curso LCWO / Koch ──────────────────────────────────────────────────────

/** Caracteres que presenta la lección: K y M en la primera; luego sólo uno. */
export function charsToIntroduce(lesson) {
  const nuevo = newestKochChar(lesson)
  return nuevo ? [nuevo] : kochChars(MIN_LESSON)
}

/**
 * Genera una práctica cronometrada al estilo LCWO. Los grupos contienen sólo
 * caracteres de la lección activa y el texto dura, como mínimo, los minutos
 * pedidos a la velocidad efectiva indicada. El último grupo puede rebasar el
 * tiempo unos segundos para no cortar un grupo a medias.
 */
export function buildKochSession({
  pool = [],
  minutes = LCWO_DEFAULTS.minutes,
  groupLength = LCWO_DEFAULTS.groupLength,
  randomLength = false,
  wpm = LCWO_DEFAULTS.charWpm,
  effWpm = LCWO_DEFAULTS.effWpm,
  extraGroupGap = LCWO_DEFAULTS.extraGroupGap,
  rng = Math.random,
} = {}) {
  const safeMinutes = Math.min(5, Math.max(1, Number(minutes) || LCWO_DEFAULTS.minutes))
  const safeLength = Math.min(7, Math.max(2, Math.round(Number(groupLength) || LCWO_DEFAULTS.groupLength)))
  const targetSeconds = safeMinutes * 60
  const groups = []
  let seconds = 0

  if (!pool.length) return { text: '', groups, seconds, characters: 0, targetSeconds }

  // 5000 grupos es una guarda defensiva muy por encima de cualquier práctica
  // posible con los límites de la interfaz (5 min, 40 PPM).
  while (seconds < targetSeconds && groups.length < 5000) {
    const size = randomLength ? 2 + Math.floor(rng() * 6) : safeLength
    groups.push(randomGroup({ pool, progress: {}, size, rng }))
    seconds = morseTimeline(groups.join(' '), {
      wpm,
      effWpm,
      extraWordGap: extraGroupGap,
    }).duration
  }

  return {
    text: groups.join(' '),
    groups,
    seconds,
    characters: groups.reduce((sum, group) => sum + group.length, 0),
    targetSeconds,
  }
}

function editDistance(left, right) {
  const a = String(left)
  const b = String(right)
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

const practiceGroups = value => String(value)
  .toUpperCase()
  .replace(/;/g, '?')
  .trim()
  .split(/\s+/)
  .filter(Boolean)

const accuracyFrom = (errors, total) => (
  total === 0 ? 0 : Math.max(0, Math.round((1 - Math.min(errors, total) / total) * 1000) / 10)
)

/**
 * Corrige una sesión completa como LCWO: calcula el error grupo a grupo y una
 * distancia de edición global (útil si se omitió un espacio), y conserva la
 * mejor de las dos precisiones. Devuelve también el detalle por grupo y los
 * aciertos por carácter para alimentar el repaso local.
 */
export function gradeKochSession(target, typed) {
  const sent = practiceGroups(target)
  const received = practiceGroups(typed)
  const rows = []
  let groupErrors = 0

  for (let i = 0; i < Math.max(sent.length, received.length); i++) {
    const expected = sent[i] || ''
    const got = received[i] || ''
    const errors = editDistance(expected, got)
    groupErrors += errors
    rows.push({ expected, got, errors })
  }

  const expectedText = sent.join('')
  const receivedText = received.join('')
  const total = expectedText.length
  const sequenceErrors = editDistance(expectedText, receivedText)
  const groupedAccuracy = accuracyFrom(groupErrors, total)
  const sequenceAccuracy = accuracyFrom(sequenceErrors, total)
  const aligned = gradeCopy(expectedText, receivedText)

  return {
    rows,
    total,
    groupErrors,
    sequenceErrors,
    groupedAccuracy,
    sequenceAccuracy,
    accuracy: Math.max(groupedAccuracy, sequenceAccuracy),
    passed: Math.max(groupedAccuracy, sequenceAccuracy) >= KOCH_TARGET,
    characterResults: aligned.cells
      .filter(cell => cell.expected !== null)
      .map(cell => ({ char: cell.expected, ok: cell.ok })),
  }
}

// ── Quiz visual ─────────────────────────────────────────────────────────────

export const VISUAL_MODES = [
  { id: 'mixed',      label: 'Mixto',          hint: 'Alterna los dos sentidos' },
  { id: 'morse2char', label: '·− → carácter',  hint: 'Ves el patrón y eliges el carácter' },
  { id: 'char2morse', label: 'Carácter → ·−',  hint: 'Ves el carácter y eliges el patrón' },
]

const ASKABLE_VISUAL = ['morse2char', 'char2morse']

/**
 * Distractores verosímiles: primero los de la misma longitud, después los
 * parientes de patrón (espejo, inverso y los que comparten principio) y por
 * último cualquiera. Así el fallo enseña algo en vez de ser un descarte obvio.
 */
export function pickCharDistractors(correct, count = 3, pool = MORSE_CHARS, rng = Math.random) {
  const rest = pool.filter(e => e.char !== correct.char)
  if (rest.length <= count) return rest.slice(0, count)

  const len = correct.morse.length
  const parientes = new Set([reverseOf(correct.char), oppositeOf(correct.char)].filter(Boolean))
  const mismoInicio = e => e.morse[0] === correct.morse[0] && Math.abs(e.morse.length - len) <= 1

  const cercanos = shuffle(rest.filter(e => e.morse.length === len || parientes.has(e.char)), rng)
  const medios   = shuffle(rest.filter(e => !cercanos.includes(e) && mismoInicio(e)), rng)
  const lejanos  = shuffle(rest.filter(e => !cercanos.includes(e) && !medios.includes(e)), rng)

  return [...cercanos, ...medios, ...lejanos].slice(0, count)
}

/**
 * Pistas en escalera, con el mismo contrato que el quiz de códigos Q:
 *   1. Estructura — cuántos elementos y con cuál empieza.
 *   2. 50/50 — tacha dos opciones incorrectas.
 *   3. Ritmo — la onomatopeya y el carácter espejo, casi la respuesta.
 * Cada pista trae `eliminate`, las opciones que la interfaz debe tachar.
 */
export function buildVisualHints(entry, options, answer, rng = Math.random) {
  const wrong = shuffle(options.filter(o => o !== answer), rng)
  const espejo = reverseOf(entry.char)
  const inverso = oppositeOf(entry.char)
  // El 50/50 deja siempre dos opciones en pie; con un mazo de dos caracteres
  // no hay nada que tachar y la pista se cae de la escalera.
  const tachables = wrong.slice(0, Math.min(2, wrong.length - 1))
  const parentesco = espejo
    ? ` Su espejo (el mismo patrón del revés) es «${espejo}».`
    : inverso
      ? ` Cambiando puntos por rayas sale «${inverso}».`
      : ''

  return [
    {
      id: 'estructura',
      icon: 'bi-rulers',
      label: 'Estructura',
      text: `Son ${entry.morse.length} elementos y empieza por ${entry.morse[0] === '-' ? 'raya' : 'punto'}.`,
      eliminate: [],
    },
    ...(tachables.length > 0 ? [{
      id: '5050',
      icon: 'bi-scissors',
      label: '50/50',
      text: `Descarto ${tachables.length === 1 ? 'una opción incorrecta' : 'dos opciones incorrectas'}: quedan dos.`,
      eliminate: tachables,
    }] : []),
    {
      id: 'ritmo',
      icon: 'bi-music-note-beamed',
      label: 'Ritmo',
      text: `Suena «${entry.rhythm}».${parentesco}`,
      eliminate: [],
    },
  ]
}

/**
 * Pregunta de cuatro opciones para el quiz visual.
 *   pool        — caracteres entre los que se sortea (el mazo activo)
 *   mode        — 'mixed' | 'morse2char' | 'char2morse'
 *   excludeChar — carácter a evitar (el de la pregunta anterior)
 *   progress    — cajas de Leitner para el sorteo ponderado
 * Devuelve { entry, mode, prompt, options, answer, hints }.
 */
export function buildVisualQuestion({
  pool = MORSE_CHARS,
  mode = 'mixed',
  excludeChar = null,
  progress = {},
  rng = Math.random,
} = {}) {
  const candidates = pool.length > 1 ? pool.filter(e => e.char !== excludeChar) : pool
  const entry = pickWeighted(candidates, progress, rng, e => e.char)

  const resolved = mode === 'mixed'
    ? ASKABLE_VISUAL[Math.floor(rng() * ASKABLE_VISUAL.length)]
    : mode

  // Nunca se ofrecen caracteres fuera del mazo: en la lección 1 de Koch la
  // pregunta sale con dos opciones en vez de con cuatro.
  const distractors = pickCharDistractors(entry, 3, pool, rng)

  if (resolved === 'char2morse') {
    const options = shuffle([entry.morse, ...distractors.map(d => d.morse)], rng)
    return {
      entry,
      mode: resolved,
      prompt: `¿Cuál es el patrón de «${entry.char}»?`,
      options,
      answer: entry.morse,
      hints: buildVisualHints(entry, options, entry.morse, rng),
    }
  }

  const options = shuffle([entry.char, ...distractors.map(d => d.char)], rng)
  return {
    entry,
    mode: resolved,
    prompt: '¿Qué carácter es este patrón?',
    options,
    answer: entry.char,
    hints: buildVisualHints(entry, options, entry.char, rng),
  }
}

/** Recuento de dominio sobre un conjunto de caracteres. */
export function charMasterySummary(pool = MORSE_CHARS, progress = {}) {
  return summarize(pool, progress, e => e.char)
}

/** Patrón de un carácter o prosigno, para la interfaz. */
export { symbolsFor }
