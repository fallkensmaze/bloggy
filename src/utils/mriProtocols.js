// Independent browser implementation of Siemens protocol-print XML.
// Format reference: GIfMI/declutter-mri-protocols (Pullens et al., 2024).
export const MRI_MAX_FILE_BYTES = 25 * 1024 * 1024
export const MRI_MAX_BATCH_BYTES = 75 * 1024 * 1024
export const MRI_MAX_PROTOCOLS = 10000
const clean = value => String(value ?? '').trim()
const tag = node => (node?.localName || node?.nodeName || '').toLowerCase()
const children = node => Array.from(node?.children || [])
const descendants = (node, name) => Array.from(node?.getElementsByTagName('*') || []).filter(n => tag(n) === name.toLowerCase())
const firstText = (node, name) => clean(descendants(node, name)[0]?.textContent)
const attr = (node, name) => clean(Array.from(node.attributes || []).find(a => a.name.toLowerCase() === name.toLowerCase())?.value)
const keyFor = (card, name) => JSON.stringify([card, name])

export function decodeMriXml(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength > MRI_MAX_FILE_BYTES) throw new Error('El XML supera el límite de 25 MB por archivo.')
  let encoding = 'utf-8'
  if ((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 60 && bytes[1] === 0)) encoding = 'utf-16le'
  else if ((bytes[0] === 254 && bytes[1] === 255) || (bytes[0] === 0 && bytes[1] === 60)) encoding = 'utf-16be'
  else {
    const declaration = new TextDecoder('ascii').decode(bytes.subarray(0, 256))
    encoding = declaration.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)?.[1] || encoding
  }
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '') }
  catch { throw new Error(`No se puede decodificar el XML (${encoding}).`) }
}

export function parseMriXml(xml, { fileId = 'xml', fileName = 'protocolos.xml', Parser = globalThis.DOMParser } = {}) {
  if (!Parser) throw new Error('El navegador no dispone de un lector XML.')
  if (xml.length > MRI_MAX_FILE_BYTES) throw new Error('El XML supera el límite de tamaño.')
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('No se admiten XML con DTD ni entidades externas.')
  const doc = new Parser().parseFromString(xml, 'application/xml')
  if (descendants(doc, 'parsererror').length) throw new Error('XML no válido: revisa que sea la exportación completa.')
  const all = Array.from(doc.getElementsByTagName('*'))
  if (all.length > 500000) throw new Error('El XML contiene demasiados elementos. Exporta una región cada vez.')
  const toc = [], protocols = [], warnings = []
  const tocRoot = all.find(n => tag(n) === 'printtoc')
  const scanner = firstText(tocRoot, 'HeaderTitle') || fileName.replace(/\.xml$/i, '')
  function walk(node, context = {}, depth = 0) {
    if (depth > 64) throw new Error('La jerarquía XML es demasiado profunda.')
    let next = context
    const type = tag(node)
    const field = type === 'region' ? 'region' : ['normalexam_dot_engine', 'exam'].includes(type) ? 'exam' : type === 'program' ? 'program' : null
    if (field) next = { ...context, [field]: attr(node, 'name') }
    if (type === 'program') {
      for (const step of children(node)) {
        const name = attr(step, 'name'), id = attr(step, 'Id')
        if (name || id) toc.push({ ...next, name, id, used: false })
      }
    }
    for (const child of children(node)) walk(child, next, depth + 1)
  }
  if (tocRoot) walk(tocRoot)
  const nodes = all.filter(n => tag(n) === 'protocol')
  if (nodes.length + toc.length > MRI_MAX_PROTOCOLS * 2) throw new Error('Demasiadas secuencias: divide la exportación.')
  const tocById = new Map()
  for (const entry of toc) {
    if (!entry.id) continue
    if (!tocById.has(entry.id)) tocById.set(entry.id, [])
    tocById.get(entry.id).push(entry)
  }
  const seenIds = new Set()
  for (const node of nodes) {
    const id = attr(node, 'Id')
    const matches = tocById.get(id) || []
    const headerBlock = children(children(node)[1])[0]
    const legacyPath = clean(children(headerBlock)[0]?.textContent)
    const path = firstText(node, 'HeaderProtPath') || (legacyPath.includes('\\') ? legacyPath : '')
    const parts = path.split('\\').map(clean).filter(Boolean)
    const metadata = matches.find(m => !m.used && m.name === parts.at(-1) && m.program === parts.at(-2)) || (matches.length === 1 ? matches[0] : null)
    const name = parts.at(-1) || metadata?.name || attr(node, 'name')
    const issues = []
    if (!name) issues.push('Secuencia sin nombre reconocible')
    if (!id) issues.push('Falta el Id de origen')
    if (id && seenIds.has(id)) warnings.push(`Id repetido conservado como entrada independiente: ${id}`)
    seenIds.add(id)
    if (metadata) metadata.used = true
    const properties = firstText(node, 'HeaderProperty') || (path && headerBlock ? clean(children(headerBlock)[1]?.textContent) : '')
    const params = new Map()
    const parameterNodes = descendants(node, 'ProtParameter')
    for (const parameter of parameterNodes) {
      let card = parameter.parentElement
      while (card && card !== node && tag(card) !== 'card') card = card.parentElement
      const cardName = card && card !== node ? attr(card, 'name') || attr(card, 'ID') : ''
      const cells = children(parameter)
      const parameterName = clean(cells[0]?.textContent)
      if (!cardName || !parameterName || cells.length !== 2) {
        issues.push('Parámetro incompleto o estructura no reconocida')
        continue
      }
      const key = keyFor(cardName, parameterName)
      if (!params.has(key)) params.set(key, { key, card: cardName, name: parameterName, values: [] })
      params.get(key).values.push(clean(cells[1].textContent))
    }
    if (!params.size) issues.push('Sin parámetros exportados')
    const record = {
      uid: `${fileId}:${protocols.length}`, fileId, fileName, scanner, id, name: name || '(sin nombre)',
      region: parts.at(-4) || metadata?.region || '', exam: parts.at(-3) || metadata?.exam || '',
      program: parts.at(-2) || metadata?.program || '', path: path || [metadata?.region, metadata?.exam, metadata?.program, name].filter(Boolean).join('\\'),
      properties, parameters: [...params.values()], issues: [...new Set(issues)], comparable: params.size > 0 && issues.length === 0,
    }
    protocols.push(record)
  }
  for (const entry of toc.filter(t => !t.used)) {
    protocols.push({ uid: `${fileId}:${protocols.length}`, fileId, fileName, scanner, id: entry.id,
      name: entry.name || '(sin nombre)', region: entry.region || '', exam: entry.exam || '', program: entry.program || '',
      path: [entry.region, entry.exam, entry.program, entry.name].filter(Boolean).join('\\'), properties: '',
      parameters: [], comparable: false, issues: ['Entrada del índice sin cuerpo de parámetros asociado'],
    })
  }
  if (!protocols.length) throw new Error('No se reconocen protocolos Siemens. Se espera PrintTOC y/o Protocol con Card y ProtParameter.')
  if (protocols.length > MRI_MAX_PROTOCOLS) throw new Error('El archivo supera las 10 000 secuencias.')
  const incomplete = protocols.filter(p => !p.comparable).length
  if (incomplete) warnings.push(`${incomplete} secuencias incompletas: no se puede afirmar equivalencia.`)
  return { id: fileId, fileName, scanner, protocols, warnings: [...new Set(warnings)] }
}

