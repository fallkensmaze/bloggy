import { useEffect, useMemo, useRef, useState } from 'react'
import { parseDICOM } from '../utils/dicomParser'
import {
  LIMIT_PROFILES,
  NO_LIMIT_PROFILE,
  calculateNEMAComparison,
  describeResolution,
  detectLimitProfile,
  getLimitProfile
} from '../utils/nemaAlgorithms'
import { STATES, evaluateAcquisition } from '../utils/nemaAcquisition'
import { renderCanvas } from '../utils/canvasRenderer'
import { readJson, writeValue } from '../utils/localSettings'
import '../styles/uniformidad.css'

const DECLARATION_KEY = 'unif_declaracion_fisico'

const RESOLUTION_OPTIONS = [
  { value: '78', label: 'Bloque hacia 78 x 78 px' },
  { value: 'auto', label: 'Auto NEMA 6,4 mm' },
  { value: '64', label: 'Bloque hacia 64 x 64 px' },
  { value: '128', label: 'Bloque hacia 128 x 128 px' },
  { value: '0', label: 'Sin remuestreo' }
]

const EMPTY_DECLARATION = {
  radionuclide: '',
  energyWindow: '',
  sourceDistanceCm: '',
  distanceConfirmed: false,
  countRateCps: '',
  uniformityCorrection: '',
  collimatorRemoved: '',
  deviations: ''
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} %` : 'Sin dato'
}

function formatShape(rows, cols) {
  return `${rows} x ${cols} px`
}

function formatBBox(bbox) {
  if (!bbox) return 'Sin dato'
  return `filas ${bbox.minR}-${bbox.maxR}, columnas ${bbox.minC}-${bbox.maxC}`
}

function formatCount(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('es-ES') : 'Sin dato'
}

function maxDU(result, region) {
  if (!result?.available) return Number.NaN
  if (region === 'ufov') return Math.max(result.DUvertUfov, result.DUhorizUfov)
  return Math.max(result.DUvertCfov, result.DUhorizCfov)
}

function stateClass(state) {
  if (state === STATES.CONFORME) return 'unif-state-ok'
  if (state === STATES.NO_CONFORME) return 'unif-state-fail'
  if (state === STATES.NO_VERIFICADA) return 'unif-state-warn'
  return 'unif-state-none'
}

function stateIcon(state) {
  if (state === STATES.CONFORME) return 'bi-check-circle-fill'
  if (state === STATES.NO_CONFORME) return 'bi-x-circle-fill'
  if (state === STATES.NO_VERIFICADA) return 'bi-exclamation-circle-fill'
  return 'bi-dash-circle-fill'
}

function checkPill(status) {
  if (status === 'ok') return { text: 'Cumple', className: 'unif-state-ok' }
  if (status === 'fail') return { text: 'Incumple', className: 'unif-state-fail' }
  if (status === 'unknown') return { text: 'Sin verificar', className: 'unif-state-warn' }
  return { text: 'Informativo', className: 'unif-state-none' }
}

function describeOption(parsedDICOM, option) {
  if (!parsedDICOM) return null
  const info = describeResolution(
    parsedDICOM.frames[0],
    parsedDICOM.rows,
    parsedDICOM.cols,
    parsedDICOM.pixelSpacing,
    option.value
  )
  const tolerance = info.pixelTolerance
  const pixelText = tolerance
    ? `${tolerance.finalPixel[0].toFixed(2)} x ${tolerance.finalPixel[1].toFixed(2)} mm`
    : 'sin PixelSpacing'
  const problems = []

  if (!tolerance) problems.push('no evaluable sin PixelSpacing')
  else {
    if (!tolerance.square) problems.push('pixel no cuadrado')
    if (!tolerance.insideTolerance) problems.push('fuera de 4,48-8,32 mm')
  }
  if (!info.enoughCounts) {
    problems.push(`${formatCount(info.centerCounts)} cuentas en el centro, por debajo de ${formatCount(info.minCountsRequired)}`)
  }

  return {
    ...info,
    pixelText,
    problems,
    summary: `bloque ${info.blockSize.join(' x ')} -> ${formatShape(info.matrix[0], info.matrix[1])}, ${pixelText}${problems.length ? ' - no apto NEMA' : ''}`
  }
}

function UniformidadGamma() {
  const [buffer, setBuffer] = useState(null)
  const [parsedDICOM, setParsedDICOM] = useState(null)
  const [fileName, setFileName] = useState('')
  const [targetSize, setTargetSize] = useState('78')
  const [profileChoice, setProfileChoice] = useState('auto')
  const [fovOrder, setFovOrder] = useState('auto')
  const [declaration, setDeclaration] = useState(EMPTY_DECLARATION)
  const [status, setStatus] = useState('Carga un archivo DICOM de flood intrinseco para comenzar')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)

  const fileInputRef = useRef()

  useEffect(() => {
    setDeclaration({ ...EMPTY_DECLARATION, ...readJson(DECLARATION_KEY, {}) })
  }, [])

  const updateDeclaration = (patch) => {
    setDeclaration((previous) => {
      const next = { ...previous, ...patch }
      writeValue(DECLARATION_KEY, next)
      return next
    })
    setResults(null)
  }

  const profile = useMemo(() => {
    if (!parsedDICOM) return NO_LIMIT_PROFILE
    if (profileChoice === 'auto') return detectLimitProfile(parsedDICOM)
    return getLimitProfile(profileChoice)
  }, [parsedDICOM, profileChoice])

  const detectedProfile = useMemo(
    () => (parsedDICOM ? detectLimitProfile(parsedDICOM) : NO_LIMIT_PROFILE),
    [parsedDICOM]
  )

  const resolutionOptions = useMemo(
    () => RESOLUTION_OPTIONS.map((option) => ({ option, info: describeOption(parsedDICOM, option) })),
    [parsedDICOM]
  )

  const selectedResolution = resolutionOptions.find(({ option }) => option.value === targetSize)?.info

  const readBuffer = (arrayBuffer, name, order) => {
    const parsed = parseDICOM(arrayBuffer, { fovOrder: order === 'auto' ? undefined : order })
    setParsedDICOM(parsed)
    setFileName(name)
    setResults(null)

    const heads = parsed.frameInfo
      .map((info) => (info.detectorNumber != null ? `detector ${info.detectorNumber}` : 'sin identificar'))
      .join(', ')
    setStatus(`DICOM cargado: ${parsed.numFrames} frame${parsed.numFrames > 1 ? 's' : ''} (${heads}).`)
    return parsed
  }

  const handleFileSelect = (file) => {
    if (!file) return
    setStatus('Leyendo archivo DICOM...')
    setLoading(true)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        setBuffer(e.target.result)
        readBuffer(e.target.result, file.name, fovOrder)
      } catch (err) {
        setBuffer(null)
        setParsedDICOM(null)
        setStatus('Error al parsear el DICOM: ' + err.message)
      } finally {
        setLoading(false)
      }
    }
    reader.onerror = () => {
      setStatus('Error al leer el archivo.')
      setLoading(false)
    }
    reader.readAsArrayBuffer(file)
  }

  const handleFovOrderChange = (value) => {
    setFovOrder(value)
    setResults(null)
    if (!buffer) return
    try {
      readBuffer(buffer, fileName, value)
    } catch (err) {
      setStatus('Error al reinterpretar el DICOM: ' + err.message)
    }
  }

  const handleCalculate = () => {
    if (!parsedDICOM) return

    setStatus('Calculando uniformidad por las dos vias...')
    setLoading(true)

    setTimeout(() => {
      try {
        const frameResults = parsedDICOM.frames.map((rawData, index) => {
          const info = parsedDICOM.frameInfo[index]
          const comparison = calculateNEMAComparison(rawData, parsedDICOM.rows, parsedDICOM.cols, {
            targetSize,
            pixelSpacingMm: parsedDICOM.pixelSpacing,
            ufovSizeMm: info.ufovSizeMm,
            vendorFovMm: profile.fovMm,
            cropActive: false
          })
          const evaluation = evaluateAcquisition({
            parsed: parsedDICOM,
            frame: info,
            result: comparison.geometric,
            profile,
            declaration
          })
          return { frameIndex: index, info, comparison, evaluation }
        })

        setResults(frameResults)
        const states = frameResults.map(({ info, evaluation }) => (
          `detector ${info.detectorNumber ?? info.frameIndex + 1}: ${evaluation.state}`
        ))
        setStatus(`Calculo completado. ${states.join(' | ')}.`)
      } catch (err) {
        setStatus('Error durante el calculo: ' + err.message)
        console.error(err)
      } finally {
        setLoading(false)
      }
    }, 50)
  }

  return (
    <div className="page-body" style={{ maxWidth: '1160px' }}>
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-grid-1x2-fill"></i></div>
        <h1 className="page-title">Uniformidad Intrinseca NEMA</h1>
        <p className="page-subtitle">NEMA NU 1-2007 y aproximacion Pylinac/IAEA para flood intrinseco de gammacamara</p>
      </div>

      <div className="calc-card" style={{ marginBottom: '20px' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dcm,.dicom,application/dicom"
          style={{ display: 'none' }}
          onChange={(e) => handleFileSelect(e.target.files[0])}
        />

        <div
          className="unif-dropzone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            e.currentTarget.classList.add('unif-dropzone-active')
          }}
          onDragLeave={(e) => e.currentTarget.classList.remove('unif-dropzone-active')}
          onDrop={(e) => {
            e.preventDefault()
            e.currentTarget.classList.remove('unif-dropzone-active')
            handleFileSelect(e.dataTransfer.files[0])
          }}
        >
          <i className="bi bi-file-medical"></i>
          <strong>Arrastra el archivo DICOM aqui</strong>
          <span>o haz clic para seleccionar - flood intrinseco (.dcm)</span>
        </div>

        {parsedDICOM && (
          <div className="unif-file">
            <i className="bi bi-file-earmark-check"></i>
            {fileName} - {formatShape(parsedDICOM.rows, parsedDICOM.cols)} - {parsedDICOM.numFrames} frame{parsedDICOM.numFrames > 1 ? 's' : ''}
            {parsedDICOM.pixelSpacing && (
              <span> - PixelSpacing {parsedDICOM.pixelSpacing.map((v) => v.toFixed(3)).join(' x ')} mm</span>
            )}
            {parsedDICOM.ufovSizeMm && (
              <span> - UFOV {parsedDICOM.ufovSizeMm.map((v) => v.toFixed(1)).join(' x ')} mm</span>
            )}
            {parsedDICOM.manufacturer && <span> - {parsedDICOM.manufacturer} {parsedDICOM.modelName}</span>}
          </div>
        )}

        {parsedDICOM?.warnings?.map((warning) => (
          <div className="unif-notice" key={warning}>
            <i className="bi bi-exclamation-triangle"></i>
            <span>{warning}</span>
          </div>
        ))}

        <div className="unif-grid">
          <div>
            <label className="field-label">Frames DICOM</label>
            <div className="dark-input" style={{ opacity: parsedDICOM ? 1 : 0.65 }}>
              {parsedDICOM ? `Todos (${parsedDICOM.numFrames})` : 'Todos'}
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="unif-resolution">Resolucion de analisis</label>
            <select
              id="unif-resolution"
              className="dark-select"
              value={targetSize}
              onChange={(e) => {
                setTargetSize(e.target.value)
                setResults(null)
              }}
            >
              {resolutionOptions.map(({ option, info }) => (
                <option key={option.value} value={option.value}>
                  {option.label}{info ? ` - ${info.summary}` : ''}
                </option>
              ))}
            </select>
            {selectedResolution && (
              <small className={`unif-hint${selectedResolution.problems.length ? ' unif-hint-bad' : ''}`}>
                Matriz real {formatShape(selectedResolution.matrix[0], selectedResolution.matrix[1])} con bloque{' '}
                {selectedResolution.blockSize.join(' x ')}; pixel efectivo {selectedResolution.pixelText};{' '}
                {formatCount(selectedResolution.centerCounts)} cuentas en el pixel central.
                {selectedResolution.problems.length
                  ? ` No apto para NEMA: ${selectedResolution.problems.join('; ')}.`
                  : ' Cumple el intervalo 4,48-8,32 mm y el minimo de cuentas.'}
              </small>
            )}
          </div>

          <div>
            <label className="field-label" htmlFor="unif-profile">Perfil de limites</label>
            <select
              id="unif-profile"
              className="dark-select"
              value={profileChoice}
              onChange={(e) => {
                setProfileChoice(e.target.value)
                setResults(null)
              }}
            >
              <option value="auto">Automatico por equipo</option>
              {LIMIT_PROFILES.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
              <option value="none">Sin perfil (solo valores NEMA)</option>
            </select>
            <small className="unif-hint">
              {profileChoice === 'auto'
                ? (detectedProfile.id === 'none'
                  ? 'El equipo del DICOM no coincide con ningun perfil: se informaran los valores NEMA sin veredicto.'
                  : `Detectado: ${detectedProfile.label}.`)
                : `Seleccionado a mano: ${profile.label}.`}
              {' '}{profile.source}{profile.version !== '-' ? ` (version ${profile.version})` : ''}.
            </small>
          </div>

          <div>
            <label className="field-label" htmlFor="unif-fov">Orden de FieldOfViewDimensions</label>
            <select
              id="unif-fov"
              className="dark-select"
              value={fovOrder}
              onChange={(e) => handleFovOrderChange(e.target.value)}
            >
              <option value="auto">Automatico (medido en la imagen)</option>
              <option value="standard">Estandar PS3.3 [filas, columnas]</option>
              <option value="swapped">Invertido [columnas, filas]</option>
            </select>
            {parsedDICOM?.fov && (
              <small className="unif-hint">
                Almacenado {parsedDICOM.fov.raw.join(' x ')} mm; se usa{' '}
                {parsedDICOM.fov.dimensionsMm.map((v) => v.toFixed(0)).join(' x ')} mm (orden{' '}
                {parsedDICOM.fov.order === 'swapped' ? 'invertido' : 'estandar'}, decidido por{' '}
                {parsedDICOM.fov.decidedBy.replace('_', ' ')}
                {Number.isFinite(parsedDICOM.fov.deviation)
                  ? `, desviacion ${(parsedDICOM.fov.deviation * 100).toFixed(1)} %`
                  : ''}
                ).
              </small>
            )}
          </div>
        </div>

        <details className="unif-declaration" style={{ marginTop: '18px' }}>
          <summary>Declaracion del fisico (lo que el DICOM no dice)</summary>
          <div className="unif-grid">
            <label>
              <span className="field-label">Radionucleido</span>
              <input
                className="dark-input"
                value={declaration.radionuclide}
                placeholder={parsedDICOM?.radionuclide || 'Tc-99m'}
                onChange={(e) => updateDeclaration({ radionuclide: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">Ventana energetica</span>
              <input
                className="dark-input"
                value={declaration.energyWindow}
                placeholder={parsedDICOM?.frameInfo?.[0]?.energyWindowName || '140 keV +-15 %'}
                onChange={(e) => updateDeclaration({ energyWindow: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">Distancia fuente-detector (cm)</span>
              <input
                className="dark-input"
                inputMode="decimal"
                value={declaration.sourceDistanceCm}
                onChange={(e) => updateDeclaration({ sourceDistanceCm: e.target.value })}
              />
            </label>
            <div className="unif-check-inline">
              <input
                id="unif-distance-ok"
                type="checkbox"
                checked={declaration.distanceConfirmed}
                onChange={(e) => updateDeclaration({ distanceConfirmed: e.target.checked })}
              />
              <label htmlFor="unif-distance-ok">Confirmo distancia mayor o igual a 5 veces el UFOV</label>
            </div>
            <label>
              <span className="field-label">Tasa de cuentas (cps)</span>
              <input
                className="dark-input"
                inputMode="decimal"
                value={declaration.countRateCps}
                placeholder={Number.isFinite(parsedDICOM?.actualFrameDurationMs) ? 'Se calcula del DICOM' : ''}
                onChange={(e) => updateDeclaration({ countRateCps: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">Correccion de uniformidad</span>
              <input
                className="dark-input"
                value={declaration.uniformityCorrection}
                placeholder={parsedDICOM?.correctedImage?.join(', ') || 'aplicada / no aplicada'}
                onChange={(e) => updateDeclaration({ uniformityCorrection: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">Colimador retirado</span>
              <select
                className="dark-select"
                value={declaration.collimatorRemoved}
                onChange={(e) => updateDeclaration({ collimatorRemoved: e.target.value })}
              >
                <option value="">Sin declarar</option>
                <option value="si">Si, adquisicion intrinseca</option>
                <option value="no">No, habia colimador</option>
              </select>
            </label>
            <label>
              <span className="field-label">Desviaciones del procedimiento</span>
              <input
                className="dark-input"
                value={declaration.deviations}
                onChange={(e) => updateDeclaration({ deviations: e.target.value })}
              />
            </label>
          </div>
          <p>
            Se guarda en este navegador para no repetirla en cada flood. Solo se usa para las
            comprobaciones que el DICOM no permite resolver; los campos que si vienen en el
            fichero se leen de el y no hace falta rellenarlos.
          </p>
        </details>

        <button className="unif-run" onClick={handleCalculate} disabled={!parsedDICOM || loading}>
          <i className="bi bi-play-fill"></i>&nbsp; Calcular todos los frames por las dos vias
        </button>

        <div className="unif-status">
          {loading ? <span className="unif-spinner"></span> : <i className="bi bi-info-circle"></i>}
          <span>{status}</span>
        </div>
      </div>

      {results?.map((frameResult) => (
        <FrameResultsBlock key={frameResult.frameIndex} {...frameResult} parsedDICOM={parsedDICOM} />
      ))}

      {results?.length > 0 && (
        <div className="unif-copy-row">
          <CopyButton label="Copiar NEMA geometrico" build={() => buildTable(results, 'geometric')} />
          <CopyButton label="Copiar Pylinac/IAEA" build={() => buildTable(results, 'pylinac')} />
          <CopyButton
            label="Copiar trazabilidad"
            build={() => buildTraceability(results, parsedDICOM)}
          />
        </div>
      )}

      <CalculationMethodDetails />
    </div>
  )
}

function CalculationMethodDetails() {
  const comparisonRows = [
    {
      aspect: 'Remuestreo',
      nema: 'Suma bloques de píxeles para obtener un píxel de análisis próximo a 6,4 mm.',
      pylinac: 'Agrupa por potencias de 2 hasta alcanzar un píxel de al menos 4,48 mm.'
    },
    {
      aspect: 'Origen del UFOV',
      nema: 'Usa el UFOV geométrico declarado en el DICOM o en el perfil del equipo; si falta, lo estima y lo advierte.',
      pylinac: 'Detecta el campo directamente en la imagen mediante umbral y conserva la mayor región conexa.'
    },
    {
      aspect: 'Definición de UFOV y CFOV',
      nema: 'El CFOV es el 75 % central de cada dimensión lineal del UFOV geométrico original.',
      pylinac: 'Erosiona isotrópicamente el campo detectado: 95 % para UFOV y 71,25 % para CFOV.'
    },
    {
      aspect: 'Tratamiento del borde',
      nema: 'Aplica una sola vez la regla del 75 % en las filas y columnas exteriores, y excluye ceros y vecinos directos.',
      pylinac: 'Aplica un umbral global, elimina objetos y huecos pequeños y erosiona la máscara; no usa la regla de borde NEMA.'
    },
    {
      aspect: 'Suavizado',
      nema: 'Se realiza después de definir los píxeles válidos y se normaliza con los vecinos que permanecen en la máscara.',
      pylinac: 'Se realiza antes de extraer el campo y el borde exterior de la matriz se fuerza a cero.'
    },
    {
      aspect: 'Uso del resultado',
      nema: 'Es la vía principal para informar IU/DU y compararlas con el perfil de límites del equipo.',
      pylinac: 'Es una comprobación independiente. Sus valores no establecen conformidad NEMA.'
    }
  ]

  return (
    <section className="calc-card unif-methodology" aria-labelledby="unif-method-title">
      <div className="unif-methodology-title">
        <span className="unif-methodology-icon"><i className="bi bi-journal-text"></i></span>
        <div>
          <h2 id="unif-method-title">Método de cálculo</h2>
          <p>
            Cada frame se analiza por dos vías. Ambas calculan la uniformidad integral y
            diferencial, pero no seleccionan los mismos píxeles; por eso sus resultados pueden
            ser distintos incluso partiendo de la misma imagen.
          </p>
        </div>
      </div>

      <div className="unif-methodology-grid">
        <article className="unif-methodology-card unif-methodology-card-primary">
          <div className="unif-methodology-card-head">
            <span>Vía principal</span>
            <h3>NEMA NU 1-2007 geométrico</h3>
          </div>
          <ol>
            <li>
              <strong>Preparación.</strong> Se suman bloques de píxeles para aproximar el píxel de
              análisis a 6,4 mm. La web comprueba el tamaño efectivo y las cuentas disponibles.
            </li>
            <li>
              <strong>Campos de visión.</strong> El UFOV se centra usando sus dimensiones físicas.
              El CFOV ocupa el 75 % central de cada dimensión del UFOV geométrico, sin redefinirlo
              a partir de un borde defectuoso.
            </li>
            <li>
              <strong>Regla de borde.</strong> Sobre los datos sin suavizar se calcula la media del
              CFOV. En una única pasada se excluyen los píxeles exteriores por debajo del 75 % de
              esa media, los píxeles originalmente a cero y sus cuatro vecinos directos. Si un
              bloque sumado contenía un cero, conserva esa marca para no reintroducirlo.
            </li>
            <li>
              <strong>Suavizado.</strong> Se aplica una vez el núcleo NEMA de nueve puntos
              <span className="unif-kernel">1-2-1 / 2-4-2 / 1-2-1</span>, normalizado sobre los
              píxeles válidos.
            </li>
            <li>
              <strong>Medidas.</strong> La IU usa el máximo y el mínimo de toda la región. La DU
              busca la peor ventana de cinco píxeles contiguos, por separado en sentido horizontal
              y vertical, tanto en UFOV como en CFOV.
            </li>
          </ol>
        </article>

        <article className="unif-methodology-card">
          <div className="unif-methodology-card-head">
            <span>Vía de contraste</span>
            <h3>Aproximación Pylinac/IAEA</h3>
          </div>
          <ol>
            <li>
              <strong>Preparación.</strong> El binning se duplica progresivamente hasta que el píxel
              efectivo alcanza al menos 4,48 mm.
            </li>
            <li>
              <strong>Suavizado y umbral.</strong> Se aplica el mismo núcleo de nueve puntos. Se
              calcula la media de los píxeles por encima del 10 % del máximo y se fija el umbral de
              campo en el 75 % de esa media.
            </li>
            <li>
              <strong>Máscara automática.</strong> Se eliminan objetos y huecos pequeños y se conserva
              la mayor región conexa. El UFOV y el CFOV se obtienen por erosión isotrópica hasta el
              95 % y el 71,25 % del campo detectado, respectivamente.
            </li>
            <li>
              <strong>Medidas.</strong> Sobre esas máscaras se aplican las mismas fórmulas de IU y DU
              que en la vía principal.
            </li>
          </ol>
          <p className="unif-methodology-note">
            Esta vía es una implementación aproximada de contraste: no ejecuta la biblioteca
            Pylinac ni reproduce la geometría de borde de NEMA NU 1-2007.
          </p>
        </article>
      </div>

      <div className="unif-formulas" aria-label="Formulas de uniformidad">
        <div>
          <span>Uniformidad integral</span>
          <strong>IU (%) = 100 x (Cmax - Cmin) / (Cmax + Cmin)</strong>
          <small>Cmax y Cmin se buscan en todos los píxeles válidos de la región.</small>
        </div>
        <div>
          <span>Uniformidad diferencial</span>
          <strong>DU (%) = max [100 x (Cmax,5 - Cmin,5) / (Cmax,5 + Cmin,5)]</strong>
          <small>El máximo se obtiene entre todas las ventanas válidas de cinco píxeles.</small>
        </div>
      </div>

      <h3 className="unif-comparison-title">Diferencia entre los dos métodos</h3>
      <div className="unif-table-wrap">
        <table className="unif-table unif-comparison-table">
          <thead>
            <tr>
              <th>Aspecto</th>
              <th>NEMA geométrico</th>
              <th>Aproximación Pylinac/IAEA</th>
            </tr>
          </thead>
          <tbody>
            {comparisonRows.map((row) => (
              <tr key={row.aspect}>
                <td><strong>{row.aspect}</strong></td>
                <td>{row.nema}</td>
                <td>{row.pylinac}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="unif-methodology-conclusion">
        <i className="bi bi-info-circle"></i>
        <p>
          <strong>Cómo interpretar una discrepancia:</strong> normalmente se debe a que cada vía
          incluye un borde y una matriz de análisis diferentes, no a que la fórmula de IU o DU
          cambie. Para el veredicto se usa el método NEMA geométrico junto con la validez de la
          adquisición y los límites específicos del equipo; la segunda vía sirve para detectar
          dependencias del resultado con la segmentación del campo.
        </p>
      </div>
    </section>
  )
}

function buildTable(results, methodKey) {
  const fmt = (value) => (Number.isFinite(value) ? value.toFixed(2).replace('.', ',') : '')
  const rows = results
    .map(({ frameIndex, info, comparison }) => {
      const result = comparison[methodKey]
      if (!result?.available) return null
      const du = (region) => Math.max(result[`DUvert${region}`], result[`DUhoriz${region}`])
      return [
        `H${info.detectorNumber ?? frameIndex + 1}`,
        fmt(du('Cfov')),
        fmt(du('Ufov')),
        fmt(result.IUcfov),
        fmt(result.IUufov)
      ].join('\t')
    })
    .filter(Boolean)

  if (!rows.length) return ''
  return [['Uniformidad', 'UDCC', 'UDCT', 'UICC', 'UICT'].join('\t'), ...rows].join('\n')
}

function buildTraceability(results, parsedDICOM) {
  const lines = []

  for (const { info, comparison, evaluation } of results) {
    const metadata = comparison.geometric.metadata || {}
    lines.push(`Detector ${info.detectorNumber ?? info.frameIndex + 1} - ${evaluation.state}`)
    lines.push(`  Motivo: ${evaluation.reason}`)
    lines.push(`  Metodo: ${metadata.methodVersion} (${metadata.method})`)
    lines.push(`  Equipo: ${parsedDICOM.manufacturer} ${parsedDICOM.modelName} [${parsedDICOM.softwareVersions.join(' | ')}]`)
    lines.push(`  Perfil de limites: ${evaluation.profile?.label} - ${evaluation.profile?.source}`)
    lines.push(`  Pixel original: ${parsedDICOM.pixelSpacing?.map((v) => v.toFixed(3)).join(' x ') || 'sin dato'} mm`)
    lines.push(`  Pixel de analisis: ${metadata.pixelSpacingResampledMm?.map((v) => v.toFixed(2)).join(' x ') || 'sin dato'} mm (bloque ${metadata.blockSize?.join(' x ')})`)
    lines.push(`  Matriz de analisis: ${metadata.resampledShape?.join(' x ')}`)
    lines.push(`  UFOV: ${metadata.ufovSource} ${formatBBox(metadata.ufovBBoxInitial)}`)
    lines.push(`  CFOV: ${formatBBox(metadata.cfovBBoxFinal)}`)
    lines.push(`  Pixeles eliminados: umbral ${metadata.nRemovedByThreshold}, cero o contaminado ${metadata.nRemovedZeroOrContaminated}, vecindad ${metadata.nRemovedByNeighbour}`)
    lines.push(`  Pixeles validos: UFOV ${metadata.nUfovPixelsValid}, CFOV ${metadata.nCfovPixelsValid}`)
    lines.push(`  Ventana: ${info.energyWindowName || 'sin dato'}`)

    for (const row of evaluation.comparison) {
      lines.push(`  ${row.label}: ${row.value.toFixed(2)} % (limite ${row.limit} %)`)
    }
    for (const item of evaluation.checks) {
      lines.push(`  [${item.status}] ${item.label}: ${item.value}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function CopyButton({ label, build }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const text = build()
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button onClick={handleCopy} className={copied ? 'unif-copied' : ''}>
      {copied ? 'Copiado' : label}
    </button>
  )
}

