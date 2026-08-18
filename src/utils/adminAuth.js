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

// La sesión anónima es fontanería, no una cuenta: /quizzes, /join y /ptb la
// abren solas al montar para que las reglas de Firestore les dejen leer y
// escribir, y como Firebase la guarda en el navegador, sigue abierta en el
// resto del sitio. Para la interfaz eso equivale a no haber entrado: no hay
// nombre que enseñar ni sesión de la que salir.
export function esAnonimo(user) {
  return Boolean(user) && user.isAnonymous
}

export function esAdmin(user) {
  return Boolean(user) && !user.isAnonymous && user.uid === ADMIN_UID
}

// El retorno del redirect se consume una sola vez por carga: el hook lo usan a la
// vez la barra lateral, la superior y la página, y getRedirectResult solo tiene
// resultado para el primero que llegue.
let redirectConsumido = false

/**
 * Suscripción al estado de sesión: { user, loading, isAdmin, anonimo }.
 * `user` es la cuenta de verdad, así que vale null mientras la única sesión
 * abierta sea la anónima; `anonimo` queda para quien necesite saber que hay
 * credenciales con las que hablar con Firestore.
 */
export function useAuthUser() {
  const [estado, setEstado] = useState({ user: auth.currentUser, loading: true })

  useEffect(() => {
    if (!redirectConsumido) {
      redirectConsumido = true
      consumeGoogleRedirect()
    }
    return onAuthStateChanged(auth, user => setEstado({ user, loading: false }))
  }, [])

  const anonimo = esAnonimo(estado.user)
  const user = anonimo ? null : estado.user

  return { user, loading: estado.loading, isAdmin: esAdmin(user), anonimo }
}
