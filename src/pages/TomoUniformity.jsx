import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js'
import { Line } from 'react-chartjs-2'
import { loadTomoDicomSeries } from '../utils/tomoDicom.js'
import { diameterRange, makeTomoDemo, measureSphere, proposeCylinder, tomoResultsCsv, validateCylinder } from '../utils/tomoUniformity.js'
import { TomoGeometry3D, TomoVolumeViews, TOMO_COLORS } from '../components/TomoVolumeViews.jsx'
import '../styles/gamma-qc.css'
import '../styles/tomo-uniformity.css'

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend)
const numeric = v => String(v ?? '').trim() === '' ? NaN : Number(v)
const fmt = (v, digits = 2) => Number.isFinite(v) ? v.toFixed(digits) : '—'
const position = p => p.map(v => v + 1).join(', ')
const defaultRange = { min: '10', max: '60', step: '10', stride: '1', centerMode: 'per-diameter', notes: '' }

function Field({ label, value, onChange, step = 'any', min, max }) {
  return <label className="gamma-field"><span>{label}</span><input className="dark-input" type="number" step={step} min={min} max={max} value={value} onChange={e => onChange(e.target.value)} /></label>
}

function save(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a')
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function curveData(result, normalized) {
  const values = result.results, ref = result.reference.mean
  return { datasets: [
    { label: 'Máximo de las medias', borderColor: TOMO_COLORS.maximum, backgroundColor: TOMO_COLORS.maximum,
      data: values.map(r => ({ x: r.diameterMm, y: r.valid ? r.maximum.mean * (normalized ? 100 / ref : 1) : null })) },
    { label: 'Mínimo de las medias', borderColor: TOMO_COLORS.minimum, backgroundColor: TOMO_COLORS.minimum,
      data: values.map(r => ({ x: r.diameterMm, y: r.valid ? r.minimum.mean * (normalized ? 100 / ref : 1) : null })) },
    { label: 'Media del volumen de referencia', borderColor: '#a5caa4', pointRadius: 0, borderDash: [6, 5],
      data: values.map(r => ({ x: r.diameterMm, y: normalized ? 100 : ref })) },
  ].map(d => ({ ...d, borderWidth: 2, pointRadius: d.pointRadius ?? 4, tension: 0, spanGaps: false })) }
}

export default function TomoUniformity() {
  const [series, setSeries] = useState(null), [form, setForm] = useState(null), [range, setRange] = useState(defaultRange)
  const [confirmed, setConfirmed] = useState(false), [cursor, setCursor] = useState([0, 0, 0])
  const [probeDiameter, setProbeDiameter] = useState('20'), [probes, setProbes] = useState([])
  const [windowMax, setWindowMax] = useState(150), [showOverlays, setShowOverlays] = useState(true)
  const [result, setResult] = useState(null), [selectedDiameter, setSelectedDiameter] = useState(null)
  const [normalized, setNormalized] = useState(true), [error, setError] = useState(''), [status, setStatus] = useState('')
  const [probeError, setProbeError] = useState('')
  const [busy, setBusy] = useState(false), [fraction, setFraction] = useState(null)
  const worker = useRef(null), epoch = useRef(0), nextProbe = useRef(1)
  const cylinder = useMemo(() => form ? {
    cx: numeric(form.cx) - 1, cy: numeric(form.cy) - 1, radiusMm: numeric(form.radiusMm),
    firstSlice: numeric(form.firstSlice) - 1, lastSlice: numeric(form.lastSlice) - 1,
    radialMarginMm: numeric(form.radialMarginMm), axialMarginMm: numeric(form.axialMarginMm),
  } : null, [form])
  const selected = result?.results.find(r => r.valid && r.diameterMm === selectedDiameter)
  const spheres = useMemo(() => [
    ...probes.map(p => ({ ...p, color: TOMO_COLORS.manual })),
    ...(selected ? [{ ...selected.minimum, diameterMm: selected.diameterMm, color: TOMO_COLORS.minimum },
      { ...selected.maximum, diameterMm: selected.diameterMm, color: TOMO_COLORS.maximum }] : []),
    ...(numeric(probeDiameter) > 0 ? [{ center: cursor, diameterMm: numeric(probeDiameter), color: '#eeeeee' }] : []),
  ], [probes, selected, cursor, probeDiameter])

  useEffect(() => () => { epoch.current++; worker.current?.terminate() }, [])
  function stop() { epoch.current++; worker.current?.terminate(); worker.current = null; setBusy(false); setFraction(null) }
  function invalidate() { stop(); setResult(null); setSelectedDiameter(null); setStatus(''); setError(''); setProbeError('') }
  function updateForm(key, value) { invalidate(); setConfirmed(false); setProbes([]); setForm(f => ({ ...f, [key]: value })) }
  function updateRange(key, value) { invalidate(); setRange(r => ({ ...r, [key]: value })) }

  function installSeries(value) {
    const c = proposeCylinder(value)
    setSeries(value); setForm(Object.fromEntries(Object.entries(c).map(([key, v]) => [key,
      String(['cx', 'cy', 'firstSlice', 'lastSlice'].includes(key) ? v + 1 : v)])))
    setRange(defaultRange); setProbes([]); setConfirmed(Boolean(value.info?.demo)); nextProbe.current = 1
    setCursor([Math.round(c.cx), Math.round(c.cy), Math.floor((c.firstSlice + c.lastSlice) / 2)])
    let peak = 0; for (const frame of value.volume) for (const v of frame) peak = Math.max(peak, v)
    setWindowMax(Math.max(1, Math.ceil(peak * 100) / 100)); setProbeDiameter('20'); setStatus('Volumen preparado. Revisa el cilindro en los tres planos.')
  }

  async function load(files) {
    if (!files.length) return
    invalidate(); setSeries(null); setForm(null); setBusy(true)
    const id = epoch.current
    try {
      const value = await loadTomoDicomSeries(files, text => {
        if (epoch.current !== id) throw new Error('Carga cancelada.')
        setStatus(text)
      })
      if (epoch.current === id) installSeries(value)
    } catch (e) { if (epoch.current === id) { setError(e.message); setStatus('') } }
    finally { if (epoch.current === id) setBusy(false) }
  }

  function analyze() {
    invalidate()
    try {
      validateCylinder(series, cylinder)
      if (!confirmed) throw new Error('Confirma la geometría y la región uniforme antes del barrido.')
      const config = { cylinder, diametersMm: diameterRange(numeric(range.min), numeric(range.max), numeric(range.step)),
        stride: numeric(range.stride), centerMode: range.centerMode, notes: range.notes }
      const id = epoch.current, task = new Worker(new URL('../utils/tomoUniformity.worker.js', import.meta.url), { type: 'module' })
      worker.current = task; setBusy(true); setFraction(0); setStatus('Preparando el barrido 3D…')
      task.onmessage = ({ data }) => {
        if (id !== epoch.current) return
        if (data.type === 'progress') { setFraction(data.progress.fraction); setStatus(`Barriendo esferas de ${data.progress.diameterMm} mm…`) }
        else {
          task.terminate(); worker.current = null; setBusy(false); setFraction(null)
          if (data.type === 'error') { setError(data.message); setStatus('') }
          else { setResult(data.result); setSelectedDiameter(data.result.results.find(r => r.valid).diameterMm); setStatus('Barrido 3D terminado.') }
        }
      }
      task.onerror = () => { if (id === epoch.current) { stop(); setError('No se ha podido completar el cálculo. Reduce el volumen o el rango de diámetros.'); setStatus('') } }
      task.postMessage({ series, config })
    } catch (e) { setError(e.message) }
  }

  function addProbe() {
    try {
      if (!confirmed) throw new Error('Revisa y confirma primero el cilindro.')
      const p = measureSphere(series, cylinder, cursor, numeric(probeDiameter))
      if (probes.length >= 20) throw new Error('Puedes conservar hasta 20 esferas manuales. Retira alguna para añadir otra.')
      const id = nextProbe.current++
      setProbes(old => [...old, { ...p, id }]); setProbeError('')
    } catch (e) { setProbeError(e.message) }
  }

  function locate(row, which) { setSelectedDiameter(row.diameterMm); setProbeDiameter(String(row.diameterMm)); setCursor([...row[which].center]) }
  const validRows = result?.results.filter(r => r.valid) || []
  const exportResult = () => ({ ...result, manualSpheres: probes, sourceWarnings: series.warnings,
    coordinateConvention: 'Centros [columna,fila,corte] desde 0. La interfaz muestra índices desde 1.',
    visualReview: 'Revisar los cortes originales; el resultado cuantitativo no certifica conformidad.' })

  return <div className="page-body gamma-qc tomo-qc">
    <div className="page-header"><h1 className="page-title">Uniformidad tomográfica 3D</h1>
      <p className="page-subtitle">SPECT · esferas móviles dentro de un cilindro uniforme</p></div>
    <div className="tomo-intro"><span className="gamma-badge pending">Método complementario</span>
      <p>Busca las regiones esféricas con mayor y menor <strong>valor medio</strong> en el volumen reconstruido, para distintos diámetros. Cada esfera integra vóxeles de varios cortes.</p></div>
    <section className="calc-card">
      <h2>1. Cargar el volumen reconstruido</h2>
      <label className={`gamma-upload ${busy ? 'gamma-upload-busy' : ''}`}>
        <i className="bi bi-stack" aria-hidden="true" /><strong>DICOM SPECT reconstruido</strong>
        <span>Un archivo multiframe o todos los cortes de una única serie NM RECON TOMO, sin comprimir.</span>
        <span className="gamma-upload-action">Seleccionar DICOM</span>
        <input className="gamma-upload-input" aria-label="Cargar volumen SPECT" type="file" multiple disabled={busy}
          onChange={e => { load(Array.from(e.target.files)); e.target.value = '' }} />
      </label>
      <div className="gamma-actions"><button disabled={busy} onClick={() => { invalidate(); installSeries(makeTomoDemo()) }}>Probar con cilindro sintético</button></div>
      <p className="gamma-hint">Procesamiento local en esta pestaña. La entrada es una reconstrucción 3D; las proyecciones angulares no son cortes espaciales.</p>
    </section>
    {error && <div className="gamma-validation fail" role="alert">{error}</div>}
    <div role="status" aria-live="polite" className="tomo-status">{status}</div>
    {fraction !== null && <progress max="1" value={fraction} aria-label="Progreso del barrido" />}
    {busy && <button className="tomo-cancel" onClick={() => { stop(); setStatus('Operación cancelada.'); }}>Cancelar</button>}
    {series && <>
      <div className="tomo-metadata"><strong>{series.info?.demo ? 'DEMOSTRACIÓN SINTÉTICA' : series.info.equipment}</strong>
        <span>{series.cols} × {series.rows} × {series.volume.length} vóxeles</span>
        <span>X / Y / Z: {fmt(series.pixelSpacing[1], 3)} / {fmt(series.pixelSpacing[0], 3)} / {fmt(series.dz, 3)} mm</span>
        <span>Valores: {series.units}</span></div>
      {series.warnings.length > 0 && <details className="tomo-details"><summary>Observaciones de la importación ({series.warnings.length})</summary><ul>{series.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
      <section className="calc-card"><h2>2. Delimitar el cilindro y el margen</h2>
        <fieldset className="gamma-fieldset" disabled={busy}><div className="tomo-fields">
          <Field label="Centro X (columna, desde 1)" value={form.cx} onChange={v => updateForm('cx', v)} />
          <Field label="Centro Y (fila, desde 1)" value={form.cy} onChange={v => updateForm('cy', v)} />
          <Field label="Radio interior del cilindro (mm)" value={form.radiusMm} min="0" onChange={v => updateForm('radiusMm', v)} />
          <Field label="Primer corte de región uniforme" value={form.firstSlice} min="1" max={series.volume.length} step="1" onChange={v => updateForm('firstSlice', v)} />
          <Field label="Último corte de región uniforme" value={form.lastSlice} min="1" max={series.volume.length} step="1" onChange={v => updateForm('lastSlice', v)} />
          <Field label="Margen a la pared (mm)" value={form.radialMarginMm} min="0" onChange={v => updateForm('radialMarginMm', v)} />
          <Field label="Margen a cada extremo (mm)" value={form.axialMarginMm} min="0" onChange={v => updateForm('axialMarginMm', v)} />
        </div><p className="gamma-hint">El contorno inicial es una propuesta. Ajusta el radio a la cavidad y selecciona la parte uniforme sin insertos. El eje del cilindro debe ser paralelo a Z. Los extremos se sitúan en las caras externas del primer y último corte seleccionados.</p>
        <label className="gamma-check"><input type="checkbox" checked={confirmed} onChange={e => { invalidate(); setConfirmed(e.target.checked) }} />He revisado el cilindro, su alineación y la región uniforme en los tres planos.</label></fieldset>
        <p className="tomo-margin-explanation">El margen se mide desde la <strong>superficie de cada esfera</strong> hasta la pared y las bases. Las esferas incompletas se excluyen; no se recortan ni se rellenan con ceros.</p>
      </section>
      <section className="calc-card"><h2>3. Explorar y colocar esferas</h2>
        <div className="tomo-legend"><span style={{ color: TOMO_COLORS.cylinder }}>Cilindro</span><span style={{ color: TOMO_COLORS.margin }}>Interior tras el margen</span><span style={{ color: TOMO_COLORS.minimum }}>Mínimo</span><span style={{ color: TOMO_COLORS.maximum }}>Máximo</span><span style={{ color: TOMO_COLORS.manual }}>Manuales</span><span>Blanco: cursor</span></div>
        <TomoVolumeViews series={series} cylinder={cylinder} cursor={cursor} onCursor={setCursor} spheres={spheres} windowMax={windowMax} showOverlays={showOverlays} />
        <div className="tomo-explore"><div>
          <p className="gamma-hint">Pulsa sobre un corte o mueve sus deslizadores. Los contornos son las intersecciones reales de las esferas 3D con cada plano.</p>
          <div className="tomo-fields">
            <Field label="Diámetro de esfera manual (mm)" value={probeDiameter} min="0.1" onChange={setProbeDiameter} />
            <Field label="Máximo de ventana de visualización" value={windowMax} min="0.01" onChange={v => { if (numeric(v) > 0) setWindowMax(numeric(v)) }} />
          </div>
          <label className="gamma-check"><input type="checkbox" checked={showOverlays} onChange={e => setShowOverlays(e.target.checked)} />Mostrar contornos y cursor</label>
          <p>Cursor X, Y, Z: <strong>{position(cursor)}</strong></p>
          <button disabled={busy || !confirmed} onClick={addProbe}>Añadir esfera en el cursor</button>
          {probeError && <p role="alert" className="gamma-warning">{probeError}</p>}
          <p className="gamma-hint">La ventana solo cambia la imagen mostrada. Se conserva la intensidad original para los cálculos, incluidos los valores negativos.</p>
        </div><TomoGeometry3D series={series} cylinder={cylinder} spheres={spheres} /></div>
        {probes.length > 0 && <div className="gamma-table-scroll"><table><thead><tr><th>Esfera</th><th>Diámetro</th><th>Centro X, Y, Z</th><th>Media ({series.units})</th><th>Vóxeles</th><th>Acciones</th></tr></thead><tbody>
          {probes.map(p => <tr key={p.id}><td>{p.id}</td><td>{p.diameterMm} mm</td><td>{position(p.center)}</td><td>{fmt(p.mean, 4)}</td><td>{p.voxelCount}</td><td><button onClick={() => { setCursor(p.center); setProbeDiameter(String(p.diameterMm)) }}>Ver</button> <button onClick={() => setProbes(ps => ps.filter(v => v.id !== p.id))}>Retirar</button></td></tr>)}
        </tbody></table></div>}
      </section>
      <section className="calc-card"><h2>4. Barrido automático por diámetro</h2>
        <fieldset className="gamma-fieldset" disabled={busy}><div className="tomo-fields">
          <Field label="Diámetro mínimo (mm)" value={range.min} min="0.1" onChange={v => updateRange('min', v)} />
          <Field label="Diámetro máximo (mm)" value={range.max} min="0.1" onChange={v => updateRange('max', v)} />
          <Field label="Incremento de diámetro (mm)" value={range.step} min="0.1" onChange={v => updateRange('step', v)} />
          <label className="gamma-field"><span>Paso entre centros</span><select className="dark-select" value={range.stride} onChange={e => updateRange('stride', e.target.value)}><option value="1">1 vóxel · todos los centros</option><option value="2">2 vóxeles · rejilla reducida</option><option value="3">3 vóxeles · rejilla reducida</option><option value="4">4 vóxeles · rejilla reducida</option></select></label>
          <label className="gamma-field tomo-wide"><span>Región de búsqueda</span><select className="dark-select" value={range.centerMode} onChange={e => updateRange('centerMode', e.target.value)}><option value="per-diameter">Todas las posiciones válidas para cada diámetro</option><option value="common">Mismos centros para todos: donde cabe la esfera mayor</option></select></label>
        </div><label className="gamma-field"><span>Protocolo de adquisición y reconstrucción / notas</span><textarea className="dark-input" rows="2" value={range.notes} onChange={e => updateRange('notes', e.target.value)} placeholder="Colimador, cuentas, correcciones, filtro, iteraciones/subconjuntos…" /></label>
        <p className="gamma-hint">Las esferas se solapan. Con paso 1 se evalúa cada centro de vóxel válido. El modo de centros comunes facilita comparar escalas, pero deja fuera las zonas próximas al borde donde solo caben esferas pequeñas.</p>
        <button className="gamma-primary" disabled={!confirmed} onClick={analyze}>Calcular curva 3D</button></fieldset>
      </section>
      {result && <section className="calc-card tomo-results"><h2>5. Curva de uniformidad por tamaño de esfera</h2>
        <div className="tomo-metrics"><div><span>Media de referencia</span><strong>{fmt(result.reference.mean, 4)}</strong><small>{result.units}</small></div>
          <div><span>Volumen de referencia</span><strong>{fmt(result.reference.sampledVolumeMl, 1)} ml</strong><small>Cilindro tras aplicar los márgenes</small></div>
          <div><span>Diámetros evaluables</span><strong>{validRows.length} / {result.results.length}</strong><small>Sin tolerancia normativa asignada</small></div></div>
        <label className="gamma-check"><input type="checkbox" checked={normalized} onChange={e => setNormalized(e.target.checked)} />Normalizar a la media del volumen de referencia = 100 %</label>
        <div className="tomo-chart"><Line data={curveData(result, normalized)} options={{ responsive: true, maintainAspectRatio: false, animation: false,
          interaction: { mode: 'nearest', intersect: false }, scales: {
            x: { type: 'linear', title: { display: true, text: 'Diámetro de esfera (mm)', color: '#b7c2d2' }, ticks: { color: '#b7c2d2' }, grid: { color: '#ffffff12' } },
            y: { title: { display: true, text: normalized ? 'Media de esfera / media de referencia (%)' : `Media de esfera (${result.units})`, color: '#b7c2d2' }, ticks: { color: '#b7c2d2' }, grid: { color: '#ffffff12' } },
          }, plugins: { legend: { labels: { color: '#b7c2d2', boxWidth: 18 } } },
          onClick: (_event, elements) => { if (elements.length) { const r = result.results[elements[0].index]; if (r.valid) setSelectedDiameter(r.diameterMm) } },
        }} /></div>
        <p className="gamma-hint">Los extremos corresponden a <strong>medias dentro de esferas</strong>, no al vóxel más alto o más bajo. La referencia es la misma para todos los diámetros. Pulsa una fila para mostrar sus esferas en los cortes y la vista 3D.</p>
        <div className="gamma-table-scroll"><table><thead><tr><th>Diámetro</th><th>Vóxeles / volumen efectivo</th><th>Centros</th><th>Mínimo</th><th>Máximo</th><th>U3D</th><th>Localizar</th></tr></thead><tbody>
          {result.results.map(r => <tr key={r.diameterMm} className={selectedDiameter === r.diameterMm ? 'gamma-selected' : ''}>
            <td><button className="gamma-link-button" disabled={!r.valid} onClick={() => setSelectedDiameter(r.diameterMm)}>{r.diameterMm} mm</button></td>
            {r.valid ? <><td>{r.voxelCount}<small>{fmt(r.sampledVolumeMl, 3)} ml</small></td><td>{r.centerCount.toLocaleString('es-ES')}</td>
              <td>{fmt(r.minimum.mean, 4)}<small>{fmt(r.minimumPercent)} %</small></td><td>{fmt(r.maximum.mean, 4)}<small>{fmt(r.maximumPercent)} %</small></td><td>{fmt(r.uniformityPercent)} %</td>
              <td><button onClick={() => locate(r, 'minimum')}>Ver mínimo</button> <button onClick={() => locate(r, 'maximum')}>Ver máximo</button></td></> : <td colSpan="6">{r.reason}</td>}
          </tr>)}
        </tbody></table></div>
        {selected && <p className="tomo-selected-details">Esferas de {selected.diameterMm} mm: mínimo en ({position(selected.minimum.center)}), máximo en ({position(selected.maximum.center)}). P5–P95 de las medias: {fmt(selected.p05, 4)}–{fmt(selected.p95, 4)} {result.units}.</p>}
        <p className="gamma-hint">U3D(d) = 100 × (máximo − mínimo) / (máximo + mínimo). Menor valor indica menor diferencia entre extremos a esa escala. P5–P95 es un intervalo descriptivo de medias solapadas, no un intervalo de confianza.</p>
        {result.warnings.map((w, i) => <p className="gamma-warning" key={i}>{w}</p>)}
        <div className="gamma-actions"><button onClick={() => save('uniformidad-tomografica-3d.json', JSON.stringify(exportResult(), null, 2), 'application/json')}>Exportar resultados y parámetros JSON</button>
          <button onClick={() => save('uniformidad-tomografica-3d.csv', tomoResultsCsv(result), 'text/csv;charset=utf-8')}>Exportar curva CSV</button></div>
      </section>}
      <details className="tomo-details"><summary>Cómo interpretar y repetir la prueba</summary>
        <p>Al aumentar el diámetro se promedian fluctuaciones pequeñas, pero también pueden atenuarse defectos estrechos. La curva por sí sola no separa ruido de artefactos. Revisa todos los cortes originales con y sin contornos.</p>
        <p>Para la constancia, conserva adquisición, cuentas, reconstrucción, tamaño de vóxel, cilindro, márgenes, diámetros y rejilla. El número de posiciones modifica la oportunidad de encontrar extremos. La curva no tiene por qué ser monótona.</p>
        <p>Las esferas usan los centros de los vóxeles contenidos en su radio físico, sin interpolación, ponderación de volumen parcial ni suavizado previo. El volumen efectivo indica la discretización de cada esfera. La selección geométrica conserva los defectos fríos interiores.</p>
        <p>Este análisis es una propuesta complementaria de uniformidad tomográfica multiescala; no aplica los límites de uniformidad planar. Necesita datos de referencia y repetibilidad para definir niveles de actuación propios.</p>
        <p>Referencias: <a href="https://sefm.es/wp-content/uploads/Protocolo-2020-final.pdf" target="_blank" rel="noreferrer">SEFM, protocolo 2020, GTM03</a> y <a href="https://www-pub.iaea.org/MTCD/Publications/PDF/Pub1394_web.pdf" target="_blank" rel="noreferrer">IAEA HHS 6, §4.3.3</a>. La IAEA describe perfiles y contraste de artefactos; no define esta curva de esferas ni sus tolerancias.</p>
      </details>
    </>}
  </div>
}
