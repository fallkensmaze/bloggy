import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth'
import { auth } from '../firebase'

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

// Estrategia "popup primero, con fallback a redirect".
//
// - signInWithPopup entra a la primera cuando el navegador lo permite y, sobre todo,
//   en iOS Safari el canal del popup a veces sobrevive donde el redirect no (el
//   redirect contra firebaseapp.com es cross-site y la Prevención de seguimiento de
//   Safari puede bloquear su almacenamiento al volver, dejándote en la misma pantalla).
// - Si el popup no se puede usar (bloqueado, cerrado, no soportado en este entorno, o
//   la Cross-Origin-Opener-Policy impide cerrarlo), caemos a un redirect de página
//   completa, que en escritorio funciona bien.
//
// Si ni popup ni redirect entran en iOS Safari, el arreglo definitivo es servir el
// handler de auth desde el mismo dominio que la app (auth same-origin).
const FALLBACK_A_REDIRECT = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
  'auth/internal-error',
])

export async function loginWithGoogle() {
  try {
    return await signInWithPopup(auth, googleProvider)
  } catch (err) {
    if (FALLBACK_A_REDIRECT.has(err?.code)) {
      return signInWithRedirect(auth, googleProvider)
    }
    console.error('Error en login con Google:', err)
    throw err
  }
}

// Procesa el retorno del redirect (solo se usa cuando hubo fallback). onAuthStateChanged
// restaura la sesión solo; esto únicamente sirve para que los errores lleguen a consola.
export async function consumeGoogleRedirect() {
  try {
    return await getRedirectResult(auth)
  } catch (err) {
    console.error('Error al volver del login de Google:', err)
    return null
  }
}
