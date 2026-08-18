// ── Códigos Q de radioaficionado ────────────────────────────────────────────
// Datos y lógica pura del quiz de /q-codes.
//
// Cada entrada tiene:
//   code     — el código Q (p. ej. "QRM")
//   group    — tema, usado para elegir distractores verosímiles
//   level    — 'esencial' (los de uso diario) | 'ampliado' (menos frecuentes)
//   meaning  — respuesta corta (lo que se usa como opción en el quiz)
//   question — forma interrogativa oficial («QRM?» pregunta esto)
//   example  — ejemplo de uso en un contacto real; **debe contener el código**,
//              porque el modo «uso en contexto» lo tapa para preguntar por él
//   mnemonic — regla mnemotécnica para recordarlo

import {
  shuffle,
  weightOfKey,
  pickWeighted as pickWeightedItem,
  masterySummary as summarize,
} from './leitner.js'

export { shuffle }
export { MAX_BOX, MASTERY, updateProgress, masteryOf, accuracy } from './leitner.js'

export const GROUP_LABELS = {
  senal:         'Tu señal',
  interferencia: 'Interferencias y ruido',
  potencia:      'Potencia',
  velocidad:     'Ritmo de transmisión',
  frecuencia:    'Frecuencia',
  operacion:     'Operación de la estación',
  mensajes:      'Mensajes y confirmaciones',
  info:          'Datos de la estación',
}

export const LEVELS = [
  { id: 'esencial', label: 'Esenciales', hint: 'Los que se oyen a diario en la banda' },
  { id: 'todos',    label: 'Todos',      hint: 'Incluye los códigos menos frecuentes' },
]

