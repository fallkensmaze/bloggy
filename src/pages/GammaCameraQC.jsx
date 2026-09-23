import { useMemo, useState } from 'react'
import GammaImage, { GammaProfiles, tomographyMosaic } from '../components/GammaImage'
import { classifyGamma, parseGammaDicom } from '../utils/gammaDicom'
import { analyzeGammaEntry, initialGammaOptions } from '../utils/gammaBatch'
import { locateLine } from '../utils/gammaResolution'
import { GAMMA_TESTS, monthlyCompleteness, monthlyVerdict, tomographyPrompt, validateMonthlyBatch } from '../utils/gammaReport'
import { LIMIT_PROFILES } from '../utils/nemaAlgorithms'
import { useAuthUser } from '../utils/adminAuth'
import { loginWithGoogle } from '../utils/authGoogle'
import '../styles/gamma-qc.css'

const fmt = (value, digits = 3) => Number.isFinite(value) ? value.toLocaleString('es-ES', { maximumFractionDigits: digits }) : '—'
const statusClass = status => status === 'Conforme' || status?.startsWith('Conforme según') ? 'pass' : status === 'No conforme' ? 'fail' : 'pending'

function download(name, blob) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Field({ label, value, onChange, type = 'number', ...props }) {
  return <label className="gamma-field"><span>{label}</span><input className="dark-input" aria-label={label} type={type} step={type === 'number' ? 'any' : undefined}
    value={value ?? ''} onChange={e => onChange(e.target.value)} {...props} /></label>
}
function Choice({ label, value, onChange, children }) {
  return <label className="gamma-field"><span>{label}</span><select className="dark-select" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{children}</select></label>
}
function Check({ label, value, onChange }) {
  return <label className="gamma-check"><input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />{label}</label>
}

