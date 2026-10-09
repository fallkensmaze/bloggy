import CorProjectionReview from '../components/CorProjectionReview'
import { parseCorDICOM } from '../utils/corDicom'
import CorAcquisitionForm from '../components/CorAcquisitionForm'
import { useMemo, useState } from 'react'
import GammaMonthlyReport from '../components/GammaMonthlyReport'
import TomoUniformity from './TomoUniformity'
import { loadTomoDicomSeries } from '../utils/tomoDicom'
import { proposeCylinder } from '../utils/tomoUniformity'
import { captureTomoReportViews } from '../utils/gammaTomoReport'
import { applyMonthlyReference, buildMonthlyReport } from '../utils/gammaMonthlyReport'
import { matchesMonthlyReference, MONTHLY_REFERENCE_ROWS, MONTHLY_REFERENCE_SOURCE } from '../utils/gammaQcLimits'
import { SENSITIVITY_UNITS } from '../utils/gammaSensitivity'
import GammaImage, { GammaProfiles, tomographyMosaic } from '../components/GammaImage'
import { classifyGamma, parseGammaDicom } from '../utils/gammaDicom'
import { analyzeGammaEntry, initialGammaOptions } from '../utils/gammaBatch'
import { locateLine } from '../utils/gammaResolution'
import { GAMMA_TESTS, tomographyPrompt, validateMonthlyBatch } from '../utils/gammaReport'
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
        <Choice label="Comparación de sensibilidad" value={frameOptions.sensitivityComparison} onChange={v => setFrame('sensitivityComparison', v)}><option value="reference">Desviación respecto a referencia</option><option value="minimum">Límite mínimo absoluto</option></Choice>
        <Choice label="Unidad del resultado y del límite" value={frameOptions.sensitivityUnit} onChange={v => {
          set('frameOptions', { ...o.frameOptions, [frameIndex]: { ...o.frameOptions[frameIndex], sensitivityUnit: v, minimumSensitivity: '', referenceSensitivity: '' } })
        }}>{SENSITIVITY_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}</Choice>
        {frameOptions.sensitivityComparison === 'minimum'
          ? <Field label={`Sensibilidad mínima (${frameOptions.sensitivityUnit})`} value={frameOptions.minimumSensitivity} min="0" onChange={v => setFrame('minimumSensitivity', v)} />
          : <><Field label={`Sensibilidad de referencia (${frameOptions.sensitivityUnit})`} value={frameOptions.referenceSensitivity} min="0" onChange={v => setFrame('referenceSensitivity', v)} />
            <Field label="Desviación máxima respecto a referencia (%)" value={frameOptions.sensitivityTolerance} min="0" onChange={v => setFrame('sensitivityTolerance', v)} /></>}
      </div>
      <p className="gamma-hint">Se suman todas las cuentas de cada frame, se resta su fondo y se divide por el tiempo y la actividad media durante la adquisición. La incertidumbre mostrada solo incluye estadística de conteo. La actividad DICOM no se usa como medida del activímetro.</p>
      <p className="gamma-hint">1 cps/MBq = 2,22 cpm/µCi. Al cambiar de unidad se borran los límites de ese cabezal para que puedas introducirlos en la unidad elegida.</p>
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
    {type === 'cor' && <><div className="gamma-fields"><Field label="Límite δCOR (mm) · individual y entre cabezales" value={o.corLimit} min="0" step="0.0001" onChange={v => set('corLimit', v)} />
      <Field label="Límite δAXIAL (mm) · individual y entre cabezales" value={o.axialLimit} min="0" step="0.0001" onChange={v => set('axialLimit', v)} /></div><p className="gamma-hint">Método de tres fuentes puntuales. Se conservan las cuatro cotas NEMA y sus comprobaciones de adquisición.</p><CorAcquisitionForm value={o.corDeclaration} onChange={v => set('corDeclaration', v)} /></>}
    {type === 'tomography' && <><div className="gamma-fields">
      <Field label="Uniformidad tomográfica del protocolo (%)" value={o.tomoUniformityPercent} min="0" onChange={v => set('tomoUniformityPercent', v)} />
      <Field label="Tolerancia de uniformidad tomográfica (%)" value={o.tomoLimitPercent} min="0" onChange={v => set('tomoLimitPercent', v)} />
      <Field label="Definición de la medida tomográfica" type="text" value={o.tomoUniformityDefinition} onChange={v => set('tomoUniformityDefinition', v)} placeholder="Fórmula, normalización y tamaño de las ROI/VOI del protocolo" />
      </div><p className="gamma-hint">El Excel fija un máximo del 10 %, pero no define la fórmula. Registra la medida y su definición; el límite no se aplica automáticamente a la curva U3D ni a todos sus diámetros.</p>
      <label className="gamma-field"><span>Hallazgos de la revisión tomográfica</span><textarea className="dark-input" rows="4" value={o.tomoObservations} onChange={e => set('tomoObservations', e.target.value)} placeholder="Fantoma, cortes revisados, uniformidad visual, anillos, defectos, resolución/contraste visual y comparación con referencia…" /></label>
      <Choice label="Valoración del especialista" value={o.tomoVerdict} onChange={v => set('tomoVerdict', v)}><option value="">Pendiente de revisión</option><option value="Conforme">Conforme según protocolo visual</option><option value="No conforme">No conforme</option></Choice></>}
    {type !== 'unknown' && <>
      <Field label="Protocolo y condiciones (colimador, distancia, ventana, fantoma/reconstrucción)" type="text" value={o.protocol} onChange={v => set('protocol', v)} />
      {type !== 'uniformity' && <Field label="Procedencia y versión de las tolerancias" type="text" value={o.limitSource} onChange={v => set('limitSource', v)} placeholder="Protocolo del servicio / especificación de fabricante / referencia de aceptación" />}
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
    {!!record.metrics.length && <div className="gamma-table-scroll"><table><thead><tr><th>Magnitud</th><th>Resultado</th><th>Tolerancia</th></tr></thead><tbody>{record.metrics.map(m => <tr key={m.key}><td>{m.label}</td><td>{fmt(m.value)} {m.unit}</td><td>{m.limit == null ? 'Sin límite' : `${m.operator === 'min' ? '≥' : '≤'} ${fmt(m.limit, record.type === 'cor' ? 4 : 2)} ${m.unit}`}</td></tr>)}</tbody></table></div>}
    {detailed && record.details?.profiles && <GammaProfiles result={record.details} />}
    {record.type === 'sensitivity' && record.details && <p className="gamma-hint">{fmt(record.details.totalCounts, 0)} cuentas / {fmt(record.details.durationSeconds)} s · tasa neta {fmt(record.details.netCps)} cps · A media {fmt(record.details.meanActivityMBq)} MBq · u estadística {fmt(record.details.statisticalUncertainty)} cps/MBq</p>}
    {record.details?.warnings?.map(w => <p className="gamma-warning" key={w}>{w}</p>)}
    {detailed && record.details?.profiles && <p className="gamma-hint">FWHM entre franjas: {fmt(record.details.fwhmMinMm)}–{fmt(record.details.fwhmMaxMm)} mm · inclinación {fmt(record.details.tiltDegrees, 2)}° · píxel {fmt(record.details.spacing, 4)} mm</p>}
    {record.details?.checks && <details><summary>Comprobaciones de adquisición</summary><ul>{record.details.checks.map(c => <li key={c.id}>{c.label}: {c.status} · {String(c.value ?? '')} · {c.detail}</li>)}</ul></details>}
    {record.type === 'cor' && record.details && <details><summary>Comprobaciones COR</summary><pre>{JSON.stringify(record.details.acquisition, null, 2)}</pre></details>}
    <p className="gamma-hint">{record.method || 'Análisis pendiente'} · {record.file} · {record.acquiredAt} · {record.window || ''} · {record.collimator || ''}</p>
    {(record.protocol || record.limitSource) && <p className="gamma-hint">Protocolo: {record.protocol || 'sin registrar'} · Límites: {record.limitSource || 'sin registrar'}</p>}
    {record.notes && <p>{record.notes}</p>}
  </article>
}

