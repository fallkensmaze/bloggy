// ── Sesión de administración ────────────────────────────────────────────────
//
// Un único sitio donde se sabe quién es el dueño del sitio. Las reglas de
// Firestore son las que mandan de verdad (`soyAdmin()` en firestore.rules);
// esto solo decide qué se enseña en la interfaz, así que ocultar un enlace aquí
// no protege nada por sí solo: los datos privados los protege la regla.

import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'
import { consumeGoogleRedirect } from './authGoogle'

export const ADMIN_UID = '9njWk2YH3pMR2Aiih5obAWpHOb42'

export function esAdmin(user) {
  return Boolean(user) && !user.isAnonymous && user.uid === ADMIN_UID
}

// El retorno del redirect se consume una sola vez por carga: el hook lo usan a la
// vez la barra lateral, la superior y la página, y getRedirectResult solo tiene
// resultado para el primero que llegue.
let redirectConsumido = false

/** Suscripción al estado de sesión: { user, loading, isAdmin }. */
export function useAuthUser() {
  const [estado, setEstado] = useState({ user: auth.currentUser, loading: true })

  useEffect(() => {
    if (!redirectConsumido) {
      redirectConsumido = true
      consumeGoogleRedirect()
    }
    return onAuthStateChanged(auth, user => setEstado({ user, loading: false }))
  }, [])

  return { user: estado.user, loading: estado.loading, isAdmin: esAdmin(estado.user) }
}
