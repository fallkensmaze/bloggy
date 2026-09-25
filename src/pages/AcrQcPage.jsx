import { useEffect } from 'react'
import { initAcrQc } from '../lib/acr-qc'
import '../styles/acr-qc.css'

function AcrQcPage() {
  useEffect(() => {
    return initAcrQc()
  }, [])

  return (
    <div className="acr-qc-page">
      <h1>Control de calidad ACR — Maniquí Medium</h1>
      <p className="subtitle">Medidas automáticas y revisión visual del maniquí ACR Medium. El informe indica las pruebas pendientes y las medidas complementarias.</p>

      <div id="print-meta"></div>

      <div className="controls">
        <label>
          Campo magnético:
          <select id="field-strength" defaultValue="1.5">
            <option value="0.5">&lt; 1.5T</option>
            <option value="1.5">1.5T a &lt; 3T</option>
            <option value="3">3T</option>
          </select>
        </label>
        <button id="run-btn" disabled>Ejecutar tests</button>
        <button id="copy-excel-btn" disabled>Copiar para Excel</button>
        <button id="save-pdf-btn" disabled>Guardar PDF</button>
        <button id="clear-btn">Limpiar</button>
      </div>

      <div id="assessment-summary" role="status"></div>

      <div className="controls" id="series-controls" style={{ display: 'none' }}>
        <label>
          Serie T1:
          <select id="t1-select"></select>
        </label>
        <label>
          Serie T2:
          <select id="t2-select"></select>
        </label>
      </div>

      <div id="drop-zone">
        <p><strong>Arrastra los DICOM aquí</strong></p>
        <p>o haz clic para seleccionarlos</p>
        <p>Un estudio: 11 cortes T1, 11 cortes T2 y localizador sagital. DICOM MR sin comprimir, un archivo por corte.</p>
        <input type="file" id="file-input" multiple accept=".dcm,.ima,application/dicom" style={{ display: 'none' }} />
      </div>

      <div id="log"></div>

      <h2 id="overview-title" style={{ display: 'none' }}>Resumen de cortes detectados</h2>
      <div id="slice-overview"></div>

      <div id="visual-review"></div>

      <h2 id="results-title" style={{ display: 'none' }}>Resultados</h2>
      <div id="results"></div>
    </div>
  )
}

export default AcrQcPage
