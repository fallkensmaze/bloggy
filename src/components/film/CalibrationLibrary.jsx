import { useRef, useState } from 'react'
import {
  downloadFilmCalibration,
  parseFilmCalibration
} from '../../utils/filmStorage.js'

function dateLabel(value) {
  if (!value) return '—'
  try { return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(value)) } catch { return value }
}

export default function CalibrationLibrary({ calibrations, activeId, onUse, onDelete, onDuplicate, onImport, onCreate }) {
  const inputRef = useRef(null)
  const [error, setError] = useState('')

  const importFile = async (file) => {
    if (!file) return
    setError('')
    try {
      const calibration = parseFilmCalibration(await file.text())
      await onImport(calibration)
    } catch (exception) {
      setError(exception.message)
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <section className="film-section">
      <div className="film-section-heading">
        <div>
          <h2>Biblioteca de calibraciones</h2>
          <p>Se guardan solo en IndexedDB en este navegador. Exporta una copia para conservarlas.</p>
        </div>
        <div className="film-heading-actions">
          <button type="button" className="film-button secondary" onClick={() => inputRef.current?.click()}>
            <i className="bi bi-upload" /> Importar
          </button>
          <button type="button" className="film-button" onClick={onCreate}>
            <i className="bi bi-plus-lg" /> Nueva calibración
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        className="film-hidden-input"
        type="file"
        accept=".json,.filmcal.json,application/json"
        onChange={(event) => importFile(event.target.files?.[0])}
      />
      {error && <div className="film-alert error"><i className="bi bi-exclamation-triangle" />{error}</div>}

      {!calibrations.length ? (
        <div className="film-empty">
          <i className="bi bi-collection" />
          <strong>No hay calibraciones guardadas</strong>
          <span>Crea la primera a partir de TIFF RGB de 16 bits por canal.</span>
        </div>
      ) : (
        <div className="film-calibration-grid">
          {calibrations.map((calibration) => {
            const active = calibration.id === activeId
            return (
              <article key={calibration.id} className={`film-calibration-card${active ? ' active' : ''}`}>
                <div className="film-calibration-title">
                  <div>
                    <strong>{calibration.name}</strong>
                    <span>{calibration.metadata?.filmType || 'EBT3'} · lote {calibration.metadata?.lot || 'no indicado'}</span>
                  </div>
                  <span className={`film-status ${calibration.validation?.valid ? 'ok' : 'warn'}`}>
                    {calibration.validation?.valid ? 'Validación interna correcta' : 'Revisar ajuste'}
                  </span>
                </div>
                <dl className="film-calibration-meta">
                  <div><dt>Rango</dt><dd>0–{(calibration.doseRangeGy?.[1] || 0).toFixed(2)} Gy</dd></div>
                  <div><dt>Puntos</dt><dd>{calibration.points?.length || 0}</dd></div>
                  <div><dt>Escáner</dt><dd>{calibration.metadata?.scanner || '—'}</dd></div>
                  <div><dt>Actualizada</dt><dd>{dateLabel(calibration.updatedAt)}</dd></div>
                </dl>
                <div className="film-fit-mini">
                  {['R', 'G', 'B'].map((channel, index) => (
                    <span key={channel} className={`channel-${channel.toLowerCase()}`}>
                      {channel}: R² {calibration.fits[index].r2.toFixed(4)} · RMSE {(calibration.validation.doseRmseGy[index] * 100).toFixed(1)} cGy
                    </span>
                  ))}
                </div>
                <div className="film-card-actions">
                  <button type="button" className="film-button" onClick={() => onUse(calibration.id)} disabled={active}>
                    <i className={`bi ${active ? 'bi-check-circle' : 'bi-play-circle'}`} /> {active ? 'En uso' : 'Usar'}
                  </button>
                  <button type="button" className="film-icon-button" title="Exportar" onClick={() => downloadFilmCalibration(calibration)}><i className="bi bi-download" /></button>
                  <button type="button" className="film-icon-button" title="Duplicar" onClick={() => onDuplicate(calibration)}><i className="bi bi-copy" /></button>
                  <button type="button" className="film-icon-button danger" title="Eliminar" onClick={() => onDelete(calibration)}><i className="bi bi-trash" /></button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
