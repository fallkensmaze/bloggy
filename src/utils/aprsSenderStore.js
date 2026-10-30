// ── Configuración privada del emisor APRS en Firestore ─────────────────────
//
// Un único documento, `APRS_PRIVADO/emisor`, con el secreto de la firma, el
// último contador usado, el indicativo, el destinatario APRS y la ruta. Solo lo
// lee y escribe el propietario: lo garantizan las reglas de Firestore
// (`firestore.rules`, local y fuera de Git; ver APRS_EMISOR.md), no esta interfaz.
//
// El secreto no pasa por localStorage, por el estado de React ni por la URL: la
// página solo guarda su longitud, y se lee dentro de la transacción que reserva
// el contador, justo antes de firmar.

import { doc, getDoc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

export const COLECCION = 'APRS_PRIVADO'
export const DOCUMENTO = 'emisor'
const ref = () => doc(db, COLECCION, DOCUMENTO)

/** Configuración sin el secreto: `secretoLargo` es su longitud (0 = sin guardar). */
export async function leerConfigPublica() {
  const snap = await getDoc(ref())
  const d = snap.exists() ? snap.data() : {}
  return {
    indicativo: typeof d.indicativo === 'string' ? d.indicativo : '',
    destinatario: typeof d.destinatario === 'string' ? d.destinatario : 'ALERTA',
    ruta: typeof d.ruta === 'string' ? d.ruta : 'WIDE1-1,WIDE2-1',
    contador: Number.isInteger(d.contador) ? d.contador : 0,
    secretoLargo: typeof d.secreto === 'string' ? d.secreto.length : 0,
  }
}

/** Guarda solo los campos presentes: un secreto vacío no borra el que ya hay. */
export async function guardarConfig({ indicativo, destinatario, ruta, contador, secreto }) {
  const datos = { actualizado: serverTimestamp() }
  if (indicativo !== undefined) datos.indicativo = indicativo
  if (destinatario !== undefined) datos.destinatario = destinatario
  if (ruta !== undefined) datos.ruta = ruta
  if (Number.isInteger(contador)) datos.contador = contador
  if (secreto) datos.secreto = secreto
  await setDoc(ref(), datos, { merge: true })
}

/**
 * Reserva el siguiente contador de forma atómica y devuelve también el secreto y la
 * configuración leídos en esa misma transacción. Si dos pestañas o dos móviles
 * firman a la vez, cada uno obtiene un contador distinto; ninguno se repite.
 * El contador queda gastado aunque luego no se llegue a emitir: la pasarela admite
 * saltos de hasta 50.
 */
export function reservarContador() {
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref())
    const d = snap.exists() ? snap.data() : {}
    if (typeof d.secreto !== 'string' || !d.secreto) throw new Error('Guarda primero el secreto compartido.')
    const contador = (Number.isInteger(d.contador) ? d.contador : 0) + 1
    tx.set(ref(), { contador, actualizado: serverTimestamp() }, { merge: true })
    return {
      contador,
      secreto: d.secreto,
      indicativo: d.indicativo || '',
      destinatario: d.destinatario || 'ALERTA',
      ruta: typeof d.ruta === 'string' ? d.ruta : 'WIDE1-1,WIDE2-1',
    }
  })
}
