import { KQ_TABLES } from '../utils/mccKqData.js'

const number=(v,digits=4)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—'
export default function MccKqPanel({settings,onChange,context,result,onExport}) {
  const table=KQ_TABLES[context.tableKey],electron=settings.source==='electron'||settings.source==='electron-manual',cross=electron&&settings.q0Type==='electron'
  const set=(key,value)=>onChange({...settings,[key]:value})
  return <section className="mcc-card" aria-label="Factor de calidad de cámara">
    <h2>Factor de calidad k<sub>Q,Q₀</sub> · cámara de ionización</h2>
    <p>Selecciona la cámara utilizada para la dosimetría de referencia y la calidad de su calibración. Puede ser distinta del detector con el que adquiriste el MCC.</p>
    <div className="mcc-fields mcc-kq-fields">
      <label className="mcc-field"><span>Calidad Q utilizada</span><select aria-label="Calidad Q utilizada" value={settings.source} onChange={e=>onChange({...settings,source:e.target.value,chamber:'',q0Type:e.target.value==='electron-manual'?'electron':'co60',q0Quality:'',q0Quantity:'dose'})}><option value="photon">TPR del bloque anterior · fotones</option><option value="electron">R₅₀ del PDD activo · electrones</option><option value="electron-manual">R₅₀,ion / R₅₀ manual · electrones</option></select></label>
      {settings.source==='electron-manual'&&<>
        <label className="mcc-field"><span>Magnitud introducida para Q</span><select aria-label="Magnitud manual Q" value={settings.electronQuantity||'ion'} onChange={e=>onChange({...settings,electronQuantity:e.target.value,electronQuality:''})}><option value="ion">R₅₀,ion · ionización</option><option value="dose">R₅₀ · dosis</option></select></label>
        <label className="mcc-field"><span>{settings.electronQuantity==='dose'?'R₅₀':'R₅₀,ion'} de Q (g/cm²)</span><input aria-label="Calidad manual Q" type="number" step="any" value={settings.electronQuality||''} onChange={e=>set('electronQuality',e.target.value)}/></label>
      </>}
      <label className="mcc-field"><span>Calibración Q₀</span><select aria-label="Calibración Q0" value={settings.q0Type} onChange={e=>onChange({...settings,q0Type:e.target.value,chamber:'',q0Quality:'',q0Quantity:'dose'})}><option value="co60">Cobalto‑60 · Nᴅ,w,Co60</option>{electron&&<option value="electron">Electrones · Nᴅ,w,Q₀ / calibración cruzada</option>}</select></label>
      {cross&&<>
        <label className="mcc-field"><span>Magnitud de calibración Q₀</span><select aria-label="Magnitud de calibración Q0" value={settings.q0Quantity||'dose'} onChange={e=>onChange({...settings,q0Quantity:e.target.value,q0Quality:''})}><option value="dose">R₅₀ · dosis</option><option value="ion">R₅₀,ion · ionización</option></select></label>
        <label className="mcc-field"><span>{settings.q0Quantity==='ion'?'R₅₀,ion':'R₅₀'} de calibración Q₀ (g/cm²)</span><input aria-label="R50 de calibración Q0" type="number" step="any" value={settings.q0Quality} onChange={e=>set('q0Quality',e.target.value)}/></label>
      </>}
      <label className="mcc-field"><span>Modelo exacto de cámara ({Object.keys(table?.rows||{}).length})</span><select aria-label="Modelo exacto de cámara" value={table?.rows[settings.chamber]?settings.chamber:''} onChange={e=>set('chamber',e.target.value)}><option value="">Seleccionar cámara…</option>{Object.keys(table?.rows||{}).map(name=><option key={name} value={name}>{name}</option>)}</select></label>
    </div>
    {cross&&<button onClick={()=>onChange({...settings,q0Quantity:'dose',q0Quality:'7.5'})}>Usar Qint = 7,5 g/cm² como Q₀</button>}
    {electron&&(context.manualQ?.quantity==='ion'||context.manualQ0?.quantity==='ion')&&<div className="mcc-subpanel"><p className="mcc-formula">R₅₀ = 1,029 R₅₀,ion − 0,06 si R₅₀,ion ≤ 10; R₅₀ = 1,059 R₅₀,ion − 0,37 si R₅₀,ion &gt; 10 (g/cm²).</p><p className="mcc-note">TRS‑398 Rev.1, ec.37: convierte el índice de ionización al de dosis. Para convertir una curva completa se aplica s(w,air) punto a punto en el bloque PDD; no se multiplica este R₅₀,ion aislado por un stopping power.</p></div>}
    <p className="mcc-note">{table?.label||'Tabla pendiente'} · {context.origin||'Origen pendiente'}. Interpolación lineal dentro de los valores publicados; no se sustituye por otra cámara ni se extrapola.</p>
    <div className="mcc-metrics"><div className="mcc-metric"><span>{electron?'R₅₀ de calidad Q':'TPR₂₀,₁₀ de calidad Q'}</span><strong>{number(context.quality,5)} <small>{context.unit}</small></strong></div><div className="mcc-metric"><span>kQ,Q₀ {settings.q0Type==='co60'?'(kQ respecto a ⁶⁰Co)':''}</span><strong data-testid="kqqo-value">{number(result.value)}</strong></div></div>
    {cross&&<><div className="mcc-metrics">
      <div className="mcc-metric"><span>R₅₀ de calibración Q₀ · dosis</span><strong data-testid="r50-q0-value">{number(context.q0Quality,5)} <small>g/cm²</small></strong></div>
      <div className="mcc-metric"><span>kQ,Qint · respecto a 7,5 g/cm²</span><strong data-testid="kq-qint-value">{number(result.numerator?.value)}</strong></div>
      <div className="mcc-metric"><span>kQ₀,Qint · calibración respecto a 7,5</span><strong data-testid="kq0-qint-value">{number(result.denominator?.value)}</strong></div>
    </div><p className="mcc-note">Qint es la calidad intermedia R₅₀ = 7,5 g/cm², no una energía nominal de 7,5 MeV. Introduce la calidad del certificado como R₅₀ o R₅₀,ion; no como MeV.</p><p className="mcc-formula">kQ,Q₀ = kQ,Qint / kQ₀,Qint = {number(result.numerator?.value)} / {number(result.denominator?.value)} = {number(result.value)}</p></>}
    {context.error||result.error?<p className="mcc-warnings">{context.error||result.error}</p>:<>
      <div className="mcc-table-wrap"><table className="mcc-kq-table"><thead><tr><th>Interpolación</th><th>Q inferior</th><th>k inferior</th><th>Q superior</th><th>k superior</th></tr></thead><tbody>{[['Numerador',result.numerator],...(electron&&settings.q0Type==='electron'?[['Denominador Q₀',result.denominator]]:[])].map(([name,row])=><tr key={name}><th>{name}</th><td>{number(row.low,5)}</td><td>{number(row.lowValue)}</td><td>{number(row.high,5)}</td><td>{number(row.highValue)}</td></tr>)}</tbody></table></div>
    </>}
    {result.warnings?.map(w=><p className="mcc-warnings" key={w}>{w}</p>)}
    <p className="mcc-note">Factores genéricos del protocolo; no sustituyen los kQ,Q₀ medidos del certificado de tu cámara. Las cifras mostradas facilitan la interpolación y no representan su incertidumbre. No incluyen correcciones ambientales, de polaridad o recombinación. {context.tableKey==='398-photon'?'En FFF, TRS‑398 Rev.1 trata kvol por separado.':''}</p>
    <button onClick={onExport}>Exportar cálculo y trazabilidad JSON</button>
  </section>
}
