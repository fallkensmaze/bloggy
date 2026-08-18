// ── Morse ───────────────────────────────────────────────────────────────────
// Tabla, codificación, temporización (PARIS + Farnsworth) y audio CW.
// Lo usan /q-codes (escuchar un código suelto) y /morse (entrenador completo).
// No depende de React; del DOM sólo toca AudioContext.

// Sólo caracteres de un símbolo: `morseOf` recorre el texto letra a letra.
export const MORSE_TABLE = {
  A: '.-',    B: '-...',  C: '-.-.',  D: '-..',   E: '.',     F: '..-.',
  G: '--.',   H: '....',  I: '..',    J: '.---',  K: '-.-',   L: '.-..',
  M: '--',    N: '-.',    O: '---',   P: '.--.',  Q: '--.-',  R: '.-.',
  S: '...',   T: '-',     U: '..-',   V: '...-',  W: '.--',   X: '-..-',
  Y: '-.--',  Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-',  ',': '--..--',  '?': '..--..',  "'": '.----.',
  '!': '-.-.--',  '/': '-..-.',   '(': '-.--.',   ')': '-.--.-',
  '&': '.-...',   ':': '---...',  ';': '-.-.-.',  '=': '-...-',
  '+': '.-.-.',   '-': '-....-',  '_': '..--.-',  '"': '.-..-.',
  $: '...-..-',   '@': '.--.-.',
}

// Prosignos: se escriben entre ángulos y suenan como una sola letra larga, sin
// separación interna. Varios comparten patrón con un signo de puntuación
// (AR = «+», BT = «=»); en ese caso el decodificador devuelve el signo.
export const PROSIGNS = {
  AR:  { morse: '.-.-.',     label: 'Fin del mensaje',             alt: '+' },
  BT:  { morse: '-...-',     label: 'Separador de párrafo',        alt: '=' },
  KN:  { morse: '-.--.',     label: 'Adelante, sólo tú',           alt: '(' },
  AS:  { morse: '.-...',     label: 'Espera',                      alt: '&' },
  SK:  { morse: '...-.-',    label: 'Fin del contacto',            alt: null },
  BK:  { morse: '-...-.-',   label: 'Corte, te devuelvo la palabra', alt: null },
  HH:  { morse: '........',  label: 'Error: repito la palabra',    alt: null },
  SOS: { morse: '...---...', label: 'Socorro',                     alt: null },
}

export const LETTERS = Object.keys(MORSE_TABLE).filter(c => /[A-Z]/.test(c))
export const DIGITS  = Object.keys(MORSE_TABLE).filter(c => /[0-9]/.test(c))
export const PUNCT   = Object.keys(MORSE_TABLE).filter(c => !/[A-Z0-9]/.test(c))

/** Patrón → carácter. La puntuación gana a los prosignos que la comparten. */
export const REVERSE_TABLE = (() => {
  const out = {}
  for (const [char, morse] of Object.entries(MORSE_TABLE)) out[morse] = char
  for (const [name, p] of Object.entries(PROSIGNS)) {
    if (!out[p.morse]) out[p.morse] = `<${name}>`
  }
  return out
})()

// ── Codificación ────────────────────────────────────────────────────────────

/** Patrón de un token: un carácter suelto o el nombre de un prosigno. */
export function symbolsFor(token) {
  if (!token) return null
  const t = String(token).toUpperCase()
  return MORSE_TABLE[t] || PROSIGNS[t]?.morse || null
}

/**
 * Parte una palabra en tokens reconocibles: caracteres sueltos y prosignos
 * escritos entre ángulos. Lo que no está en la tabla se descarta.
 */
export function tokenize(word) {
  const out = []
  const src = String(word).toUpperCase()
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '<') {
      const close = src.indexOf('>', i)
      const name = close > i ? src.slice(i + 1, close) : ''
      if (PROSIGNS[name]) { out.push(name); i = close; continue }
    }
    if (MORSE_TABLE[src[i]]) out.push(src[i])
  }
  return out
}

/** Representación en puntos y rayas: morseOf('QRM') → '--.-  .-.  --' */
export function morseOf(text) {
  return tokenize(text).map(symbolsFor).filter(Boolean).join('  ')
}

/** Puntos y rayas con glifos legibles a tamaño grande: '.-' → '·–' */
export function prettyMorse(morse) {
  return String(morse).replace(/\./g, '·').replace(/-/g, '–')
}

