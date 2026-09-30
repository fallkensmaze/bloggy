import { useMemo, useRef, useState } from 'react'
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js'
import { Scatter } from 'react-chartjs-2'
import { parseMcc, mccNumber, MAX_MCC_BYTES } from '../utils/mccParser.js'
import { analyzeMccBatch, defaultMccOptions, profilePairIssues, confirmPddDose } from '../utils/mccAnalysis.js'
import MccBatchResults from '../components/MccBatchResults.jsx'
import { equivalentMsr, equivalentSmallField, lcpeRadius, MCC_METHOD } from '../utils/mccDosimetry.js'
import MccKqPanel from '../components/MccKqPanel.jsx'
import { calculateKq, resolvePhotonQuality, qualityFactorContext } from '../utils/mccKq.js'
import { mccDemo } from '../utils/mccDemo.js'
import { triggerDownload } from '../utils/zipDownload'
import '../styles/mcc.css'

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend)
const fmt=(v,n=3)=>typeof v==='number' && Number.isFinite(v)?v.toLocaleString('es-ES',{maximumFractionDigits:n}):'—'
const label=s=>`${s.fileName} · #${s.id} · ${s.type} · ${s.metadata.ENERGY||'?'} ${s.metadata.MODALITY||''} ${s.metadata.FILTER||''}`
const Field=({title,children})=><label className="mcc-field"><span>{title}</span>{children}</label>
const Metric=({title,value,unit=''})=><div className="mcc-metric"><span>{title}</span><strong>{fmt(value)} <small>{value==null?'':unit}</small></strong></div>
const Num=({value,onChange,...props})=><input type="number" step="any" value={value} onChange={e=>onChange(e.target.value)} {...props}/>
const REF398='https://www-pub.iaea.org/MTCD/Publications/PDF/p15048-DOC-010-398-Rev1_web.pdf'
const REF483='https://www-pub.iaea.org/MTCD/Publications/PDF/D483_web.pdf'
export default function MccAnalyzer() {
  const [scans,setScans]=useState([]),[selected,setSelected]=useState(''),[settings,setSettings]=useState({})
  const [overlay,setOverlay]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [dragging,setDragging]=useState(false)
  const fileInput=useRef(null),dragDepth=useRef(0)
  const detailPanel=useRef(null)
  const [pairKey,setPairKey]=useState(''),[pairConfirmed,setPairConfirmed]=useState(false)
  const [msr,setMsr]=useState({x:'10',y:'10',filter:'FFF',energy:'6',tpr:'',confirmed:false,source:'manual',pddKey:''})
  const [kSettings,setKSettings]=useState({source:'photon',chamber:'',q0Type:'co60',q0Quality:'',q0Quantity:'dose',electronQuantity:'ion',electronQuality:''})
  const [small,setSmall]=useState({tpr:'',detector:''})
  const loadId=useRef(0)
  const current=scans.find(s=>s.key===selected)
  const options=current?(settings[current.key]||defaultMccOptions(current)):null
  const results=useMemo(()=>analyzeMccBatch(scans,settings),[scans,settings])
  const result=results[selected]
  const edit=(key,value)=>{setSettings(v=>({...v,[selected]:{...options,referenceConfirmed:false,[key]:value}}));setPairConfirmed(false)}
  const choose=key=>{setSelected(key);setPairKey('');setPairConfirmed(false);setOverlay([])}
  function resetPddLink() { setMsr(v=>v.source==='pdd'?{...v,pddKey:''}:v) }
  function linkPdd() {
    setMsr(v=>({...v,source:'pdd',pddKey:selected,confirmed:false}))
    setKSettings(v=>({...v,source:'photon',chamber:'',q0Type:'co60',q0Quality:''}))
  }
  async function load(files) {
    if(!files.length) return
    const token=++loadId.current;setBusy(true);setError('')
    try {
      if(files.some(file=>!file.name.toLowerCase().endsWith('.mcc'))) throw new Error('Selecciona o arrastra únicamente archivos .mcc.')
      if(files.length>30 || files.reduce((s,f)=>s+f.size,0)>40*1024*1024) throw new Error('Máximo 30 archivos y 40 MB por lote.')
      const parsed=[]
      for(const [i,file] of files.entries()) {
        if(file.size>MAX_MCC_BYTES) throw new Error(`${file.name}: supera 20 MB.`)
        const bytes=await file.arrayBuffer(),view=new Uint8Array(bytes)
        const encoding=view[0]===255 && view[1]===254?'utf-16le':view[0]===254 && view[1]===255?'utf-16be':'utf-8'
        const data=parseMcc(new TextDecoder(encoding).decode(bytes),file.name)
        parsed.push(...data.scans.map((s,j)=>({...s,key:`${i}-${j}`})))
        if(parsed.length>1000 || parsed.reduce((n,s)=>n+s.points.length,0)>250000) throw new Error('Máximo 1000 barridos y 250000 puntos por lote.')
      }
      if(token!==loadId.current) return
      resetPddLink();setScans(parsed);setSettings({});choose(parsed[0]?.key||'')
    } catch(e) { if(token===loadId.current)setError(e.message) }
    finally { if(token===loadId.current)setBusy(false) }
  }
  function demo() {
    const data=parseMcc(mccDemo(),'DEMO_sintetica.mcc').scans.map((s,i)=>({...s,key:`demo-${i}`}))
    resetPddLink();setScans(data);setSettings(Object.fromEntries(data.map(s=>[s.key,{...defaultMccOptions(s),quantity:s.id==='2'?'ion':'dose'}])));choose(data[0].key);setError('')
  }
  function clear() {loadId.current++;setBusy(false);resetPddLink();setScans([]);setSettings({});choose('');setError('')}
  const other=scans.find(s=>s.key===pairKey),otherResult=results[pairKey]
  const pairIssues=current&&other?profilePairIssues(current,other):['Selecciona el perfil ortogonal.']
  if(other && options?.modality!=='photon')pairIssues.push('Sclin de TRS-483 se aplica a fotones.')
  if(other && (settings[other.key]||defaultMccOptions(other)).modality!=='photon')pairIssues.push('El segundo perfil debe ser de fotones.')
  const pairWidths=current?.type==='INPLANE_PROFILE'?[result?.metrics?.width/10,otherResult?.metrics?.width/10]:[otherResult?.metrics?.width/10,result?.metrics?.width/10]
  const equivalent=pairConfirmed&&!pairIssues.length?equivalentSmallField(...pairWidths):null
  const msrEq=equivalentMsr(mccNumber(msr.x),mccNumber(msr.y),msr.filter,mccNumber(msr.energy))
  const photonQuality=resolvePhotonQuality(msr,scans,results)
  const tprRef=photonQuality.value
  const kContext=qualityFactorContext(kSettings,photonQuality,options?.modality==='electron'?result?.electron:null)
  const kResult=calculateKq({...kContext,chamber:kSettings.chamber,q0Type:kSettings.q0Type})
  const radius=lcpeRadius(mccNumber(small.tpr)),detector=mccNumber(small.detector)
  const lcpeClear=equivalent&&radius!==null&&detector!==null&&detector>=0?Math.min(result.metrics.width,otherResult.metrics.width)/20>=radius+detector/20:null
  function exportJson() {
    triggerDownload(new Blob([JSON.stringify({method:MCC_METHOD,date:new Date().toISOString(),scans:scans.map(s=>({...s,options:settings[s.key]||defaultMccOptions(s),result:results[s.key]})),pair:{selected,pairKey,pairConfirmed,pairIssues,equivalent,small,lcpeClear},msr:{...msr,equivalent:msr.source==='manual'?msrEq:null,tprRef,quality:photonQuality},kqqo:{settings:kSettings,context:kContext,result:kResult}},null,2)],{type:'application/json'}),'mcc-analisis.json')
  }
  function exportCsv() {
    const esc=v=>'"'+String(typeof v==='string' && /^[=+@\-\t\r]/.test(v)?"'"+v:v??'').replaceAll('"','""')+'"'
    const rows=[['archivo','scan','tipo','curva','posicion_mm','relativo_pct','s_w_air','metodo','opciones']]
    for(const s of scans) for(const curve of ['raw','dose']) for(const p of results[s.key]?.[curve]||[])rows.push([s.fileName,s.id,s.type,curve,p.x,p.y,p.stopping??'',MCC_METHOD,JSON.stringify(settings[s.key]||defaultMccOptions(s))])
    triggerDownload(new Blob(['\uFEFF'+rows.map(r=>r.map(esc).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'mcc-curvas.csv')
  }
  const chartData={datasets:[
    ...(result?.raw?[{label:result.type==='PDD'?'Señal original normalizada':'Perfil / máximo',data:result.raw,borderColor:'#59a7ff'}]:[]),
    ...(result?.dose && options?.quantity==='ion'?[{label:'Dosis · I × s(w,air)',data:result.dose,borderColor:'#38d5a0'}]:[]),
    ...overlay.slice(0,5).filter(k=>results[k]?.raw && scans.find(s=>s.key===k)?.type===current?.type).map((k,i)=>({label:label(scans.find(s=>s.key===k)),data:results[k].dose||results[k].raw,borderColor:['#f7b955','#c19aff','#fc829d','#bcd85b','#77dedc'][i],borderDash:[5,3]}))
  ].map(s=>({...s,showLine:true,pointRadius:0,pointHitRadius:8,borderWidth:2,tension:0}))}
  const pdd=result?.type==='PDD',metric=result?.metrics
  return <main className="mcc-page">
    <header className="mcc-header"><div><p className="mcc-eyebrow">RADIOTERAPIA · DOSIMETRÍA RELATIVA</p><h1>Analizador MCC</h1><p>PDD, perfiles y calidad del haz. Cálculo local en tu navegador.</p></div><span className="mcc-badge">TRS‑398 · TRS‑483</span></header>
    <section className="mcc-card"><h2>1. Cargar barridos</h2><p>Archivos PTW de tanque de agua. Cada barrido conserva sus metadatos y ajustes.</p>
      <div className={`mcc-dropzone${dragging?' mcc-dropzone-active':''}`} aria-label="Zona para soltar archivos MCC" aria-busy={busy}
        onDragEnter={e=>{e.preventDefault();if(!busy&&e.dataTransfer.types.includes('Files')){dragDepth.current++;setDragging(true)}}}
        onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect=busy?'none':'copy'}}
        onDragLeave={e=>{e.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false)}}
        onDrop={e=>{e.preventDefault();dragDepth.current=0;setDragging(false);if(!busy)load([...e.dataTransfer.files])}}>
        <svg className="mcc-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>
        <strong>{dragging?'Suelta los archivos aquí':'Arrastra y suelta aquí tus archivos MCC'}</strong>
        <span className="mcc-note">o selecciónalos desde tu equipo</span>
        <input ref={fileInput} aria-label="Archivos MCC" type="file" accept=".mcc,.MCC" multiple hidden disabled={busy} onChange={e=>{load([...e.target.files]);e.target.value=''}}/>
        <button type="button" className="mcc-upload-button" disabled={busy} onClick={()=>fileInput.current?.click()}>{busy?'Leyendo archivos…':'Seleccionar archivos MCC'}</button>
        <span className="mcc-note">.mcc · hasta 30 archivos · 20 MB por archivo y 40 MB por lote</span>
      </div>
      <div className="mcc-upload-footer"><p className="mcc-note" role="status">{scans.length?`${scans.length} barridos cargados`:'Ningún archivo cargado'}</p><div className="mcc-actions"><button onClick={demo} disabled={busy}>Probar con datos sintéticos</button><button onClick={clear}>Vaciar</button></div></div>
    </section>
    {busy&&<p role="status">Leyendo MCC…</p>}{error&&<p className="mcc-error" role="alert">{error}</p>}
    {!!scans.length&&<>
      <MccBatchResults scans={scans} settings={settings} results={results} selected={selected}
        onSelect={key=>{choose(key);detailPanel.current?.scrollIntoView({block:'start'})}}
        onQuantity={(key,quantity)=>{setSettings(v=>({...v,[key]:{...(v[key]||defaultMccOptions(scans.find(s=>s.key===key))),quantity,referenceConfirmed:false}}));setPairConfirmed(false)}}/>
      <div className="mcc-toolbar"><Field title={`${scans.length} barridos · selección activa`}><select value={selected} onChange={e=>choose(e.target.value)}>{scans.map(s=><option key={s.key} value={s.key}>{label(s)}</option>)}</select></Field><div className="mcc-actions"><button onClick={exportJson}>Informe JSON</button><button onClick={exportCsv}>Curvas CSV</button></div></div>
      <section className="mcc-card" ref={detailPanel}><h2>2. Datos y condiciones del barrido</h2><p className="mcc-note">{label(current)}</p><div className="mcc-fields">
        <Field title="Radiación"><select value={options.modality} onChange={e=>edit('modality',e.target.value)}><option value="unknown">Sin confirmar</option><option value="photon">Fotones</option><option value="electron">Electrones</option></select></Field>
        <Field title={options.modality==='electron'?'Energía nominal (MeV)':'Energía nominal (MV)'}><Num value={options.energy} onChange={v=>edit('energy',v)}/></Field>
        <Field title="Filtro"><select value={options.filter} onChange={e=>edit('filter',e.target.value)}><option value="unknown">Sin confirmar</option><option value="WFF">WFF / FF</option><option value="FFF">FFF</option></select></Field>
        {current.type==='PDD'?<>
          <Field title="Magnitud del MCC"><select value={options.quantity} onChange={e=>edit('quantity',e.target.value)}><option value="unknown">Seleccionar…</option><option value="dose">Dosis relativa / detector validado</option><option value="ion">Ionización sin convertir a dosis</option></select></Field>
          <Field title="Desplazamiento z (mm, se suma)"><Num value={options.depthShift} onChange={v=>edit('depthShift',v)}/></Field>
          <Field title="SSD (cm)"><Num value={options.ssd} onChange={v=>edit('ssd',v)}/></Field>
        </>:<>
          <Field title="Centro esperado / CAX (mm)"><Num value={options.center} onChange={v=>edit('center',v)}/></Field>
          <Field title="Régimen del campo"><select value={options.regime} onChange={e=>edit('regime',e.target.value)}><option value="auto">Orientación automática</option><option value="small">Campo pequeño</option><option value="large">Campo amplio</option></select></Field>
        </>}
      </div><div className="mcc-checks"><label><input type="checkbox" checked={options.reference} onChange={e=>edit('reference',e.target.checked)}/> Dividir señal por la tercera columna (referencia)</label>{current.type==='PDD'&&<label><input type="checkbox" checked={options.water} onChange={e=>edit('water',e.target.checked)}/> Profundidades en agua (ρ = 1 g/cm³)</label>}</div>
      <p className="mcc-note">Posiciones MCC en mm. No se aplica suavizado a PDD, FWHM o penumbras. El desplazamiento es adicional al exportado: por ejemplo, −0,5r para el punto efectivo de una cámara cilíndrica en electrones, solo si no se corrigió en origen.</p>
      <details><summary>Metadatos originales · {current.metadata.DETECTOR_NAME||current.metadata.DETECTOR||'detector desconocido'}</summary><div className="mcc-table-wrap"><table><tbody>{Object.entries(current.metadata).filter(([k])=>!k.includes('POSITIONS')&&!k.includes('SPEEDS')).map(([k,v])=><tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table></div></details></section>
      {result?.error?<p className="mcc-error" role="alert">{result.error}</p>:<>
        <section className="mcc-card"><h2>3. Curva y resultados</h2><div className="mcc-chart"><Scatter data={chartData} options={{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,scales:{x:{type:'linear',ticks:{color:'#9dafc6'},grid:{color:'rgba(147,167,191,.13)'},title:{display:true,color:'#9dafc6',text:pdd?'Profundidad (mm)':'Posición (mm)'}},y:{ticks:{color:'#9dafc6'},grid:{color:'rgba(147,167,191,.13)'},title:{display:true,color:'#9dafc6',text:'Señal / dosis relativa (%)'},beginAtZero:true}},plugins:{legend:{labels:{boxWidth:16,color:'#9dafc6'}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.parsed.y)} % · ${fmt(c.parsed.x)} mm`}}}}}/></div>
        <details><summary>Superponer hasta cinco barridos del mismo tipo</summary><div className="mcc-overlay">{scans.filter(s=>s.key!==selected&&s.type===current.type).map(s=><label key={s.key}><input type="checkbox" checked={overlay.includes(s.key)} disabled={!overlay.includes(s.key)&&overlay.length>=5} onChange={e=>setOverlay(v=>e.target.checked?[...v,s.key]:v.filter(k=>k!==s.key))}/>{label(s)}</label>)}</div><p className="mcc-note">Cada curva usa sus propios ajustes. La comparación es descriptiva; no aplica alineamiento ni criterio de aceptación.</p></details>
        <p className="mcc-note">{current.points.length} puntos · intervalo máximo {fmt(result?.maxGap)} mm · interpolación lineal · — = no evaluable.</p>
        {pdd?<><div className="mcc-metrics"><Metric title={metric?'dₘáx dosis':'Máximo de señal'} value={metric?.dmax??result.rawMetrics.dmax} unit="mm"/><Metric title="PDD(5 cm)" value={metric?.pdd5} unit="%"/><Metric title="PDD(10 cm)" value={metric?.pdd10} unit="%"/><Metric title="PDD(20 cm)" value={metric?.pdd20} unit="%"/><Metric title="R₉₀ dosis" value={metric?.r90} unit="mm"/><Metric title="R₈₀ dosis" value={metric?.r80} unit="mm"/><Metric title="R₅₀ curva de dosis" value={metric?.r50} unit="mm"/><Metric title="R₂₀ dosis" value={metric?.r20} unit="mm"/></div>
          {result.electron&&<><h3>Electrones · TRS‑398 Rev.1</h3><div className="mcc-metrics"><Metric title="R₅₀,ion" value={result.electron.r50ion} unit="g/cm²"/><Metric title={options.quantity==='ion'?'R₅₀ por ec. 37 (tabla)':'R₅₀ dosis'} value={result.electron.r50} unit="g/cm²"/><Metric title="Rp estimado · secante 60–40 / cola" value={metric?.rp} unit="mm"/><Metric title="zref = 0,6 R₅₀ − 0,1" value={result.electron.zref} unit="g/cm²"/></div><p className="mcc-note">La ecuación 37 selecciona la calidad para interpolar s(w,air). R₅₀ de la curva corregida se informa aparte; puede diferir por muestreo e interpolación. La curva verde solo abarca el dominio tabulado. Rp requiere cola de dosis distal suficiente; no se extrapola la tabla para obtenerla.</p></>}
          {options.modality==='photon'&&<div className="mcc-subpanel"><h3>PDD → TPR₂₀,₁₀ · {options.filter}</h3><p className="mcc-note">Revisa el campo y marca la confirmación inferior para calcular. Esta confirmación también selecciona «Dosis relativa / detector validado» para este barrido. Unidad exportada: {current.metadata.MEAS_UNIT||'no indicada'}; la unidad por sí sola no verifica las correcciones del detector.</p><div className="mcc-fields"><Field title="Campo X en superficie (cm)"><Num value={options.xSurface} onChange={v=>edit('xSurface',v)}/></Field><Field title="Campo Y en superficie (cm)"><Num value={options.ySurface} onChange={v=>edit('ySurface',v)}/></Field><Metric title="TPR₂₀,₁₀ estimado" value={result.tpr}/></div><label><input type="checkbox" checked={options.referenceConfirmed} onChange={e=>{setSettings(v=>({...v,[selected]:confirmPddDose(options,e.target.checked)}));setPairConfirmed(false)}}/> Confirmo usar esta curva como dosis relativa de fotones, medida central sin cuña, en agua, SSD 100 cm y campo 10 × 10 cm en superficie{options.filter==='FFF'?'; acepto la estimación aproximada para FFF hasta 10 MV':' · WFF'}</label><p className="mcc-formula">TPR₂₀,₁₀ = 1,2661 · PDD(20)/PDD(10) − 0,0595</p>{options.filter==='FFF'&&<p className="mcc-warnings">Estimación FFF: TRS‑398 Rev.1, nota 36. La relación se ajustó a haces WFF; contrasta el resultado con TPR medido antes de usarlo en calibración.</p>}{!!result.tprIssues?.length&&<ul className="mcc-warnings">{result.tprIssues.map(issue=><li key={issue}>{issue}</li>)}</ul>}<button disabled={!Number.isFinite(result.tpr)} onClick={linkPdd}>Vincular este TPR al cálculo de kQ</button></div>}
        </>:metric&&<><div className="mcc-metrics"><Metric title="FWHM (50% máximo global)" value={metric.width} unit="mm"/><Metric title="Desviación centro 50% / CAX" value={metric.centerDeviation} unit="mm"/><Metric title="Penumbra izquierda 80–20" value={metric.penumbraLeft} unit="mm"/><Metric title="Penumbra derecha 80–20" value={metric.penumbraRight} unit="mm"/><Metric title="Planitud WFF · 80% central" value={metric.flatness} unit="%"/><Metric title="Simetría máx. |L−R| / CAX" value={metric.symmetry} unit="%"/><Metric title="FFF · CAX / media a ±80%" value={metric.unflatness}/><Metric title="Distancia entre inflexiones estimadas" value={metric.inflectionWidth} unit="mm"/></div><p className="mcc-note">La planitud no se evalúa en FFF ni campos pequeños. Las inflexiones se estiman con pendiente local de 5 muestras; revisar muestreo y curva. En FFF amplio, la penumbra al máximo global es descriptiva.</p></>}
        {!!result.warnings?.length&&<ul className="mcc-warnings">{result.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>}</section>
        {!pdd&&<section className="mcc-card"><h2>4. Campo pequeño · Sclin de TRS‑483</h2><p>Usa dos FWHM ortogonales en el mismo plano de medida. Sclin = √(FWHMₓ · FWHMᵧ).</p><Field title="Perfil ortogonal"><select value={pairKey} onChange={e=>{setPairKey(e.target.value);setPairConfirmed(false)}}><option value="">Seleccionar…</option>{scans.filter(s=>s.key!==selected&&s.type!== 'PDD').map(s=><option key={s.key} value={s.key}>{label(s)}</option>)}</select></Field>
          {other&&<>{pairIssues.length?<ul className="mcc-warnings">{pairIssues.map(w=><li key={w}>{w}</li>)}</ul>:<label className="mcc-checks"><input type="checkbox" checked={pairConfirmed} onChange={e=>setPairConfirmed(e.target.checked)}/> Confirmo mismo campo pequeño, sesión, geometría y detector apropiado</label>}<div className="mcc-metrics"><Metric title="Sclin" value={equivalent?.value} unit="cm"/><Metric title="Relación de lados X/Y" value={equivalent?.aspectRatio}/></div>{equivalent&&!equivalent.recommended&&<p className="mcc-warnings">Fuera del intervalo (0,7; 1,4): no usar esta equivalencia para seleccionar correcciones de detector sin validación específica.</p>}</>}
          <details><summary>Comprobar margen de equilibrio lateral</summary><div className="mcc-fields"><Field title="TPR₂₀,₁₀(10) conocido"><Num value={small.tpr} onChange={v=>setSmall(s=>({...s,tpr:v}))}/></Field><Field title="Dimensión externa detector (mm)"><Num value={small.detector} onChange={v=>setSmall(s=>({...s,detector:v}))}/></Field><Metric title="rLCPE = 8,369 TPR − 4,382" value={radius} unit="cm"/></div><p>{lcpeClear===null?'Completa los datos para evaluar el margen.':lcpeClear?'Margen geométrico LCPE suficiente según este criterio; aún hay que valorar oclusión de fuente y perturbación del detector.':'Margen LCPE insuficiente: requiere tratamiento de campo pequeño.'}</p></details>
        </section>}
      </>}
    </>}
    <section className="mcc-card"><h2>{scans.length?'5. ':'2. '}TPR de referencia · origen y equivalente de campo</h2>
      <Field title="Origen del TPR"><select aria-label="Origen del TPR" value={msr.source} onChange={e=>{if(e.target.value==='pdd')linkPdd();else setMsr(v=>({...v,source:e.target.value,pddKey:'',tpr:'',confirmed:false}))}}><option value="manual">TPR(S) medido · campo msr (TRS‑483)</option><option value="reference">TPR medido · referencia 10×10 (TRS‑398)</option><option value="pdd" disabled={msr.source!=='pdd'&&!Number.isFinite(result?.tpr)}>Vincular TPR estimado del PDD activo (TRS‑398)</option></select></Field>
      {msr.source==='pdd'?<div className="mcc-subpanel"><p><strong>Enlace al PDD:</strong> {photonQuality.fileName||'sin barrido válido'} {photonQuality.scanId?`· #${photonQuality.scanId}`:''}</p><p>El resultado anterior es un TPR de referencia estimado para {photonQuality.filter||'el haz'} 10×10 cm. Se transfiere sin volver a aplicar la ecuación 28 de TRS‑483. Se actualiza al cambiar los ajustes del PDD y queda invalidado si este deja de cumplir las condiciones.</p><Metric title="TPR₂₀,₁₀(10) vinculado · estimado desde PDD" value={tprRef}/>{photonQuality.error&&<p className="mcc-warnings">{photonQuality.error}</p>}</div>:<>
        <p>{msr.source==='manual'?'Introduce las dimensiones del campo msr en el plano del detector. No utiliza Sclin ni la FWHM de un FFF amplio.':'Introduce el TPR medido en agua con un campo físico de 10×10 cm en el plano del detector y distancia fuente–detector constante de 100 cm. No se aplica corrección de tamaño.'}</p>
        <div className="mcc-fields">
          <Field title="Haz"><select value={msr.filter} onChange={e=>setMsr(v=>({...v,filter:e.target.value,confirmed:false}))}><option value="FFF">FFF · linac convencional</option><option value="WFF">WFF</option></select></Field>
          <Field title="Energía nominal (MV)"><Num value={msr.energy} onChange={energy=>setMsr(v=>({...v,energy,confirmed:false}))}/></Field>
          {msr.source==='manual'&&<><Field title="X en plano detector (cm)"><Num value={msr.x} onChange={x=>setMsr(v=>({...v,x,confirmed:false}))}/></Field><Field title="Y en plano detector (cm)"><Num value={msr.y} onChange={y=>setMsr(v=>({...v,y,confirmed:false}))}/></Field><Metric title={`S uniforme · tabla ${msrEq?.table||'—'}`} value={msrEq?.value} unit="cm"/></>}
        </div>
        {msr.source==='manual'&&<p className="mcc-note">Tablas 15–17: rectángulos de 3 a 12 cm por lado; interpolación bilineal sin extrapolación. FFF: solo 6–7 MV o 10 MV. Valores genéricos publicados, no personalizados a tu perfil. No aplicables a CyberKnife.</p>}
        <div className="mcc-fields"><Field title={msr.source==='manual'?'TPR₂₀,₁₀(S) medido · no PDD₂₀,₁₀':'TPR₂₀,₁₀ de referencia medido'}><Num value={msr.tpr} onChange={tpr=>setMsr(v=>({...v,tpr,confirmed:false}))}/></Field><Metric title={msr.source==='manual'?'TPR₂₀,₁₀(10) · ec. 28':'TPR₂₀,₁₀ de referencia'} value={tprRef}/></div>
        <label className="mcc-checks"><input type="checkbox" checked={msr.confirmed} onChange={e=>setMsr(v=>({...v,confirmed:e.target.checked}))}/>{msr.source==='manual'?'Confirmo TPR medido a distancia fuente–detector constante, campo msr con suficiente equilibrio lateral y condiciones de TRS‑483':'Confirmo TPR de referencia en agua, campo físico 10×10 cm, SDD 100 cm y condiciones de TRS‑398 Rev.1'}</label>
        {msr.source==='manual'?<><p className="mcc-formula">TPR₂₀,₁₀(10) = [TPR₂₀,₁₀(S) + 0,01615(10 − S)] / [1 + 0,01615(10 − S)]</p><p className="mcc-note">La ecuación solo se calcula para 4 ≤ S ≤ 12 cm. Un cociente PDD(20)/PDD(10) medido a SSD constante no es un TPR medido.</p></>:<p className="mcc-note">Para FFF convencional, TRS‑398 Rev.1 utiliza TPR como índice hasta 10 MV. El promediado de volumen se trata por separado.</p>}
      </>}
    </section>
    <MccKqPanel settings={kSettings} onChange={setKSettings} context={kContext} result={kResult} onExport={exportJson}/>
    <section className="mcc-card"><h2>Método y referencias</h2><details><summary>Fórmulas, alcance y trazabilidad</summary><p><strong>Electrones:</strong> R₅₀ = 1,029 R₅₀,ion − 0,06 si R₅₀,ion ≤ 10 g/cm²; 1,059 R₅₀,ion − 0,37 si es mayor. Después D(z) ∝ I(z) · s(w,air)[R₅₀,z/R₅₀], normalizada al máximo corregido. Tabla 22 de TRS‑398 Rev.1, interpolada en ambas variables.</p><p><strong>PDD:</strong> dₘáx corresponde al máximo muestreado; R₉₀/R₈₀/R₅₀/R₂₀ son los primeros cruces distales tras el máximo. Rp es la intersección de la secante distal 60–40% con una regresión de la cola (≥5 muestras por debajo del 10%, más allá de 1,3 R₅₀, extensión ≥5 mm); es una estimación dependiente del muestreo, no un ajuste de tangente exacta. No se extrapolan profundidades ausentes. La incertidumbre del muestreo y las correcciones de detector no se incluyen.</p><p><strong>Perfiles:</strong> FWHM respecto al máximo global. Simetría sobre el 80% central disponible a ambos lados del CAX declarado. Planitud = 100(Dmax − Dmin)/(Dmax + Dmin) en esa región. El cociente FFF es descriptivo, sin tolerancia universal.</p><p><strong>PDD → TPR:</strong> la ecuación empírica WFF de TRS‑398 necesita su geometría específica. Para FFF hasta 10 MV se permite una estimación aproximada según la nota 36, identificada también en el kQ vinculado. No se extiende a campos pequeños u otras SSD. TRS‑483 corrige un TPR ya medido a campo equivalente; no convierte por sí sola un PDD en TPR.</p><p>kQ,Q₀ se calcula seleccionando la cámara y la calidad Q₀, con tablas 16/20/21 de TRS‑398 Rev.1 o 12/13 de TRS‑483 según el origen del índice. No se calculan dosis absolutas ni factores de output a partir de perfiles. Los resultados requieren contraste con datos de referencia del servicio antes de su uso clínico.</p><p><a href={REF398} target="_blank" rel="noreferrer">IAEA TRS‑398 Rev.1 (2024): §6.3, ec. 37 y tabla 22</a> · <a href={REF483} target="_blank" rel="noreferrer">IAEA TRS‑483 (2017): §5.3.3, tablas 15–17 y ec. 28</a> · <a href="https://github.com/tbezo/pymcc" target="_blank" rel="noreferrer">pymcc · Thomas Bezold (MIT), referencia para el formato MCC</a></p><p className="mcc-note">{MCC_METHOD}. Sin envío de MCC al servidor ni persistencia de datos de medida.</p></details></section>
  </main>
}
