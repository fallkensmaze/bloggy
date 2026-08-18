import { useState } from 'react'
import {
  prettyMorse,
  rhythmOf,
  reverseOf,
  textToMorse,
  morseToText,
} from '../../utils/morse'
import { MORSE_CHARS, PROSIGN_LIST, GROUP_LABELS } from '../../utils/morseTrainer'
import { MASTERY, masteryOf } from '../../utils/leitner'

/**
 * Tabla completa con reproducción y un traductor de ida y vuelta. Cada fila
 * lleva el punto de dominio, así que sirve también de mapa de lo que falta.
 */
function ReferencePanel({ progress, play, canPlay }) {
  const [search, setSearch] = useState('')
  const [texto, setTexto]   = useState('CQ CQ DE EA1ABC')
  const [codigo, setCodigo] = useState(() => textToMorse('CQ CQ DE EA1ABC'))

  const filtro = search.trim().toUpperCase()
  const coincide = (char, morse, label = '') =>
    !filtro ||
    char.includes(filtro) ||
    morse.includes(filtro.replace(/·/g, '.').replace(/[–—]/g, '-')) ||
    label.toUpperCase().includes(filtro)

  // Son 54 filas: filtrar en cada tecleo sale más barato que memorizarlo.
  const grupos = Object.entries(GROUP_LABELS).map(([id, label]) => ({
    id,
    label,
    entries: MORSE_CHARS.filter(e => e.group === id && coincide(e.char, e.morse)),
  }))

  const prosignos = PROSIGN_LIST.filter(p => coincide(p.char, p.morse, p.label))
  const vacio = grupos.every(g => g.entries.length === 0) && prosignos.length === 0

  const onTexto = (v) => {
    setTexto(v)
    setCodigo(textToMorse(v))
  }

  const onCodigo = (v) => {
    setCodigo(v)
    setTexto(morseToText(v))
  }

  const fila = (char, morse, label, extra) => (
    <div key={char} className="mr-row">
      <span className="mr-dot" style={{ background: MASTERY[masteryOf(char, progress)].color }} title={MASTERY[masteryOf(char, progress)].label} />
      <span className="mr-row-char">{char}</span>
      <div className="mr-row-main">
        <span className="mr-pattern">{prettyMorse(morse)}</span>
        <span className="mr-row-label">{label}</span>
      </div>
      {canPlay && (
        <button className="mr-play-btn" onClick={() => play(extra ?? char)} aria-label={`Escuchar ${char}`}>
          <i className="bi bi-volume-up" />
        </button>
      )}
    </div>
  )

  return (
    <>
      <input
        className="mr-search"
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar un carácter, un patrón (.-) o un prosigno…"
      />

      {vacio && (
        <p style={{ color: 'var(--text-muted)', fontSize: '13.5px' }}>
          Nada coincide con «{search}».
        </p>
      )}

      {grupos.map(g => g.entries.length > 0 && (
        <div key={g.id}>
          <div className="mr-group-title">{g.label}</div>
          <div className="mr-table">
            {g.entries.map(e => fila(e.char, e.morse, rhythmOf(e.morse) + (reverseOf(e.char) ? ` · espejo de ${reverseOf(e.char)}` : '')))}
          </div>
        </div>
      ))}

      {prosignos.length > 0 && (
        <div>
          <div className="mr-group-title">Prosignos</div>
          <div className="mr-table">
            {prosignos.map(p => fila(
              p.char,
              p.morse,
              p.alt ? `${p.label} · igual que «${p.alt}»` : p.label,
              p.char,
            ))}
          </div>
        </div>
      )}

      <div className="mr-group-title">Traductor</div>
      <div className="mr-decoder">
        <div>
          <span className="field-label">Texto</span>
          <textarea
            value={texto}
            onChange={e => onTexto(e.target.value)}
            spellCheck="false"
            placeholder="Escribe aquí y sale el Morse debajo"
          />
        </div>
        <div>
          <span className="field-label">Morse · espacio entre letras, barra entre palabras</span>
          <textarea
            value={codigo}
            onChange={e => onCodigo(e.target.value)}
            spellCheck="false"
            placeholder="-.-. --.- / -.. ."
          />
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="mr-btn mr-btn--primary" onClick={() => play(texto)} disabled={!canPlay || !texto.trim()}>
            <i className="bi bi-play-circle" style={{ marginRight: '8px' }} />
            Escuchar el texto
          </button>
          <button className="mr-btn" onClick={() => { setTexto(''); setCodigo('') }}>
            <i className="bi bi-eraser" style={{ marginRight: '6px' }} />
            Limpiar
          </button>
        </div>
        <p className="mr-slider-note">
          Los caracteres que no están en la tabla se descartan al codificar; al
          decodificar, un patrón inexistente sale como «#». Varios prosignos
          comparten patrón con un signo de puntuación, así que «.-.-.» vuelve
          como «+» y no como «{'<AR>'}».
        </p>
      </div>
    </>
  )
}

export default ReferencePanel