function FilePreview({ entry, frameIndex, setFrameIndex, update, privateReport }) {
  const [windowFraction, setWindowFraction] = useState(1), [aiMessage, setAiMessage] = useState(''), [prompt, setPrompt] = useState('')
  const image = entry.image, frame = image.frameInfo[frameIndex]
  const corSeries = useMemo(() => {
    if (entry.type !== 'cor') return null
    try { return parseCorDICOM(entry.buffer) } catch { return null }
  }, [entry.type, entry.buffer])
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
    {corSeries && <CorProjectionReview series={corSeries} results={entry.records?.[0]?.details} />}
  </div><FileSettings entry={entry} frameIndex={frameIndex} update={update} /></div>
}

export function GammaWorkspace({ mode }) {
  const monthly = mode === 'monthly'
  const [entries, setEntries] = useState([]), [selectedId, setSelectedId] = useState(''), [frameIndex, setFrameIndex] = useState(0)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [reportVisible, setReportVisible] = useState(false)
  const [expectedHeads, setExpectedHeads] = useState('2'), [responsible, setResponsible] = useState('')
  const [resolutionCriterion, setResolutionCriterion] = useState('mean'), [includeAnnex, setIncludeAnnex] = useState(true)
  const [details, setDetails] = useState({ hospital: 'Hospital Universitario Puerta de Hierro Majadahonda',
    service: 'Servicio de Radiofísica y Protección Radiológica', camera: '', serial: '', room: '', conclusion: '' })
  const [logo, setLogo] = useState(''), [dailyImage, setDailyImage] = useState('')
  const batch = useMemo(() => validateMonthlyBatch(entries), [entries])
  const active = entries.find(e => e.id === selectedId)
  const detectedHeads = Math.max(1, ...entries.flatMap(e => e.image?.frameInfo.map(f => f.detectorNumber || 1) || []))
  const heads = Array.from({ length: Math.max(Number(expectedHeads), detectedHeads) }, (_, i) => i + 1)
  const report = buildMonthlyReport(entries, heads, resolutionCriterion)
  const records = monthly ? report.records : entries.flatMap(e => e.records || [])
  const pending = entries.some(e => !e.records?.length || e.type === 'unknown')
  const exclusionsNeedReason = entries.some(e => e.included === false && !e.exclusionReason?.trim())
  const referenceMatches = entries.length > 0 && entries.every(e => matchesMonthlyReference(e.image))
  const canPrepare = !busy && batch.valid && entries.some(e => e.included !== false) && !report.conflicts.length && !exclusionsNeedReason
  const reportImages = entries.filter(e => e.included !== false && e.type === 'tomography').flatMap(e => e.reportImages || [])
  function changeEntries(next) { setEntries(next); setReportVisible(false) }
  function updateEntry(id, patch) {
    changeEntries(previous => previous.map(e => e.id === id ? { ...e, ...patch, records: null, analysisError: '' } : e))
  }
  function patchReport(id, patch) { changeEntries(previous => previous.map(e => e.id === id ? { ...e, ...patch } : e)) }
  function updateDetails(key, value) { setDetails(d => ({ ...d, [key]: value })); setReportVisible(false) }
  async function calculate(list) {
    if (monthly && !validateMonthlyBatch(list).valid) {
      setMessage('Análisis bloqueado: corrige los archivos del lote.')
      return list.map(e => ({ ...e, records: null }))
    }
    const next = []
    for (const entry of list) {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (!entry.image || entry.type === 'unknown') { next.push(entry); continue }
      try { next.push({ ...entry, records: analyzeGammaEntry(entry), analysisError: '' }) }
      catch (error) { next.push({ ...entry, records: null, analysisError: error.message }) }
    }
    return next
  }
  async function prepareTomography(buffer) {
    try {
      const tomoSeries = await loadTomoDicomSeries([{ arrayBuffer: async () => buffer }])
      const cylinder = proposeCylinder(tomoSeries)
      const cursor = [Math.round(cylinder.cx), Math.round(cylinder.cy), Math.floor((cylinder.firstSlice + cylinder.lastSlice) / 2)]
      let maximum = 0; for (const frame of tomoSeries.volume) for (const v of frame) maximum = Math.max(maximum, v)
      return { tomoSeries, tomoError: '', reportImages: captureTomoReportViews(tomoSeries, cursor, maximum || 1, cylinder) }
    } catch (e) { return { tomoSeries: null, tomoError: e.message, reportImages: [] } }
  }
  async function setType(entry, type) {
    setBusy(true)
    try {
      const fresh = { ...entry, type, options: initialGammaOptions(entry.image) }
      const configured = monthly && matchesMonthlyReference(entry.image) ? applyMonthlyReference(fresh) : fresh
      updateEntry(entry.id, { type, options: configured.options, tomoQuantitative: null,
      ...(type === 'tomography' ? await prepareTomography(entry.buffer) : { tomoSeries: null, tomoError: '', reportImages: [] }) }) }
    finally { setBusy(false) }
    setFrameIndex(0)
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
          const entry = { id, name: file.name, buffer, image, type, included: true, exclusionReason: '',
            options: initialGammaOptions(image), records: null,
            ...(type === 'tomography' ? await prepareTomography(buffer) : {}) }
          next.push(monthly && matchesMonthlyReference(image) ? applyMonthlyReference(entry) : entry)
        } catch (error) { next.push({ id, name: file.name, error: error.message, type: 'unknown', included: true }) }
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      const valid = !monthly || validateMonthlyBatch(next).valid
      changeEntries(valid ? await calculate(next) : next.map(e => ({ ...e, records: null })))
      setSelectedId(next.find(e => e.image)?.id || ''); setFrameIndex(0)
      setMessage(valid ? 'Carga completada. Revisa las mediciones y completa los datos pendientes.' : 'Análisis bloqueado: los archivos no forman un lote de un mismo equipo y mes.')
    } finally { setBusy(false) }
  }
  async function run() {
    setBusy(true); setMessage('Analizando las pruebas…')
    try { changeEntries(await calculate(entries)); setMessage('Análisis actualizado. Revisa las advertencias y las pruebas pendientes.') }
    finally { setBusy(false) }
  }
  async function useReference() {
    if (!referenceMatches) return
    setBusy(true)
    try { changeEntries(await calculate(entries.map(applyMonthlyReference))); setMessage('Tolerancias del Excel de Sala 1 restablecidas. Revisa las condiciones de adquisición de cada prueba.') }
    finally { setBusy(false) }
  }
  async function uploadIllustration(file, setter) {
    if (!file) return
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Selecciona una imagen PNG/JPEG de hasta 5 MB.')
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close()
      setter(canvas.toDataURL('image/png')); setReportVisible(false)
    } catch (e) { setMessage(e.message) }
  }
  function exportResults() {
    const payload = { schema: 'gamma-qc-report/2', createdAt: new Date().toISOString(), mode,
      ...(monthly ? { month: batch.month, equipment: batch.equipment, responsible, details, report, reportImages,
        dailyImage: dailyImage || null, logo: logo || null, includeAnnex } : {}), records }
    download(monthly ? `informe-gammacamara-${batch.month}.json` : `gammacamara-${mode}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  }
  return <div className={`page-body gamma-qc ${reportVisible ? 'gamma-print-ready' : ''}`}>
    <div className="page-header gamma-no-print"><div className="page-icon"><i className={`bi ${monthly ? 'bi-calendar-check' : mode === 'resolution' ? 'bi-crosshair' : 'bi-speedometer2'}`}></i></div>
      <h1 className="page-title">{monthly ? 'Informe mensual de gammacámara' : GAMMA_TESTS[mode]}</h1><p className="page-subtitle">{monthly ? 'Área privada · un equipo, un mes y todas sus pruebas' : mode === 'resolution' ? 'Fuentes lineales · FWHM y FWTM por cabezal y eje' : 'Cuentas por segundo y MBq · fondo y decaimiento'}</p></div>
    <section className="calc-card gamma-no-print">
      <label className={`gamma-upload${busy ? ' gamma-upload-busy' : ''}`}><i className="bi bi-files" aria-hidden="true"></i><strong>{monthly ? 'Añadir todos los DICOM del mes' : 'Añadir imágenes DICOM'}</strong>
        <span>Selecciona varios archivos · procesamiento en este navegador</span><span className="gamma-upload-action"><i className="bi bi-folder2-open" aria-hidden="true"></i>{busy ? 'Procesando…' : 'Elegir archivos DICOM'}</span>
        <input className="gamma-upload-input" aria-label="Cargar DICOM del control" type="file" multiple accept=".dcm,application/dicom" disabled={busy} onChange={e => { loadFiles([...e.target.files]); e.target.value = '' }} />
      </label>
      <p className="gamma-hint">Las imágenes y los resultados permanecen en esta pestaña. Descarga el informe antes de cerrarla; no se guardan en un servidor.</p>
      {monthly && entries.length > 0 && <div className={`gamma-validation ${batch.valid ? 'pass' : 'fail'}`}><strong>{batch.valid ? `Lote verificado · ${batch.month} · ${batch.equipment}` : 'Lote incompatible: no se iniciará el análisis'}</strong>{batch.errors.length > 0 && <ul>{batch.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}<p>Se usa la fecha de adquisición y los identificadores StationName/DeviceSerialNumber, no el nombre del archivo ni la fecha de exportación.</p></div>}
      {entries.length > 0 && <div className="gamma-table-scroll"><table><thead><tr>{monthly && <th>Informe</th>}<th>Archivo / adquisición</th><th>Prueba</th><th>Estado</th><th></th></tr></thead><tbody>{entries.map(e => <tr key={e.id} className={`${selectedId === e.id ? 'gamma-selected' : ''} ${e.included === false ? 'gamma-file-excluded' : ''}`}>
        {monthly && <td><label><input type="checkbox" aria-label={`Incluir ${e.name}`} checked={e.included !== false} disabled={busy} onChange={v => patchReport(e.id, { included: v.target.checked })}/> Incluir</label>{e.included === false && <Field label="Motivo de exclusión" aria-label={`Motivo de exclusión de ${e.name}`} type="text" value={e.exclusionReason} onChange={v => patchReport(e.id, { exclusionReason: v })}/>}</td>}
        <td><button className="gamma-file-button" disabled={!e.image || busy} onClick={() => { setSelectedId(e.id); setFrameIndex(0) }}>{e.name}</button><small>{e.image?.metadata.acquiredAt || 'Fecha desconocida'} · {e.image?.metadata.equipment || 'Sin identificar'}</small></td>
        <td>{monthly && e.image ? <select className="dark-select" aria-label={`Tipo de prueba de ${e.name}`} disabled={busy} value={e.type} onChange={event => setType(e, event.target.value)}>{Object.entries(GAMMA_TESTS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select> : GAMMA_TESTS[e.type]}</td>
        <td>{e.error || e.analysisError || (e.records ? [...new Set(e.records.map(r => r.status))].join(' · ') : 'Pendiente')}</td><td><button disabled={busy} aria-label={`Retirar ${e.name}`} onClick={() => { changeEntries(entries.filter(v => v.id !== e.id)); if (selectedId === e.id) { setSelectedId(''); setFrameIndex(0) } }}>Retirar</button></td>
      </tr>)}</tbody></table></div>}
      <div className="gamma-actions"><button className="gamma-primary" disabled={busy || !entries.length || (monthly && !batch.valid)} onClick={run}>{busy ? 'Procesando…' : 'Analizar / actualizar todas las pruebas'}</button>
        {monthly && <button disabled={busy || !batch.valid || !referenceMatches} onClick={useReference}>Restablecer tolerancias del Excel · Sala 1</button>}
        {!monthly && <button disabled={!records.length || pending || busy} onClick={exportResults}>Descargar resultados JSON</button>}</div>
      {monthly && <details className="gamma-reference"><summary>Tolerancias del Excel · Sala 1 · 2026</summary>
        <p className="gamma-hint">{MONTHLY_REFERENCE_SOURCE}. Se precargan al reconocer la cámara 1660 en adquisiciones de 2026. Puedes revisar los límites de cada archivo; las condiciones de adquisición requieren tu confirmación.</p>
        {entries.length > 0 && !referenceMatches && <p className="gamma-warning">El lote no coincide por completo con Sala 1 (1660), año 2026. Revisa las tolerancias para el equipo y periodo cargados.</p>}
        <div className="gamma-table-scroll"><table><thead><tr><th>Prueba</th><th>Criterio del Excel</th><th>Celdas</th></tr></thead><tbody>{MONTHLY_REFERENCE_ROWS.map(r => <tr key={r.type}><td>{r.label}</td><td>{r.criterion}</td><td>{r.cells}</td></tr>)}</tbody></table></div>
        <p className="gamma-hint">Se comparan los valores sin redondear. COR: los resúmenes calculan 1,1988 mm; las hojas mensuales muestran 1,2 mm. La correspondencia integral/diferencial sigue las hojas mensuales y «Resumen mensuales».</p>
      </details>}
      <p role="status" aria-live="polite">{message}</p>
    </section>
    {active?.image && <section className="calc-card gamma-no-print"><h2>{GAMMA_TESTS[active.type]} · {active.image.metadata.description}</h2>
      <fieldset disabled={busy} className="gamma-fieldset"><FilePreview key={active.id + active.type} entry={active} frameIndex={Math.min(frameIndex, active.image.frames.length - 1)} setFrameIndex={setFrameIndex} update={options => updateEntry(active.id, { options })} privateReport={monthly} /></fieldset>
      {(active.analysisError || active.tomoError) && <p className="gamma-warning">{active.analysisError || active.tomoError}</p>}{active.records?.filter(r => r.frameIndex == null || r.frameIndex === frameIndex).map(r => <RecordResult key={r.id} record={r} />)}
      {monthly && active.type === 'tomography' && active.tomoSeries && <details className="tomo-details"><summary>Explorar los tres planos y añadir el análisis de esferas 3D</summary>
        <TomoUniformity key={active.id} embeddedSeries={active.tomoSeries} savedResult={active.tomoQuantitative}
          onResult={result => updateEntry(active.id, { tomoQuantitative: result })} onCapture={images => patchReport(active.id, { reportImages: images })}/>
      </details>}
    </section>}
    {monthly && batch.valid && <section className="calc-card gamma-no-print"><h2>Informe del mes</h2>
      <div className="gamma-fields"><Choice label="Número de cabezales que deben estar completos" value={expectedHeads} onChange={v => { setExpectedHeads(v); setReportVisible(false) }}><option value="1">1 cabezal</option><option value="2">2 cabezales</option><option value="3">3 cabezales</option></Choice>
        <Field label="Responsable del informe" type="text" value={responsible} onChange={v => { setResponsible(v); setReportVisible(false) }}/>
        <Field label="Nombre de la gammacámara" type="text" value={details.camera} placeholder={batch.equipment} onChange={v => updateDetails('camera', v)}/>
        <Field label="Número de serie para el informe" type="text" value={details.serial} onChange={v => updateDetails('serial', v)}/>
        <Field label="Sala" type="text" value={details.room} onChange={v => updateDetails('room', v)}/>
        <Choice label="Comparación de resolución en el resumen" value={resolutionCriterion} onChange={v => { setResolutionCriterion(v); setReportVisible(false) }}><option value="mean">Media X/Y · como el informe de referencia</option><option value="each">Cada eje por separado</option></Choice>
      </div>
      <details><summary>Cabecera, imágenes y observaciones</summary><div className="gamma-fields">
        <Field label="Centro" type="text" value={details.hospital} onChange={v => updateDetails('hospital', v)}/><Field label="Servicio" type="text" value={details.service} onChange={v => updateDetails('service', v)}/>
        <label className="gamma-field"><span>Logotipo (opcional, PNG/JPEG)</span><input aria-label="Logotipo del informe" type="file" accept="image/png,image/jpeg" onChange={e => { uploadIllustration(e.target.files[0], setLogo); e.target.value = '' }}/>{logo && <button onClick={() => { setLogo(''); setReportVisible(false) }}>Retirar logotipo</button>}</label>
        <label className="gamma-field"><span>Imagen QC diario (opcional, PNG/JPEG)</span><input aria-label="Imagen QC diario" type="file" accept="image/png,image/jpeg" onChange={e => { uploadIllustration(e.target.files[0], setDailyImage); e.target.value = '' }}/>{dailyImage && <button onClick={() => { setDailyImage(''); setReportVisible(false) }}>Retirar imagen QC diario</button>}</label>
      </div><label className="gamma-field"><span>Observaciones generales</span><textarea className="dark-input" rows="3" value={details.conclusion} onChange={e => updateDetails('conclusion', e.target.value)}/></label></details>
      <Check label="Incluir anexo de trazabilidad y comprobaciones" value={includeAnnex} onChange={v => { setIncludeAnnex(v); setReportVisible(false) }}/>
      <p><span className={`gamma-badge ${statusClass(report.verdict)}`}>{report.verdict}</span></p>
      {!!report.missing.length && <p className="gamma-warning">Faltan: {report.missing.join('; ')}.</p>}
      {report.conflicts.map((c, i) => <p key={i} className="gamma-warning">Hay {c.files.length} adquisiciones de {GAMMA_TESTS[c.type]} {c.detector ? `H${c.detector}` : ''} {c.axis || ''}. Elige cuál incluir en el informe; las otras se conservan como excluidas con su motivo.</p>)}
      {exclusionsNeedReason && <p className="gamma-warning">Indica el motivo de cada adquisición excluida antes de preparar el informe.</p>}
      <p className="gamma-hint">Resumen con las cinco pruebas y tablas por cabezal. Se puede emitir con datos pendientes, que quedan señalados. Los cortes iniciales son una selección central editable desde la exploración tomográfica.</p>
      <div className="gamma-actions"><button disabled={!canPrepare} onClick={() => setReportVisible(true)}>Preparar informe</button><button disabled={!canPrepare} onClick={exportResults}>Descargar informe JSON</button>{reportVisible && <button onClick={() => window.print()}>Imprimir / guardar PDF</button>}</div>
    </section>}
    {monthly && reportVisible && batch.valid && <GammaMonthlyReport model={report} batch={batch} details={details} responsible={responsible} images={reportImages} logo={logo} dailyImage={dailyImage} includeAnnex={includeAnnex}/>}
    {!monthly && <details className="calc-card gamma-no-print"><summary>Método y alcance</summary><p>{mode === 'resolution' ? 'Medición adaptada a una fuente lineal: máximo muestreado, cruces lineales al 50 % y al 10 %, media de cinco perfiles de hasta ocho píxeles de ancho. Se usa PixelSpacing en lugar de una calibración por separación entre fuentes. No equivale a una aceptación NEMA completa ni al procedimiento completo IAEA con varias fuentes y posiciones.' : 'Sensibilidad = (cuentas/tiempo − tasa de fondo) / actividad media. Actividad inicial y residual se corrigen a un instante común y se integra el decaimiento durante la exposición. La comparación permite límite mínimo absoluto o desviación respecto a referencia, con unidades explícitas.'}</p><a href="https://www-pub.iaea.org/MTCD/Publications/PDF/Pub1394_web.pdf" target="_blank" rel="noreferrer">IAEA HHS 6, §§2.3.8–2.3.9</a></details>}
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