export const QCODES = [
  {
    code: 'QRA', group: 'info', level: 'esencial',
    meaning: 'El nombre de tu estación (u operador)',
    question: '¿Cuál es el nombre de tu estación?',
    example: '«La QRA de esta estación es Radio Club Henares» — sirve para dar el nombre de la estación o del operador.',
    mnemonic: 'La A de «Alias»: tu QRA es cómo se llama tu estación.',
  },
  {
    code: 'QRB', group: 'info', level: 'ampliado',
    meaning: 'La distancia que nos separa',
    question: '¿A qué distancia estás de mi estación?',
    example: '«El QRB entre nosotros es de unos 340 km» — la distancia entre las dos estaciones, típica de VHF y de los locators.',
    mnemonic: 'QRB suena a «¿Qué Ruta y Beneficio?»: la B de la Brecha que nos separa, en kilómetros.',
  },
  {
    code: 'QRG', group: 'frecuencia', level: 'esencial',
    meaning: 'Tu frecuencia exacta',
    question: '¿Cuál es mi frecuencia exacta?',
    example: '«¿QRG?» — «Estás en 7.090, un pelín corrido de la frecuencia de la red».',
    mnemonic: 'QRG → «Give me the frequency»: pide la frecuencia exacta. No confundir con QSY, que es cambiarla.',
  },
  {
    code: 'QRH', group: 'frecuencia', level: 'ampliado',
    meaning: 'Tu frecuencia varía (es inestable)',
    question: '¿Varía mi frecuencia?',
    example: '«Tu portadora tiene QRH, se mueve unos hercios» — típico de osciladores que derivan al calentarse.',
    mnemonic: '«Que Raro, la H-onda se mueve»: la frecuencia no se está quieta.',
  },
  {
    code: 'QRI', group: 'senal', level: 'ampliado',
    meaning: 'Cómo es el tono de tu transmisión (la nota del CW)',
    question: '¿Cómo es el tono de mi transmisión?',
    example: '«Tu QRI es buena, nota limpia» — en CW valora si el tono es claro o chirriante.',
    mnemonic: 'La I de «tImbre»: qué tal suena la nota de tu manipulador.',
  },
  {
    code: 'QRK', group: 'senal', level: 'esencial',
    meaning: 'La legibilidad de tu señal (de 1 a 5)',
    question: '¿Cuál es la legibilidad de mi señal?',
    example: '«Tu QRK es 5, te leo perfectamente» — con QSA forma el clásico reporte «QSA 5, QRK 5».',
    mnemonic: 'La K de «Komprendo»: si te entienden bien o mal, del 1 al 5. QSA es cuánto llegas, QRK cuánto te entienden.',
  },
  {
    code: 'QRL', group: 'operacion', level: 'esencial',
    meaning: 'Estoy ocupado (no molestar)',
    question: '¿Estás ocupado?',
    example: '«QRL ahora mismo, llámame en diez minutos» — la estación está atendiendo otra cosa. En CW «QRL?» es la pregunta obligada antes de ocupar una frecuencia.',
    mnemonic: '«Que ReLío»: estoy liado, no molestes.',
  },
  {
    code: 'QRM', group: 'interferencia', level: 'esencial',
    meaning: 'Interferencia de otras estaciones (provocada por el hombre)',
    question: '¿Sufres interferencias de otras estaciones?',
    example: '«No te copio, hay mucho QRM de la estación de al lado» — el pan de cada día en bandas concurridas.',
    mnemonic: 'La M de «Man-made» (hecho por el hombre): interferencia de otras estaciones. Su pareja natural es QRN.',
  },
  {
    code: 'QRN', group: 'interferencia', level: 'esencial',
    meaning: 'Ruido atmosférico o estática (origen natural)',
    question: '¿Te molesta el ruido atmosférico?',
    example: '«Con esta tormenta el QRN en 80 m es insoportable» — chasquidos y estática de origen natural.',
    mnemonic: 'La N de «Natural»: rayos, estática, ruido del cielo. Contrario de QRM (Man-made).',
  },
  {
    code: 'QRO', group: 'potencia', level: 'esencial',
    meaning: 'Aumentar la potencia',
    question: '¿Debo aumentar la potencia?',
    example: '«Haz QRO, apenas llegas» — pide subir potencia. «No hace falta subir, llegas 5 y 9».',
    mnemonic: 'La O de «Otra marcha más»: dale más potencia. Contrario de QRP.',
  },
  {
    code: 'QRP', group: 'potencia', level: 'esencial',
    meaning: 'Reducir la potencia (u operar con muy poca)',
    question: '¿Debo reducir la potencia?',
    example: '«Opero en QRP con 5 W desde la montaña» — todo un deporte: contactar con potencia mínima.',
    mnemonic: 'La P de «Poca potencia». Los QRPistas presumen de contactos con 5 W o menos.',
  },
  {
    code: 'QRQ', group: 'velocidad', level: 'esencial',
    meaning: 'Transmitir más rápido (CW)',
    question: '¿Debo transmitir más rápido?',
    example: '«QRQ, por favor» — en un concurso de CW se pide subir el ritmo de manipulación.',
    mnemonic: 'La Q de «Quick»: acelera el código. Su opuesto es QRS (Slow).',
  },
  {
    code: 'QRS', group: 'velocidad', level: 'esencial',
    meaning: 'Transmitir más despacio (CW)',
    question: '¿Debo transmitir más despacio?',
    example: '«QRS, soy novato» — pide bajar la velocidad del CW para poder copiarlo.',
    mnemonic: 'La S de «Slow»: despacito, que no te copio. Su opuesto es QRQ (Quick).',
  },
  {
    code: 'QRT', group: 'operacion', level: 'esencial',
    meaning: 'Cesar la transmisión / cerrar la estación',
    question: '¿Debo dejar de transmitir?',
    example: '«Me voy QRT, 73 y buenas noches» — se apaga la estación, a las 22:00, que cenamos.',
    mnemonic: 'La T de «Terminar»: cierro el chiringuito. QRX es una pausa; QRT es cerrar.',
  },
  {
    code: 'QRU', group: 'operacion', level: 'esencial',
    meaning: 'No tengo nada para ti',
    question: '¿Tienes algo para mí?',
    example: '«¿QRU?» — «Nada para ti» — así se cierra el paso de mensajes cuando no hay tráfico.',
    mnemonic: 'La U de «algo para Usted»: ¿tienes algo para mí? Si contestan QRU, no hay nada.',
  },
  {
    code: 'QRV', group: 'operacion', level: 'esencial',
    meaning: 'Estoy preparado y disponible',
    question: '¿Estás preparado?',
    example: '«Estoy QRV todos los días a las 18:00 UTC» — disponible y con la estación lista.',
    mnemonic: 'La V de «Voy»: estoy listo para operar.',
  },
  {
    code: 'QRW', group: 'operacion', level: 'ampliado',
    meaning: 'Avisa a esa estación de que la llamo',
    question: '¿Aviso a … de que le llamo en … kHz?',
    example: '«Hazme QRW a EA7XYZ, que le llamo en 14.250» — pides que le digan a un tercero que le estás llamando.',
    mnemonic: 'La W de «Warn» (avisa): dile de mi parte que le llamo.',
  },
  {
    code: 'QRX', group: 'operacion', level: 'esencial',
    meaning: 'Espera un momento, te volveré a llamar',
    question: '¿Cuándo me volverás a llamar?',
    example: '«QRX cinco minutos, que me llaman a cenar» — espera, que vuelvo enseguida.',
    mnemonic: 'La X de «eXpera»: espera un momento. No es cerrar (eso es QRT).',
  },
  {
    code: 'QRY', group: 'operacion', level: 'ampliado',
    meaning: 'Tu turno es el número …',
    question: '¿Cuál es mi turno?',
    example: '«Tu QRY es el 3, espera a que terminen los dos anteriores» — ordena la cola de estaciones que esperan.',
    mnemonic: 'QRY suena a «Y-a te toca»: tu número en la cola.',
  },
  {
    code: 'QRZ', group: 'operacion', level: 'esencial',
    meaning: '¿Quién me llama?',
    question: '¿Quién me está llamando?',
    example: '«¿QRZ? ¿Quién llama?» — tras un pile-up, pide que repitan el indicativo de quien llama.',
    mnemonic: 'QRZ suena a «¿Quién Rayos Zumba?»: pide el indicativo de quien te llama.',
  },
  {
    code: 'QSA', group: 'senal', level: 'esencial',
    meaning: 'La fuerza de tu señal (de 1 a 5)',
    question: '¿Cuál es la fuerza de mi señal?',
    example: '«Tu QSA es 4» — con qué fuerza llegas; junto a QRK forma el reporte clásico anterior al sistema RST.',
    mnemonic: 'La A de «Amplitud»: la fuerza con la que llega tu señal. QRK es si se entiende.',
  },
  {
    code: 'QSB', group: 'senal', level: 'esencial',
    meaning: 'Tu señal se desvanece (fading)',
    question: '¿Se desvanece mi señal?',
    example: '«Hay QSB fuerte, tu señal sube y baja» — desvanecimiento por la propagación ionosférica.',
    mnemonic: 'La B de «sube y Baja»: tu señal va y viene.',
  },
  {
    code: 'QSD', group: 'senal', level: 'ampliado',
    meaning: 'Tu manipulación es defectuosa',
    question: '¿Es defectuosa mi manipulación?',
    example: '«Tienes QSD, los puntos se te pegan» — la manipulación de CW sale mal formada.',
    mnemonic: 'La D de «Defectuosa»: te sale mal el manipulado.',
  },
  {
    code: 'QSG', group: 'mensajes', level: 'ampliado',
    meaning: 'Enviar varios mensajes seguidos',
    question: '¿Envío … mensajes seguidos?',
    example: '«Hazme QSG de 5, que la propagación aguanta» — mandar varios mensajes de una tacada sin acusar recibo uno a uno.',
    mnemonic: 'La G de «en Grupo»: los mensajes van en bloque.',
  },
  {
    code: 'QSK', group: 'operacion', level: 'esencial',
    meaning: 'Puedo oírte entre mis señales (break-in en CW)',
    question: '¿Puedes oírme entre tus señales?',
    example: '«Trabajo QSK, interrumpe cuando quieras» — en CW escucho entre punto y punto.',
    mnemonic: '«Si Kortas te oigo»: modo break-in, te escucho entre mis propias señales.',
  },
  {
    code: 'QSL', group: 'mensajes', level: 'esencial',
    meaning: 'Acuso recibo (confirmación)',
    question: '¿Puedes acusar recibo?',
    example: '«QSL, recibido todo correcto» — confirmar. De ahí la tarjeta QSL que se manda por el buró.',
    mnemonic: '«Se Lo confirmo»: acuso recibo. De aquí nacen las famosas tarjetas de confirmación.',
  },
  {
    code: 'QSM', group: 'mensajes', level: 'esencial',
    meaning: 'Repite el último mensaje',
    question: '¿Repito el último mensaje?',
    example: '«QSM, por favor, el último mensaje quedó ilegible con el ruido».',
    mnemonic: 'La M de «Mensaje»: repite el último mensaje.',
  },
  {
    code: 'QSN', group: 'senal', level: 'ampliado',
    meaning: 'Te escuché en tal frecuencia',
    question: '¿Me oíste a mí (o a …) en … kHz?',
    example: '«QSN en 14.200 hace un rato» — confirma que sí te oyó, y dónde.',
    mnemonic: 'La N de «Now I heard you»: sí, te oí, y te digo dónde.',
  },
  {
    code: 'QSO', group: 'operacion', level: 'esencial',
    meaning: 'Contacto directo entre dos estaciones',
    question: '¿Puedes comunicar directamente con…?',
    example: '«Ayer logré 60 QSO en el concurso» — cada contacto directo es uno.',
    mnemonic: 'La SO de «Socio a socio»: contacto directo entre dos estaciones.',
  },
  {
    code: 'QSP', group: 'operacion', level: 'esencial',
    meaning: 'Retransmitir un mensaje a otra estación',
    question: '¿Puedes retransmitir a…?',
    example: '«¿Puedes QSP a EA4ABC? No lo alcanzo directo» — hacer de puente con un mensaje.',
    mnemonic: '«Se lo Paso»: hago de relevo con tu mensaje.',
  },
  {
    code: 'QST', group: 'mensajes', level: 'ampliado',
    meaning: 'Llamada general a todos los radioaficionados',
    question: '¿Hay alguna noticia general para todos?',
    example: '«QST QST, aviso de la red de emergencia» — encabeza un anuncio dirigido a todos; da nombre a la revista de la ARRL.',
    mnemonic: 'La T de «para Todos»: aviso general, no dirigido a una sola estación.',
  },
  {
    code: 'QSV', group: 'operacion', level: 'ampliado',
    meaning: 'Envía una serie de V para ajustar',
    question: '¿Envío una serie de V?',
    example: '«Mándame QSV, que ajusto el filtro» — la serie de V es la señal de prueba clásica en CW.',
    mnemonic: 'La V de… «V»: manda uves para que ajuste el equipo.',
  },
  {
    code: 'QSW', group: 'frecuencia', level: 'ampliado',
    meaning: 'Voy a transmitir en esta frecuencia',
    question: '¿Transmitirás en esta frecuencia?',
    example: '«QSW 14.195, ahí me tienes» — anuncias en qué frecuencia vas a transmitir tú. La pareja de QSX (dónde escuchas).',
    mnemonic: 'La W de «Working here»: aquí es donde transmito. QSW transmito, QSX escucho.',
  },
  {
    code: 'QSX', group: 'frecuencia', level: 'esencial',
    meaning: 'Escuchar en otra frecuencia (trabajar en split)',
    question: '¿Me escucharás en otra frecuencia?',
    example: '«Hago QSX 5 kHz arriba» — la expedición escucha desplazada: se trabaja en split.',
    mnemonic: 'SX de «Split»: te escucho en otra frecuencia. QSY es mudarse; QSX es escuchar en otra.',
  },
  {
    code: 'QSY', group: 'frecuencia', level: 'esencial',
    meaning: 'Cambiar de frecuencia',
    question: '¿Debo cambiar de frecuencia?',
    example: '«QSY a 14.300, que aquí hay demasiado ruido» — mover el contacto a otra frecuencia.',
    mnemonic: 'SY de «Shift» de frecuencia: cambia de frecuencia. QRG solo pregunta cuál es.',
  },
  {
    code: 'QSZ', group: 'velocidad', level: 'ampliado',
    meaning: 'Enviar cada palabra dos veces',
    question: '¿Debo enviar cada palabra dos veces?',
    example: '«Hay mucho ruido, haz QSZ» — repetir cada palabra para asegurar la copia.',
    mnemonic: '«Zas, otra vez»: cada palabra, dos veces.',
  },
  {
    code: 'QTA', group: 'mensajes', level: 'ampliado',
    meaning: 'Anula el mensaje',
    question: '¿Anulo el mensaje?',
    example: '«QTA el mensaje anterior, era un error» — se cancela lo enviado.',
    mnemonic: 'La A de «Anula»: bórralo, no cuenta.',
  },
  {
    code: 'QTC', group: 'mensajes', level: 'esencial',
    meaning: 'Tengo mensajes para ti (tráfico de mensajería)',
    question: '¿Cuántos mensajes tienes que transmitir?',
    example: '«QTC 2 para ti» — tengo dos mensajes que pasarte. Muy usado en redes de tráfico.',
    mnemonic: 'TC de «Telegrama / Correo»: cuántos mensajes llevo para ti.',
  },
  {
    code: 'QTH', group: 'info', level: 'esencial',
    meaning: 'Tu localización (posición geográfica)',
    question: '¿Cuál es tu localización?',
    example: '«Mi QTH es Madrid, locator IN80» — dónde está la estación.',
    mnemonic: 'TH de «The House»: mi casa, mi localización.',
  },
  {
    code: 'QTR', group: 'info', level: 'esencial',
    meaning: 'La hora exacta (en UTC)',
    question: '¿Cuál es la hora exacta?',
    example: '«Mi QTR son las 18:30 UTC» — en radioafición la hora se da siempre en UTC.',
    mnemonic: 'TR de «Tu Reloj»: dime la hora exacta.',
  },
  {
    code: 'QTU', group: 'info', level: 'ampliado',
    meaning: 'El horario en que la estación está activa',
    question: '¿A qué horas está abierta tu estación?',
    example: '«Mi QTU es de 08:00 a 22:00 UTC» — las horas en que la estación presta servicio.',
    mnemonic: 'La U de «hUsario»… horario: cuándo estoy en el aire.',
  },
  {
    code: 'QTX', group: 'operacion', level: 'ampliado',
    meaning: 'Mantén tu estación a la escucha',
    question: '¿Mantendrás tu estación abierta para mí?',
    example: '«Hazme QTX hasta las 23:00, por si vuelvo» — pides que no cierren y sigan a la escucha.',
    mnemonic: 'QTX = «Te eXtiendo la escucha»: no cierres todavía.',
  },
]

