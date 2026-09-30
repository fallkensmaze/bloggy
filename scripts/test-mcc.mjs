import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseMcc, mccNumber } from '../src/utils/mccParser.js'
import { analyzeMcc, analyzeMccBatch, defaultMccOptions, confirmPddDose, interpolate, profilePairIssues } from '../src/utils/mccAnalysis.js'
import { r50FromIon, stoppingPower, equivalentMsr, equivalentSmallField, tprFromPdd, tprToReference } from '../src/utils/mccDosimetry.js'
import { STOPPING_ROWS, R50_GRID } from '../src/utils/mccProtocolData.js'
import { mccDemo } from '../src/utils/mccDemo.js'
const near=(a,b,t=1e-9)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<t,`${a} != ${b}`)
const parse=body=>parseMcc(`BEGIN_SCAN_DATA\nBEGIN_SCAN 1\nSCAN_CURVETYPE=PDD\n${body}\nEND_SCAN 1\nEND_SCAN_DATA`).scans[0]
const block='BEGIN_DATA\n0 1\n10 2\n20 1\nEND_DATA'
const scan=parse(block)
assert.equal(scan.points[0].reference,null)
near(mccNumber('1,25D+1'),12.5)
assert.equal(mccNumber(''),null);assert.equal(mccNumber('1oops'),null)
assert.equal(mccNumber('1E999'),null)
assert.throws(()=>parse(block.replace('20 1','NaN 1')),/numérica/)
assert.throws(()=>parse(block.replace('20 1','10 1')),/duplicadas/)
assert.throws(()=>parseMcc('BEGIN_SCAN 1\n'+block),/truncado/)
assert.throws(()=>parseMcc('BEGIN_SCAN 1\n'+block+'\nEND_SCAN 2'),/incoherente/)
const descending=parse(block.replace('0 1\n10 2\n20 1','20 1\n10 2\n0 1'))
assert.deepEqual(descending.points,scan.points)
const two=parseMcc(`BEGIN_SCAN 1\nFILTER=FFF\nENERGY=10\n${block}\nEND_SCAN 1\nBEGIN_SCAN 2\n${block}\nEND_SCAN 2`).scans
assert.equal(two[1].metadata.FILTER,undefined)
assert.equal(defaultMccOptions(two[1]).filter,'unknown')
// BeamScan export: acquisition field differs from reference setup. Keep those apart.
const beamScan={...scan,metadata:{MODALITY:'X',FILTER:'FFF',ENERGY:'6',SSD:'1000',ISOCENTER:'1000',FIELD_INPLANE:'100',FIELD_CROSSPLANE:'100',REF_FIELD_INPLANE:'200',REF_FIELD_CROSSPLANE:'200',MEAS_MEDIUM:'WATER',MEAS_UNIT:'Gy/min'},points:[{x:0,y:30},{x:15,y:100},{x:100,y:63},{x:200,y:34},{x:300,y:18}]}
const imported=defaultMccOptions(beamScan)
assert.equal(imported.xSurface,10);assert.equal(imported.ySurface,10)
assert.equal(imported.quantity,'unknown','Gy/min alone is not detector validation')
assert.equal(defaultMccOptions({...beamScan,metadata:{...beamScan.metadata,SSD:'900'}}).xSurface,'')
assert.equal(defaultMccOptions({...beamScan,metadata:{...beamScan.metadata,ISOCENTER:undefined}}).xSurface,'')
const waiting=analyzeMcc(beamScan,imported)
assert.equal(waiting.tpr,null)
assert.ok(!waiting.tprIssues.some(x=>x.startsWith('Se necesitan dosis')),'Existing 10/20 cm data must not be described as absent')
const accepted=confirmPddDose(imported,true)
assert.equal(accepted.quantity,'dose')
near(analyzeMcc(beamScan,accepted).tpr,1.2661*34/63-.0595)
assert.equal(analyzeMcc(beamScan,confirmPddDose(accepted,false)).tpr,null)
assert.equal(confirmPddDose({...imported,modality:'electron',quantity:'ion'},true).quantity,'ion')
assert.equal(imported.referenceConfirmed,false,'Confirmation must not mutate another scan settings object')
assert.throws(()=>analyzeMcc(scan,{...defaultMccOptions(scan),reference:true}),/Referencia ausente/)
assert.equal(analyzeMcc(scan).metrics,null,'Unknown quantity must not be labelled dose')
near(interpolate([{x:0,y:0},{x:2,y:10},{x:10,y:18}],6),14)
assert.equal(interpolate(scan.points,21),null)

