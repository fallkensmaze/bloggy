import { useMemo, useState } from 'react'
import { modulate, SAMPLE_RATE } from '../utils/emergencyRadioAudio'

const header = [
  ['0–5', '6', 'Preámbulo AA AA AA AA y sincronismo D3 91'],
  ['6–8', '3', 'Versión de trama (1), tipo y red (7)'],
  ['9–12', '4', 'Origen, emisor de este salto, destino final y siguiente salto'],
  ['13–14', '2', 'TTL restante y prioridad'],
  ['15–18', '4', 'Sesión de arranque y secuencia, dos bytes cada una'],
  ['19', '1', 'Intento extremo a extremo: 0, 1 o 2'],
  ['20–21', '2', 'Longitud L del contenido'],
  ['22…', 'L', 'Contenido del mensaje o del anuncio'],
  ['22+L–23+L', '2', 'CRC-16 de cabecera y contenido'],
]
const types = [
  ['HELLO', 'Vecinos oídos; dos indicadores por vecino: enlace simétrico y elegido como MPR.', 'Solo a un salto.'],
  ['TOPOLOGY', 'Identificadores de los vecinos simétricos de quien origina el anuncio.', 'Difusión mediante MPR, con TTL y duplicados suprimidos.'],
  ['DATA', 'Texto UTF-8 de hasta 96 bytes; los acentos pueden ocupar más de un byte.', 'Unicast por las rutas aprendidas.'],
  ['ACK final', 'Origen, sesión y secuencia del DATA (5 bytes), más su intento (1 byte).', 'Vuelve al origen; permite confirmar la entrega.'],
  ['ACK de salto', 'Tipo, origen, sesión, secuencia e intento de la trama recibida: 7 bytes.', 'Respuesta al vecino anterior; no confirma la entrega final.'],
  ['PROBE', 'Texto de prueba para comparar interferencias.', 'Sin rutas ni acuses; no cuenta como mensaje de usuario.'],
]

