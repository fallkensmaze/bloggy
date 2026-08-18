// ── Ajustes en localStorage ─────────────────────────────────────────────────
// Lecturas tolerantes para las preferencias de las páginas: si el valor no
// existe, no es válido o el navegador bloquea el almacenamiento, se devuelve el
// de reserva en lugar de romper el arranque de la página.

export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch { return fallback }
}

/** Valor sólo si está en la lista de opciones admitidas. */
export function readChoice(key, valid, fallback) {
  try {
    const v = localStorage.getItem(key)
    return valid.includes(v) ? v : fallback
  } catch { return fallback }
}

/**
 * Número recortado al intervalo [min, max].
 *
 * La clave ausente se comprueba antes de convertir: `Number(null)` es 0, y 0 es
 * finito, así que sin esta guarda la primera visita se quedaba con el mínimo del
 * intervalo en lugar del valor por defecto.
 */
export function readNumber(key, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null || String(raw).trim() === '') return fallback
    const n = Number(raw)
    if (!Number.isFinite(n)) return fallback
    return Math.min(Math.max(n, min), max)
  } catch { return fallback }
}

export function writeValue(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  } catch { /* modo privado o cuota llena: los ajustes no se guardan */ }
}
