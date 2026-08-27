import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { parseCorDICOM } from '../utils/corDicom'
import {
  analyzeCor,
  diagnosticPerformance,
  parseValidationCsv,
  rocAnalysis,
  toleranceStatus
} from '../utils/corAnalysis'
import '../styles/cor-analysis.css'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

const COLORS = ['#88c0d0', '#ebcb8b', '#a3be8c', '#b48ead']

function finite(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function percent(value) {
  return Number.isFinite(value) ? `${(100 * value).toFixed(1)} %` : '—'
}

function saveText(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function SectionHeading({ icon, title, subtitle }) {
  return (
    <div className="cor-section-heading">
      <div><i className={`bi ${icon}`}></i></div>
      <span>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </span>
    </div>
  )
}

function Metric({ label, value, detail, accent = 'blue' }) {
  return (
    <div className={`cor-metric cor-metric-${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function Badge({ ok, children }) {
  const state = ok == null ? 'neutral' : ok ? 'pass' : 'fail'
  return <span className={`cor-badge cor-badge-${state}`}><i className={`bi bi-${ok == null ? 'dash' : ok ? 'check2' : 'exclamation'}`}></i>{children}</span>
}

const DEFAULT_ELLIPSOID_VIEW = { yaw: -0.62, pitch: 0.48, zoom: 1 }

function projectWithView(point, centre, view) {
  const x = point[0] - centre[0]
  const y = point[1] - centre[1]
  const z = point[2] - centre[2]
  const cosYaw = Math.cos(view.yaw)
  const sinYaw = Math.sin(view.yaw)
  const cosPitch = Math.cos(view.pitch)
  const sinPitch = Math.sin(view.pitch)
  const rotatedX = cosYaw * x - sinYaw * y
  const rotatedY = sinYaw * x + cosYaw * y

  return [rotatedX, sinPitch * rotatedY - cosPitch * z]
}

function vectorAdd(a, b) {
  return a.map((value, index) => value + b[index])
}

function vectorScale(vector, scalar) {
  return vector.map((value) => value * scalar)
}

function ellipsoidPoint(model, latitude, longitude) {
  const local = [
    Math.cos(latitude) * Math.cos(longitude),
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude)
  ]
  return model.axes.reduce((point, axis, index) => (
    vectorAdd(point, vectorScale(axis.direction, axis.semiAxisMm * local[index]))
  ), [...model.centre])
}

function drawEllipsoid(canvas, model, view) {
  if (!canvas || !model) return
  const width = 760
  const height = 470
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const pixelWidth = Math.round(width * ratio)
  const pixelHeight = Math.round(height * ratio)
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }
  const context = canvas.getContext('2d')
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)

  const radius = Math.max(1.5, model.maximumSemiAxisMm, model.sphereRadiusMm)
  const displayScale = 150 / radius * view.zoom
  const map = (point) => {
    const projected = projectWithView(point, model.centre, view)
    return [width / 2 + projected[0] * displayScale, height / 2 + projected[1] * displayScale]
  }
  const strokePath = (points, color, lineWidth = 1, dash = []) => {
    context.beginPath()
    points.forEach((point, index) => {
      const [x, y] = map(point)
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.setLineDash(dash)
    context.strokeStyle = color
    context.lineWidth = lineWidth
    context.stroke()
    context.setLineDash([])
  }

  const axisLength = radius * 1.45
  const roomAxes = [
    { vector: [1, 0, 0], color: '#bf616a', label: 'X' },
    { vector: [0, 1, 0], color: '#a3be8c', label: 'Y' },
    { vector: [0, 0, 1], color: '#88c0d0', label: 'Z' }
  ]
  for (const axis of roomAxes) {
    const start = vectorAdd(model.centre, vectorScale(axis.vector, -axisLength))
    const end = vectorAdd(model.centre, vectorScale(axis.vector, axisLength))
    strokePath([start, end], axis.color, 1, [5, 5])
    const [x, y] = map(end)
    context.fillStyle = axis.color
    context.font = '700 11px IBM Plex Mono, monospace'
    context.fillText(axis.label, x + 5, y - 4)
  }

  for (const line of model.lines) {
    const half = radius * 1.75
    const start = vectorAdd(line.closestPoint, vectorScale(line.direction, -half))
    const end = vectorAdd(line.closestPoint, vectorScale(line.direction, half))
    strokePath([start, end], 'rgba(123,136,161,0.18)', 0.8)
  }

  const loops = [-60, -30, 0, 30, 60]
  for (const degrees of loops) {
    const latitude = degrees * Math.PI / 180
    const points = Array.from({ length: 65 }, (_, index) => (
      ellipsoidPoint(model, latitude, index / 64 * Math.PI * 2)
    ))
    strokePath(points, degrees === 0 ? '#88c0d0' : 'rgba(136,192,208,0.38)', degrees === 0 ? 1.8 : 1)
  }
  for (let index = 0; index < 8; index++) {
    const longitude = index / 8 * Math.PI * 2
    const points = Array.from({ length: 49 }, (_, item) => (
      ellipsoidPoint(model, -Math.PI / 2 + item / 48 * Math.PI, longitude)
    ))
    strokePath(points, 'rgba(136,192,208,0.42)', 1)
  }

  for (const line of model.lines) {
    const [x, y] = map(line.closestPoint)
    context.beginPath()
    context.arc(x, y, 2.4, 0, Math.PI * 2)
    context.fillStyle = COLORS[(line.detectorNumber - 1) % COLORS.length]
    context.fill()
  }
  const [x, y] = map(model.centre)
  context.beginPath()
  context.arc(x, y, 5, 0, Math.PI * 2)
  context.fillStyle = '#eceff4'
  context.fill()
  context.strokeStyle = '#2e3440'
  context.lineWidth = 2
  context.stroke()
}

function EllipsoidCanvas({ model }) {
  const ref = useRef(null)
  const viewRef = useRef({ ...DEFAULT_ELLIPSOID_VIEW })
  const dragRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [autoRotate, setAutoRotate] = useState(() => (
    typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ))

  const redraw = () => drawEllipsoid(ref.current, model, viewRef.current)

  useEffect(() => {
    viewRef.current = { ...DEFAULT_ELLIPSOID_VIEW }
    redraw()
  }, [model])

  useEffect(() => {
    if (!autoRotate || !model) return undefined
    let animationFrame
    let previousTime
    const animate = (time) => {
      if (previousTime != null) viewRef.current.yaw += Math.min(40, time - previousTime) * 0.00022
      previousTime = time
      redraw()
      animationFrame = window.requestAnimationFrame(animate)
    }
    animationFrame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [autoRotate, model])

  const changeZoom = (factor) => {
    viewRef.current.zoom = Math.max(0.55, Math.min(2.5, viewRef.current.zoom * factor))
    redraw()
  }

  const resetView = () => {
    viewRef.current = { ...DEFAULT_ELLIPSOID_VIEW }
    redraw()
  }

  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: viewRef.current.yaw,
      pitch: viewRef.current.pitch
    }
    setDragging(true)
    setAutoRotate(false)
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    viewRef.current.yaw = drag.yaw + (event.clientX - drag.x) * 0.008
    viewRef.current.pitch = Math.max(-1.35, Math.min(1.35, drag.pitch + (event.clientY - drag.y) * 0.008))
    redraw()
  }

  const handlePointerUp = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleKeyDown = (event) => {
    const step = 0.09
    if (event.key === 'ArrowLeft') viewRef.current.yaw -= step
    else if (event.key === 'ArrowRight') viewRef.current.yaw += step
    else if (event.key === 'ArrowUp') viewRef.current.pitch = Math.max(-1.35, viewRef.current.pitch - step)
    else if (event.key === 'ArrowDown') viewRef.current.pitch = Math.min(1.35, viewRef.current.pitch + step)
    else if (event.key === '+' || event.key === '=') changeZoom(1.12)
    else if (event.key === '-') changeZoom(1 / 1.12)
    else return
    event.preventDefault()
    setAutoRotate(false)
    redraw()
  }

  return (
    <div className="cor-ellipsoid-wrap">
      <canvas
        ref={ref}
        className={`cor-ellipsoid${dragging ? ' cor-ellipsoid-dragging' : ''}`}
        tabIndex="0"
        aria-label="Elipsoide tridimensional interactivo de las retroproyecciones del centro de rotación"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={(event) => { event.preventDefault(); setAutoRotate(false); changeZoom(Math.exp(-event.deltaY * 0.001)) }}
        onKeyDown={handleKeyDown}
      />
      <div className="cor-ellipsoid-controls" aria-label="Controles de la vista tridimensional">
        <button type="button" onClick={() => changeZoom(1.15)} title="Acercar"><i className="bi bi-zoom-in"></i></button>
        <button type="button" onClick={() => changeZoom(1 / 1.15)} title="Alejar"><i className="bi bi-zoom-out"></i></button>
        <button type="button" className={autoRotate ? 'active' : ''} onClick={() => setAutoRotate((current) => !current)} title="Activar o detener el giro automático"><i className={`bi bi-${autoRotate ? 'pause' : 'play'}-fill`}></i></button>
        <button type="button" onClick={resetView} title="Restablecer vista"><i className="bi bi-arrow-counterclockwise"></i></button>
      </div>
      <span className="cor-ellipsoid-hint"><i className="bi bi-mouse"></i> Arrastra para rotar · rueda para zoom</span>
    </div>
  )
}

function ProjectionChart({ results, pixelSpacing }) {
  const central = results.centralSourceIndex
  const [pixelHeight, pixelWidth] = pixelSpacing
  const datasets = results.detectors.flatMap((detector, detectorIndex) => {
    const source = detector.sources[central]
    const meanY = source.meanAxialPixels
    const color = COLORS[detectorIndex % COLORS.length]
    return [
      {
        label: `Cabezal ${detector.detectorNumber} · transversal`,
        data: source.measurements.map((item) => ({ x: item.angleDeg, y: (item.x - results.imageCentrePixels[0]) * pixelWidth })),
        borderColor: color,
        backgroundColor: color,
        pointRadius: 2.5,
        tension: 0.22
      },
      {
        label: `Cabezal ${detector.detectorNumber} · axial`,
        data: source.measurements.map((item) => ({ x: item.angleDeg, y: (item.y - meanY) * pixelHeight })),
        borderColor: color,
        backgroundColor: color,
        borderDash: [6, 4],
        pointStyle: 'rectRot',
        pointRadius: 2.5,
        tension: 0.22
      }
    ]
  })
  return (
    <div className="cor-chart">
      <Line
        data={{ datasets }}
        options={{
          parsing: false,
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { type: 'linear', min: 0, max: 360, title: { display: true, text: 'Ángulo (°)' }, grid: { color: 'rgba(123,136,161,0.12)' }, ticks: { color: '#78849a' } },
            y: { title: { display: true, text: 'Desplazamiento (mm)' }, grid: { color: 'rgba(123,136,161,0.12)' }, ticks: { color: '#78849a' } }
          },
          plugins: { legend: { labels: { color: '#c3ccda', boxWidth: 16, boxHeight: 2 } } }
        }}
      />
    </div>
  )
}

function CorAnalysis() {
  const [series, setSeries] = useState(null)
  const [results, setResults] = useState(null)
  const [fileName, setFileName] = useState('')
  const [status, setStatus] = useState('Carga una adquisición tomográfica NM con tres fuentes puntuales')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [validation, setValidation] = useState(null)
  const [validationName, setValidationName] = useState('')
  const [limits, setLimits] = useState({
    deltaCorSingleMm: 1,
    deltaCorPairMm: 1,
    deltaAxialSingleMm: 1,
    deltaAxialPairMm: 1,
    ellipsoidDiameterMm: 2
  })
  const fileRef = useRef(null)
  const validationRef = useRef(null)

  const loadDicom = async (file) => {
    if (!file) return
    setError('')
    setStatus('Leyendo el objeto NM y resolviendo la geometría angular…')
    try {
      const parsed = parseCorDICOM(await file.arrayBuffer())
      const analyzed = analyzeCor(parsed)
      const halfPixel = 0.5 * Math.max(...parsed.pixelSpacing)
      setSeries(parsed)
      setResults(analyzed)
      setFileName(file.name)
      setLimits({
        deltaCorSingleMm: halfPixel,
        deltaCorPairMm: halfPixel,
        deltaAxialSingleMm: halfPixel,
        deltaAxialPairMm: halfPixel,
        ellipsoidDiameterMm: 2 * halfPixel
      })
      setStatus(`Análisis completado: ${parsed.frames.length} vistas, ${analyzed.detectors.length} cabezal${analyzed.detectors.length === 1 ? '' : 'es'}`)
    } catch (caught) {
      setSeries(null)
      setResults(null)
      setError(caught.message)
      setStatus('No se pudo analizar el archivo')
    }
  }

  const statuses = useMemo(() => toleranceStatus(results, limits), [results, limits])
  const performance = useMemo(() => (
    validation ? diagnosticPerformance(validation, limits.ellipsoidDiameterMm) : null
  ), [validation, limits.ellipsoidDiameterMm])
  const roc = useMemo(() => validation ? rocAnalysis(validation) : null, [validation])

  const loadValidation = async (file) => {
    if (!file) return
    try {
      const records = parseValidationCsv(await file.text())
      setValidation(records)
      setValidationName(file.name)
      setError('')
    } catch (caught) {
      setValidation(null)
      setValidationName('')
      setError(caught.message)
    }
  }

  const exportResults = () => {
    const payload = {
      schema: 'falkens-maze-cor-v1',
      sourceFile: fileName,
      analyzedAt: new Date().toISOString(),
      metadata: series.metadata,
      pixelSpacing: series.pixelSpacing,
      method: results.method,
      upperBounds: results.upperBounds,
      geometry3d: results.geometry3d,
      tolerance: { limits, status: statuses }
    }
    saveText('cor-analysis.json', JSON.stringify(payload, null, 2), 'application/json')
  }

  const exportValidationRow = () => {
    const header = 'filename,score_mm,label,delta_cor_1_mm,delta_cor_12_mm,delta_axial_1_mm,delta_axial_12_mm\n'
    const row = [
      fileName,
      results.geometry3d.maximumDiameterMm,
      '',
      results.upperBounds.deltaCorSingleMm,
      results.upperBounds.deltaCorPairMm,
      results.upperBounds.deltaAxialSingleMm,
      results.upperBounds.deltaAxialPairMm
    ].join(',')
    saveText('cor-validation-row.csv', header + row + '\n', 'text/csv;charset=utf-8')
  }

  return (
    <div className="page-body cor-page">
      <div className="page-header">
        <h1 className="page-title">Centro de rotación SPECT</h1>
        <p className="page-subtitle">Análisis clásico NEMA NU 1-2007 y envolvente geométrica 3D por retroproyección</p>
      </div>

      <div className="cor-privacy">
        <i className="bi bi-shield-check"></i>
        <span><strong>Procesamiento local</strong>El DICOM se analiza dentro del navegador y no se envía al servidor.</span>
      </div>

      <section className="cor-section">
        <SectionHeading icon="bi-file-medical" title="Adquisición COR" subtitle="Objeto NM multiframe; se esperan tres fuentes puntuales coplanares" />
        <input ref={fileRef} hidden type="file" accept=".dcm,.dicom,application/dicom" onChange={(event) => loadDicom(event.target.files?.[0])} />
        <div
          className={`cor-dropzone${dragging ? ' cor-dropzone-active' : ''}${series ? ' cor-dropzone-loaded' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); loadDicom(event.dataTransfer.files?.[0]) }}
        >
          <i className={`bi bi-${series ? 'check2-circle' : 'cloud-arrow-up'}`}></i>
          <strong>{series ? fileName : 'Arrastra aquí el DICOM COR'}</strong>
          <span>{series ? `${series.rows} × ${series.cols} · ${series.frames.length} frames · ${series.metadata.equipment || 'equipo sin identificar'}` : 'o haz clic para seleccionarlo'}</span>
        </div>
        <div className={`cor-status${error ? ' cor-status-error' : ''}`}>
          <i className={`bi bi-${error ? 'exclamation-triangle' : 'info-circle'}`}></i>
          <span>{error || status}</span>
        </div>
      </section>

      {series && results && (
        <>
          <section className="cor-section">
            <SectionHeading icon="bi-list-check" title="Comprobaciones de adquisición" subtitle="Condiciones descritas en NEMA NU 1-2007 §4.1.1–4.1.3" />
            <div className="cor-badges">
              <Badge ok={results.acquisition.pixelSizeUnder5Mm}>Píxel {finite(series.pixelSpacing[1], 3)} × {finite(series.pixelSpacing[0], 3)} mm (&lt; 5 mm)</Badge>
              <Badge ok={series.metadata.scanArcDeg >= 360}>Arco {finite(series.metadata.scanArcDeg, 0)}°</Badge>
              {results.acquisition.detectorChecks.map((check) => (
                <Badge key={`views-${check.detectorNumber}`} ok={check.evenViews && check.enoughViews && check.uniformAngles && check.includesZero && check.includes180}>
                  Cabezal {check.detectorNumber}: {check.viewCount} vistas, 0°/180°
                </Badge>
              ))}
              {results.acquisition.detectorChecks.map((check) => (
                <Badge key={`counts-${check.detectorNumber}`} ok={check.enoughCountsAtZero}>
                  Cabezal {check.detectorNumber}: mín. {finite(check.minimumZeroMaximum, 0)} cuentas/píxel a 0°
                </Badge>
              ))}
              {results.acquisition.detectorChecks.map((check) => (
                <Badge key={`rate-${check.detectorNumber}`} ok={check.underMaximumCountRate}>
                  Cabezal {check.detectorNumber}: máx. {finite(check.maximumCountRateCps, 0)} cps
                </Badge>
              ))}
            </div>
            {results.acquisition.detectorChecks.some((check) => !check.enoughCountsAtZero) && (
              <p className="cor-warning"><i className="bi bi-exclamation-triangle"></i>NEMA pide al menos 5000 cuentas en el píxel máximo de cada fuente en la vista de 0°. El cálculo se muestra, pero la adquisición no cumple esa condición.</p>
            )}
          </section>

          <section className="cor-section">
            <SectionHeading icon="bi-crosshair" title="Resultado clásico NEMA" subtitle="Centroides de perfiles 1D en una ROI de 4–5 cm; resultados convertidos a milímetros" />
            <div className="cor-metrics">
              <Metric label="δCOR,1" value={`${finite(results.upperBounds.deltaCorSingleMm)} mm`} detail="Máximo individual" />
              <Metric label="δCOR,12" value={`${finite(results.upperBounds.deltaCorPairMm)} mm`} detail="Máximo entre cabezales" accent="green" />
              <Metric label="δAXIAL,1" value={`${finite(results.upperBounds.deltaAxialSingleMm)} mm`} detail="Máximo individual" accent="orange" />
              <Metric label="δAXIAL,12" value={`${finite(results.upperBounds.deltaAxialPairMm)} mm`} detail="Máximo entre cabezales" accent="purple" />
            </div>
            <div className="cor-table-wrap">
              <table className="cor-table">
                <thead><tr><th>Cabezal</th><th>Fuente</th><th>COR</th><th>δCOR</th><th>Desviación axial</th><th>Excursión transversal</th></tr></thead>
                <tbody>
                  {results.detectors.flatMap((detector) => detector.sources.map((source) => (
                    <tr key={`${detector.detectorNumber}-${source.sourceIndex}`} className={source.sourceIndex === results.centralSourceIndex ? 'cor-central-row' : ''}>
                      <td>{detector.detectorNumber}</td>
                      <td>{source.sourceIndex + 1}{source.sourceIndex === results.centralSourceIndex ? ' · central' : ''}</td>
                      <td>{finite(source.corMm, 3)} mm</td>
                      <td>{finite(source.deltaCorMm, 3)} mm</td>
                      <td>{finite(source.axialDeviationMm, 3)} mm</td>
                      <td>{finite(source.transverseRangeMm, 2)} mm</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
            <ProjectionChart results={results} pixelSpacing={series.pixelSpacing} />
          </section>

          <section className="cor-section">
            <SectionHeading icon="bi-bounding-box-circles" title="Modelo geométrico 3D" subtitle="Cada centroide define una línea paralela al colimador; se ajusta el punto de menor distancia conjunta" />
            <div className="cor-model-grid">
              <EllipsoidCanvas model={results.geometry3d} />
              <div className="cor-model-side">
                <Metric label="Esfera envolvente" value={`${finite(results.geometry3d.sphereDiameterMm)} mm`} detail="Diámetro tipo Winston–Lutz" />
                <Metric label="Elipsoide envolvente" value={`${finite(results.geometry3d.maximumDiameterMm)} mm`} detail="Diámetro del eje mayor" accent="green" />
                <Metric label="Semiejes" value={results.geometry3d.axes.map((axis) => finite(axis.semiAxisMm)).join(' / ')} detail="a / b / c, en mm" accent="orange" />
                <Metric label="RMS a las líneas" value={`${finite(results.geometry3d.rmsLineDistanceMm)} mm`} detail={`${results.geometry3d.lines.length} retroproyecciones`} accent="purple" />
                <div className="cor-method-note">
                  <strong>Interpretación</strong>
                  <p>La posición ajustada de la fuente puede estar desplazada respecto al centro de la matriz. El tamaño de la envolvente mide la falta de intersección de las retroproyecciones y es, por tanto, el indicador de estabilidad geométrica.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="cor-section">
            <SectionHeading icon="bi-sliders" title="Límites de trabajo" subtitle="NEMA define el método, pero remite la aceptación a la especificación del fabricante" />
            <p className="cor-warning cor-warning-blue"><i className="bi bi-info-circle"></i>Los valores iniciales equivalen a medio píxel para las magnitudes NEMA y a un píxel para el diámetro 3D. Son puntos de partida editables, no límites publicados por NEMA.</p>
            <div className="cor-limit-grid">
              {[
                ['deltaCorSingleMm', 'δCOR,1 (mm)'],
                ['deltaCorPairMm', 'δCOR,12 (mm)'],
                ['deltaAxialSingleMm', 'δAXIAL,1 (mm)'],
                ['deltaAxialPairMm', 'δAXIAL,12 (mm)'],
                ['ellipsoidDiameterMm', 'Elipsoide 3D (mm)']
              ].map(([key, label]) => (
                <label key={key}><span className="field-label">{label}</span><input className="dark-input" type="number" min="0" step="0.05" value={finite(limits[key])} onChange={(event) => setLimits((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>
              ))}
            </div>
            <div className="cor-tolerance-list">
              {statuses.map((item) => (
                <div key={item.key} className={`cor-tolerance-${item.pass ? 'pass' : 'fail'}`}>
                  <i className={`bi bi-${item.pass ? 'check-circle' : 'x-circle'}`}></i>
                  <span><strong>{item.label}</strong>{finite(item.value, 3)} mm / límite {finite(item.limit, 3)} mm</span>
                </div>
              ))}
            </div>
          </section>

          <section className="cor-section">
            <SectionHeading icon="bi-graph-up-arrow" title="Sensibilidad y especificidad" subtitle="Validación del límite 3D frente a una referencia independiente" />
            <div className="cor-validation-grid">
              <div>
                <h3>Qué se necesita</h3>
                <p>Una cohorte con adquisiciones normales y defectos confirmados por ajuste mecánico, servicio técnico o una referencia independiente. El CSV debe contener <code>score_mm,label</code>; la etiqueta es <code>0</code> para apto y <code>1</code> para defecto.</p>
                <input ref={validationRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => loadValidation(event.target.files?.[0])} />
                <button className="cor-button" onClick={() => validationRef.current?.click()}><i className="bi bi-filetype-csv"></i>{validation ? 'Cambiar cohorte' : 'Cargar cohorte CSV'}</button>
                {validation && <small className="cor-validation-file">{validationName} · {validation.length} casos</small>}
              </div>
              {performance ? (
                <div className="cor-confusion">
                  <div><span>TP</span><strong>{performance.tp}</strong></div>
                  <div><span>FP</span><strong>{performance.fp}</strong></div>
                  <div><span>FN</span><strong>{performance.fn}</strong></div>
                  <div><span>TN</span><strong>{performance.tn}</strong></div>
                </div>
              ) : (
                <div className="cor-empty-validation"><i className="bi bi-database"></i><span>Con una sola adquisición no pueden estimarse sensibilidad ni especificidad.</span></div>
              )}
            </div>
            {performance && roc && (
              <>
                <div className="cor-metrics cor-validation-metrics">
                  <Metric label="Sensibilidad" value={percent(performance.sensitivity)} detail={`IC95: ${percent(performance.sensitivityCi95[0])}–${percent(performance.sensitivityCi95[1])}`} />
                  <Metric label="Especificidad" value={percent(performance.specificity)} detail={`IC95: ${percent(performance.specificityCi95[0])}–${percent(performance.specificityCi95[1])}`} accent="green" />
                  <Metric label="AUC ROC" value={finite(roc.auc, 3)} detail="Discriminación global" accent="orange" />
                  <Metric label="Youden J" value={finite(roc.best.youden, 3)} detail={`Corte ${finite(roc.best.threshold, 3)} mm`} accent="purple" />
                </div>
                <button className="cor-button cor-button-secondary" onClick={() => setLimits((current) => ({ ...current, ellipsoidDiameterMm: roc.best.threshold }))}>Aplicar corte de Youden</button>
                <p className="cor-method-note"><strong>Precaución estadística</strong>El corte de Youden y su rendimiento se calculan sobre la misma cohorte. Antes de convertirlo en tolerancia clínica debe validarse en una muestra independiente y acompañarse de intervalos de confianza.</p>
              </>
            )}
          </section>

          <div className="cor-export">
            <button className="cor-button" onClick={exportResults}><i className="bi bi-download"></i>Exportar análisis JSON</button>
            <button className="cor-button cor-button-secondary" onClick={exportValidationRow}><i className="bi bi-filetype-csv"></i>Añadir fila a la cohorte</button>
          </div>
        </>
      )}
    </div>
  )
}

export default CorAnalysis
