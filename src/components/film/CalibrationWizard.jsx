import { useMemo, useRef, useState } from 'react'
import { buildFilmCalibration } from '../../utils/filmCalibration.js'
import { pairedNetOdRoi, readRgb16TiffFiles } from '../../utils/filmTiff.js'
import CalibrationRoiSelector from './CalibrationRoiSelector.jsx'

const DEFAULT_DOSES_CGY = [50, 100, 200, 300, 400, 500, 600, 700]

function newRow(dose = '') {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    dose,
    baselineFiles: [],
    exposedFiles: [],
    summary: null,
    busy: false,
    error: ''
  }
}

export default function CalibrationWizard({ onCancel, onSave }) {
  const [name, setName] = useState('Calibración EBT3')
  const [filmType, setFilmType] = useState('Gafchromic EBT3')
  const [lot, setLot] = useState('')
  const [scanner, setScanner] = useState('')
  const [dpi, setDpi] = useState('72')
  const [orientation, setOrientation] = useState('Retrato, misma dirección')
  const [delayHours, setDelayHours] = useState('24')
  const [doseUnit, setDoseUnit] = useState('cGy')
  const [roiEnabled, setRoiEnabled] = useState(false)
  const [roi, setRoi] = useState({ mode: 'relative', x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
  const [rows, setRows] = useState(DEFAULT_DOSES_CGY.map(newRow))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const roiRevision = useRef(0)

  const processedCount = rows.filter((row) => row.summary).length
  const canSave = useMemo(() => processedCount >= 4 && !rows.some((row) => row.busy), [processedCount, rows])
  const previewFile = rows.find((row) => row.baselineFiles.length)?.baselineFiles[0] || null
  const activeRoi = roiEnabled ? roi : null

  const updateRow = (id, patch) => setRows((current) => current.map((row) =>
    row.id === id ? { ...row, ...patch } : row
  ))

  const updateRoi = (patch) => {
    roiRevision.current++
    setRoi((current) => ({ ...current, ...patch }))
    setRows((current) => current.map((row) => ({ ...row, summary: null, error: '' })))
  }

  const changeRoiMode = (enabled) => {
    if (enabled === roiEnabled) return
    roiRevision.current++
    setRoiEnabled(enabled)
    setRows((current) => current.map((row) => ({ ...row, summary: null, error: '' })))
  }

  const processRow = async (row) => {
    if (!row.baselineFiles.length || !row.exposedFiles.length) {
      updateRow(row.id, { error: 'Selecciona TIFF pre y post.', summary: null })
      return null
    }
    const processingRevision = roiRevision.current
    const processingRoi = activeRoi ? { ...activeRoi } : null
    updateRow(row.id, { busy: true, error: '' })
    try {
      const [baseline, exposed] = await Promise.all([
        readRgb16TiffFiles(row.baselineFiles),
        readRgb16TiffFiles(row.exposedFiles)
      ])
      const summary = pairedNetOdRoi(baseline, exposed, processingRoi)
      if (processingRevision !== roiRevision.current) {
        updateRow(row.id, { busy: false, summary: null, error: 'La zona cambió durante el cálculo; vuelve a procesar este punto.' })
        return null
      }
      updateRow(row.id, { busy: false, summary, error: '' })
      return summary
    } catch (exception) {
      updateRow(row.id, { busy: false, summary: null, error: exception.message })
      return null
    }
  }

  const processAll = async () => {
    setBusy(true)
    setError('')
    try {
      for (const row of rows) {
        if (row.baselineFiles.length && row.exposedFiles.length && !row.summary) await processRow(row)
      }
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const calibration = buildFilmCalibration({
        name,
        metadata: {
          filmType,
          lot,
          scanner,
          dpi: Number(dpi),
          orientation,
          delayHours: Number(delayHours),
          inputDoseUnit: doseUnit,
          protocol: 'matched-pre-post',
          processing: roiEnabled ? 'pixelwise-netod-roi' : 'pixelwise-netod-full-image'
        },
        roi: activeRoi,
        points: rows.filter((row) => row.summary).map((row) => ({
          id: row.id,
          doseGy: Number(row.dose) * (doseUnit === 'cGy' ? 0.01 : 1),
          files: {
            baseline: row.baselineFiles.map((file) => file.name),
            exposed: row.exposedFiles.map((file) => file.name)
          },
          summary: row.summary
        }))
      })
      await onSave(calibration)
    } catch (exception) {
      setError(exception.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="film-section film-wizard">
      <div className="film-section-heading">
        <div>
          <h2>Nueva calibración</h2>
          <p>Protocolo pre/post: cada dosis utiliza los escaneos de la misma película antes y después de irradiarla, con idéntica posición y orientación.</p>
        </div>
        <button type="button" className="film-button secondary" onClick={onCancel}>Cancelar</button>
      </div>

      <div className="film-form-grid">
        <label><span>Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>Película</span><input value={filmType} onChange={(event) => setFilmType(event.target.value)} /></label>
        <label><span>Lote</span><input value={lot} onChange={(event) => setLot(event.target.value)} placeholder="p. ej. 03012401" /></label>
        <label><span>Escáner</span><input value={scanner} onChange={(event) => setScanner(event.target.value)} placeholder="Modelo y unidad" /></label>
        <label><span>Resolución nominal</span><div className="film-input-suffix"><input type="number" min="1" value={dpi} onChange={(event) => setDpi(event.target.value)} /><span>dpi</span></div></label>
        <label><span>Espera postirradiación</span><div className="film-input-suffix"><input type="number" min="0" step="0.5" value={delayHours} onChange={(event) => setDelayHours(event.target.value)} /><span>h</span></div></label>
        <label><span>Orientación</span><input value={orientation} onChange={(event) => setOrientation(event.target.value)} /></label>
        <label><span>Unidad de dosis</span><select value={doseUnit} onChange={(event) => setDoseUnit(event.target.value)}><option value="cGy">cGy</option><option value="Gy">Gy</option></select></label>
      </div>

      <div className="film-subsection">
        <div className="film-subsection-title">
          <div><strong>Zona de calibración</strong><span>La ROI es opcional. Si no se selecciona, se procesa la imagen completa.</span></div>
        </div>
        <CalibrationRoiSelector
          file={previewFile}
          enabled={roiEnabled}
          roi={roi}
          onEnabledChange={changeRoiMode}
          onChange={updateRoi}
        />
      </div>

      <div className="film-subsection">
        <div className="film-subsection-title">
          <div><strong>Puntos de calibración</strong><span>Selecciona las repeticiones con Ctrl/Mayús. No se aplica registro automático entre escaneos.</span></div>
          <button type="button" className="film-button secondary" onClick={() => setRows((current) => [...current, newRow()])}><i className="bi bi-plus" /> Punto</button>
        </div>
        <div className="film-points-table-wrap">
          <table className="film-points-table">
            <thead><tr><th>Dosis</th><th>TIFF pre</th><th>TIFF post</th><th>netOD R / G / B</th><th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.error ? 'row-error' : row.summary ? 'row-ready' : ''}>
                  <td><div className="film-dose-input"><input type="number" min="0" step="any" value={row.dose} onChange={(event) => updateRow(row.id, { dose: event.target.value, summary: null })} /><span>{doseUnit}</span></div></td>
                  <td><label className="film-file-button"><i className="bi bi-file-earmark-image" /><span>{row.baselineFiles.length ? `${row.baselineFiles.length} archivo(s)` : 'Seleccionar'}</span><input type="file" multiple accept=".tif,.tiff,image/tiff" onChange={(event) => updateRow(row.id, { baselineFiles: Array.from(event.target.files || []), summary: null, error: '' })} /></label></td>
                  <td><label className="film-file-button"><i className="bi bi-file-earmark-image" /><span>{row.exposedFiles.length ? `${row.exposedFiles.length} archivo(s)` : 'Seleccionar'}</span><input type="file" multiple accept=".tif,.tiff,image/tiff" onChange={(event) => updateRow(row.id, { exposedFiles: Array.from(event.target.files || []), summary: null, error: '' })} /></label></td>
                  <td>
                    {row.busy ? <span className="film-row-state"><i className="bi bi-arrow-repeat spin" /> Procesando</span> : row.summary ? (
                      <span className="film-netod-values">{row.summary.netOd.mean.map((value) => value.toFixed(5)).join(' / ')}</span>
                    ) : row.error ? <span className="film-row-error" title={row.error}>{row.error}</span> : <span className="film-muted">Pendiente</span>}
                  </td>
                  <td className="film-row-actions">
                    <button type="button" className="film-icon-button" title="Procesar" disabled={row.busy} onClick={() => processRow(row)}><i className="bi bi-calculator" /></button>
                    <button type="button" className="film-icon-button danger" title="Quitar" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}><i className="bi bi-x-lg" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <div className="film-alert error"><i className="bi bi-exclamation-triangle" />{error}</div>}
      <div className="film-wizard-footer">
        <span>{processedCount} punto(s) procesado(s). Se añade automáticamente el anclaje 0 Gy, netOD 0.</span>
        <div>
          <button type="button" className="film-button secondary" disabled={busy} onClick={processAll}><i className="bi bi-gear" /> Procesar disponibles</button>
          <button type="button" className="film-button" disabled={!canSave || busy} onClick={save}><i className="bi bi-save" /> Ajustar y guardar</button>
        </div>
      </div>
    </section>
  )
}
