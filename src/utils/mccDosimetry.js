import { R50_GRID, STOPPING_ROWS, MSR_TABLES } from './mccProtocolData.js'

export const MCC_METHOD = 'mcc-1.4 / TRS-398 Rev.1 (2024) / TRS-483 (2017)'
const valid = n => typeof n === 'number' && Number.isFinite(n)
const lerp = (a,b,t) => a+(b-a)*t
function bracket(grid, x) {
  if (!valid(x) || x < grid[0] || x > grid.at(-1)) return null
  let hi = grid.findIndex(v => v >= x)
  if (!hi) hi = 1
  return [hi-1, hi, (x-grid[hi-1])/(grid[hi]-grid[hi-1])]
}
// Eq.37, depths in g/cm², not mm. For water rho=1, g/cm² numerically equals cm.
export function r50FromIon(i50) {
  return valid(i50) && i50 > 0 ? (i50 <= 10 ? 1.029*i50-0.06 : 1.059*i50-0.37) : null
}
export function stoppingPower(r50, relativeDepth) {
  const r = bracket(R50_GRID, r50), z = bracket(STOPPING_ROWS.map(row=>row[0]), relativeDepth)
  if (!r || !z) return null
  const rowValue = index => lerp(STOPPING_ROWS[index][r[0]+1], STOPPING_ROWS[index][r[1]+1], r[2])
  return lerp(rowValue(z[0]), rowValue(z[1]), z[2])
}
// Tables 15–17. Input dimensions in the measurement plane; generic linac, not CyberKnife.
export function equivalentMsr(x, y, filter, energy) {
  if (![x,y].every(v=>valid(v) && v>=3 && v<=12)) return null
  const table = filter === 'WFF' ? 15 : filter === 'FFF' && energy>=6 && energy<=7 ? 16 : filter === 'FFF' && energy===10 ? 17 : null
  if (!table) return null
  const cell = (a,b) => MSR_TABLES[table][12-Math.max(a,b)][Math.max(a,b)-Math.min(a,b)]
  const x0=Math.floor(x), x1=Math.ceil(x), y0=Math.floor(y), y1=Math.ceil(y)
  const value=lerp(lerp(cell(x0,y0),cell(x1,y0),x-x0),lerp(cell(x0,y1),cell(x1,y1),x-x0),y-y0)
  return { value, table }
}
export function equivalentSmallField(x,y) {
  if (![x,y].every(v=>valid(v)&&v>0)) return null
  const ratio=x/y
  return { value:Math.sqrt(x*y), aspectRatio:ratio, recommended:ratio>0.7 && ratio<1.4 }
}
export function tprPddIssues(p10,p20,{ filter, energy, ssd, xSurface, ySurface, water, confirmed }={}) {
  const issues=[]
  if(!['WFF','FFF'].includes(filter)) issues.push('Selecciona WFF o FFF para este barrido.')
  if(filter==='FFF'&&!(valid(energy)&&energy>0&&energy<=10)) issues.push('La estimación FFF requiere energía nominal conocida, mayor que 0 y hasta 10 MV.')
  if(!water) issues.push('Confirma que las profundidades están medidas en agua.')
  if(!valid(ssd)||Math.abs(ssd-100)>0.01) issues.push('PDD → TPR requiere SSD = 100 cm.')
  if(![xSurface,ySurface].every(valid)||Math.abs(xSurface-10)>0.01||Math.abs(ySurface-10)>0.01) issues.push('Introduce un campo de 10 × 10 cm en la superficie para esta conversión.')
  if(!valid(p10)||!valid(p20)||p10<=0||p20<=0||p20>=p10) issues.push('Se necesitan dosis válidas a 10 y 20 cm, con PDD(20) menor que PDD(10).')
  if(!confirmed) issues.push('Confirma las condiciones del PDD de este barrido para habilitar el TPR estimado.')
  return issues
}
// TRS-398 Rev.1 §6.3.1, note 36: fitted to WFF; evidence supports approximate FFF use.
export function tprFromPdd(p10,p20,options={}) {
  if(tprPddIssues(p10,p20,options).length) return null
  const value=1.2661*p20/p10-0.0595
  return value>0 && value<1 ? value : null
}
export function tprToReference(tpr, s) {
  if (!valid(tpr) || tpr<=0 || tpr>=1 || !valid(s) || s<4 || s>12) return null
  return (tpr+0.01615*(10-s))/(1+0.01615*(10-s))
}
export function lcpeRadius(tpr) {
  return valid(tpr) && tpr>=0.5 && tpr<=0.85 ? Math.max(0,8.369*tpr-4.382) : null
}