// ── Modos de pregunta ───────────────────────────────────────────────────────

export const QUIZ_MODES = [
  { id: 'mixed',        label: 'Mixto',                 hint: 'Alterna los tres tipos de pregunta' },
  { id: 'code2meaning', label: 'Código → significado',  hint: 'Ves el código y eliges qué significa' },
  { id: 'meaning2code', label: 'Significado → código',  hint: 'Ves el significado y eliges el código' },
  { id: 'context',      label: 'Uso en contexto',       hint: 'Completa el hueco de una frase real' },
]

const ASKABLE_MODES = ['code2meaning', 'meaning2code', 'context']
export const BLANK = '____'

// ── Lógica pura del quiz ────────────────────────────────────────────────────

/** Códigos del catálogo que aparecen literalmente en un texto. */
export function codesMentionedIn(text, pool = QCODES) {
  return pool.filter(c => text.includes(c.code)).map(c => c.code)
}

/** Ejemplo de uso con el código tapado, para el modo «uso en contexto». */
export function clozeExample(entry) {
  return entry.example.split(entry.code).join(BLANK)
}

/**
 * Elige distractores para una entrada. Prioriza opciones verosímiles pero deja
 * siempre al menos una de otro tema, para que la pista «Tema» sirva de algo:
 *   1. hasta 2 del mismo tema,
 *   2. luego códigos de la misma familia de letras (QR…, QS…, QT…),
 *   3. y el resto al azar.
 * `exclude` permite descartar códigos que ya se ven en el enunciado.
 */
