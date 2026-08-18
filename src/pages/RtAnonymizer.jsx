import { useState, useRef, useCallback } from 'react'
import {
  prepareStudy,
  anonymizeStudy,
  defaultOptions
} from '../utils/dicomAnonymizer'
import { makeZip, triggerDownload } from '../utils/zipDownload'
import '../styles/rt-anonymizer.css'

const KIND_LABEL = {
  CT: 'CT',
  RTSTRUCT: 'RT Structure Set',
  RTPLAN: 'RT Plan',
  RTDOSE: 'RT Dose',
  RTIMAGE: 'RT Image',
  RTRECORD: 'RT Record',
  RT_ION_PLAN: 'RT Ion Plan',
  RT_ION_RECORD: 'RT Ion Record',
  RT_OTHER: 'RT (avanzado)',
  OTHER: 'Otro'
}
const KIND_BADGE = {
  CT: 'ct',
  RTSTRUCT: 'struct',
  RTPLAN: 'plan',
  RTDOSE: 'dose',
  RTIMAGE: 'rtimg',
  RTRECORD: 'rtimg',
  RT_ION_PLAN: 'plan',
  RT_ION_RECORD: 'rtimg',
  RT_OTHER: 'rtimg',
  OTHER: 'other'
}

function todayIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function isoToDicom(iso) {
  // "YYYY-MM-DD" -> "YYYYMMDD"
  return iso ? iso.replace(/-/g, '') : ''
}

