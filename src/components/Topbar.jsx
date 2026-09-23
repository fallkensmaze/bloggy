import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { db } from '../firebase'
import { collection, getDocs } from 'firebase/firestore'
import AuthAvatar from './AuthAvatar'
import { useAuthUser } from '../utils/adminAuth'

import { NAV_LINKS as links, NAV_SECTIONS as sections } from '../utils/navigation'

function Topbar() {
  const [isOpen, setIsOpen] = useState(false)
  const { isAdmin } = useAuthUser()
  const [topics, setTopics] = useState([])
  const location = useLocation()
  const currentTopic = new URLSearchParams(location.search).get('t')

  useEffect(() => {
    loadTopics()
  }, [])

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

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
    <>
      <header className="topbar">
        <button 
          className="topbar-toggle" 
          type="button" 
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Abrir menú"
        >
          <i className="bi bi-list"></i>
        </button>
        <AuthAvatar className="topbar-logo" />
        <span className="topbar-name">Falken's Maze</span>
      </header>

      {/* Backdrop */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 199
          }}
          onClick={() => setIsOpen(false)}
          onTouchMove={e => e.preventDefault()}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 'var(--sidebar-w)',
        maxWidth: '85vw',
        height: '100vh',
        maxHeight: '100dvh',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 200,
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.3s ease-in-out',
        visibility: isOpen ? 'visible' : 'hidden',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
            <div className="s-avatar"></div>
            <span className="s-name">Falken's Maze<span className="cursor">_</span></span>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '4px',
              lineHeight: 1,
            }}
          >
            <i className="bi bi-x"></i>
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', paddingBottom: '24px'}}>
          <nav className="sidebar-nav">
            {sections.map(sec => (
              <div key={sec} className="nav-section">
                <span className="nav-section-label">{sec}</span>
                {links.filter(l => l.section === sec && (!l.admin || isAdmin)).map(l => (
                  <Link
                    key={l.href}
                    to={l.href}
                    className={`nav-link-item${location.pathname === l.href && !currentTopic ? ' active' : ''}`}
                    onClick={() => setIsOpen(false)}
                  >
                    <i className={`bi ${l.icon}`}></i> {l.label}
                  </Link>
                ))}
              </div>
            ))}

            {topics.length > 0 && (
              <div className="nav-section">
                <span className="nav-section-label">Temas</span>
                <Link
                  to="/"
                  className={`nav-link-item${location.pathname === '/' && !currentTopic ? ' active' : ''}`}
                  onClick={() => setIsOpen(false)}
                >
                  <i className="bi bi-grid-3x3-gap"></i> Todos
                </Link>
                {topics.map(t => (
                  <Link
                    key={t}
                    to={`/?t=${encodeURIComponent(t)}`}
                    className={`nav-link-item${currentTopic === t ? ' active' : ''}`}
                    onClick={() => setIsOpen(false)}
                  >
                    <i className="bi bi-tag"></i> {t}
                  </Link>
                ))}
              </div>
            )}
          </nav>
        </div>
      </div>
    </>
  )
}

export default Topbar
