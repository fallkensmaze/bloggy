import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  RadialLinearScale,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
} from 'chart.js'
import { Line, Radar } from 'react-chartjs-2'
import FdtdField3D from '../components/fdtd/FdtdField3D'
import { FDTD_PRESETS, parseFdtdConfig, sanitizeFdtdConfig, serializeFdtdConfig } from '../utils/fdtdConfig'
import { EMPTY_FDTD_ANALYSIS, readFdtdAnalysis } from '../utils/fdtdAnalysis'
import { loadFdtdBackend } from '../utils/fdtdBackend'
import { renderFdtdFrame } from '../utils/fdtdRenderer'
import '../styles/fdtd.css'

const C_METRES_PER_MICROSECOND = 299.792458
const ANGLES = Array.from({ length: 72 }, (_, index) => index * 5)
const FIELD_OPTIONS = {
  magnetic: { label: 'Hφ', cartesianLabel: 'Hy', method: 'magnetic_field_snapshot', volumeKind: 0 },
  ez: { label: 'Ez', cartesianLabel: 'Ez', method: 'electric_z_snapshot', volumeKind: 1 },
  er: { label: 'Er', cartesianLabel: 'Ex', method: 'electric_r_snapshot', volumeKind: 2 },
  emagnitude: { label: '|E|', cartesianLabel: '|E|', method: 'electric_magnitude_snapshot', volumeKind: 3 }
}

const referenceLinesPlugin = {
  id: 'fdtdReferenceLines',
  afterDraw(chart, _args, options) {
    if (!options?.lines?.length) return
    const { ctx, chartArea, scales } = chart
    ctx.save()
    for (const line of options.lines) {
      const scale = scales[line.axis]
      if (!scale) continue
      const pixel = scale.getPixelForValue(line.value)
      if (!Number.isFinite(pixel)) continue
      ctx.strokeStyle = line.color || '#bf616a'
      ctx.lineWidth = line.width || 1
      ctx.setLineDash(line.dash || [5, 4])
      ctx.beginPath()
      if (line.axis === 'x') {
        ctx.moveTo(pixel, chartArea.top)
        ctx.lineTo(pixel, chartArea.bottom)
      } else {
        ctx.moveTo(chartArea.left, pixel)
        ctx.lineTo(chartArea.right, pixel)
      }
      ctx.stroke()
    }
    ctx.restore()
  }
}

ChartJS.register(RadialLinearScale, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend, referenceLinesPlugin)

const signedComplex = ({ real, imag }, digits = 1) => `${real.toFixed(digits)} ${imag < 0 ? '−' : '+'} j${Math.abs(imag).toFixed(digits)}`