/** Texto → Morse con separadores explícitos: 'CQ DE' → '-.-. --.- / -.. .' */
export function textToMorse(text, { charSep = ' ', wordSep = ' / ' } = {}) {
  return String(text)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => tokenize(word).map(symbolsFor).filter(Boolean).join(charSep))
    .filter(Boolean)
    .join(wordSep)
}

/**
 * Morse → texto. Acepta las notaciones habituales de punto y raya, un espacio
 * entre letras y una barra (o tres espacios) entre palabras. Los patrones que
 * no existen se marcan con almohadilla.
 */
export function morseToText(morse) {
  return String(morse)
    .replace(/[·•]/g, '.')
    .replace(/[−–—_]/g, '-')
    .trim()
    .split(/\s*\/\s*|\s{3,}/)
    .map(word => word
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(sym => REVERSE_TABLE[sym] || '#')
      .join(''))
    .filter(Boolean)
    .join(' ')
}

// ── Ayudas de estudio ───────────────────────────────────────────────────────

/** Onomatopeya estándar: '.-.' → 'di-dah-dit' (el punto final es «dit»). */
export function rhythmOf(morse) {
  const syms = String(morse).split('')
  return syms
    .map((s, i) => (s === '-' ? 'dah' : i === syms.length - 1 ? 'dit' : 'di'))
    .join('-')
}

/** Carácter cuyo patrón es el de `char` leído del revés (A ·− ↔ N −·). */
export function reverseOf(char) {
  const morse = symbolsFor(char)
  if (!morse) return null
  const other = REVERSE_TABLE[morse.split('').reverse().join('')]
  return other && other !== String(char).toUpperCase() ? other : null
}

/** Carácter cuyo patrón intercambia puntos y rayas (U ··− ↔ D −··). */
export function oppositeOf(char) {
  const morse = symbolsFor(char)
  if (!morse) return null
  const flipped = morse.split('').map(s => (s === '.' ? '-' : '.')).join('')
  const other = REVERSE_TABLE[flipped]
  return other && other !== String(char).toUpperCase() ? other : null
}

// ── Temporización ───────────────────────────────────────────────────────────

/** Duración del punto en segundos para una velocidad PARIS. */
export function unitSeconds(wpm) {
  return 1.2 / Math.max(1, wpm)
}

/**
 * Separaciones con temporización Farnsworth: los caracteres se envían a
 * `charWpm` pero se estiran los silencios hasta que el texto completo salga a
 * `effWpm`. Fórmula de la ARRL: el retardo extra se reparte 3:7 entre la
 * separación de caracteres y la de palabras. Con effWpm ≥ charWpm salen las
 * separaciones estándar de 3 y 7 puntos.
 */
export function farnsworthGaps(charWpm, effWpm = charWpm) {
  const unit = unitSeconds(charWpm)
  if (!(effWpm > 0) || effWpm >= charWpm) {
    return { unit, charGap: 3 * unit, wordGap: 7 * unit }
  }
  const ta = (60 * charWpm - 37.2 * effWpm) / (charWpm * effWpm)
  return { unit, charGap: (3 * ta) / 19, wordGap: (7 * ta) / 19 }
}

/**
 * Calendario de tonos de un texto, en segundos desde el inicio.
 * Devuelve { events: [{ start, dur, symbol, char, index }], duration, unit }.
 * `index` es la posición del carácter dentro del texto ya tokenizado, para que
 * la interfaz pueda resaltar lo que está sonando.
 */
export function morseTimeline(text, { wpm = 16, effWpm = wpm } = {}) {
  const { unit, charGap, wordGap } = farnsworthGaps(wpm, effWpm)
  const events = []
  let t = 0
  let index = -1

  const words = String(text).toUpperCase().trim().split(/\s+/).filter(Boolean)
  words.forEach((word) => {
    const tokens = tokenize(word)
    if (tokens.length === 0) return
    if (index >= 0) t += wordGap          // no hay hueco antes del primer sonido
    tokens.forEach((token, ti) => {
      if (ti > 0) t += charGap
      index++
      symbolsFor(token).split('').forEach((s, si) => {
        if (si > 0) t += unit
        const dur = (s === '-' ? 3 : 1) * unit
        events.push({ start: t, dur, symbol: s, char: token, index })
        t += dur
      })
    })
  })

  return { events, duration: t, unit }
}

// ── Audio ───────────────────────────────────────────────────────────────────

