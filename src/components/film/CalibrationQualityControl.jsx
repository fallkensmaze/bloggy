const METHOD_LABELS = {
  multichannel: 'Multicanal',
  'weighted-rgb': 'RGB ponderado',
  red: 'Rojo',
  green: 'Verde',
  blue: 'Azul'
}

function dose(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '—'
}

function deviation(value) {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} %`
}

export default function CalibrationQualityControl({ calibration }) {
  const quality = calibration?.qualityControl
  if (!quality) return null

  return (
    <div className="film-subsection film-calibration-qc">
      <div className="film-subsection-title">
        <div>
          <strong>Control interno de la calibración</strong>
          <span>Las mismas imágenes se reconstruyen como dosis y se comparan con la dosis nominal.</span>
        </div>
        <span className="film-status ok"><i className="bi bi-check2-circle" /> Calculado</span>
      </div>

      <div className="film-alert warning">
        <i className="bi bi-info-circle" />
        Esta comprobación mide la consistencia del ajuste, pero no es una validación independiente porque reutiliza las películas de calibración. No se aplica automáticamente ningún límite de aceptación clínica.
      </div>

      <div className="film-points-table-wrap">
        <table className="film-points-table film-qc-table">
          <thead>
            <tr>
              <th>Dosis nominal</th>
              {quality.methods.map((method) => <th key={method}>{METHOD_LABELS[method]}</th>)}
            </tr>
          </thead>
          <tbody>
            {quality.points.map((point) => (
              <tr key={point.pointId}>
                <td><strong>{dose(point.expectedGy)} Gy</strong></td>
                {quality.methods.map((method) => (
                  <td key={method}>
                    <span className="film-qc-dose">{dose(point.estimatesGy[method])} Gy</span>
                    <small>{deviation(point.deviationsPercent[method])}</small>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>RMSE</th>
              {quality.methods.map((method) => <td key={method}>{dose(quality.summary[method].rmseGy)} Gy</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
