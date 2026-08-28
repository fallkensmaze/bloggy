import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FDTD_PRESETS, parseFdtdConfig, sanitizeFdtdConfig, serializeFdtdConfig } from '../utils/fdtdConfig'
import { loadFdtdBackend } from '../utils/fdtdBackend'
import { renderFdtdFrame } from '../utils/fdtdRenderer'
import '../styles/fdtd.css'

const COURANT = 0.99 / Math.SQRT2

function FdtdSimulator() {
  const initial = useMemo(() => sanitizeFdtdConfig(FDTD_PRESETS.halfWave), [])
  const [config, setConfig] = useState(initial)
  const [appliedConfig, setAppliedConfig] = useState(initial)
  const [presetId, setPresetId] = useState('halfWave')
  const [running, setRunning] = useState(false)
  const [backend, setBackend] = useState('Cargando…')
  const [backendReady, setBackendReady] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState({ steps: 0, energy: 0 })
  const [recording, setRecording] = useState(false)
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const simulationRef = useRef(null)
  const geometryRef = useRef({ metal: null, material: null })
  const backendRef = useRef(null)
  const animationRef = useRef(0)
  const scaleRef = useRef(0.08)
  const frameRef = useRef(0)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])

  const draw = useCallback(() => {
    const simulation = simulationRef.current
    const canvas = canvasRef.current
    if (!simulation || !canvas) return
    scaleRef.current = renderFdtdFrame(
      canvas,
      simulation.field_snapshot(),
      geometryRef.current.metal,
      geometryRef.current.material,
      simulation.nx(),
      simulation.ny(),
      appliedConfig.absorberCells,
      scaleRef.current
    )
  }, [appliedConfig.absorberCells])

  const createSimulation = useCallback((nextConfig) => {
    if (!backendRef.current) return
    const safe = sanitizeFdtdConfig(nextConfig)
    const { Simulation } = backendRef.current
    simulationRef.current = new Simulation(
      safe.nx,
      safe.ny,
      safe.wavelengthCells,
      safe.dipoleFraction,
      safe.absorberCells,
      safe.absorberStrength,
      safe.sourceType === 'pulse' ? 1 : 0,
      safe.sourceAmplitude,
      safe.dielectric
    )
    geometryRef.current = {
      metal: simulationRef.current.metal_snapshot(),
      material: simulationRef.current.material_snapshot()
    }
    setAppliedConfig(safe)
    setConfig(safe)
    setStats({ steps: 0, energy: 0 })
    setRunning(false)
    setError('')
    scaleRef.current = 0.08
    requestAnimationFrame(() => {
      const simulation = simulationRef.current
      const canvas = canvasRef.current
      if (!simulation || !canvas) return
      scaleRef.current = renderFdtdFrame(
        canvas,
        simulation.field_snapshot(),
        geometryRef.current.metal,
        geometryRef.current.material,
        simulation.nx(),
        simulation.ny(),
        safe.absorberCells,
        scaleRef.current
      )
    })
  }, [])

  useEffect(() => {
    let active = true
    loadFdtdBackend().then(result => {
      if (!active) return
      backendRef.current = result
      setBackend(result.label)
      setBackendReady(true)
      createSimulation(initial)
    }).catch(loadError => {
      if (active) setError(`No se pudo iniciar el simulador: ${loadError.message}`)
    })
    return () => { active = false }
  }, [createSimulation, initial])

  useEffect(() => {
    if (!running) {
      cancelAnimationFrame(animationRef.current)
      return undefined
    }

    const tick = () => {
      const simulation = simulationRef.current
      if (!simulation) return
      simulation.step(appliedConfig.stepsPerFrame)
      draw()
      frameRef.current += 1
      if (frameRef.current % 5 === 0) {
        setStats({ steps: simulation.step_count(), energy: simulation.energy() })
      }
      animationRef.current = requestAnimationFrame(tick)
    }
    animationRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationRef.current)
  }, [appliedConfig.stepsPerFrame, draw, running])

  useEffect(() => () => {
    cancelAnimationFrame(animationRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const changeConfig = (field, value) => {
    setPresetId('custom')
    setConfig(current => ({ ...current, [field]: value }))
  }

  const choosePreset = (id) => {
    const preset = FDTD_PRESETS[id]
    if (!preset) return
    setPresetId(id)
    const next = sanitizeFdtdConfig(preset)
    setConfig(next)
    if (backendReady) createSimulation(next)
  }

  const reset = () => createSimulation(config)

  const singleFrame = () => {
    const simulation = simulationRef.current
    if (!simulation) return
    simulation.step(appliedConfig.stepsPerFrame)
    draw()
    setStats({ steps: simulation.step_count(), energy: simulation.energy() })
  }

  const downloadConfig = () => {
    const blob = new Blob([serializeFdtdConfig(config)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'fdtd-dipolo.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const loadConfig = async (file) => {
    if (!file) return
    try {
      const next = parseFdtdConfig(await file.text())
      setPresetId('custom')
      setConfig(next)
      createSimulation(next)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const downloadSnapshot = () => {
    const anchor = document.createElement('a')
    anchor.download = `fdtd-dipolo-paso-${stats.steps}.png`
    anchor.href = canvasRef.current.toDataURL('image/png')
    anchor.click()
  }

  const toggleRecording = () => {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    const canvas = canvasRef.current
    if (!canvas?.captureStream || typeof MediaRecorder === 'undefined') {
      setError('Este navegador no permite grabar el canvas como vídeo.')
      return
    }
    const stream = canvas.captureStream(30)
    const preferred = 'video/webm;codecs=vp9'
    const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    chunksRef.current = []
    recorder.ondataavailable = event => {
      if (event.data.size) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'fdtd-dipolo.webm'
      anchor.click()
      URL.revokeObjectURL(url)
      stream.getTracks().forEach(track => track.stop())
      setRecording(false)
    }
    recorderRef.current = recorder
    recorder.start(500)
    setRecording(true)
    setRunning(true)
  }

  const periods = stats.steps * COURANT / appliedConfig.wavelengthCells
  const dipoleCells = Math.round(appliedConfig.wavelengthCells * appliedConfig.dipoleFraction)

  return (
    <div className="page-body fdtd-page">
      <div className="fdtd-heading">
        <div>
          <span className="fdtd-kicker">Laboratorio electromagnético</span>
          <h1>Simulador FDTD · dipolo</h1>
          <p>Propagación TEz sobre una malla de Yee, calculada enteramente en tu navegador.</p>
        </div>
        <div className={`fdtd-engine ${backend.includes('Rust') ? 'ready' : ''}`}>
          <span className="fdtd-engine-dot" />
          <div><small>Núcleo de cálculo</small><strong>{backend}</strong></div>
        </div>
      </div>

      {error && <div className="fdtd-alert" role="alert">{error}</div>}

      <div className="fdtd-workbench">
        <aside className="fdtd-controls" aria-label="Configuración de la simulación">
          <div className="fdtd-control-section">
            <label className="field-label" htmlFor="fdtd-preset">Configuración precargada</label>
            <select id="fdtd-preset" className="dark-select" value={presetId} onChange={event => choosePreset(event.target.value)}>
              {Object.values(FDTD_PRESETS).map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              {presetId === 'custom' && <option value="custom">Configuración personalizada</option>}
            </select>
            <p className="fdtd-control-help">{config.description || 'Parámetros cargados desde un archivo JSON.'}</p>
          </div>

          <div className="fdtd-control-section fdtd-grid-fields">
            <label><span>Longitud de onda</span><input type="number" value={config.wavelengthCells} min="16" max="100" onChange={e => changeConfig('wavelengthCells', e.target.value)} /><small>celdas / λ</small></label>
            <label><span>Longitud del dipolo</span><input type="number" value={config.dipoleFraction} min="0.1" max="0.95" step="0.01" onChange={e => changeConfig('dipoleFraction', e.target.value)} /><small>fracción de λ</small></label>
            <label><span>Capa absorbente</span><input type="number" value={config.absorberCells} min="6" max="48" onChange={e => changeConfig('absorberCells', e.target.value)} /><small>celdas</small></label>
            <label><span>Pasos por fotograma</span><input type="number" value={config.stepsPerFrame} min="1" max="16" onChange={e => changeConfig('stepsPerFrame', e.target.value)} /><small>Δt / frame</small></label>
          </div>

          <div className="fdtd-control-section">
            <span className="field-label">Excitación</span>
            <div className="fdtd-segmented">
              <button className={config.sourceType === 'continuous' ? 'active' : ''} onClick={() => changeConfig('sourceType', 'continuous')}>Continua</button>
              <button className={config.sourceType === 'pulse' ? 'active' : ''} onClick={() => changeConfig('sourceType', 'pulse')}>Pulso</button>
            </div>
            <label className="fdtd-check"><input type="checkbox" checked={config.dielectric} onChange={e => changeConfig('dielectric', e.target.checked)} /><span>Bloque dieléctrico εr = 4</span></label>
          </div>

          <button className="fdtd-apply" onClick={reset} disabled={!backendReady}><i className="bi bi-arrow-repeat" /> Aplicar y reiniciar</button>

          <div className="fdtd-file-actions">
            <button onClick={downloadConfig}><i className="bi bi-download" /> Guardar JSON</button>
            <button onClick={() => fileInputRef.current?.click()}><i className="bi bi-upload" /> Cargar JSON</button>
            <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={e => loadConfig(e.target.files?.[0])} />
          </div>
        </aside>

        <section className="fdtd-stage">
          <div className="fdtd-canvas-wrap">
            <canvas ref={canvasRef} width="960" height="600" aria-label="Campo magnético Hz propagado por el dipolo" />
            <div className="fdtd-overlay top-left"><strong>H<sub>z</sub></strong><span>azul − / naranja +</span></div>
            <div className="fdtd-overlay top-right"><span>línea discontinua</span><strong>fin de absorbente</strong></div>
            {recording && <div className="fdtd-recording"><span /> REC</div>}
          </div>

          <div className="fdtd-transport">
            <button className="fdtd-play" onClick={() => setRunning(value => !value)} disabled={!backendReady} aria-label={running ? 'Pausar simulación' : 'Iniciar simulación'}>
              <i className={`bi ${running ? 'bi-pause-fill' : 'bi-play-fill'}`} />
            </button>
            <button onClick={singleFrame} disabled={!backendReady || running}><i className="bi bi-skip-forward-fill" /> Paso</button>
            <button onClick={() => createSimulation(appliedConfig)} disabled={!backendReady}><i className="bi bi-arrow-counterclockwise" /> Reiniciar</button>
            <span className="fdtd-transport-spacer" />
            <button onClick={downloadSnapshot}><i className="bi bi-camera" /> PNG</button>
            <button className={recording ? 'danger' : ''} onClick={toggleRecording}><i className={`bi ${recording ? 'bi-stop-fill' : 'bi-record-circle'}`} /> {recording ? 'Detener' : 'Grabar WebM'}</button>
          </div>

          <div className="fdtd-metrics">
            <div><span>Tiempo simulado</span><strong>{periods.toFixed(2)} T</strong></div>
            <div><span>Paso temporal</span><strong>{stats.steps.toLocaleString('es-ES')}</strong></div>
            <div><span>Energía relativa</span><strong>{stats.energy.toExponential(2)}</strong></div>
            <div><span>Dipolo discretizado</span><strong>{dipoleCells} celdas</strong></div>
          </div>
        </section>
      </div>

      <section className="fdtd-notes">
        <div><span>01</span><h2>Qué se está calculando</h2><p>La malla TEz evoluciona E<sub>x</sub>, E<sub>y</sub> y H<sub>z</sub> mediante diferencias centrales escalonadas. Los brazos amarillos se tratan como conductor perfecto y la separación central recibe la excitación.</p></div>
        <div><span>02</span><h2>Frontera absorbente</h2><p>La franja exterior aplica una pérdida gradual polinómica para reducir las reflexiones. Es una “esponja” absorbente, no una CPML formal; por eso esta primera versión es cualitativa.</p></div>
        <div><span>03</span><h2>Límite del modelo</h2><p>Es una sección bidimensional: permite estudiar propagación, polarización, interferencia y materiales, pero no calcula todavía la impedancia ni el diagrama 3D real de un dipolo finito.</p></div>
      </section>
    </div>
  )
}

export default FdtdSimulator
