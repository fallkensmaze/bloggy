import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { db } from '../firebase'
import { collection, query, where, orderBy, limit, startAfter, getDocs, doc, getDoc } from 'firebase/firestore'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'

marked.use(markedKatex({ throwOnError: false }))

const PAGE_SIZE = 5
const ALLOWED_IMAGE_PROTOCOLS = ['http:', 'https:', 'data:']

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeImageUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin)
    return ALLOWED_IMAGE_PROTOCOLS.includes(parsed.protocol) ? url : ''
  } catch {
    return ''
  }
}

function renderMarkdown(markdown) {
  return DOMPurify.sanitize(marked.parse(markdown || ''), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'referrerpolicy']
  })
}

// Convierte URLs de Drive compartir → URL directa de imagen
function fixDriveUrl(url) {
  if (!url) return url
  
  // Extraer ID de diferentes formatos de URL de Google Drive
  let fileId = null
  
  // Formato: https://drive.google.com/file/d/ID/view
  let m = url.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/)
  if (m) fileId = m[1]
  
  // Formato: https://drive.google.com/open?id=ID
  if (!fileId) {
    m = url.match(/drive\.google\.com\/open\?.*?id=([A-Za-z0-9_-]+)/)
    if (m) fileId = m[1]
  }
  
  // Formato: https://drive.google.com/uc?id=ID
  if (!fileId) {
    m = url.match(/drive\.google\.com\/uc\?.*?id=([A-Za-z0-9_-]+)/)
    if (m) fileId = m[1]
  }
  
  if (fileId) {
    return `https://lh3.googleusercontent.com/d/${fileId}=w1600`
  }
  
  return url
}

// Renderer de marked con soporte Drive (código original)
const renderer = new marked.Renderer()
renderer.image = function(href, title, text) {
  const src = safeImageUrl(fixDriveUrl(href || ''))
  const alt = escapeHtml(text || '')
  const t = title ? escapeHtml(title) : ''
  
  const attrs = `src="${escapeHtml(src)}" alt="${alt}"${t ? ` title="${t}"` : ''} referrerpolicy="no-referrer"`

  if (alt && alt.trim()) {
    return `<figure style="margin:1em 0;">
      <img ${attrs} style="max-width:100%;height:auto;border-radius:8px;display:block;">
      <figcaption style="margin-top:0.5em;font-size:0.9em;color:var(--text-muted);font-style:italic;">${alt}</figcaption>
    </figure>`
  }

  return `<img ${attrs} style="max-width:100%;height:auto;border-radius:8px;margin:0.5em 0;display:block;">`
}
marked.setOptions({ renderer })

function Blog() {
  const [posts, setPosts] = useState([])
  const [lastDoc, setLastDoc] = useState(null)
  const [loading, setLoading] = useState(false)
  const [searchParams] = useSearchParams()
  const observerRef = useRef()
  const mountedRef = useRef(false)

  const topic = searchParams.get('t')
  const slug = searchParams.get('slug')

  useEffect(() => {
    // Reset everything when topic/slug changes
    mountedRef.current = false
    setPosts([])
    setLastDoc(null)
    setLoading(false)
    
    // Small delay to ensure state is reset
    const timer = setTimeout(() => {
      if (slug) {
        loadPostBySlug(slug)
      } else {
        loadMorePosts(true)
      }
    }, 0)
    
    return () => {
      clearTimeout(timer)
      mountedRef.current = false
    }
  }, [topic, slug])

  const loadPostBySlug = async (slug) => {
    if (mountedRef.current) return
    mountedRef.current = true
    
    try {
      const docRef = doc(db, 'BLOG', slug)
      const docSnap = await getDoc(docRef)
      
      if (docSnap.exists()) {
        setPosts([{ id: docSnap.id, ...docSnap.data() }])
      } else {
        setPosts([])
      }
    } catch (error) {
      console.error('Error loading post:', error)
      setPosts([])
    }
  }

  const loadMorePosts = async (reset = false) => {
    if (loading) return
    if (reset && mountedRef.current) return
    
    setLoading(true)

    try {
      let q = collection(db, 'BLOG')
      if (topic) q = query(q, where('topic', '==', topic))
      q = query(q, orderBy('fecha', 'desc'), limit(PAGE_SIZE))
      if (!reset && lastDoc) q = query(q, startAfter(lastDoc))

      const snap = await getDocs(q)
      
      if (snap.empty) {
        setLoading(false)
        if (reset) mountedRef.current = true
        return
      }

      const newPosts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      
      setPosts(prev => {
        if (reset) return newPosts
        // Avoid duplicates by checking IDs
        const existingIds = new Set(prev.map(p => p.id))
        const uniqueNew = newPosts.filter(p => !existingIds.has(p.id))
        return [...prev, ...uniqueNew]
      })
      
      setLastDoc(snap.docs[snap.docs.length - 1])
      if (reset) mountedRef.current = true
    } catch (error) {
      console.error('Error loading posts:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !slug) {
          loadMorePosts()
        }
      },
      { threshold: 0.1 }
    )

    if (observerRef.current) observer.observe(observerRef.current)
    return () => observer.disconnect()
  }, [lastDoc, slug])

  useEffect(() => {
    document.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block))
  }, [posts])

  return (
    <div className="page-body">
      <div className="hero">
        <div className="hero-avatar"></div>
        <div>
          <div className="hero-name">Falken's Maze<span className="cursor">_</span></div>
          <div className="hero-desc">Física Médica &amp; Medicina Nuclear</div>
        </div>
      </div>

      <div id="posts-list">
        {posts.map(post => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
      
      {!slug && <div ref={observerRef} style={{height: '1px'}}></div>}
    </div>
  )
}

function PostCard({ post }) {
  const fecha = post.fecha?.toDate?.() || new Date()
  const fechaStr = fecha.toLocaleDateString('es-ES', {
    year: 'numeric', month: 'long', day: 'numeric'
  })

  return (
    <div className="post-card">
      <div className="post-meta">
        <a href={`?t=${encodeURIComponent(post.topic)}`} className="topic-badge">
          {post.topic || 'General'}
        </a>
        <span className="meta-chip">
          <i className="bi bi-calendar3"></i> {fechaStr}
        </span>
        <span className="meta-chip">
          <i className="bi bi-clock"></i> {post.minutos || 5} min
        </span>
      </div>
      <h2 className="post-title">{post.titulo}</h2>
      <div 
        className="md-body" 
        dangerouslySetInnerHTML={{ __html: renderMarkdown(post.contenido) }}
      />
    </div>
  )
}

export default Blog
