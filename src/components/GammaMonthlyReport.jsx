import { metricByKey, sensitivityReportMetric } from '../utils/gammaMonthlyReport.js'
import { GAMMA_TESTS } from '../utils/gammaReport.js'
import '../styles/gamma-monthly-report.css'

const fmt = (v, digits = 2) => Number.isFinite(v) ? v.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—'
const exceeded = m => Number.isFinite(m?.value) && Number.isFinite(m?.limit) && (m.operator === 'min' ? m.value < m.limit : m.value > m.limit)
const limit = m => Number.isFinite(m?.limit) ? `${m.operator === 'min' ? '≥' : '≤'} ${fmt(m.limit, Math.abs(m.limit * 100 - Math.round(m.limit * 100)) > 1e-8 ? 4 : 2)}` : 'Pendiente'
function Value({ metric, digits = 2 }) { return <span className={exceeded(metric) ? 'gamma-report-exceeded' : ''}>{fmt(metric?.value, digits)}</span> }
function State({ value }) { return <span className={`gamma-report-state ${value === 'No conforme' ? 'is-fail' : value === 'Conforme' || value?.startsWith('Conforme según') ? 'is-pass' : 'is-pending'}`}>{value || 'Pendiente'}</span> }
function Block({ title, description, children }) { return <section className="gamma-report-block"><h2>{title}</h2>{description && <p>{description}</p>}{children}</section> }

function TomoCurve({ result }) {
  const rows = result.results.filter(r => r.valid)
  if (!rows.length) return null
  const xmin = Math.min(...rows.map(r => r.diameterMm)), xmax = Math.max(...rows.map(r => r.diameterMm))
  const values = rows.flatMap(r => [r.minimumPercent, r.maximumPercent]).concat([100])
  const ymin = Math.min(...values) - 3, ymax = Math.max(...values) + 3
  const x = v => 45 + 480 * (v - xmin) / (xmax - xmin || 1), y = v => 165 - 135 * (v - ymin) / (ymax - ymin || 1)
  return <svg className="gamma-report-curve" viewBox="0 0 570 215" role="img" aria-label="Curva de mínimos y máximos de medias esféricas normalizadas">
    {[ymin, 100, ymax].map(v => <g key={v}><line x1="45" x2="535" y1={y(v)} y2={y(v)} stroke="#bbc6d5" strokeDasharray="3 3"/><text x="3" y={y(v) + 4} fontSize="10">{fmt(v, 0)} %</text></g>)}
    {['minimumPercent', 'maximumPercent'].map((key, i) => <g key={key} stroke={i ? '#b94d34' : '#1761a0'} fill="none"><polyline strokeWidth="2" points={rows.map(r => `${x(r.diameterMm)},${y(r[key])}`).join(' ')}/>{rows.map(r => <circle key={r.diameterMm} cx={x(r.diameterMm)} cy={y(r[key])} r="3"/>)}</g>)}
    {rows.map(r => <text key={r.diameterMm} x={x(r.diameterMm)} y="183" textAnchor="middle" fontSize="10">{r.diameterMm}</text>)}
    <text x="210" y="204" fontSize="11">Diámetro de esfera (mm)</text><text x="380" y="18" fill="#1761a0" fontSize="11">Mínimos</text><text x="460" y="18" fill="#b94d34" fontSize="11">Máximos</text>
  </svg>
}

