// Course data and grading are independent from the editor and from React.
export const VIM_PROGRESS_KEY = 'falkens_vim_quest_v1'
export const CHAPTERS = [
  { title: 'Despierta al cursor', icon: '01', summary: 'Mueve las manos, encuentra el camino.' },
  { title: 'Salta con intención', icon: '02', summary: 'Palabras, líneas y documentos.' },
  { title: 'Escribe tu historia', icon: '03', summary: 'Normal e inserción: dos maneras de pensar.' },
  { title: 'El arte de borrar', icon: '04', summary: 'Edita con precisión. Siempre puedes deshacer.' },
  { title: 'Copia, mueve, selecciona', icon: '05', summary: 'El texto también se puede transportar.' },
  { title: 'Encuentra el tesoro', icon: '06', summary: 'Búsquedas y saltos a caracteres.' },
  { title: 'Piensa en Vim', icon: '07', summary: 'Objetos de texto, repetición y macros.' },
]

const mission = (id, chapter, title, initial, cursor, goal, lesson, keys, solution, required) => ({
  id, chapter, title, initial, cursor, ...goal, lesson, keys, solution, required,
  par: splitKeys(solution).length,
})

export const MISSIONS = [
  mission('right', 0, 'La primera llave', '....X....', [0, 0], { targetCursor: [0, 4] },
    'En modo NORMAL las letras son órdenes. l mueve el cursor a la derecha; h, a la izquierda. Lleva el cursor hasta la X.',
    ['h', 'l'], 'llll', ['l']),
  mission('down', 0, 'Baja al siguiente piso', 'entrada\npasillo\nX salida', [0, 0], { targetCursor: [2, 0] },
    'j baja una línea; k sube una línea. Baja hasta la X sin usar las flechas.',
    ['j', 'k'], 'jj', ['j']),
  mission('return', 0, 'El camino de vuelta', '..X.....\n........\n........', [2, 6], { targetCursor: [0, 2] },
    'Vuelve a la X combinando k para subir y h para ir a la izquierda.',
    ['h', 'j', 'k', 'l'], 'kkhhhh', ['k', 'h']),
  mission('count', 0, 'Un salto de seis', '......X...', [0, 0], { targetCursor: [0, 6] },
    'Un número delante de un movimiento lo repite. 6l avanza seis caracteres con solo dos pulsaciones. Llega a la X con 6l.',
    ['6', 'l'], '6l', ['6l']),

  mission('word', 1, 'De palabra en palabra', 'uno dos tesoro cuatro', [0, 0], { targetCursor: [0, 8] },
    'w salta al principio de la siguiente palabra. Llega al inicio de «tesoro».',
    ['w'], 'ww', ['w']),
  mission('back-word', 1, 'Mira hacia atrás', 'norte sur este', [0, 10], { targetCursor: [0, 0] },
    'b vuelve al principio de la palabra anterior. Si estás dentro de una palabra, primero vuelve a su inicio. Llega a «norte».',
    ['b'], 'bb', ['b']),
  mission('word-end', 1, 'Hasta el último carácter', 'tesoro encontrado', [0, 0], { targetCursor: [0, 5] },
    'e va al final de la palabra. Coloca el cursor sobre la última o de «tesoro».',
    ['e'], 'e', ['e']),
  mission('line', 1, 'Los extremos', '    abre la puerta', [0, 8], { targetCursor: [0, 17] },
    '0 va a la primera columna; ^, al primer carácter no vacío; $, al final. Practica ^ y después $ para acabar sobre la última a.',
    ['0', '^', '$'], '^$', ['^', '$']),
  mission('document', 1, 'De punta a punta', 'inicio\nplanta 1\nplanta 2\nX final', [1, 0], { targetCursor: [3, 0] },
    'gg va a la primera línea y G a la última. Visita el inicio con gg y termina en la X con G. 3G iría a la línea 3.',
    ['g', 'G'], 'ggG', ['gg', 'G']),

  mission('insert', 2, 'Hola, modo inserción', 'mundo', [0, 0], { targetText: 'Hola mundo' },
    'i entra en INSERCIÓN antes del cursor. Escribe «Hola » (con un espacio al final) y pulsa Esc para volver a NORMAL.',
    ['i', '<Esc>'], 'iHola <Esc>', ['i']),
  mission('append', 2, 'El hueco exacto', 'Hla Vim', [0, 0], { targetText: 'Hola Vim' },
    'a empieza a insertar después del cursor. Añade la o que falta y vuelve a NORMAL con Esc.',
    ['a', '<Esc>'], 'ao<Esc>', ['a']),
  mission('append-line', 2, 'Un final feliz', 'Mision cumplida', [0, 0], { targetText: 'Mision cumplida!' },
    'A entra en inserción al final de la línea. Añade ! y sal de inserción.',
    ['A', '<Esc>'], 'A!<Esc>', ['A']),
  mission('open-line', 2, 'Abre otra puerta', 'primero\ntercero', [0, 0], { targetText: 'primero\nsegundo\ntercero' },
    'o abre una línea debajo y entra en inserción; O la abre encima. Usa o para escribir «segundo» en medio.',
    ['o', 'O', '<Esc>'], 'osegundo<Esc>', ['o']),
  mission('insert-start', 2, 'El comienzo importa', '    tarea pendiente', [0, 12], { targetText: '    # tarea pendiente' },
    'I inserta antes del primer carácter no vacío. Añade «# » conservando la sangría.',
    ['I', '<Esc>'], 'I# <Esc>', ['I']),

  mission('delete-char', 3, 'Una letra de más', 'Holaa Vim', [0, 4], { targetText: 'Hola Vim' },
    'x borra el carácter bajo el cursor. Elimina la a sobrante.',
    ['x'], 'x', ['x']),
  mission('replace-char', 3, 'Cirugía de una letra', 'gato', [0, 0], { targetText: 'pato' },
    'r reemplaza un carácter sin entrar en inserción. Pulsa r y después p para convertir gato en pato.',
    ['r'], 'rp', ['r']),
  mission('delete-word', 3, 'Verbo + movimiento', 'ruido tesoro', [0, 0], { targetText: 'tesoro' },
    'd significa borrar y w indica hasta dónde: dw elimina desde el cursor hasta el inicio de la siguiente palabra. Quita «ruido ».',
    ['d', 'w'], 'dw', ['dw']),
  mission('delete-lines', 3, 'Limpieza por lotes', 'conservar\nbasura uno\nbasura dos\nfin', [1, 0], { targetText: 'conservar\nfin' },
    'dd borra una línea completa. 2dd borra dos. Elimina las dos líneas de basura con 2dd.',
    ['2', 'd'], '2dd', ['2dd']),
  mission('undo', 3, 'Sin miedo a equivocarte', 'oro\nplata', [0, 0], { targetText: 'oro\nplata' },
    'Borra la primera línea con dd y recupérala con u. Deshacer forma parte del aprendizaje.',
    ['d', 'u'], 'ddu', ['dd', 'u']),
  mission('redo', 3, 'Volver al futuro', 'borrar\nconservar', [0, 0], { targetText: 'conservar' },
    'Ctrl+r rehace un cambio deshecho. Practica la secuencia dd, u, Ctrl+r y conserva solo la segunda línea.',
    ['d', 'u', '<C-r>'], 'ddu<C-r>', ['dd', 'u', '<C-r>']),

  mission('copy-line', 4, 'Una copia perfecta', 'tesoro', [0, 0], { targetText: 'tesoro\ntesoro' },
    'yy copia una línea (yank). p pega debajo cuando has copiado una línea completa. Duplica «tesoro».',
    ['y', 'p'], 'yyp', ['yy', 'p']),
  mission('move-line', 4, 'Pon orden', 'segundo\nprimero\ntercero', [0, 0], { targetText: 'primero\nsegundo\ntercero' },
    'Al borrar, Vim también guarda el texto en un registro. dd seguido de p mueve una línea hacia abajo.',
    ['d', 'p'], 'ddp', ['dd', 'p']),
  mission('visual', 4, 'Selecciona lo que sobra', 'oro XXX plata', [0, 4], { targetText: 'oro  plata' },
    'v inicia una selección por caracteres. Extiéndela con ll y bórrala con d. Conserva los dos espacios que rodeaban XXX.',
    ['v', 'l', 'd'], 'vlld', ['v', 'd']),
  mission('visual-lines', 4, 'A vista de pájaro', 'inicio\nsobra uno\nsobra dos\nfin', [1, 0], { targetText: 'inicio\nfin' },
    'V selecciona líneas completas. Pulsa V, amplía una línea con j y elimina ambas con d.',
    ['V', 'j', 'd'], 'Vjd', ['V', 'd']),

  mission('search', 5, 'El mapa del tesoro', 'entrada\npasillo\naqui esta el tesoro\nsalida', [0, 0], { targetCursor: [2, 13] },
    '/ abre una búsqueda hacia delante. Escribe tesoro y pulsa Enter. La palabra encontrada queda bajo el cursor.',
    ['/', '<CR>'], '/tesoro<CR>', ['/']),
  mission('search-next', 5, 'Otra vez esa palabra', 'oro plata oro cobre oro', [0, 0], { targetCursor: [0, 20] },
    'Después de /oro y Enter, n busca la siguiente coincidencia. N busca en la dirección contraria. Llega al último «oro» con n.',
    ['/', 'n', 'N', '<CR>'], '/oro<CR>n', ['/', 'n']),
  mission('find-char', 5, 'Encuentra la cerradura', 'puerta:cerrada:abre', [0, 0], { targetCursor: [0, 14] },
    'f busca un carácter en la línea. f: salta a los dos puntos y ; repite ese salto. Termina sobre los segundos dos puntos.',
    ['f', ':', ';'], 'f:;', ['f:', ';']),
  mission('till-char', 5, 'Justo antes', 'basura;tesoro', [0, 0], { targetText: ';tesoro' },
    't se detiene antes de un carácter. dt; borra hasta antes del punto y coma, conservándolo.',
    ['d', 't', ';'], 'dt;', ['dt;']),

  mission('inner-word', 6, 'Cambia la idea', 'la puerta roja', [0, 11], { targetText: 'la puerta azul' },
    'c cambia texto y entra en inserción. iw significa «dentro de la palabra». ciw cambia la palabra entera aunque estés en medio. Escribe azul y pulsa Esc.',
    ['c', 'i', 'w', '<Esc>'], 'ciwazul<Esc>', ['ciw']),
  mission('quotes', 6, 'Dentro de las comillas', 'color = "rojo";', [0, 10], { targetText: 'color = "azul";' },
    'ci" cambia el contenido de las comillas sin borrarlas. Sustituye rojo por azul.',
    ['c', 'i', '"', '<Esc>'], 'ci"azul<Esc>', ['ci"']),
  mission('repeat', 6, 'El poder del punto', 'rojo rojo rojo', [0, 0], { targetText: 'azul azul azul' },
    '. repite el último cambio. Cambia el primer rojo con ciw, escribe azul y Esc. Usa w. dos veces para repetir en las otras palabras.',
    ['c', 'i', 'w', '.', '<Esc>'], 'ciwazul<Esc>w.w.', ['ciw', '.']),
  mission('substitute', 6, 'Una orden, todo el mapa', 'rojo azul rojo\nrojo verde', [0, 0], { targetText: 'oro azul oro\noro verde' },
    ':%s/rojo/oro/g sustituye en todo el documento (%) y en todas las coincidencias de cada línea (g). Escríbelo y pulsa Enter.',
    [':', '<CR>'], ':%s/rojo/oro/g<CR>', [':']),
  mission('macro', 6, 'La máquina de repetir', 'uno\ndos\ntres', [0, 0], { targetText: '- uno\n- dos\n- tres' },
    'qa graba en el registro a. Ejecuta I, escribe «- », pulsa Esc y j. q termina la grabación. 2@a reproduce esa macro dos veces. Crea una lista.',
    ['q', 'a', 'I', 'j', '2', '@', '<Esc>'], 'qaI- <Esc>jq2@a', ['qa', '@a']),
  mission('boss', 6, 'El guardián de Vim', 'nombre = "novato"\nruido ruido\nestado = "cerrado"', [0, 0], { targetText: 'nombre = "maestro"\nestado = "abierto"' },
    'Reto final: cambia novato por maestro, elimina la línea de ruido y cambia cerrado por abierto. Combina búsqueda o movimientos, ci" y dd. Termina en NORMAL.',
    ['c', 'i', '"', 'd', 'j', '<Esc>'], 'ci"maestro<Esc>jddci"abierto<Esc>', ['ci"', 'dd']),
]