// TRS-398 Eq.37: all arguments in g/cm² (mm conversion is tested through analysis).
near(r50FromIon(3),3.027);near(r50FromIon(10),10.23);near(r50FromIon(11),11.279)
assert.equal(r50FromIon(null),null)
// Hand-checked Table 22 corners and bilinear midpoint of four entries.
near(stoppingPower(1,.02),1.076);near(stoppingPower(10,1.2),1.115)
near(stoppingPower(3,.5),1.058);near(stoppingPower(3.25,.525),(1.058+1.051+1.062+1.056)/4)
assert.equal(stoppingPower(10.01,.5),null);assert.equal(stoppingPower(3,0),null)
assert.equal(stoppingPower(3,1.201),null)
assert.equal(STOPPING_ROWS.length,25)
for(const row of STOPPING_ROWS) assert.equal(row.length,R50_GRID.length+1)

// Synthetic electron I50 chosen so Eq.37 gives exactly R50=3.
const i50=(3+.06)/1.029*10
const electron={...scan,metadata:{MODALITY:'EL',MEAS_MEDIUM:'WATER',SSD:'1000'},points:[
  {x:0,y:70},{x:1,y:80},{x:6,y:90},{x:15,y:100},{x:20,y:85},{x:i50,y:50},{x:30,y:49},{x:36,y:8},{x:45,y:1}
]}
const ion=analyzeMcc(electron,{...defaultMccOptions(electron),quantity:'ion'})
near(ion.electron.r50,3)
near(ion.electron.r50ion,i50/10)
near(ion.dose.find(p=>p.x===6).y,90*1.034/1.058)
near(ion.dose.find(p=>p.x===30).y,49*1.107/1.058)
assert.ok(!ion.dose.some(p=>p.x===0||p.x===45),'No extrapolation of stopping powers')
assert.ok(ion.metrics.r50>i50,'Dose R50 must differ from ion R50')
near(ion.electron.zref,1.7)
const dose=analyzeMcc(electron,{...defaultMccOptions(electron),quantity:'dose'})
near(dose.dose.find(p=>p.x===6).y,90) // No second stopping-power correction
near(dose.metrics.r50,i50)
assert.throws(()=>analyzeMcc(electron,{...defaultMccOptions(electron),quantity:'ion',water:false}),/agua/)
const shifted=analyzeMcc(electron,{...defaultMccOptions(electron),quantity:'dose',depthShift:-1})
near(shifted.metrics.r50,i50-1)
const tailScan={...electron,points:[[0,50],[5,80],[10,100],[15,83.6666666667],[20,67.3333333333],[25,51],[30,34.6666666667],[35,18.3333333333],[40,2],[45,2],[50,2],[55,2],[60,2],[65,2]].map(([x,y])=>({x,y}))}
near(analyzeMcc(tailScan,{...defaultMccOptions(tailScan),quantity:'dose'}).metrics.rp,40,1e-7)
assert.equal(ion.metrics.rp,null,'Limited stopping-power table must not manufacture a distal dose tail')
assert.equal(analyzeMcc(electron,{...defaultMccOptions(electron),quantity:'dose',water:false}).electron,null)

// Analytic trapezoid: 100 mm FWHM; 20-to-80 crossings separated by 12 mm.
const profile={...scan,type:'INPLANE_PROFILE',metadata:{MODALITY:'X',FILTER:'FF'},points:[[-70,0],[-60,0],[-50,50],[-40,100],[0,100],[40,100],[50,50],[60,0],[70,0]].map(([x,y])=>({x,y}))}
const pr=analyzeMcc(profile,defaultMccOptions(profile))
near(pr.metrics.width,100);near(pr.metrics.penumbraLeft,12);near(pr.metrics.penumbraRight,12)
near(pr.metrics.flatness,0);near(pr.metrics.symmetry,0)
assert.equal(analyzeMcc(profile,{...defaultMccOptions(profile),filter:'FFF'}).metrics.flatness,null)
assert.equal(analyzeMcc(profile,{...defaultMccOptions(profile),regime:'small'}).metrics.flatness,null)
assert.equal(analyzeMcc({...profile,points:profile.points.filter(p=>p.x>=0)},defaultMccOptions(profile)).metrics,null)

