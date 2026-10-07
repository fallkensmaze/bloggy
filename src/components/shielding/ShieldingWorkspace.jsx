import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ShieldingCanvas from './ShieldingCanvas'
import ShieldingCalculationPanel from './ShieldingCalculationPanel'
import { emptyScene, newHistory, commitScene, undoScene, redoScene, scaleScene, updateEntity, removeEntity } from '../../utils/shieldingScene'
import { distanceMeters, createCalibration, classifyPrimary, validateWorkloadDistribution, segmentIntersection } from '../../utils/shieldingGeometry'
import { checkPlanFile, loadPlanImage, openPlanPdf, renderPlanPdf, rotatePlanImage } from '../../utils/shieldingFiles'
import { evaluateShielding } from '../../utils/shieldingCalculations'
import '../../styles/shielding.css'

const TOOLS = [
  ['select', 'cursor', 'Seleccionar', 'V'], ['pan', 'arrows-move', 'Mover vista', 'H'],
  ['rectangle', 'bounding-box', 'Sala rectangular', 'R'], ['room', 'pentagon', 'Sala poligonal', ''],
  ['wall', 'slash-lg', 'Pared', 'W'], ['door', 'door-open', 'Puerta', ''], ['window', 'window', 'Ventana', ''],
  ['configuration', 'broadcast', 'Orientación del equipo', 'E'], ['point', 'geo-alt', 'Punto de cálculo', 'P'],
  ['measure', 'rulers', 'Medir', 'M'], ['calibrate', 'arrows-expand', 'Calibrar escala', ''],
]
const INSTRUCTIONS = {
  select: 'Selecciona un elemento para editarlo. Arrastra sus tiradores para corregirlo.', pan: 'Arrastra el plano para desplazarte. Usa la rueda para acercar o alejar.',
  rectangle: 'Marca dos esquinas opuestas de la sala.', room: 'Marca los vértices de la sala. Pulsa Cerrar sala al terminar.',
  wall: 'Marca el inicio y el final de la pared.', door: 'Marca los dos extremos de la puerta.', window: 'Marca los dos extremos de la ventana.',
  configuration: 'Marca la posición del foco y después hacia dónde apunta.', point: 'Pulsa donde quieras evaluar la radiación.',
  patient: 'Marca dónde entra el haz en el paciente para esta orientación.', measure: 'Marca dos puntos para medir su distancia.', calibrate: 'Marca los extremos de una distancia conocida del plano.',
}
const INITIAL_VIEW = { x: -1, y: -1, width: 12, height: 8 }
const fmt = v => Number.isFinite(v) ? v.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : '—'
const numeric = value => value === '' || value == null ? NaN : Number(value)
const hasWork = s => Boolean(s.background || s.walls.length || s.points.length || s.configurations.length || s.rooms.length)
const icon = name => <i className={`bi bi-${name}`} aria-hidden="true" />
function Field({ label, value, onChange, type = 'text', ...rest }) {
  return <label className="sh-field"><span>{label}</span><input aria-label={label} type={type} step={type === 'number' ? 'any' : undefined} value={value ?? ''} onChange={e => onChange(e.target.value)} {...rest} /></label>
}
function NumberField(props) {
  const value = typeof props.value === 'number' ? Number(props.value.toPrecision(7)) : props.value
  return <Field type="number" {...props} value={value} />
}

