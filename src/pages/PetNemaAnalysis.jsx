import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { analyzePetNema, describeBackgroundRois } from '../utils/petNemaAnalysis'
import { collectDroppedFiles, loadPetDicomSeries } from '../utils/petNemaDicom'
import '../styles/pet-nema-analysis.css'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend
)

const CHART_COLORS = {
  blue: '#88c0d0',
  orange: '#ebcb8b',
  green: '#a3be8c',
  red: '#bf616a',
  text: '#d8dee9',
  muted: '#7b88a1',
  grid: 'rgba(123, 136, 161, 0.18)'
}

function parseDecimal(value) {
  if (typeof value === 'number') return value
  return Number(String(value).trim().replace(',', '.'))
}

function finite(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

// En el servicio se adquieren las dos: 4:1 es la relacion esfera-fondo que
// prescribe NU 2-2018 y 8:1 es una adquisicion adicional propia, no un error
// operativo. La etiqueta lo dice; los calculos de Q_H, N_j y error pulmonar son
// los mismos y derivan la relacion real de a_H/a_B.
function protocolLabel(ratio) {
  if (!Number.isFinite(ratio)) return null
  if (Math.abs(ratio - 4) <= 0.5) {
    return { text: 'Adquisición conforme al protocolo NU 2-2018', local: false }
  }
  if (Math.abs(ratio - 8) <= 0.5) {
    return { text: 'Adquisición adicional del servicio (histórica 8:1)', local: true }
  }
  return { text: 'Relación fuera de los protocolos habituales 4:1 y 8:1', local: true }
}

function concentrationPresentation(value, units) {
  if (units === 'BQML') return { value: value / 1000, unit: 'kBq/ml' }
  return { value, unit: units || 'u. DICOM' }
}

function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function imageCanvas(image, width, height, displayWindow) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  const imageData = context.createImageData(width, height)
  const range = displayWindow.maximum - displayWindow.minimum || 1

  for (let index = 0; index < image.length; index++) {
    const grey = Math.max(0, Math.min(255, Math.round(
      (image[index] - displayWindow.minimum) / range * 255
    )))
    const target = index * 4
    imageData.data[target] = grey
    imageData.data[target + 1] = grey
    imageData.data[target + 2] = grey
    imageData.data[target + 3] = 255
  }
  context.putImageData(imageData, 0, 0)
  return canvas
}

