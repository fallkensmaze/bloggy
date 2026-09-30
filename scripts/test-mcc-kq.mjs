import assert from 'node:assert/strict'
import { KQ_TABLES } from '../src/utils/mccKqData.js'
import { interpolateKq, calculateKq, resolvePhotonQuality, qualityFactorContext, manualElectronQuality } from '../src/utils/mccKq.js'
import { parseMcc } from '../src/utils/mccParser.js'
import { mccDemo } from '../src/utils/mccDemo.js'
import { defaultMccOptions, analyzeMcc } from '../src/utils/mccAnalysis.js'
const near=(a,b)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-10,`${a} != ${b}`)
const calc=(tableKey,chamber,quality,extra={})=>calculateKq({tableKey,chamber,quality,...extra})

// Independent table checks against the IAEA printed pages, including blank low-energy cells.
near(interpolateKq('398-photon','PTW 30013',.65).value,.9920)
near(interpolateKq('398-photon','PTW 30013',.665).value,.9898)
near(interpolateKq('398-photon','PTW 31021',.82).value,.9587)
near(interpolateKq('398-photon','Sun Nuclear SNC600c',.78).value,.9703)
near(interpolateKq('398-electron-co','PTW 34001 Roos',4).value,.9222)
near(interpolateKq('398-electron-co','PTW 30013',3).value,.9300)
near(interpolateKq('398-electron-co','PTW 30013',3.25).value,(.9300+.9247)/2)
assert.equal(interpolateKq('398-electron-co','PTW 30013',2.99),null)
near(interpolateKq('398-electron-cross','PTW 34045',3).value,1.0409)
near(interpolateKq('398-electron-cross','PTW 34045',7.5).value,1)
near(interpolateKq('398-electron-cross','PTW 34045',7.25).value,1.00115)
near(calc('398-electron-cross','PTW 34045',3,{q0Type:'electron',q0Quality:4}).value,1.0409/1.0266)
near(calc('398-electron-cross','PTW 34045',3,{q0Type:'electron',q0Quality:7.5}).value,1.0409)
near(calc('398-electron-cross','PTW 30013',5,{q0Type:'electron',q0Quality:5}).value,1)
assert.equal(calc('398-electron-cross','PTW 30013',5,{q0Type:'electron',q0Quality:2}).value,null)
assert.equal(calc('398-electron-cross','PTW 34045',3).value,null,'Co60 must not use a cross-calibrated-only table')
assert.equal(calc('398-electron-co','PTW 34045',3).value,null,'Advanced Markus has no entry in Table 20')
near(calc('483-wff','PTW 30006/30013 Farmer',.69).value,.989)
near(calc('483-fff','PTW 30006/30013 Farmer',.69).value,.990)
near(calc('483-fff','IBA FC-65G (Wellhöfer IC 70) Farmer',.675).value,(.997+.994)/2)
assert.ok(calc('483-fff','PTW 30006/30013 Farmer',.69).warnings.some(x=>x.includes('volumen')))
assert.ok(calc('398-electron-co','PTW 34001 Roos',1).warnings.length)
for(const q of [null,NaN,.55,.83]) assert.equal(calc('398-photon','PTW 30013',q).value,null)
assert.equal(calc('398-photon','PTW 99999',.65).value,null)
assert.equal(calc('398-photon','PTW 30013',.65,{q0Type:'electron'}).value,null)

// Exact entries, ranges, and counts ensure null cells stay null rather than becoming zero.
assert.deepEqual(Object.values(KQ_TABLES).map(t=>Object.keys(t.rows).length),[26,8,16,28,28])
for(const [key,table] of Object.entries(KQ_TABLES)) for(const [chamber,values] of Object.entries(table.rows)) {
  assert.equal(values.length,table.grid.length)
  values.forEach((v,i)=>{if(v===null)assert.equal(interpolateKq(key,chamber,table.grid[i]),null);else near(interpolateKq(key,chamber,table.grid[i]).value,v)})
  assert.equal(interpolateKq(key,chamber,table.grid[0]-.01),null)
  assert.equal(interpolateKq(key,chamber,table.grid.at(-1)+.01),null)
}