export default function ShieldingWorkspace() {
  const [history, setHistory] = useState(() => newHistory(emptyScene()))
  const scene = history.present
  const [previewScene, setPreviewScene] = useState(null)
  const current = previewScene || scene
  const display = { ...current, configurations: current.configurations.map(c => ({ ...c, apertureDeg: numeric(c.apertureDeg), usePercent: numeric(c.usePercent) })) }
  const [tool, setTool] = useState('select'), [step, setStep] = useState('Plano')
  const [selection, setSelection] = useState(null), [draft, setDraft] = useState([]), [cursor, setCursor] = useState(null)
  const [viewBox, setViewBox] = useState(INITIAL_VIEW), [backgroundOpacity, setBackgroundOpacity] = useState(.6)
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [realLength, setRealLength] = useState(''), [results, setResults] = useState(null)
  const [pdfChoice, setPdfChoice] = useState(null), [pdfPage, setPdfPage] = useState(1)
  const svgRef = useRef(null), fileRef = useRef(null), drag = useRef(null), nextId = useRef(1)
  const modalRef = useRef(null)
  const urls = useRef(new Set()), documents = useRef(new Set()), mounted = useRef(true), importGeneration = useRef(0)
  const importController = useRef(null)
  const id = prefix => `${prefix}-${nextId.current++}`
  const commit = useCallback(next => { setHistory(h => commitScene(h, next)); setResults(null); setError('') }, [])
  const chooseTool = next => { setTool(next); setDraft([]); setRealLength(''); setMessage(''); setError('') }
  const collection = { wall: 'walls', room: 'rooms', point: 'points', configuration: 'configurations' }[selection?.type]
  const selected = collection ? scene[collection].find(e => e.id === selection.id) : null
  const activeConfiguration = selection?.type === 'configuration' ? selected : scene.configurations[0]
  const distribution = validateWorkloadDistribution(scene.configurations.map(c => ({ ...c, usePercent: numeric(c.usePercent) })))
  const undo = () => { setHistory(undoScene); setResults(null); setSelection(null); setDraft([]); setPreviewScene(null) }
  const redo = () => { setHistory(redoScene); setResults(null); setSelection(null); setDraft([]); setPreviewScene(null) }
  const patchSelected = patch => selected && commit(updateEntity(scene, selection.type, selected.id, patch))
  const removeSelected = () => {
    if (!selected) return
    let next = removeEntity(scene, selection.type, selected.id)
    if (selection.type === 'room') next = { ...next, walls: next.walls.filter(w => w.roomId !== selected.id) }
    commit(next); setSelection(null); setMessage('Elemento eliminado. Puedes recuperarlo con Deshacer.')
  }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; importGeneration.current++; importController.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); documents.current.forEach(doc => doc.destroy().catch(() => {})); documents.current.clear() }
  }, [])
  useEffect(() => {
    const keyboard = e => {
      if (pdfChoice) {
        if (e.key === 'Escape' && !busy) { e.preventDefault(); closePdf() }
        if (e.key === 'Tab') {
          const controls = [...modalRef.current.querySelectorAll('input:not(:disabled), button:not(:disabled)')]
          const first = controls[0], last = controls.at(-1)
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
        }
        return
      }
      if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape') { chooseTool('select'); setPreviewScene(null); drag.current = null }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected() }
      else if (!e.ctrlKey && !e.metaKey) { const match = TOOLS.find(t => t[3] && t[3].toLowerCase() === e.key.toLowerCase()); if (match) chooseTool(match[0]) }
    }
    document.addEventListener('keydown', keyboard)
    return () => document.removeEventListener('keydown', keyboard)
  })
  useEffect(() => {
    if (!pdfChoice) return
    const previous = document.activeElement
    modalRef.current?.querySelector('input')?.focus()
    return () => previous?.focus()
  }, [pdfChoice])
  const atPointer = e => {
    const matrix = svgRef.current?.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y }
  }
  const fit = (s = scene) => {
    const points = [...s.walls.flatMap(w => [w.start, w.end]), ...s.rooms.flatMap(r => r.vertices), ...s.points, ...s.configurations.flatMap(c => [c.source, c.target, ...(c.patient ? [c.patient] : [])])]
    if (s.background) points.push({ x: 0, y: 0 }, { x: s.background.width, y: s.background.height })
    if (!points.length) return setViewBox(INITIAL_VIEW)
    const xs = points.map(p => p.x), ys = points.map(p => p.y)
    const width = Math.max(2, Math.max(...xs) - Math.min(...xs)), height = Math.max(2, Math.max(...ys) - Math.min(...ys))
    setViewBox({ x: Math.min(...xs) - width * .12, y: Math.min(...ys) - height * .12, width: width * 1.24, height: height * 1.24 })
  }
  const zoom = (factor, anchor) => setViewBox(v => {
    const p = anchor || { x: v.x + v.width / 2, y: v.y + v.height / 2 }
    const width = Math.max(.2, Math.min(5000, v.width * factor)), ratio = width / v.width
    return { x: p.x - (p.x - v.x) * ratio, y: p.y - (p.y - v.y) * ratio, width, height: v.height * ratio }
  })
  useEffect(() => {
    const svg = svgRef.current
    const wheel = e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, atPointer(e)) }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [])
  const addRoom = vertices => {
    if (vertices.length < 3) return
    for (let i = 0; i < vertices.length; i++) {
      if (distanceMeters(vertices[i], vertices[(i + 1) % vertices.length]) < 1e-6) { setError('Cada lado necesita dos vértices distintos.'); return }
      for (let j = i + 2; j < vertices.length; j++) {
        if (i === 0 && j === vertices.length - 1) continue
        if (segmentIntersection(vertices[i], vertices[(i + 1) % vertices.length], vertices[j], vertices[(j + 1) % vertices.length])) { setError('Los lados de la sala se cruzan. Corrige el trazado antes de cerrarlo.'); return }
      }
    }
    const roomId = id('room'), name = `Sala ${scene.rooms.length + 1}`
    const walls = vertices.map((start, i) => ({ id: id('wall'), roomId, edgeIndex: i, name: `Pared ${scene.walls.length + i + 1}`, kind: 'wall', start, end: vertices[(i + 1) % vertices.length] }))
    commit({ ...scene, rooms: [...scene.rooms, { id: roomId, name, vertices }], walls: [...scene.walls, ...walls] })
    setSelection({ type: 'room', id: roomId }); chooseTool('select'); setMessage('Sala dibujada. Puedes mover sus vértices o añadir el equipo.')
  }
  const draw = p => {
    if (!scene.calibrated && !['calibrate', 'pan', 'select'].includes(tool)) { chooseTool('calibrate'); setError('Calibra el plano con una distancia conocida antes de dibujar.'); return }
    if (tool === 'point') {
      const point = { id: id('point'), name: `P${scene.points.length + 1}`, ...p, csn_occupancy: '', ncrp_occupancy: '' }
      commit({ ...scene, points: [...scene.points, point] }); setSelection({ type: 'point', id: point.id }); chooseTool('select'); return
    }
    if (tool === 'patient') {
      if (selection?.type !== 'configuration' || !selected) return
      patchSelected({ patient: p }); chooseTool('select'); return
    }
    if (tool === 'room') { setDraft(d => d.length && distanceMeters(d[d.length - 1], p) < 1e-6 ? d : [...d, p]); return }
    if (['wall', 'door', 'window', 'rectangle', 'configuration', 'measure', 'calibrate'].includes(tool)) {
      if (!draft.length || draft.length === 2) { setDraft([p]); setMessage(''); return }
      const start = draft[0]
      if (distanceMeters(start, p) < 1e-6) { setError('Los dos puntos deben ser distintos.'); return }
      if (tool === 'calibrate' || tool === 'measure') { setDraft([start, p]); return }
      if (tool === 'rectangle') {
        if (Math.abs(start.x - p.x) < 1e-6 || Math.abs(start.y - p.y) < 1e-6) { setError('La sala necesita ancho y alto.'); return }
        addRoom([start, { x: p.x, y: start.y }, p, { x: start.x, y: p.y }]); return
      }
      if (tool === 'configuration') {
        const configuration = { id: id('configuration'), name: `Orientación ${scene.configurations.length + 1}`, source: start, target: p, patient: null, apertureDeg: '', usePercent: '', csn: {}, ncrp: {} }
        commit({ ...scene, configurations: [...scene.configurations, configuration] }); setSelection({ type: 'configuration', id: configuration.id }); setStep('Equipo')
      } else {
        const wall = { id: id('wall'), name: `${tool === 'wall' ? 'Pared' : tool === 'door' ? 'Puerta' : 'Ventana'} ${scene.walls.length + 1}`, start, end: p, kind: tool }
        commit({ ...scene, walls: [...scene.walls, wall] }); setSelection({ type: 'wall', id: wall.id })
      }
      chooseTool('select')
    }
  }
  const pointerDown = e => {
    if (busy || e.button > 1) return
    const p = atPointer(e); if (!p) return
    if (tool === 'pan' || e.button === 1) {
      drag.current = { type: 'pan', client: { x: e.clientX, y: e.clientY }, view: viewBox, matrix: svgRef.current.getScreenCTM().inverse() }
    } else if (tool === 'select') {
      const group = e.target.closest('[data-entity]')
      if (!group) { setSelection(null); return }
      const chosen = { type: group.dataset.entity, id: group.dataset.id }
      setSelection(chosen)
      drag.current = { type: 'entity', selection: chosen, handle: e.target.closest('[data-handle]')?.dataset.handle, start: p, scene }
    } else { draw(p); return }
    try { svgRef.current.setPointerCapture(e.pointerId) } catch { /* synthetic events have no active pointer */ }
  }
  const pointerMove = e => {
    const p = atPointer(e); if (!p) return
    setCursor(p)
    const d = drag.current; if (!d) return
    if (d.type === 'pan') {
      const origin = new DOMPoint(d.client.x, d.client.y).matrixTransform(d.matrix), now = new DOMPoint(e.clientX, e.clientY).matrixTransform(d.matrix)
      setViewBox({ ...d.view, x: d.view.x + origin.x - now.x, y: d.view.y + origin.y - now.y }); return
    }
    const key = { wall: 'walls', room: 'rooms', point: 'points', configuration: 'configurations' }[d.selection.type]
    const entity = d.scene[key]?.find(item => item.id === d.selection.id); if (!entity) return
    const dx = p.x - d.start.x, dy = p.y - d.start.y, shifted = q => q && ({ ...q, x: q.x + dx, y: q.y + dy })
    let patch
    if (d.selection.type === 'point') patch = shifted(entity)
    else if (d.selection.type === 'wall') patch = d.handle ? { [d.handle]: p } : { start: shifted(entity.start), end: shifted(entity.end) }
    else if (d.selection.type === 'configuration') patch = d.handle ? { [d.handle]: p } : { source: shifted(entity.source), target: shifted(entity.target), patient: shifted(entity.patient) }
    else patch = { vertices: entity.vertices.map((v, index) => d.handle ? d.handle === `vertex:${index}` ? p : v : shifted(v)) }
    let next = updateEntity(d.scene, d.selection.type, entity.id, patch)
    if (d.selection.type === 'room') {
      next = { ...next, walls: next.walls.map(w => w.roomId === entity.id ? { ...w, start: patch.vertices[w.edgeIndex], end: patch.vertices[(w.edgeIndex + 1) % patch.vertices.length] } : w) }
    } else if (d.selection.type === 'wall' && entity.roomId) {
      const room = d.scene.rooms.find(r => r.id === entity.roomId)
      if (room) {
        const vertices = room.vertices.map((v, index) => index === entity.edgeIndex ? (patch.start || entity.start) : index === (entity.edgeIndex + 1) % room.vertices.length ? (patch.end || entity.end) : v)
        next = { ...next, rooms: next.rooms.map(r => r.id === room.id ? { ...r, vertices } : r), walls: next.walls.map(w => w.roomId === room.id ? { ...w, start: vertices[w.edgeIndex], end: vertices[(w.edgeIndex + 1) % vertices.length] } : w) }
      }
    }
    drag.current.next = next; setPreviewScene(next); setResults(null)
  }
  const pointerUp = () => { if (drag.current?.next) commit(drag.current.next); drag.current = null; setPreviewScene(null) }
  const registerImage = (image, name, generation) => {
    if (!mounted.current || generation !== importGeneration.current) { URL.revokeObjectURL(image.url); return }
    urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); urls.current.add(image.url)
    const next = { ...emptyScene(), name: scene.name, calibrated: false, background: { ...image, name, width: 12, height: 12 * image.pixelHeight / image.pixelWidth } }
    setHistory(newHistory(next)); setSelection(null); setResults(null); fit(next); setStep('Plano'); chooseTool('calibrate'); setMessage('Plano abierto. Marca una distancia conocida para fijar la escala.')
  }
  const importFile = async file => {
    if (!file || busy) return
    if (hasWork(scene) && !window.confirm('Abrir otro plano sustituye el trabajo de esta sesión. ¿Continuar?')) return
    const generation = ++importGeneration.current
    importController.current?.abort()
    importController.current = new AbortController()
    setError(''); setBusy(true)
    try {
      if (checkPlanFile(file) === 'pdf') {
        const pdf = await openPlanPdf(file, { signal: importController.current.signal })
        if (!mounted.current || generation !== importGeneration.current) { await pdf.destroy(); return }
        documents.current.add(pdf); setPdfChoice({ pdf, name: file.name, generation }); setPdfPage(1)
      } else registerImage(await loadPlanImage(file), file.name, generation)
    } catch (e) { if (mounted.current) setError(e.message) } finally { if (mounted.current) setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const closePdf = async () => { if (!pdfChoice) return; documents.current.delete(pdfChoice.pdf); await pdfChoice.pdf.destroy(); setPdfChoice(null) }
  const acceptPdf = async () => {
    setBusy(true); setError('')
    try { registerImage(await renderPlanPdf(pdfChoice.pdf, Number(pdfPage)), `${pdfChoice.name} · página ${pdfPage}`, pdfChoice.generation); await closePdf() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const applyCalibration = () => {
    try {
      const calibration = createCalibration(draft[0], draft[1], numeric(realLength))
      const next = scaleScene(scene, calibration.metersPerPixel)
      commit(next); fit(next); chooseTool('select'); setMessage('Escala aplicada. Las medidas del plano ya se muestran en metros.')
    } catch (e) { setError(e.message) }
  }
  const rotate = async () => {
    const generation = ++importGeneration.current; setBusy(true)
    try { registerImage(await rotatePlanImage(scene.background), scene.background.name, generation) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const allEntities = [...scene.rooms.map(e => ({ ...e, type: 'room' })), ...scene.configurations.map(e => ({ ...e, type: 'configuration' })), ...scene.points.map(e => ({ ...e, type: 'point' })), ...scene.walls.map(e => ({ ...e, type: 'wall' }))]
  return <div className="sh-workspace">
    <header className="sh-header">
      <Link className="sh-back" to="/" aria-label="Volver a Bloggy">{icon('arrow-left')}</Link>
      <div className="sh-brand"><span className="sh-brand-symbol">{icon('bounding-box')}</span><div><h1>Blindajes<span> / Taller de sala</span></h1><p>Falken’s Maze · Radiodiagnóstico</p></div></div>
      <span className="sh-session">{icon('clock-history')} Sesión temporal</span>
      <button className="sh-button" onClick={() => fileRef.current.click()} disabled={busy}>{icon('folder2-open')} Importar plano</button>
      <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="sh-file" aria-label="Archivo del plano" onChange={e => importFile(e.target.files[0])} />
    </header>
    <div className="sh-stepbar"><div className="sh-steps">{['Plano', 'Equipo', 'Resultados'].map((label, i) => <button key={label} aria-label={label} className={step === label ? 'is-active' : ''} onClick={() => setStep(label)} aria-current={step === label ? 'step' : undefined}><span>{i + 1}</span>{label}</button>)}</div><p>Solo en esta pestaña. Al cerrar o recargar, se pierde el trabajo.</p></div>
    <div className="sh-body">
      <nav className="sh-tools" aria-label="Herramientas de dibujo">{TOOLS.map(([key, glyph, label, shortcut]) => <button key={key} aria-label={label} aria-pressed={tool === key} title={`${label}${shortcut ? ` (${shortcut})` : ''}`} className={tool === key ? 'is-active' : ''} onClick={() => chooseTool(key)} disabled={busy}>{icon(glyph)}<span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>)}</nav>
      <section className="sh-stage" aria-label="Editor de sala" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); importFile(e.dataTransfer.files[0]) }}>
        <div className="sh-canvas-heading"><span>{scene.name}</span><span>{scene.calibrated ? 'Planta · metros' : 'Escala pendiente'}</span></div>
        <div className="sh-canvas-wrap">
          <ShieldingCanvas scene={display} viewBox={viewBox} selection={selection} tool={tool} draft={draft} cursor={cursor} activeConfigurationId={activeConfiguration?.id} backgroundOpacity={backgroundOpacity} svgRef={svgRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onDoubleClick={() => { if (tool === 'room' && draft.length >= 3) addRoom(draft) }} />
          {!hasWork(scene) && tool === 'select' && <div className="sh-empty"><div className="sh-empty-icon">{icon('bounding-box')}</div><h2>Tu sala empieza aquí</h2><p>Abre un plano o dibuja directamente sobre la cuadrícula.</p><div><button className="sh-button sh-button-primary" onClick={() => fileRef.current.click()}>{icon('upload')} Importar plano</button><button className="sh-button sh-button-light" onClick={() => chooseTool('rectangle')}>Dibujar una sala</button></div><small>PDF, PNG o JPEG · el archivo se queda en tu navegador</small></div>}
          <div className="sh-view-controls"><button aria-label="Deshacer" disabled={!history.past.length} onClick={undo}>{icon('arrow-counterclockwise')}</button><button aria-label="Rehacer" disabled={!history.future.length} onClick={redo}>{icon('arrow-clockwise')}</button><span /><button aria-label="Alejar" onClick={() => zoom(1.25)}>{icon('dash-lg')}</button><button aria-label="Acercar" onClick={() => zoom(.8)}>{icon('plus-lg')}</button><button aria-label="Ajustar plano" onClick={() => fit()}>{icon('arrows-fullscreen')}</button></div>
          {busy && <div className="sh-busy" role="status">Preparando el plano…</div>}
        </div>
        <div className="sh-guidance" aria-live="polite">{icon('info-circle')}<span>{message || INSTRUCTIONS[tool]}</span>{tool === 'room' && <button onClick={() => addRoom(draft)} disabled={draft.length < 3}>Cerrar sala ({draft.length})</button>}{draft.length > 0 && <button onClick={() => { setDraft([]); setMessage('') }}>Cancelar</button>}</div>
      </section>
      <aside className={`sh-inspector ${step === 'Resultados' ? 'sh-inspector--results' : ''}`} aria-label="Propiedades y cálculo">
        <div className="sh-inspector-title"><div><span className="sh-eyebrow">ESPACIO DE TRABAJO</span><h2>{step === 'Resultados' ? 'Comparar métodos' : selected ? 'Elemento seleccionado' : step === 'Equipo' ? 'Equipo y orientaciones' : 'Preparar el plano'}</h2></div></div>
        {error && <div className="sh-error" role="alert">{error}</div>}
        {step === 'Resultados' ? <ShieldingCalculationPanel scene={scene} onChangeScene={commit} results={results} onCalculate={() => { try { setResults(evaluateShielding(scene)) } catch (e) { setError(e.message) } }} /> : <>
          {tool === 'calibrate' && <section className="sh-card sh-calibration"><h3>{icon('arrows-expand')} Calibrar el plano</h3><p>Marca dos puntos cuya separación real conozcas.</p><div className="sh-calibration-steps"><span className={draft.length ? 'done' : ''}>1 · Primer punto</span><span className={draft.length === 2 ? 'done' : ''}>2 · Segundo punto</span></div><NumberField label="Distancia real (m)" value={realLength} onChange={setRealLength} min="0" /><button className="sh-button sh-button-primary" disabled={draft.length !== 2 || !realLength} onClick={applyCalibration}>Aplicar escala</button>{scene.calibrated && hasWork(scene) && <small>Al recalibrar cambiarán todas las medidas de la escena. Puedes deshacerlo.</small>}</section>}
          {tool === 'measure' && draft.length === 2 && <section className="sh-card"><h3>Distancia medida</h3><strong className="sh-measure">{fmt(distanceMeters(...draft))} {scene.calibrated ? 'm' : 'unidades sin calibrar'}</strong></section>}
          {selected && <section className="sh-card sh-properties">
            <span className="sh-tag">{selection.type === 'configuration' ? 'Equipo RX · orientación' : selection.type === 'point' ? 'Punto de cálculo' : selection.type === 'room' ? 'Recinto' : selected.kind === 'door' ? 'Puerta' : selected.kind === 'window' ? 'Ventana' : 'Pared'}</span>
            <Field label={selection.type === 'configuration' ? 'Nombre de la orientación' : 'Nombre'} value={selected.name} onChange={name => patchSelected({ name })} />
            {selection.type === 'wall' && <p className="sh-property-value">Longitud <strong>{fmt(distanceMeters(selected.start, selected.end))} m</strong></p>}
            {selection.type === 'configuration' && <>
              <div className="sh-two-fields"><NumberField label="Carga de trabajo (%)" value={selected.usePercent} onChange={usePercent => patchSelected({ usePercent })} min="0" max="100" /><NumberField label="Apertura del haz en planta (°)" value={selected.apertureDeg} onChange={apertureDeg => patchSelected({ apertureDeg })} min="0" max="179.99" /></div>
              <p className="sh-help">Porcentaje de la carga semanal en mA·min. Define la apertura para ver qué puntos quedan dentro del haz en planta.</p>
              <button className="sh-button sh-button-secondary" onClick={() => chooseTool('patient')}>{icon('person')} {selected.patient ? 'Mover entrada al paciente' : 'Situar entrada al paciente'}</button>
              <small>{selected.patient ? 'Superficie de entrada situada. Arrastra su marcador para corregirla.' : 'Marca la superficie de entrada del haz, no el centro del paciente.'}</small>
            </>}
            {selection.type === 'point' && <>
              <div className="sh-two-fields"><NumberField label="X del punto (m)" value={selected.x} onChange={x => { if (x !== '' && Number.isFinite(Number(x))) patchSelected({ x: Number(x) }) }} /><NumberField label="Y del punto (m)" value={selected.y} onChange={y => { if (y !== '' && Number.isFinite(Number(y))) patchSelected({ y: Number(y) }) }} /></div>
              <div className="sh-point-radiation"><h4>Radiación en este punto</h4>{scene.configurations.map(c => { const state = classifyPrimary(selected, { ...c, apertureDeg: numeric(c.apertureDeg) }); return <div key={c.id}><span>{c.name}</span><strong className={`sh-state-${state.status}`}>{state.status === 'inside' ? 'Primaria en planta' : state.status === 'outside' ? 'Fuera del haz en planta' : 'Haz por definir'}</strong></div> })}<p>Dispersión y fuga se evalúan en todas las orientaciones. Las paredes no eliminan una contribución por sí solas.</p></div>
            </>}
            <button className="sh-delete" onClick={removeSelected}>{icon('trash3')} Eliminar {selection.type === 'configuration' ? 'orientación' : 'elemento'}</button>
          </section>}
          {step === 'Plano' && !selected && tool !== 'calibrate' && <section className="sh-card"><Field label="Nombre de la sala" value={scene.name} onChange={name => commit({ ...scene, name })} /><h3>Un plano, tres pasos</h3><ol className="sh-checklist"><li className={scene.background ? 'done' : ''}><b>Abre o dibuja</b><span>Tu plano como fondo, o una sala desde cero.</span></li><li className={scene.calibrated ? 'done' : ''}><b>Comprueba la escala</b><span>{scene.background ? 'Usa una distancia conocida.' : 'La cuadrícula en blanco ya está en metros.'}</span></li><li className={scene.configurations.length ? 'done' : ''}><b>Sitúa el equipo</b><span>Añade sus orientaciones y puntos de cálculo.</span></li></ol></section>}
          {scene.background && <section className="sh-card"><h3>{icon('image')} Plano de fondo</h3><p className="sh-file-name">{scene.background.name}</p><label className="sh-range">Opacidad<input aria-label="Opacidad del plano" type="range" min="0" max="1" step=".05" value={backgroundOpacity} onChange={e => setBackgroundOpacity(Number(e.target.value))} /></label>{!scene.calibrated && <button className="sh-button sh-button-secondary" disabled={busy} onClick={rotate}>{icon('arrow-clockwise')} Girar 90°</button>}<button className="sh-text-button" onClick={() => chooseTool('calibrate')}>Volver a calibrar</button></section>}
          {(step === 'Equipo' || scene.configurations.length > 0) && <section className="sh-card"><div className="sh-card-heading"><h3>Un equipo, varias orientaciones</h3><button aria-label="Añadir orientación" onClick={() => chooseTool('configuration')}>{icon('plus-lg')}</button></div><p className="sh-help">Dibuja el foco y el destino de cada posición de trabajo.</p>{scene.configurations.map(c => <button key={c.id} className={`sh-orientation ${selection?.id === c.id ? 'is-active' : ''}`} onClick={() => { setSelection({ type: 'configuration', id: c.id }); chooseTool('select') }}><span>{icon('broadcast')} {c.name}</span><b>{c.usePercent === '' ? '—' : c.usePercent}%</b></button>)}<div className={`sh-distribution ${distribution.valid ? 'is-complete' : ''}`}><span>Carga repartida</span><strong>{fmt(distribution.totalPercent)} / 100 %</strong></div>{!distribution.valid && scene.configurations.length > 0 && <p className="sh-help">Completa el reparto hasta el 100 %. No se ajusta automáticamente.</p>}</section>}
          {allEntities.length > 0 && <section className="sh-card"><h3>Elementos del plano <span className="sh-count">{allEntities.length}</span></h3><div className="sh-entity-list">{allEntities.map(e => <button key={e.id} className={selection?.id === e.id ? 'is-active' : ''} onClick={() => { setSelection({ type: e.type, id: e.id }); chooseTool('select') }}>{icon(e.type === 'point' ? 'geo-alt' : e.type === 'configuration' ? 'broadcast' : 'bounding-box')}<span>{e.name}</span>{icon('chevron-right')}</button>)}</div></section>}
        </>}
      </aside>
    </div>
    <footer className="sh-footer"><span>{icon('shield-lock')} Trabajo local · sin subida de archivos</span><span>Proyección 2D en planta</span><span>{scene.walls.length} barreras · {scene.configurations.length} orientaciones · {scene.points.length} puntos</span></footer>
    {pdfChoice && <div className="sh-modal-scrim"><section ref={modalRef} className="sh-modal" role="dialog" aria-modal="true" aria-labelledby="sh-pdf-title"><h2 id="sh-pdf-title">Elige la página del plano</h2><p>{pdfChoice.name} · {pdfChoice.pdf.numPages} páginas</p><NumberField label="Página del PDF" value={pdfPage} min="1" max={pdfChoice.pdf.numPages} onChange={setPdfPage} /><p className="sh-help">La página se convertirá en una imagen local para dibujar sobre ella.</p>{error && <p role="alert" className="sh-error">{error}</p>}<div><button className="sh-button" disabled={busy} onClick={closePdf}>Cancelar</button><button className="sh-button sh-button-primary" disabled={busy} onClick={acceptPdf}>{busy ? 'Preparando…' : 'Usar esta página'}</button></div></section></div>}
  </div>
}