export default function EmergencyProtocolGuide({ sim, node }) {
  const [byte, setByte] = useState(0x41)
  const { config } = sim
  const bits = byte.toString(2).padStart(8, '0').split('')
  const signal = useMemo(() => {
    const samples = modulate(Uint8Array.of(byte), config.baud)
    return Array.from(samples, (value, i) => `${i ? 'L' : 'M'}${(800 * i / samples.length).toFixed(2)},${(86 - value * 26).toFixed(2)}`).join(' ')
  }, [byte, config.baud])
  const neighbors = sim.symmetricNeighbors(node)
  const direct = new Set(neighbors.map(v => v.id))
  const candidates = neighbors.map(v => ({ id: v.id, covers: [...new Set(v.report.filter(r => r.symmetric && r.id !== node.id && !direct.has(r.id)).map(r => r.id))].sort((a, b) => a - b) }))
  const twoHop = [...new Set(candidates.flatMap(v => v.covers))].sort((a, b) => a - b)
  const covered = new Set(candidates.filter(v => node.mpr.has(v.id)).flatMap(v => v.covers))
  const selectors = neighbors.filter(v => v.report.some(r => r.id === node.id && r.mpr)).map(v => v.id)
  const labels = ids => [...ids].map(id => sim.label(id)).join(', ') || 'Ninguno'
  const duration = bytes => (bytes * 8 / config.baud).toFixed(3)

  return <section id="em-protocol-guide" className="em-protocol-guide">
    <h2>El protocolo, paso a paso</h2>
    <p>Guía de la versión 0.2 del laboratorio. Los valores y el ejemplo MPR se actualizan con el ensayo y la estación seleccionada.
      Es un protocolo experimental propio, inspirado en la selección MPR de OLSR; no es compatible con sus tramas ni con un módem de radio real.</p>

    <details><summary>1. Qué sabe cada estación y cómo se simula el canal</summary>
      <p>Cada estación tiene su propia memoria de vecinos, anuncios, rutas, colas y mensajes. El protocolo aprende de las tramas que decodifica.
        El simulador conoce las posiciones para generar la señal recibida, pero no entrega ese mapa al algoritmo de rutas.</p>
      <div className="em-guide-columns"><div><h3>Potencia recibida</h3>
        <p className="em-equation">Pᵣ = 18 + Pₜ − 30 log₁₀(max(d, 20) / 100) − L</p>
        <p>Son dB relativos y distancias del plano conceptual. Pₜ es el ajuste del emisor y L una pérdida adicional del enlace.
          No son vatios, dBm ni una predicción de cobertura en metros. La ganancia de amplitud es 10<sup>Pᵣ/20</sup>.</p></div>
        <div><h3>Lo que oye un receptor</h3><p className="em-equation">yᵣ[k] = Σ gᵢᵣ · xᵢ[k] + nᵣ[k]</p>
          <p>Se suman las emisiones que coinciden en el tiempo y ruido blanco uniforme de RMS unitario a 0 dB.
            La semilla y el instante fijan el ruido: la escucha, el WAV y el decodificador utilizan las mismas muestras.</p></div></div>
      <p>Las ganancias se fijan al comenzar cada transmisión. La apertura para decodificar exige una señal al menos {config.squelchDb} dB sobre el ruido.
        El audio de escucha conserva también señales débiles y ruido, como una escucha abierta; durante la transmisión propia se silencia el receptor.
        Una señal dominante puede sobrevivir a una mezcla, pero esta suma lineal no reproduce la captura ni el limitador de FM.</p>
    </details>

    <details><summary>2. Modulación BFSK: bits, tonos y recuperación del mensaje</summary>
      <p>Un bit 0 produce un tono de <b>1200 Hz</b>; un bit 1, uno de <b>2400 Hz</b>. Son frecuencias de audio.
        La fase continúa al cambiar de tono. Se generan {SAMPLE_RATE} muestras por segundo; la tasa de bits elegida es {config.baud} bit/s.</p>
      <label className="em-guide-byte">Byte de ejemplo<select value={byte} onChange={e => setByte(Number(e.target.value))}>
        <option value={0x41}>41 hexadecimal · letra A</option><option value={0x55}>55 hexadecimal · bits alternos</option><option value={0xd3}>D3 hexadecimal · parte del sincronismo</option></select></label>
      <svg viewBox="0 0 800 145" className="em-bit-signal" role="img" aria-label={`Señal BFSK de los bits ${bits.join('')} a ${config.baud} bits por segundo`}>
        {bits.map((bit, i) => <g key={i}><rect x={i * 100} y="0" width="100" height="145" className={bit === '1' ? 'em-bit-one' : 'em-bit-zero'} />
          <line x1={i * 100} x2={i * 100} y1="35" y2="135" /><text x={i * 100 + 50} y="20" textAnchor="middle">{bit} · {bit === '0' ? '1200' : '2400'} Hz</text></g>)}
        <path d={signal} /></svg>
      <p>Se muestra un byte, con el bit más significativo primero: {bits.join('')}. Esta ventana dura {(8000 / config.baud).toFixed(2)} ms.
        Los cambios de frecuencia coinciden con las fronteras de los bits.</p>
      <div className="em-table-scroll"><table><thead><tr><th>Tasa</th><th>Duración del bit</th><th>Muestras/bit</th><th>Ciclos de 1200 / 2400 Hz</th></tr></thead><tbody>
        {[100, 300, 600, 1200].map(rate => <tr key={rate}><td>{rate} bit/s</td><td>{(1000 / rate).toFixed(3)} ms</td><td>{SAMPLE_RATE / rate}</td><td>{1200 / rate} / {2400 / rate}</td></tr>)}
      </tbody></table></div>
      <p>Para cada bit, el receptor correlaciona las muestras con seno y coseno de ambos tonos y compara sus energías:</p>
      <p className="em-equation">E(f) = [Σ y[k] cos(2πfk / Fₛ)]² + [Σ y[k] sin(2πfk / Fₛ)]²</p>
      <p>Decide 1 si E(2400) &gt; E(1200); en otro caso, 0. Después comprueba preámbulo, estructura y CRC.
        El laboratorio proporciona el instante de inicio y el reloj de símbolos: todavía no hay adquisición autónoma de sincronismo, FEC ni corrección de errores.
        Aumentar la tasa acorta la emisión, pero deja menos muestras por bit; no garantiza mejor recepción.</p>
    </details>

    <details><summary>3. Trama binaria, CRC y tiempo ocupado en el canal</summary>
      <p>Cada trama tiene 6 bytes de prefijo, 16 de cabecera, L de contenido y 2 de CRC: <b>24 + L bytes</b>.
        Los enteros de dos bytes llevan primero el byte alto. Los identificadores de estación van de 0 a 254; 255 representa difusión.</p>
      <div className="em-table-scroll"><table><thead><tr><th>Posición desde 0</th><th>Bytes</th><th>Campo</th></tr></thead><tbody>
        {header.map(row => <tr key={row[0]}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}
      </tbody></table></div>
      <p>CRC-16/CCITT-FALSE: polinomio 0x1021, inicio 0xFFFF, sin reflexión y XOR final 0x0000. Protege cabecera y contenido;
        el vector «123456789» da 0x29B1. Detecta errores accidentales, con posibilidad de errores no detectados; no autentica a quien envía.</p>
      <div className="em-table-scroll em-guide-types"><table><thead><tr><th>Tipo</th><th>Contenido</th><th>Recorrido</th></tr></thead><tbody>
        {types.map(row => <tr key={row[0]}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}
      </tbody></table></div>
      <p>A {config.baud} bit/s, un texto de 42 bytes ocupa una trama de 66 bytes y <b>{duration(66)} s por transmisión</b>.
        Un acuse final ocupa {duration(30)} s y uno de salto, {duration(31)} s.
        En cuatro saltos, el DATA, el acuse de vuelta y sus ocho acuses de salto suman {(4 * (66 + 30 + 2 * 31) * 8 / config.baud).toFixed(2)} s de emisiones,
        incluso sin fallos. La latencia añade esperas, anuncios, tiempos de cambio y posibles reintentos.</p>
    </details>

    <details><summary>4. Descubrimiento de vecinos y enlaces en ambos sentidos</summary>
      <ol><li>Al encenderse, el nodo programa su primer HELLO con una espera aleatoria de 0–5 s. Empieza sin rutas remotas.</li>
        <li>Una trama válida de B permite a A anotar «he oído a B». Eso solo demuestra el sentido B → A.</li>
        <li>Cuando A recibe un HELLO de B que incluye a A, conoce evidencia reciente de ambos sentidos y puede usar B como vecino simétrico.</li>
        <li>El HELLO comunica vecinos oídos, simetría y selección MPR. Al leerlo, A aprende también qué vecinos simétricos tiene B: información a dos saltos.</li>
        <li>Los registros envejecen. Apagar un nodo no borra mágicamente las tablas de los demás: se enteran mediante mensajes posteriores, fallos de salto o caducidad.</li></ol>
      <p>Los HELLO nunca se retransmiten. Durante los primeros 60 s de cada nodo, se programan con un periodo de hasta 20 s;
        después se usa el intervalo elegido, ahora {config.helloInterval} s, con variación del ±20 %.
        La cola y el presupuesto de mantenimiento pueden retrasar la emisión. El enlace simétrico caduca si no se mantienen evidencias recientes dentro de {3 * config.helloInterval + 5} s.</p>
    </details>

    <details><summary>5. MPR dinámicos: elección local y ejemplo de {node.label}</summary>
      <p>Un MPR es un vecino elegido para retransmitir anuncios. Cada estación hace su propia elección; no se elige un coordinador global.
        El objetivo es cubrir todos los vecinos estrictos a dos saltos con pocos retransmisores.</p>
      <ol><li>Construir N₁ con los vecinos simétricos recientes.</li>
        <li>Construir N₂ con sus vecinos simétricos, excluyendo al propio nodo y a los miembros de N₁.</li>
        <li>Elegir los candidatos imprescindibles: si un destino de N₂ solo aparece a través de un vecino, ese vecino debe ser MPR.</li>
        <li>Mientras queden destinos sin cubrir, elegir el candidato que cubra más destinos nuevos.</li>
        <li>En empate, preferir uno que ya era MPR, después el que cubra más destinos a dos saltos en total y, por último, el identificador menor.</li></ol>
      <p>Es una heurística voraz con preferencia por mantener selecciones; no garantiza el conjunto mínimo global ni la mejor ruta de radio.
        Se recalcula al recibir información y durante la revisión de caducidades, cada segundo simulado.</p>
      <div className="em-guide-live"><h3>Estado aprendido por {node.label}</h3>
        <p><b>N₁:</b> {labels(direct)}<br /><b>N₂:</b> {labels(twoHop)}<br /><b>MPR elegidos:</b> {labels(node.mpr)}<br />
          <b>Estaciones que han elegido a {node.label}:</b> {labels(selectors)}</p>
        <div className="em-table-scroll"><table><thead><tr><th>Candidato</th><th>Destinos de N₂ que cubre</th><th>Elección actual</th></tr></thead><tbody>
          {candidates.map(v => <tr key={v.id}><td>{sim.label(v.id)}</td><td>{labels(v.covers)}</td><td>{node.mpr.has(v.id) ? 'MPR elegido' : 'No elegido'}</td></tr>)}
          {!candidates.length && <tr><td colSpan="3">Avanza el ensayo para recibir HELLO y confirmar vecinos.</td></tr>}
        </tbody></table></div>
        <p>Cobertura de los MPR: {covered.size} de {twoHop.length} destinos estrictos a dos saltos. Esta tabla utiliza informes recibidos, no las posiciones del mapa.</p></div>
      <p>«A elige a B» y «B elige a A» son decisiones distintas. Cuando cambian los vecinos, los MPR elegidos o quienes eligen al nodo,
        se adelantan anuncios respetando los intervalos mínimos. Así se propagan las nuevas posibilidades de retransmisión sin generar una emisión por cada cambio.</p>
    </details>

    <details><summary>6. Difusión de topología y cálculo de rutas</summary>
      <p>Un nodo elegido como MPR por algún vecino origina anuncios TOPOLOGY con su lista de vecinos simétricos.
        Si deja de ser elegido, envía una retirada vacía. El periodo configurado es {config.topologyInterval} s, con variación del ±20 %.</p>
      <p>En modo MPR, un receptor reenvía un anuncio fresco si el vecino que se lo ha enviado lo eligió como MPR, queda TTL y no lo ha reenviado ya.
        Procesar información y retransmitirla tienen memorias separadas: una primera copia no elegible no impide reenviar otra copia posterior que sí lo sea.
        Las versiones antiguas se descartan y una versión nueva sustituye a otra antigua todavía en cola.</p>
      <p>En el modo «todos retransmiten», cualquier receptor puede reenviar una vez: sirve para comparar la carga.
        Los originadores de anuncios son los mismos en ambos modos.</p>
      <p>El grafo local combina vecinos confirmados, sus informes HELLO y anuncios recibidos. Una búsqueda en anchura encuentra rutas de menor número de saltos.
        Cada retransmisor decide el siguiente salto con su propia tabla. La ruta mostrada al enviar es una estimación del origen; la traza registra el recorrido realmente observado.</p>
      <p>Si se agotan los reintentos hacia un vecino, ese emisor evita ese primer salto durante 30 s y busca otra ruta aprendida.
        Esto no desconecta globalmente al vecino ni presupone dónde está. Los anuncios remotos caducan a los {3 * config.topologyInterval} s;
        alargar los periodos ahorra canal, pero retrasa la convergencia y la eliminación de rutas antiguas.</p>
    </details>

    <details><summary>7. Por qué hay balizas y cómo se evita ocupar todo el canal</summary>
      <p>Incluso sin mensajes, la red conserva anuncios periódicos para descubrir incorporaciones y detectar ausencias.
        No debería emitir continuamente: esta versión espacia los anuncios, agrupa cambios y da preferencia a datos y acuses.</p>
      <ul><li><b>Mantenimiento local:</b> tras emitir un HELLO o TOPOLOGY de duración T, el nodo espera hasta el instante de inicio + T/{config.controlDuty} para otro anuncio.
          Equivale a un presupuesto del {(100 * config.controlDuty).toFixed(0)} % por estación; no es un límite global para toda la red.</li>
        <li><b>Prioridades:</b> primero acuse de salto, después acuse final, DATA por urgencia y, finalmente, HELLO y TOPOLOGY. No se interrumpe una emisión iniciada.</li>
        <li><b>Escucha local:</b> si la energía de otras emisiones supera el umbral relativo de {config.senseDb} dB sobre el ruido, se aplaza la salida entre 0,15 y 1,35 s.</li>
        <li><b>Margen para el acuse:</b> el resto de emisores exige unos 160 ms sin señal detectable; el acuse de salto se programa tras 50–60 ms y usa una guarda de 15 ms.</li>
        <li><b>Durante un intercambio:</b> se aplaza el mantenimiento al oír DATA o un acuse final. Solo pueden reaccionar los nodos que reciben esa información.</li></ul>
      <p>Un terminal oculto sigue siendo posible: A no detecta a C, ambos creen libre el canal y se solapan en B.
        Los reintentos reducen las pérdidas, pero escuchar antes de emitir no resuelve por sí solo ese caso. El control «Velocidad» acelera el reloj de la simulación; no modifica los bit/s.</p>
    </details>

    <details><summary>8. Mensaje, acuse de salto y acuse final</summary>
      <div className="em-table-scroll"><table><thead><tr><th>Respuesta</th><th>Qué demuestra</th><th>Qué hace quien espera</th></tr></thead><tbody>
        <tr><td>Acuse de salto</td><td>El vecino siguiente decodificó esa trama.</td><td>Deja de repetir ese salto. Aún no confirma el mensaje al usuario.</td></tr>
        <tr><td>Acuse final</td><td>El destino final recibió el texto identificado por origen, sesión y secuencia.</td><td>Solo al volver al origen cambia el mensaje a «Recepción confirmada».</td></tr>
      </tbody></table></div>
      <p>DATA y ACK final pueden transmitirse hasta {config.maxHopAttempts} veces por salto. Si no vuelve el acuse local,
        la espera del reintento crece: entre 0,8–2,8 s, 1,6–5,6 s y 3,2–11,2 s. La detección del timeout incluye la duración del acuse y 1,2 s de margen.</p>
      <p>Cada nodo recuerda de qué vecino recibió el DATA, por mensaje e intento. El ACK final sigue esas referencias de vuelta;
        si no quedan referencias válidas, utiliza su tabla de rutas. Esto evita depender exclusivamente de que ya exista una ruta remota de retorno.</p>
      <p>Si falta confirmación final, el origen puede iniciar hasta {config.maxAttempts} intentos completos. Una repetición conserva la identidad del texto:
        el destino lo presenta una sola vez y vuelve a confirmar si es necesario. Los duplicados de un acuse no cambian la hora de la primera confirmación.</p>
      <p>El TTL inicial es {config.ttl} saltos y no se restaura al retransmitir. El origen deja de esperar a los {config.messageLifetime} s;
        las colas intermedias caducan a los 60 s. La trama no lleva una fecha de caducidad absoluta, por lo que aún pueden quedar copias en tránsito cuando el origen abandona.
        No hay garantía de entrega ni de tiempo máximo.</p>
    </details>

    <details><summary>9. Interpretar pérdidas, trazas y límites del modelo</summary>
      <p><b>«Sin confirmación» no permite concluir que el texto no llegó.</b> Puede fallar el camino de ida, el de vuelta o ambos.
        Por eso la tarjeta separa el estado que conoce el emisor de lo que el observador del simulador ve en el destino.</p>
      <p>La traza muestra el receptor al que iba dirigido cada DATA o ACK final y si decodificó esa emisión.
        Una pérdida «con solapamiento» no significa que toda la culpa sea de otra señal: también puede haber ruido.
        El porcentaje general de recepciones válidas incluye escuchas de estaciones distintas del destinatario y excluye señales bajo el umbral.</p>
      <p>Hay sincronismo ideal, suma lineal de audio, geometría fija durante cada emisión y ruido uniforme. No hay FEC, micrófono, RF, VOX/PTT,
        filtrado de un walkie real, autenticación, resolución de identificadores duplicados ni almacenamiento persistente de mensajes.
        Confirmar recepción tampoco confirma lectura humana ni asistencia.</p>
      <p>Para comparar, fija escenario, potencia, ruido y tasa. Prueba simultaneidad frente a turnos, retira el nodo Enlace,
        cambia un MPR y observa las tablas hasta que converjan. WAV conserva la ventana de escucha; JSON incluye estado y trazas recientes, no una reproducción completa de todas las acciones manuales.</p>
    </details>
    <p className="em-guide-sources">Referencias y código:
      {' '}<a href="https://datatracker.ietf.org/doc/html/rfc3626#section-8.3.1" target="_blank" rel="noreferrer">RFC 3626 · MPR</a> ·
      {' '}<a href="https://datatracker.ietf.org/doc/html/rfc3626#section-9" target="_blank" rel="noreferrer">Topología OLSR</a> ·
      {' '}<a href="https://github.com/fallkensmaze/bloggy/blob/main/EMERGENCY_RADIO.md" target="_blank" rel="noreferrer">Especificación del laboratorio</a> ·
      {' '}<a href="https://github.com/fallkensmaze/bloggy/blob/main/src/utils/emergencyRadioAudio.js" target="_blank" rel="noreferrer">Modulador y receptor</a> ·
      {' '}<a href="https://github.com/fallkensmaze/bloggy/blob/main/src/utils/emergencyRadio.js" target="_blank" rel="noreferrer">Motor del protocolo</a>
    </p>
  </section>
}
