// Declared barrier shielding. Data only: the current evaluation is unshielded
// and never reads these layers, so nothing here may imply an attenuation.
export const SHIELDING_MATERIALS = Object.freeze([
  { id: 'lead', label: 'Plomo', short: 'Pb' },
  { id: 'concrete', label: 'Hormigón', short: 'Hormigón' },
  { id: 'brick', label: 'Ladrillo', short: 'Ladrillo' },
  { id: 'gypsum', label: 'Yeso laminado', short: 'Yeso' },
  { id: 'steel', label: 'Acero', short: 'Acero' },
  { id: 'leaded-glass', label: 'Vidrio plomado', short: 'Vidrio Pb' },
  { id: 'other', label: 'Otro material', short: 'Otro' },
].map(Object.freeze))

export const getShieldingMaterial = id => SHIELDING_MATERIALS.find(material => material.id === id)

// Thickness starts blank: the tool never assumes a barrier's construction.
export const newShieldingLayer = (id, { material = 'lead', thickness_mm = '', groupId } = {}) =>
  ({ id, material, thickness_mm, ...(groupId ? { groupId } : {}) })

const validThickness = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) > 0

export function shieldingSummary(layers = []) {
  if (!layers.length) return ''
  return layers.map(layer => {
    const name = getShieldingMaterial(layer.material)?.short ?? 'Material'
    return validThickness(layer.thickness_mm)
      ? `${name} ${Number(layer.thickness_mm).toLocaleString('es-ES', { maximumFractionDigits: 2 })} mm`
      : `${name} · espesor pendiente`
  }).join(' + ')
}

const mapWalls = (scene, predicate, update) =>
  ({ ...scene, walls: scene.walls.map(wall => predicate(wall) ? update(wall) : wall) })

/** Adds one layer to every listed wall. `makeId` gives each copy its own id;
 * a shared `groupId` lets a room edit the layer it added to all its walls. */
export function addShieldingLayer(scene, wallIds, layer, makeId) {
  const ids = new Set(wallIds)
  return mapWalls(scene, wall => ids.has(wall.id), wall =>
    ({ ...wall, shielding: [...(wall.shielding || []), newShieldingLayer(makeId(), layer)] }))
}

/** A per-wall edit detaches the layer from its room group, so a later room-wide
 * edit cannot overwrite a value the user changed on that wall. */
export function updateShieldingLayer(scene, wallId, layerId, patch) {
  return mapWalls(scene, wall => wall.id === wallId, wall => ({ ...wall,
    shielding: (wall.shielding || []).map(layer => {
      if (layer.id !== layerId) return layer
      const { groupId: _detached, ...rest } = layer
      return { ...rest, ...patch }
    }) }))
}

export const removeShieldingLayer = (scene, wallId, layerId) =>
  mapWalls(scene, wall => wall.id === wallId, wall =>
    ({ ...wall, shielding: (wall.shielding || []).filter(layer => layer.id !== layerId) }))

export const updateShieldingGroup = (scene, groupId, patch) =>
  mapWalls(scene, wall => (wall.shielding || []).some(layer => layer.groupId === groupId), wall =>
    ({ ...wall, shielding: wall.shielding.map(layer => layer.groupId === groupId ? { ...layer, ...patch } : layer) }))

export const removeShieldingGroup = (scene, groupId) =>
  mapWalls(scene, wall => (wall.shielding || []).some(layer => layer.groupId === groupId), wall =>
    ({ ...wall, shielding: wall.shielding.filter(layer => layer.groupId !== groupId) }))

/** Room-wide layers still shared by at least one of the room's walls. */
export function roomShieldingGroups(scene, roomId) {
  const walls = scene.walls.filter(wall => wall.roomId === roomId)
  const groups = new Map()
  for (const wall of walls) for (const layer of wall.shielding || []) {
    if (!layer.groupId) continue
    const group = groups.get(layer.groupId) || { groupId: layer.groupId, layer, wallCount: 0 }
    group.wallCount++
    groups.set(layer.groupId, group)
  }
  return { wallCount: walls.length, groups: [...groups.values()] }
}

export const shieldedWallCount = scene => scene.walls.filter(wall => wall.shielding?.length).length
