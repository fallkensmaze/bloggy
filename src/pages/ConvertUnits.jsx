import { useState, useEffect } from 'react'

const FACTORES_A_BQ = {
  'Bq': 1, 'kBq': 1e3, 'MBq': 1e6,
  'nCi': 37, 'uCi': 3.7e4, 'mCi': 3.7e7, 'Ci': 3.7e10,
}

function ConvertUnits() {
  const [valor, setValor] = useState(1)
  const [unidadOrigen, setUnidadOrigen] = useState('mCi')
  const [unidadDestino, setUnidadDestino] = useState('Bq')
  const [resultado, setResultado] = useState('—')

  useEffect(() => {
    calcular()
  }, [valor, unidadOrigen, unidadDestino])

  const calcular = () => {
    const val = parseFloat(valor)
    if (isNaN(val)) {
      setResultado('Introduce un número válido')
      return
    }
    const valorEnBq = val * FACTORES_A_BQ[unidadOrigen]
    const resultadoFinal = valorEnBq / FACTORES_A_BQ[unidadDestino]
    setResultado(`${resultadoFinal.toExponential(3)} ${unidadDestino}`)
  }

  return (
    <div className="page-body" style={{maxWidth: '680px'}}>
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-arrow-left-right"></i></div>
        <h1 className="page-title">Conversor Ci–Bq</h1>
        <p className="page-subtitle">Conversión entre unidades de actividad radiactiva</p>
      </div>

      <div className="calc-card">
        <div className="field-group" style={{marginBottom: '24px'}}>
          <label htmlFor="valor" className="field-label">Valor a convertir</label>
          <input 
            type="number" 
            id="valor" 
            className="dark-input" 
            value={valor}
            onChange={e => setValor(e.target.value)}
            step="any"
          />
        </div>

        <div className="units-row" style={{
          display: 'grid',
          gridTemplateColumns: '1fr 36px 1fr',
          gap: '12px',
          alignItems: 'end',
          marginBottom: '24px'
        }}>
          <div>
            <label htmlFor="unidad_origen" className="field-label">De</label>
            <select 
              id="unidad_origen" 
              className="dark-select"
              value={unidadOrigen}
              onChange={e => setUnidadOrigen(e.target.value)}
            >
              <option value="Ci">Curie (Ci)</option>
              <option value="mCi">Milicurie (mCi)</option>
              <option value="uCi">Microcurie (µCi)</option>
              <option value="nCi">Nanocurie (nCi)</option>
              <option value="Bq">Becquerel (Bq)</option>
              <option value="kBq">Kilobecquerel (kBq)</option>
              <option value="MBq">Megabecquerel (MBq)</option>
            </select>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '42px',
            color: 'var(--text-muted)',
            fontSize: '18px'
          }}>
            <i className="bi bi-arrow-right"></i>
          </div>
          <div>
            <label htmlFor="unidad_destino" className="field-label">A</label>
            <select 
              id="unidad_destino" 
              className="dark-select"
              value={unidadDestino}
              onChange={e => setUnidadDestino(e.target.value)}
            >
              <option value="Bq">Becquerel (Bq)</option>
              <option value="kBq">Kilobecquerel (kBq)</option>
              <option value="MBq">Megabecquerel (MBq)</option>
              <option value="Ci">Curie (Ci)</option>
              <option value="mCi">Milicurie (mCi)</option>
              <option value="uCi">Microcurie (µCi)</option>
              <option value="nCi">Nanocurie (nCi)</option>
            </select>
          </div>
        </div>

        <div className="result-box" style={{
          background: 'rgba(136,192,208,0.08)',
          border: '1px solid rgba(136,192,208,0.25)',
          borderRadius: '10px',
          padding: '22px 28px',
          textAlign: 'center',
          fontSize: '2rem',
          fontWeight: '700',
          color: 'var(--accent-blue)',
          letterSpacing: '-0.01em',
          fontVariantNumeric: 'tabular-nums'
        }}>
          {resultado}
        </div>
      </div>
    </div>
  )
}

export default ConvertUnits
