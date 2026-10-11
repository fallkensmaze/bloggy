import { useEffect, useRef, useState } from 'react'
import { CHAPTERS, MISSIONS, FREE_TEXT, VIM_PROGRESS_KEY, firstUnfinished, judgeMission,
  practiced, readProgress, recordResult, splitKeys, starsFor } from '../utils/vimQuest'
import { createQuestEditor, keyLabel } from '../utils/vimQuestEditor'
import '../styles/vim-quest.css'

const MODE_LABELS = { normal: 'NORMAL', insert: 'INSERCIÓN', visual: 'VISUAL', prompt: 'COMANDO' }
function getStoredProgress() {
  try { return readProgress(window.localStorage) } catch { return {} }
}
function Keys({ sequence }) {
  return <span className="vq-keys">{splitKeys(sequence).map((key, index) => <kbd key={index}>{keyLabel(key)}</kbd>)}</span>
}

export default function VimQuest() {
  const [progress, setProgress] = useState(getStoredProgress)
  const [index, setIndex] = useState(() => firstUnfinished(getStoredProgress()))
  const [free, setFree] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [snapshot, setSnapshot] = useState(null)
  const [result, setResult] = useState(null)
  const [hint, setHint] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [storageWarning, setStorageWarning] = useState(false)
  const [shift, setShift] = useState(false)
  const parent = useRef(null)
  const editor = useRef(null)
  const hintUsed = useRef(false)
  const level = MISSIONS[index]
  const totalStars = Object.values(progress).reduce((sum, entry) => sum + entry.stars, 0)
  const completed = Object.keys(progress).length
  const unlocked = firstUnfinished(progress)
  const allDone = completed === MISSIONS.length

  useEffect(() => {
    try {
      window.localStorage.setItem(VIM_PROGRESS_KEY, JSON.stringify({ version: 1, levels: progress }))
      setStorageWarning(false)
    } catch { setStorageWarning(true) }
  }, [progress])

  useEffect(() => {
    let won = false
    hintUsed.current = false
    setHint(false)
    setResult(null)
    setFeedback('')
    const instance = createQuestEditor({
      parent: parent.current, text: free ? FREE_TEXT : level.initial,
      cursor: free ? [0, 0] : level.cursor,
      targetCursor: free ? undefined : level.targetCursor,
      onChange: next => {
        setSnapshot(next)
        if (!free && !won && next.keyCount > 0 && judgeMission(level, next).complete) {
          won = true
          const stars = starsFor(next.keyCount, level.par, hintUsed.current)
          setResult({ stars, keys: next.keyCount })
          setFeedback('')
          setProgress(previous => recordResult(previous, level.id, next.keyCount, stars))
        }
      },
    })
    editor.current = instance
    setSnapshot(instance.snapshot())
    return () => { instance.destroy(); editor.current = null }
  }, [level, free, attempt])

  const sendKey = key => editor.current?.sendKey(key)
  const load = newIndex => { setIndex(newIndex); setFree(false); setAttempt(value => value + 1) }
  const revealHint = () => { hintUsed.current = true; setHint(true) }
  const review = () => {
    const done = MISSIONS.map((item, i) => ({ i, stars: progress[item.id]?.stars })).filter(item => item.stars)
    done.sort((a, b) => a.stars - b.stars || a.i - b.i)
    load(done.find(item => item.i !== index)?.i ?? done[0]?.i ?? 0)
  }
  const check = () => {
    if (!snapshot) return
    const verdict = judgeMission(level, snapshot)
    setFeedback(!verdict.normal ? 'Vuelve a NORMAL con Esc. Si estás grabando una macro, termina con q.' :
      !verdict.text ? 'El texto todavía no coincide. Compara los caracteres, espacios y líneas con el objetivo.' :
      !verdict.cursor ? 'El texto está bien. Lleva el cursor al carácter marcado en amarillo.' :
      !verdict.skills ? 'Falta practicar alguno de los comandos de esta misión. Los verás debajo de la explicación.' :
      '¡Objetivo conseguido!')
  }
  const keyButton = (key, label, className = '') => <button key={key} type="button" className={`vq-key ${className}`}
    title={`Enviar ${keyLabel(key)} al editor`} aria-label={`Tecla ${keyLabel(key)}`}
    onPointerDown={event => event.preventDefault()} onClick={() => sendKey(key)}>{label || keyLabel(key)}</button>

  return <div className="page-body vq-page">
    <header className="vq-hero">
      <div>
        <p className="vq-eyebrow">UN JUEGO PARA PENSAR CON LAS MANOS</p>
        <h1>Vim Quest<span className="vq-title-cursor" aria-hidden="true">▍</span></h1>
        <p>De tu primer <kbd>h</kbd> al poder de una macro.<br />Pequeñas misiones. Comandos de verdad. A tu ritmo.</p>
      </div>
      <div className="vq-score" aria-label={`${completed} de ${MISSIONS.length} misiones superadas; ${totalStars} estrellas`}>
        <strong>{completed}<span> / {MISSIONS.length}</span></strong><span>misiones superadas</span>
        <span className="vq-stars">★ {totalStars} <span>/ {MISSIONS.length * 3}</span></span>
      </div>
    </header>
    <progress className="vq-progress" value={completed} max={MISSIONS.length} aria-label="Progreso de la campaña" />
    <div className="vq-toolbar">
      <div className="vq-tabs" aria-label="Modo de juego">
        <button aria-pressed={!free} onClick={() => setFree(false)}>Campaña</button>
        <button aria-pressed={free} onClick={() => setFree(true)}>Taller libre</button>
      </div>
      <button className="vq-button vq-quiet" onClick={review} disabled={!completed}>↻ Repasar</button>
    </div>
    {storageWarning && <p className="vq-notice" role="status">El navegador no permite guardar el progreso. Puedes seguir jugando durante esta visita.</p>}
    {allDone && <p className="vq-graduated">✦ Campaña completada. Ya piensas en Vim. Repite misiones para mejorar tus estrellas o explora el taller.</p>}

    <div className="vq-workspace">
      <section className="vq-play" aria-label="Zona de práctica">
        <div className="vq-terminal">
          <div className="vq-terminal-bar"><span><span aria-hidden="true">● ● ●</span> {free ? 'taller.txt' : `mision-${String(index + 1).padStart(2, '0')}.txt`}</span>
            <span className={`vq-mode vq-mode-${snapshot?.mode || 'normal'}`}>{MODE_LABELS[snapshot?.mode] || 'NORMAL'}</span>
          </div>
          <div ref={parent} className="vq-editor" />
          <div className="vq-status"><span>{snapshot?.recording ? '● Grabando macro' : 'VIM'} · L{(snapshot?.cursor[0] ?? 0) + 1}:C{(snapshot?.cursor[1] ?? 0) + 1}</span>
            <span>{snapshot?.keyCount || 0} pulsaciones</span></div>
        </div>
        <div className="vq-editor-actions">
          <button className="vq-button" onClick={() => editor.current?.focus()}>Activar teclado</button>
          <div className="vq-key-row">{keyButton('<Esc>')}{keyButton('u', 'u ↶')}{keyButton('<C-r>')}</div>
          <button className="vq-button vq-quiet" onClick={() => setAttempt(value => value + 1)}>Reiniciar {free ? 'taller' : 'reto'}</button>
        </div>
        <p className="vq-helper">Haz clic en el editor o pulsa «Activar teclado». <kbd>Esc</kbd> vuelve a NORMAL. Los atajos solo actúan dentro del editor.</p>
        <div className="vq-keystrokes" aria-label="Últimas teclas enviadas"><span>TECLAS</span>
          {snapshot?.events.length ? snapshot.events.slice(-14).map((entry, i) => <kbd key={i}>{keyLabel(entry.key)}</kbd>) : <span>Tu aventura empieza con una tecla…</span>}
        </div>

        {!free && <section className="vq-target-panel" aria-label="Objetivo del reto">
          <h3>{level.targetCursor ? 'ENCUENTRA TU POSICIÓN' : 'ASÍ DEBE QUEDAR'}</h3>
          {level.targetCursor ? <p>Lleva el cursor a <strong>línea {level.targetCursor[0] + 1}, columna {level.targetCursor[1] + 1}</strong>.<br />El destino está marcado en amarillo. Conserva el texto.</p> :
            <pre>{level.targetText.split('\n').map((line, row) => <span className="vq-goal-line" key={row}><span aria-hidden="true">{row + 1}</span>{line || ' '}{'\n'}</span>)}</pre>}
        </section>}

        <details className="vq-touch" open={typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? true : undefined}>
          <summary>Teclado táctil <span>También puedes jugar sin teclado físico</span></summary>
          <div className="vq-keyboard" aria-label="Teclado Vim en pantalla">
            <div className="vq-key-row">{'1234567890'.split('').map(key => keyButton(key))}</div>
            {['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map(row => <div className="vq-key-row" key={row}>
              {row.split('').map(key => keyButton(shift ? key.toUpperCase() : key))}
            </div>)}
            <div className="vq-key-row">{'^$/:;".@%-_!?=()'.split('').map(key => keyButton(key))}</div>
            <div className="vq-key-row">
              <button className="vq-key" aria-pressed={shift} onPointerDown={event => event.preventDefault()} onClick={() => setShift(value => !value)}>Mayús</button>
              {keyButton(' ')}{keyButton('<BS>')}{keyButton('<Esc>')}{keyButton('<CR>')}
            </div>
          </div>
        </details>
      </section>

      <aside className="vq-guide">
        {free ? <>
          <p className="vq-eyebrow">SIN PUNTUACIÓN · SIN PRISAS</p><h2>Tu taller de Vim</h2>
          <p>Prueba combinaciones, equivócate y deshaz. Aquí puedes usar todos los comandos del editor, aunque todavía no hayas llegado a esa misión.</p>
          <p>Normal para dar órdenes. Inserción para escribir. Visual para seleccionar.</p>
          <p className="vq-helper">El texto del taller se reinicia al cambiar de modo o salir de la página.</p>
          <button className="vq-button vq-primary" onClick={() => setFree(false)}>Volver a la campaña</button>
        </> : <>
          <div className="vq-mission-number">CAPÍTULO {level.chapter + 1} <span>·</span> MISIÓN {String(index + 1).padStart(2, '0')}</div>
          <h2>{level.title}</h2>
          <p>{level.lesson}</p>
          <div className="vq-lesson-keys" aria-label="Teclas de esta misión">{level.keys.map(key => keyButton(key))}</div>
          <ul className="vq-objectives">
            {level.required.map(command => <li key={command} className={snapshot && practiced(snapshot.events, command) ? 'is-done' : ''}>
              <span aria-hidden="true">{snapshot && practiced(snapshot.events, command) ? '✓' : '○'}</span> Practica <code>{keyLabel(command)}</code>
            </li>)}
            <li><span aria-hidden="true">○</span> Termina en modo NORMAL.</li>
          </ul>
          <p className="vq-par">✦ Reto de eficiencia: <strong>{level.par} pulsaciones</strong></p>
          {result ? <div className="vq-success" role="status">
            <div className="vq-stars" aria-label={`${result.stars} estrellas`}>{'★'.repeat(result.stars)}{'☆'.repeat(3 - result.stars)}</div>
            <h3>¡Misión superada!</h3><p>{result.keys} pulsaciones. {result.stars === 3 ? 'Precisión de maestro.' : 'Cada intento te da más soltura.'}</p>
            {index < MISSIONS.length - 1 ? <button className="vq-button vq-primary" onClick={() => load(index + 1)}>Siguiente misión →</button> :
              <button className="vq-button vq-primary" onClick={() => setFree(true)}>Explorar el taller →</button>}
            <button className="vq-button vq-quiet" onClick={() => setAttempt(value => value + 1)}>Volver a intentarlo</button>
          </div> : <div className="vq-mission-actions">
            <button className="vq-button vq-primary" onClick={check}>Comprobar objetivo</button>
            <button className="vq-button vq-quiet" onClick={revealHint}>Necesito una pista</button>
          </div>}
          {feedback && <p className="vq-notice" role="status">{feedback}</p>}
          {hint && <div className="vq-hint"><strong>Una forma de resolverlo</strong><p>Desde el texto inicial, pulsa estas teclas en orden. Puedes reiniciar el reto para empezar de nuevo.</p>
            <Keys sequence={level.solution} /><p>Con pista obtienes 1 estrella. Puedes repetir sin ayuda para mejorar.</p></div>}
        </>}
      </aside>
    </div>

    <section className="vq-map" aria-label="Mapa de la campaña">
      <div className="vq-section-heading"><div><p className="vq-eyebrow">TU CAMINO</p><h2>De aprendiz a maestro</h2></div>
        <span>{completed} de {MISSIONS.length} misiones</span></div>
      <div className="vq-chapters">{CHAPTERS.map((chapter, chapterIndex) => {
        const entries = MISSIONS.map((item, i) => ({ ...item, i })).filter(item => item.chapter === chapterIndex)
        const done = entries.filter(item => progress[item.id]).length
        return <section className={`vq-chapter ${!free && level.chapter === chapterIndex ? 'is-current' : ''}`} key={chapter.title}>
          <div className="vq-chapter-heading"><span>{chapter.icon}</span><h3>{chapter.title}</h3><small>{done}/{entries.length}</small></div>
          <p>{chapter.summary}</p><div className="vq-levels">{entries.map(item => <button key={item.id}
            title={`${item.i + 1}. ${item.title}${item.i > unlocked && !progress[item.id] ? ' · Completa las misiones anteriores' : ''}`}
            aria-label={`Misión ${item.i + 1}: ${item.title}${progress[item.id] ? `, ${progress[item.id].stars} estrellas` : ''}`}
            aria-current={!free && index === item.i ? 'step' : undefined}
            disabled={item.i > unlocked && !progress[item.id]} onClick={() => load(item.i)}
            className={progress[item.id] ? 'is-complete' : ''}>
            <strong>{String(item.i + 1).padStart(2, '0')}</strong><span aria-hidden="true">{progress[item.id] ? '★'.repeat(progress[item.id].stars) : item.i > unlocked ? '·' : '→'}</span>
          </button>)}</div>
        </section>
      })}</div>
    </section>

    <details className="vq-reference"><summary>Guía rápida de comandos y reglas del juego</summary>
      <div className="vq-reference-grid">
        <p><strong>Moverse</strong><code>h j k l · w b e · 0 ^ $ · gg G</code>Un número repite el movimiento: 3w.</p>
        <p><strong>Escribir</strong><code>i a I A o O · Esc</code>Minúsculas y mayúsculas hacen cosas diferentes.</p>
        <p><strong>Editar</strong><code>x r · dw dd · ciw ci" · u Ctrl+r</code>Combina una acción con un movimiento u objeto de texto.</p>
        <p><strong>Seleccionar y copiar</strong><code>v V · y yy · p P</code>p pega después; P, antes.</p>
        <p><strong>Buscar</strong><code>/texto Enter · n N · f t ;</code>La búsqueda admite expresiones regulares.</p>
        <p><strong>Automatizar</strong><code>. · :%s/antes/despues/g · qa…q @a</code>Repite un cambio, sustituye texto o reproduce una macro.</p>
      </div>
      <p>★ Con pista · ★★ Sin pista · ★★★ Sin pista y dentro del objetivo de pulsaciones. Se conserva tu mejor resultado. No hay límite de tiempo. Se admiten otras soluciones si dejan el resultado correcto y practican los comandos indicados.</p>
      <p>El progreso se guarda en este navegador. Editor basado en <a href="https://github.com/replit/codemirror-vim" target="_blank" rel="noreferrer">CodeMirror Vim</a>: es una emulación de edición, sin archivos, terminal ni plugins de Vim. Para profundizar: <a href="https://vimhelp.org/usr_02.txt.html" target="_blank" rel="noreferrer">manual de Vim</a>.</p>
    </details>
  </div>
}