export function pickDistractors(correct, count = 3, pool = QCODES, rng = Math.random, exclude = []) {
  const banned = new Set([correct.code, ...exclude])
  const rest   = pool.filter(c => !banned.has(c.code))
  const family = c => c.code.slice(0, 2)

  const sameGroup  = shuffle(rest.filter(c => c.group === correct.group), rng)
  const sameFamily = shuffle(rest.filter(c => c.group !== correct.group && family(c) === family(correct)), rng)
  const others     = shuffle(rest.filter(c => c.group !== correct.group && family(c) !== family(correct)), rng)

  const maxSameGroup = Math.max(1, count - 1)
  const ranked = [...sameGroup.slice(0, maxSameGroup), ...sameFamily, ...others, ...sameGroup.slice(maxSameGroup)]
  return ranked.slice(0, count)
}

// ── Repetición espaciada (cajas de Leitner) ─────────────────────────────────
// El algoritmo vive en ./leitner.js, compartido con el entrenador de Morse.
// Aquí sólo se fija la clave del catálogo: el código Q.

export function weightOf(entry, progress = {}) {
  return weightOfKey(entry.code, progress)
}

/** Sorteo ponderado: los códigos flojos salen más. */
export function pickWeighted(pool, progress = {}, rng = Math.random) {
  return pickWeightedItem(pool, progress, rng, c => c.code)
}