function setupCanvas(canvas, logicalWidth, logicalHeight) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(logicalWidth * ratio)
  canvas.height = Math.round(logicalHeight * ratio)
  canvas.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`
  const context = canvas.getContext('2d')
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  return context
}

function drawEllipse(context, x, y, radiusX, radiusY, color, width = 1.5) {
  context.beginPath()
  context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2)
  context.strokeStyle = color
  context.lineWidth = width
  context.stroke()
}

const BACKGROUND_ROI_DIAMETER_MM = 37

// Blue is a ROI that meets everything NEMA requires. Orange is one that
// overlaps another background ROI: the standard does not forbid it, so it is a
// quantified warning, not a failure. Red is a mandatory constraint broken -
// closer than 15 mm to the edge of the phantom, or touching a sphere or the
// lung insert - and while any ROI is red the calculation and the export stay
// blocked, because a background ROI over hot activity is not measuring
// background.
function roiColor(diagnostic) {
  if (!diagnostic) return CHART_COLORS.blue
  if (diagnostic.violatesEdge || diagnostic.violatesSphere || diagnostic.violatesLung) return CHART_COLORS.red
  if (diagnostic.overlapsWith.length) return CHART_COLORS.orange
  return CHART_COLORS.blue
}

function CentralRoiCanvas({ series, results, rois, diagnostics, onMoveRoi }) {
  const canvasRef = useRef(null)
  const viewRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !series || !results) return

    const { minRow, maxRow, minCol, maxCol } = results.phantom.bounds
    const [pixelHeight, pixelWidth] = series.pixelSpacing
    const marginX = Math.ceil(25 / pixelWidth)
    const marginY = Math.ceil(25 / pixelHeight)
    const x0 = Math.max(0, minCol - marginX)
    const x1 = Math.min(series.cols, maxCol + marginX + 1)
    const y0 = Math.max(0, minRow - marginY)
    const y1 = Math.min(series.rows, maxRow + marginY + 1)
    const cropWidth = x1 - x0
    const cropHeight = y1 - y0
    const logicalWidth = 720
    const logicalHeight = Math.round(
      logicalWidth * cropHeight * pixelHeight / (cropWidth * pixelWidth)
    )
    const context = setupCanvas(canvas, logicalWidth, logicalHeight)
    const source = imageCanvas(
      series.volume[results.centralSlice],
      series.cols,
      series.rows,
      results.displayWindow
    )
    context.imageSmoothingEnabled = true
    context.drawImage(source, x0, y0, cropWidth, cropHeight, 0, 0, logicalWidth, logicalHeight)

    const scaleX = logicalWidth / cropWidth
    const scaleY = logicalHeight / cropHeight
    const mapX = (pixelX) => (pixelX - x0) * scaleX
    const mapY = (pixelY) => (pixelY - y0) * scaleY
    viewRef.current = { x0, y0, scaleX, scaleY, logicalWidth, logicalHeight, pixelWidth, pixelHeight }

    for (const sphere of results.spheres) {
      drawEllipse(
        context,
        mapX(sphere.centerX),
        mapY(sphere.centerY),
        sphere.diameterMm / 2 / pixelWidth * scaleX,
        sphere.diameterMm / 2 / pixelHeight * scaleY,
        CHART_COLORS.red,
        1.8
      )
      context.fillStyle = CHART_COLORS.red
      context.font = '600 11px Inter, sans-serif'
      context.fillText(`${sphere.diameterMm}`, mapX(sphere.centerX) + 7, mapY(sphere.centerY) - 7)
    }

    rois.forEach((roi, index) => {
      const diagnostic = diagnostics?.rois?.[index]
      const color = roiColor(diagnostic)
      const centerX = mapX(roi.xMm / pixelWidth)
      const centerY = mapY(roi.yMm / pixelHeight)

      drawEllipse(
        context,
        centerX,
        centerY,
        BACKGROUND_ROI_DIAMETER_MM / 2 / pixelWidth * scaleX,
        BACKGROUND_ROI_DIAMETER_MM / 2 / pixelHeight * scaleY,
        color,
        color === CHART_COLORS.blue ? 1.3 : 2
      )
      context.fillStyle = color
      context.font = '600 10px Inter, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(`${index + 1}`, centerX, centerY)
      context.textAlign = 'start'
      context.textBaseline = 'alphabetic'
    })

    drawEllipse(
      context,
      mapX(results.phantom.xMm / pixelWidth),
      mapY(results.phantom.yMm / pixelHeight),
      30 / 2 / pixelWidth * scaleX,
      30 / 2 / pixelHeight * scaleY,
      CHART_COLORS.green,
      1.8
    )
  }, [series, results, rois, diagnostics])

  const toMillimetres = (event) => {
    const view = viewRef.current
    const canvas = canvasRef.current
    if (!view || !canvas) return null

    const rect = canvas.getBoundingClientRect()
    const logicalX = (event.clientX - rect.left) / rect.width * view.logicalWidth
    const logicalY = (event.clientY - rect.top) / rect.height * view.logicalHeight
    return {
      xMm: (logicalX / view.scaleX + view.x0) * view.pixelWidth,
      yMm: (logicalY / view.scaleY + view.y0) * view.pixelHeight
    }
  }

  const handlePointerDown = (event) => {
    if (!onMoveRoi) return
    const point = toMillimetres(event)
    if (!point) return

    let nearest = null
    let nearestDistance = Infinity
    rois.forEach((roi, index) => {
      const distance = Math.hypot(roi.xMm - point.xMm, roi.yMm - point.yMm)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = index
      }
    })

    if (nearest == null || nearestDistance > BACKGROUND_ROI_DIAMETER_MM / 2) return
    dragRef.current = nearest
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event) => {
    if (dragRef.current == null) return
    const point = toMillimetres(event)
    if (!point) return
    onMoveRoi(dragRef.current, point)
  }

  const handlePointerUp = (event) => {
    if (dragRef.current == null) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className={`pet-analysis-canvas${onMoveRoi ? ' pet-analysis-canvas-editable' : ''}`}
      aria-label="Corte central PET con las ROIs NEMA"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  )
}

function CoronalCanvas({ series, results }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !series || !results) return

    const sphere17 = results.spheres.find((sphere) => sphere.diameterMm === 17)
    const row = Math.max(0, Math.min(series.rows - 1, Math.round(sphere17.centerY)))
    const coronal = new Float32Array(series.volume.length * series.cols)
    for (let slice = 0; slice < series.volume.length; slice++) {
      const sourceOffset = row * series.cols
      coronal.set(series.volume[slice].subarray(sourceOffset, sourceOffset + series.cols), slice * series.cols)
    }

    const [, pixelWidth] = series.pixelSpacing
    const marginX = Math.ceil(25 / pixelWidth)
    const marginZ = Math.ceil(25 / series.dz)
    const x0 = Math.max(0, results.phantom.bounds.minCol - marginX)
    const x1 = Math.min(series.cols, results.phantom.bounds.maxCol + marginX + 1)
    const z0 = Math.max(0, results.bodyRange.startSlice - marginZ)
    const z1 = Math.min(series.volume.length, results.bodyRange.endSlice + marginZ + 1)
    const cropWidth = x1 - x0
    const cropHeight = z1 - z0
    const logicalWidth = 760
    const logicalHeight = Math.max(180, Math.round(
      logicalWidth * cropHeight * series.dz / (cropWidth * pixelWidth)
    ))
    const context = setupCanvas(canvas, logicalWidth, logicalHeight)
    const source = imageCanvas(coronal, series.cols, series.volume.length, results.displayWindow)
    context.drawImage(source, x0, z0, cropWidth, cropHeight, 0, 0, logicalWidth, logicalHeight)

    const centralY = (results.centralSlice + 0.5 - z0) * logicalHeight / cropHeight
    context.save()
    context.setLineDash([7, 5])
    context.strokeStyle = CHART_COLORS.red
    context.lineWidth = 1.5
    context.beginPath()
    context.moveTo(0, centralY)
    context.lineTo(logicalWidth, centralY)
    context.stroke()
    context.restore()
  }, [series, results])

  return <canvas ref={canvasRef} className="pet-analysis-canvas pet-analysis-coronal" aria-label="Reconstrucción coronal por la esfera de 17 milímetros" />
}

function SectionHeading({ icon, title, subtitle }) {
  return (
    <div className="pet-analysis-section-heading">
      <div className="pet-analysis-section-icon"><i className={`bi ${icon}`}></i></div>
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  )
}

function Metric({ label, value, detail, accent }) {
  return (
    <div className={`pet-analysis-metric${accent ? ` pet-analysis-metric-${accent}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function InfoGrid({ series }) {
  const info = series.info
  const rows = [
    ['Equipo', info.equipment],
    ['Serie', info.seriesDescription],
    ['Reconstrucción', info.reconstructionMethod],
    ['Filtro', info.convolutionKernel],
    ['Matriz', info.matrix],
    ['Cortes', info.sliceCount],
    ['Píxel', `${finite(info.pixelSpacing[1], 2)} × ${finite(info.pixelSpacing[0], 2)} mm`],
    ['Espesor nominal', Number.isFinite(info.sliceThickness) ? `${finite(info.sliceThickness, 2)} mm` : '—'],
    ['Separación axial', `${finite(info.axialSpacing, 2)} mm`],
    ['Unidades', info.units],
    ['Calibración', info.calibration]
  ]

  return (
    <div className="pet-analysis-info-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

function WarningList({ warnings }) {
  return (
    <>
      {warnings.map((warning, index) => (
        <div className="pet-analysis-warning" key={`${index}-${warning}`}>
          <i className="bi bi-exclamation-triangle"></i><span>{warning}</span>
        </div>
      ))}
    </>
  )
}

function chartOptions(yLabel, beginAtZero = true) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#2e3440',
        borderColor: '#4c566a',
        borderWidth: 1,
        titleColor: CHART_COLORS.text,
        bodyColor: CHART_COLORS.text
      }
    },
    scales: {
      x: {
        ticks: { color: CHART_COLORS.muted },
        grid: { display: false },
        title: { display: true, text: 'Diámetro de esfera (mm)', color: CHART_COLORS.muted }
      },
      y: {
        beginAtZero,
        ticks: { color: CHART_COLORS.muted },
        grid: { color: CHART_COLORS.grid },
        title: { display: true, text: yLabel, color: CHART_COLORS.muted }
      }
    }
  }
}

function PetNemaAnalysis() {
  const folderInputRef = useRef(null)
  const filesInputRef = useRef(null)
  const loadTokenRef = useRef(0)
  const [series, setSeries] = useState(null)
  const [results, setResults] = useState(null)
  const [sphereActivity, setSphereActivity] = useState('45.9')
  const [backgroundActivity, setBackgroundActivity] = useState('5.7')
  const [centralSlice, setCentralSlice] = useState('')
  const [thresholdPercent, setThresholdPercent] = useState('40')
  const [lungStartSlice, setLungStartSlice] = useState('')
  const [lungEndSlice, setLungEndSlice] = useState('')
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progressState, setProgressState] = useState(null)
  const [status, setStatus] = useState('Arrastra una carpeta o los archivos DICOM de la serie PET.')
  const [error, setError] = useState('')
  const [manualRois, setManualRois] = useState(null)

  const activityRatio = useMemo(() => {
    const hot = parseDecimal(sphereActivity)
    const background = parseDecimal(backgroundActivity)
    return hot > 0 && background > 0 ? hot / background : Number.NaN
  }, [sphereActivity, backgroundActivity])

  const resetAnalysis = () => {
    setResults(null)
    setError('')
    setManualRois(null)
  }

  // Las ROIs que se dibujan y se miden: las manuales si el usuario ha movido
  // alguna, y si no la solucion automatica del ultimo calculo.
  const activeRois = manualRois || results?.backgroundRois || null

  // Validacion en vivo con la misma geometria que uso el optimizador, para que
  // arrastrar una ROI marque el incumplimiento sin tener que recalcular.
  const roiDiagnostics = useMemo(() => {
    if (!series || !results || !activeRois) return null
    const [pixelHeight, pixelWidth] = series.pixelSpacing
    return describeBackgroundRois(
      activeRois.map((roi) => ({ xMm: roi.xMm, yMm: roi.yMm })),
      results.distanceToEdgePx,
      series.rows,
      series.cols,
      pixelWidth,
      pixelHeight,
      { xMm: results.phantom.xMm, yMm: results.phantom.yMm },
      results.spheres,
      results.options
    )
  }, [series, results, activeRois])

  const roiBlocked = Boolean(roiDiagnostics?.violations.length)
  const appliedRois = results?.backgroundRois || null
  const roiDirty = Boolean(manualRois && appliedRois && manualRois.some((roi, index) => (
    roi.xMm !== appliedRois[index].xMm || roi.yMm !== appliedRois[index].yMm
  )))
  const roiManual = roiDirty || Boolean(results?.backgroundRoiMetrics.manual)

  const handleMoveRoi = (index, point) => {
    setManualRois((previous) => {
      const base = previous || results.backgroundRois.map((roi) => ({ xMm: roi.xMm, yMm: roi.yMm }))
      const next = base.map((roi) => ({ xMm: roi.xMm, yMm: roi.yMm }))
      next[index] = { xMm: point.xMm, yMm: point.yMm }
      return next
    })
  }

  const restoreAutomaticRois = () => {
    setManualRois(null)
    setError('')
    if (results?.backgroundRoiMetrics.manual) calculate(null)
  }

  const handleFiles = async (incomingFiles) => {
    const files = Array.from(incomingFiles || [])
    if (!files.length) return
    const token = ++loadTokenRef.current
    setLoading(true)
    setSeries(null)
    setResults(null)
    setError('')
    setProgressState({ fraction: 0, message: `Preparando ${files.length} archivos…` })
    setStatus('Leyendo la serie PET localmente…')

    try {
      const loaded = await loadPetDicomSeries(files, {
        onProgress: (nextProgress) => {
          if (loadTokenRef.current === token) setProgressState(nextProgress)
        }
      })
      if (loadTokenRef.current !== token) return
      setSeries(loaded)
      setCentralSlice('')
      setLungStartSlice('')
      setLungEndSlice('')
      setStatus(
        `Serie PET lista: ${loaded.volume.length} cortes, ${loaded.rows} × ${loaded.cols} píxeles.`
      )
    } catch (loadError) {
      if (loadTokenRef.current !== token) return
      setError(loadError.message)
      setStatus('No se pudo cargar la serie PET.')
    } finally {
      if (loadTokenRef.current === token) {
        setLoading(false)
        setProgressState(null)
      }
    }
  }

  const handleDrop = async (event) => {
    event.preventDefault()
    setDragging(false)
    setError('')
    try {
      const files = await collectDroppedFiles(event.dataTransfer)
      await handleFiles(files)
    } catch (dropError) {
      setError(`No se pudo recorrer la carpeta: ${dropError.message}`)
    }
  }

  const calculate = async (roisOverride) => {
    if (!series) return
    const roisToUse = roisOverride === undefined ? manualRois : roisOverride
    const hot = parseDecimal(sphereActivity)
    const background = parseDecimal(backgroundActivity)
    const threshold = parseDecimal(thresholdPercent)
    const manualCentral = centralSlice.trim() === '' ? null : parseDecimal(centralSlice) - 1
    const manualLungStart = lungStartSlice.trim() === '' ? null : parseDecimal(lungStartSlice) - 1
    const manualLungEnd = lungEndSlice.trim() === '' ? null : parseDecimal(lungEndSlice) - 1

    setLoading(true)
    setResults(null)
    setError('')
    setStatus('Calculando esferas, 60 ROIs de fondo e inserto pulmonar…')
    await new Promise((resolve) => setTimeout(resolve, 40))

    try {
      const analysis = analyzePetNema(series, {
        sphereActivity: hot,
        backgroundActivity: background,
        centralSliceIndex: manualCentral,
        sphereThresholdFraction: threshold / 100,
        lungRangeStartIndex: manualLungStart,
        lungRangeEndIndex: manualLungEnd,
        backgroundRois: roisToUse || undefined
      })
      setResults(analysis)
      setStatus(`Análisis completado según ${analysis.standard}${roisToUse ? ' con las ROIs de fondo colocadas a mano' : ''}.`)
    } catch (analysisError) {
      setError(analysisError.message)
      setStatus('No se pudo completar el análisis.')
    } finally {
      setLoading(false)
    }
  }

  const clearSeries = () => {
    loadTokenRef.current++
    setSeries(null)
    setResults(null)
    setProgressState(null)
    setError('')
    setLoading(false)
    setStatus('Arrastra una carpeta o los archivos DICOM de la serie PET.')
  }

  const exportQn = () => {
    if (!results || roiBlocked) return
    const rows = [
      ['diametro_mm', 'C_hot_DICOM', 'C_fondo_DICOM', 'Q_pct', 'N_pct'],
      ...results.spheres.map((sphere) => [
        sphere.diameterMm,
        sphere.hotConcentration.toFixed(3),
        sphere.backgroundConcentration.toFixed(3),
        sphere.contrastPercent.toFixed(3),
        sphere.backgroundVariabilityPercent.toFixed(3)
      ])
    ]
    downloadText('nema_pet_Q_N.csv', rows.map((row) => row.join(',')).join('\r\n'))
  }

  const exportLung = () => {
    if (!results || roiBlocked) return
    const rows = [
      ['corte', 'distancia_mm', 'delta_pulmon_pct'],
      ...results.lung.profile.map((point) => [
        point.sliceIndex + 1,
        point.distanceMm.toFixed(3),
        point.residualErrorPercent.toFixed(3)
      ])
    ]
    downloadText('nema_pet_pulmon.csv', rows.map((row) => row.join(',')).join('\r\n'))
  }

  const chartLabels = results?.spheres.map((sphere) => String(sphere.diameterMm)) || []
  const contrastData = results ? {
    labels: chartLabels,
    datasets: [{ data: results.spheres.map((sphere) => sphere.contrastPercent), backgroundColor: CHART_COLORS.blue }]
  } : null
  const variabilityData = results ? {
    labels: chartLabels,
    datasets: [{ data: results.spheres.map((sphere) => sphere.backgroundVariabilityPercent), backgroundColor: CHART_COLORS.orange }]
  } : null
  const lungData = results ? {
    labels: results.lung.profile.map((point) => finite(point.distanceMm, 0)),
    datasets: [{
      data: results.lung.profile.map((point) => point.residualErrorPercent),
      borderColor: CHART_COLORS.blue,
      backgroundColor: 'rgba(136, 192, 208, 0.16)',
      pointRadius: 1.5,
      borderWidth: 2,
      tension: 0.15
    }]
  } : null
  const lungChartOptions = {
    ...chartOptions('ΔC pulmón (%)', false),
    scales: {
      ...chartOptions('ΔC pulmón (%)', false).scales,
      x: {
        ...chartOptions('ΔC pulmón (%)', false).scales.x,
        title: { display: true, text: 'Distancia al corte central (mm)', color: CHART_COLORS.muted },
        ticks: { color: CHART_COLORS.muted, maxTicksLimit: 10 }
      }
    }
  }

  return (
    <div className="page-body pet-analysis-page">
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-bullseye"></i></div>
        <h1 className="page-title">Análisis de calidad de imagen PET NEMA</h1>
        <p className="page-subtitle">
          Contraste, variabilidad del fondo y exactitud de correcciones del maniquí IEC — NEMA NU 2-2018 §7.4
        </p>
      </div>

      <div className="pet-analysis-privacy">
        <i className="bi bi-shield-check"></i>
        <div>
          <strong>Procesamiento local en el navegador</strong>
          <span>Los DICOM y sus datos de paciente no se suben ni se guardan en la web.</span>
        </div>
      </div>

      <section className="calc-card pet-analysis-section">
        <SectionHeading
          icon="bi-folder2-open"
          title="1. Serie PET"
          subtitle="Carpeta completa o selección múltiple de cortes DICOM sin comprimir"
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          {...{ webkitdirectory: '', directory: '' }}
          className="pet-analysis-hidden-input"
          onChange={(event) => {
            handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <input
          ref={filesInputRef}
          type="file"
          multiple
          accept=".dcm,.dicom,application/dicom"
          className="pet-analysis-hidden-input"
          onChange={(event) => {
            handleFiles(event.target.files)
            event.target.value = ''
          }}
        />

        <div
          className={`pet-analysis-dropzone${dragging ? ' pet-analysis-dropzone-active' : ''}${series ? ' pet-analysis-dropzone-loaded' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => !loading && folderInputRef.current?.click()}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ' ') && !loading) folderInputRef.current?.click()
          }}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false)
          }}
          onDrop={handleDrop}
        >
          <i className={`bi ${series ? 'bi-check-circle' : 'bi-cloud-arrow-up'}`}></i>
          <strong>{series ? 'Serie PET cargada' : 'Arrastra aquí la carpeta del PET'}</strong>
          <span>{series ? `${series.volume.length} cortes preparados para el análisis` : 'También puedes elegir una carpeta o varios DICOM'}</span>
          <div className="pet-analysis-drop-actions">
            <button type="button" disabled={loading} onClick={(event) => {
              event.stopPropagation()
              folderInputRef.current?.click()
            }}>
              <i className="bi bi-folder"></i> Elegir carpeta
            </button>
            <button type="button" disabled={loading} onClick={(event) => {
              event.stopPropagation()
              filesInputRef.current?.click()
            }}>
              <i className="bi bi-files"></i> Elegir archivos
            </button>
          </div>
        </div>

        {progressState && (
          <div className="pet-analysis-progress" aria-live="polite">
            <div><span style={{ width: `${Math.max(2, progressState.fraction * 100)}%` }}></span></div>
            <small>{progressState.message}</small>
          </div>
        )}

        <div className={`pet-analysis-status${error ? ' pet-analysis-status-error' : ''}`} role="status">
          <i className={`bi ${error ? 'bi-exclamation-triangle' : loading ? 'bi-hourglass-split' : 'bi-info-circle'}`}></i>
          <span>{error || status}</span>
        </div>

        {series && (
          <>
            <InfoGrid series={series} />
            <WarningList warnings={series.warnings} />
            <button type="button" className="pet-analysis-clear" onClick={clearSeries}>
              <i className="bi bi-x-lg"></i> Liberar la serie de memoria
            </button>
          </>
        )}
      </section>

      {series && (
        <section className="calc-card pet-analysis-section">
          <SectionHeading
            icon="bi-sliders"
            title="2. Datos del ensayo"
            subtitle="Concentraciones reales en el momento de adquisición; usa la misma unidad en ambos campos"
          />
          <div className="pet-analysis-form-grid">
            <label>
              <span className="field-label">Esferas a_H (kBq/ml)</span>
              <input className="dark-input" inputMode="decimal" value={sphereActivity} onChange={(event) => { setSphereActivity(event.target.value); resetAnalysis() }} />
            </label>
            <label>
              <span className="field-label">Fondo a_B (kBq/ml)</span>
              <input className="dark-input" inputMode="decimal" value={backgroundActivity} onChange={(event) => { setBackgroundActivity(event.target.value); resetAnalysis() }} />
            </label>
            <label>
              <span className="field-label">Corte central (opcional)</span>
              <input
                className="dark-input"
                type="number"
                min="1"
                max={series.volume.length}
                step="1"
                placeholder="Automático"
                value={centralSlice}
                onChange={(event) => { setCentralSlice(event.target.value); resetAnalysis() }}
              />
            </label>
            <div className="pet-analysis-ratio">
              <span>Relación a_H/a_B</span>
              <strong>{Number.isFinite(activityRatio) ? `${finite(activityRatio, 2)}:1` : '—'}</strong>
              {protocolLabel(activityRatio) && (
                <span className={`pet-analysis-protocol${protocolLabel(activityRatio).local ? ' pet-analysis-protocol-local' : ''}`}>
                  {protocolLabel(activityRatio).text}
                </span>
              )}
            </div>
          </div>

          <details className="pet-analysis-advanced">
            <summary>Opciones avanzadas</summary>
            <div className="pet-analysis-form-grid">
              <label>
                <span className="field-label">Umbral de esferas (%)</span>
                <input className="dark-input" inputMode="decimal" value={thresholdPercent} onChange={(event) => { setThresholdPercent(event.target.value); resetAnalysis() }} />
              </label>
              <label>
                <span className="field-label">Inicio inserto pulmonar</span>
                <input className="dark-input" type="number" min="1" max={series.volume.length} placeholder="Automático" value={lungStartSlice} onChange={(event) => { setLungStartSlice(event.target.value); resetAnalysis() }} />
              </label>
              <label>
                <span className="field-label">Fin inserto pulmonar</span>
                <input className="dark-input" type="number" min="1" max={series.volume.length} placeholder="Automático" value={lungEndSlice} onChange={(event) => { setLungEndSlice(event.target.value); resetAnalysis() }} />
              </label>
            </div>
            <p>El rango pulmonar automático excluye 30 mm de cada extremo axial del maniquí.</p>
          </details>

          <button className="pet-analysis-calculate" type="button" disabled={loading || roiBlocked} onClick={() => calculate()}>
            <i className={`bi ${loading ? 'bi-hourglass-split' : 'bi-play-fill'}`}></i>
            {loading ? ' Calculando…' : ' Calcular análisis NEMA'}
          </button>
        </section>
      )}

      {results && (
        <>
          <WarningList warnings={results.warnings} />

          <section className="calc-card pet-analysis-section">
            <SectionHeading
              icon="bi-clipboard2-pulse"
              title="Resumen del análisis"
              subtitle={`${results.standard} · 60 ROIs de fondo por diámetro`}
            />
            <div className="pet-analysis-metrics">
              <Metric
                label="Corte central"
                value={`${results.centralSlice + 1}`}
                detail={results.automaticCentralSlice == null ? 'selección manual' : `automático: ${results.automaticCentralSlice + 1}`}
                accent="blue"
              />
              <Metric
                label="Relación real"
                value={`${finite(results.activityRatio, 2)}:1`}
                detail={protocolLabel(results.activityRatio)?.text || 'a_H/a_B'}
              />
              <Metric
                label="Coplanaridad"
                value={`${finite(results.alignment.maximumAxialDeviationMm, 1)} mm`}
                detail={`${finite(results.alignment.inclinationDegrees, 1)}° de inclinación`}
                accent={results.alignment.withinCoplanarityTolerance ? 'green' : 'red'}
              />
              <Metric
                label="ΔC pulmón medio"
                value={`${finite(results.lung.meanPercent, 2)} %`}
                detail={`P5 ${finite(results.lung.percentile5, 2)} · P95 ${finite(results.lung.percentile95, 2)} %`}
                accent="green"
              />
            </div>
          </section>

          <section className="calc-card pet-analysis-section">
            <SectionHeading icon="bi-image" title="ROIs y alineación" subtitle="Superposición sobre el corte central y comprobación coronal" />
            <div className="pet-analysis-view-grid">
              <figure>
                <CentralRoiCanvas
                  series={series}
                  results={results}
                  rois={activeRois}
                  diagnostics={roiDiagnostics}
                  onMoveRoi={handleMoveRoi}
                />
                <figcaption>
                  Corte {results.centralSlice + 1}: esferas, 12 posiciones de fondo e inserto pulmonar.
                  Arrastra cualquier ROI de fondo para recolocarla; las mismas coordenadas se aplican a los cinco cortes.
                </figcaption>
                <div className="pet-analysis-legend">
                  <span><i className="red"></i> Esferas</span>
                  <span><i className="blue"></i> Fondo correcto</span>
                  <span><i className="orange"></i> Fondo solapado</span>
                  <span><i className="red"></i> Fondo no conforme</span>
                  <span><i className="green"></i> Pulmón</span>
                </div>
                <div className="pet-analysis-roi-actions">
                  <button type="button" onClick={restoreAutomaticRois} disabled={!roiManual}>
                    <i className="bi bi-arrow-counterclockwise"></i> Restaurar distribución automática
                  </button>
                  <span>
                    {roiDirty
                      ? 'Posiciones manuales sin aplicar: vuelve a calcular para que entren en Q y N.'
                      : roiManual
                        ? 'Posiciones manuales aplicadas a los cinco cortes.'
                        : 'Distribución automática: lo más cerca posible del borde, a 15 mm como mínimo.'}
                  </span>
                </div>
                {roiDiagnostics?.violations.map((violation) => (
                  <div className="pet-analysis-violation" key={violation}>
                    <i className="bi bi-x-octagon"></i><span>{violation}</span>
                  </div>
                ))}
                {roiBlocked && (
                  <div className="pet-analysis-violation">
                    <i className="bi bi-lock"></i>
                    <span>El cálculo y la exportación están bloqueados mientras alguna ROI incumpla una restricción obligatoria.</span>
                  </div>
                )}
              </figure>
              <figure>
                <CoronalCanvas series={series} results={results} />
                <figcaption>Plano coronal por la esfera de 17 mm; línea roja = corte central.</figcaption>
              </figure>
            </div>
          </section>

          <section className="calc-card pet-analysis-section">
            <SectionHeading icon="bi-bar-chart" title="Contraste y variabilidad" subtitle="Resultados de NEMA NU 2-2018 §7.4.1" />
            <div className="pet-analysis-chart-grid">
              <div>
                <h3>Contraste porcentual Q<sub>H,j</sub></h3>
                <div className="pet-analysis-chart"><Bar data={contrastData} options={chartOptions('Q (%)')} /></div>
              </div>
              <div>
                <h3>Variabilidad del fondo N<sub>j</sub></h3>
                <div className="pet-analysis-chart"><Bar data={variabilityData} options={chartOptions('N (%)')} /></div>
              </div>
            </div>

            <div className="pet-analysis-table-wrap">
              <table className="pet-analysis-table">
                <thead>
                  <tr>
                    <th>Esfera</th>
                    <th>C<sub>hot</sub></th>
                    <th>C<sub>fondo</sub></th>
                    <th>Q (%)</th>
                    <th>N (%)</th>
                    <th>Pico axial</th>
                  </tr>
                </thead>
                <tbody>
                  {results.spheres.map((sphere) => {
                    const hot = concentrationPresentation(sphere.hotConcentration, series.units)
                    const background = concentrationPresentation(sphere.backgroundConcentration, series.units)
                    return (
                      <tr key={sphere.diameterMm}>
                        <td><strong>{sphere.diameterMm} mm</strong></td>
                        <td>{finite(hot.value, 2)} {hot.unit}</td>
                        <td>{finite(background.value, 2)} {background.unit}</td>
                        <td>{finite(sphere.contrastPercent, 2)} %</td>
                        <td>{finite(sphere.backgroundVariabilityPercent, 2)} %</td>
                        <td>{sphere.peakOffsetMm >= 0 ? '+' : ''}{finite(sphere.peakOffsetMm, 1)} mm</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="calc-card pet-analysis-section">
            <SectionHeading icon="bi-activity" title="Exactitud de las correcciones" subtitle="Error residual del inserto pulmonar — NEMA NU 2-2018 §7.4.2" />
            <div className="pet-analysis-metrics pet-analysis-lung-metrics">
              <Metric label="Media" value={`${finite(results.lung.meanPercent, 2)} %`} accent="blue" />
              <Metric label="Percentil 5" value={`${finite(results.lung.percentile5, 2)} %`} />
              <Metric label="Percentil 95" value={`${finite(results.lung.percentile95, 2)} %`} />
              <Metric label="Cortes analizados" value={`${results.lung.startSlice + 1}–${results.lung.endSlice + 1}`} />
            </div>
            <div className="pet-analysis-lung-chart"><Line data={lungData} options={lungChartOptions} /></div>
          </section>

          <section className="calc-card pet-analysis-section">
            <SectionHeading icon="bi-list-check" title="Control geométrico y datos detallados" />
            <div className="pet-analysis-diagnostics">
              <Metric label="Nivel de fondo estimado" value={`${finite(concentrationPresentation(results.phantom.backgroundLevel, series.units).value, 2)} ${concentrationPresentation(results.phantom.backgroundLevel, series.units).unit}`} />
              <Metric label="Radio del anillo" value={`${finite(results.phantom.averageRadiusMm, 1)} ± ${finite(results.phantom.radiusSdMm, 1)} mm`} />
              <Metric label="Cuerpo axial" value={`${results.bodyRange.startSlice + 1}–${results.bodyRange.endSlice + 1}`} detail={`${finite(results.bodyRange.lengthMm, 0)} mm`} />
              <Metric
                label="Colocación"
                value={roiManual ? 'Manual' : 'Automática'}
                detail="12 ROIs de 37 mm"
              />
            </div>

            <h3 className="pet-analysis-subheading">Geometría de las ROIs de fondo</h3>
            <div className="pet-analysis-diagnostics">
              <Metric
                label="Separación mínima entre centros"
                value={`${finite(roiDiagnostics?.minimumCenterSeparationMm, 1)} mm`}
                detail={roiDiagnostics?.minimumCenterSeparationMm >= 37 ? 'sin solapamiento' : 'hay solapamiento'}
                accent={roiDiagnostics?.minimumCenterSeparationMm >= 37 ? 'green' : 'orange'}
              />
              <Metric
                label="Solapamiento lineal máximo"
                value={`${finite(roiDiagnostics?.maximumLinearOverlapMm, 1)} mm`}
                detail={`S = max(0, 37 − d mín)`}
                accent={roiDiagnostics?.maximumLinearOverlapMm > 0 ? 'orange' : 'green'}
              />
              <Metric
                label="Parejas solapadas"
                value={`${roiDiagnostics?.overlappingPairCount ?? 0}`}
                detail={roiDiagnostics?.worstOverlapPair
                  ? `peor: ROIs ${roiDiagnostics.worstOverlapPair.a} y ${roiDiagnostics.worstOverlapPair.b}`
                  : 'ninguna'}
                accent={roiDiagnostics?.overlappingPairCount ? 'orange' : 'green'}
              />
              <Metric
                label="Holgura mínima al borde"
                value={`${finite(roiDiagnostics?.minimumEdgeClearanceMm, 1)} mm`}
                detail={`mínimo NEMA ${results.options.edgeMarginMm} mm`}
                accent={roiDiagnostics?.minimumEdgeClearanceMm >= results.options.edgeMarginMm ? 'green' : 'red'}
              />
              <Metric
                label="Holgura mínima a las esferas"
                value={`${finite(roiDiagnostics?.minimumSphereClearanceMm, 1)} mm`}
                detail={`objetivo ${results.options.sphereMarginMm} mm, obligatorio no solapar`}
                accent={roiDiagnostics?.minimumSphereClearanceMm >= 0 ? 'green' : 'red'}
              />
            </div>

            <details className="pet-analysis-details">
              <summary>Ver las 12 posiciones de fondo</summary>
              <div className="pet-analysis-table-wrap">
                <table className="pet-analysis-table">
                  <thead>
                    <tr>
                      <th>ROI</th>
                      <th>x (mm)</th>
                      <th>y (mm)</th>
                      <th>Al borde</th>
                      <th>A esferas</th>
                      <th>Solapamiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(roiDiagnostics?.rois || []).map((roi, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>{finite(roi.xMm, 1)}</td>
                        <td>{finite(roi.yMm, 1)}</td>
                        <td className={roi.violatesEdge ? 'pet-analysis-cell-bad' : ''}>
                          {finite(roi.edgeClearanceMm, 1)} mm
                        </td>
                        <td className={roi.violatesSphere ? 'pet-analysis-cell-bad' : roi.tightToSphere ? 'pet-analysis-cell-warn' : ''}>
                          {finite(roi.sphereGapMm, 1)} mm
                        </td>
                        <td className={roi.maximumOverlapMm > 0 ? 'pet-analysis-cell-warn' : ''}>
                          {roi.maximumOverlapMm > 0
                            ? `${finite(roi.maximumOverlapMm, 1)} mm con ${roi.overlapsWith.map((other) => other + 1).join(', ')}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="pet-analysis-slices">
                El solapamiento entre ROIs de fondo no incumple NU 2-2018: se informa porque en esa
                zona las 60 medidas dejan de ser independientes. Lo que sí es obligatorio, y bloquea
                el cálculo, es la holgura de {results.options.edgeMarginMm} mm al borde del maniquí y
                no solapar ninguna esfera ni el inserto pulmonar.
              </p>
            </details>
            <p className="pet-analysis-slices">
              Cortes de fondo: {results.backgroundSlices.map((slice) => `${slice.index + 1} (${slice.offsetMm >= 0 ? '+' : ''}${finite(slice.offsetMm, 0)} mm)`).join(' · ')}
            </p>
          </section>

          <section className="calc-card pet-analysis-section pet-analysis-export">
            <SectionHeading icon="bi-download" title="Exportar resultados" subtitle="CSV sin metadatos identificativos del paciente" />
            <div>
              <button type="button" onClick={exportQn} disabled={roiBlocked}><i className="bi bi-filetype-csv"></i> Contraste y fondo</button>
              <button type="button" onClick={exportLung} disabled={roiBlocked}><i className="bi bi-filetype-csv"></i> Perfil pulmonar</button>
            </div>
            <p>Herramienta de apoyo para control de calidad. Verifica visualmente las ROIs y conserva el protocolo de adquisición junto al informe.</p>
          </section>
        </>
      )}
    </div>
  )
}

export default PetNemaAnalysis