function FdtdSimulator() {
  const initial = useMemo(() => sanitizeFdtdConfig(FDTD_PRESETS.halfWave), [])
  const [config, setConfig] = useState(initial)
  const [appliedConfig, setAppliedConfig] = useState(initial)
  const [presetId, setPresetId] = useState('halfWave')
  const [running, setRunning] = useState(false)
  const [viewMode, setViewMode] = useState('slice')
  const [fieldKind, setFieldKind] = useState('magnetic')
  const [backend, setBackend] = useState('Cargando…')
  const [backendReady, setBackendReady] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState({ steps: 0, energy: 0 })
  const [analysis, setAnalysis] = useState(EMPTY_FDTD_ANALYSIS)
  const [recording, setRecording] = useState(false)
  const canvasRef = useRef(null)
  const field3dRef = useRef(null)
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
    if (!simulation) return
    const fieldOption = FIELD_OPTIONS[fieldKind]
    const field = simulation[fieldOption.method]()
    const cartesian = appliedConfig.antennaType === 'yagi'
    const frame = {
      field,
      metal: geometryRef.current.metal,
      material: geometryRef.current.material,
      nx: simulation.nx(),
      ny: simulation.ny(),
      absorberCells: appliedConfig.absorberCells
    }
    if (canvasRef.current) {
      scaleRef.current = renderFdtdFrame(
        canvasRef.current,
        field,
        frame.metal,
        frame.material,
        frame.nx,
        frame.ny,
        frame.absorberCells,
        scaleRef.current,
        fieldKind
      )
    }
    field3dRef.current?.render({
      ...frame,
      scale: scaleRef.current,
      fieldKind,
      symmetry: cartesian ? 'cartesian' : 'axisymmetric',
      volume: cartesian && viewMode === 'volume' ? simulation.volume_snapshot(fieldOption.volumeKind) : null,
      gridX: cartesian ? simulation.nx() : null,
      gridY: cartesian ? simulation.depth() : null,
      gridZ: cartesian ? simulation.ny() : null,
      conductorPoints: cartesian ? geometryRef.current.conductorPoints : null
    })
  }, [appliedConfig.absorberCells, appliedConfig.antennaType, fieldKind, viewMode])

  const createSimulation = useCallback((nextConfig) => {
    if (!backendRef.current) return
    const safe = sanitizeFdtdConfig(nextConfig)
    const SimulationClass = safe.antennaType === 'yagi' ? backendRef.current.Simulation3d : backendRef.current.Simulation
    simulationRef.current = new SimulationClass(
      safe.nx,
      safe.ny,
      safe.wavelengthCells,
      safe.dipoleFraction,
      safe.absorberCells,
      safe.pmlTargetReflection,
      safe.sourceType === 'pulse' ? 1 : 0,
      safe.sourceAmplitude,
      safe.dielectric,
      safe.pmlKappaMax,
      safe.pmlAlphaMax,
      safe.wireRadiusCells,
      safe.antennaType === 'monopole' ? 1 : 0
    )
    geometryRef.current = {
      metal: simulationRef.current.metal_snapshot(),
      material: simulationRef.current.material_snapshot(),
      conductorPoints: safe.antennaType === 'yagi' ? simulationRef.current.conductor_points() : null
    }
    setAppliedConfig(safe)
    setConfig(safe)
    setStats({ steps: 0, energy: 0 })
    setAnalysis(EMPTY_FDTD_ANALYSIS)
    setRunning(false)
    setError('')
    scaleRef.current = 0.08
    requestAnimationFrame(draw)
  }, [draw])

  const updateAnalysis = useCallback(() => {
    const simulation = simulationRef.current
    if (!simulation) return
    setAnalysis(readFdtdAnalysis(simulation, appliedConfig))
  }, [appliedConfig])

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
    // El backend solo se carga una vez; los reinicios posteriores usan createSimulation desde la UI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

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
      if (frameRef.current % 5 === 0) setStats({ steps: simulation.step_count(), energy: simulation.energy() })
      if (frameRef.current % 24 === 0) updateAnalysis()
      animationRef.current = requestAnimationFrame(tick)
    }
    animationRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationRef.current)
  }, [appliedConfig.stepsPerFrame, draw, running, updateAnalysis])

  useEffect(() => { requestAnimationFrame(draw) }, [draw, viewMode])
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

  const singleFrame = () => {
    const simulation = simulationRef.current
    if (!simulation) return
    simulation.step(appliedConfig.stepsPerFrame)
    draw()
    setStats({ steps: simulation.step_count(), energy: simulation.energy() })
    updateAnalysis()
  }

  const downloadConfig = () => {
    const blob = new Blob([serializeFdtdConfig(config)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `fdtd-${config.antennaType}-3d.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const loadConfig = async file => {
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

  const activeCanvas = () => viewMode === 'volume' ? field3dRef.current?.getCanvas() : canvasRef.current
  const downloadSnapshot = () => {
    const canvas = activeCanvas()
    if (!canvas) return
    const anchor = document.createElement('a')
    anchor.download = `fdtd-${appliedConfig.antennaType}-${fieldKind}-${viewMode}-paso-${stats.steps}.png`
    anchor.href = canvas.toDataURL('image/png')
    anchor.click()
  }

  const toggleRecording = () => {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    const canvas = activeCanvas()
    if (!canvas?.captureStream || typeof MediaRecorder === 'undefined') {
      setError('Este navegador no permite grabar el canvas como vídeo.')
      return
    }
    const stream = canvas.captureStream(30)
    const preferred = 'video/webm;codecs=vp9'
    const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    chunksRef.current = []
    recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `fdtd-${appliedConfig.antennaType}-${fieldKind}-${viewMode}.webm`
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

  const timeStep = simulationRef.current?.time_step?.() ?? 0.5
  const timeNs = stats.steps * timeStep * 1000 / (appliedConfig.wavelengthCells * appliedConfig.frequencyMHz)
  const wavelengthMetres = C_METRES_PER_MICROSECOND / appliedConfig.frequencyMHz
  const dipoleLengthMetres = wavelengthMetres * appliedConfig.dipoleFraction
  const cartesian = appliedConfig.antennaType === 'yagi'
  const fieldLabel = cartesian ? FIELD_OPTIONS[fieldKind].cartesianLabel : FIELD_OPTIONS[fieldKind].label
  const theoreticalDirectivity = appliedConfig.antennaType === 'monopole' && appliedConfig.dipoleFraction < 0.4
    ? 'ideal 5,15'
    : appliedConfig.antennaType === 'dipole' && Math.abs(appliedConfig.dipoleFraction - 0.47) < 0.08
      ? 'ideal 2,15'
      : ''
  const showHalfWaveReference = appliedConfig.antennaType === 'dipole' && Math.abs(appliedConfig.dipoleFraction - 0.47) < 0.08
  const impedanceReferenceLines = [
    { axis: 'x', value: analysis.resonanceIndex, color: '#bf616a' },
    ...(showHalfWaveReference ? [{ axis: 'y', value: 73, color: '#78849a', dash: [3, 4] }] : [])
  ]
  const currentReferenceLabel = appliedConfig.antennaType === 'monopole' ? 'cos(πz/2L)' : 'cos(πz/L)'
  const resonanceIndex = analysis.resonanceIndex
  const polarData = {
    labels: ANGLES.map(angle => `${angle}°`),
    datasets: [{
      label: 'Plano E [dB]',
      data: analysis.patternDb,
      borderColor: '#88c0d0',
      backgroundColor: 'rgba(136, 192, 208, 0.13)',
      pointRadius: 0,
      borderWidth: 2,
      fill: true
    }]
  }
  const timeData = {
    labels: analysis.timeNs.map(value => value.toFixed(2)),
    datasets: [
      { label: 'V / |V|max', data: analysis.voltage, borderColor: '#ebcb8b', pointRadius: 0, borderWidth: 1.5 },
      { label: 'I / |I|max', data: analysis.current, borderColor: '#88c0d0', pointRadius: 0, borderWidth: 1.5 }
    ]
  }
  const impedanceData = {
    labels: analysis.frequencyMHz.map(value => value.toFixed(2)),
    datasets: [
      { label: 'Rin [Ω]', data: analysis.resistance.map(value => Math.abs(value) <= 2000 ? value : null), borderColor: '#a3be8c', pointRadius: 0, borderWidth: 2 },
      { label: 'Xin [Ω]', data: analysis.reactance.map(value => Math.abs(value) <= 2000 ? value : null), borderColor: '#ebcb8b', pointRadius: 0, borderWidth: 2 }
    ]
  }
  const s11Data = {
    labels: analysis.frequencyMHz.map(value => value.toFixed(2)),
    datasets: [{ label: '|S11| [dB] · 50 Ω', data: analysis.s11, borderColor: '#bf616a', backgroundColor: 'rgba(191,97,106,.12)', pointRadius: 0, borderWidth: 2, fill: true }]
  }
  const currentData = {
    labels: analysis.currentPosition.map(value => value.toFixed(3)),
    datasets: [
      { label: '|I(z)| FDTD', data: analysis.currentProfile, borderColor: '#88c0d0', pointRadius: 0, borderWidth: 2 },
      { label: currentReferenceLabel, data: analysis.idealProfile, borderColor: '#78849a', borderDash: [5, 4], pointRadius: 0, borderWidth: 1.4 }
    ]
  }
  const commonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { labels: { color: '#c3ccda', boxWidth: 12, font: { size: 10 } } },
      tooltip: { intersect: false }
    },
    interaction: { mode: 'index', intersect: false }
  }
  const cartesianScales = (xTitle, yTitle) => ({
    x: { title: { display: true, text: xTitle, color: '#78849a' }, ticks: { color: '#78849a', maxTicksLimit: 7 }, grid: { color: 'rgba(120,132,154,.1)' } },
    y: { title: { display: true, text: yTitle, color: '#78849a' }, ticks: { color: '#78849a' }, grid: { color: 'rgba(120,132,154,.15)' } }
  })

  return (
    <div className="page-body fdtd-page">
      <div className="fdtd-heading">
        <div>
          <span className="fdtd-kicker">Laboratorio electromagnético</span>
          <h1>Simulador FDTD · antenas 3D</h1>
          <p>FDTD 3D cilíndrica o cartesiana según la antena, con campos navegables y análisis de puerto en el navegador.</p>
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
            <label><span>Frecuencia nominal</span><input type="number" value={config.frequencyMHz} min="0.1" max="100000" step="0.1" onChange={e => changeConfig('frequencyMHz', e.target.value)} /><small>MHz</small></label>
            <label><span>Resolución</span><input type="number" value={config.wavelengthCells} min="18" max="100" onChange={e => changeConfig('wavelengthCells', e.target.value)} /><small>celdas / λ</small></label>
            <label><span>Longitud del elemento</span><input type="number" value={config.dipoleFraction} min="0.1" max="1.8" step="0.01" disabled={config.antennaType === 'yagi'} onChange={e => changeConfig('dipoleFraction', e.target.value)} /><small>fracción de λ₀</small></label>
            <label><span>Radio del hilo</span><input type="number" value={config.wireRadiusCells} min="1" max="6" onChange={e => changeConfig('wireRadiusCells', e.target.value)} /><small>celdas</small></label>
            <label><span>Espesor CPML</span><input type="number" value={config.absorberCells} min="8" max="48" onChange={e => changeConfig('absorberCells', e.target.value)} /><small>celdas</small></label>
            <label><span>Pasos por fotograma</span><input type="number" value={config.stepsPerFrame} min="1" max="16" onChange={e => changeConfig('stepsPerFrame', e.target.value)} /><small>Δt / frame</small></label>
          </div>

          <div className="fdtd-control-section">
            <span className="field-label">Excitación</span>
            <div className="fdtd-segmented">
              <button className={config.sourceType === 'pulse' ? 'active' : ''} onClick={() => changeConfig('sourceType', 'pulse')}>Pulso</button>
              <button className={config.sourceType === 'continuous' ? 'active' : ''} onClick={() => changeConfig('sourceType', 'continuous')}>Continua</button>
            </div>
            {config.antennaType !== 'yagi' && <label className="fdtd-check"><input type="checkbox" checked={config.dielectric} onChange={e => changeConfig('dielectric', e.target.checked)} /><span>Anillo dieléctrico εr = 4</span></label>}
          </div>

          <button className="fdtd-apply" onClick={() => createSimulation(config)} disabled={!backendReady}><i className="bi bi-arrow-repeat" /> Aplicar y reiniciar</button>
          <div className="fdtd-file-actions">
            <button onClick={downloadConfig}><i className="bi bi-download" /> Guardar JSON</button>
            <button onClick={() => fileInputRef.current?.click()}><i className="bi bi-upload" /> Cargar JSON</button>
            <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={e => loadConfig(e.target.files?.[0])} />
          </div>
        </aside>

        <section className="fdtd-stage">
          <div className="fdtd-view-toolbar" role="group" aria-label="Vista del campo">
            <button className={viewMode === 'slice' ? 'active' : ''} onClick={() => setViewMode('slice')}><i className="bi bi-grid-3x3" /> Corte 2D</button>
            <button className={viewMode === 'volume' ? 'active' : ''} onClick={() => setViewMode('volume')}><i className="bi bi-box" /> Volumen 3D</button>
            <div className="fdtd-field-selector" role="group" aria-label="Componente del campo">
              {Object.entries(FIELD_OPTIONS).map(([key, option]) => <button key={key} className={fieldKind === key ? 'active' : ''} onClick={() => setFieldKind(key)}>{cartesian ? option.cartesianLabel : option.label}</button>)}
            </div>
            <span>{viewMode === 'slice' ? 'Plano central x–z' : cartesian ? 'Malla cartesiana completa' : 'Revolución alrededor del eje'}</span>
          </div>
          <div className={`fdtd-canvas-wrap ${viewMode !== 'slice' ? 'fdtd-view-hidden' : ''}`}>
            <canvas ref={canvasRef} width="960" height="600" aria-label={`Corte central del campo ${fieldLabel}`} />
            <div className="fdtd-overlay top-left"><strong>{fieldLabel}</strong><span>{fieldKind === 'emagnitude' ? 'magnitud eléctrica' : 'azul − / naranja +'}</span></div>
            <div className="fdtd-overlay top-right"><span>línea discontinua</span><strong>interfaz CPML</strong></div>
          </div>
          <div className={`fdtd-canvas-wrap ${viewMode !== 'volume' ? 'fdtd-view-hidden' : ''}`}>
            <FdtdField3D ref={field3dRef} absorberCells={appliedConfig.absorberCells} />
          </div>
          {recording && <div className="fdtd-recording fdtd-recording-stage"><span /> REC</div>}

          <div className="fdtd-transport">
            <button className="fdtd-play" onClick={() => setRunning(value => !value)} disabled={!backendReady} aria-label={running ? 'Pausar simulación' : 'Iniciar simulación'}><i className={`bi ${running ? 'bi-pause-fill' : 'bi-play-fill'}`} /></button>
            <button onClick={singleFrame} disabled={!backendReady || running}><i className="bi bi-skip-forward-fill" /> Paso</button>
            <button onClick={() => createSimulation(appliedConfig)} disabled={!backendReady}><i className="bi bi-arrow-counterclockwise" /> Reiniciar</button>
            <span className="fdtd-transport-spacer" />
            <button onClick={downloadSnapshot}><i className="bi bi-camera" /> PNG</button>
            <button className={recording ? 'danger' : ''} onClick={toggleRecording}><i className={`bi ${recording ? 'bi-stop-fill' : 'bi-record-circle'}`} /> {recording ? 'Detener' : 'Grabar WebM'}</button>
          </div>

          <div className="fdtd-metrics">
            <div><span>Tiempo simulado</span><strong>{timeNs.toFixed(2)} ns</strong></div>
            <div><span>Longitud física</span><strong>{dipoleLengthMetres >= 1 ? `${dipoleLengthMetres.toFixed(3)} m` : `${(dipoleLengthMetres * 100).toFixed(2)} cm`}</strong></div>
            <div><span>Energía relativa</span><strong>{stats.energy.toExponential(2)}</strong></div>
            <div><span>{cartesian ? 'Malla cartesiana' : 'Malla axisimétrica'}</span><strong>{cartesian ? `${appliedConfig.nx} × ${appliedConfig.nx} × ${appliedConfig.ny}` : `${Math.floor(appliedConfig.nx / 2) + 1} × ${appliedConfig.ny}`}</strong></div>
          </div>
        </section>
      </div>

      <section className="fdtd-result-strip" aria-label="Resultados principales">
        <div><span>Resonancia estimada</span><strong>{analysis.ready ? `${analysis.resonanceMHz.toFixed(2)} MHz` : 'Acumulando…'}</strong></div>
        <div><span>L / λres</span><strong>{analysis.ready ? analysis.lengthOverLambda.toFixed(3) : '—'}</strong></div>
        <div><span>Zin en resonancia</span><strong>{analysis.ready ? `${signedComplex(analysis.resonanceImpedance)} Ω` : '—'}</strong></div>
        <div><span>Zin en f₀</span><strong>{analysis.ready ? `${signedComplex(analysis.nominalImpedance)} Ω` : '—'}</strong></div>
        <div><span>Directividad</span><strong>{analysis.ready ? `${analysis.directivityDb.toFixed(2)} dBi` : '—'} {theoreticalDirectivity && <small>{theoreticalDirectivity}</small>}</strong></div>
      </section>

      {appliedConfig.sourceType !== 'pulse' && <div className="fdtd-analysis-notice"><i className="bi bi-info-circle" /> Para obtener el espectro completo de impedancia y S11 utiliza la excitación por pulso. Con onda continua solo es fiable el entorno de f₀.</div>}
      {cartesian && <div className="fdtd-analysis-notice"><i className="bi bi-info-circle" /> La Yagi usa el núcleo cartesiano 3D experimental. Refina la malla y aumenta el tiempo antes de utilizar Zin o la directividad como valores cuantitativos.</div>}

      <section className="fdtd-analysis-grid" aria-label="Caracterización de la antena">
        <article className="fdtd-analysis-card">
          <div className="fdtd-analysis-heading"><div><span>Dominio temporal</span><h2>Puerto de alimentación</h2></div><strong>V(t) · I(t)</strong></div>
          <div className="fdtd-chart"><Line data={timeData} options={{ ...commonChartOptions, scales: cartesianScales('Tiempo [ns]', 'Amplitud normalizada') }} /></div>
          <p>Las señales se normalizan por separado porque la amplitud de la fuente es arbitraria. El final del registro permite comprobar que el pulso y el timbre han decaído antes de interpretar la FFT.</p>
        </article>

        <article className="fdtd-analysis-card">
          <div className="fdtd-analysis-heading"><div><span>Puerto calibrado</span><h2>Impedancia de entrada</h2></div><strong>{analysis.ready ? `${signedComplex(analysis.resonanceImpedance)} Ω` : 'Acumulando…'}</strong></div>
          <div className="fdtd-chart"><Line data={impedanceData} options={{ ...commonChartOptions, plugins: { ...commonChartOptions.plugins, fdtdReferenceLines: { lines: impedanceReferenceLines } }, scales: cartesianScales('Frecuencia [MHz]', 'Impedancia [Ω]') }} /></div>
          <p>Zin = Ṽ/Ĩ. La línea roja marca el mínimo de |X| con señal suficiente.{showHalfWaveReference ? ' La línea de 73 Ω es la referencia del dipolo ideal infinitamente fino de media onda.' : ''}</p>
        </article>

        <article className="fdtd-analysis-card">
          <div className="fdtd-analysis-heading"><div><span>Referencia 50 Ω</span><h2>Coeficiente de reflexión</h2></div><strong>{analysis.ready ? `${analysis.s11[resonanceIndex]?.toFixed(1)} dB` : 'Acumulando…'}</strong></div>
          <div className="fdtd-chart"><Line data={s11Data} options={{ ...commonChartOptions, plugins: { ...commonChartOptions.plugins, fdtdReferenceLines: { lines: [{ axis: 'x', value: resonanceIndex, color: '#bf616a' }, { axis: 'y', value: -10, color: '#ebcb8b' }] } }, scales: cartesianScales('Frecuencia [MHz]', '|S11| [dB]') }} /></div>
          <p>Se calcula directamente como 20 log₁₀ |(Zin − 50)/(Zin + 50)|. Resonancia y adaptación no son necesariamente la misma frecuencia.</p>
        </article>

        <article className="fdtd-analysis-card">
          <div className="fdtd-analysis-heading"><div><span>Corriente superficial</span><h2>Distribución sobre el hilo</h2></div><strong>fres</strong></div>
          <div className="fdtd-chart"><Line data={currentData} options={{ ...commonChartOptions, scales: { ...cartesianScales('z / L', '|I| normalizada'), y: { ...cartesianScales('', '|I| normalizada').y, min: 0, max: 1.08 } } }} /></div>
          <p>La corriente procede de la circulación del campo magnético alrededor del conductor. La referencia cosenoidal se adapta al dipolo o al monopolo y no se impone al cálculo.</p>
        </article>

        <article className="fdtd-analysis-card fdtd-analysis-wide">
          <div className="fdtd-analysis-heading"><div><span>Integral de radiación</span><h2>Diagrama polar del plano E</h2></div><strong>{analysis.ready ? `${analysis.directivity.toFixed(3)} · ${analysis.directivityDb.toFixed(2)} dBi` : 'Acumulando…'}</strong></div>
          <div className="fdtd-chart fdtd-polar-chart"><Radar data={polarData} options={{ ...commonChartOptions, scales: { r: { min: -40, max: 0, ticks: { color: '#78849a', stepSize: 10, backdropColor: 'transparent' }, grid: { color: 'rgba(120,132,154,.24)' }, angleLines: { color: 'rgba(120,132,154,.18)' }, pointLabels: { color: '#78849a', font: { size: 9 }, callback: (_, index) => index % 9 === 0 ? `${ANGLES[index]}°` : '' } } } }} /></div>
          <p>Escala de potencia de −40 a 0 dB. El campo lejano integra la corriente compleja de todos los elementos; la Yagi utiliza la distribución inducida calculada por la malla cartesiana 3D.</p>
        </article>
      </section>

      <section className="fdtd-notes">
        <div><span>01</span><h2>Dos núcleos 3D</h2><p>Dipolos, verticales e hilos rectos usan Er, Ez y Hφ en r–z. La Yagi cambia a Ex, Ey, Ez, Hx, Hy y Hz sobre una malla cartesiana para conservar reflector y directores como varillas.</p></div>
        <div><span>02</span><h2>Frontera abierta</h2><p>La CPML absorbe en ambos extremos de z y en el radio exterior. r = 0 es el eje de simetría y utiliza la actualización especial del operador cilíndrico.</p></div>
        <div><span>03</span><h2>Alcance del modelo</h2><p>Los resultados dependen de la resolución, el radio discretizado, el gap y el tiempo. La Yagi es más lenta; el modelo incluye cuatro elementos libres, sin boom conductor, balun, mástil ni suelo real.</p></div>
      </section>
    </div>
  )
}

export default FdtdSimulator