// Table 16/17 published square examples. 10x10 FFF is NOT 10 cm uniform.
near(equivalentMsr(10,10,'FFF',6).value,9.5)
near(equivalentMsr(10,10,'FFF',10).value,9.1)
near(equivalentMsr(12,12,'FFF',6).value,11.2)
near(equivalentMsr(3,3,'FFF',10).value,3)
near(equivalentMsr(10,10,'WFF',6).value,10)
near(equivalentMsr(10.5,10.5,'FFF',6).value,(9.5+9.9+9.9+10.4)/4)
near(equivalentMsr(4.2,9.7,'FFF',10).value,equivalentMsr(9.7,4.2,'FFF',10).value)
assert.equal(equivalentMsr(2.9,10,'FFF',6),null)
assert.equal(equivalentMsr(10,10,'FFF',8),null)
near(equivalentSmallField(2,2.5).value,Math.sqrt(5))
assert.equal(equivalentSmallField(1,3).recommended,false)
assert.equal(equivalentSmallField(NaN,3),null)
near(tprToReference(.65,9.5),(.65+.01615*.5)/(1+.01615*.5))
near(tprToReference(.65,10),.65)
assert.equal(tprToReference(.65,3.9),null)
const geometry={filter:'WFF',ssd:100,xSurface:10,ySurface:10,water:true,confirmed:true}
near(tprFromPdd(67,38,geometry),1.2661*38/67-.0595)
for(const change of [{filter:'FFF'},{ssd:90},{xSurface:9},{confirmed:false},{water:false}]) assert.equal(tprFromPdd(67,38,{...geometry,...change}),null)
for(const energy of [6,10]) near(tprFromPdd(63,34,{...geometry,filter:'FFF',energy}),1.2661*34/63-.0595)
for(const energy of [null,0,15,NaN]) assert.equal(tprFromPdd(63,34,{...geometry,filter:'FFF',energy}),null)
for(const change of [{ssd:90},{xSurface:5},{confirmed:false}]) assert.equal(tprFromPdd(63,34,{...geometry,filter:'FFF',energy:6,...change}),null)
assert.equal(tprFromPdd(67,null,geometry),null)

// Public upstream fixtures: parser compatibility independent of our synthetic format.
for(const file of ['10x10PDD.mcc','10x10FFF.mcc','10x10noRef.mcc','E6_20X20pddxy.mcc']) {
  const data=parseMcc(readFileSync(new URL(`./fixtures/mcc/${file}`,import.meta.url),'utf8'),file)
  assert.ok(data.scans.length)
  for(const s of data.scans) {
    assert.ok(s.points.length>20)
    const r=analyzeMcc(s,{...defaultMccOptions(s),quantity:'dose'})
    assert.ok(r.metrics)
    if(s.type==='PDD') assert.ok(r.metrics.dmax>=0)
    else assert.ok(r.metrics.width>50)
  }
}
const realPdd=parseMcc(readFileSync(new URL('./fixtures/mcc/10x10PDD.mcc',import.meta.url),'utf8')).scans[0]
const real=analyzeMcc(realPdd,{...defaultMccOptions(realPdd),quantity:'dose'})
near(real.metrics.dmax,14)
near(real.metrics.pdd10,realPdd.points.find(p=>p.x===100).y/1.9154*100)
const demos=parseMcc(mccDemo()).scans
// Mixed multi-scan MCC: every scan gets its own result; one bad analysis cannot suppress others.
const mixed=demos.map((s,i)=>({...s,key:`mixed-${i}`}))
mixed[0]={...mixed[0],metadata:{...mixed[0].metadata,FILTER:'FFF'}}
const batchSettings={[mixed[0].key]:{...defaultMccOptions(mixed[0]),quantity:'dose',referenceConfirmed:true,xSurface:10,ySurface:10}}
const batch=analyzeMccBatch(mixed,batchSettings)
assert.equal(Object.keys(batch).length,5)
assert.equal(batch[mixed[0].key].tprInfo.filter,'FFF')
assert.equal(batch[mixed[0].key].tprInfo.estimated,true)
assert.match(batch[mixed[0].key].tprInfo.warning,/aproximación/)
assert.equal(batch[mixed[1].key].metrics,null,'Quantity declaration must not leak to another PDD')
near(batch[mixed[0].key].tpr,1.2661*batch[mixed[0].key].metrics.pdd20/batch[mixed[0].key].metrics.pdd10-.0595)
for(const i of [2,3,4]) assert.ok(batch[mixed[i].key].metrics.width>0)
const changed=analyzeMccBatch(mixed,{...batchSettings,[mixed[2].key]:{...defaultMccOptions(mixed[2]),center:''}})
assert.match(changed[mixed[2].key].error,/Centro/)
near(changed[mixed[0].key].tpr,batch[mixed[0].key].tpr)
near(changed[mixed[3].key].metrics.width,batch[mixed[3].key].metrics.width)
assert.notEqual(batch[mixed[2].key].metrics.centerDeviation,batch[mixed[3].key].metrics.centerDeviation)
assert.deepEqual(profilePairIssues(demos[2],demos[3]),[])
assert.ok(profilePairIssues(demos[2],{...demos[3],metadata:{...demos[3].metadata,SSD:'900'}}).length)
assert.ok(profilePairIssues(demos[2],demos[2]).length)
console.log('MCC: parser, public fixtures, stopping-power conversion, interpolation, profiles, field equivalence and TPR gates passed.')
