import { mccNumber } from './mccParser.js'
import { r50FromIon, stoppingPower, tprFromPdd, tprPddIssues } from './mccDosimetry.js'

export function interpolate(points,x) {
  if (!Number.isFinite(x) || !points.length || x<points[0].x || x>points.at(-1).x) return null
  let lo=0,hi=points.length-1
  while(hi-lo>1) { const m=(lo+hi)>>1; if(points[m].x<=x) lo=m; else hi=m }
  if(points[lo].x===x) return points[lo].y
  if(points[hi].x===x) return points[hi].y
  const a=points[lo], b=points[hi]
  return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x)
}
export function crossings(points,level) {
  const out=[]
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i]
    if((a.y<level && b.y>=level)||(a.y>level && b.y<=level)) out.push(a.x+(level-a.y)*(b.x-a.x)/(b.y-a.y))
  }
  return out
}
function normalized(points) {
  const max=points.reduce((a,p)=>Math.max(a,p.y),-Infinity)
  if (!(max>0)) throw new Error('La señal máxima debe ser positiva.')
  return points.map(p=>({...p,y:p.y/max*100}))
}
function maximum(points) { return points.reduce((a,b)=>b.y>a.y?b:a) }
function distal(points,level) {
  const peak=maximum(points)
  return crossings(points,level).find(x=>x>peak.x) ?? null
}
function metricsPdd(points) {
  return { dmax:maximum(points).x, pdd5:interpolate(points,50),pdd10:interpolate(points,100),pdd20:interpolate(points,200),
    r90:distal(points,90),r80:distal(points,80),r50:distal(points,50),r20:distal(points,20) }
}
function practicalRange(points) {
  const r50=distal(points,50),r60=distal(points,60),r40=distal(points,40)
  if(r50===null||r60===null||r40===null||r40<=r60) return null
  const tail=points.filter(p=>p.x>1.3*r50 && p.y<=10)
  if(tail.length<5 || tail.at(-1).x-tail[0].x<5) return null
  const mx=tail.reduce((s,p)=>s+p.x,0)/tail.length,my=tail.reduce((s,p)=>s+p.y,0)/tail.length
  const slope=tail.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/tail.reduce((s,p)=>s+(p.x-mx)**2,0)
  const descent=-20/(r40-r60),rp=(my-slope*mx-60+descent*r60)/(descent-slope)
  return Number.isFinite(rp)&&rp>r40&&rp<=points.at(-1).x?rp:null
}
export function defaultMccOptions(scan) {
  const m=scan.metadata, mode=(m.MODALITY||'').toUpperCase()
  const modality=['E','EL','ELECTRON','ELECTRONS'].includes(mode)?'electron':['X','PHOTON','PHOTONS'].includes(mode)?'photon':'unknown'
  const filter=(m.FILTER||'').toUpperCase()==='FFF'?'FFF':['FF','WFF'].includes((m.FILTER||'').toUpperCase())?'WFF':'unknown'
  // FIELD_* is the acquired field; REF_FIELD_* belongs to the reference setup.
  // At SSD = isocentre distance, the surface and isocentre field planes coincide.
  const ssd=mccNumber(m.SSD),isocenter=mccNumber(m.ISOCENTER)
  const surfaceKnown=ssd>0&&isocenter>0&&Math.abs(ssd-isocenter)<0.01
  const surfaceField=key=>surfaceKnown&&mccNumber(m[key])>0?mccNumber(m[key])/10:''
  return { modality,filter,energy:mccNumber(m.ENERGY)??'',quantity:'unknown',reference:false,depthShift:0,center:0,
    ssd:ssd===null?'':ssd/10,water:m.MEAS_MEDIUM==='WATER',referenceConfirmed:false,
    xSurface:surfaceField('FIELD_CROSSPLANE'),ySurface:surfaceField('FIELD_INPLANE'),regime:'auto' }
}
// This action is labelled as accepting the exported photon curve as relative dose.
// Measurement units alone do not certify detector corrections, particularly for electrons.
export function confirmPddDose(options,confirmed) {
  return {...options,referenceConfirmed:confirmed,quantity:confirmed&&options.modality==='photon'?'dose':options.quantity}
}
export function analyzeMcc(scan, options=defaultMccOptions(scan)) {
  const warnings=[...scan.warnings],m=scan.metadata
  if(!['PDD','INPLANE_PROFILE','CROSSPLANE_PROFILE'].includes(scan.type)) throw new Error('Solo se analizan PDD y perfiles ortogonales.')
  if(m.SCAN_DIAGONAL && m.SCAN_DIAGONAL!=='NOT_DIAGONAL') throw new Error('Perfil diagonal: no se admite como perfil ortogonal.')
  let signal=scan.points.map(p=>({ x:p.x,y:p.y }))
  if(options.reference) {
    if(scan.points.some(p=>p.reference===null || p.reference<=0)) throw new Error('Referencia ausente o no positiva en uno o más puntos.')
    signal=scan.points.map(p=>({x:p.x,y:p.y/p.reference}))
    warnings.push('Se ha dividido señal/referencia por indicación del usuario. Verificar que el MCC no estuviera ya corregido.')
  }
  if(signal.some(p=>p.y<0)) throw new Error('Hay señales negativas: revisar polaridad/fondo antes de analizar.')
  if(options.modality==='unknown') warnings.push('Selecciona la modalidad del haz; los indicadores dosimétricos no se infieren por la forma.')
  if(options.filter==='unknown' && options.modality==='photon') warnings.push('Filtro desconocido: selecciona WFF o FFF.')
  const maxGap=signal.reduce((gap,p,i)=>i?Math.max(gap,p.x-signal[i-1].x):gap,0)
  if(scan.type==='PDD') {
    const shift=mccNumber(options.depthShift)
    if(shift===null) throw new Error('Indica un desplazamiento de profundidad válido (0 si ya está corregido).')
    signal=signal.map(p=>({...p,x:p.x+shift}))
    if(signal.some(p=>p.x<0)) warnings.push('Existen posiciones por encima de la superficie tras el desplazamiento.')
    const raw=normalized(signal), rawMetrics=metricsPdd(raw)
    let dose=null,metrics=null,electron=null,tpr=null,tprInfo=null,tprIssues=[]
    if(options.quantity==='dose') { dose=raw; metrics=rawMetrics }
    if(options.modality==='electron' && options.quantity==='ion') {
      if(!options.water) throw new Error('La conversión de electrones exige profundidades equivalentes en agua.')
      const r50ion=rawMetrics.r50===null?null:rawMetrics.r50/10
      const r50=r50FromIon(r50ion)
      electron={r50ion,r50,zref:r50>0?0.6*r50-0.1:null}
      if(r50===null) warnings.push('No se alcanza el 50% distal de ionización; no se puede seleccionar s(w,air).')
      else {
        const corrected=signal.map(p=>({...p,stopping:stoppingPower(r50,(p.x/10)/r50)}))
        const eligible=corrected.filter(p=>p.stopping!==null)
        const outside=corrected.length-eligible.length
        if(outside) warnings.push(`${outside} puntos fuera de tabla 22 (R50: 1–10 g/cm²; z/R50: 0,02–1,20); no se extrapolan ni se presentan como dosis.`)
        if(eligible.length>=3) {
          const converted=eligible.map(p=>({...p,y:p.y*p.stopping}))
          const peak=maximum(converted), idx=converted.indexOf(peak)
          if(idx===0 || idx===converted.length-1) warnings.push('Máximo de dosis en el borde del intervalo tabulado: normalización no evaluable.')
          else { dose=normalized(converted);metrics=metricsPdd(dose) }
        }
      }
      warnings.push('Conversión I(z)·s(w,air) con perturbación relativa asumida constante. Deben estar revisadas recombinación, polaridad y posición efectiva; no se aplican automáticamente.')
      if(mccNumber(options.ssd)!==100) warnings.push('R50: las condiciones de referencia requieren SSD 100 cm.')
    } else if(options.modality==='electron' && metrics && options.water) {
      electron={r50ion:null,r50:metrics.r50===null?null:metrics.r50/10,zref:metrics.r50===null?null:0.6*metrics.r50/10-0.1}
    }
    if(options.quantity==='unknown') warnings.push('Declara si los datos son dosis o ionización antes de calcular parámetros de dosis.')
    if(options.modality==='electron' && !options.water) warnings.push('R50 como índice de calidad requiere profundidades en agua; no se informa en g/cm² sin confirmar el medio.')
    if(raw[0].y>=99.99 || raw.at(-1).y>=99.99) warnings.push('Máximo de señal en un extremo: el barrido puede estar incompleto.')
    if(options.modality==='photon') {
      const conditions={...options,energy:mccNumber(options.energy),ssd:mccNumber(options.ssd),xSurface:mccNumber(options.xSurface),ySurface:mccNumber(options.ySurface),confirmed:options.referenceConfirmed}
      tprIssues=tprPddIssues((metrics||rawMetrics)?.pdd10,(metrics||rawMetrics)?.pdd20,conditions)
      if(options.quantity!=='dose') tprIssues.unshift('Declara dosis relativa / detector validado para calcular TPR desde este PDD.')
      if(!tprIssues.length) tpr=tprFromPdd(metrics.pdd10,metrics.pdd20,conditions)
      if(tpr!==null) {
        tprInfo={filter:options.filter,energy:conditions.energy,estimated:true,method:'TRS-398 Rev.1 §6.3.1, nota 36',pddRatio:metrics.pdd20/metrics.pdd10}
        if(options.filter==='FFF') {
          tprInfo.warning='TPR FFF estimado con una relación ajustada a WFF; TRS-398 Rev.1 nota 36 menciona evidencia de uso aproximado. Contrastar con TPR medido antes de usarlo para calibración; el kQ vinculado hereda esta aproximación.'
          warnings.push(tprInfo.warning)
        }
      } else warnings.push(...tprIssues)
    }
    if(options.modality==='photon' && options.quantity==='ion') warnings.push('Ionización de fotones: no se convierte automáticamente a PDD. Usa datos de dosis o declara expresamente la aproximación en origen.')
    if(metrics && options.modality==='electron') metrics.rp=practicalRange(dose)
    return {type:'PDD',raw,dose,metrics,rawMetrics,electron,tpr,tprInfo,tprIssues,warnings,maxGap}
  }
  const raw=normalized(signal),center=mccNumber(options.center)
  if(center===null) throw new Error('Centro de perfil no válido.')
  const cax=interpolate(raw,center)
  const edges=crossings(raw,50),left=edges.filter(x=>x<center).at(-1),right=edges.find(x=>x>center)
  if(left===undefined || right===undefined) return {type:'profile',raw,warnings:[...warnings,'No se delimitan ambos cruces de 50% alrededor del centro.'],metrics:null,maxGap}
  if(edges.length!==2) warnings.push('Cruces múltiples de 50%: revisar ruido, centrado o campos segmentados.')
  const width=right-left,beamCenter=(left+right)/2
  const edgeAt=(level,side)=>{ const xs=crossings(raw,level); return side==='left'?xs.filter(x=>x<center).at(-1)??null:xs.find(x=>x>center)??null }
  const pen=(side)=>{ const a=edgeAt(20,side),b=edgeAt(80,side);return a===null||b===null?null:Math.abs(b-a) }
  // Central 80% of FWHM, mirrored about the user-declared CAX (not recentered to hide a shift).
  const half=0.8*Math.min(center-left,right-center)
  const positions=[0,half,...raw.filter(p=>p.x>=center && p.x<=center+half).map(p=>p.x-center),...raw.filter(p=>p.x<=center && p.x>=center-half).map(p=>center-p.x)]
  const pairs=positions.map(d=>[interpolate(raw,center-d),interpolate(raw,center+d)])
  const values=pairs.flat(),max=values.reduce((a,b)=>Math.max(a,b),-Infinity),min=values.reduce((a,b)=>Math.min(a,b),Infinity)
  const symmetry=cax>0?pairs.reduce((max,[a,b])=>Math.max(max,Math.abs(a-b)),0)/cax*100:null
  const isSmall=options.regime==='small' || options.regime==='auto' && width<=40
  if(options.regime==='auto') warnings.push('≤40 mm se marca como posible campo pequeño solo para orientar la interfaz; TRS-483 no define un umbral universal. Revisa LCPE, oclusión de fuente y detector.')
  const flatness=options.filter==='WFF' && !isSmall ? 100*(max-min)/(max+min):null
  const unflatness=cax>0?cax/((interpolate(raw,center-half)+interpolate(raw,center+half))/2):null
  // Local least-squares gradient over five actual samples, separately at each edge.
  const inflections=['left','right'].map(side=>{
    let best=null
    for(let i=2;i<raw.length-2;i++) {
      const p=raw[i]
      if(side==='left' ? !(p.x<center-width*.2) : !(p.x>center+width*.2)) continue
      const part=raw.slice(i-2,i+3),mx=part.reduce((s,p)=>s+p.x,0)/5,my=part.reduce((s,p)=>s+p.y,0)/5
      const slope=part.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/part.reduce((s,p)=>s+(p.x-mx)**2,0)
      if(side==='left'?slope<=0:slope>=0) continue
      if(!best || Math.abs(slope)>Math.abs(best.slope)) best={x:p.x,y:p.y,slope}
    }
    return best
  })
  if(options.filter==='FFF' && !isSmall) warnings.push('FFF amplio: FWHM y penumbra 80–20 están referidos al máximo global, no al borde renormalizado. Se añade distancia entre inflexiones estimadas; no se aplican ajustes específicos de TrueBeam.')
  if(maxGap>width/10) warnings.push('Muestreo escaso respecto al tamaño de campo: revisar resolución espacial del perfil.')
  return {type:'profile',raw,maxGap,warnings,inflections,metrics:{width,beamCenter,centerDeviation:beamCenter-center,left,right,penumbraLeft:pen('left'),penumbraRight:pen('right'),flatness,symmetry,unflatness:options.filter==='FFF'?unflatness:null,inflectionWidth:inflections.every(Boolean)?inflections[1].x-inflections[0].x:null},isSmall}
}

