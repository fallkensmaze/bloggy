# Vim Quest

`/vim-quest` is a public, browser-local game in **Juegos**. The route is lazy-loaded,
including its CodeMirror/Vim dependencies; other applications do not load the editor.

The 34 missions form seven chapters: character movement, word/line/document
movement, insertion, deletion and undo/redo, copying and visual selection, search,
and text objects/dot/substitution/macros. The final mission combines earlier skills.
Every mission provides teaching text, an explicit target, required commands,
an optional step-by-step solution, and an efficiency target counting input keys.
Alternative solutions are accepted if the target and practiced commands match.

## Implementation

- `src/utils/vimQuest.js`: curriculum, exact-text/cursor grading, stars and versioned
  progress validation. Inserted text and search/Ex prompt contents cannot satisfy
  Normal/Visual command requirements.
- `src/utils/vimQuestEditor.js`: CodeMirror 6 with `@replit/codemirror-vim`. Physical
  input and the on-screen keys share the editor event path. Prompt input and
  insertion get ordinary character input; Normal commands keep Vim behavior.
- `src/pages/VimQuest.jsx` and `src/styles/vim-quest.css`: Spanish campaign, chapter
  map, practice mode, goals, hints, input trace and responsive touch keyboard.

The editor emulates Vim editing; it is not a terminal or a Vim installation. It
does not open local files, run shell commands or persist practice text. There are
no Firebase writes or new account requirements. Progress alone is stored under
`falkens_vim_quest_v1`; malformed/unavailable storage is tolerated, and denied
writes are shown to the learner. Stars and best key counts never regress.

Recreating the editor clears undo history, search state, dot-repeat and macro
registers. A single editor is mounted at a time. The adapter uses the Vim package's
global-state reset and recording inspection APIs; the installed versions are
pinned and regression-tested. Never silently replace the Vim engine with a
handwritten subset that teaches different command semantics.

## Validation

Run `npm run test:vim` and `npm run build:web`. The test suite runs all 34 model
solutions through the actual editor adapter and checks independent editing
cases, macro isolation, grading and storage. It uses jsdom with fixed monospace
DOM measurements; it is not a real-browser layout or mobile-keyboard test.
The suite is included in the existing GitHub workflow.

When a browser is available, additionally check desktop and narrow touch layouts,
focus isolation, native text entry, `/` and `:` prompts, hint/retry/next navigation,
reload persistence and the last macro mission. The local implementation session
could not perform this real-browser verification.

Sources for command semantics: [Vim user manual](https://vimhelp.org/usr_02.txt.html),
[editing](https://vimhelp.org/usr_04.txt.html),
[motions](https://vimhelp.org/motion.txt.html), and
[CodeMirror Vim](https://github.com/replit/codemirror-vim).
