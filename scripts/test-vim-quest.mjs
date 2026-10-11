import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { CHAPTERS, MISSIONS, VIM_PROGRESS_KEY, firstUnfinished, judgeMission, practiced,
  readProgress, recordResult, sanitizeProgress, splitKeys, starsFor } from '../src/utils/vimQuest.js'

// This exercises the actual CodeMirror/Vim integration in a DOM. It does not
// stand in for a real-browser layout, focus or mobile-keyboard check.
const dom = new JSDOM('<!doctype html><div id="editor"></div>', { pretendToBeVisual: true, url: 'https://vim-quest.test' })
for (const key of ['window', 'Window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'MutationObserver',
  'KeyboardEvent', 'Event', 'InputEvent', 'Node', 'Text', 'DOMRect', 'getComputedStyle', 'innerHeight', 'innerWidth']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
// jsdom has no layout. Supply fixed monospace geometry only (never substitute
// Vim motions), so CodeMirror can resolve vertical cursor coordinates.
const rect = (left, top, width, height) => new dom.window.DOMRect(left, top, width, height)
function lineRect(element) {
  const lines = [...(element.closest('.cm-content')?.querySelectorAll('.cm-line') || [])]
  return rect(0, 22 + Math.max(0, lines.indexOf(element)) * 24, Math.max(1, element.textContent.length) * 10, 24)
}
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.classList.contains('cm-line')) return lineRect(this)
  const content = this.classList.contains('cm-content') ? this : this.querySelector('.cm-content')
  return rect(0, 0, 800, content ? 44 + Math.max(1, content.querySelectorAll('.cm-line').length) * 24 : 24)
}
dom.window.HTMLElement.prototype.getClientRects = function () { return [this.getBoundingClientRect()] }
for (const [property, dimension] of [['offsetHeight', 'height'], ['clientHeight', 'height'], ['offsetWidth', 'width'], ['clientWidth', 'width']]) {
  Object.defineProperty(dom.window.HTMLElement.prototype, property, { configurable: true,
    get() { return this.getBoundingClientRect()[dimension] } })
}
dom.window.Range.prototype.getBoundingClientRect = function () {
  const element = this.startContainer.nodeType === 3 ? this.startContainer.parentElement : this.startContainer
  const line = element.closest?.('.cm-line')
  if (!line) return rect(0, 0, 10, 24)
  const prefix = document.createRange()
  prefix.selectNodeContents(line)
  prefix.setEnd(this.startContainer, this.startOffset)
  return rect(prefix.toString().length * 10, lineRect(line).top, Math.max(0, this.toString().length) * 10, 24)
}
dom.window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()] }
const { createQuestEditor } = await import('../src/utils/vimQuestEditor.js')
const parent = document.getElementById('editor')
dom.window.scrollBy = () => {}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const play = async (editor, sequence) => {
  await new Promise(resolve => setTimeout(resolve, 25))
  for (const key of splitKeys(sequence)) { editor.sendKey(key); await settle() }
}
const create = (text, cursor = [0, 0], extra = {}) => createQuestEditor({ parent, text, cursor, ...extra })

assert.equal(new Set(MISSIONS.map(level => level.id)).size, MISSIONS.length, 'Stable, unique mission identifiers')
for (const [i, chapter] of CHAPTERS.entries()) assert.ok(MISSIONS.some(level => level.chapter === i), chapter.title)

let count = 0
for (const level of MISSIONS) {
  const editor = create(level.initial, level.cursor, { targetCursor: level.targetCursor })
  try {
    assert.equal(judgeMission(level, editor.snapshot()).complete, false, `${level.id}: not solved before any practice`)
    await play(editor, level.solution)
    const snapshot = editor.snapshot()
    assert.equal(judgeMission(level, snapshot).complete, true,
      `${level.id}: ${JSON.stringify({ expectedText: level.targetText ?? level.initial, expectedCursor: level.targetCursor, snapshot, verdict: judgeMission(level, snapshot) })}`)
    assert.equal(snapshot.keyCount, level.par, `${level.id}: hints and efficiency targets count real input, not macro-expanded actions`)
    assert.equal(starsFor(snapshot.keyCount, level.par, false), 3, `${level.id}: model solution earns three stars`)
    assert.equal(judgeMission(level, { ...snapshot, text: snapshot.text + ' ' }).complete, false, `${level.id}: exact spaces matter`)
    assert.equal(judgeMission(level, { ...snapshot, mode: 'insert' }).complete, false, `${level.id}: must leave insertion`)
    count++
  } finally { editor.destroy() }
}

