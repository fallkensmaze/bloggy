import { useCallback, useRef, useState } from 'react'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { parseTemaXml } from '../../utils/radioXml'
import { makeZip, triggerDownload } from '../../utils/zipDownload'

// Límites de la regla de Firestore para RADIO_TEMAS: un único campo `xml`, que
// es una cadena no vacía de como mucho 200 000 caracteres. Si algo no cumple
// esto, la escritura la rechaza el servidor, así que conviene decirlo antes de
// intentarlo y no gastarle al usuario un viaje para nada.
const MAX_XML = 200000
const ID_VALIDO = /^[A-Za-z0-9._-]{1,120}$/

/** Nombre de fichero → id de documento: «tema-100.xml» queda en «tema-100». */
const idDesdeNombre = nombre => nombre.replace(/\.xml$/i, '').trim()

/**
 * Lee un fichero y lo deja listo para subir, o con el motivo por el que no se
 * puede. Nunca lanza: un fichero malo no puede tumbar la lista de los demás.
 */
async function revisa(file, existentes) {
  const base = { nombre: file.name, id: idDesdeNombre(file.name), xml: '', tema: null, error: null }
  let xml = ''
  try {
    xml = await file.text()
  } catch (err) {
    return { ...base, error: `no se ha podido leer el fichero: ${err.message}` }
  }
  if (!ID_VALIDO.test(base.id)) return { ...base, xml, error: 'el nombre del fichero no sirve como id de documento' }
  if (!xml.trim()) return { ...base, xml, error: 'el fichero está vacío' }
  if (xml.length > MAX_XML) return { ...base, xml, error: `ocupa ${xml.length} caracteres y el máximo son ${MAX_XML}` }
  try {
    const tema = parseTemaXml(xml)
    if (tema.preguntas.length === 0) return { ...base, xml, tema, error: 'no tiene ninguna pregunta utilizable' }
    return { ...base, xml, tema, existe: existentes.has(base.id) }
  } catch (err) {
    return { ...base, xml, error: err.message }
  }
}

/**
 * Subida de temas a RADIO_TEMAS desde la propia página, con la sesión de
 * administración ya abierta. Cada fichero se valida con el mismo lector que usa
 * el examen antes de escribir nada: lo que no se puede leer aquí tampoco se
 * podría estudiar después, y subirlo solo serviría para romper la lista.
 */
