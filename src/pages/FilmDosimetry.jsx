import { useEffect, useMemo, useState } from 'react'
import CalibrationLibrary from '../components/film/CalibrationLibrary.jsx'
import CalibrationWizard from '../components/film/CalibrationWizard.jsx'
import FilmAnalysis from '../components/film/FilmAnalysis.jsx'
import {
  deleteFilmCalibration,
  getActiveCalibrationId,
  listFilmCalibrations,
  saveFilmCalibration,
  setActiveCalibrationId
} from '../utils/filmStorage.js'
import '../styles/film-dosimetry.css'

function newIdentifier() {
  return globalThis.crypto?.randomUUID?.() || `film-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export default function FilmDosimetry() {
  const [calibrations, setCalibrations] = useState([])
  const [activeId, setActiveId] = useState('')
  const [view, setView] = useState('library')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const activeCalibration = useMemo(
    () => calibrations.find((calibration) => calibration.id === activeId) || null,
    [activeId, calibrations]
  )

  const refresh = async (preferredId) => {
    const records = await listFilmCalibrations()
    const storedId = preferredId ?? getActiveCalibrationId()
    const nextId = records.some((record) => record.id === storedId) ? storedId : (records[0]?.id || '')
    setCalibrations(records)
    setActiveId(nextId)
    setActiveCalibrationId(nextId)
    return records
  }

  useEffect(() => {
    refresh()
      .catch((exception) => setError(exception.message))
      .finally(() => setLoading(false))
  }, [])

  const saveCalibration = async (calibration) => {
    setError('')
    try {
      const saved = await saveFilmCalibration(calibration)
      await refresh(saved.id)
      setView('library')
    } catch (exception) {
      setError(exception.message)
      throw exception
    }
  }

  const useCalibration = (id) => {
    setActiveId(id)
    setActiveCalibrationId(id)
  }

  const duplicateCalibration = async (calibration) => {
    const now = new Date().toISOString()
    await saveCalibration({
      ...structuredClone(calibration),
      id: newIdentifier(),
      name: `${calibration.name} (copia)`,
      createdAt: now,
      updatedAt: now
    })
  }

  const importCalibration = async (calibration) => {
    const now = new Date().toISOString()
    const imported = calibrations.some((record) => record.id === calibration.id)
      ? { ...calibration, id: newIdentifier(), name: `${calibration.name} (importada)`, createdAt: now, updatedAt: now }
      : { ...calibration, updatedAt: now }
    await saveCalibration(imported)
  }

  const removeCalibration = async (calibration) => {
    if (!window.confirm(`¿Eliminar “${calibration.name}” de este navegador? Esta acción no se puede deshacer.`)) return
    setError('')
    try {
      await deleteFilmCalibration(calibration.id)
      await refresh(calibration.id === activeId ? '' : activeId)
    } catch (exception) {
      setError(exception.message)
    }
  }

  return (
    <div className="page film-page">
      <header className="film-hero">
        <div>
          <span className="film-eyebrow">Dosimetría de película radiocrómica</span>
          <h1>Análisis multicanal EBT3</h1>
          <p>Calibra con escaneos TIFF RGB de 16 bits por canal, calcula mapas de dosis y expórtalos como DICOM RT Dose.</p>
        </div>
        {activeCalibration && <div className="film-active-badge"><i className="bi bi-check-circle" /><span>Calibración activa</span><strong>{activeCalibration.name}</strong></div>}
      </header>

      <div className="film-privacy">
        <i className="bi bi-shield-check" />
        <div><strong>Procesamiento local</strong><span>Las imágenes, calibraciones y DICOM se procesan en tu navegador y no se envían al servidor.</span></div>
      </div>

      <div className="film-clinical-warning">
        <i className="bi bi-exclamation-diamond" />
        <span>Herramienta de apoyo técnico. Verifica el procedimiento, la calibración y la geometría DICOM conforme al programa de garantía de calidad antes de cualquier uso clínico.</span>
      </div>

      <nav className="film-tabs" aria-label="Secciones de dosimetría de película">
        <button type="button" className={`film-tab${view === 'library' || view === 'wizard' ? ' active' : ''}`} onClick={() => setView('library')}>
          <i className="bi bi-sliders" /> Calibraciones <span>{calibrations.length}</span>
        </button>
        <button type="button" className={`film-tab${view === 'analysis' ? ' active' : ''}`} onClick={() => setView('analysis')}>
          <i className="bi bi-grid-3x3" /> Analizar
        </button>
      </nav>

      {error && <div className="film-alert error"><i className="bi bi-exclamation-triangle" />{error}</div>}
      {loading ? (
        <div className="film-loading"><i className="bi bi-arrow-repeat spin" /> Cargando calibraciones…</div>
      ) : view === 'wizard' ? (
        <CalibrationWizard onCancel={() => setView('library')} onSave={saveCalibration} />
      ) : view === 'analysis' ? (
        <FilmAnalysis calibration={activeCalibration} />
      ) : (
        <CalibrationLibrary
          calibrations={calibrations}
          activeId={activeId}
          onUse={useCalibration}
          onDelete={removeCalibration}
          onDuplicate={duplicateCalibration}
          onImport={importCalibration}
          onCreate={() => setView('wizard')}
        />
      )}
    </div>
  )
}