let audioCtx = null

function getContext() {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  if (!audioCtx) audioCtx = new Ctor()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

export function morseSupported() {
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext)
}

/** Despierta el contexto de audio desde un gesto del usuario. */
export function resumeAudio() {
  getContext()
}

const RAMP = 0.004   // rampas cortas para evitar los clics de conmutación

/**
 * Reproduce `text` en CW con una senoide.
 *   wpm      — velocidad de carácter (PARIS): punto = 1.2 / wpm segundos
 *   effWpm   — velocidad efectiva Farnsworth (por defecto, la misma)
 *   freq     — tono en Hz
 *   onSymbol — ({ on, char, index }) para iluminar lo que suena
 *   onEnd    — al terminar
 * Devuelve una función para cortar la reproducción antes de tiempo.
 */
export function playMorse(text, { wpm = 16, effWpm, freq = 650, volume = 0.18, onSymbol, onEnd } = {}) {
  const ctx = getContext()
  const { events, duration } = morseTimeline(text, { wpm, effWpm: effWpm ?? wpm })

  if (!ctx || events.length === 0) {
    // Sin audio no suena nada, pero el llamante sigue esperando su aviso.
    const id = setTimeout(() => onEnd && onEnd(), 0)
    return () => clearTimeout(id)
  }

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, ctx.currentTime)
  gain.connect(ctx.destination)

  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  osc.connect(gain)

  const t0 = ctx.currentTime + 0.06
  for (const ev of events) {
    const on = t0 + ev.start
    const off = on + ev.dur
    gain.gain.setValueAtTime(0, on)
    gain.gain.linearRampToValueAtTime(volume, on + RAMP)
    gain.gain.setValueAtTime(volume, off - RAMP)
    gain.gain.linearRampToValueAtTime(0, off)
  }

  // El resalte visual va por temporizadores aparte: los grupos de práctica son
  // cortos, así que no compensa sincronizarlo con el reloj del contexto.
  const timers = []
  if (onSymbol) {
    for (const ev of events) {
      const mark = (on, delay) => timers.push(setTimeout(
        () => onSymbol({ on, char: ev.char, index: ev.index, symbol: ev.symbol }),
        delay * 1000,
      ))
      mark(true, 0.06 + ev.start)
      mark(false, 0.06 + ev.start + ev.dur)
    }
  }

  let notify = true
  osc.onended = () => {
    gain.disconnect()
    timers.forEach(clearTimeout)
    if (notify && onEnd) onEnd()
  }
  osc.start()
  osc.stop(t0 + duration + 0.05)

  return () => {
    notify = false
    timers.forEach(clearTimeout)
    if (onSymbol) onSymbol({ on: false, char: null, index: -1, symbol: null })
    try { osc.stop() } catch { /* ya parado */ }
  }
}

/**
 * Tono continuo controlable para el manipulador: `down()` lo abre y `up()` lo
 * cierra con las mismas rampas que la reproducción. Devuelve null si el
 * navegador no trae Web Audio.
 */
export function createSidetone({ freq = 650, volume = 0.18 } = {}) {
  const ctx = getContext()
  if (!ctx) return null

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, ctx.currentTime)
  gain.connect(ctx.destination)

  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  osc.connect(gain)
  osc.start()

  const ramp = (to) => {
    const t = ctx.currentTime
    gain.gain.cancelScheduledValues(t)
    gain.gain.setValueAtTime(gain.gain.value, t)
    gain.gain.linearRampToValueAtTime(to, t + RAMP)
  }

  return {
    down: () => ramp(volume),
    up:   () => ramp(0),
    setFreq: (f) => { osc.frequency.value = f },
    close: () => {
      ramp(0)
      try { osc.stop(ctx.currentTime + 0.05) } catch { /* ya parado */ }
      setTimeout(() => gain.disconnect(), 100)
    },
  }
}

// ── Manipulador recto ───────────────────────────────────────────────────────
// Umbrales clásicos sobre la duración del punto: un elemento es raya a partir
// de 2 puntos; un silencio separa caracteres a partir de 2 y palabras a partir
// de 5. Ambas funciones trabajan en milisegundos.

export function classifyPress(ms, unitMs) {
  return ms >= unitMs * 2 ? '-' : '.'
}

export function classifyGap(ms, unitMs) {
  if (ms < unitMs * 2) return 'symbol'
  if (ms < unitMs * 5) return 'char'
  return 'word'
}