function TemaUploader({ existentes, onSubido }) {
  const [fichas, setFichas] = useState([])
  const [subiendo, setSubiendo] = useState(false)
  const [resultados, setResultados] = useState(null)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const acepta = useCallback(async (lista) => {
    const files = [...lista].filter(f => /\.xml$/i.test(f.name))
    if (files.length === 0) { setError('Arrastra ficheros .xml, uno por tema.'); return }
    setError('')
    setResultados(null)
    const ids = new Set(existentes)
    const revisadas = await Promise.all(files.map(f => revisa(f, ids)))
    revisadas.sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }))
    setFichas(revisadas)
  }, [existentes])

  const subir = async () => {
    const buenas = fichas.filter(f => !f.error)
    if (buenas.length === 0) return
    setSubiendo(true)
    setError('')
    const hechas = []
    for (const f of buenas) {
      try {
        await setDoc(doc(db, 'RADIO_TEMAS', f.id), { xml: f.xml })
        hechas.push({ id: f.id, ok: true })
      } catch (err) {
        hechas.push({
          id: f.id,
          ok: false,
          motivo: err?.code === 'permission-denied'
            ? 'las reglas de Firestore han rechazado la escritura'
            : err.message,
        })
      }
    }
    setResultados(hechas)
    setSubiendo(false)
    setFichas([])
    if (inputRef.current) inputRef.current.value = ''
    if (hechas.some(h => h.ok)) onSubido?.()
  }

  // Copia de seguridad: el temario solo vive en Firestore, así que antes de
  // sobrescribir nada conviene poder bajarse lo que hay tal cual está.
  const descargar = async () => {
    setSubiendo(true)
    setError('')
    try {
      const snap = await getDocs(collection(db, 'RADIO_TEMAS'))
      const entradas = snap.docs
        .map(d => ({ name: `${d.id}.xml`, data: new TextEncoder().encode(String(d.data()?.xml ?? '')) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
      if (entradas.length === 0) { setError('No hay ningún tema que descargar.'); return }
      triggerDownload(makeZip(entradas), `radio-temas-${new Date().toISOString().slice(0, 10)}.zip`)
    } catch (err) {
      setError(`No se han podido descargar los temas: ${err.message}`)
    } finally {
      setSubiendo(false)
    }
  }

  const buenas = fichas.filter(f => !f.error)
  const malas = fichas.filter(f => f.error)
  const sobrescriben = buenas.filter(f => f.existe)

  return (
    <div className="calc-card ra-subida" style={{ marginBottom: '16px' }}>
      <div className="ra-card-head">
        <span className="field-label" style={{ marginBottom: 0 }}>Subir temas</span>
        <span className="ra-chips">
          <button className="ra-btn ra-btn--sm" onClick={descargar} disabled={subiendo}>
            <i className="bi bi-download" /> Descargar los de Firestore
          </button>
          <button className="ra-btn ra-btn--sm" onClick={() => inputRef.current?.click()} disabled={subiendo}>
            <i className="bi bi-folder2-open" /> Elegir ficheros
          </button>
        </span>
      </div>

      <div
        className="ra-subida-zona"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); acepta(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
      >
        <i className="bi bi-filetype-xml" />
        <span>Arrastra aquí los <code>tema-NNN.xml</code> o pulsa para elegirlos. El nombre del fichero es el id del documento.</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        multiple
        hidden
        onChange={e => acepta(e.target.files)}
      />

      {error && <p className="ra-estado-error">{error}</p>}

      {fichas.length > 0 && (
        <>
          <ul className="ra-subida-lista">
            {fichas.map(f => (
              <li key={f.nombre} className={f.error ? 'ra-subida-item--ko' : ''}>
                <strong>{f.id}</strong>
                {f.error ? (
                  <span className="ra-estado-error"> · {f.error}</span>
                ) : (
                  <span>
                    {' · '}{f.tema.preguntas.length} preguntas
                    {f.tema.numero != null ? ` · nº ${f.tema.numero}` : ''}
                    {f.tema.titulo ? ` · ${f.tema.titulo}` : ''}
                    {f.tema.descartadas > 0 ? ` · ${f.tema.descartadas} descartadas` : ''}
                    {f.existe
                      ? <span className="ra-subida-tag ra-subida-tag--pisa">sobrescribe</span>
                      : <span className="ra-subida-tag">nuevo</span>}
                  </span>
                )}
                {!f.error && f.tema.avisos.length > 0 && (
                  <ul>{f.tema.avisos.map((a, i) => <li key={i} className="ra-estado-error">{a}</li>)}</ul>
                )}
              </li>
            ))}
          </ul>

          <p className="ra-subida-resumen">
            {buenas.length} tema(s) listos, {buenas.reduce((n, f) => n + f.tema.preguntas.length, 0)} preguntas
            {sobrescriben.length > 0 && ` · ${sobrescriben.length} sobrescriben uno existente`}
            {malas.length > 0 && ` · ${malas.length} no se pueden subir`}
          </p>

          <div className="ra-chips">
            <button className="ra-btn ra-btn--primary" onClick={subir} disabled={subiendo || buenas.length === 0}>
              <i className="bi bi-cloud-arrow-up" /> {subiendo ? 'Subiendo…' : `Subir ${buenas.length} tema(s)`}
            </button>
            <button className="ra-btn" onClick={() => { setFichas([]); if (inputRef.current) inputRef.current.value = '' }} disabled={subiendo}>
              Cancelar
            </button>
          </div>
        </>
      )}

      {resultados && (
        <ul className="ra-subida-lista">
          {resultados.map(r => (
            <li key={r.id} className={r.ok ? '' : 'ra-subida-item--ko'}>
              <i className={`bi bi-${r.ok ? 'check-circle' : 'x-circle'}`} />{' '}
              <strong>{r.id}</strong>
              {r.ok ? ' · subido' : <span className="ra-estado-error"> · {r.motivo}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TemaUploader
