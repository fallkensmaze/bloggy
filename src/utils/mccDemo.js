// Synthetic curves, not clinical measurements or commissioned reference data.
export function mccDemo() {
  const make=(id,type,filter,mode,energy,points)=>`BEGIN_SCAN ${id}\nLINAC=DEMO\nMODALITY=${mode}\nENERGY=${energy}\nFILTER=${filter}\nSSD=1000\nISOCENTER=1000\nSCAN_DEPTH=100\nFIELD_INPLANE=100\nFIELD_CROSSPLANE=100\nGANTRY=0\nCOLL_ANGLE=0\nWEDGE_ANGLE=0\nSCAN_OFFAXIS_INPLANE=0\nSCAN_OFFAXIS_CROSSPLANE=0\nCOLL_OFFSET_INPLANE=0\nCOLL_OFFSET_CROSSPLANE=0\nMEAS_MEDIUM=WATER\nDETECTOR=DEMO\nSCAN_CURVETYPE=${type}\nBEGIN_DATA\n${points.map(([x,y])=>`${x.toFixed(2)} ${y.toFixed(8)}`).join('\n')}\nEND_DATA\nEND_SCAN ${id}`
  const photon=Array.from({length:301},(_,x)=>[x,x<15?0.35+0.65*x/15:Math.exp(-(x-15)/190)])
  const electron=Array.from({length:141},(_,i)=>{const x=i*.5;return [x,(0.8+0.2*(1-Math.exp(-x/3)))/(1+Math.exp((x-30)/3))+0.01]})
  const profile=(axis,fff)=>Array.from({length:401},(_,i)=>{const x=(i-200)*.4;return [x,(fff?Math.exp(-Math.abs(x)/180):1)/(1+Math.exp((Math.abs(x-axis)-50)/1.5))]})
  return `BEGIN_SCAN_DATA\n${[
    make(1,'PDD','FF','X',6,photon),make(2,'PDD','FF','EL',9,electron),
    make(3,'INPLANE_PROFILE','FFF','X',6,profile(0,true)),make(4,'CROSSPLANE_PROFILE','FFF','X',6,profile(.2,true)),
    make(5,'INPLANE_PROFILE','FF','X',6,profile(0,false))].join('\n')}\nEND_SCAN_DATA`
}