function FrameResultsBlock({ frameIndex, info, comparison, evaluation, parsedDICOM }) {
  const canvasOrigRef = useRef()
  const canvasGeoUFOVRef = useRef()
  const canvasGeoCFOVRef = useRef()
  const canvasPyUFOVRef = useRef()
  const canvasPyCFOVRef = useRef()

  useEffect(() => {
    if (!comparison) return

    if (canvasOrigRef.current) {
      renderCanvas(canvasOrigRef.current, comparison.input.data, null, comparison.input.rows, comparison.input.cols)
    }
    if (comparison.geometric.available) {
      if (canvasGeoUFOVRef.current) {
        renderCanvas(canvasGeoUFOVRef.current, comparison.geometric.ufovData, comparison.geometric.ufovMask, comparison.geometric.rows, comparison.geometric.cols)
      }
      if (canvasGeoCFOVRef.current) {
        renderCanvas(canvasGeoCFOVRef.current, comparison.geometric.cfovData, comparison.geometric.cfovMask, comparison.geometric.rows, comparison.geometric.cols)
      }
    }
    if (comparison.pylinac.available) {
      if (canvasPyUFOVRef.current) {
        renderCanvas(canvasPyUFOVRef.current, comparison.pylinac.ufovData, comparison.pylinac.ufovMask, comparison.pylinac.rows, comparison.pylinac.cols)
      }
      if (canvasPyCFOVRef.current) {
        renderCanvas(canvasPyCFOVRef.current, comparison.pylinac.cfovData, comparison.pylinac.cfovMask, comparison.pylinac.rows, comparison.pylinac.cols)
      }
    }
  }, [comparison])

  const detectorLabel = info.detectorNumber != null
    ? `Detector ${info.detectorNumber}`
    : `Frame ${frameIndex + 1}`
  const windowLabel = info.energyWindowName
    ? `${info.energyWindowName} - ${info.energyWindowLowerLimit.toFixed(1)} a ${info.energyWindowUpperLimit.toFixed(1)} keV`
    : 'Ventana energetica sin identificar'

  return (
    <div style={{ marginBottom: '28px' }}>
      <div className="unif-frame-head">
        <div>
          <h2>{detectorLabel}</h2>
          <small>{windowLabel} - {formatShape(comparison.input.rows, comparison.input.cols)}</small>
        </div>
        <span className={`unif-state ${stateClass(evaluation.state)}`}>
          <i className={`bi ${stateIcon(evaluation.state)}`}></i>
          {evaluation.state}
        </span>
      </div>

      <p className="unif-reason">{evaluation.reason}</p>

      <div className="unif-images">
        <ImagePanel label="Imagen analizada" canvasRef={canvasOrigRef} subtitle={`${formatShape(comparison.input.rows, comparison.input.cols)} - ${detectorLabel.toLowerCase()}`} />
        {comparison.geometric.available && (
          <>
            <ImagePanel label="NEMA UFOV" canvasRef={canvasGeoUFOVRef} subtitle="Mascara del metodo geometrico" />
            <ImagePanel label="NEMA CFOV" canvasRef={canvasGeoCFOVRef} subtitle="75 % central del UFOV geometrico" />
          </>
        )}
        {comparison.pylinac.available && (
          <>
            <ImagePanel label="Pylinac UFOV" canvasRef={canvasPyUFOVRef} subtitle="Erosion del campo util" />
            <ImagePanel label="Pylinac CFOV" canvasRef={canvasPyCFOVRef} subtitle="Campo central erosionado" />
          </>
        )}
      </div>

      <NemaResults result={comparison.geometric} evaluation={evaluation} />
      <AcquisitionChecks evaluation={evaluation} />
      <TraceabilityPanel
        info={info}
        comparison={comparison}
        evaluation={evaluation}
        parsedDICOM={parsedDICOM}
      />
      <PylinacResults result={comparison.pylinac} />
    </div>
  )
}

