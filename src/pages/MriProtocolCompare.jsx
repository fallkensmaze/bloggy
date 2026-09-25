import { useEffect, useMemo, useRef, useState } from 'react'
import { compareMriProtocols, decodeMriXml, groupMriProtocols, MRI_DIFF_STATUS, MRI_MAX_BATCH_BYTES, MRI_MAX_FILE_BYTES, MRI_STATUS, mriValue, parameterSignature, parseMriXml } from '../utils/mriProtocols'
import { mriCsv, mriReportSheets, mriWorkbook } from '../utils/mriProtocolReport'
import { MRI_DEMO_FILES } from '../utils/mriProtocolDemo'
import { triggerDownload } from '../utils/zipDownload'
import '../styles/mri-protocols.css'

const matchText = (value, query) => String(value).toLowerCase().includes(query.trim().toLowerCase())
const protocolLabel = p => `${p.scanner} · ${p.fileName} · ${p.path} · ${p.id || p.uid}`
const Status = ({ status }) => <span className={`mri-status mri-${status}`}>{MRI_STATUS[status]}</span>

export default function MriProtocolCompare() {
  const [files, setFiles] = useState([])
  const [mode, setMode] = useState('scanners')
  const [match, setMatch] = useState('path')
  const [ignoreCase, setIgnoreCase] = useState(true)
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedKey, setSelectedKey] = useState('')
  const [pair, setPair] = useState({})
  const [onlyDifferences, setOnlyDifferences] = useState(true)
  const [paramQuery, setParamQuery] = useState('')
  const [rowLimit, setRowLimit] = useState(100)
  const [paramLimit, setParamLimit] = useState(100)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState(false)
  const sequence = useRef(0)
  const loading = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const protocols = useMemo(() => files.flatMap(f => f.protocols), [files])
  const groups = useMemo(() => groupMriProtocols(files, { mode, match, ignoreCase }), [files, mode, match, ignoreCase])
  const regions = useMemo(() => [...new Set(protocols.map(p => p.region))].sort(), [protocols])
  const visibleGroups = useMemo(() => groups.filter(g => (!region || g.region === region) && matchText(`${g.name} ${g.context} ${g.protocols.map(p => p.scanner + ' ' + p.fileName).join(' ')}`, query)
    && (filter === 'all' || filter === 'common' && g.common || filter === 'missing' && !g.common || g.status === filter)), [groups, region, query, filter])
  const inventory = useMemo(() => protocols.filter(p => (!region || p.region === region) && matchText(`${p.scanner} ${p.fileName} ${p.path} ${p.id}`, query)), [protocols, region, query])
  const activeGroup = mode === 'inventory' ? null : visibleGroups.find(g => g.key === selectedKey) || visibleGroups.find(g => g.status === 'different') || visibleGroups[0]
  const candidates = activeGroup?.protocols || []
  const left = candidates.find(p => p.uid === pair.left) || candidates[0]
  const right = candidates.find(p => p.uid === pair.right && p.uid !== left?.uid)
    || candidates.find(p => p.uid !== left?.uid && parameterSignature(p) !== parameterSignature(left))
    || candidates.find(p => p.uid !== left?.uid)
  const comparison = useMemo(() => compareMriProtocols(left, right), [left, right])
  const parameterRows = useMemo(() => (comparison?.rows || []).filter(r => (!onlyDifferences || r.status !== 'same')
    && matchText(`${r.card} ${r.name} ${mriValue(r.left)} ${mriValue(r.right)}`, paramQuery)), [comparison, onlyDifferences, paramQuery])
  useEffect(() => { setRowLimit(100) }, [mode, query, region, filter, match, files])
  useEffect(() => { setParamLimit(100) }, [left?.uid, right?.uid, paramQuery, onlyDifferences])

  async function loadFiles(incoming) {
    if (loading.current || !incoming.length) return
    loading.current = true
    setBusy(true); setError(''); setMessage('')
    try {
      if (files.length + incoming.length > 12) throw new Error('Puedes comparar hasta 12 archivos a la vez.')
      const total = files.reduce((n, f) => n + (f.byteLength || 0), 0) + incoming.reduce((n, f) => n + f.size, 0)
      if (total > MRI_MAX_BATCH_BYTES) throw new Error('El conjunto supera 75 MB. Divide la exportación por regiones.')
      const parsed = []
      for (const file of incoming) {
        try {
          if (file.size > MRI_MAX_FILE_BYTES) throw new Error('Límite de 25 MB por archivo.')
          if (!/\.xml$/i.test(file.name)) throw new Error('Selecciona archivos .xml de impresión de protocolos Siemens.')
          if (!mounted.current) return
          setMessage(`Leyendo ${file.name}…`)
          const text = decodeMriXml(await file.arrayBuffer())
          await new Promise(resolve => setTimeout(resolve, 0))
          parsed.push({ ...parseMriXml(text, { fileId: `file-${++sequence.current}`, fileName: file.name }), byteLength: file.size })
        } catch (e) { throw new Error(`${file.name}: ${e.message}`) }
      }
      if (!mounted.current) return
      setFiles(previous => [...previous, ...parsed]); setSelectedKey(''); setPair({})
      setMessage(`${parsed.length} archivos añadidos · ${parsed.reduce((n, f) => n + f.protocols.length, 0)} secuencias leídas.`)
    } catch (e) {
      if (mounted.current) { setError(`${e.message} No se ha añadido ningún archivo de esta selección.`); setMessage('') }
    } finally { loading.current = false; if (mounted.current) setBusy(false) }
  }

  function loadDemo() {
    setFiles(MRI_DEMO_FILES.map(f => ({ ...parseMriXml(f.xml, { fileId: `demo-${++sequence.current}`, fileName: f.name }), demo: true, byteLength: new TextEncoder().encode(f.xml).length })))
    setMode('scanners'); setMatch('path'); setQuery(''); setRegion(''); setFilter('all'); setSelectedKey(''); setPair({}); setError('')
    setMessage('Ejemplo sintético cargado. Sus valores no son protocolos clínicos de referencia.')
  }

  function clear() {
    setFiles([]); setPair({}); setSelectedKey(''); setQuery(''); setRegion(''); setFilter('all'); setMessage(''); setError('')
  }

  function downloadReport() {
    try {
      setError('')
      const sheets = mriReportSheets({ files, groups, mode, match, ignoreCase, left, right, comparison })
      triggerDownload(mriWorkbook(sheets), 'comparacion_protocolos_RM.xlsx')
    } catch (e) { setError(`No se pudo exportar: ${e.message}`) }
  }

  function downloadComparison() {
    const rows = [['Archivo A', left.fileName], ['Ruta A', left.path], ['Id A', left.id], ['Archivo B', right.fileName], ['Ruta B', right.path], ['Id B', right.id],
      ['Estado', MRI_STATUS[comparison.status]], ['Criterio', 'Valores textuales; espacios exteriores recortados; sin conversión de unidades.'], [],
      ['Sección', 'Parámetro', 'A · referencia', 'B · comparación', 'Estado'],
      ...comparison.rows.map(r => [r.card, r.name, mriValue(r.left), mriValue(r.right), MRI_DIFF_STATUS[r.status]])]
    triggerDownload(new Blob([mriCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'comparacion_secuencias_RM.csv')
  }

  return <div className="page-body mri-page">
    <header className="page-header">
      <div className="page-icon"><i className="bi bi-file-earmark-diff" aria-hidden="true" /></div>
      <h1 className="page-title">Comparador de protocolos RM</h1>
      <p className="page-subtitle">Explora el árbol de protocolos, localiza nombres repetidos y compara los parámetros de cada secuencia.</p>
    </header>
    <section className="mri-panel mri-upload-panel" aria-label="Cargar protocolos">
      <label className={`mri-drop ${dragging ? 'mri-dragging' : ''} ${busy ? 'mri-busy' : ''}`}
        onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); loadFiles([...e.dataTransfer.files]) }}>
        <i className="bi bi-filetype-xml" aria-hidden="true" /><strong>Arrastra aquí tus exportaciones XML</strong>
        <span>Siemens · impresión de protocolos · uno o varios equipos</span>
        <span className="mri-upload-action">{busy ? 'Leyendo archivos…' : 'Elegir archivos XML'}</span>
        <input type="file" multiple accept=".xml,application/xml,text/xml" aria-label="Elegir archivos XML" disabled={busy}
          onChange={e => { loadFiles([...e.target.files]); e.target.value = '' }} />
      </label>
      <div className="mri-upload-notes"><span><i className="bi bi-laptop" aria-hidden="true" /> Los XML se procesan en esta pestaña y no se envían a un servidor.</span><span>Hasta 12 archivos · 25 MB por archivo · 75 MB en total</span></div>
      {!files.length && <div className="mri-empty-actions"><button onClick={loadDemo} disabled={busy}>Probar con un ejemplo</button><span>Incluye nombres repetidos, parámetros cambiados y secuencias exclusivas.</span></div>}
      {error && <div className="mri-notice mri-error" role="alert">{error}</div>}
      <p className="mri-message" role="status" aria-live="polite">{message}</p>
      {files.length > 0 && <div className="mri-files">{files.map((file, i) => <div className="mri-file" key={file.id}>
        <div><strong>{i + 1}. {file.scanner}</strong><span>{file.fileName}{file.demo ? ' · DEMO' : ''}</span><small>{file.protocols.length} secuencias · {file.protocols.filter(p => !p.comparable).length} no evaluables</small>
          {!!file.warnings.length && <details><summary>{file.warnings.length} avisos de lectura</summary><ul>{file.warnings.map((w, k) => <li key={k}>{w}</li>)}</ul></details>}</div>
        <button disabled={busy} className="mri-icon-button" aria-label={`Quitar archivo ${i + 1}: ${file.fileName}`} onClick={() => { setFiles(files.filter(f => f.id !== file.id)); setPair({}); setRegion('') }}>×</button>
      </div>)}</div>}
    </section>
    {!!files.length && <>
      <div className="mri-summary"><div><strong>{files.length}</strong><span>archivos</span></div><div><strong>{protocols.length}</strong><span>secuencias</span></div><div><strong>{regions.length}</strong><span>regiones</span></div><div><strong>{protocols.filter(p => !p.comparable).length}</strong><span>no evaluables</span></div></div>
      <section className="mri-panel">
        <div className="mri-toolbar"><div className="mri-tabs" aria-label="Vista de protocolos">{[['scanners', 'Entre equipos'], ['duplicates', 'Nombres repetidos'], ['inventory', 'Inventario']].map(([value, label]) => <button key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setFilter('all'); setSelectedKey(''); setPair({}) }}>{label}</button>)}</div>
          <div className="mri-actions"><button disabled={busy} onClick={downloadReport}><i className="bi bi-file-earmark-spreadsheet" aria-hidden="true" /> Exportar Excel</button><button disabled={busy} onClick={clear}>Vaciar</button></div></div>
        <p className="mri-help">{mode === 'scanners' ? 'Cruza las rutas entre todos los archivos. Los números indican cuántas entradas hay en cada uno. Selecciona un grupo para elegir A y B.' : mode === 'duplicates' ? 'Agrupa secuencias con el mismo nombre dentro de cada archivo y región, aunque estén en distintos exámenes o programas.' : 'Índice completo: cada entrada conserva su equipo, región, examen, programa e identificador.'}</p>
        {mode === 'scanners' && files.length < 2 && <p className="mri-notice">Añade otro XML para comparar equipos o versiones. Con uno puedes revisar nombres repetidos e inventario.</p>}
        <div className="mri-filters">
          <label>Buscar<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Secuencia, ruta o equipo…" /></label>
          <label>Región<select value={region} onChange={e => setRegion(e.target.value)}><option value="">Todas las regiones</option>{regions.filter(Boolean).map(r => <option key={r}>{r}</option>)}</select></label>
          {mode === 'scanners' && <label>Emparejar por<select value={match} onChange={e => { setMatch(e.target.value); setSelectedKey(''); setPair({}) }}><option value="path">Región + examen + programa + nombre</option><option value="name">Región + nombre de secuencia</option></select></label>}
          {mode !== 'inventory' && <label>Mostrar<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todos los grupos</option><option value="different">Con diferencias</option><option value="same">Iguales en XML</option><option value="unknown">No evaluables</option>{mode === 'scanners' && <><option value="common">Presentes en todos los archivos</option><option value="missing">Ausentes en algún archivo</option></>}</select></label>}
        </div>
        {mode !== 'inventory' && <label className="mri-checkbox"><input type="checkbox" checked={ignoreCase} onChange={e => setIgnoreCase(e.target.checked)} /> Ignorar mayúsculas en nombres y rutas (los valores se comparan exactamente)</label>}
        {mode === 'inventory' ? <>
          <p className="mri-table-count">{inventory.length} entradas{inventory.length > rowLimit ? ` · mostrando ${rowLimit}` : ''}</p>
          <div className="mri-scroll"><table><thead><tr><th>Secuencia / Id</th><th>Equipo / archivo</th><th>Región / examen / programa</th><th>Parámetros</th><th>Lectura</th></tr></thead><tbody>{inventory.slice(0, rowLimit).map(p => <tr key={p.uid}><td><strong>{p.name}</strong><small>{p.id || 'Sin Id'}</small></td><td>{p.scanner}<small>{p.fileName}</small></td><td>{p.region}<small>{p.exam} / {p.program}</small></td><td>{p.parameters.length}</td><td>{p.comparable ? 'Leído' : <><Status status="unknown" /><small>{p.issues.join('; ')}</small></>}</td></tr>)}</tbody></table></div>
          {!inventory.length && <p className="mri-empty">No hay entradas con estos filtros.</p>}
          {inventory.length > rowLimit && <button className="mri-more" onClick={() => setRowLimit(n => n + 100)}>Mostrar 100 más</button>}
        </> : <>
          <p className="mri-table-count">{visibleGroups.length} grupos{visibleGroups.length > rowLimit ? ` · mostrando ${rowLimit}` : ''}</p>
          <div className="mri-scroll"><table className="mri-groups"><thead><tr><th>Secuencia / ubicación</th><th>Estado</th><th>Variantes</th>{files.map((f, i) => <th key={f.id} title={f.fileName}>{i + 1}. {f.scanner}</th>)}</tr></thead><tbody>{visibleGroups.slice(0, rowLimit).map(g => <tr key={g.key} className={activeGroup?.key === g.key ? 'mri-selected' : ''}>
            <td><button className="mri-link-button" aria-pressed={activeGroup?.key === g.key} onClick={() => { setSelectedKey(g.key); setPair({}); setParamQuery('') }}>{g.name}</button><small>{g.context || 'Sin ubicación'}</small></td><td><Status status={g.status} /></td><td>{g.variants}{g.status === 'unknown' ? ' + ?' : ''}</td>{files.map(f => <td key={f.id}>{g.protocols.filter(p => p.fileId === f.id).length || <span className="mri-absent">Ausente</span>}</td>)}</tr>)}</tbody></table></div>
          {!visibleGroups.length && <p className="mri-empty">{mode === 'duplicates' ? 'No se han encontrado nombres repetidos con estos filtros.' : 'No hay grupos con estos filtros.'}</p>}
          {visibleGroups.length > rowLimit && <button className="mri-more" onClick={() => setRowLimit(n => n + 100)}>Mostrar 100 más</button>}
        </>}
      </section>
      {activeGroup && <section className="mri-panel mri-comparison" aria-label="Comparación de secuencias">
        <div className="mri-section-title"><div><span className="mri-eyebrow">COMPARACIÓN DE SECUENCIAS</span><h2>{activeGroup.name}</h2></div>{comparison && <Status status={comparison.status} />}</div>
        <div className="mri-pair">
          {[['A · referencia', left, 'left'], ['B · comparación', right, 'right']].map(([label, p, side]) => <div className={`mri-protocol mri-side-${side}`} key={side}>
            <label>{label}<select aria-label={label} value={p?.uid || ''} disabled={candidates.length < 2} onChange={e => setPair({ left: left?.uid, right: right?.uid, [side]: e.target.value })}>
              {!p && <option value="">Sin otra entrada en este grupo</option>}{candidates.filter(candidate => side !== 'right' || candidate.uid !== left?.uid).map(candidate => <option key={candidate.uid} value={candidate.uid}>{protocolLabel(candidate)}</option>)}
            </select></label>
            {p && <><strong>{p.scanner}</strong><p className="mri-path">{p.path}</p><p>{p.properties || 'Sin propiedades de cabecera'}</p><small>Archivo: {p.fileName}<br />Id: {p.id || 'No exportado'}</small>{!!p.issues.length && <p className="mri-notice">{p.issues.join(' · ')}</p>}</>}
          </div>)}
        </div>
        {!comparison ? <p className="mri-empty">Solo hay una entrada en este grupo. Añade otro XML o agrupa por región y nombre para buscar coincidencias en otras rutas.</p> : <>
          <div className="mri-toolbar"><p><strong>{comparison.differences}</strong> diferencias en {comparison.rows.length} campos comparados</p><div className="mri-actions"><button onClick={() => setPair({ left: right.uid, right: left.uid })}>Intercambiar A / B</button><button onClick={downloadComparison}>Descargar comparación CSV</button></div></div>
          {!comparison.comparable && <p className="mri-notice">Alguna entrada está incompleta. Se muestran los campos disponibles, pero no se puede concluir que ambas secuencias sean iguales.</p>}
          <div className="mri-parameter-filters"><label className="mri-checkbox"><input type="checkbox" checked={onlyDifferences} onChange={e => setOnlyDifferences(e.target.checked)} /> Solo diferencias</label><label>Buscar parámetro<input type="search" value={paramQuery} onChange={e => setParamQuery(e.target.value)} placeholder="TR, vóxel, distorsión…" /></label></div>
          <div className="mri-scroll"><table className="mri-differences"><thead><tr><th>Sección / parámetro</th><th>A · referencia</th><th>B · comparación</th><th>Estado</th></tr></thead><tbody>{parameterRows.slice(0, paramLimit).map(r => <tr key={r.key} className={`mri-row-${r.status}`}><td><small>{r.card}</small><strong>{r.name}</strong></td><td>{mriValue(r.left)}</td><td>{mriValue(r.right)}</td><td>{MRI_DIFF_STATUS[r.status]}</td></tr>)}</tbody></table></div>
          {!parameterRows.length && <p className="mri-empty">{comparison.status === 'same' && onlyDifferences && !paramQuery ? 'Los parámetros exportados y la cabecera son iguales.' : 'No hay campos que coincidan con estos filtros.'}</p>}
          {parameterRows.length > paramLimit && <button className="mri-more" onClick={() => setParamLimit(n => n + 100)}>Mostrar 100 parámetros más</button>}
          <p className="mri-help">A y B indican el sentido de lectura; las diferencias no son recomendaciones de cambio. «No exportado» se distingue de un valor vacío.</p>
        </>}
      </section>}
    </>}
    <details className="mri-panel mri-method" open={!files.length}><summary>Formato admitido y criterio de comparación</summary>
      <p>Exporta la impresión del árbol de protocolos de Siemens en XML. Se leen las regiones, exámenes, programas, secuencias y tarjetas de parámetros. Otros XML, los DICOM y los formatos de GE o Philips requieren un adaptador específico.</p>
      <p>La comparación es textual: recorta espacios exteriores, conserva las unidades, distingue mayúsculas en los valores y no aplica tolerancias numéricas. Compara también las propiedades de cabecera (tiempo de adquisición, vóxel…). Los Id y las rutas identifican la secuencia, pero no se usan para decidir si sus parámetros son iguales. Los parámetros repetidos se conservan.</p>
      <p>«Iguales en XML» solo describe lo exportado; no demuestra equivalencia clínica. Revisa la primera importación con tu XML original. Descarga el informe antes de cerrar la pestaña: los archivos no se guardan.</p>
      <p>Excel incluye inventario y grupos completos, y el par seleccionado con todos sus campos, aunque estén filtrados en pantalla. CSV exporta ese par.</p>
      <p>Inspirado en <a href="https://github.com/GIfMI/declutter-mri-protocols" target="_blank" rel="noreferrer">declutter-mri-protocols · GIfMI</a>. Referencia: Pullens et al., <em>Physica Medica</em> 120 (2024), 103342. <a href="https://doi.org/10.1016/j.ejmp.2024.103342" target="_blank" rel="noreferrer">Artículo</a>. Implementación independiente para el navegador.</p>
    </details>
  </div>
}
