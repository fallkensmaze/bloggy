// ── Temas de examen en XML ──────────────────────────────────────────────────
//
// Cada tema vive en un documento de la colección RADIO_TEMAS con un único campo
// `xml`, que se pega a mano en la consola de Firestore. El formato es:
//
//   <?xml version="1.0" encoding="UTF-8"?>
//   <tema numero="1" titulo="Título del tema">
//     <pregunta>
//       <enunciado>Enunciado de la pregunta</enunciado>
//       <opcion>Una opción incorrecta</opcion>
//       <opcion correcta="si">La opción correcta</opcion>
//     </pregunta>
//     <pregunta tipo="multiple">…varias opciones con correcta="si"…</pregunta>
//   </tema>
//
// El parser es propio y minúsculo a propósito: DOMParser solo existe en el
// navegador, y con un lector propio el mismo código corre en el navegador y en
// `npm run test:radio`, que es donde se comprueba que un tema mal pegado se
// detecta en vez de estudiarse con la respuesta equivocada.

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

/** Decodifica entidades XML, incluidas las numéricas (&#233; y &#xe9;). */
export function decodeEntities(texto) {
  return String(texto).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (todo, cuerpo) => {
    if (cuerpo[0] === '#') {
      const code = cuerpo[1] === 'x' || cuerpo[1] === 'X'
        ? parseInt(cuerpo.slice(2), 16)
        : parseInt(cuerpo.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : todo
    }
    const valor = ENTIDADES[cuerpo.toLowerCase()]
    return valor === undefined ? todo : valor
  })
}

function parseAtributos(cuerpo) {
  const attrs = {}
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m
  while ((m = re.exec(cuerpo)) !== null) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] !== undefined ? m[3] : m[4])
  }
  return attrs
}

/**
 * Árbol mínimo de nodos { name, attrs, text, children }. Ignora la declaración
 * XML, los comentarios y el DOCTYPE; entiende CDATA.
 * @throws {Error} si las etiquetas no cierran o no casan.
 */
export function parseXml(fuente) {
  const src = String(fuente ?? '').trim()
  if (!src) throw new Error('el XML está vacío')

  const raiz = { name: '#raiz', attrs: {}, text: '', children: [] }
  const pila = [raiz]
  const actual = () => pila[pila.length - 1]
  const addText = (t, crudo = false) => {
    if (!t) return
    actual().text += crudo ? t : decodeEntities(t)
  }

  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { addText(src.slice(i)); break }
    if (lt > i) addText(src.slice(i, lt))

    if (src.startsWith('<!--', lt)) {
      const fin = src.indexOf('-->', lt)
      if (fin < 0) throw new Error('comentario sin cerrar')
      i = fin + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const fin = src.indexOf(']]>', lt)
      if (fin < 0) throw new Error('CDATA sin cerrar')
      addText(src.slice(lt + 9, fin), true)
      i = fin + 3
      continue
    }
    if (src.startsWith('<?', lt)) {
      const fin = src.indexOf('?>', lt)
      if (fin < 0) throw new Error('declaración XML sin cerrar')
      i = fin + 2
      continue
    }
    if (src.startsWith('<!', lt)) {
      const fin = src.indexOf('>', lt)
      if (fin < 0) throw new Error('declaración sin cerrar')
      i = fin + 1
      continue
    }

    const gt = src.indexOf('>', lt)
    if (gt < 0) throw new Error('hay una etiqueta sin cerrar («<» sin «>»)')
    const cuerpo = src.slice(lt + 1, gt).trim()

    if (cuerpo.startsWith('/')) {
      const nombre = cuerpo.slice(1).trim().toLowerCase()
      const nodo = actual()
      if (pila.length === 1 || nodo.name !== nombre) {
        throw new Error(`</${nombre}> no cierra <${nodo.name}>`)
      }
      pila.pop()
    } else {
      const solo = cuerpo.endsWith('/')
      const decl = solo ? cuerpo.slice(0, -1) : cuerpo
      const nombre = (decl.match(/^[\w:.-]+/) || [''])[0].toLowerCase()
      if (!nombre) throw new Error('hay una etiqueta sin nombre')
      const nodo = { name: nombre, attrs: parseAtributos(decl.slice(nombre.length)), text: '', children: [] }
      actual().children.push(nodo)
      if (!solo) pila.push(nodo)
    }
    i = gt + 1
  }

  if (pila.length !== 1) throw new Error(`falta cerrar <${actual().name}>`)
  return raiz
}

