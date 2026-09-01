import { useEffect, useRef, useState } from 'react'
import { makeRgbPreviewImage, readRgb16TiffFile } from '../../utils/filmTiff.js'

const DEFAULT_ROI = { mode: 'relative', x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function percentage(value) {
  return Math.round(value * 1000) / 10
}

export default function CalibrationRoiSelector({ file, enabled, roi, previewRole = 'pre', onEnabledChange, onChange }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!file) {
      setPreview(null)
      setBusy(false)
      setError('')
      return () => { cancelled = true }
    }

    setBusy(true)
    setError('')
    readRgb16TiffFile(file)
      .then((image) => {
        if (!cancelled) setPreview(makeRgbPreviewImage(image))
      })
      .catch((exception) => {
        if (!cancelled) {
          setPreview(null)
          setError(exception.message)
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })

    return () => { cancelled = true }
  }, [file])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !preview) return
    canvas.width = preview.width
    canvas.height = preview.height
    const context = canvas.getContext('2d')
    const imageData = context.createImageData(preview.width, preview.height)
    imageData.data.set(preview.rgba)
    context.putImageData(imageData, 0, 0)
  }, [preview])

  const pointFromEvent = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
      bounds
    }
  }

  const startSelection = (event) => {
    if (!enabled || !preview) return
    const point = pointFromEvent(event)
    dragRef.current = { x: point.x, y: point.y, bounds: point.bounds, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveSelection = (event) => {
    const start = dragRef.current
    if (!start) return
    const point = pointFromEvent(event)
    if (!start.moved && Math.hypot(
      (point.x - start.x) * start.bounds.width,
      (point.y - start.y) * start.bounds.height
    ) < 3) return

    start.moved = true
    const x = Math.min(start.x, point.x)
    const y = Math.min(start.y, point.y)
    const minimumWidth = 1 / preview.sourceWidth
    const minimumHeight = 1 / preview.sourceHeight
    onChange({
      mode: 'relative',
      x,
      y,
      width: Math.max(minimumWidth, Math.abs(point.x - start.x)),
      height: Math.max(minimumHeight, Math.abs(point.y - start.y))
    })
  }

  const stopSelection = (event) => {
    if (!dragRef.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }

  const updatePercent = (key, rawValue) => {
    const numeric = Number(rawValue) / 100
    if (!Number.isFinite(numeric)) return
    const minimum = 0.001
    const next = { ...roi, mode: 'relative' }
    if (key === 'x') {
      next.x = clamp(numeric, 0, 1 - minimum)
      next.width = clamp(next.width, minimum, 1 - next.x)
    } else if (key === 'y') {
      next.y = clamp(numeric, 0, 1 - minimum)
      next.height = clamp(next.height, minimum, 1 - next.y)
    } else if (key === 'width') {
      next.width = clamp(numeric, minimum, 1 - next.x)
    } else {
      next.height = clamp(numeric, minimum, 1 - next.y)
    }
    onChange(next)
  }

  return (
    <div className="film-roi-selector">
      <div className="film-roi-mode" role="group" aria-label="Zona utilizada en la calibración">
        <button type="button" className={!enabled ? 'active' : ''} onClick={() => onEnabledChange(false)}>
          <i className="bi bi-image" /> Toda la imagen
        </button>
        <button type="button" className={enabled ? 'active' : ''} onClick={() => onEnabledChange(true)}>
          <i className="bi bi-bounding-box" /> Seleccionar ROI
        </button>
      </div>

      {!enabled ? (
        <div className="film-roi-full">
          <i className="bi bi-arrows-fullscreen" />
          <div><strong>Se utilizará la imagen completa</strong><span>Todos los píxeles de cada conjunto de imágenes entrarán en el cálculo.</span></div>
        </div>
      ) : !file ? (
        <div className="film-roi-empty">
          <i className="bi bi-file-earmark-image" />
          <div><strong>Selecciona primero {previewRole === 'pre' ? 'un TIFF pre' : 'un TIFF'}</strong><span>La primera imagen disponible se usará únicamente como previsualización para dibujar la ROI.</span></div>
        </div>
      ) : busy ? (
        <div className="film-roi-empty"><i className="bi bi-arrow-repeat spin" /><span>Preparando previsualización…</span></div>
      ) : error ? (
        <div className="film-alert error"><i className="bi bi-exclamation-triangle" />{error}</div>
      ) : preview ? (
        <>
          <div className="film-roi-preview-heading">
            <span><i className="bi bi-file-earmark-image" /> {file.name}</span>
            <span>{preview.sourceWidth} × {preview.sourceHeight} px</span>
          </div>
          <div
            className="film-roi-preview"
            onPointerDown={startSelection}
            onPointerMove={moveSelection}
            onPointerUp={stopSelection}
            onPointerCancel={stopSelection}
            aria-label="Arrastra sobre la imagen para seleccionar la ROI"
          >
            <canvas ref={canvasRef} />
            <div
              className="film-roi-box"
              style={{
                left: `${roi.x * 100}%`,
                top: `${roi.y * 100}%`,
                width: `${roi.width * 100}%`,
                height: `${roi.height * 100}%`
              }}
            ><span>ROI</span></div>
          </div>
          <span className="film-roi-help">Arrastra sobre la previsualización o ajusta las coordenadas. La misma zona relativa se aplica a todos los TIFF de la calibración. El contraste automático solo afecta a la previsualización.</span>
        </>
      ) : null}

      {enabled && (
        <div className="film-roi-controls">
          <label><span>X inicial</span><input type="number" min="0" max="100" step="0.1" value={percentage(roi.x)} onChange={(event) => updatePercent('x', event.target.value)} /><small>%</small></label>
          <label><span>Y inicial</span><input type="number" min="0" max="100" step="0.1" value={percentage(roi.y)} onChange={(event) => updatePercent('y', event.target.value)} /><small>%</small></label>
          <label><span>Ancho</span><input type="number" min="0.1" max="100" step="0.1" value={percentage(roi.width)} onChange={(event) => updatePercent('width', event.target.value)} /><small>%</small></label>
          <label><span>Alto</span><input type="number" min="0.1" max="100" step="0.1" value={percentage(roi.height)} onChange={(event) => updatePercent('height', event.target.value)} /><small>%</small></label>
          <button type="button" className="film-button secondary film-roi-reset" onClick={() => onChange(DEFAULT_ROI)}><i className="bi bi-arrow-counterclockwise" /> Centrar 50 %</button>
        </div>
      )}
    </div>
  )
}
