import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import DoseCanvas from './DoseCanvas.jsx'
import { FILM_ANALYSIS_METHODS } from '../../utils/filmAnalysis.js'
import { RESPONSE_BASIS_INTENSITY } from '../../utils/filmCalibration.js'
import { averageImages, readRgb16TiffFiles } from '../../utils/filmTiff.js'
import { createFilmRtDose, inspectDoseReference, triggerDicomDownload } from '../../utils/rtDoseWriter.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

function finite(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function countFlags(values) {
  let count = 0
  for (const value of values || []) count += value ? 1 : 0
  return count
}

function parseVector(text, length) {
  const values = String(text).split(/[\\,;\s]+/).filter(Boolean).map(Number)
  return values.length === length && values.every(Number.isFinite) ? values : null
}

function vectorText(values) {
  return Array.isArray(values) ? values.join(' \\ ') : ''
}

function patientNameText(value) {
  if (typeof value === 'string') return value
  if (value?.Alphabetic) return value.Alphabetic
  return '—'
}

function sampleProfile(values, width, height, horizontal) {
  const length = horizontal ? width : height
  const fixed = horizontal ? Math.floor(height / 2) : Math.floor(width / 2)
  const step = Math.max(1, Math.ceil(length / 450))
  const labels = []
  const data = []
  for (let position = 0; position < length; position += step) {
    const index = horizontal ? fixed * width + position : position * width + fixed
    labels.push(position)
    data.push(Number.isFinite(values[index]) ? values[index] : null)
  }
  return { labels, data }
}

function Profiles({ result }) {
  const horizontal = useMemo(() => sampleProfile(result.dose, result.width, result.height, true), [result])
  const vertical = useMemo(() => sampleProfile(result.dose, result.width, result.height, false), [result])
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#7b88a1', maxTicksLimit: 8 }, grid: { color: 'rgba(123,136,161,.12)' }, title: { display: true, text: 'Píxel', color: '#7b88a1' } },
      y: { ticks: { color: '#7b88a1' }, grid: { color: 'rgba(123,136,161,.12)' }, title: { display: true, text: 'Dosis (Gy)', color: '#7b88a1' } }
    }
  }
  const dataset = (profile, color) => ({
    labels: profile.labels,
    datasets: [{ data: profile.data, borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.05 }]
  })
  return (
    <div className="film-profile-grid">
      <div><strong>Perfil horizontal central</strong><div className="film-profile-chart"><Line data={dataset(horizontal, '#88c0d0')} options={options} /></div></div>
      <div><strong>Perfil vertical central</strong><div className="film-profile-chart"><Line data={dataset(vertical, '#a3be8c')} options={options} /></div></div>
    </div>
  )
}

