import { useState, useRef, useEffect } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { loginWithGoogle } from '../utils/authGoogle'
import { useAuthUser } from '../utils/adminAuth'

/**
 * Avatar de la cabecera que hace de botón de sesión: sin sesión entra con Google,
 * con sesión abre un menú con la cuenta y la salida. El anillo cambia de color
 * para que se vea de un vistazo si la cuenta abierta es la del dueño del sitio.
 *
 * La sesión anónima que abren /quizzes, /join y /ptb no cuenta como sesión aquí
 * (useAuthUser la da como null): el avatar sigue diciendo «Entrar con Google» en
 * vez de ofrecer salir de una cuenta que el usuario nunca abrió.
 */
function AuthAvatar({ className = 's-avatar' }) {
  const { user, isAdmin } = useAuthUser()
  const [abierto, setAbierto] = useState(false)
  const [entrando, setEntrando] = useState(false)
  const cajaRef = useRef(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = e => { if (cajaRef.current && !cajaRef.current.contains(e.target)) setAbierto(false) }
    const escape = e => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  const handleClick = async () => {
    if (user) { setAbierto(v => !v); return }
    setEntrando(true)
    try {
      await loginWithGoogle()
    } catch {
      /* el error ya se registra en authGoogle */
    } finally {
      setEntrando(false)
    }
  }

  const estado = !user ? 'fuera' : isAdmin ? 'admin' : 'ajeno'
  const titulo = !user
    ? 'Entrar con Google'
    : isAdmin
      ? `Sesión de ${user.displayName || user.email}`
      : `${user.email} · sin permisos de administración`

  return (
    <span className="auth-avatar-box" ref={cajaRef}>
      <button
        type="button"
        className={`${className} auth-avatar auth-avatar--${estado}`}
        style={user?.photoURL ? { backgroundImage: `url(${user.photoURL})` } : undefined}
        onClick={handleClick}
        disabled={entrando}
        title={titulo}
        aria-label={titulo}
      >
        {!user && <i className="bi bi-box-arrow-in-right auth-avatar-icon" />}
      </button>

      {abierto && user && (
        <div className="auth-menu">
          <span className="auth-menu-name">{user.displayName || user.email}</span>
          <span className="auth-menu-role">
            {isAdmin ? 'Administración' : 'Sin permisos de administración'}
          </span>
          <button
            type="button"
            className="auth-menu-btn"
            onClick={() => { setAbierto(false); signOut(auth) }}
          >
            <i className="bi bi-box-arrow-right" /> Salir
          </button>
        </div>
      )}
    </span>
  )
}

export default AuthAvatar
