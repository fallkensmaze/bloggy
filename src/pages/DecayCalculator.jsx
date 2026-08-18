import { useState, useEffect } from 'react'

function DecayCalculator() {
  const [actividadInicial, setActividadInicial] = useState(1)
  const [unidad, setUnidad] = useState('MBq')
  const [isotopo, setIsotopo] = useState('160.1')
  const [fechaInicial, setFechaInicial] = useState('')
  const [fechaFinal, setFechaFinal] = useState('')
  const [resultado, setResultado] = useState('—')

  useEffect(() => {
    const ahora = new Date()
    const formatted = formatearFecha(ahora)
    setFechaInicial(formatted)
    setFechaFinal(formatted)
  }, [])

  useEffect(() => {
    calcular()
  }, [actividadInicial, unidad, isotopo, fechaInicial, fechaFinal])

  const formatearFecha = (date) => {
    const pad = n => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  const calcular = () => {
    const A0 = parseFloat(actividadInicial)
    const T_half = parseFloat(isotopo)
    const fInicial = new Date(fechaInicial)
    const fFinal = new Date(fechaFinal)

    if (isNaN(A0) || isNaN(T_half) || !fInicial.getTime() || !fFinal.getTime()) {
      setResultado('Entrada inválida')
      return
    }

    const t = (fFinal - fInicial) / (1000 * 60 * 60)
    const lambda = Math.log(2) / T_half
    const At = A0 * Math.exp(-lambda * t)
    setResultado(`${At.toFixed(2)} ${unidad}`)
  }

  return (
    <div className="page-body" style={{maxWidth: '700px'}}>
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-clock-history"></i></div>
        <h1 className="page-title">Decay Calculator</h1>
        <p className="page-subtitle">Cálculo de actividad residual: A(t) = A₀ · e<sup>−λt</sup></p>
      </div>

      <div className="calc-card">
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '20px',
          marginBottom: '24px'
        }}>
          <div>
            <label htmlFor="actividad-inicial" className="field-label">Actividad inicial</label>
            <input 
              type="number" 
              id="actividad-inicial" 
              className="dark-input" 
              value={actividadInicial}
              onChange={e => setActividadInicial(e.target.value)}
              step="any"
            />
          </div>
          <div>
            <label htmlFor="unidad-actividad" className="field-label">Unidad</label>
            <select 
              id="unidad-actividad" 
              className="dark-select"
              value={unidad}
              onChange={e => setUnidad(e.target.value)}
            >
              <option value="mCi">mCi</option>
              <option value="uCi">µCi</option>
              <option value="MBq">MBq</option>
              <option value="GBq">GBq</option>
              <option value="kBq">kBq</option>
            </select>
          </div>

          <div style={{
            gridColumn: '1 / -1',
            background: 'rgba(163,190,140,0.1)',
            border: '1px solid rgba(163,190,140,0.3)',
            borderRadius: '10px',
            padding: '22px 28px',
            textAlign: 'center',
            fontSize: '2.2rem',
            fontWeight: '700',
            color: 'var(--accent-green)',
            letterSpacing: '-0.01em',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {resultado}
          </div>

          <div style={{gridColumn: '1 / -1'}}>
            <label htmlFor="isotopo" className="field-label">Isótopo</label>
            <select 
              id="isotopo" 
              className="dark-select"
              value={isotopo}
              onChange={e => setIsotopo(e.target.value)}
            >
              <option value="1.8295">Flúor-18 (F-18) — T½ = 1.83 h</option>
              <option value="6.0058">Tecnecio-99m (Tc-99m) — T½ = 6.01 h</option>
              <option value="160.1">Lutecio-177 (Lu-177) — T½ = 160.1 h</option>
              <option value="192.5">Iodo-131 (I-131) — T½ = 192.5 h</option>
              <option value="1.128">Galio-68 (Ga-68) — T½ = 1.13 h</option>
              <option value="67.31">Indio-111 (In-111) — T½ = 67.3 h</option>
              <option value="72.8">Talio-201 (Tl-201) — T½ = 72.8 h</option>
            </select>
          </div>

          <div>
            <label htmlFor="fecha-inicial" className="field-label">Fecha de calibración</label>
            <input 
              type="datetime-local" 
              id="fecha-inicial" 
              className="dark-input"
              value={fechaInicial}
              onChange={e => setFechaInicial(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="fecha-final" className="field-label">Fecha de destino</label>
            <input 
              type="datetime-local" 
              id="fecha-final" 
              className="dark-input"
              value={fechaFinal}
              onChange={e => setFechaFinal(e.target.value)}
            />
          </div>
        </div>

        <div style={{
          marginTop: '20px',
          padding: '14px 18px',
          background: 'var(--bg-tertiary)',
          borderRadius: '8px',
          borderLeft: '3px solid var(--accent-blue)',
          fontSize: '13px',
          color: 'var(--text-muted)'
        }}>
          <strong style={{color: 'var(--text-secondary)'}}>Fórmula:</strong>
          {' '}A(t) = A₀ · exp(−ln(2) · t / T½) &nbsp;|&nbsp; λ = ln(2) / T½
        </div>
      </div>
    </div>
  )
}

export default DecayCalculator