const hijos = (nodo, nombre) => nodo.children.filter(c => c.name === nombre)
const limpia = texto => String(texto).replace(/\s+/g, ' ').trim()

const VERDAD = new Set(['si', 'sí', 'true', '1', 'x', 'v', 'y', 'yes'])
const esVerdad = valor => VERDAD.has(String(valor ?? '').trim().toLowerCase())

/** Forma comparable de un texto: sin acentos, minúsculas y sin espacios de más. */
export function normaliza(texto) {
  return String(texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Identificador estable de una pregunta, derivado de su enunciado (FNV-1a).
 *
 * El progreso de repaso se guarda contra este id, así que tiene que sobrevivir a
 * volver a pegar el tema: si dependiera de la posición, reordenar una pregunta
 * borraría el historial de todas las demás.
 */
export function hashPregunta(enunciado) {
  let h = 0x811c9dc5
  const s = normaliza(enunciado)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Convierte el XML de un tema en preguntas utilizables.
 *
 * @param {string} xml
 * @returns {{ numero: number|null, titulo: string, preguntas: Array, descartadas: number, avisos: string[] }}
 *   preguntas: { id, enunciado, multi, opciones: [{texto, correcta}], correctas: number[], nota: string }
 * @throws {Error} si el XML no se puede leer o no tiene raíz <tema>.
 */
export function parseTemaXml(xml) {
  const raiz = parseXml(xml)
  const tema = hijos(raiz, 'tema')[0]
  if (!tema) throw new Error('falta la etiqueta raíz <tema>')

  const numeroAttr = Number(tema.attrs.numero)
  const numero = Number.isFinite(numeroAttr) ? numeroAttr : null
  const titulo = limpia(tema.attrs.titulo || '')

  const avisos = []
  const preguntas = []
  const vistos = new Map()
  const bloques = hijos(tema, 'pregunta')

  if (bloques.length === 0) avisos.push('El tema no contiene ninguna <pregunta>.')

  bloques.forEach((bloque, indice) => {
    const etiqueta = `pregunta ${indice + 1}`
    const enunciado = limpia(hijos(bloque, 'enunciado').map(n => n.text).join(' ') || bloque.text)
    const opciones = hijos(bloque, 'opcion').map(n => ({
      texto: limpia(n.text),
      correcta: esVerdad(n.attrs.correcta),
    }))
    const nota = limpia(hijos(bloque, 'nota').map(n => n.text).join(' '))

    if (!enunciado) { avisos.push(`${etiqueta}: sin <enunciado>, se descarta.`); return }
    if (opciones.length < 2) { avisos.push(`${etiqueta}: menos de dos <opcion>, se descarta.`); return }
    if (opciones.some(o => !o.texto)) { avisos.push(`${etiqueta}: alguna <opcion> está vacía, se descarta.`); return }

    const correctas = opciones.map((o, i) => (o.correcta ? i : -1)).filter(i => i >= 0)
    if (correctas.length === 0) {
      avisos.push(`${etiqueta}: ninguna opción lleva correcta="si", se descarta.`)
      return
    }
    if (correctas.length === opciones.length) {
      avisos.push(`${etiqueta}: todas las opciones son correctas, se descarta.`)
      return
    }

    // Dos enunciados idénticos compartirían id y, con él, el progreso de repaso.
    const base = hashPregunta(enunciado)
    const repetidas = (vistos.get(base) || 0) + 1
    vistos.set(base, repetidas)
    if (repetidas > 1) avisos.push(`${etiqueta}: el enunciado se repite en el tema.`)

    preguntas.push({
      id: repetidas > 1 ? `${base}-${repetidas}` : base,
      enunciado,
      multi: esVerdad(bloque.attrs.multi) || bloque.attrs.tipo === 'multiple' || correctas.length > 1,
      opciones,
      correctas,
      nota,
    })
  })

  return { numero, titulo, preguntas, descartadas: bloques.length - preguntas.length, avisos }
}