// Undo blocks, dot repetition, visual selections, characterwise vs linewise paste,
// and operator-count multiplication are independent Vim behavior assertions.
for (const [text, keys, expected] of [
  ['abc', 'iXYZ<Esc>u', 'abc'],
  ['abc', 'iXYZ<Esc>u<C-r>', 'XYZabc'],
  ['one two three four five six end', '2d3w', 'end'],
  ['one two', 'yiwwP', 'one onetwo'],
  ['abc def', 'vllcXYZ<Esc>', 'XYZ def'],
  ['red red', 'ciwblue<Esc>w.', 'blue blue'],
  ['a\nb', 'yyp', 'a\na\nb'],
  ['abc', 'A!<Esc>', 'abc!'],
  ['abc', 'iX<BS>Y<CR>Z<Esc>', 'Y\nZabc'],
  ['red blue red', ':%s/red/gold/g<CR>u', 'red blue red'],
]) {
  const editor = create(text)
  try { await play(editor, keys); assert.equal(editor.snapshot().text, expected, `Vim semantics: ${keys}`) }
  finally { editor.destroy() }
}

// A click/selection alone cannot finish a movement lesson; inserted strings are
// not evidence of practiced Normal commands. Macro playback must finish first.
assert.equal(practiced([{ key: 'w', mode: 'insert' }], 'w'), false)
assert.equal(practiced([{ key: 'd', mode: 'prompt' }, { key: 'd', mode: 'prompt' }], 'dd'), false)
const right = MISSIONS[0]
assert.equal(judgeMission(right, { text: right.initial, cursor: right.targetCursor, mode: 'normal', events: [] }).complete, false)
assert.equal(judgeMission(right, { text: right.initial, cursor: right.targetCursor, mode: 'normal', recording: true, events: [{ key: 'l', mode: 'normal' }] }).complete, false)

// Editing a navigation mission must not leave an out-of-bounds target decoration.
const navigation = create(right.initial, right.cursor, { targetCursor: right.targetCursor })
await play(navigation, 'dduddu')
navigation.destroy()

// The editor consumes hardware keys only within its own DOM.
const hardware = create('abc')
hardware.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true }))
assert.deepEqual(hardware.snapshot().cursor, [0, 1])
document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }))
assert.equal(hardware.snapshot().text, 'abc')
assert.equal(hardware.snapshot().keyCount, 1)
hardware.destroy()

const recording = create('a\nb')
await play(recording, 'qaI!<Esc>q')
recording.destroy()
const fresh = create('a\nb')
await play(fresh, '@a')
assert.equal(fresh.snapshot().text, 'a\nb', 'Macro registers do not leak into the next mission')
fresh.destroy()

assert.equal(starsFor(8, 8, false), 3)
assert.equal(starsFor(9, 8, false), 2)
assert.equal(starsFor(8, 8, true), 1)
const progress = recordResult({}, 'right', 4, 3)
assert.deepEqual(recordResult(progress, 'right', 10, 1), progress, 'Replay never downgrades the best result')
assert.equal(firstUnfinished(progress), 1)
const storage = dom.window.localStorage
storage.setItem(VIM_PROGRESS_KEY, JSON.stringify({ version: 1, levels: progress }))
assert.deepEqual(readProgress(storage), progress, 'Progress survives a reload')
storage.setItem(VIM_PROGRESS_KEY, '{broken')
assert.deepEqual(readProgress(storage), {})
assert.deepEqual(readProgress({ getItem() { throw new Error('disabled') } }), {})
assert.deepEqual(sanitizeProgress({ version: 42, levels: progress }), {})
assert.deepEqual(sanitizeProgress({ version: 1, levels: { right: { stars: 4, bestKeys: 4 }, wrongId: { stars: 3, bestKeys: 1 } } }), {})
assert.equal(firstUnfinished(Object.fromEntries(MISSIONS.map(level => [level.id, { stars: 3, bestKeys: 1 }]))), MISSIONS.length - 1)

await settle()
dom.window.close()
console.log(`PASS Vim Quest: ${count} missions, real Vim editing, touch/hardware input, grading and persistence.`)
