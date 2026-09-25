import React from 'react'
import { createRoot } from 'react-dom/client'
import MriProtocolCompare from '../src/pages/MriProtocolCompare.jsx'
import { parseMriXml, compareMriProtocols, groupMriProtocols, decodeMriXml } from '../src/utils/mriProtocols.js'
import { MRI_DEMO_FILES } from '../src/utils/mriProtocolDemo.js'
import '../src/styles.css'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const equal = (a, b, label) => assert(JSON.stringify(a) === JSON.stringify(b), label + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b))
const rejects = (fn, pattern) => { try { fn() } catch (e) { assert(pattern.test(e.message), e.message); return } throw new Error('Expected rejection: ' + pattern) }
const pause = () => new Promise(resolve => setTimeout(resolve, 30))
async function until(fn, label) { for (let i = 0; i < 80; i++) { if (fn()) return; await pause() } throw new Error('Timed out: ' + label) }
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
async function click(text) { const target = button(text); assert(target, 'Missing button: ' + text); target.click(); await pause() }
const rows = selector => document.querySelectorAll(selector + ' tbody tr')
const upload = async list => {
  const transfer = new DataTransfer()
  for (const [name, text] of list) transfer.items.add(new File([text], name, { type: 'application/xml' }))
  const input = document.querySelector('input[type=file]')
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await until(() => !input.disabled, 'file load')
  await pause()
}