export function analyzeMccBatch(scans,settings={}) {
  return Object.fromEntries(scans.map(scan=>{
    try { return [scan.key,analyzeMcc(scan,settings[scan.key]||defaultMccOptions(scan))] }
    catch(error) { return [scan.key,{error:error.message}] }
  }))
}

// Pair selection is explicit; never combine scans merely because their filenames match.
export function profilePairIssues(a,b) {
  const issues=[]
  if(!a || !b) return ['Selecciona dos perfiles.']
  if(!['INPLANE_PROFILE','CROSSPLANE_PROFILE'].includes(a.type) || !['INPLANE_PROFILE','CROSSPLANE_PROFILE'].includes(b.type) || a.type===b.type) issues.push('Se necesitan perfiles inplane y crossplane distintos.')
  for(const key of ['ENERGY','SSD','SCAN_DEPTH','FIELD_INPLANE','FIELD_CROSSPLANE','GANTRY','COLL_ANGLE']) {
    const x=mccNumber(a.metadata[key]),y=mccNumber(b.metadata[key])
    if(x===null || y===null) issues.push(`Falta ${key} para verificar la pareja.`)
    else if(Math.abs(x-y)>0.01) issues.push(`${key} no coincide.`)
  }
  for(const key of ['LINAC','MODALITY','FILTER']) if(!a.metadata[key] || !b.metadata[key] || a.metadata[key]!==b.metadata[key]) issues.push(`${key} ausente o diferente.`)
  for(const scan of [a,b]) for(const key of ['SCAN_OFFAXIS_INPLANE','SCAN_OFFAXIS_CROSSPLANE','COLL_OFFSET_INPLANE','COLL_OFFSET_CROSSPLANE','WEDGE_ANGLE']) {
    if(mccNumber(scan.metadata[key])!==0) issues.push(`${key}: confirma exportación central, simétrica y sin cuña.`)
  }
  return [...new Set(issues)]
}
