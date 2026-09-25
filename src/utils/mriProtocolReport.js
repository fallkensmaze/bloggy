import { makeZip } from './zipDownload.js'
import { MRI_STATUS, MRI_DIFF_STATUS, mriValue } from './mriProtocols.js'

const xml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
function column(index) {
  let result = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result
  return result
}

// OOXML with literal strings only: uploaded text never becomes a formula.
export function mriWorkbook(sheets) {
  const entries = []
  const add = (name, content) => entries.push({ name, data: new TextEncoder().encode(declaration + content) })
  add('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  add('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  add('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  add('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`)
  add('xl/styles.xml', `<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3B4252"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
  sheets.forEach((sheet, i) => {
    if (sheet.rows.length > 1048576) throw new Error('Demasiadas filas para Excel. Reduce los archivos cargados.')
    const width = sheet.rows.reduce((n, r) => Math.max(n, r.length), 1)
    const rows = sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      const text = String(value ?? '')
      if (text.length > 32767) throw new Error('Un valor supera el máximo de caracteres por celda de Excel.')
      return `<c r="${column(c)}${r + 1}" t="inlineStr" s="${r === 0 ? 1 : 0}"><is><t xml:space="preserve">${xml(text.replace(/_x([0-9a-f]{4})_/gi, '_x005F_x$1_'))}</t></is></c>`
    }).join('')}</row>`).join('')
    add(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${width}" width="30" customWidth="1"/></cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${column(width - 1)}${Math.max(1, sheet.rows.length)}"/></worksheet>`)
  })
  return new Blob([makeZip(entries)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function mriReportSheets({ files, groups, mode, match, ignoreCase, left, right, comparison }) {
  const protocols = files.flatMap(f => f.protocols)
  return [
    { name: 'Lectura', rows: [['Concepto', 'Detalle'], ['Aplicación', 'Falken’s Maze · Comparador de protocolos RM'], ['Fecha UTC', new Date().toISOString()],
      ['Modo de agrupación', mode === 'duplicates' ? 'Nombres repetidos dentro de cada archivo y región' : `Entre archivos: ${match === 'name' ? 'región + nombre' : 'región + examen + programa + nombre'}`],
      ['Ignorar mayúsculas en nombres', ignoreCase ? 'Sí' : 'No'], ['Criterio', 'Comparación textual de parámetros y HeaderProperty; se recortan espacios exteriores. No se convierten unidades ni se aplica tolerancia numérica.'],
      ['Alcance', 'Inventario y grupos completos, sin filtros de pantalla. La hoja Comparación contiene solo el par A/B seleccionado.'],
      ['Equivalencia', 'Iguales en XML no implica equivalencia clínica ni igualdad de parámetros que el XML no exporta. Las entradas incompletas no son evaluables.'],
      ['Referencia de formato', 'Pullens et al., Physica Medica 120 (2024), 103342. https://github.com/GIfMI/declutter-mri-protocols'],
      ...files.flatMap(f => [[`Archivo ${f.fileName}`, `${f.scanner} · ${f.protocols.length} entradas`], ...f.warnings.map(w => [`Aviso: ${f.fileName}`, w])]),
      ['Archivo A', left?.fileName || 'Sin selección'], ['Ruta A', left?.path || ''], ['Id A', left?.id || ''],
      ['Archivo B', right?.fileName || 'Sin selección'], ['Ruta B', right?.path || ''], ['Id B', right?.id || ''],
      ['Estado A/B', comparison ? MRI_STATUS[comparison.status] : 'Sin selección']] },
    { name: 'Inventario', rows: [['Archivo', 'Equipo', 'Región', 'Examen', 'Programa', 'Secuencia', 'Id', 'Ruta', 'Cabecera', 'Parámetros distintos', 'Estado', 'Avisos'],
      ...protocols.map(p => [p.fileName, p.scanner, p.region, p.exam, p.program, p.name, p.id, p.path, p.properties, p.parameters.length, p.comparable ? 'Leído' : 'No evaluable', p.issues.join('; ')])] },
    { name: 'Grupos', rows: [['Secuencia', 'Contexto', 'Entradas', 'Variantes evaluables', 'Estado', 'Presente en todos los archivos', ...files.map(f => f.fileName)],
      ...groups.map(g => [g.name, g.context, g.protocols.length, g.variants, MRI_STATUS[g.status], g.common ? 'Sí' : 'No', ...files.map(f => g.protocols.filter(p => p.fileId === f.id).length)])] },
    { name: 'Comparación', rows: [['Sección', 'Parámetro', 'A · referencia', 'B · comparación', 'Estado'],
      ...(comparison?.rows || []).map(r => [r.card, r.name, mriValue(r.left), mriValue(r.right), MRI_DIFF_STATUS[r.status]])] },
  ]
}

export function mriCsv(rows) {
  const cell = value => {
    let text = String(value ?? '')
    if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = "'" + text
    return `"${text.replace(/"/g, '""')}"`
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n')
}
