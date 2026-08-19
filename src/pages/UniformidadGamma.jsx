import { useEffect, useRef, useState } from 'react'
import { parseDICOM } from '../utils/dicomParser'
import { calculateNEMAComparison, SYMBIA_INTEVO_SPECS } from '../utils/nemaAlgorithms'
import { renderCanvas } from '../utils/canvasRenderer'

const LIMITS = SYMBIA_INTEVO_SPECS

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} %` : 'Sin dato'
}

function formatShape(rows, cols) {
  return `${rows} x ${cols} px`
}

function formatBBox(bbox) {
  if (!bbox) return ''
  return `filas ${bbox.minR}-${bbox.maxR}, columnas ${bbox.minC}-${bbox.maxC}`
}

function maxDU(result, region) {
  if (!result?.available) return Number.NaN
  if (region === 'ufov') return Math.max(result.DUvertUfov, result.DUhorizUfov)
  return Math.max(result.DUvertCfov, result.DUhorizCfov)
}

function UniformidadGamma() {
  const [parsedDICOM, setParsedDICOM] = useState(null)
  const [fileName, setFileName] = useState('')
  const [targetSize, setTargetSize] = useState('78')
  const [status, setStatus] = useState('Carga un archivo DICOM de flood intrinseco para comenzar')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)

  const fileInputRef = useRef()

  const handleFileSelect = (file) => {
    if (!file) return
    setStatus('Leyendo archivo DICOM...')
    setLoading(true)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = parseDICOM(e.target.result)
        setParsedDICOM(parsed)
        setFileName(file.name)
        setResults(null)

        const spacing = parsed.pixelSpacing ? ` PixelSpacing ${parsed.pixelSpacing.map((v) => v.toFixed(3)).join(' x ')} mm.` : ''
        const fov = parsed.ufovSizeMm ? ` UFOV DICOM ${parsed.ufovSizeMm.map((v) => v.toFixed(1)).join(' x ')} mm.` : ''
        setStatus(`DICOM cargado correctamente.${spacing}${fov}`)
      } catch (err) {
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

  const handleCalculate = () => {
    if (!parsedDICOM) return

    setStatus('Calculando uniformidad por las dos vias...')
    setLoading(true)

    setTimeout(() => {
      try {
        const frameResults = parsedDICOM.frames.map((rawData, index) => ({
          frameIndex: index,
          comparison: calculateNEMAComparison(rawData, parsedDICOM.rows, parsedDICOM.cols, {
            targetSize,
            pixelSpacingMm: parsedDICOM.pixelSpacing,
            ufovSizeMm: parsedDICOM.ufovSizeMm,
            cropActive: false
          })
        }))

        setResults(frameResults)

        const first = frameResults[0]?.comparison
        const shapeMsg = first?.geometric?.available
          ? ` NEMA: ${formatShape(first.geometric.rows, first.geometric.cols)}.`
          : ''
        setStatus(`Calculo completado para ${frameResults.length} frame${frameResults.length > 1 ? 's' : ''}.${shapeMsg}`)
      } catch (err) {
        setStatus('Error durante el calculo: ' + err.message)
        console.error(err)
      } finally {
        setLoading(false)
      }
    }, 50)
  }

  const handleTargetChange = (value) => {
    setTargetSize(value)
    setResults(null)
  }

  return (
    <div className="page-body" style={{ maxWidth: '1160px' }}>
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-grid-1x2-fill"></i></div>
        <h1 className="page-title">Uniformidad Intrinseca NEMA</h1>
        <p className="page-subtitle">NEMA NU 1 y comparacion Pylinac/IAEA para flood intrinseco de gammacamara</p>
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
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            e.currentTarget.style.borderColor = 'var(--accent-blue)'
            e.currentTarget.style.background = 'rgba(136,192,208,0.05)'
          }}
          onDragLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.background = 'transparent'
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.background = 'transparent'
            handleFileSelect(e.dataTransfer.files[0])
          }}
          style={{
            border: '2px dashed var(--border)',
            borderRadius: '12px',
            padding: '44px 32px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.2s, background 0.2s'
          }}
        >
          <div style={{ fontSize: '2.8rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
            <i className="bi bi-file-medical"></i>
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '5px' }}>
            Arrastra el archivo DICOM aqui
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            o haz clic para seleccionar - flood intrinseco (.dcm)
          </div>
        </div>

        {parsedDICOM && (
          <div style={{
            display: 'block',
            marginTop: '14px',
            padding: '10px 16px',
            background: 'var(--bg-tertiary)',
            borderRadius: '8px',
            fontSize: '13px',
            color: 'var(--text-secondary)'
          }}>
            <i className="bi bi-file-earmark-check" style={{ color: 'var(--accent-green)', marginRight: '6px' }}></i>
            {fileName} - {formatShape(parsedDICOM.rows, parsedDICOM.cols)} - {parsedDICOM.numFrames} frame{parsedDICOM.numFrames > 1 ? 's' : ''}
            {parsedDICOM.pixelSpacing && (
              <span> - PixelSpacing {parsedDICOM.pixelSpacing.map((v) => v.toFixed(3)).join(' x ')} mm</span>
            )}
            {parsedDICOM.ufovSizeMm && (
              <span> - UFOV {parsedDICOM.ufovSizeMm.map((v) => v.toFixed(1)).join(' x ')} mm</span>
            )}
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '16px',
          marginTop: '18px'
        }}>
          <div>
            <label className="field-label">Frames DICOM</label>
            <div className="dark-input" style={{ opacity: parsedDICOM ? 1 : 0.65 }}>
              {parsedDICOM ? `Todos (${parsedDICOM.numFrames})` : 'Todos'}
            </div>
          </div>
          <div>
            <label className="field-label">Resolucion analisis</label>
            <select
              className="dark-select"
              value={targetSize}
              onChange={(e) => handleTargetChange(e.target.value)}
            >
              <option value="78">78 x 78 px (7.8 mm Siemens)</option>
              <option value="auto">Auto NEMA 6.4 mm</option>
              <option value="64">64 x 64 px</option>
              <option value="128">128 x 128 px</option>
              <option value="0">Sin remuestreo</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleCalculate}
          disabled={!parsedDICOM || loading}
          style={{
            width: '100%',
            marginTop: '18px',
            padding: '12px',
            background: 'var(--accent-blue)',
            color: 'var(--bg-primary)',
            border: 'none',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            cursor: parsedDICOM && !loading ? 'pointer' : 'not-allowed',
            opacity: parsedDICOM && !loading ? 1 : 0.35,
            transition: 'opacity 0.15s'
          }}
        >
          <i className="bi bi-play-fill"></i>&nbsp; Calcular todos los frames por las dos vias
        </button>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '12px',
          padding: '9px 14px',
          background: 'var(--bg-tertiary)',
          borderRadius: '8px',
          fontSize: '13px',
          color: 'var(--text-muted)',
          minHeight: '38px'
        }}>
          {loading ? (
            <>
              <span style={{
                display: 'inline-block',
                width: '14px',
                height: '14px',
                border: '2px solid var(--border)',
                borderTopColor: 'var(--accent-blue)',
                borderRadius: '50%',
                animation: 'spin 0.75s linear infinite'
              }}></span>
              <span>{status}</span>
            </>
          ) : (
            <>
              <i className="bi bi-info-circle"></i>
              <span>{status}</span>
            </>
          )}
        </div>
      </div>

      {results?.map(({ frameIndex, comparison }) => (
        <FrameResultsBlock
          key={frameIndex}
          frameIndex={frameIndex}
          comparison={comparison}
          limits={LIMITS}
        />
      ))}

      {results?.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <CopyMethodButton results={results} methodKey="geometric" label="NEMA Geométrico" />
          <CopyMethodButton results={results} methodKey="pylinac" label="Pylinac/IAEA" />
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

function getBadge(value, limit) {
  if (!Number.isFinite(value)) {
    return {
      text: 'Sin dato',
      background: 'rgba(123,136,161,0.12)',
      color: 'var(--text-muted)',
      border: '1px solid rgba(123,136,161,0.25)'
    }
  }

  const ok = value <= limit
  return {
    text: ok ? 'Conforme' : 'No conforme',
    background: ok ? 'rgba(163,190,140,0.15)' : 'rgba(191,97,106,0.15)',
    color: ok ? 'var(--accent-green)' : 'var(--accent-red)',
    border: ok ? '1px solid rgba(163,190,140,0.3)' : '1px solid rgba(191,97,106,0.3)'
  }
}

function FrameResultsBlock({ frameIndex, comparison, limits }) {
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

  return (
    <div style={{ marginBottom: '28px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        marginBottom: '14px',
        padding: '12px 16px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '8px'
      }}>
        <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
          Frame {frameIndex + 1}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {formatShape(comparison.input.rows, comparison.input.cols)}
        </div>
      </div>

      {comparison.input.activeCrop && (
        <div style={{
          marginBottom: '16px',
          padding: '11px 16px',
          background: 'rgba(235,203,139,0.08)',
          borderLeft: '3px solid var(--accent-orange)',
          borderRadius: '0 8px 8px 0',
          fontSize: '12px',
          color: 'var(--text-muted)'
        }}>
          Se detecto padding negro en la matriz DICOM. La visualizacion y el calculo usan el campo activo:
          {' '}{formatShape(comparison.input.rows, comparison.input.cols)} dentro de {formatShape(comparison.input.originalRows, comparison.input.originalCols)}.
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '14px',
        marginBottom: '20px'
      }}>
        <ImagePanel
          label="Imagen analizada"
          canvasRef={canvasOrigRef}
          subtitle={`${formatShape(comparison.input.rows, comparison.input.cols)} - frame ${frameIndex + 1}`}
        />
        {comparison.geometric.available && (
          <>
            <ImagePanel label="NEMA UFOV" canvasRef={canvasGeoUFOVRef} subtitle="Mascara del metodo geometrico" />
            <ImagePanel label="NEMA CFOV" canvasRef={canvasGeoCFOVRef} subtitle="75 % central" />
          </>
        )}
        {comparison.pylinac.available && (
          <>
            <ImagePanel label="Pylinac UFOV" canvasRef={canvasPyUFOVRef} subtitle="Erosion del campo util" />
            <ImagePanel label="Pylinac CFOV" canvasRef={canvasPyCFOVRef} subtitle="Campo central erosionado" />
          </>
        )}
      </div>

      <MethodResults result={comparison.geometric} limits={limits} />
      <MethodResults result={comparison.pylinac} limits={limits} />
    </div>
  )
}

function CopyMethodButton({ results, methodKey, label }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const fmt = v => Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : ''
    const rows = results
      .map(({ frameIndex, comparison }) => {
        const r = comparison[methodKey]
        if (!r?.available) return null
        const du = (region) => Math.max(r[`DUvert${region}`], r[`DUhoriz${region}`])
        return [`H${frameIndex + 1}`, fmt(du('Cfov')), fmt(du('Ufov')), fmt(r.IUcfov), fmt(r.IUufov)].join('\t')
      })
      .filter(Boolean)
    if (!rows.length) return
    const lines = [
      ['Uniformidad', 'UDCC', 'UDCT', 'UICC', 'UICT'].join('\t'),
      ...rows
    ]
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      onClick={handleCopy}
      title={`Copiar ${label} en formato Excel`}
      style={{
        background: copied ? 'var(--accent-green, #22c55e)' : 'var(--bg-tertiary)',
        color: copied ? '#fff' : 'var(--text-muted)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '4px 12px',
        fontSize: '11px',
        cursor: 'pointer',
        transition: 'all 0.2s'
      }}
    >
      {copied ? 'Copiado' : `Copiar ${label}`}
    </button>
  )
}

function MethodResults({ result, limits }) {
  if (!result) return null

  if (!result.available) {
    return (
      <div className="calc-card" style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
          {result.method === 'nema_geometric' ? 'NEMA geometrico' : 'Pylinac/IAEA'}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--accent-red)' }}>{result.error}</div>
      </div>
    )
  }

  const duUfov = maxDU(result, 'ufov')
  const duCfov = maxDU(result, 'cfov')
  const tableRows = [
    { param: 'Uniformidad Integral (IU)', region: 'UFOV', val: result.IUufov, limit: limits.IUufov },
    { param: 'Uniformidad Integral (IU)', region: 'CFOV', val: result.IUcfov, limit: limits.IUcfov },
    { param: 'Uniformidad Diferencial vertical', region: 'UFOV', val: result.DUvertUfov, limit: limits.DUufov },
    { param: 'Uniformidad Diferencial horizontal', region: 'UFOV', val: result.DUhorizUfov, limit: limits.DUufov },
    { param: 'Uniformidad Diferencial vertical', region: 'CFOV', val: result.DUvertCfov, limit: limits.DUcfov },
    { param: 'Uniformidad Diferencial horizontal', region: 'CFOV', val: result.DUhorizCfov, limit: limits.DUcfov }
  ]

  return (
    <div className="calc-card" style={{ marginBottom: '20px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: '16px',
        flexWrap: 'wrap',
        marginBottom: '16px'
      }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{result.label}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {formatShape(result.rows, result.cols)}
            {result.metadata?.blockSize && <span> - block {result.metadata.blockSize.join(' x ')}</span>}
            {result.metadata?.binSize && <span> - bin {result.metadata.binSize}</span>}
            {result.metadata?.ufovSource && <span> - UFOV {result.metadata.ufovSource}</span>}
            {result.metadata?.ufovBBoxFinal && <span> - UFOV bbox {formatBBox(result.metadata.ufovBBoxFinal)}</span>}
            {result.metadata?.cfovBBoxFinal && <span> - CFOV bbox {formatBBox(result.metadata.cfovBBoxFinal)}</span>}
          </div>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Limites Siemens Symbia Intevo / Intevo Bold
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
        gap: '14px',
        marginBottom: '20px'
      }}>
        <MetricCard label="IU UFOV" value={result.IUufov} limit={limits.IUufov} />
        <MetricCard label="IU CFOV" value={result.IUcfov} limit={limits.IUcfov} />
        <MetricCard label="DU UFOV" value={duUfov} limit={limits.DUufov} />
        <MetricCard label="DU CFOV" value={duCfov} limit={limits.DUcfov} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
          <thead>
            <tr>
              {['Parametro', 'Region', 'Valor', 'Limite ref.', 'Estado'].map((h) => (
                <th key={h} style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  fontSize: '10.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  padding: '10px 16px',
                  textAlign: 'left',
                  borderBottom: '1px solid var(--border)'
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, idx) => {
              const badge = getBadge(row.val, row.limit)
              return (
                <tr key={idx}>
                  <td style={{
                    padding: '11px 16px',
                    borderBottom: '1px solid var(--border-sub)',
                    color: 'var(--text-secondary)'
                  }}>{row.param}</td>
                  <td style={{
                    padding: '11px 16px',
                    borderBottom: '1px solid var(--border-sub)',
                    color: 'var(--text-muted)',
                    fontSize: '12px'
                  }}>{row.region}</td>
                  <td style={{
                    padding: '11px 16px',
                    borderBottom: '1px solid var(--border-sub)',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                    color: 'var(--text-primary)'
                  }}>{formatPercent(row.val)}</td>
                  <td style={{
                    padding: '11px 16px',
                    borderBottom: '1px solid var(--border-sub)',
                    color: 'var(--text-muted)'
                  }}>{`<= ${row.limit.toFixed(1)} %`}</td>
                  <td style={{
                    padding: '11px 16px',
                    borderBottom: '1px solid var(--border-sub)'
                  }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '3px 10px',
                      borderRadius: '20px',
                      fontSize: '11px',
                      fontWeight: 600,
                      minWidth: '80px',
                      textAlign: 'center',
                      background: badge.background,
                      color: badge.color,
                      border: badge.border
                    }}>
                      {badge.text}
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

function MetricCard({ label, value, limit }) {
  const badge = getBadge(value, limit)

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '18px',
      textAlign: 'center'
    }}>
      <div style={{
        fontSize: '10px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.7px',
        color: 'var(--text-muted)',
        marginBottom: '8px'
      }}>{label}</div>
      <div style={{
        fontSize: '1.8rem',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--text-primary)'
      }}>{Number.isFinite(value) ? value.toFixed(2) : '--'}</div>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>%</div>
      <div style={{
        display: 'inline-block',
        marginTop: '8px',
        padding: '3px 10px',
        borderRadius: '20px',
        fontSize: '11px',
        fontWeight: 600,
        background: badge.background,
        color: badge.color,
        border: badge.border
      }}>
        {badge.text}
      </div>
    </div>
  )
}

function ImagePanel({ label, canvasRef, subtitle }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '14px',
      textAlign: 'center'
    }}>
      <div style={{
        fontSize: '10.5px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.6px',
        color: 'var(--text-muted)',
        marginBottom: '10px'
      }}>
        <i className={`bi ${label.includes('Imagen') ? 'bi-image' : label.includes('UFOV') ? 'bi-bounding-box' : 'bi-bounding-box-circles'}`}></i>
        &nbsp; {label}
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 'auto',
          imageRendering: 'pixelated',
          borderRadius: '6px',
          display: 'block'
        }}
      />
      <div style={{
        fontSize: '11px',
        color: 'var(--text-muted)',
        marginTop: '6px'
      }}>{subtitle}</div>
    </div>
  )
}

export default UniformidadGamma
