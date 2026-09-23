import { Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, getDocs } from 'firebase/firestore'
import AuthAvatar from './AuthAvatar'
import { useAuthUser } from '../utils/adminAuth'

import { NAV_LINKS as links, NAV_SECTIONS as sections } from '../utils/navigation'

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
