// Progreso propio de Morse. No cambia el Leitner del entrenador de códigos Q.
import { MORSE_TABLE } from './morse.js'

export const LEARNING_KEY = 'morse_learning_v2'
export const DAY = 86400000
export const EMPTY_STATS = { correct: 0, wrong: 0, hinted: 0, streak: 0, best: 0 }
export const SKILLS = { reception: 'Recepción', transmission: 'Transmisión', visual: 'Reconocimiento visual' }
export const MORSE_MASTERY = {
  nuevo: { label: 'Sin practicar', color: 'var(--text-muted)' },
  flojo: { label: 'Repasar', color: 'var(--accent-red)' },
  progreso: { label: 'En progreso', color: 'var(--accent-orange)' },
  dominado: { label: 'Consolidado', color: 'var(--accent-green)' },
}

export function emptyLearning() {
  return { version: 2, skills: Object.fromEntries(Object.keys(SKILLS).map(skill => [skill, { stats: { ...EMPTY_STATS }, progress: {} }])) }
}

export function readLearning(value) {
  const fresh = emptyLearning()
  if (value?.version !== 2 || !value.skills) return fresh
  for (const skill of Object.keys(SKILLS)) {
    const saved = value.skills[skill]
    if (!saved || typeof saved.progress !== 'object' || Array.isArray(saved.progress) || !saved.progress) continue
    fresh.skills[skill] = { stats: { ...EMPTY_STATS, ...saved.stats }, progress: saved.progress }
  }
  return fresh
}

/** Un envío completo se registra una sola vez. Todas las apariciones de una
 * letra cuentan para su precisión; su calendario se actualiza una vez por envío.
 * Una inserción penaliza la nota sin inventar una letra objetivo fallada. */
export function recordAttempt(state, skill, results, { assisted = false, now = Date.now() } = {}) {
  if (!SKILLS[skill] || !results?.length) return state
  const current = state.skills[skill]
  const progress = { ...current.progress }
  const stats = { ...current.stats }
  const grouped = new Map()
  for (const r of results) {
    const hinted = assisted || !!r.hinted
    if (r.ok) {
      stats.correct++
      if (hinted) stats.hinted++
      else stats.streak++
    } else { stats.wrong++; stats.streak = 0 }
    stats.best = Math.max(stats.best, stats.streak)
    if (!Object.hasOwn(MORSE_TABLE, r.char)) continue
    if (!grouped.has(r.char)) grouped.set(r.char, [])
    grouped.get(r.char).push({ ...r, hinted })
  }
  for (const [char, entries] of grouped) {
    const prev = progress[char] || { correct: 0, wrong: 0, seen: 0, box: 0, reviewDays: 0, confusions: {} }
    const correct = entries.filter(r => r.ok).length
    const wrong = entries.length - correct
    const unassisted = entries.every(r => !r.hinted)
    const day = Math.floor(now / DAY)
    const eligible = !wrong && unassisted && prev.lastSuccessDay !== day && (!prev.dueAt || now >= prev.dueAt)
    const reviewDays = wrong ? 0 : eligible ? (prev.reviewDays || 0) + 1 : (prev.reviewDays || 0)
    const confusions = { ...prev.confusions }
    for (const r of entries) {
      if (!r.ok && r.got && r.got !== char && Object.hasOwn(MORSE_TABLE, r.got)) {
        confusions[r.got] = (confusions[r.got] || 0) + 1
      }
    }
    progress[char] = {
      ...prev, correct: prev.correct + correct, wrong: prev.wrong + wrong, seen: prev.seen + entries.length,
      reviewDays, box: Math.min(reviewDays, 4), confusions, lastReviewed: now,
      lastSuccessDay: eligible ? day : prev.lastSuccessDay,
      dueAt: wrong ? now + 10 * 60000 : eligible ? now + DAY * [1, 3, 7, 14, 30][Math.min(reviewDays - 1, 4)] : (prev.dueAt || now),
      needsReview: wrong > 0 || (!unassisted && !!prev.needsReview),
    }
  }
  return { ...state, skills: { ...state.skills, [skill]: { stats, progress } } }
}

export function morseMastery(char, progress = {}, now = Date.now()) {
  const rec = progress[char]
  if (!rec?.seen) return 'nuevo'
  if (rec.needsReview || rec.dueAt <= now) return 'flojo'
  return rec.reviewDays >= 3 ? 'dominado' : 'progreso'
}

export function morseSummary(pool, progress = {}, now = Date.now()) {
  const out = { nuevo: 0, flojo: 0, progreso: 0, dominado: 0, total: pool.length }
  for (const item of pool) out[morseMastery(item.char, progress, now)]++
  return out
}

export function reviewCandidates(pool, progress = {}, now = Date.now()) {
  return pool.filter(e => progress[e.char]?.seen && (progress[e.char].needsReview || progress[e.char].dueAt <= now))
}

/** Refuerzo de un carácter débil y su confusión más frecuente, intercalado con
 * letras del mazo. No añade letras desconocidas ni revela qué va a sonar. */
export function buildReviewDrill({ pool, progress = {}, now = Date.now(), rng = Math.random }) {
  const weak = reviewCandidates(pool, progress, now)
  if (!weak.length) return null
  const focus = weak[Math.floor(rng() * weak.length)]
  const confusion = Object.entries(progress[focus.char]?.confusions || {})
    .filter(([char]) => pool.some(e => e.char === char))
    .sort((a, b) => b[1] - a[1])[0]?.[0]
  const text = Array.from({ length: 5 }, () => {
    const p = rng()
    return p < 0.4 ? focus.char : p < 0.7 && confusion ? confusion : pool[Math.floor(rng() * pool.length)].char
  })
  // Garantizar práctica del carácter elegido en una posición aleatoria.
  text[Math.floor(rng() * text.length)] = focus.char
  return { text: text.join(''), meaning: null, focus: focus.char, confusion }
}

export function courseReady(attempts, settings) {
  const recent = attempts.filter(a => a.version === 2 && a.lesson === settings.lesson &&
    a.charWpm === settings.charWpm && a.effWpm === settings.effWpm &&
    a.minutes === settings.minutes && a.groupMode === settings.groupMode &&
    a.extraGroupGap === settings.extraGroupGap && !a.assisted).slice(-3)
  return recent.length === 3 && new Set(recent.map(a => a.sessionId)).size === 3 &&
    recent.every(a => a.completed && a.accuracy >= 90 && a.newCharTotal >= 3 && a.newCharAccuracy >= 90)
}