export default function FilmAnalysis({ calibration }) {
  const [measurementFiles, setMeasurementFiles] = useState([])
  const [referenceFiles, setReferenceFiles] = useState([])
  const [method, setMethod] = useState('multichannel')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const workerRef = useRef(null)

  const [dicomName, setDicomName] = useState('')
  const [dicomBuffer, setDicomBuffer] = useState(null)
  const [dicomSummary, setDicomSummary] = useState(null)
  const [planName, setPlanName] = useState('')
  const [planBuffer, setPlanBuffer] = useState(null)
  const [planSummary, setPlanSummary] = useState(null)
  const [positionText, setPositionText] = useState('')
  const [orientationText, setOrientationText] = useState('')
  const [dicomError, setDicomError] = useState('')
  const intensityBasis = calibration?.responseBasis === RESPONSE_BASIS_INTENSITY

  useEffect(() => () => workerRef.current?.terminate(), [])
  useEffect(() => {
    setResult(null)
    setError('')
    setReferenceFiles([])
    setDicomName('')
    setDicomBuffer(null)
    setDicomSummary(null)
    setPlanName('')
    setPlanBuffer(null)
    setPlanSummary(null)
    setPositionText('')
    setOrientationText('')
    setDicomError('')
  }, [calibration?.id])

  const run = async () => {
    if (!calibration) return
    if (!measurementFiles.length) {
      setError('Selecciona al menos un TIFF de la película irradiada.')
      return
    }
    setBusy(true)
    setProgress(0)
    setError('')
    setResult(null)
    workerRef.current?.terminate()
    try {
      const measurement = averageImages(await readRgb16TiffFiles(measurementFiles))
      const reference = !intensityBasis && referenceFiles.length ? averageImages(await readRgb16TiffFiles(referenceFiles)) : null
      const fallbackDpi = Number(calibration.metadata?.dpi)
      if (!measurement.pixelSpacingMm?.every(Number.isFinite) && fallbackDpi > 0) {
        measurement.pixelSpacingMm = [25.4 / fallbackDpi, 25.4 / fallbackDpi]
      }
      if (reference && !reference.pixelSpacingMm?.every(Number.isFinite)) reference.pixelSpacingMm = measurement.pixelSpacingMm

      const worker = new Worker(new URL('../../workers/filmDose.worker.js', import.meta.url), { type: 'module' })
      workerRef.current = worker
      const workerResult = await new Promise((resolve, reject) => {
        worker.onmessage = (event) => {
          if (event.data?.type === 'progress') setProgress(event.data.fraction)
          else if (event.data?.type === 'result') resolve(event.data.result)
          else if (event.data?.type === 'error') reject(new Error(event.data.message))
        }
        worker.onerror = (event) => reject(new Error(event.message || 'Falló el proceso de cálculo.'))
        const transfer = [measurement.data.buffer]
        if (reference?.data) transfer.push(reference.data.buffer)
        worker.postMessage({ type: 'analyze', payload: { measurement, reference, calibration, method } }, transfer)
      })
      worker.terminate()
      workerRef.current = null
      setResult(workerResult)
    } catch (exception) {
      setError(exception.message)
    } finally {
      setBusy(false)
    }
  }

  const stop = () => {
    workerRef.current?.terminate()
    workerRef.current = null
    setBusy(false)
    setError('Cálculo cancelado.')
  }

  const loadDicomReference = async (file) => {
    if (!file) return
    setDicomError('')
    try {
      const buffer = await file.arrayBuffer()
      const inspected = inspectDoseReference(buffer)
      if (!inspected.summary.hasGeometry) throw new Error('El DICOM no contiene ImagePositionPatient, ImageOrientationPatient y PixelSpacing.')
      setDicomName(file.name)
      setDicomBuffer(buffer)
      setDicomSummary(inspected.summary)
      setPlanName('')
      setPlanBuffer(null)
      setPlanSummary(null)
      setPositionText(vectorText(inspected.summary.geometry.imagePositionPatient))
      setOrientationText(vectorText(inspected.summary.geometry.imageOrientationPatient))
    } catch (exception) {
      setDicomBuffer(null)
      setDicomSummary(null)
      setDicomError(exception.message)
    }
  }

  const loadPlanReference = async (file) => {
    if (!file) return
    setDicomError('')
    try {
      const buffer = await file.arrayBuffer()
      const inspected = inspectDoseReference(buffer)
      if (!inspected.summary.isRtPlan) throw new Error('El archivo seleccionado no es un RT Plan ni un RT Ion Plan.')
      setPlanName(file.name)
      setPlanBuffer(buffer)
      setPlanSummary(inspected.summary)
    } catch (exception) {
      setPlanName('')
      setPlanBuffer(null)
      setPlanSummary(null)
      setDicomError(exception.message)
    }
  }

  const exportDicom = () => {
    setDicomError('')
    try {
      const position = parseVector(positionText, 3)
      const orientation = parseVector(orientationText, 6)
      if (!position) throw new Error('ImagePositionPatient debe contener tres números.')
      if (!orientation) throw new Error('ImageOrientationPatient debe contener seis números.')
      const exported = createFilmRtDose({
        dose: result.dose,
        width: result.width,
        height: result.height,
        pixelSpacingMm: result.pixelSpacingMm,
        referenceBuffer: dicomBuffer,
        planReferenceBuffer: planBuffer,
        geometry: { imagePositionPatient: position, imageOrientationPatient: orientation },
        calibrationName: calibration.name,
        method: result.method,
        doseSummationType: 'PLAN'
      })
      triggerDicomDownload(exported)
    } catch (exception) {
      setDicomError(exception.message)
    }
  }

  if (!calibration) {
    return <div className="film-empty"><i className="bi bi-sliders" /><strong>No hay calibración activa</strong><span>Selecciona o crea una calibración antes de analizar una película.</span></div>
  }

  const invalidCount = result ? countFlags(result.invalid) : 0
  const outCount = result ? countFlags(result.outOfRange) : 0
  const saturatedCount = result ? countFlags(result.saturated) : 0
  const totalPixels = result ? result.width * result.height : 0
  const methodLabel = FILM_ANALYSIS_METHODS.find((entry) => entry.id === method)?.label

  return (
    <section className="film-section">
      <div className="film-section-heading">
        <div><h2>Analizar película</h2><p>Calibración activa: <strong>{calibration.name}</strong> · rango {calibration.doseRangeGy[0].toFixed(2)}–{calibration.doseRangeGy[1].toFixed(2)} Gy · {intensityBasis ? 'intensidad RGB' : 'netOD'}.</p></div>
        <span className={`film-status ${calibration.validation?.valid ? 'ok' : 'warn'}`}>{calibration.validation?.valid ? 'Calibración verificada internamente' : 'Calibración con advertencias'}</span>
      </div>

      <div className="film-analysis-inputs">
        <div className="film-upload-card">
          <i className="bi bi-film" />
          <strong>Película irradiada</strong>
          <span>{measurementFiles.length ? `${measurementFiles.length} escaneo(s): ${measurementFiles.map((file) => file.name).join(', ')}` : 'Carga una o varias repeticiones con idéntica posición; no se aplica registro automático.'}</span>
          <label className="film-button"><i className="bi bi-folder2-open" /> Seleccionar TIFF<input type="file" multiple accept=".tif,.tiff,image/tiff" onChange={(event) => { setMeasurementFiles(Array.from(event.target.files || [])); setResult(null) }} /></label>
        </div>
        {intensityBasis ? (
          <div className="film-upload-card secondary">
            <i className="bi bi-brightness-high" />
            <strong>Análisis sin TIFF pre</strong>
            <span>Esta calibración utiliza directamente I/65535. No necesita ni admite una referencia sin irradiar.</span>
          </div>
        ) : (
          <div className="film-upload-card secondary">
            <i className="bi bi-circle-half" />
            <strong>Referencia sin irradiar</strong>
            <span>{referenceFiles.length ? `${referenceFiles.length} escaneo(s): ${referenceFiles.map((file) => file.name).join(', ')}` : 'Opcional. Si se omite, se usa el I₀ medio guardado en la calibración.'}</span>
            <label className="film-button secondary"><i className="bi bi-folder2-open" /> Seleccionar I₀<input type="file" multiple accept=".tif,.tiff,image/tiff" onChange={(event) => { setReferenceFiles(Array.from(event.target.files || [])); setResult(null) }} /></label>
          </div>
        )}
      </div>

      <div className="film-run-bar">
        <label><span>Método</span><select value={method} onChange={(event) => { setMethod(event.target.value); setResult(null) }}>{FILM_ANALYSIS_METHODS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
        {busy ? <button type="button" className="film-button danger" onClick={stop}><i className="bi bi-stop-circle" /> Cancelar</button> : <button type="button" className="film-button" onClick={run} disabled={!measurementFiles.length}><i className="bi bi-play-fill" /> Calcular dosis</button>}
      </div>
      {busy && <div className="film-progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /><span>{Math.round(progress * 100)} %</span></div>}
      {error && <div className="film-alert error"><i className="bi bi-exclamation-triangle" />{error}</div>}

      {result && (
        <>
          <div className="film-results-heading"><div><strong>Resultado</strong><span>{methodLabel} · {result.width}×{result.height} píxeles</span></div><span>{new Date(result.createdAt).toLocaleString('es-ES')}</span></div>
          <div className="film-stat-grid">
            <div><span>Dosis media</span><strong>{finite(result.statistics.meanGy)} Gy</strong></div>
            <div><span>Desviación</span><strong>{finite(result.statistics.stdGy)} Gy</strong></div>
            <div><span>Rango</span><strong>{finite(result.statistics.minGy)}–{finite(result.statistics.maxGy)} Gy</strong></div>
            <div className={outCount ? 'warn' : ''}><span>Fuera de calibración</span><strong>{outCount.toLocaleString('es-ES')} ({finite(outCount / totalPixels * 100, 1)} %)</strong></div>
            <div className={saturatedCount ? 'warn' : ''}><span>Saturados</span><strong>{saturatedCount.toLocaleString('es-ES')}</strong></div>
            <div className={invalidCount ? 'error' : ''}><span>No válidos</span><strong>{invalidCount.toLocaleString('es-ES')}</strong></div>
          </div>
          <div className="film-map-grid">
            <DoseCanvas values={result.dose} width={result.width} height={result.height} invalid={result.invalid} outOfRange={result.outOfRange} saturated={result.saturated} title="Dosis absorbida" />
            <DoseCanvas values={result.sigma} width={result.width} height={result.height} invalid={result.invalid} title="Incertidumbre local aproximada" />
          </div>
          <Profiles result={result} />

          <div className="film-export-card">
            <div className="film-subsection-title"><div><strong>Exportar DICOM RT Dose</strong><span>La geometría debe describir la posición real del plano de película en coordenadas de paciente.</span></div></div>
            <div className="film-dicom-grid">
              <label className="film-file-button large"><i className="bi bi-file-earmark-medical" /><span>{dicomName || 'CT o RT Dose para geometría'}</span><input type="file" accept=".dcm,application/dicom" onChange={(event) => loadDicomReference(event.target.files?.[0])} /></label>
              <label className="film-file-button large"><i className="bi bi-diagram-3" /><span>{dicomSummary?.hasPlanReference ? 'RT Plan heredado del RT Dose' : planName || 'RT Plan de referencia (obligatorio)'}</span><input type="file" accept=".dcm,application/dicom" disabled={dicomSummary?.hasPlanReference} onChange={(event) => loadPlanReference(event.target.files?.[0])} /></label>
              <label className="wide"><span>Image Position Patient (mm)</span><input value={positionText} onChange={(event) => setPositionText(event.target.value)} placeholder="x \\ y \\ z" /></label>
              <label className="wide"><span>Image Orientation Patient</span><input value={orientationText} onChange={(event) => setOrientationText(event.target.value)} placeholder="1 \\ 0 \\ 0 \\ 0 \\ 1 \\ 0" /></label>
            </div>
            {dicomSummary && <div className="film-dicom-summary"><span>Paciente: {patientNameText(dicomSummary.patientName)} ({dicomSummary.patientId || 'sin ID'})</span><span>Frame of Reference: {dicomSummary.frameOfReferenceUid}</span><span>Dose Summation Type: PLAN</span><span>{dicomSummary.hasPlanReference ? 'RT Plan heredado' : planSummary ? `RT Plan: ${planSummary.sopInstanceUid}` : 'Falta RT Plan'}</span></div>}
            {dicomError && <div className="film-alert error"><i className="bi bi-exclamation-triangle" />{dicomError}</div>}
            <div className="film-export-actions"><button type="button" className="film-button" disabled={!dicomBuffer || (!dicomSummary?.hasPlanReference && !planBuffer)} onClick={exportDicom}><i className="bi bi-download" /> Descargar RT Dose</button></div>
          </div>
        </>
      )}
    </section>
  )
}
