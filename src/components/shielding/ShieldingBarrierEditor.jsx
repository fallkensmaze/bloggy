import { SHIELDING_MATERIALS } from '../../utils/shieldingBarriers'

const icon = name => <i className={`bi bi-${name}`} aria-hidden="true" />
const NOT_APPLIED = 'Blindaje declarado: se muestra en el plano, pero el cálculo actual todavía no lo atenúa.'

export function ShieldingLayerFields({ layer, context, onChange, onRemove }) {
  return <div className="sh-layer">
    <label className="sh-field"><span>Material</span>
      <select aria-label={`Material · ${context}`} value={layer.material} onChange={e => onChange({ material: e.target.value })}>
        {SHIELDING_MATERIALS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    </label>
    <label className="sh-field"><span>Espesor (mm)</span>
      <input aria-label={`Espesor (mm) · ${context}`} type="number" min="0" step="any" inputMode="decimal"
        placeholder="Sin definir" value={layer.thickness_mm ?? ''} onChange={e => onChange({ thickness_mm: e.target.value })} />
    </label>
    {onRemove && <button type="button" className="sh-layer-remove" aria-label={`Quitar capa · ${context}`} title="Quitar capa" onClick={onRemove}>{icon('x-lg')}</button>}
  </div>
}

export function WallShielding({ wall, onAdd, onUpdate, onRemove }) {
  const layers = wall.shielding || []
  return <div className="sh-shielding">
    <div className="sh-card-heading"><h4>{icon('shield-shaded')} Blindaje</h4>
      <button type="button" className="sh-add-shielding" onClick={onAdd}>{icon('plus-lg')} Añadir blindaje</button></div>
    {!layers.length && <p className="sh-help">Sin blindaje declarado. Puedes apilar varias capas (por ejemplo, yeso + plomo).</p>}
    {layers.map((layer, index) => <div key={layer.id}>
      {layer.groupId && <small className="sh-layer-origin">Añadida desde la sala · editarla aquí la separa del resto</small>}
      <ShieldingLayerFields layer={layer} context={`${wall.name} · capa ${index + 1}`}
        onChange={patch => onUpdate(layer.id, patch)} onRemove={() => onRemove(layer.id)} />
    </div>)}
    {layers.length > 0 && <p className="sh-help">{NOT_APPLIED}</p>}
  </div>
}

export function RoomShielding({ room, summary, walls, onAdd, onUpdateGroup, onRemoveGroup, onSelectWall, describe }) {
  return <div className="sh-shielding">
    <div className="sh-card-heading"><h4>{icon('shield-shaded')} Blindaje de la sala</h4>
      <button type="button" className="sh-add-shielding" disabled={!summary.wallCount} onClick={onAdd}>{icon('plus-lg')} Añadir blindaje</button></div>
    <p className="sh-help">Se añade a sus {summary.wallCount} paredes. Después puedes cambiar una pared concreta sin afectar al resto.</p>
    {summary.groups.map((group, index) => <div key={group.groupId}>
      <small className="sh-layer-origin">En {group.wallCount} de {summary.wallCount} paredes</small>
      <ShieldingLayerFields layer={group.layer} context={`${room.name} · capa ${index + 1}`}
        onChange={patch => onUpdateGroup(group.groupId, patch)} onRemove={() => onRemoveGroup(group.groupId)} />
    </div>)}
    {walls.length > 0 && <div className="sh-room-walls">{walls.map(wall => <button type="button" key={wall.id} onClick={() => onSelectWall(wall.id)}>
      <span>{wall.name}</span><small>{describe(wall.shielding) || 'Sin blindaje'}</small>{icon('chevron-right')}</button>)}</div>}
    {summary.groups.length > 0 && <p className="sh-help">{NOT_APPLIED}</p>}
  </div>
}