export default function GammaMonthlyReport({ model, batch, details, responsible, images = [], logo, dailyImage, includeAnnex = true }) {
  const month = batch.month ? new Date(`${batch.month}-15T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }) : ''
  const quantitative = model.tomography?.details?.quantitative
  const tomoMetric = metricByKey(model.tomography, 'tomoUniformity') || model.tomographyMetrics?.[0]
  return <section className="gamma-monthly-report" aria-label="Informe mensual preparado">
    <div className="gamma-report-sheet">
      <header className="gamma-report-header">{logo && <img src={logo} alt="Logotipo del centro"/>}<div><strong>{details.hospital}</strong><span>{details.service}</span></div><span>CONTROL DE CALIDAD<br/>MEDICINA NUCLEAR</span></header>
      <div className="gamma-report-title"><h1>Resultados de las pruebas mensuales<br/>de control de calidad</h1><strong>{month}</strong></div>
      <div className="gamma-report-equipment"><h2>Gammacámara {details.camera || batch.equipment}</h2><strong>{details.serial ? `N.S. ${details.serial}` : batch.equipment}{details.room ? ` · sala ${details.room}` : ''}</strong></div>
      <p>Evaluación mensual del equipo según el programa de garantía de calidad del servicio. Los resultados se comparan con los límites y condiciones documentados para cada prueba.</p>
      <div className="gamma-report-verdict"><State value={model.verdict}/><span>Responsable: {responsible || 'Pendiente de identificar'}</span></div>
      {(model.missing.length > 0 || model.pendingFiles.length > 0) && <p className="gamma-report-pending">Pendiente: {[...model.missing, ...model.pendingFiles.map(f => `${f.file}: ${f.reason}`)].join('; ')}.</p>}
      <Block title="Uniformidad intrínseca" description="Respuesta del detector a una irradiación homogénea. Valores en porcentaje.">
        <table><thead><tr><th>Cabezal</th>{['UDCC', 'UDCT', 'UICC', 'UICT'].map(k => <th key={k}>{k}</th>)}<th>Estado</th></tr></thead><tbody>
          {model.uniformity.map(row => <tr key={row.head}><th>H{row.head}</th>{row.cells.map((m, i) => <td key={i}><Value metric={m}/><small>{limit(m)}</small></td>)}<td><State value={row.record?.status}/></td></tr>)}
        </tbody></table><p className="gamma-report-note">UDCC/UDCT: máxima uniformidad diferencial de ambas direcciones en CFOV/UFOV. UICC/UICT: uniformidad integral en CFOV/UFOV. Cálculo NEMA geométrico.</p>
      </Block>
      <Block title="Resolución espacial extrínseca" description="Anchura de la imagen de la fuente lineal, por cabezal y eje de medida.">
        <div className="gamma-report-pair">{['fwhm', 'fwtm'].map(key => <table key={key}><caption>{key.toUpperCase()} (mm)</caption><thead><tr><th></th><th>X</th><th>Y</th><th>Media</th><th>Límite</th></tr></thead><tbody>
          {model.resolution.map(row => { const m = row.widths.find(w => w.key === key); return <tr key={row.head}><th>H{row.head}</th><td>{fmt(m.x)}</td><td>{fmt(m.y)}</td><td><Value metric={m}/></td><td>{limit(m)}</td></tr> })}
        </tbody></table>)}</div>
        <p className="gamma-report-note">Comparación: {model.resolutionCriterion === 'mean' ? 'media aritmética de X e Y' : 'cada eje X e Y por separado'}. {model.resolution.map(r => `H${r.head}: ${r.status}`).join(' · ')}. Método adaptado de fuente lineal; revisar geometría y muestreo.</p>
      </Block>
      <Block title="Sensibilidad planar" description="Tasa neta de cuentas por actividad media de la fuente durante la adquisición.">
        <table><thead><tr><th>Cabezal</th><th>Resultado</th><th>Criterio</th><th>Estado</th></tr></thead><tbody>{model.sensitivity.map(row => {
          const displayRecord = row.record || { metrics: row.configuredMetrics }
          const m = sensitivityReportMetric(displayRecord), deviation = metricByKey(displayRecord, 'deviation')
          return <tr key={row.head}><th>H{row.head}</th><td><Value metric={m}/> {m?.unit || ''}</td><td>{deviation ? `|Δ referencia| ${limit(deviation)} %` : `${limit(m)} ${m?.unit || ''}`}</td><td><State value={row.record?.status}/></td></tr>
        })}</tbody></table><p className="gamma-report-note">1 cps/MBq = 2,22 cpm/µCi. El límite de referencia 202 cpm/µCi equivale a 90,99 cps/MBq; requiere verificar colimador y protocolo.</p>
      </Block>
      <Block title="Centro de rotación" description="Desviaciones del centro de rotación y de la alineación axial; cotas en mm.">
        <table className="gamma-report-cor"><thead><tr><th>Magnitud</th><th>Resultado (mm)</th><th>Tolerancia</th></tr></thead><tbody>{['deltaCorSingleMm', 'deltaCorPairMm', 'deltaAxialSingleMm', 'deltaAxialPairMm'].map((key, i) => {
          const m = metricByKey(model.cor, key) || model.corMetrics?.find(m => m.key === key)
          return <tr key={key}><th>{['δCOR,1', 'δCOR,12', 'δAXIAL,1', 'δAXIAL,12'][i]}</th><td><Value metric={m}/></td><td>{limit(m)}</td></tr>
        })}</tbody></table><p className="gamma-report-note">Adquisición: {model.cor?.acquiredAt || 'pendiente'} · {model.cor?.status || 'Pendiente'}.</p>
      </Block>
      <Block title="Uniformidad tomográfica" description="Revisión visual de la homogeneidad del volumen reconstruido, sus cortes y artefactos.">
        <p className="gamma-report-note"><strong>Uniformidad del protocolo:</strong> <Value metric={tomoMetric}/> % · Tolerancia: {limit(tomoMetric)} %. {model.tomography?.details?.definition || 'Definición de la medida pendiente.'}</p>
        <p className="gamma-report-observation">{model.tomography?.details?.observations || 'Revisión visual pendiente de documentar.'}</p>
        <div className="gamma-report-images">{images.map((im, i) => <figure key={i}><img src={im.src} alt={im.label} style={{ aspectRatio: im.aspectRatio }}/><figcaption>{im.label}</figcaption></figure>)}{dailyImage && <figure><img src={dailyImage} alt="Imagen de QC diario aportada"/><figcaption>QC diario · imagen aportada</figcaption></figure>}</div>
        <p className="gamma-report-note">{model.tomography?.status || 'Pendiente de revisión'}{quantitative ? ' · Análisis complementario de esferas 3D en el anexo.' : ''}{!images.length ? ' · Sin cortes seleccionados para el informe.' : ''}</p>
      </Block>
      {details.conclusion && <p className="gamma-report-conclusion"><strong>Observaciones generales:</strong> {details.conclusion}</p>}
      <footer>Identidad DICOM: {batch.equipment} · Periodo de adquisición: {batch.month} · gamma-qc-2.1<br/>Los valores en rojo exceden un límite numérico sin redondear; el estado incorpora las comprobaciones de adquisición. {model.excluded.length ? `${model.excluded.length} adquisición(es) excluida(s) del resumen; selección documentada en JSON${includeAnnex ? " y en el anexo" : ""}.` : ''}</footer>
    </div>
    {includeAnnex && <div className="gamma-report-sheet gamma-report-annex"><h1>Anexo · trazabilidad y revisión</h1><p>{batch.equipment} · {month} · Responsable: {responsible || 'pendiente'}</p>
      {model.excluded.length > 0 && <Block title="Adquisiciones excluidas del resumen"><ul>{model.excluded.map((e, i) => <li key={i}>{e.acquiredAt} · {GAMMA_TESTS[e.type]} · {e.file}<br/>Motivo: {e.reason}</li>)}</ul></Block>}
      {model.pendingFiles.map((e, i) => <p key={i}>Pendiente: {e.file} · {e.reason}</p>)}
      {model.records.map(r => <article className="gamma-report-trace" key={r.id}><h3>{GAMMA_TESTS[r.type]}{r.detector ? ` · H${r.detector}` : ''}{r.axis ? ` · ${r.axis}` : ''}</h3>
        <p>{r.acquiredAt} · {r.file}</p><p><strong>{r.status}.</strong> {r.reason}</p>
        <p>Método: {r.method || 'Pendiente'} · {r.details?.methodVersion || r.methodVersion}<br/>Protocolo: {r.protocol || 'Pendiente'}<br/>Límites: {r.limitSource || 'Pendiente'}</p>
        {r.type === 'resolution' && <p>La conclusión del resumen utiliza el criterio {model.resolutionCriterion === 'mean' ? 'media X/Y' : 'por eje'}; aquí se conserva la evaluación individual. Píxel: {fmt(r.details?.spacing, 4)} mm. Inclinación: {fmt(r.details?.tiltDegrees)}°.</p>}
        {r.type === 'sensitivity' && r.details && <p>{fmt(r.details.totalCounts, 0)} cuentas / {fmt(r.details.durationSeconds, 3)} s · {fmt(r.details.netCps)} cps netas · actividad media {fmt(r.details.meanActivityMBq, 4)} MBq · sensibilidad {fmt(r.details.sensitivity)} cps/MBq · u estadística {fmt(r.details.statisticalUncertainty)} cps/MBq.</p>}
        {r.type === 'tomography' && <p>Definición de la medida: {r.details?.definition || 'Pendiente'}. Valor registrado por el usuario; no se sustituye por U3D automáticamente.</p>}
        {r.metrics.length > 0 && <p>{r.metrics.map(m => `${m.label}: ${fmt(m.value, 3)} ${m.unit}${m.limit != null ? ` (${limit(m)})` : ''}`).join(' · ')}</p>}
        {r.details?.checks && <ul>{r.details.checks.map(c => <li key={c.id}>{c.label}: {c.status}. {c.detail}</li>)}</ul>}
        {r.details?.warnings?.map((w, i) => <p key={i}>{w}</p>)}
        {r.type === 'cor' && <p>Declaraciones: {Object.entries(r.inputs.corDeclaration || {}).map(([key, v]) => `${key}: ${v}`).join('; ') || 'pendientes'}. Los centroides y geometría completos se conservan en JSON.</p>}
        {r.notes && <p>{r.notes}</p>}
      </article>)}
    </div>}
    {quantitative && <div className="gamma-report-sheet gamma-report-annex"><h1>Uniformidad tomográfica · esferas 3D</h1><p>{batch.equipment} · {month} · Método complementario sin tolerancia normativa.</p>
      <TomoCurve result={quantitative}/><table><thead><tr><th>Diámetro (mm)</th><th>Mínimo (%)</th><th>Máximo (%)</th><th>U3D (%)</th><th>Centros</th></tr></thead><tbody>{quantitative.results.map(r => <tr key={r.diameterMm}><td>{r.diameterMm}</td>{r.valid ? <><td>{fmt(r.minimumPercent)}</td><td>{fmt(r.maximumPercent)}</td><td>{fmt(r.uniformityPercent)}</td><td>{r.centerCount}</td></> : <td colSpan="4">{r.reason}</td>}</tr>)}</tbody></table>
      <p>Valores mínimos y máximos de medias esféricas, normalizados a una media de referencia de {fmt(quantitative.reference.mean, 4)} {quantitative.units}. U3D = 100 × (máximo − mínimo) / (máximo + mínimo). No son extremos de vóxeles individuales.</p>
      <p>Márgenes radial / axial: {quantitative.config.cylinder.radialMarginMm} / {quantitative.config.cylinder.axialMarginMm} mm. Paso: {quantitative.config.stride} vóxel(es). Dominio: {quantitative.config.centerMode}. Método: {quantitative.method}.</p><p>{quantitative.config.notes}</p>
      {[...(quantitative.sourceWarnings || []), ...quantitative.warnings].map((w, i) => <p key={i}>{w}</p>)}
      <p>La curva complementa la revisión visual. Conservar las mismas condiciones de adquisición, reconstrucción, geometría y búsqueda para comparar meses.</p>
    </div>}
  </section>
}