// Full PDD -> TPR -> kQ chain, dynamically linked by scan key, no second field correction.
const scan={...parseMcc(mccDemo()).scans[0],key:'pdd-1'}
const options={...defaultMccOptions(scan),quantity:'dose',referenceConfirmed:true,xSurface:10,ySurface:10}
const measured=analyzeMcc(scan,options)
assert.ok(measured.tpr>0.56&&measured.tpr<.82)
const msr={source:'pdd',pddKey:scan.key,filter:'FFF',x:4,y:5,confirmed:true,tpr:.7}
const quality=resolvePhotonQuality(msr,[scan],{[scan.key]:measured})
near(quality.value,measured.tpr)
assert.equal(quality.correctionApplied,false)
assert.equal(quality.filter,'WFF');assert.equal(quality.tableKey,'398-photon')
const context=qualityFactorContext({source:'photon'},quality,null)
near(calculateKq({...context,chamber:'PTW 30013'}).value,interpolateKq('398-photon','PTW 30013',measured.tpr).value)
const invalid=analyzeMcc(scan,{...options,ssd:90})
assert.equal(resolvePhotonQuality(msr,[scan],{[scan.key]:invalid}).value,null)
assert.equal(resolvePhotonQuality(msr,[],{}).value,null)
const manual=resolvePhotonQuality({source:'manual',filter:'FFF',energy:6,x:10,y:10,tpr:.65,confirmed:true},[],{})
near(manual.value,(.65+.01615*.5)/(1+.01615*.5))
assert.equal(manual.tableKey,'483-fff');assert.equal(manual.correctionApplied,true)
const direct=resolvePhotonQuality({source:'reference',filter:'FFF',energy:10,tpr:.65,confirmed:true},[],{})
near(direct.value,.65);assert.equal(direct.tableKey,'398-photon')
assert.equal(resolvePhotonQuality({source:'reference',filter:'FFF',energy:15,tpr:.65,confirmed:true},[],{}).value,null)
assert.equal(resolvePhotonQuality({source:'reference',filter:'WFF',tpr:.65,confirmed:false},[],{}).value,null)
assert.equal(qualityFactorContext({source:'electron',q0Type:'electron'},manual,{r50:3}).tableKey,'398-electron-cross')
// A single ionization index uses Eq.37; an already dose-based index must not be corrected again.
near(manualElectronQuality('3','ion').r50,3.027)
near(manualElectronQuality('10','ion').r50,10.23)
near(manualElectronQuality('11','ion').r50,11.279)
near(manualElectronQuality('3','dose').r50,3)
for(const input of ['',null,'abc','-1','0','0.01']) assert.equal(manualElectronQuality(input,'ion').r50,null)
const manualContext=qualityFactorContext({source:'electron-manual',electronQuantity:'ion',electronQuality:'3',q0Type:'electron',q0Quantity:'ion',q0Quality:'4'},null,null)
near(manualContext.quality,3.027);near(manualContext.q0Quality,4.056)
const manualFactor=calculateKq({...manualContext,chamber:'PTW 34045',q0Type:'electron'})
near(manualFactor.numerator.value,1.0409+(3.027-3)/.5*(1.0332-1.0409))
near(manualFactor.value,manualFactor.numerator.value/manualFactor.denominator.value)
const noQ0=calculateKq({...manualContext,q0Quality:null,chamber:'PTW 34045',q0Type:'electron'})
assert.equal(noQ0.value,null);near(noQ0.numerator.value,manualFactor.numerator.value)
assert.equal(calculateKq({...manualContext,quality:11.279,chamber:'PTW 34045',q0Type:'electron'}).value,null)
console.log('MCC kQ: IAEA table entries, null cells, interpolation, Q0 ratios, provenance, no double correction, and invalidation passed.')
