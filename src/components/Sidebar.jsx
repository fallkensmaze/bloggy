import { Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, getDocs } from 'firebase/firestore'
import AuthAvatar from './AuthAvatar'
import { useAuthUser } from '../utils/adminAuth'

const links = [
  { href: '/', icon: 'bi-house-door', label: 'Inicio', section: 'Blog' },
  { href: '/convert-units', icon: 'bi-arrow-left-right', label: 'Conversor Ci–Bq', section: 'Aplicaciones' },
  { href: '/decay-calculator', icon: 'bi-clock-history', label: 'Decay Calculator', section: 'Aplicaciones' },
  { href: '/restricciones-lu177', icon: 'bi-activity', label: 'Lu-177 Restricciones', section: 'Aplicaciones' },
  { href: '/uniformidad-gamma', icon: 'bi-grid-1x2-fill', label: 'Uniformidad NEMA', section: 'Aplicaciones' },
  { href: '/centro-rotacion-spect', icon: 'bi-crosshair', label: 'Centro rotación SPECT', section: 'Aplicaciones' },
  { href: '/rtplan-compare', icon: 'bi-file-earmark-diff', label: 'Comparar RT Plans', section: 'Aplicaciones' },
  { href: '/tg43-calculator', icon: 'bi-radioactive', label: 'Calculador TG-43', section: 'Aplicaciones' },
  { href: '/acr-qc', icon: 'bi-magnet', label: 'ACR MRI QC', section: 'Aplicaciones' },
  { href: '/lector', icon: 'bi-speedometer2', label: 'Lector rápido', section: 'Aplicaciones' },
  { href: '/informe-tanques', icon: 'bi-droplet-half', label: 'Tanques Lu-177', section: 'Aplicaciones' },
  { href: '/pet-nema-fraccionamiento', icon: 'bi-prescription2', label: 'Fraccionamiento PET', section: 'Aplicaciones' },
  { href: '/pet-nema-analisis', icon: 'bi-bullseye', label: 'Análisis PET NEMA', section: 'Aplicaciones' },
  { href: '/rt-anonymizer', icon: 'bi-shield-lock', label: 'Anonimizar RT', section: 'Aplicaciones' },
  { href: '/q-codes', icon: 'bi-broadcast', label: 'Códigos Q', section: 'Aplicaciones' },
  { href: '/morse', icon: 'bi-soundwave', label: 'Código Morse', section: 'Aplicaciones' },
  { href: '/fdtd-simulator', icon: 'bi-wifi', label: 'Simulador FDTD', section: 'Aplicaciones' },
  { href: '/dosimetria-pelicula', icon: 'bi-film', label: 'Dosimetría de película', section: 'Aplicaciones' },
  // El temario del examen es privado: solo aparece con la sesión del dueño abierta.
  { href: '/radioaficionado', icon: 'bi-mortarboard', label: 'Examen radio', section: 'Aplicaciones', admin: true },
  { href: '/quizzes', icon: 'bi-trophy', label: 'Quizzes', section: 'Juegos' }
]

function Sidebar() {
  const location = useLocation()
  const { isAdmin } = useAuthUser()
  const [topics, setTopics] = useState([])
  
  const currentTopic = new URLSearchParams(location.search).get('t')

  useEffect(() => {
    loadTopics()
  }, [])

  const loadTopics = async () => {
    try {
      const snap = await getDocs(collection(db, 'BLOG'))
      const topicsSet = new Set()
      snap.forEach(doc => {
        const t = doc.data().topic
        if (t) topicsSet.add(t)
      })
      setTopics([...topicsSet].sort())
    } catch (error) {
      console.error('Error loading topics:', error)
    }
  }

  const sections = ['Blog', 'Aplicaciones', 'Juegos']

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <AuthAvatar className="s-avatar" />
        <Link to="/" className="sidebar-brand-link">
          <span className="s-name">Falken's Maze<span className="cursor">_</span></span>
        </Link>
      </div>

      <nav className="sidebar-nav">
        {sections.map(sec => (
          <div key={sec} className="nav-section">
            <span className="nav-section-label">{sec}</span>
            {links.filter(l => l.section === sec && (!l.admin || isAdmin)).map(l => (
              <Link 
                key={l.href}
                to={l.href} 
                className={`nav-link-item${location.pathname === l.href && !currentTopic ? ' active' : ''}`}
              >
                <i className={`bi ${l.icon}`}></i> {l.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      
      {topics.length > 0 && (
        <div className="nav-section">
          <span className="nav-section-label">Temas</span>
          <Link 
            to="/" 
            className={`nav-link-item${location.pathname === '/' && !currentTopic ? ' active' : ''}`}
          >
            <i className="bi bi-grid-3x3-gap"></i> Todos
          </Link>
          {topics.map(t => (
            <Link 
              key={t}
              to={`/?t=${encodeURIComponent(t)}`}
              className={`nav-link-item${currentTopic === t ? ' active' : ''}`}
            >
              <i className="bi bi-tag"></i> {t}
            </Link>
          ))}
        </div>
      )}
      
      <div className="sidebar-footer">Física Médica &amp; Medicina Nuclear</div>
    </aside>
  )
}

export default Sidebar
