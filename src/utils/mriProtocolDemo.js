// Synthetic protocol-print examples; no patient data or clinical reference settings.
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
export function makeMriDemoXml(scanner, entries) {
  return `<?xml version="1.0" encoding="UTF-8"?><ProtocolPrint><PrintTOC><TOC><HeaderTitle>${escape(scanner)}</HeaderTitle><region name="Neuro"><NormalExam_dot_engine name="Craneal">${entries.map(e => `<program name="${escape(e.program)}"><step name="${escape(e.name)}" Id="${escape(e.id)}"/></program>`).join('')}</NormalExam_dot_engine></region></TOC></PrintTOC><PrintProtocol>${entries.map(e => `<Protocol Id="${escape(e.id)}"><HeaderTitle>${escape(e.name)}</HeaderTitle><Header><Info><HeaderProtPath>\\${escape(scanner)}\\Neuro\\Craneal\\${escape(e.program)}\\${escape(e.name)}</HeaderProtPath><HeaderProperty>TA: ${escape(e.ta || '1:59')}; Voxel size: 0.9×0.9×3.0 mm</HeaderProperty></Info></Header><Card name="Routine" ID="1"><ProtParameter><Name>TR</Name><Value>${e.tr} ms</Value></ProtParameter><ProtParameter><Name>Slices</Name><Value>${e.slices}</Value></ProtParameter><ProtParameter><Name>Dist. factor</Name><Value>${e.gap} %</Value></ProtParameter></Card><Card name="Resolution - Filter Image" ID="2"><ProtParameter><Name>Distortion Corr.</Name><Value>${e.correction}</Value></ProtParameter></Card></Protocol>`).join('')}</PrintProtocol></ProtocolPrint>`
}
const baseline = { name: 't1_se_r_cor_3mm', tr: 525, slices: 38, gap: 10, correction: 'On' }
export const MRI_DEMO_FILES = [
  { name: 'demo_equipo_A.xml', xml: makeMriDemoXml('DEMO · Equipo A', [
    { ...baseline, id: 'a1', program: 'Craneal' },
    { ...baseline, id: 'a2', program: 'Oído', tr: 600, slices: 21, gap: 33, correction: 'Off', ta: '3:27' },
    { ...baseline, id: 'a3', program: 'Control', name: 't2_tse_ax', tr: 4000 },
    { ...baseline, id: 'a4', program: 'Seguimiento', name: 't2_tse_ax', tr: 4000 },
  ]) },
  { name: 'demo_equipo_B.xml', xml: makeMriDemoXml('DEMO · Equipo B', [
    { ...baseline, id: 'b1', program: 'Craneal', tr: 600 },
    { ...baseline, id: 'b2', program: 'Control', name: 't2_tse_ax', tr: 4000 },
    { ...baseline, id: 'b3', program: 'Difusión', name: 'ep2d_diff', tr: 5000 },
  ]) },
]
