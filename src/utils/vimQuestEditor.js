import { EditorState } from '@codemirror/state'
import { EditorView, Decoration, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { Vim, getCM, vim } from '@replit/codemirror-vim'

const theme = EditorView.theme({
  '&': { fontSize: '16px', backgroundColor: '#1c222c', color: '#e5eaf2' },
  '.cm-content': { fontFamily: 'var(--font-mono, monospace)', padding: '22px 0', minHeight: '240px', caretColor: '#a3be8c' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.9' },
  '.cm-line': { padding: '0 20px 0 12px' },
  '.cm-gutters': { backgroundColor: '#1c222c', border: 'none', color: '#8995a9', paddingLeft: '12px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#252f3b' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#41546a !important' },
  '.cm-cursor': { borderLeftColor: '#a3be8c' },
  '.cm-fat-cursor': { backgroundColor: '#a3be8c', color: '#182125' },
  '&:not(.cm-focused) .cm-fat-cursor': { outline: '1px solid #a3be8c', backgroundColor: 'transparent' },
  '.cm-panels': { backgroundColor: '#252f3b', color: '#e5eaf2' },
  '.cm-vim-panel': { padding: '8px 12px', fontFamily: 'var(--font-mono, monospace)' },
  '.cm-vim-panel input': { color: '#e5eaf2', backgroundColor: '#1c222c', fontSize: '16px', minWidth: '6em' },
  '.vq-target': { outline: '2px solid #ebcb8b', borderRadius: '2px', backgroundColor: '#ebcb8b25' },
}, { dark: true })

export function keyLabel(key) {
  return ({ '<Esc>': 'Esc', '<CR>': 'Enter', '<C-r>': 'Ctrl+r', '<BS>': '⌫', ' ': 'Espacio' })[key] || key
}

function eventKey(event) {
  if (event.isComposing || ['Shift', 'Control', 'Alt', 'Meta', 'Dead', 'Process', 'Unidentified'].includes(event.key)) return null
  if (event.metaKey || event.altKey) return null
  if (event.ctrlKey) return event.key.length === 1 ? `<C-${event.key.toLowerCase()}>` : null
  return ({ Escape: '<Esc>', Enter: '<CR>', Backspace: '<BS>', Tab: '<Tab>',
    ArrowLeft: '<Left>', ArrowRight: '<Right>', ArrowUp: '<Up>', ArrowDown: '<Down>' })[event.key] ||
    (event.key.length === 1 ? event.key : null)
}

// One editor exists at a time. Recreating it isolates history, searches, dot-repeat
// and macro registers between missions; otherwise a previous answer could leak.
export function createQuestEditor({ parent, text, cursor = [0, 0], targetCursor, onChange = () => {} }) {
  Vim.resetVimGlobalState_()
  const events = []
  let view, cm, destroyed = false, pending = false, lastTyped = null
  let keyCount = 0
  const mode = () => cm?.state.dialog?.querySelector('input') ? 'prompt' :
    cm?.state.vim?.insertMode ? 'insert' : cm?.state.vim?.visualMode ? 'visual' : 'normal'
  const snapshot = () => {
    const pos = cm.getCursor()
    return { text: view.state.doc.toString(), cursor: [pos.line, pos.ch], mode: mode(),
      recording: Vim.getVimGlobalState_().macroModeState.isRecording,
      events: [...events], keyCount }
  }
  const notify = () => {
    if (pending || destroyed) return
    pending = true
    queueMicrotask(() => {
      pending = false
      if (!destroyed && cm) onChange(snapshot())
    })
  }
  const record = (key, currentMode = mode()) => {
    events.push({ key, mode: currentMode })
    // Bound the telemetry of a long free-practice session.
    if (events.length > 10000) events.shift()
    keyCount++
    notify()
  }
  const initial = EditorState.create({ doc: text })
  const start = initial.doc.line(cursor[0] + 1).from + cursor[1]
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text, selection: { anchor: start },
      extensions: [
        vim({ status: true }), history(), drawSelection(), lineNumbers(), highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]), theme,
        EditorView.contentAttributes.of({ 'aria-label': 'Editor Vim del reto', spellcheck: 'false',
          autocapitalize: 'off', autocorrect: 'off' }),
        EditorView.updateListener.of(notify),
        EditorView.inputHandler.of((_view, _from, _to, inserted) => {
          if (mode() === 'insert') {
            if (lastTyped !== inserted) for (const character of inserted) record(character, 'insert')
            lastTyped = null
          }
          return false
        }),
        ...(targetCursor ? [EditorView.decorations.compute(['doc'], state => {
          if (targetCursor[0] >= state.doc.lines) return Decoration.none
          const line = state.doc.line(targetCursor[0] + 1)
          if (targetCursor[1] >= line.length) return Decoration.none
          const target = line.from + targetCursor[1]
          return Decoration.set([Decoration.mark({ class: 'vq-target' }).range(target, target + 1)])
        })] : []),
      ],
    }),
  })
  cm = getCM(view)
  const keydown = event => {
    const key = eventKey(event)
    if (key) {
      record(key)
      lastTyped = (mode() === 'insert' || mode() === 'prompt') && key.length === 1 ? key : null
    }
  }
  // Capture only this editor, never page-level shortcuts or text in other fields.
  view.dom.addEventListener('keydown', keydown, true)
  const promptInput = event => {
    // Mobile keyboards may send input without keydown. Prompt text counts as
    // input but must never masquerade as evidence of Normal-mode commands.
    if (mode() === 'prompt' && event.target instanceof HTMLInputElement && event.data) {
      if (lastTyped !== event.data) for (const character of event.data) record(character, 'prompt')
      lastTyped = null
    }
    notify()
  }
  view.dom.addEventListener('input', promptInput)
  cm.on('vim-mode-change', notify)
  cm.on('vim-command-done', notify)
  cm.on('dialog', notify)

  function sendKey(key) {
    if (destroyed) return
    const input = cm.state.dialog?.querySelector('input')
    const targetElement = input || view.contentDOM
    const names = { '<Esc>': ['Escape', 27], '<CR>': ['Enter', 13], '<BS>': ['Backspace', 8], '<C-r>': ['r', 82] }
    const [name, keyCode] = names[key] || [key, key.toUpperCase().charCodeAt(0)]
    const event = new KeyboardEvent('keydown', {
      key: name, keyCode, which: keyCode, ctrlKey: key === '<C-r>',
      shiftKey: key.length === 1 && /[A-Z]/.test(key), bubbles: true, cancelable: true,
    })
    targetElement.dispatchEvent(event)
    if (!event.defaultPrevented) {
      if (input && key.length === 1) {
        const from = input.selectionStart ?? input.value.length
        const to = input.selectionEnd ?? from
        input.setRangeText(key, from, to, 'end')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      } else if (input && key === '<BS>') {
        const from = input.selectionStart ?? input.value.length
        const to = input.selectionEnd ?? from
        input.setRangeText('', from === to ? Math.max(0, from - 1) : from, to, 'end')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      } else if (mode() === 'insert' && key.length === 1) {
        view.dispatch({ ...view.state.replaceSelection(key), userEvent: 'input.type' })
      }
    }
    targetElement.dispatchEvent(new KeyboardEvent('keyup', { key: name, keyCode, which: keyCode, bubbles: true }))
    lastTyped = null
    notify()
  }

  notify()
  return {
    view, snapshot, sendKey,
    focus: () => (cm.state.dialog?.querySelector('input') || view.contentDOM).focus(),
    destroy: () => {
      destroyed = true
      view.dom.removeEventListener('keydown', keydown, true)
      view.dom.removeEventListener('input', promptInput)
      cm.off('vim-mode-change', notify)
      cm.off('vim-command-done', notify)
      cm.off('dialog', notify)
      view.destroy()
    },
  }
}