export default function RtAnonymizer() {
  const [files, setFiles] = useState([]) // [{name, buffer}]
  const [prepared, setPrepared] = useState(null)
  const [busy, setBusy] = useState('') // '', 'reading', 'analyzing', 'running'
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState([])

  const [patientName, setPatientName] = useState(defaultOptions().patientName)
  const [patientId, setPatientId] = useState(defaultOptions().patientId)
  const [studyDateIso, setStudyDateIso] = useState(todayIso())
  const [studyTime, setStudyTime] = useState('000000')
  const [keepDescriptors, setKeepDescriptors] = useState(false)
  const [keepPatientCharacteristics, setKeepPatientCharacteristics] = useState(false)
  const [keepDeviceIdentity, setKeepDeviceIdentity] = useState(false)
  const [keepPrivateTags, setKeepPrivateTags] = useState(false)
  const [downloadAsZip, setDownloadAsZip] = useState(true)

  const [progress, setProgress] = useState({ i: 0, total: 0, name: '' })
  const [result, setResult] = useState(null) // { outputs, qaIssues, tableSize, method }
  const [dragOver, setDragOver] = useState(false)

  const folderInputRef = useRef(null)
  const fileInputRef = useRef(null)

  const reset = () => {
    setFiles([])
    setPrepared(null)
    setResult(null)
    setWarnings([])
    setError('')
    setProgress({ i: 0, total: 0, name: '' })
  }

  // --- lectura de archivos (sueltos o carpeta) ---
  const ingestFileList = useCallback(async (fileList) => {
    setBusy('reading')
    setError('')
    try {
      const arr = Array.from(fileList).filter((f) => f && f.size > 0)
      const out = []
      for (const f of arr) {
        const buffer = await f.arrayBuffer()
        out.push({ name: f.webkitRelativePath || f.name, buffer })
      }
      const merged = [...files, ...out]
      setFiles(merged)
      await analyze(merged)
    } catch (e) {
      setError('Error leyendo archivos: ' + e.message)
    } finally {
      setBusy('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])

  const analyze = useCallback(async (allFiles) => {
    setBusy('analyzing')
    setError('')
    try {
      const p = await prepareStudy(allFiles)
      setPrepared(p)
      setWarnings(p.warnings || [])
      setResult(null)
    } catch (e) {
      setError('Error analizando: ' + e.message)
    } finally {
      setBusy('')
    }
  }, [])

  // drag&drop soportando carpetas vía DataTransferItem
  const onDrop = useCallback(
    async (e) => {
      e.preventDefault()
      setDragOver(false)
      const items = e.dataTransfer.items
      const collected = []
      if (items && items.length) {
        const entries = []
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (it.kind !== 'file') continue
          const entry = (it.getAsEntry || it.webkitGetAsEntry)?.call(it)
          if (entry) entries.push(entry)
        }
        await Promise.all(entries.map((en) => walkEntry(en, collected)))
        if (collected.length) {
          const dt = new DataTransfer()
          collected.forEach((f) => dt.items.add(f))
          return ingestFileList(dt.files)
        }
      }
      if (e.dataTransfer.files?.length) return ingestFileList(e.dataTransfer.files)
    },
    [ingestFileList]
  )

  const run = useCallback(async () => {
    if (!prepared) return
    setBusy('running')
    setError('')
    setResult(null)
    try {
      const options = {
        patientName: patientName.trim() || 'Anon^Anon',
        patientId: patientId.trim() || 'ANON',
        studyDate: isoToDicom(studyDateIso) || defaultOptions().studyDate,
        studyTime: studyTime || '000000',
        keepDescriptors,
        keepPatientCharacteristics,
        keepDeviceIdentity,
        keepPrivateTags
      }
      const res = anonymizeStudy(prepared, options, (i, total, name) => {
        setProgress({ i, total, name })
      })
      // ceder al hilo entre archivos para refrescar UI (anonymizeStudy es síncrono)
      // (ya hecho vía callback; aquí solo descargamos)
      const stamp = options.studyDate
      if (downloadAsZip) {
        const zipName = `estudio_anon_${stamp}.zip`
        const blob = makeZip(res.outputs.map((o) => ({ name: o.name, data: o.buffer })))
        triggerDownload(blob, zipName)
        setResult({ ...res, downloadMode: 'zip', downloadName: zipName })
      } else {
        res.outputs.forEach((o) => {
          triggerDownload(new Blob([o.buffer], { type: 'application/dicom' }), o.name)
        })
        setResult({ ...res, downloadMode: 'individual' })
      }
    } catch (e) {
      setError('Error durante la anonimización: ' + e.message)
    } finally {
      setBusy('')
    }
  }, [
    prepared,
    patientName,
    patientId,
    studyDateIso,
    studyTime,
    keepDescriptors,
    keepPatientCharacteristics,
    keepDeviceIdentity,
    keepPrivateTags,
    downloadAsZip
  ])

  const summary = prepared?.summary
  const progressPct =
    progress.total > 0 ? Math.round((progress.i / progress.total) * 100) : 0

  return (
    <div className="page-body rt-anon">
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-shield-lock"></i></div>
        <h1 className="page-title">Anonimizador de estudios RT</h1>
        <p className="page-subtitle">
          Anonimiza un estudio completo de radioterapia (CT + RTSTRUCT + RTPLAN + RTDOSE)
          en el navegador, manteniendo todas las referencias internas.
        </p>
      </div>

      <div className="rta-privacy">
        <i className="bi bi-shield-check"></i>
        <span>
          Todo se procesa <strong>localmente</strong> en tu navegador. Ningún archivo se
          sube a ningún servidor. Revisa siempre el resultado antes de compartirlo.
        </span>
      </div>

      {/* Drop zone */}
      <div
        className={`rta-dropzone${dragOver ? ' over' : ''}${files.length ? ' filled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".dcm,.dicom,.ima,application/dicom"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) ingestFileList(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          {...{ webkitdirectory: '', directory: '' }}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) ingestFileList(e.target.files)
            e.target.value = ''
          }}
        />
        <i className="bi bi-cloud-arrow-up"></i>
        <p className="rta-dz-title">Arrastra aquí el estudio completo</p>
        <p className="rta-dz-sub">archivos .dcm / .ima o una carpeta entera</p>
        <div className="rta-dz-btns">
          <button className="rta-btn ghost" onClick={() => fileInputRef.current?.click()}>
            <i className="bi bi-file-earmark"></i> Seleccionar archivos
          </button>
          <button className="rta-btn ghost" onClick={() => folderInputRef.current?.click()}>
            <i className="bi bi-folder"></i> Seleccionar carpeta
          </button>
          {files.length > 0 && (
            <button className="rta-btn ghost" onClick={reset}>
              <i className="bi bi-arrow-counterclockwise"></i> Limpiar
            </button>
          )}
        </div>
      </div>

      {busy === 'reading' && <div className="rta-status">Leyendo archivos…</div>}
      {busy === 'analyzing' && <div className="rta-status">Analizando DICOM…</div>}
      {error && (
        <div className="rta-error">
          <i className="bi bi-exclamation-triangle"></i> {error}
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className="rta-summary">
          <h3><i className="bi bi-clipboard-data"></i> Estudio detectado</h3>
          <div className="rta-summary-grid">
            <div>
              <span className="lbl">Archivos DICOM</span>
              <span className="val">{summary.total}</span>
            </div>
            <div>
              <span className="lbl">Estudios (StudyUID)</span>
              <span className="val">{summary.studies}</span>
            </div>
            <div>
              <span className="lbl">Paciente original</span>
              <span className="val mono">{summary.originalName || '—'}</span>
            </div>
            <div>
              <span className="lbl">ID original</span>
              <span className="val mono">{summary.originalId || '—'}</span>
            </div>
          </div>
          <div className="rta-kinds">
            {Object.entries(summary.byKind).map(([k, n]) => (
              <span key={k} className={`rta-badge ${KIND_BADGE[k] || 'other'}`}>
                {KIND_LABEL[k] || k} <strong>×{n}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rta-warnings">
          <h4><i className="bi bi-exclamation-circle"></i> Avisos ({warnings.length})</h4>
          <ul>
            {warnings.map((w, i) => (
              <li key={i} className={`lvl-${w.level || 'info'}`}>
                {w.file ? <span className="w-file">{w.file}: </span> : null}
                {w.msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Params */}
      {prepared && (
        <div className="rta-params">
          <h3><i className="bi bi-sliders"></i> Datos de la nueva identidad</h3>
          <div className="rta-form">
            <label>
              <span>Nombre del paciente</span>
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="Apellido^Nombre (formato DICOM)"
              />
            </label>
            <label>
              <span>ID de paciente</span>
              <input
                type="text"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="ANON"
              />
            </label>
            <label>
              <span>Fecha del estudio</span>
              <input
                type="date"
                value={studyDateIso}
                onChange={(e) => setStudyDateIso(e.target.value)}
              />
            </label>
            <label>
              <span>Hora del estudio</span>
              <input
                type="text"
                value={studyTime}
                onChange={(e) => setStudyTime(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="HHMMSS"
              />
            </label>
          </div>

          <h4 className="rta-opt-title">Opciones de privacidad (recomendado: todo desactivado)</h4>
          <div className="rta-options">
            <Toggle
              checked={keepDescriptors}
              onChange={setKeepDescriptors}
              label="Conservar descriptores (StudyDescription, ROIName, BeamName…)"
              hint="Pueden contener el apellido del paciente. Desactívalo salvo necesidad."
            />
            <Toggle
              checked={keepPatientCharacteristics}
              onChange={setKeepPatientCharacteristics}
              label="Conservar características (sexo, edad, peso, talla)"
              hint="PS3.15 las retira por defecto; activarlo es una desviación del perfil básico."
            />
            <Toggle
              checked={keepDeviceIdentity}
              onChange={setKeepDeviceIdentity}
              label="Conservar identidad de equipo (fabricante, modelo, software)"
              hint="Combinados pueden fingerprintar el centro. El nº de serie se borra siempre."
            />
            <Toggle
              checked={keepPrivateTags}
              onChange={setKeepPrivateTags}
              label="Conservar tags privados (vendor)"
              hint="Suelen llevar PHI o datos de fabricante. No recomendado."
            />
          </div>

          <h4 className="rta-opt-title">Descarga</h4>
          <div className="rta-options">
            <Toggle
              checked={downloadAsZip}
              onChange={setDownloadAsZip}
              label="Descargar como ZIP"
              hint="Activado por defecto y recomendado para estudios completos. Desactívalo para descargar cada DICOM anonimizado por separado."
            />
          </div>

          <button
            className="rta-btn primary big"
            onClick={run}
            disabled={busy !== '' || !prepared.entries.length}
          >
            <i className="bi bi-play-fill"></i>{' '}
            {busy === 'running'
              ? 'Anonimizando…'
              : `Ejecutar y descargar ${downloadAsZip ? 'ZIP' : 'archivos'}`}
          </button>

          {busy === 'running' && (
            <div className="rta-progress">
              <div className="bar">
                <div className="fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span>
                {progress.i}/{progress.total} — {progress.name}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Result / QA */}
      {result && (
        <div className="rta-result">
          <h3><i className="bi bi-check2-circle"></i> Anonimización completada</h3>
          <p className="rta-result-line">
            {result.outputs.length} archivos procesados · {result.tableSize} UID remapeados ·{' '}
            nuevos UID bajo <code>{result.uidRoot || '2.25'}.*</code> ·{' '}
            {result.pixelChecks?.length || 0} PixelData verificados · método:{' '}
            <code>{result.method}</code>.{' '}
            {result.downloadMode === 'zip' ? (
              <>Se ha descargado <code>{result.downloadName || 'estudio_anon_*.zip'}</code>.</>
            ) : (
              <>Se han lanzado descargas individuales para cada archivo anonimizado.</>
            )}
          </p>

          {result.uidExamples?.length > 0 && (
            <div className="rta-uid-examples">
              <span>Ejemplos de UID anonimizados:</span>
              {result.uidExamples.map((uid) => (
                <code key={uid}>{uid}</code>
              ))}
            </div>
          )}

          {result.qaIssues.length === 0 ? (
            <div className="rta-qa ok">
              <i className="bi bi-check2"></i> No se detectaron identificadores originales en
              la salida y los PixelData presentes conservaron su hash. Recuerda revisar
              visualmente la PHI «quemada» en píxeles (burned-in) antes de compartir.
            </div>
          ) : (
            <div className="rta-qa warn">
              <h4>
                <i className="bi bi-exclamation-triangle"></i> Revisa estos avisos de QA
                ({result.qaIssues.length})
              </h4>
              <ul>
                {result.qaIssues.slice(0, 50).map((q, i) => (
                  <li key={i} className={`lvl-${q.level}`}>
                    {q.file ? <span className="w-file">{q.file}: </span> : null}
                    {q.msg}
                  </li>
                ))}
                {result.qaIssues.length > 50 && (
                  <li>… y {result.qaIssues.length - 50} más.</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className={`rta-toggle${checked ? ' on' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="rta-toggle-body">
        <span className="rta-toggle-label">{label}</span>
        {hint && <span className="rta-toggle-hint">{hint}</span>}
      </span>
    </label>
  )
}

// Recorre recursivamente un FileSystemEntry (carpeta soltada) recogiendo Files.
async function walkEntry(entry, collected) {
  if (!entry) return
  if (entry.isFile) {
    await new Promise((resolve) => {
      entry.file(
        (file) => {
          // Conserva la ruta relativa si está disponible.
          if (entry.fullPath) {
            try {
              Object.defineProperty(file, 'name', { value: entry.fullPath.replace(/^\//, '') })
            } catch {
              /* nombre original */
            }
          }
          collected.push(file)
          resolve()
        },
        () => resolve()
      )
    })
  } else if (entry.isDirectory) {
    const reader = entry.createReader()
    const readBatch = () =>
      new Promise((resolve) => reader.readEntries((ents) => resolve(ents), () => resolve([])))
    let batch = await readBatch()
    while (batch.length) {
      for (const e of batch) await walkEntry(e, collected)
      batch = await readBatch()
    }
  }
}