try {
  const a = parseMriXml(MRI_DEMO_FILES[0].xml, { fileId: 'a', fileName: 'a.xml' })
  const b = parseMriXml(MRI_DEMO_FILES[1].xml, { fileId: 'b', fileName: 'b.xml' })
  equal(a.protocols.length, 4, 'All A protocols')
  equal(b.protocols.length, 3, 'All B protocols')
  assert(a.protocols.every(p => p.comparable), 'Synthetic body and TOC matching')
  equal([a.protocols[1].region, a.protocols[1].exam, a.protocols[1].program], ['Neuro', 'Craneal', 'Oído'], 'Hierarchy with accents')
  equal(compareMriProtocols(a.protocols[0], a.protocols[1]).differences, 5, 'Photo-style pair: 4 parameters + header')
  equal(compareMriProtocols(a.protocols[0], b.protocols[0]).differences, 1, 'Across scanners: TR only')
  equal(groupMriProtocols([a, b]).length, 5, 'Full-path inventory intersection')
  equal(groupMriProtocols([a, b], { mode: 'duplicates' }).length, 2, 'Two duplicate names in A')
  const namespaced = MRI_DEMO_FILES[0].xml.replace('<ProtocolPrint>', '<ProtocolPrint xmlns="urn:siemens:test">')
  equal(parseMriXml(namespaced).protocols.length, 4, 'Namespace support')
  const noBody = MRI_DEMO_FILES[0].xml.replace(/<PrintProtocol>[\s\S]*<\/PrintProtocol>/, '')
  const indexOnly = parseMriXml(noBody)
  equal(indexOnly.protocols.length, 4, 'Index-only entries retained')
  assert(indexOnly.protocols.every(p => !p.comparable), 'Index-only cannot be equal')
  const corrupt = MRI_DEMO_FILES[0].xml.replace('<Value>525 ms</Value>', '')
  assert(!parseMriXml(corrupt).protocols[0].comparable, 'Malformed parameter cannot be silently equal')
  const empty = MRI_DEMO_FILES[0].xml.replace('<Value>525 ms</Value>', '<Value/>')
  const blank = parseMriXml(empty).protocols[0]
  equal(blank.parameters.find(p => p.name === 'TR').values, [''], 'Empty value preserved')
  const repeated = MRI_DEMO_FILES[0].xml.replace('<Name>TR</Name><Value>525 ms</Value></ProtParameter>', '<Name>TR</Name><Value>525 ms</Value></ProtParameter><ProtParameter><Name>TR</Name><Value>600 ms</Value></ProtParameter>')
  equal(parseMriXml(repeated).protocols[0].parameters.find(p => p.name === 'TR').values, ['525 ms', '600 ms'], 'Repeated parameter preserved')
  const idCollision = MRI_DEMO_FILES[0].xml.replaceAll('a2', 'a1')
  const collision = parseMriXml(idCollision)
  equal(collision.protocols.length, 4, 'Duplicate IDs never overwrite bodies')
  equal(new Set(collision.protocols.map(p => p.uid)).size, 4, 'Unique internal IDs')
  assert(collision.warnings.some(w => w.includes('Id repetido')), 'Duplicate ID warning')
  const headerFallback = MRI_DEMO_FILES[0].xml.replaceAll('HeaderProtPath', 'Path').replaceAll('HeaderProperty', 'Properties')
  equal(parseMriXml(headerFallback).protocols[0].path, a.protocols[0].path, 'Legacy positional header')
  rejects(() => parseMriXml('<a>'), /XML no válido/)
  rejects(() => parseMriXml('<GE><sequence/></GE>'), /No se reconocen/)
  rejects(() => parseMriXml('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///private">]><a>&x;</a>'), /DTD/)
  equal(decodeMriXml(new TextEncoder().encode(MRI_DEMO_FILES[0].xml)), MRI_DEMO_FILES[0].xml, 'UTF-8 decode')

  createRoot(document.getElementById('root')).render(React.createElement(MriProtocolCompare))
  await until(() => button('Probar con un ejemplo'), 'initial render')
  await click('Probar con un ejemplo')
  equal(document.querySelectorAll('.mri-file').length, 2, 'Demo file cards')
  equal(rows('.mri-groups').length, 5, 'All five groups rendered')
  equal(rows('.mri-differences').length, 1, 'TR difference rendered')
  assert(rows('.mri-differences')[0].textContent.includes('525 ms'), 'A value visible')
  await click('Intercambiar A / B')
  assert(rows('.mri-differences')[0].children[1].textContent.includes('600 ms'), 'Swap really reverses A')
  await click('Nombres repetidos')
  equal(rows('.mri-groups').length, 2, 'Duplicate groups rendered')
  equal(rows('.mri-differences').length, 5, 'Five differences rendered')
  await click('t2_tse_ax')
  equal(rows('.mri-differences').length, 0, 'Identical exported parameters')
  assert(document.querySelector('.mri-comparison').textContent.includes('son iguales'), 'Equality message')
  document.querySelector('.mri-parameter-filters input[type=checkbox]').click()
  await pause()
  equal(rows('.mri-differences').length, 5, 'All fields toggle')
  await click('Inventario')
  assert(document.querySelector('.mri-table-count').textContent.includes('7 entradas'), 'Inventory count')
  await click('Vaciar')
  assert(!document.querySelector('.mri-comparison'), 'Clear removes stale comparison')
  await upload(MRI_DEMO_FILES.map(f => [f.name, f.xml]))
  equal(document.querySelectorAll('.mri-file').length, 2, 'Real FileReader path')
  await upload([['valid.xml', MRI_DEMO_FILES[0].xml], ['invalid.xml', '<broken>']])
  equal(document.querySelectorAll('.mri-file').length, 2, 'Invalid batch is atomic')
  assert(document.querySelector('[role=alert]').textContent.includes('No se ha añadido ningún archivo'), 'Invalid batch message')
  await click('Entre equipos')
  const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'missing'))
  select.value = 'missing'; select.dispatchEvent(new Event('change', { bubbles: true })); await pause()
  equal(rows('.mri-groups').length, 3, 'Missing-file filter')
  document.querySelector('.mri-icon-button').click(); await pause()
  equal(document.querySelectorAll('.mri-file').length, 1, 'Remove source')
  assert(!document.querySelector('.mri-comparison'), 'Missing group selection invalidated')
  await click('Vaciar')
  assert(button('Probar con un ejemplo'), 'Reset to initial screen')
  document.getElementById('mri-result').textContent = 'PASS: parser and React interaction assertions'
} catch (e) {
  document.getElementById('mri-result').textContent = 'FAIL: ' + e.stack
}