/** Recuento por nivel de dominio sobre un conjunto de códigos. */
export function masterySummary(pool = QCODES, progress = {}) {
  return summarize(pool, progress, c => c.code)
}

// ── Pistas ──────────────────────────────────────────────────────────────────

/**
 * Pistas en escalera para una pregunta ya construida:
 *   1. Tema — descarta al menos una opción.
 *   2. 50/50 — elimina dos opciones incorrectas.
 *   3. Mnemotecnia — prácticamente la respuesta.
 * Cada pista trae `eliminate`: opciones que la interfaz debe tachar.
 */
export function buildHints(entry, options, answer, rng = Math.random) {
  const wrong = shuffle(options.filter(o => o !== answer), rng)
  return [
    {
      id: 'tema',
      icon: 'bi-tag',
      label: 'Tema',
      text: `Este código pertenece al grupo «${GROUP_LABELS[entry.group]}».`,
      eliminate: [],
    },
    {
      id: '5050',
      icon: 'bi-scissors',
      label: '50/50',
      text: 'Descarto dos opciones incorrectas: quedan dos.',
      eliminate: wrong.slice(0, 2),
    },
    {
      id: 'mnemo',
      icon: 'bi-lightbulb',
      label: 'Mnemotecnia',
      text: entry.mnemonic,
      eliminate: [],
    },
  ]
}

