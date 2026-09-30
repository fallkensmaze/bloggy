// PTW ASCII MCC water-tank reader, informed by tbezo/pymcc (MIT).
// Preserve each scan's metadata and raw columns; never inherit a preceding scan.
export const MAX_MCC_BYTES = 20 * 1024 * 1024
export function mccNumber(value) {
  if (value == null || String(value).trim() === '') return null
  const text = String(value).trim().replace(',', '.').replace(/[dD]/g, 'E')
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null
}
export function parseMcc(text, fileName = 'archivo.mcc') {
  if (text.length > MAX_MCC_BYTES) throw new Error('El MCC supera 20 MB.')
  const scans = [], global = {}; let scan = null, inData = false, total = 0
  const fail = (line, message) => { throw new Error(`${fileName}, línea ${line + 1}: ${message}`) }
  text.replace(/^\uFEFF/, '').split(/\r\n?|\n/).forEach((raw, lineIndex) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const begin = line.match(/^BEGIN_SCAN\s+(\d+)$/)
    if (begin) {
      if (scan) fail(lineIndex, 'barrido anterior sin END_SCAN.')
      if (scans.length >= 1000) fail(lineIndex, 'máximo 1000 barridos por archivo.')
      scan = { id: begin[1], fileName, metadata: {}, points: [], warnings: [] }; return
    }
    if (/^END_SCAN\s+\d+$/.test(line)) {
      if (!scan || inData) fail(lineIndex, 'cierre de barrido o datos incorrecto.')
      if (line.match(/\d+$/)[0] !== scan.id) fail(lineIndex, 'número END_SCAN incoherente.')
      if (scan.points.length < 3) fail(lineIndex, 'se necesitan al menos tres puntos.')
      scan.points.sort((a,b) => a.x-b.x)
      if (scan.points.some((p,i) => i && p.x === scan.points[i-1].x)) fail(lineIndex, 'posiciones duplicadas; revisar la exportación.')
      scan.type = scan.metadata.SCAN_CURVETYPE || 'UNKNOWN'
      if (!['PDD','INPLANE_PROFILE','CROSSPLANE_PROFILE'].includes(scan.type)) scan.warnings.push('Tipo de barrido no soportado para análisis.')
      scans.push(scan); scan = null; return
    }
    if (line === 'BEGIN_DATA') {
      if (!scan || inData || scan.points.length) fail(lineIndex, 'BEGIN_DATA inesperado.')
      inData = true; return
    }
    if (line === 'END_DATA') {
      if (!inData) fail(lineIndex, 'END_DATA inesperado.')
      inData = false; return
    }
    if (inData) {
      const columns = line.split(/\s+/)
      const x = mccNumber(columns[0]), y = mccNumber(columns[1])
      if (x === null || y === null) fail(lineIndex, 'posición o señal no numérica.')
      const refText = columns[2]?.replace(/^#+/, '')
      const reference = mccNumber(refText)
      if (refText && reference === null) fail(lineIndex, 'referencia no numérica.')
      if (columns.length > 3) fail(lineIndex, 'más de tres columnas: formato no soportado.')
      if (++total > 250000) fail(lineIndex, 'máximo 250000 puntos por archivo.')
      scan.points.push({ x, y, reference }); return
    }
    const eq = line.indexOf('=')
    if (eq > 0) (scan ? scan.metadata : global)[line.slice(0,eq).trim()] = line.slice(eq+1).trim()
  })
  if (scan || inData) throw new Error(`${fileName}: archivo truncado; falta END_SCAN/END_DATA.`)
  if (!scans.length) throw new Error(`${fileName}: no contiene barridos MCC legibles.`)
  return { fileName, global, scans }
}
