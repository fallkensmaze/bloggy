import { KQ_TABLES } from './mccKqData.js'
import { equivalentMsr, tprToReference } from './mccDosimetry.js'
import { mccNumber } from './mccParser.js'

const finite = x => typeof x === 'number' && Number.isFinite(x)
export function interpolateKq(tableKey, chamber, quality) {
  const table=KQ_TABLES[tableKey],values=table?.rows[chamber]
  if(!values || !finite(quality)) return null
  // Qint is defined exactly as R50=7.5, so its factor is 1 by definition.
  const grid=tableKey==='398-electron-cross'?[...table.grid.slice(0,12),7.5,...table.grid.slice(12)]:table.grid
  const data=tableKey==='398-electron-cross'?[...values.slice(0,12),1,...values.slice(12)]:values
  if(quality<grid[0] || quality>grid.at(-1)) return null
  const hi=grid.findIndex(x=>x>=quality)
  if(grid[hi]===quality) return finite(data[hi])?{value:data[hi],low:quality,high:quality,lowValue:data[hi],highValue:data[hi]}:null
  if(hi<=0 || !finite(data[hi-1]) || !finite(data[hi])) return null
  const t=(quality-grid[hi-1])/(grid[hi]-grid[hi-1])
  return {value:data[hi-1]+t*(data[hi]-data[hi-1]),low:grid[hi-1],high:grid[hi],lowValue:data[hi-1],highValue:data[hi]}
}
export function calculateKq({tableKey,chamber,quality,q0Type='co60',q0Quality=null}) {
  const table=KQ_TABLES[tableKey]
  if(!table) return {value:null,error:'No hay una tabla aplicable a esta calidad.'}
  if(!chamber || !table.rows[chamber]) return {value:null,error:'Selecciona el modelo exacto de cámara en la tabla aplicable.'}
  const cross=tableKey==='398-electron-cross'
  if(cross?q0Type!=='electron':q0Type!=='co60') return {value:null,error:'La calidad de calibración Q₀ no corresponde a esta tabla.'}
  const numerator=interpolateKq(tableKey,chamber,quality)
  if(!numerator) return {value:null,error:'Calidad Q ausente o fuera del intervalo publicado para esta cámara. No se extrapola.'}
  const denominator=cross?interpolateKq(tableKey,chamber,q0Quality):{value:1}
  if(!denominator) return {value:null,error:'R₅₀ de calibración Q₀ ausente o fuera de tabla.'}
  const warnings=[]
  if(tableKey.startsWith('398-electron') && (quality<1.4 || cross && q0Quality<1.4)) warnings.push('R₅₀ < 1,4 g/cm²: incertidumbre mayor; TRS‑398 recomienda factores determinados experimentalmente.')
  if(tableKey==='483-fff') warnings.push('La tabla 13 incluye una corrección genérica de promediado de volumen. No añadir de nuevo ese mismo kvol; una corrección específica requiere revisar el formalismo.')
  return {value:numerator.value/denominator.value,tableKey,table:table.label,chamber,quality,q0Type,q0Quality:cross?q0Quality:null,numerator,denominator,warnings}
}

// Keep the provenance of the quality index. The PDD relation already yields TPR(10).
export function resolvePhotonQuality(msr,scans,results) {
  if(msr.source==='pdd') {
    const scan=scans.find(s=>s.key===msr.pddKey),value=results[msr.pddKey]?.tpr
    if(!scan || !finite(value)) return {value:null,tableKey:'398-photon',error:'El PDD vinculado ya no tiene un TPR válido. Revisa su magnitud y geometría de referencia.'}
    return {value,input:value,tableKey:'398-photon',filter:'WFF',origin:'PDD → TPR de referencia (10×10)',scanKey:scan.key,fileName:scan.fileName,scanId:scan.id,correctionApplied:false}
  }
  if(msr.source==='reference') {
    const value=mccNumber(msr.tpr),energy=mccNumber(msr.energy)
    if(!msr.confirmed || value===null || value<=0 || value>=1 || !['FFF','WFF'].includes(msr.filter) || msr.filter==='FFF' && !(energy>0&&energy<=10)) return {value:null,tableKey:'398-photon',error:'Confirma el TPR de referencia 10×10. TRS‑398 Rev.1 admite FFF hasta 10 MV.'}
    return {value,input:value,tableKey:'398-photon',filter:msr.filter,origin:'TPR de referencia medido (10×10)',correctionApplied:false}
  }
  const square=equivalentMsr(mccNumber(msr.x),mccNumber(msr.y),msr.filter,mccNumber(msr.energy))
  const input=mccNumber(msr.tpr),value=msr.confirmed?tprToReference(input,square?.value):null
  const tableKey=msr.filter==='FFF'?'483-fff':'483-wff'
  return value===null?{value:null,tableKey,error:'Completa y confirma el TPR(S) y un campo msr válido.'}:{value,input,s:square.value,tableKey,filter:msr.filter,origin:'TPR(S) medido → TPR(10), TRS‑483 ec.28',correctionApplied:true}
}

export function qualityFactorContext(settings,photon,electron) {
  if(settings.source==='electron') return {quality:electron?.r50??null,tableKey:settings.q0Type==='electron'?'398-electron-cross':'398-electron-co',origin:'R₅₀ del PDD de electrones activo',unit:'g/cm²'}
  return {quality:photon.value,tableKey:photon.tableKey,origin:photon.origin,unit:'',error:photon.error}
}
