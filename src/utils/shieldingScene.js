// The workspace has no persistence. History contains immutable in-memory scenes only.
const COLLECTIONS = { wall: 'walls', room: 'rooms', point: 'points', configuration: 'configurations' }
export const emptyScene = () => ({ name: 'Mi sala de rayos X', calibrated: true, background: null, rooms: [], walls: [], configurations: [], points: [], csnTotalWorkload: '' })
export const newHistory = scene => ({ past: [], present: scene, future: [] })
export const commitScene = (history, scene) => scene === history.present ? history : ({ past: [...history.past, history.present].slice(-80), present: scene, future: [] })
export const undoScene = history => !history.past.length ? history : ({ past: history.past.slice(0, -1), present: history.past.at(-1), future: [history.present, ...history.future] })
export const redoScene = history => !history.future.length ? history : ({ past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) })
export function updateEntity(scene, type, id, patch) {
  const key = COLLECTIONS[type]
  if (!key) return scene
  return { ...scene, [key]: scene[key].map(entity => entity.id === id ? { ...entity, ...patch } : entity) }
}
export function removeEntity(scene, type, id) {
  const key = COLLECTIONS[type]
  return key ? { ...scene, [key]: scene[key].filter(entity => entity.id !== id) } : scene
}
export function scaleScene(scene, factor) {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('La escala debe ser positiva y finita.')
  const scale = value => {
    const result = value * factor
    if (!Number.isFinite(result) || (value !== 0 && result === 0)) throw new Error('La escala debe producir medidas finitas y representables.')
    return result
  }
  const scaled = p => p ? { ...p, x: scale(p.x), y: scale(p.y) } : p
  return { ...scene, calibrated: true,
    background: scene.background && { ...scene.background, width: scale(scene.background.width), height: scale(scene.background.height) },
    walls: scene.walls.map(w => ({ ...w, start: scaled(w.start), end: scaled(w.end) })),
    rooms: scene.rooms.map(r => ({ ...r, vertices: r.vertices.map(scaled) })),
    points: scene.points.map(scaled),
    configurations: scene.configurations.map(c => ({ ...c, source: scaled(c.source), target: scaled(c.target), patient: scaled(c.patient) })),
  }
}
