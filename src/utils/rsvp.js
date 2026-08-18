/**
 * rsvp.js — Pure logic for Rapid Serial Visual Presentation.
 * No DOM dependencies; all functions are independently testable.
 */

/**
 * Tokenize text into an array of token objects.
 * Each token: { word: string, isParagraphStart: boolean }
 *
 * Paragraphs are separated by one or more blank lines.
 * Punctuation stays attached to its word ("hola," is one token).
 * Empty tokens (from multiple spaces) are discarded.
 */
export function tokenize(text) {
  const paragraphs = text.split(/\n[ \t]*\n/)
  const tokens = []

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const words = paragraphs[pi]
      .trim()
      .split(/[ \t\n]+/)
      .filter(w => w.length > 0)

    for (let wi = 0; wi < words.length; wi++) {
      tokens.push({
        word: words[wi],
        // First word of every paragraph (except the first) gets an extra pause
        isParagraphStart: wi === 0 && pi > 0,
      })
    }
  }

  return tokens
}

/**
 * Return the ORP (Optimal Recognition Point) index for a word.
 *
 * The ORP is the letter the eye naturally fixates on first when scanning
 * a word. Aligning it to a fixed focal point eliminates left-right saccades
 * and lets the brain process words without eye movement.
 *
 * Formula (empirically derived):
 *   len = 1    → index 0
 *   len 2–5   → index 1
 *   len 6–9   → index 2
 *   len 10–13 → index 3
 *   len ≥ 14  → index 4
 */
export function getORPIndex(word) {
  const n = word.length
  if (n === 1) return 0
  if (n <= 5)  return 1
  if (n <= 9)  return 2
  if (n <= 13) return 3
  return 4
}

/**
 * Calculate display delay in milliseconds for a token at a given wpm.
 *
 * Multipliers (all cumulative — they stack):
 *   Paragraph start:       ×1.5   (reader must shift mental context)
 *   Word length ≥ 8 chars: ×1.4   (longer words need more processing time)
 *   Ends in , ; :          ×1.8   (clause boundary — brief pause)
 *   Ends in . ? !          ×2.3   (sentence end — longer pause)
 */
export function getWordDelay(token, wpm) {
  const baseMs = 60000 / wpm
  let mult = 1.0

  if (token.isParagraphStart) mult *= 1.5
  if (token.word.length >= 8) mult *= 1.4

  const last = token.word[token.word.length - 1]
  if ('.?!'.includes(last))  mult *= 2.3
  else if (',;:'.includes(last)) mult *= 1.8

  return Math.round(baseMs * mult)
}

/**
 * Generate a stable hash string for a file, used as a localStorage key.
 * Combines filename, byte size, and first 200 characters of content.
 * djb2-style XOR hash converted to base-36 for compact keys.
 */
export function fileHash(name, size, firstChars) {
  let h = 5381
  const s = `${name}|${size}|${firstChars}`
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
    h = h >>> 0 // keep as unsigned 32-bit
  }
  return h.toString(36)
}

/** Estimate remaining reading time in whole seconds from currentIndex to end. */
export function estimateRemainingSeconds(tokens, currentIndex, wpm) {
  const remaining = Math.max(0, tokens.length - currentIndex)
  return Math.round((remaining / wpm) * 60)
}

/** Format seconds as "Xm Ys" or "Ys". */
export function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s < 10 ? '0' + s : s}s`
}
