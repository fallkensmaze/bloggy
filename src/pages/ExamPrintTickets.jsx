import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { auth, db } from '../firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, collection, getDocs } from 'firebase/firestore'
import QRCode from 'qrcode'
import { buildTicketsCsv, downloadCsv } from '../utils/exam'
import { loginWithGoogle, consumeGoogleRedirect } from '../utils/authGoogle'
import '../styles/exam.css'

function ExamPrintTickets() {
  const { sessionId } = useParams()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessionTitle, setSessionTitle] = useState('')
  const [tickets, setTickets] = useState([])
  const [qrCodes, setQrCodes] = useState({}) // { [ticketSecret]: dataURL }
  const [qrLoading, setQrLoading] = useState(false)

  // Configurar listener de autenticación
  useEffect(() => {
    consumeGoogleRedirect()
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  // Cargar sesión y tickets cuando user y sessionId estén listos
  useEffect(() => {
    if (!user || user.isAnonymous || !sessionId) return

    const loadSessionAndTickets = async () => {
      try {
        // Obtener el título de la sesión
        const sessionDoc = await getDoc(doc(db, 'EXAM_SESSIONS', sessionId))
        if (sessionDoc.exists()) {
          setSessionTitle(sessionDoc.data().titulo || 'Examen sin título')
        }

        // Obtener los tickets desde la subcolección
        const ticketsRef = collection(db, 'EXAM_SESSIONS', sessionId, 'TICKETS')
        const snapshot = await getDocs(ticketsRef)
        const ticketsData = snapshot.docs.map(doc => ({
          ticketSecret: doc.id,
          displayCode: doc.data().displayCode
        }))

        // Ordenar por displayCode ascendente
        ticketsData.sort((a, b) => a.displayCode.localeCompare(b.displayCode))
        setTickets(ticketsData)
      } catch (err) {
        console.error('Error cargando sesión y tickets:', err)
      }
    }

    loadSessionAndTickets()
  }, [user, sessionId])

  // Generar códigos QR para los tickets
  useEffect(() => {
    if (tickets.length === 0) return

    const generateQRs = async () => {
      setQrLoading(true)
      const baseUrl = window.location.origin + import.meta.env.BASE_URL
      const qrMap = {}

      try {
        for (const ticket of tickets) {
          const url = `${baseUrl}exam/join/${sessionId}/${ticket.ticketSecret}`
          try {
            const dataURL = await QRCode.toDataURL(url, { width: 220, margin: 1 })
            qrMap[ticket.ticketSecret] = dataURL
          } catch (err) {
            console.error(`Error generando QR para ${ticket.ticketSecret}:`, err)
          }
        }
        setQrCodes(qrMap)
      } finally {
        setQrLoading(false)
      }
    }

    generateQRs()
  }, [tickets, sessionId])

  const handleLogin = async () => {
    try {
      await loginWithGoogle()
    } catch (err) {
      console.error('Error en login:', err)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const handleDownloadCsv = () => {
    const baseUrl = window.location.origin + import.meta.env.BASE_URL
    const csv = buildTicketsCsv(tickets, baseUrl, sessionId)
    downloadCsv(`tickets-${sessionId}.csv`, csv)
  }

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center' }}>Cargando...</div>
  }

  // Pantalla de login si no hay usuario o es anónimo
  if (!user || user.isAnonymous) {
    return (
      <div className="exam-container">
        <div className="centered-view">
          <div className="auth-card">
            <div className="auth-card-icon">📋</div>
            <h1>Impresión de Tickets</h1>
            <p>Inicia sesión con tu cuenta de Google para acceder a la impresión de tickets.</p>
            <button onClick={handleLogin} className="btn-google">
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
                <path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16 19.3 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2c-7.6 0-14.2 4.3-17.7 10.7z"/>
                <path fill="#FBBC05" d="M24 46c5.9 0 10.9-2 14.5-5.4l-6.7-5.5C29.8 36.7 27 38 24 38c-6 0-11.1-4-12.9-9.5l-7 5.4C7.7 41.6 15.3 46 24 46z"/>
                <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.8 2.7-2.6 5-5 6.6l6.7 5.5C41.7 37.1 45 31 45 24c0-1.3-.2-2.7-.5-4z"/>
              </svg>
              Continuar con Google
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Estado de carga mientras se generan los QR
  if (qrLoading && tickets.length > 0 && Object.keys(qrCodes).length === 0) {
    return (
      <div className="exam-container">
        <div style={{ padding: '48px', textAlign: 'center' }}>
          Generando códigos QR...
        </div>
      </div>
    )
  }

  return (
    <div className="exam-container">
      {/* Controles de impresión (se ocultan en print) */}
      <div className="exam-print-controls">
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '16px' }}>
            {sessionTitle || 'Examen sin título'}
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} generado{tickets.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          <button onClick={handlePrint} className="exam-btn" style={{ background: '#27ae60' }}>
            <i className="bi bi-printer"></i> Imprimir
          </button>
          <button onClick={handleDownloadCsv} className="exam-btn" style={{ background: '#3498db' }}>
            <i className="bi bi-download"></i> Descargar CSV
          </button>
        </div>
      </div>

      {/* Rejilla de tickets (se imprime) */}
      <div className="exam-ticket-grid">
        {tickets.map((ticket) => (
          <div key={ticket.ticketSecret} className="exam-ticket">
            {qrCodes[ticket.ticketSecret] ? (
              <img
                src={qrCodes[ticket.ticketSecret]}
                alt={`QR ${ticket.displayCode}`}
                style={{ width: '100%', height: 'auto' }}
              />
            ) : (
              <div style={{ width: '220px', height: '220px', background: '#eee' }} />
            )}
            <div className="exam-ticket-code">
              {ticket.displayCode}
            </div>
          </div>
        ))}
      </div>

      {tickets.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
          No hay tickets en esta sesión.
        </div>
      )}
    </div>
  )
}

export default ExamPrintTickets