/**
 * Genera una pregunta de 4 opciones.
 *   pool           — códigos entre los que se sortea la pregunta
 *   distractorPool — de dónde salen las opciones falsas (por defecto, `pool`)
 *   mode           — 'mixed' | 'code2meaning' | 'meaning2code' | 'context'
 *   excludeCode    — código a evitar (p. ej. el de la pregunta anterior)
 *   progress       — cajas de Leitner para el sorteo ponderado
 * Devuelve { entry, mode, prompt, sentence, options, answer, hints }.
 */
export function buildQuestion({
  pool = QCODES,
  distractorPool = pool,
  mode = 'mixed',
  excludeCode = null,
  progress = {},
  rng = Math.random,
} = {}) {
  const candidates = pool.length > 1 ? pool.filter(c => c.code !== excludeCode) : pool
  const entry = pickWeighted(candidates, progress, rng)

  let resolvedMode = mode === 'mixed'
    ? ASKABLE_MODES[Math.floor(rng() * ASKABLE_MODES.length)]
    : mode
  // El modo contexto necesita que el ejemplo contenga el código para taparlo.
  if (resolvedMode === 'context' && !entry.example.includes(entry.code)) resolvedMode = 'code2meaning'

  const dPool = distractorPool.length >= 4 ? distractorPool : QCODES

  if (resolvedMode === 'code2meaning') {
    const distractors = pickDistractors(entry, 3, dPool, rng)
    const options = shuffle([entry.meaning, ...distractors.map(d => d.meaning)], rng)
    return {
      entry, mode: resolvedMode,
      prompt: `¿Qué significa el código ${entry.code}?`,
      sentence: null,
      options,
      answer: entry.meaning,
      hints: buildHints(entry, options, entry.meaning, rng),
    }
  }

  if (resolvedMode === 'context') {
    const sentence = clozeExample(entry)
    // No ofrecer como distractor un código que ya se lee en la propia frase.
    const exclude = codesMentionedIn(sentence, dPool)
    const distractors = pickDistractors(entry, 3, dPool, rng, exclude)
    const options = shuffle([entry.code, ...distractors.map(d => d.code)], rng)
    return {
      entry, mode: resolvedMode,
      prompt: '¿Qué código completa esta frase?',
      sentence,
      options,
      answer: entry.code,
      hints: buildHints(entry, options, entry.code, rng),
    }
  }

  const distractors = pickDistractors(entry, 3, dPool, rng)
  const options = shuffle([entry.code, ...distractors.map(d => d.code)], rng)
  return {
    entry, mode: resolvedMode,
    prompt: `¿Qué código Q significa «${entry.meaning}»?`,
    sentence: null,
    options,
    answer: entry.code,
    hints: buildHints(entry, options, entry.code, rng),
  }
}
