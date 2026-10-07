import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import ShieldingWorkspace from '../src/components/shielding/ShieldingWorkspace'
import { ShieldingAccess } from '../src/pages/ShieldingPage'
import '../src/styles.css'
import '../src/styles/shielding.css'

const preview = new URLSearchParams(location.search).has('preview')
globalThis.IS_REACT_ACT_ENVIRONMENT = !preview
const root = createRoot(document.getElementById('root'))
const result = document.getElementById('shielding-test-result')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const render = node => preview ? root.render(<MemoryRouter>{node}</MemoryRouter>) : act(async () => { root.render(<MemoryRouter>{node}</MemoryRouter>) })
const button = label => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent.trim() === label)
const click = async label => { const el = button(label); assert(el, `No encuentro botón: ${label}`); assert(!el.disabled, `Botón deshabilitado: ${label}`); await act(async () => el.click()) }
const field = async (label, value) => {
  const el = [...document.querySelectorAll('input')].find(i => i.getAttribute('aria-label') === label)
  assert(el, `No encuentro campo: ${label}`)
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const point = async (x, y) => {
  const svg = document.querySelector('.sh-canvas'), v = svg.viewBox.baseVal
  const world = { x: v.x + x * v.width, y: v.y + y * v.height }
  const matrix = svg.getScreenCTM(), p = new DOMPoint(world.x, world.y).matrixTransform(matrix)
  await act(async () => { svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, button: 0 })); svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1 })) })
  return world
}
const entityPointer = async (element, from, to = from) => {
  const svg = document.querySelector('.sh-canvas')
  const matrix = svg.getScreenCTM()
  const start = new DOMPoint(from.x, from.y).matrixTransform(matrix)
  const end = new DOMPoint(to.x, to.y).matrixTransform(matrix)
  await act(async () => element.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, clientX: start.x, clientY: start.y, pointerId: 2, button: 0,
  })))
  if (from.x !== to.x || from.y !== to.y) await act(async () => svg.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, clientX: end.x, clientY: end.y, pointerId: 2, buttons: 1,
  })))
  await act(async () => svg.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, clientX: end.x, clientY: end.y, pointerId: 2, button: 0,
  })))
}
const wallGeometry = id => {
  const group = document.querySelector(`[data-entity="wall"][data-id="${id}"]`)
  const line = group.querySelector('line')
  return { element: line, start: { x: Number(line.getAttribute('x1')), y: Number(line.getAttribute('y1')) },
    end: { x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) } }
}
const roomVertices = () => [...document.querySelector('[data-entity="room"] polygon').points].map(point => ({ x: point.x, y: point.y }))
const samePoint = (actual, expected, message) => assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-6, message)
const wallEditingRegression = async () => {
  const ids = [...document.querySelectorAll('[data-entity="wall"]')].map(el => el.dataset.id)
  const original = ids.map(wallGeometry)
  await entityPointer(original[0].element, original[0].start)
  await click('Eliminar elemento')
  assert(document.querySelectorAll('[data-entity="wall"]').length === 3, 'borrar pared conserva otras tres barreras')
  const polygon = document.querySelector('[data-entity="room"] polygon')
  const vertices = roomVertices()
  const center = { x: (vertices[0].x + vertices[2].x) / 2, y: (vertices[0].y + vertices[2].y) / 2 }
  const shift = { x: .3, y: .25 }
  await entityPointer(polygon, center, { x: center.x + shift.x, y: center.y + shift.y })
  assert(document.querySelectorAll('[data-entity="wall"]').length === 3, 'mover sala no reconstruye la pared eliminada')
  assert(!document.querySelector(`[data-id="${ids[0]}"]`), 'el hueco conserva la identidad de la pared eliminada')
  ids.slice(1).forEach((id, index) => {
    const moved = wallGeometry(id), before = original[index + 1]
    samePoint(moved.start, { x: before.start.x + shift.x, y: before.start.y + shift.y }, 'inicio de arista conserva su posición tras el hueco')
    samePoint(moved.end, { x: before.end.x + shift.x, y: before.end.y + shift.y }, 'final de arista conserva su posición tras el hueco')
  })
  const wall = wallGeometry(ids[2])
  await entityPointer(wall.element, wall.start)
  const handle = document.querySelector(`[data-id="${ids[2]}"] [data-handle="start"]`)
  assert(handle, 'pared seleccionada muestra tirador inicial')
  const destination = { x: wall.start.x + .25, y: wall.start.y + .35 }
  await entityPointer(handle, wall.start, destination)
  samePoint(roomVertices()[2], destination, 'arrastrar extremo actualiza el vértice de la sala')
  samePoint(wallGeometry(ids[2]).start, destination, 'se mueve el extremo seleccionado')
  samePoint(wallGeometry(ids[1]).end, destination, 'la pared vecina permanece conectada')
  await click('Deshacer'); await click('Deshacer'); await click('Deshacer')
  assert(document.querySelectorAll('[data-entity="wall"]').length === 4, 'deshacer restaura también la pared borrada')
}
const until = async (condition, label) => {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (condition()) return
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
  }
  throw new Error(`Tiempo agotado: ${label}. ${[...document.querySelectorAll('[role="alert"]')].map(el => el.textContent).join(' ')}`)
}
const stage = label => { result.textContent = `RUNNING · ${label}` }
const owner = { loading: false, isAdmin: true, user: { uid: 'synthetic-owner-for-component-test' } }
const access = authState => render(<ShieldingAccess authState={authState} login={async () => {}} />)
const upload = async file => {
  const input = document.querySelector('input[aria-label="Archivo del plano"]')
  assert(input, 'selector local de archivos disponible')
  const transfer = new DataTransfer()
  transfer.items.add(file)
  await act(async () => { input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })) })
}
const syntheticPng = async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 120; canvas.height = 80
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'; context.fillRect(0, 0, 120, 80)
  context.strokeStyle = '#333'; context.strokeRect(12, 12, 96, 56)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  assert(blob, 'fixture PNG generado por el navegador')
  return new File([blob], 'plano-sintetico.png', { type: 'image/png' })
}
// Valid ASCII-only PDF with two vector pages of different aspect ratios. No
// document downloads, physical data, existing plans, or external dependencies.
const syntheticPdf = () => {
  const first = '0.4 w 10 10 100 60 re S\n'
  const second = '0.4 w 10 10 60 100 re S\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 80] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${first.length} >>\nstream\n${first}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 120] /Resources << >> /Contents 6 0 R >>',
    `<< /Length ${second.length} >>\nstream\n${second}endstream`,
  ]
  let text = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(text.length); text += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = text.length
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new File([text], 'plano-sintetico-dos-paginas.pdf', { type: 'application/pdf' })
}
const calibrate = async realLength => {
  const image = document.querySelector('.sh-canvas-background')
  const originalWidth = Number(image.getAttribute('width'))
  await click('Calibrar escala')
  const start = await point(.2, .35)
  const end = await point(.7, .35)
  await field('Distancia real (m)', String(realLength))
  await click('Aplicar escala')
  assert(document.querySelector('.sh-canvas-scale'), 'la escala métrica aparece después de calibrar')
  const expectedWidth = originalWidth * realLength / Math.hypot(end.x - start.x, end.y - start.y)
  assert(Math.abs(Number(document.querySelector('.sh-canvas-background').getAttribute('width')) - expectedWidth) < 1e-6,
    'la distancia declarada escala el plano, no solo su etiqueta')
}
const assertEmpty = () => {
  assert(!document.querySelector('[data-entity]'), 'el trabajo no sobrevive a la sesión')
  assert(!document.querySelector('.sh-canvas-background'), 'el plano no se recupera después de salir')
}
try {
  if (preview) {
    await render(<ShieldingWorkspace />)
    result.hidden = true
  } else {
    stage('acceso y editor vacío')
    await access({ loading: true, isAdmin: false, user: null })
    assert(!document.querySelector('.sh-canvas'), 'esperar sesión no monta el editor')
    await access({ loading: false, isAdmin: false, user: null })
    assert(!document.querySelector('.sh-canvas'), 'sin sesión no se monta el editor')
    await access({ loading: false, isAdmin: false, user: { uid: 'other' } })
    assert(!document.querySelector('.sh-canvas'), 'otra cuenta no puede abrir el editor')
    await access(owner)
    assert(document.querySelector('.sh-canvas'), 'lienzo visible')
    assert(!document.querySelector('[data-entity="wall"]'), 'no hay sala física por defecto')
    await click('Sala rectangular')
    await point(.2, .2); await point(.65, .65)
    assert(document.querySelectorAll('[data-entity="wall"]').length >= 4, 'rectángulo crea cuatro paredes')
    const wallLabel = document.querySelector('.sh-canvas-wall text')
    const screenFontPx = Number(wallLabel.getAttribute('font-size')) * wallLabel.getScreenCTM().a
    assert(Math.abs(screenFontPx - 11) < .05, 'las etiquetas conservan 11 px legibles al adaptar el lienzo')
    await click('Deshacer')
    assert(!document.querySelector('[data-entity="wall"]'), 'deshacer recupera escena anterior')
    await click('Rehacer')
    stage('barreras, huecos y vértices compartidos')
    await wallEditingRegression()
    stage('varias orientaciones y contribuciones por punto')
    await click('Orientación del equipo')
    await point(.4, .4); await point(.65, .4)
    await field('Nombre de la orientación', 'Hacia bucky')
    await field('Carga de trabajo (%)', '70')
    await field('Apertura del haz en planta (°)', '30')
    assert(document.querySelector('.sh-canvas-beam path'), 'la apertura escrita debe dibujar el cono del haz')
    assert(document.body.textContent.includes('Hacia bucky'), 'nombre editable')
    assert(!document.querySelector('.sh-distribution.is-complete'), 'un 70 % no se normaliza al 100 %')
    await click('Añadir orientación')
    await point(.4, .4); await point(.4, .65)
    await field('Nombre de la orientación', 'Hacia mesa')
    await field('Carga de trabajo (%)', '30')
    await field('Apertura del haz en planta (°)', '25')
    assert(document.querySelectorAll('[data-entity="configuration"]').length === 2, 'un equipo admite dos orientaciones')
    assert(document.querySelector('.sh-distribution.is-complete'), '70 + 30 completa la distribución declarada')
    await field('Carga de trabajo (%)', '31')
    assert(!document.querySelector('.sh-distribution.is-complete'), '101 % se detecta sin ajuste silencioso')
    await field('Carga de trabajo (%)', '30')
    await click('Punto de cálculo')
    await point(.8, .4)
    assert(document.querySelector('[data-entity="point"]'), 'punto añadido')
    assert(document.querySelector('.sh-state-inside') && document.querySelector('.sh-state-outside'),
      'un punto puede recibir primaria de una orientación y quedar fuera de otra')
    assert(document.body.textContent.includes('Dispersión y fuga se evalúan en todas las orientaciones'),
      'dispersión y fuga permanecen en el análisis de todas las orientaciones')
    await click('Seleccionar')
    await click('Deshacer')
    assert(!document.querySelector('[data-entity="point"]'), 'deshacer el punto no borra la orientación')
    await click('Rehacer')
    await click('Resultados')
    assert(document.body.textContent.includes('NCRP'), 'ambos métodos accesibles juntos')
    await click('Calcular CSN y NCRP')
    assert(document.querySelectorAll('.shielding-method-result').length === 2, 'el único botón evalúa los dos métodos')
    assert(document.querySelector('.shielding-missing-data'), 'datos físicos ausentes se señalan como pendientes')
    stage('pérdida del trabajo al cerrar sesión')
    await access({ loading: false, isAdmin: false, user: null })
    assert(!document.querySelector('.sh-canvas'), 'logout desmonta el editor')
    await access(owner)
    assertEmpty()

    const revoked = []
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = url => { revoked.push(url); revoke(url) }
    try {
      stage('importación PNG real y calibración')
      await upload(await syntheticPng())
      await until(() => document.querySelector('.sh-canvas-background') && !document.querySelector('.sh-busy'), 'abrir PNG')
      const pngUrl = document.querySelector('.sh-canvas-background').getAttribute('href')
      assert(pngUrl.startsWith('blob:'), 'el PNG permanece en un objeto local del navegador')
      assert(!document.querySelector('.sh-canvas-scale'), 'no se asigna una escala física al importar')
      await click('Sala rectangular')
      await point(.2, .2)
      assert(!document.querySelector('[data-entity="wall"]'), 'dibujar espera a la calibración explícita')
      await calibrate(5)
      await click('Sala rectangular')
      await point(.2, .2); await point(.65, .65)
      assert(document.querySelectorAll('[data-entity="wall"]').length === 4, 'se puede dibujar encima del PNG calibrado')
      await access({ loading: false, isAdmin: false, user: null })
      assert(revoked.includes(pngUrl), 'logout libera la imagen PNG en memoria')
      await access(owner)
      assertEmpty()

      stage('importación PDF real y selección de página')
      await upload(syntheticPdf())
      await until(() => document.querySelector('[role="dialog"]') && !document.querySelector('.sh-busy'), 'abrir PDF de dos páginas')
      assert(document.querySelector('[role="dialog"]').textContent.includes('2 páginas'), 'PDF reconoce las dos páginas sintéticas')
      await field('Página del PDF', '3')
      await click('Usar esta página')
      await until(() => document.querySelector('[role="dialog"] [role="alert"]'), 'rechazar página fuera del PDF')
      assert(!document.querySelector('.sh-canvas-background'), 'página inválida no genera un plano parcial')
      await field('Página del PDF', '2')
      await click('Usar esta página')
      await until(() => document.querySelector('.sh-canvas-background') && !document.querySelector('[role="dialog"]'), 'renderizar página 2 del PDF')
      const pdfImage = document.querySelector('.sh-canvas-background')
      const pdfUrl = pdfImage.getAttribute('href')
      assert(pdfUrl.startsWith('blob:'), 'la página PDF renderizada permanece local')
      assert(Math.abs(Number(pdfImage.getAttribute('height')) / Number(pdfImage.getAttribute('width')) - 1.5) < 1e-6,
        'se representa la página 2 vertical, no la primera horizontal')
      assert(document.querySelector('.sh-file-name').textContent.includes('página 2'), 'la interfaz identifica la página elegida')
      assert(!document.querySelector('.sh-canvas-scale'), 'un PDF tampoco aporta metros implícitos')
      await calibrate(4)
      await render(<div />)
      assert(revoked.includes(pdfUrl), 'desmontar libera la página PDF rasterizada')
      await access(owner)
      assertEmpty()
    } finally { URL.revokeObjectURL = revoke }
    result.textContent = 'PASS · acceso privado; dibujo y deshacer; dos orientaciones 70/30; primaria por punto; CSN/NCRP juntos; PNG y PDF reales locales; selección de página; calibración; logout/remontaje sin memoria y liberación de imágenes.'
  }
} catch (e) { result.textContent = `FAIL · ${e.stack}` }