function NemaResults({ result, evaluation }) {
  if (!result?.available) {
    return (
      <div className="calc-card" style={{ marginBottom: '20px' }}>
        <div className="unif-section-title">NEMA geometrico</div>
        <div style={{ fontSize: '13px', color: 'var(--accent-red)' }}>{result?.error}</div>
      </div>
    )
  }

  const profile = evaluation.profile
  const hasSpecs = Boolean(profile?.specs)
  const metadata = result.metadata || {}

  return (
    <div className="calc-card" style={{ marginBottom: '20px' }}>
      <div className="unif-method-head">
        <div>
          <h3>Metodo NEMA NU 1-2007 estricto</h3>
          <p>
            {formatShape(result.rows, result.cols)} - bloque {metadata.blockSize?.join(' x ')} - pixel{' '}
            {metadata.pixelSpacingResampledMm?.map((v) => v.toFixed(2)).join(' x ')} mm - UFOV {metadata.ufovSource}
          </p>
        </div>
        <div className="unif-profile-tag">
          {hasSpecs ? profile.label : 'Sin perfil de limites'}
          <br />
          {profile?.source}
        </div>
      </div>

      <div className="unif-metrics">
        <Metric label="IU UFOV" value={result.IUufov} limit={hasSpecs ? profile.specs.IUufov : null} />
        <Metric label="IU CFOV" value={result.IUcfov} limit={hasSpecs ? profile.specs.IUcfov : null} />
        <Metric label="DU UFOV" value={maxDU(result, 'ufov')} limit={hasSpecs ? profile.specs.DUufov : null} />
        <Metric label="DU CFOV" value={maxDU(result, 'cfov')} limit={hasSpecs ? profile.specs.DUcfov : null} />
      </div>

      <div className="unif-table-wrap">
        <table className="unif-table">
          <thead>
            <tr>
              <th>Parametro</th>
              <th>Region</th>
              <th>Valor</th>
              <th>Limite del perfil</th>
              <th>Comparacion</th>
            </tr>
          </thead>
          <tbody>
            {[
              { param: 'Uniformidad integral (IU)', region: 'UFOV', value: result.IUufov, key: 'IUufov' },
              { param: 'Uniformidad integral (IU)', region: 'CFOV', value: result.IUcfov, key: 'IUcfov' },
              { param: 'Uniformidad diferencial vertical', region: 'UFOV', value: result.DUvertUfov, key: 'DUufov' },
              { param: 'Uniformidad diferencial horizontal', region: 'UFOV', value: result.DUhorizUfov, key: 'DUufov' },
              { param: 'Uniformidad diferencial vertical', region: 'CFOV', value: result.DUvertCfov, key: 'DUcfov' },
              { param: 'Uniformidad diferencial horizontal', region: 'CFOV', value: result.DUhorizCfov, key: 'DUcfov' }
            ].map((row, index) => {
              const limit = hasSpecs ? profile.specs[row.key] : null
              const within = limit != null && Number.isFinite(row.value) ? row.value <= limit : null
              return (
                <tr key={index}>
                  <td>{row.param}</td>
                  <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{row.region}</td>
                  <td className="unif-num">{formatPercent(row.value)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {limit != null ? `<= ${limit.toFixed(1)} %` : 'Sin perfil'}
                  </td>
                  <td>
                    <span className={`unif-pill ${within === null ? 'unif-state-none' : within ? 'unif-state-ok' : 'unif-state-fail'}`}>
                      {within === null ? 'Sin limite' : within ? 'Dentro' : 'Fuera'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AcquisitionChecks({ evaluation }) {
  return (
    <div className="calc-card" style={{ marginBottom: '20px' }}>
      <div className="unif-section-title">Validez de la adquisicion</div>
      <div className="unif-table-wrap">
        <table className="unif-table">
          <thead>
            <tr>
              <th>Requisito</th>
              <th>Valor</th>
              <th>Estado</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {evaluation.checks.map((item) => {
              const pill = checkPill(item.status)
              return (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td className="unif-num">{item.value}</td>
                  <td><span className={`unif-pill ${pill.className}`}>{pill.text}</span></td>
                  <td className="unif-detail">{item.detail}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TraceabilityPanel({ info, comparison, evaluation, parsedDICOM }) {
  const metadata = comparison.geometric.metadata || {}
  const rows = [
    ['Metodo y version', `${metadata.method} - ${metadata.methodVersion}`],
    ['Equipo', `${parsedDICOM.manufacturer} ${parsedDICOM.modelName}`],
    ['Software', parsedDICOM.softwareVersions.join(' | ') || 'Sin dato'],
    ['Transfer syntax', parsedDICOM.transferSyntaxUID || 'Implicit VR Little Endian'],
    ['Bits', `${parsedDICOM.bitsStored} de ${parsedDICOM.bitsAllocated} (high bit ${parsedDICOM.highBit}, ${parsedDICOM.pixelRepresentation === 1 ? 'con signo' : 'sin signo'})`],
    ['Pixel original', parsedDICOM.pixelSpacing ? `${parsedDICOM.pixelSpacing.map((v) => v.toFixed(3)).join(' x ')} mm` : 'Sin dato'],
    ['Pixel de analisis', metadata.pixelSpacingResampledMm ? `${metadata.pixelSpacingResampledMm.map((v) => v.toFixed(2)).join(' x ')} mm` : 'Sin dato'],
    ['Bloque de suma', metadata.blockSize?.join(' x ') || 'Sin dato'],
    ['Matriz de analisis', metadata.resampledShape ? formatShape(metadata.resampledShape[0], metadata.resampledShape[1]) : 'Sin dato'],
    ['Origen del UFOV', metadata.ufovSource || 'Sin dato'],
    ['UFOV geometrico', formatBBox(metadata.ufovBBoxInitial)],
    ['UFOV valido', formatBBox(metadata.ufovBBoxFinal)],
    ['CFOV', formatBBox(metadata.cfovBBoxFinal)],
    ['FOV almacenado', parsedDICOM.fov ? `${parsedDICOM.fov.raw.join(' x ')} mm, orden ${parsedDICOM.fov.order === 'swapped' ? 'invertido' : 'estandar'}` : 'Sin dato'],
    ['Umbral de borde', `${formatCount(metadata.edgeThreshold)} cuentas (75 % de ${formatCount(metadata.cfovMeanRaw)})`],
    ['Eliminados por umbral', formatCount(metadata.nRemovedByThreshold)],
    ['Eliminados por cero o bloque contaminado', formatCount(metadata.nRemovedZeroOrContaminated)],
    ['Eliminados por vecindad', formatCount(metadata.nRemovedByNeighbour)],
    ['Bloques contaminados en el UFOV', formatCount(metadata.nZeroContaminatedInUfov)],
    ['Pixeles validos UFOV / CFOV', `${formatCount(metadata.nUfovPixelsValid)} / ${formatCount(metadata.nCfovPixelsValid)}`],
    ['Cuentas pixel central', formatCount(metadata.centerCountResampled)],
    ['Cuentas maximas en CFOV', formatCount(metadata.maxCountCfov)],
    ['Detector y ventana', `${info.detectorNumber != null ? `Detector ${info.detectorNumber}` : 'Sin identificar'} - ${info.energyWindowName || 'sin ventana'}`],
    ['Colimador', info.collimatorType || 'Sin dato'],
    ['Correcciones', parsedDICOM.correctedImage.join(', ') || 'Sin dato'],
    ['Perfil de limites', `${evaluation.profile?.label} (${evaluation.profile?.source})`],
    ['Estado final', evaluation.state]
  ]

  // Ningun aviso calculado debe quedarse sin salir por algun sitio.
  if (metadata.ufovFromImage) {
    rows.splice(11, 0, ['Aviso', 'El UFOV no viene del DICOM: se ha estimado por isolinea sobre la propia imagen.'])
  }
  if (metadata.fallbackReason) {
    rows.splice(11, 0, ['Aviso', `Se recurrio al UFOV automatico: ${metadata.fallbackReason}`])
  }

  return (
    <details className="calc-card unif-trace" style={{ marginBottom: '20px' }}>
      <summary>Trazabilidad del calculo</summary>
      <dl>
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

function PylinacResults({ result }) {
  if (!result) return null

  return (
    <div className="calc-card" style={{ marginBottom: '20px' }}>
      <div className="unif-method-head">
        <div>
          <h3>Aproximacion Pylinac/IAEA</h3>
          <p>
            Segunda via de contraste. No implementa la geometria de NU 1-2007: halla el campo por
            umbral y erosion isotropica en vez de por el UFOV declarado, y no aplica la regla de
            borde de la norma. Sus numeros no declaran conformidad NEMA.
          </p>
        </div>
      </div>

      {!result.available ? (
        <div style={{ fontSize: '13px', color: 'var(--accent-red)' }}>{result.error}</div>
      ) : (
        <div className="unif-table-wrap">
          <table className="unif-table">
            <thead>
              <tr>
                <th>Parametro</th>
                <th>UFOV</th>
                <th>CFOV</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Uniformidad integral (IU)</td>
                <td className="unif-num">{formatPercent(result.IUufov)}</td>
                <td className="unif-num">{formatPercent(result.IUcfov)}</td>
              </tr>
              <tr>
                <td>Uniformidad diferencial maxima</td>
                <td className="unif-num">{formatPercent(maxDU(result, 'ufov'))}</td>
                <td className="unif-num">{formatPercent(maxDU(result, 'cfov'))}</td>
              </tr>
              <tr>
                <td>Matriz y binning</td>
                <td className="unif-detail" colSpan={2}>
                  {formatShape(result.rows, result.cols)} con bin {result.metadata?.binSize}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, limit }) {
  const within = limit != null && Number.isFinite(value) ? value <= limit : null

  return (
    <div className="unif-metric">
      <span>{label}</span>
      <strong>{Number.isFinite(value) ? value.toFixed(2) : '--'}</strong>
      <small>
        {limit != null ? `limite ${limit.toFixed(1)} %` : 'sin limite aplicable'}
      </small>
      <span className={`unif-pill ${within === null ? 'unif-state-none' : within ? 'unif-state-ok' : 'unif-state-fail'}`} style={{ marginTop: '8px' }}>
        {within === null ? 'Sin limite' : within ? 'Dentro' : 'Fuera'}
      </span>
    </div>
  )
}

function ImagePanel({ label, canvasRef, subtitle }) {
  const icon = label.includes('Imagen')
    ? 'bi-image'
    : label.includes('UFOV') ? 'bi-bounding-box' : 'bi-bounding-box-circles'

  return (
    <div className="unif-image">
      <h4><i className={`bi ${icon}`}></i>&nbsp; {label}</h4>
      <canvas ref={canvasRef} />
      <small>{subtitle}</small>
    </div>
  )
}

export default UniformidadGamma