export function splitKeys(sequence) {
  return sequence.match(/<(?:Esc|CR|C-r|BS)>|[\s\S]/gu) || []
}

export function practiced(events, requirement) {
  // Inserted text and command-line text must never count as Normal commands.
  const commands = events.map(({ key, mode }) => mode === 'insert' || mode === 'prompt' ? '\0' : key).join('')
  return commands.includes(requirement)
}

export function judgeMission(level, snapshot) {
  const text = snapshot.text === (level.targetText ?? level.initial)
  const cursor = !level.targetCursor || level.targetCursor.every((n, i) => n === snapshot.cursor[i])
  const normal = snapshot.mode === 'normal' && !snapshot.recording
  const skills = level.required.every(key => practiced(snapshot.events, key))
  return { text, cursor, normal, skills, complete: text && cursor && normal && skills }
}

export function starsFor(keys, par, hint) {
  return hint ? 1 : keys <= par ? 3 : 2
}

export function readProgress(storage) {
  try { return sanitizeProgress(JSON.parse(storage.getItem(VIM_PROGRESS_KEY))) } catch { return {} }
}

export function sanitizeProgress(raw) {
  const result = {}
  if (!raw || raw.version !== 1 || !raw.levels || typeof raw.levels !== 'object') return result
  for (const { id } of MISSIONS) {
    const entry = raw.levels[id]
    if (!entry || !Number.isInteger(entry.stars) || entry.stars < 1 || entry.stars > 3 ||
        !Number.isInteger(entry.bestKeys) || entry.bestKeys < 1 || entry.bestKeys > 100000) continue
    result[id] = { stars: entry.stars, bestKeys: entry.bestKeys }
  }
  return result
}

export function recordResult(progress, id, keys, stars) {
  const previous = progress[id]
  return { ...progress, [id]: {
    stars: Math.max(previous?.stars || 0, stars),
    bestKeys: Math.min(previous?.bestKeys ?? Infinity, keys),
  } }
}

export function firstUnfinished(progress) {
  const index = MISSIONS.findIndex(level => !progress[level.id])
  return index < 0 ? MISSIONS.length - 1 : index
}

export const FREE_TEXT = 'Bienvenido al taller de Vim.\n\nPractica sin prisas.\nCopia esta linea, busca palabras o graba una macro.\n\nEl texto de este taller no se guarda.'