function FileSettings({ entry, frameIndex, update }) {
  const o = entry.options, type = entry.type, frame = entry.image.frameInfo[frameIndex]
  const set = (key, value) => update({ ...o, [key]: value, verified: key === 'verified' ? value : false })
  const setFrame = (key, value) => set('frameOptions', { ...o.frameOptions, [frameIndex]: { ...o.frameOptions[frameIndex], [key]: value } })
  const frameOptions = { ...o, ...o.frameOptions[frameIndex] }
  return <div className="gamma-settings">
    {type === 'resolution' && <>
      <div className="gamma-fields">
        <Choice label="Eje medido (perpendicular a la línea)" value={o.axis} onChange={v => set('axis', v)}><option value="auto">Detectar X / Y</option><option value="X">X · columnas</option><option value="Y">Y · filas</option></Choice>
        <Field label="Ancho de cada franja (1–8 px)" value={o.stripPixels} min="1" max="8" onChange={v => set('stripPixels', v)} />
        <Field label="Límite FWHM (mm)" value={o.fwhmLimit} min="0" onChange={v => set('fwhmLimit', v)} />
        <Field label="Límite FWTM (mm)" value={o.fwtmLimit} min="0" onChange={v => set('fwtmLimit', v)} />
      </div>
      <Check label="Restar fondo estimado en los extremos del perfil (método opcional)" value={o.subtractBackground} onChange={v => set('subtractBackground', v)} />
      <p className="gamma-hint">Fuente lineal aislada: cinco franjas del tramo central. El tamaño de píxel procede de PixelSpacing; no se aplica corrección por diámetro de la fuente. Los límites son del protocolo local, no universales.</p>
    </>}
    {type === 'sensitivity' && <>
      <h3>Actividad de la fuente · común a los cabezales</h3>
      <div className="gamma-fields">
        <Field label="Actividad medida (MBq)" value={o.activityMBq} min="0" onChange={v => set('activityMBq', v)} />
        <Field label="Fecha y hora de medida de actividad" type="datetime-local" step="1" value={o.activityAt} onChange={v => set('activityAt', v)} />
        <Field label="Semiperiodo del radionucleido (h)" value={o.halfLifeHours} min="0" onChange={v => set('halfLifeHours', v)} />
        <Field label="Inicio de adquisición (reloj local del equipo)" type="datetime-local" step="any" value={o.acquiredAt} onChange={v => set('acquiredAt', v)} />
      </div>
      <button className="gamma-link-button" onClick={() => set('halfLifeHours', '6.0067')}>Usar Tc-99m · 6,0067 h</button>
      <Check label="Descontar actividad residual de la jeringa" value={o.useResidual} onChange={v => set('useResidual', v)} />
      {o.useResidual && <div className="gamma-fields"><Field label="Actividad residual (MBq)" value={o.residualMBq} min="0" onChange={v => set('residualMBq', v)} />
        <Field label="Fecha y hora de medida residual" type="datetime-local" step="1" value={o.residualAt} onChange={v => set('residualAt', v)} /></div>}
      <h3>Fondo y referencia · cabezal {frame.detectorNumber ?? '?'} / frame {frameIndex + 1}</h3>
      <div className="gamma-fields">
        <Field label={`Duración (s), DICOM: ${fmt(frame.durationSeconds)}`} value={frameOptions.durationSeconds} min="0" placeholder={String(frame.durationSeconds ?? '')} onChange={v => setFrame('durationSeconds', v)} />
        <Choice label="Corrección de fondo" value={frameOptions.backgroundMode} onChange={v => setFrame('backgroundMode', v)}><option value="">Pendiente de declarar</option><option value="measured">Fondo medido en toda la imagen</option><option value="negligible">Declaro fondo despreciable</option></Choice>
        {frameOptions.backgroundMode === 'measured' && <><Field label="Cuentas de fondo (imagen completa)" value={frameOptions.backgroundCounts} min="0" onChange={v => setFrame('backgroundCounts', v)} />
          <Field label="Duración del fondo (s)" value={frameOptions.backgroundSeconds} min="0" onChange={v => setFrame('backgroundSeconds', v)} /></>}
        <Field label="Sensibilidad de referencia (cps/MBq)" value={frameOptions.referenceSensitivity} min="0" onChange={v => setFrame('referenceSensitivity', v)} />
        <Field label="Desviación máxima respecto a referencia (%)" value={frameOptions.sensitivityTolerance} min="0" onChange={v => setFrame('sensitivityTolerance', v)} />
      </div>
      <p className="gamma-hint">Se suman todas las cuentas de cada frame, se resta su fondo y se divide por el tiempo y la actividad media durante la adquisición. La incertidumbre mostrada solo incluye estadística de conteo. La actividad DICOM no se usa como medida del activímetro.</p>
    </>}
    {type === 'uniformity' && <>
      <div className="gamma-fields">
        <Choice label="Perfil de límites de uniformidad" value={o.uniformityProfile} onChange={v => set('uniformityProfile', v)}><option value="auto">Detectar por equipo</option><option value="none">Sin límites</option>{LIMIT_PROFILES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</Choice>
        <Choice label="Píxel de análisis" value={o.targetSize} onChange={v => set('targetSize', v)}><option value="auto">Auto NEMA 6,4 mm</option><option value="78">Bloque hacia 78 × 78</option></Choice>
        <Field label="Distancia fuente–detector (cm)" value={o.declaration.sourceDistanceCm} min="0" onChange={v => set('declaration', { ...o.declaration, sourceDistanceCm: v })} />
        <Choice label="Colimador retirado" value={o.declaration.collimatorRemoved} onChange={v => set('declaration', { ...o.declaration, collimatorRemoved: v })}><option value="">Sin confirmar</option><option value="si">Sí</option><option value="no">No</option></Choice>
        <Choice label="Ventana de energía revisada contra el protocolo" value={o.declaration.energyWindowConfirmed} onChange={v => set('declaration', { ...o.declaration, energyWindowConfirmed: v })}><option value="">Sin confirmar</option><option value="si">Sí, coincide</option><option value="no">No coincide</option></Choice>
        <Field label="Correcciones aplicadas" type="text" value={o.declaration.uniformityCorrection} onChange={v => set('declaration', { ...o.declaration, uniformityCorrection: v })} />
      </div>
      <p className="gamma-hint">Se usa el mismo motor y validación que Uniformidad NEMA. Las declaraciones pertenecen únicamente a este DICOM.</p>
    </>}
    {type === 'cor' && <><div className="gamma-fields"><Field label="Límite δCOR (mm) · individual y entre cabezales" value={o.corLimit} min="0" onChange={v => set('corLimit', v)} />
      <Field label="Límite δAXIAL (mm) · individual y entre cabezales" value={o.axialLimit} min="0" onChange={v => set('axialLimit', v)} /></div><p className="gamma-hint">Método existente de tres fuentes puntuales. Se conservan las cuatro cotas NEMA y sus comprobaciones de adquisición.</p></>}
    {type === 'tomography' && <><label className="gamma-field"><span>Hallazgos de la revisión tomográfica</span><textarea className="dark-input" rows="4" value={o.tomoObservations} onChange={e => set('tomoObservations', e.target.value)} placeholder="Fantoma, cortes revisados, uniformidad visual, anillos, defectos, resolución/contraste visual y comparación con referencia…" /></label>
      <Choice label="Valoración del especialista" value={o.tomoVerdict} onChange={v => set('tomoVerdict', v)}><option value="">Pendiente de revisión</option><option value="Conforme">Conforme según protocolo visual</option><option value="No conforme">No conforme</option></Choice></>}
    {type !== 'unknown' && <>
      <Field label="Protocolo y condiciones (colimador, distancia, ventana, fantoma/reconstrucción)" type="text" value={o.protocol} onChange={v => set('protocol', v)} />
      {!['uniformity', 'tomography'].includes(type) && <Field label="Procedencia y versión de las tolerancias" type="text" value={o.limitSource} onChange={v => set('limitSource', v)} placeholder="Protocolo del servicio / especificación de fabricante / referencia de aceptación" />}
      <Field label="Observaciones / responsable de revisión" type="text" value={o.notes} onChange={v => set('notes', v)} />
      {type !== 'uniformity' && <Check label="He revisado la imagen y confirmado que la adquisición corresponde al protocolo de comparación" value={o.verified} onChange={v => set('verified', v)} />}
    </>}
  </div>
}

function RecordResult({ record, detailed = true }) {
  return <article className="gamma-result">
    <div className="gamma-result-heading"><h3>{GAMMA_TESTS[record.type]}{record.detector != null ? ` · cabezal ${record.detector}` : ''}{record.axis ? ` · ${record.axis}` : ''}</h3>
      <span className={`gamma-badge ${statusClass(record.status)}`}>{record.status}</span></div>
    <p>{record.reason}</p>
    {!!record.metrics.length && <div className="gamma-table-scroll"><table><thead><tr><th>Magnitud</th><th>Resultado</th><th>Tolerancia</th></tr></thead><tbody>{record.metrics.map(m => <tr key={m.key}><td>{m.label}</td><td>{fmt(m.value)} {m.unit}</td><td>{m.limit == null ? 'Sin límite' : `${m.operator === 'min' ? '≥' : '≤'} ${fmt(m.limit)} ${m.unit}`}</td></tr>)}</tbody></table></div>}
    {detailed && record.details?.profiles && <GammaProfiles result={record.details} />}
    {record.type === 'sensitivity' && record.details && <p className="gamma-hint">{fmt(record.details.totalCounts, 0)} cuentas / {fmt(record.details.durationSeconds)} s · tasa neta {fmt(record.details.netCps)} cps · A media {fmt(record.details.meanActivityMBq)} MBq · u estadística {fmt(record.details.statisticalUncertainty)} cps/MBq</p>}
    {record.details?.warnings?.map(w => <p className="gamma-warning" key={w}>{w}</p>)}
    {detailed && record.details?.profiles && <p className="gamma-hint">FWHM entre franjas: {fmt(record.details.fwhmMinMm)}–{fmt(record.details.fwhmMaxMm)} mm · inclinación {fmt(record.details.tiltDegrees, 2)}° · píxel {fmt(record.details.spacing, 4)} mm</p>}
    {record.details?.checks && <details><summary>Comprobaciones de adquisición</summary><ul>{record.details.checks.map(c => <li key={c.id}>{c.label}: {c.status} · {String(c.value ?? '')} · {c.detail}</li>)}</ul></details>}
    {record.type === 'cor' && <details><summary>Comprobaciones COR</summary><pre>{JSON.stringify(record.details.acquisition, null, 2)}</pre></details>}
    <p className="gamma-hint">{record.method || 'Análisis pendiente'} · {record.file} · {record.acquiredAt} · {record.window || ''} · {record.collimator || ''}</p>
    {(record.protocol || record.limitSource) && <p className="gamma-hint">Protocolo: {record.protocol || 'sin registrar'} · Límites: {record.limitSource || 'sin registrar'}</p>}
    {record.notes && <p>{record.notes}</p>}
  </article>
}

function FilePreview({ entry, frameIndex, setFrameIndex, update, privateReport }) {
  const [windowFraction, setWindowFraction] = useState(1), [aiMessage, setAiMessage] = useState(''), [prompt, setPrompt] = useState('')
  const image = entry.image, frame = image.frameInfo[frameIndex]
  const maximum = useMemo(() => {
    let max = 0
    const frames = entry.type === 'tomography' ? image.frames : [image.frames[frameIndex]]
    for (const values of frames) for (const v of values) max = Math.max(max, v)
    return max
  }, [image, frameIndex, entry.type])
  const autoRoi = useMemo(() => {
    if (entry.type !== 'resolution') return null
    try { return locateLine(image.frames[frameIndex], image.rows, image.cols).roi } catch { return null }
  }, [image, frameIndex, entry.type])
  const roi = entry.options.rois[frameIndex] || autoRoi
  const setRoi = value => update({ ...entry.options, verified: false, rois: { ...entry.options.rois, [frameIndex]: value } })
  async function prepareChatGPT() {
    try {
      const count = Math.min(12, image.frames.length)
      const selected = Array.from({ length: count }, (_, i) => Math.round(i * (image.frames.length - 1) / Math.max(1, count - 1)))
      if (!selected.includes(frameIndex)) selected[Math.floor(count / 2)] = frameIndex
      const question = tomographyPrompt(image, selected.map(f => f + 1)); setPrompt(question)
      const canvas = tomographyMosaic(image, selected, maximum * windowFraction)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('No se ha podido preparar el mosaico.')
      download('revision-tomografica.png', blob)
      try { await navigator.clipboard.writeText(question); setAiMessage('Consulta copiada. Abre ChatGPT, pégala y adjunta el PNG descargado.') }
      catch { setAiMessage('Imagen descargada. Copia la consulta de abajo y adjunta el PNG en ChatGPT.') }
    } catch (error) { setAiMessage(error.message) }
  }
  return <div className="gamma-preview-grid"><div>
    <Choice label={entry.type === 'tomography' ? 'Corte / frame DICOM' : 'Cabezal / frame'} value={frameIndex} onChange={v => setFrameIndex(Number(v))}>{image.frameInfo.map((f, i) => <option key={i} value={i}>Frame {i + 1} · {f.detectorNumber == null ? 'sin detector' : `cabezal ${f.detectorNumber}`} {f.view}</option>)}</Choice>
    <GammaImage image={image} frameIndex={frameIndex} maximum={maximum * windowFraction} roi={entry.type === 'resolution' ? roi : null} onRoi={entry.type === 'resolution' ? setRoi : undefined} />
    <label className="gamma-field"><span>Ventana de visualización · {Math.round(windowFraction * 100)} % del máximo</span><input type="range" min="0.05" max="1" step="0.01" value={windowFraction} onChange={e => setWindowFraction(Number(e.target.value))} /></label>
    <p className="gamma-hint">{image.cols} × {image.rows} px · píxel fila/columna {image.pixelSpacing?.map(v => fmt(v, 4)).join(' / ') || 'desconocido'} mm<br />{fmt(frame.totalCounts, 0)} cuentas · {fmt(frame.durationSeconds)} s · {frame.energyWindowKeV.map(v => fmt(v, 1)).join('–')} keV · {frame.collimator || 'colimador sin dato'}</p>
    {entry.type === 'resolution' && roi && <><p className="gamma-hint">Arrastra sobre la imagen o ajusta la ROI (coordenadas de matriz, desde 0).</p><div className="gamma-roi-fields">{[['x', 'Columna'], ['y', 'Fila'], ['width', 'Ancho'], ['height', 'Alto']].map(([key, label]) => <Field key={key} label={label} value={roi[key]} step="1" min="0" onChange={v => setRoi({ ...roi, [key]: Number(v) })} />)}</div><button onClick={() => setRoi(null)}>Restaurar ROI automática</button></>}
    {entry.type === 'tomography' && privateReport && <div className="gamma-ai"><h3>Consulta visual a ChatGPT</h3><p>Prepara hasta 12 cortes con escala común y una consulta. Revisa también el resto de cortes en el selector. El envío y la incorporación de observaciones son manuales.</p><button onClick={prepareChatGPT}>Preparar imagen y consulta</button> <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">Abrir ChatGPT ↗</a><p role="status">{aiMessage}</p>{prompt && <textarea className="dark-input" aria-label="Consulta para ChatGPT" rows="7" readOnly value={prompt} />}</div>}
  </div><FileSettings entry={entry} frameIndex={frameIndex} update={update} /></div>
}

export function GammaWorkspace({ mode }) {
  const monthly = mode === 'monthly'
  const [entries, setEntries] = useState([]), [selectedId, setSelectedId] = useState(''), [frameIndex, setFrameIndex] = useState(0)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [reportVisible, setReportVisible] = useState(false)
  const [expectedHeads, setExpectedHeads] = useState('2'), [responsible, setResponsible] = useState('')
  const batch = useMemo(() => validateMonthlyBatch(entries), [entries])
  const active = entries.find(e => e.id === selectedId)
  const records = entries.flatMap(e => e.records || [])
  const detectedHeads = Math.max(1, ...entries.flatMap(e => e.image?.frameInfo.map(f => f.detectorNumber || 1) || []))
  const missing = monthlyCompleteness(records, Array.from({ length: Math.max(Number(expectedHeads), detectedHeads) }, (_, i) => i + 1))
  const pending = entries.some(e => !e.records?.length || e.type === 'unknown')
  const verdict = monthlyVerdict(records, missing, pending)
  function changeEntries(next) { setEntries(next); setReportVisible(false) }
  function updateEntry(id, patch) { changeEntries(entries.map(e => e.id === id ? { ...e, ...patch, records: null, analysisError: '' } : e)) }
  async function calculate(list) {
    const validation = validateMonthlyBatch(list)
    if (monthly && !validation.valid) { setMessage('Análisis bloqueado: corrige los archivos del lote.'); return list.map(e => ({ ...e, records: null })) }
    const next = []
    for (const entry of list) {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (!entry.image || entry.type === 'unknown') { next.push(entry); continue }
      try { next.push({ ...entry, records: analyzeGammaEntry(entry), analysisError: '' }) }
      catch (error) { next.push({ ...entry, records: null, analysisError: error.message }) }
    }
    return next
  }
  async function loadFiles(files) {
    if (!files.length) return
    setBusy(true); setMessage('Leyendo DICOM…'); setReportVisible(false)
    const next = [...entries]
    try {
      for (const file of files) {
        const id = crypto.randomUUID()
        try {
          if (file.size > 128 * 1024 * 1024) throw new Error('El archivo supera 128 MB; exporta una serie más pequeña.')
          const buffer = await file.arrayBuffer(), image = parseGammaDicom(buffer)
          const type = monthly ? classifyGamma(image) : mode
          next.push({ id, name: file.name, buffer, image, type, options: initialGammaOptions(image), records: null })
        } catch (error) { next.push({ id, name: file.name, error: error.message, type: 'unknown' }) }
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      const valid = !monthly || validateMonthlyBatch(next).valid
      changeEntries(valid ? await calculate(next) : next.map(e => ({ ...e, records: null })))
      setSelectedId(next.find(e => e.image)?.id || ''); setFrameIndex(0)
      setMessage(valid ? 'Carga completada. Revisa las mediciones y completa los datos pendientes.' : 'Análisis bloqueado: los archivos no forman un lote de un mismo equipo y mes.')
    } finally { setBusy(false) }
  }
  async function run() { setBusy(true); setMessage('Analizando las pruebas…'); try { changeEntries(await calculate(entries)); setMessage('Análisis actualizado. Revisa las advertencias y las pruebas pendientes.') } finally { setBusy(false) } }
  function exportResults() {
    const payload = { schema: 'gamma-qc-report/1', createdAt: new Date().toISOString(), mode,
      ...(monthly ? { month: batch.month, equipment: batch.equipment, verdict, missing, responsible } : {}), records }
    download(monthly ? `informe-gammacamara-${batch.month}.json` : `gammacamara-${mode}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  }
  return <div className={`page-body gamma-qc ${reportVisible ? 'gamma-print-ready' : ''}`}>
    <div className="page-header gamma-no-print"><div className="page-icon"><i className={`bi ${monthly ? 'bi-calendar-check' : mode === 'resolution' ? 'bi-crosshair' : 'bi-speedometer2'}`}></i></div>
      <h1 className="page-title">{monthly ? 'Informe mensual de gammacámara' : GAMMA_TESTS[mode]}</h1><p className="page-subtitle">{monthly ? 'Área privada · un equipo, un mes y todas sus pruebas' : mode === 'resolution' ? 'Fuentes lineales · FWHM y FWTM por cabezal y eje' : 'Cuentas por segundo y MBq · fondo y decaimiento'}</p></div>
    <section className="calc-card gamma-no-print">
      <label className="gamma-upload"><i className="bi bi-files"></i><strong>{monthly ? 'Añadir todos los DICOM del mes' : 'Añadir imágenes DICOM'}</strong><span>Selecciona varios archivos · procesamiento en este navegador</span><input type="file" multiple accept=".dcm,application/dicom" disabled={busy} onChange={e => { loadFiles([...e.target.files]); e.target.value = '' }} /></label>
      <p className="gamma-hint">Las imágenes y los resultados permanecen en esta pestaña. Descarga el informe antes de cerrarla; no se guardan en un servidor.</p>
      {monthly && entries.length > 0 && <div className={`gamma-validation ${batch.valid ? 'pass' : 'fail'}`}><strong>{batch.valid ? `Lote verificado · ${batch.month} · ${batch.equipment}` : 'Lote incompatible: no se iniciará el análisis'}</strong>{batch.errors.length > 0 && <ul>{batch.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}<p>Se usa la fecha de adquisición y los identificadores StationName/DeviceSerialNumber, no el nombre del archivo ni la fecha de exportación.</p></div>}
      {entries.length > 0 && <div className="gamma-table-scroll"><table><thead><tr><th>Archivo / adquisición</th><th>Gammacámara</th><th>Prueba</th><th>Estado</th><th></th></tr></thead><tbody>{entries.map(e => <tr key={e.id} className={selectedId === e.id ? 'gamma-selected' : ''}>
        <td><button className="gamma-file-button" disabled={!e.image || busy} onClick={() => { setSelectedId(e.id); setFrameIndex(0) }}>{e.name}</button><small>{e.image?.metadata.acquiredAt || 'Fecha desconocida'}</small></td><td>{e.image?.metadata.equipment || 'Sin identificar'}</td>
        <td>{monthly && e.image ? <select className="dark-select" aria-label={`Tipo de prueba de ${e.name}`} disabled={busy} value={e.type} onChange={event => { updateEntry(e.id, { type: event.target.value, options: initialGammaOptions(e.image) }); setFrameIndex(0) }}>{Object.entries(GAMMA_TESTS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select> : GAMMA_TESTS[e.type]}</td>
        <td>{e.error || e.analysisError || (e.records ? `${e.records.length} resultados` : 'Pendiente')}</td><td><button disabled={busy} aria-label={`Retirar ${e.name}`} onClick={() => { changeEntries(entries.filter(v => v.id !== e.id)); if (selectedId === e.id) { setSelectedId(''); setFrameIndex(0) } }}>Retirar</button></td>
      </tr>)}</tbody></table></div>}
      <div className="gamma-actions"><button className="gamma-primary" disabled={busy || !entries.length || (monthly && !batch.valid)} onClick={run}>{busy ? 'Procesando…' : 'Analizar / actualizar todas las pruebas'}</button>{!monthly && <button disabled={!records.length || pending || busy} onClick={exportResults}>Descargar resultados JSON</button>}</div><p role="status" aria-live="polite">{message}</p>
    </section>
    {active?.image && <section className="calc-card gamma-no-print"><h2>{GAMMA_TESTS[active.type]} · {active.image.metadata.description}</h2>
      <fieldset disabled={busy} className="gamma-fieldset"><FilePreview key={active.id + active.type} entry={active} frameIndex={Math.min(frameIndex, active.image.frames.length - 1)} setFrameIndex={setFrameIndex} update={options => updateEntry(active.id, { options })} privateReport={monthly} /></fieldset>
      {active.analysisError && <p className="gamma-warning">{active.analysisError}</p>}{active.records?.filter(r => r.frameIndex == null || r.frameIndex === frameIndex).map(r => <RecordResult key={r.id} record={r} />)}
    </section>}
    {monthly && batch.valid && <section className="calc-card gamma-no-print"><h2>Informe del mes</h2><div className="gamma-fields"><Choice label="Número de cabezales que deben estar completos" value={expectedHeads} onChange={v => { setExpectedHeads(v); setReportVisible(false) }}><option value="1">1 cabezal</option><option value="2">2 cabezales</option><option value="3">3 cabezales</option></Choice><Field label="Responsable del informe" type="text" value={responsible} onChange={v => { setResponsible(v); setReportVisible(false) }} /></div>
      <p><span className={`gamma-badge ${statusClass(verdict)}`}>{verdict}</span></p>{!!missing.length && <p className="gamma-warning">Faltan: {missing.join('; ')}.</p>}
      <p className="gamma-hint">Se esperan uniformidad y sensibilidad en cada cabezal, resolución X e Y, COR y revisión tomográfica. Un informe incompleto conserva todas las pruebas pendientes.</p>
      <div className="gamma-actions"><button disabled={!records.length || pending || busy} onClick={() => setReportVisible(true)}>Preparar informe</button><button disabled={!records.length || pending || busy} onClick={exportResults}>Descargar informe JSON</button>{reportVisible && <button onClick={() => window.print()}>Imprimir / guardar PDF</button>}</div></section>}
    {monthly && reportVisible && batch.valid && <section className="calc-card gamma-monthly-report"><h1>Control mensual de gammacámara</h1><p><strong>{batch.equipment} · {batch.month}</strong></p><p>Responsable: {responsible || 'Pendiente de identificar'} · Generado: {new Date().toLocaleDateString('es-ES')}</p><h2>{verdict}</h2>{!!missing.length && <p>Pruebas pendientes: {missing.join('; ')}.</p>}{records.map(r => <RecordResult key={r.id} record={r} detailed={false} />)}<p className="gamma-hint">Informe gamma-qc-1.0. Las tolerancias proceden de los perfiles y referencias indicados en cada prueba. La revisión tomográfica es visual y debe ser confirmada por el especialista.</p></section>}
    {!monthly && <details className="calc-card gamma-no-print"><summary>Método y alcance</summary><p>{mode === 'resolution' ? 'Medición adaptada a una fuente lineal: máximo muestreado, cruces lineales al 50 % y al 10 %, media de cinco perfiles de hasta ocho píxeles de ancho. Se usa PixelSpacing en lugar de una calibración por separación entre fuentes. No equivale a una aceptación NEMA completa ni al procedimiento completo IAEA con varias fuentes y posiciones.' : 'Sensibilidad = (cuentas/tiempo − tasa de fondo) / actividad media. Actividad inicial y residual se corrigen a un instante común y se integra el decaimiento durante la exposición. Se requieren la actividad medida, su fecha/hora y el semiperiodo; no se presuponen a partir del nombre del DICOM.'}</p><a href="https://www-pub.iaea.org/MTCD/Publications/PDF/Pub1394_web.pdf" target="_blank" rel="noreferrer">IAEA HHS 6, §§2.3.8–2.3.9</a></details>}
  </div>
}

export function GammaMonthly() {
  const { loading, isAdmin, user } = useAuthUser()
  const [error, setError] = useState('')
  // Unmount all images and results when access changes; no private browser persistence.
  if (loading) return <div className="page-body"><p>Comprobando la sesión…</p></div>
  if (!isAdmin) return <div className="page-body"><div className="calc-card"><h1>Informe mensual privado</h1><p>{user ? 'Esta cuenta no tiene acceso al informe.' : 'Entra con la cuenta del propietario, como en Examen radio.'}</p><button onClick={async () => { try { await loginWithGoogle() } catch (e) { setError(e.message) } }}>Entrar con Google</button>{error && <p role="alert">{error}</p>}</div></div>
  return <GammaWorkspace key={user.uid} mode="monthly" />
}

export default function GammaCameraQC({ mode }) { return <GammaWorkspace key={mode} mode={mode} /> }
