import { useNavigate } from 'react-router-dom'

const terminalReportUrl = `${import.meta.env.BASE_URL}Informe-Tanques-Terminal.html`

function InformeTanques() {
  const navigate = useNavigate()

  return (
    <div className="tank-frame-page">
      <button
        type="button"
        className="tank-back-button"
        onClick={() => navigate(-1)}
      >
        <i className="bi bi-arrow-left"></i>
        Volver
      </button>
      <iframe
        className="tank-frame"
        src={terminalReportUrl}
        sandbox="allow-scripts"
        title="Modelo de tanques ciclicos para residuos liquidos"
      />
    </div>
  )
}

export default InformeTanques
