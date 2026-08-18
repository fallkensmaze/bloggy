// ── Repetición espaciada (cajas de Leitner) ─────────────────────────────────
// Lógica pura compartida por los entrenadores de /q-codes y /morse.
//
// El progreso es un objeto plano { [key]: { box, correct, wrong, seen } } que
// se serializa tal cual en localStorage. `key` es la unidad que se estudia: el
// código Q en /q-codes y el carácter en /morse.
//
// box 0…MAX_BOX: cuanto más alto, mejor dominado y menos veces vuelve a salir.

export const MAX_BOX = 4
const BOX_WEIGHTS = [10, 6, 4, 2, 1]   // peso de sorteo por caja
const NEW_WEIGHT  = 7                  // ítem nunca visto

/** Clave por defecto: los catálogos usan `code`, pero puede ser cualquiera. */
const defaultKeyOf = item => (typeof item === 'string' ? item : item.code)

/** Fisher-Yates sobre una copia; no muta el array original. */
export function shuffle(arr, rng = Math.random) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function weightOfKey(key, progress = {}) {
  const rec = progress[key]
  if (!rec) return NEW_WEIGHT
  return BOX_WEIGHTS[Math.min(rec.box ?? 0, MAX_BOX)]
}

/** Sorteo ponderado: los ítems flojos salen más. */
export function pickWeighted(pool, progress = {}, rng = Math.random, keyOf = defaultKeyOf) {
  const total = pool.reduce((acc, item) => acc + weightOfKey(keyOf(item), progress), 0)
  let t = rng() * total
  for (const item of pool) {
    t -= weightOfKey(keyOf(item), progress)
    if (t <= 0) return item
  }
  return pool[pool.length - 1]
}

/**
 * Actualiza el progreso de un ítem tras responder.
 *   ok     — si acertó
 *   hinted — si usó alguna pista (acierta, pero no promociona de caja)
 */
export function updateProgress(progress, key, ok, hinted = false) {
  const prev = progress[key] || { box: 0, correct: 0, wrong: 0, seen: 0 }
  const box = !ok ? 0
    : hinted ? prev.box
    : Math.min(prev.box + 1, MAX_BOX)
  return {
    ...progress,
    [key]: {
      box,
      correct: prev.correct + (ok ? 1 : 0),
      wrong:   prev.wrong + (ok ? 0 : 1),
      seen:    prev.seen + 1,
    },
  }
}

export const MASTERY = {
  nuevo:    { label: 'Sin ver',     color: 'var(--text-muted)' },
  flojo:    { label: 'Flojo',       color: 'var(--accent-red)' },
  progreso: { label: 'En progreso', color: 'var(--accent-orange)' },
  dominado: { label: 'Dominado',    color: 'var(--accent-green)' },
}

export function masteryOf(key, progress = {}) {
  const rec = progress[key]
  if (!rec || rec.seen === 0) return 'nuevo'
  if (rec.box <= 1) return 'flojo'
  if (rec.box < MAX_BOX) return 'progreso'
  return 'dominado'
}

/** Recuento por nivel de dominio sobre un conjunto de ítems. */
export function masterySummary(pool = [], progress = {}, keyOf = defaultKeyOf) {
  const out = { nuevo: 0, flojo: 0, progreso: 0, dominado: 0, total: pool.length }
  for (const item of pool) out[masteryOf(keyOf(item), progress)]++
  return out
}

/** Porcentaje de aciertos (0–100) a partir de { correct, wrong }. */
export function accuracy(stats) {
  const total = stats.correct + stats.wrong
  return total === 0 ? 0 : Math.round((stats.correct / total) * 100)
}