export function parameterSignature(protocol) {
  return JSON.stringify([protocol.properties, [...protocol.parameters].sort((a, b) => a.key.localeCompare(b.key)).map(p => [p.key, p.values])])
}

export function compareMriProtocols(left, right) {
  if (!left || !right) return null
  const a = new Map(left.parameters.map(p => [p.key, p])), b = new Map(right.parameters.map(p => [p.key, p]))
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort()
  const rows = keys.map(key => {
    const pa = a.get(key), pb = b.get(key), p = pa || pb
    return { key, card: p.card, name: p.name, left: pa?.values ?? null, right: pb?.values ?? null,
      status: !pa ? 'only-right' : !pb ? 'only-left' : JSON.stringify(pa.values) === JSON.stringify(pb.values) ? 'same' : 'changed' }
  })
  if (left.properties || right.properties) rows.unshift({ key: 'header', card: 'Cabecera', name: 'Propiedades (TA, vóxel…)',
    left: left.properties ? [left.properties] : null, right: right.properties ? [right.properties] : null,
    status: !left.properties ? 'only-right' : !right.properties ? 'only-left' : left.properties === right.properties ? 'same' : 'changed' })
  const differences = rows.filter(r => r.status !== 'same').length
  return { rows, differences, comparable: left.comparable && right.comparable,
    status: !left.comparable || !right.comparable ? 'unknown' : differences ? 'different' : 'same' }
}

export function groupMriProtocols(files, { mode = 'scanners', match = 'path', ignoreCase = true } = {}) {
  const normalize = s => ignoreCase ? clean(s).toLowerCase() : clean(s)
  const groups = new Map()
  for (const file of files) for (const p of file.protocols) {
    const context = mode === 'duplicates' ? [file.id, p.region, p.name] : match === 'name' ? [p.region, p.name] : [p.region, p.exam, p.program, p.name]
    const key = JSON.stringify(context.map(normalize))
    if (!groups.has(key)) groups.set(key, { key, name: p.name, region: p.region, context: mode === 'duplicates' ? `${file.scanner} · ${p.region}` : match === 'name' ? p.region : [p.region, p.exam, p.program].filter(Boolean).join(' / '), protocols: [] })
    groups.get(key).protocols.push(p)
  }
  return [...groups.values()].filter(g => mode !== 'duplicates' || g.protocols.length > 1).map(g => {
    const variants = new Set(g.protocols.filter(p => p.comparable).map(parameterSignature)).size
    const fileIds = new Set(g.protocols.map(p => p.fileId))
    const incomplete = g.protocols.some(p => !p.comparable)
    return { ...g, variants, fileCount: fileIds.size, common: fileIds.size === files.length,
      status: incomplete ? 'unknown' : g.protocols.length === 1 ? 'single' : variants > 1 ? 'different' : 'same' }
  }).sort((a, b) => a.name.localeCompare(b.name) || a.context.localeCompare(b.context))
}

export const MRI_STATUS = { unknown: 'No evaluable', same: 'Iguales en XML', different: 'Con diferencias', single: 'Una entrada' }
export const MRI_DIFF_STATUS = { same: 'Igual', changed: 'Cambiado', 'only-left': 'Solo en A', 'only-right': 'Solo en B' }
export const mriValue = values => values === null ? 'No exportado' : values.map(v => v === '' ? '(vacío)' : v).join(' | ')
