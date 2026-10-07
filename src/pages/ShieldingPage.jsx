import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthUser } from '../utils/adminAuth'
import { loginWithGoogle } from '../utils/authGoogle'
import ShieldingWorkspace from '../components/shielding/ShieldingWorkspace'

export function ShieldingAccess({ authState, login }) {
  const [error, setError] = useState(''), [entering, setEntering] = useState(false)
  if (authState.loading) return <div className="sh-access" role="status">Comprobando tu sesión…</div>
  if (authState.isAdmin) return <ShieldingWorkspace key={authState.user?.uid || 'owner'} />
  return <main className="sh-access"><div><span className="sh-access-icon"><i className="bi bi-shield-lock" aria-hidden="true" /></span><p className="sh-eyebrow">FALKEN’S MAZE</p><h1>Taller de blindajes</h1><p>Un espacio privado para dibujar y estudiar tu sala de rayos X.</p>{authState.user && <p className="sh-error">Esta cuenta no tiene acceso. Entra con la cuenta del propietario.</p>}<button className="sh-button sh-button-primary" disabled={entering} onClick={async () => { setEntering(true); setError(''); try { await login() } catch { setError('No se ha podido iniciar sesión. Inténtalo de nuevo.') } finally { setEntering(false) } }}>{entering ? 'Abriendo acceso…' : 'Entrar con Google'}</button>{error && <p role="alert">{error}</p>}<Link to="/">Volver a Bloggy</Link><small>Los planos y el trabajo permanecen en esta pestaña.</small></div></main>
}
export default function ShieldingPage() { return <ShieldingAccess authState={useAuthUser()} login={loginWithGoogle} /> }
