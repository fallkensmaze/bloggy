import { FILM_CALIBRATION_SCHEMA, validateCalibrationRecord } from './filmCalibration.js'

const DATABASE_NAME = 'bloggy-film-dosimetry'
const DATABASE_VERSION = 1
const STORE = 'calibrations'
const ACTIVE_KEY = 'bloggy-film-active-calibration'

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB no está disponible en este navegador.'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB.'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function transact(mode, callback) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode)
    const store = transaction.objectStore(STORE)
    let result
    try {
      result = callback(store)
    } catch (error) {
      database.close()
      reject(error)
      return
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(result?.result ?? result)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error || new Error('Falló la operación de almacenamiento.'))
    }
    transaction.onabort = transaction.onerror
  })
}

export async function listFilmCalibrations() {
  const records = await transact('readonly', (store) => store.getAll())
  return (records || []).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
}

export async function getFilmCalibration(id) {
  if (!id) return null
  const record = await transact('readonly', (store) => store.get(id))
  return record ? validateCalibrationRecord(record) : null
}

export async function saveFilmCalibration(calibration) {
  validateCalibrationRecord(calibration)
  const record = { ...calibration, updatedAt: new Date().toISOString() }
  await transact('readwrite', (store) => store.put(record))
  return record
}

export async function deleteFilmCalibration(id) {
  await transact('readwrite', (store) => store.delete(id))
  if (getActiveCalibrationId() === id) setActiveCalibrationId('')
}

export function getActiveCalibrationId() {
  try { return localStorage.getItem(ACTIVE_KEY) || '' } catch { return '' }
}

export function setActiveCalibrationId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch { /* El análisis sigue funcionando durante la sesión. */ }
}

export function serializeFilmCalibration(calibration) {
  validateCalibrationRecord(calibration)
  return JSON.stringify({
    kind: 'bloggy-film-calibration',
    schemaVersion: FILM_CALIBRATION_SCHEMA,
    exportedAt: new Date().toISOString(),
    calibration
  }, null, 2)
}

export function parseFilmCalibration(text) {
  let envelope
  try { envelope = JSON.parse(text) } catch { throw new Error('El archivo no contiene JSON válido.') }
  if (envelope?.kind !== 'bloggy-film-calibration') throw new Error('No es una calibración de película de Bloggy.')
  return validateCalibrationRecord(envelope.calibration)
}

export function downloadFilmCalibration(calibration) {
  const safe = calibration.name.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ_-]+/g, '_')
  const blob = new Blob([serializeFilmCalibration(calibration)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safe || 'calibracion'}.filmcal.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
