import { KQ_TABLES } from '../utils/mccKqData.js'

const number=(v,digits=4)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—'
export default function MccKqPanel({settings,onChange,context,result,onExport}) {
  const table=KQ_TABLES[context.tableKey],electron=settings.source==='electron'
  const set=(key,value)=>onChange({...settings,[key]:value})
  return <section className="mcc-card" aria-label="Factor de calidad de cámara">
    <h2>Factor de calidad k<sub>Q,Q₀</sub> · cámara de ionización</h2>
    <p>Selecciona la cámara utilizada para la dosimetría de referencia y la calidad de su calibración. Puede ser distinta del detector con el que adquiriste el MCC.</p>
    <div className="mcc-fields mcc-kq-fields">
      <label className="mcc-field"><span>Calidad Q utilizada</span><select aria-label="Calidad Q utilizada" value={settings.source} onChange={e=>onChange({...settings,source:e.target.value,chamber:'',q0Type:'co60',q0Quality:''})}><option value="photon">TPR del bloque anterior · fotones</option><option value="electron">R₅₀ del PDD activo · electrones</option></select></label>
      <label className="mcc-field"><span>Calibración Q₀</span><select aria-label="Calibración Q0" value={settings.q0Type} onChange={e=>onChange({...settings,q0Type:e.target.value,chamber:'',q0Quality:''})}><option value="co60">Cobalto‑60 · Nᴅ,w,Co60</option>{electron&&<option value="electron">Electrones · Nᴅ,w,Q₀ / calibración cruzada</option>}</select></label>
      {electron&&settings.q0Type==='electron'&&<label className="mcc-field"><span>R₅₀ de calibración Q₀ (g/cm²)</span><input aria-label="R50 de calibración Q0" type="number" step="any" value={settings.q0Quality} onChange={e=>set('q0Quality',e.target.value)}/></label>}
      <label className="mcc-field"><span>Modelo exacto de cámara ({Object.keys(table?.rows||{}).length})</span><select aria-label="Modelo exacto de cámara" value={table?.rows[settings.chamber]?settings.chamber:''} onChange={e=>set('chamber',e.target.value)}><option value="">Seleccionar cámara…</option>{Object.keys(table?.rows||{}).map(name=><option key={name} value={name}>{name}</option>)}</select></label>
    </div>
    <p className="mcc-note">{table?.label||'Tabla pendiente'} · {context.origin||'Origen pendiente'}. Interpolación lineal dentro de los valores publicados; no se sustituye por otra cámara ni se extrapola.</p>
    <div className="mcc-metrics"><div className="mcc-metric"><span>{electron?'R₅₀ de calidad Q':'TPR₂₀,₁₀ de calidad Q'}</span><strong>{number(context.quality,5)} <small>{context.unit}</small></strong></div><div className="mcc-metric"><span>kQ,Q₀ {settings.q0Type==='co60'?'(kQ respecto a ⁶⁰Co)':''}</span><strong data-testid="kqqo-value">{number(result.value)}</strong></div></div>
    {context.error||result.error?<p className="mcc-warnings">{context.error||result.error}</p>:<>
      <div className="mcc-table-wrap"><table className="mcc-kq-table"><thead><tr><th>Interpolación</th><th>Q inferior</th><th>k inferior</th><th>Q superior</th><th>k superior</th></tr></thead><tbody>{[['Numerador',result.numerator],...(electron&&settings.q0Type==='electron'?[['Denominador Q₀',result.denominator]]:[])].map(([name,row])=><tr key={name}><th>{name}</th><td>{number(row.low,5)}</td><td>{number(row.lowValue)}</td><td>{number(row.high,5)}</td><td>{number(row.highValue)}</td></tr>)}</tbody></table></div>
      {electron&&settings.q0Type==='electron'&&<p className="mcc-formula">kQ,Q₀ = kQ,Qint(R₅₀) / kQ₀,Qint(R₅₀,Q₀) · Qint = 7,5 g/cm²</p>}
    </>}
    {result.warnings?.map(w=><p className="mcc-warnings" key={w}>{w}</p>)}
    <p className="mcc-note">Factores genéricos del protocolo; no sustituyen los kQ,Q₀ medidos del certificado de tu cámara. Las cifras mostradas facilitan la interpolación y no representan su incertidumbre. No incluyen correcciones ambientales, de polaridad o recombinación. {context.tableKey==='398-photon'?'En FFF, TRS‑398 Rev.1 trata kvol por separado.':''}</p>
    <button onClick={onExport}>Exportar cálculo y trazabilidad JSON</button>
  </section>
}
