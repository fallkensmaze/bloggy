/** Ajustes compartidos por el curso guiado y las prácticas avanzadas. */
function AudioSettings({
  charWpm,
  effectiveWpm,
  freq,
  canPlay,
  onCharWpm,
  onEffectiveWpm,
  onFreq,
  onTestTone,
}) {
  return (
    <div className="mr-sliders">
      <div>
        <div className="mr-slider-head">
          <label htmlFor="morse-char-wpm">Velocidad de carácter</label>
          <span className="mr-slider-value">{charWpm} PPM</span>
        </div>
        <input
          id="morse-char-wpm"
          className="mr-slider"
          type="range" min="5" max="40" step="1"
          value={charWpm}
          aria-valuetext={`${charWpm} palabras por minuto`}
          onChange={e => onCharWpm(Number(e.target.value))}
        />
        <p className="mr-slider-note">A qué ritmo suena cada carácter por dentro. Conviene no bajar de 18.</p>
      </div>

      <div>
        <div className="mr-slider-head">
          <label htmlFor="morse-effective-wpm">Velocidad efectiva</label>
          <span className="mr-slider-value">{effectiveWpm} PPM</span>
        </div>
        <input
          id="morse-effective-wpm"
          className="mr-slider"
          type="range" min="4" max={charWpm} step="1"
          value={effectiveWpm}
          aria-valuetext={`${effectiveWpm} palabras por minuto`}
          onChange={e => onEffectiveWpm(Number(e.target.value))}
        />
        <p className="mr-slider-note">
          {effectiveWpm < charWpm
            ? 'Farnsworth: mismos caracteres, más silencio entre ellos para poder pensar.'
            : 'Al igualar las dos velocidades desaparece el respiro de Farnsworth.'}
        </p>
      </div>

      <div>
        <div className="mr-slider-head">
          <label htmlFor="morse-tone-frequency">Tono</label>
          <span className="mr-slider-value">{freq} Hz</span>
        </div>
        <input
          id="morse-tone-frequency"
          className="mr-slider"
          type="range" min="300" max="1000" step="10"
          value={freq}
          aria-valuetext={`${freq} hercios`}
          onChange={e => onFreq(Number(e.target.value))}
        />
        <button className="mr-btn mr-btn--sm" style={{ marginTop: '6px' }} onClick={onTestTone} disabled={!canPlay}>
          <i className="bi bi-volume-up" style={{ marginRight: '6px' }} />
          Probar el tono
        </button>
      </div>
    </div>
  )
}

export default AudioSettings
