import { useEffect, useState } from 'react'
import CalibrationRoiSelector from './CalibrationRoiSelector.jsx'

const DEFAULT_ROI = { mode: 'relative', x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

export default function CalibrationImageRois({ label, files, rois, onChange }) {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (activeIndex >= files.length) setActiveIndex(Math.max(0, files.length - 1))
  }, [activeIndex, files.length])

  if (!files.length) return null

  const activeFile = files[activeIndex]
  const activeRoi = rois[activeIndex] || null

  const updateRoi = (nextRoi) => {
    const next = Array.from({ length: files.length }, (_, index) => rois[index] || null)
    next[activeIndex] = nextRoi
    onChange(next)
  }

  return (
    <div className="film-image-rois">
      <div className="film-image-rois-heading">
        <strong>{label}</strong>
        <span>Selecciona cada TIFF y define su zona de forma independiente.</span>
      </div>
      <div className="film-image-roi-tabs" role="tablist" aria-label={`Imágenes ${label}`}>
        {files.map((file, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? 'active' : ''}
            key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
            onClick={() => setActiveIndex(index)}
          >
            <i className={rois[index] ? 'bi bi-bounding-box' : 'bi bi-image'} />
            <span>{file.name}</span>
            <small>{rois[index] ? 'ROI' : 'Completa'}</small>
          </button>
        ))}
      </div>
      <CalibrationRoiSelector
        file={activeFile}
        enabled={Boolean(activeRoi)}
        roi={activeRoi || DEFAULT_ROI}
        previewRole="imagen"
        onEnabledChange={(enabled) => updateRoi(enabled ? { ...DEFAULT_ROI } : null)}
        onChange={updateRoi}
      />
    </div>
  )
}
