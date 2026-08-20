// ── Prueba de rendimiento continuo (CPT) ────────────────────────────────────
//
// Paradigma X-CPT, el mismo del Conners CPT: van pasando letras de una en una y
// hay que pulsar en todas menos en la X. Responder es la conducta por defecto,
// así que la X no mide atención sino inhibición: dejarla pasar cuesta frenar un
// impulso que ya iba lanzado.
//
// Esto es una tarea de laboratorio, no una prueba diagnóstica. Un CPT no
// diagnostica nada por sí solo. Sirve para poner número a las omisiones, a las
// falsas alarmas y sobre todo a la variabilidad del tiempo de reacción, que es
// el índice que mejor separa grupos en la literatura. Los cortes de
// `REFERENCIAS` son orientativos y no salen de un baremo normativo: la
// comparación que sí vale es la de una sesión contra las anteriores del mismo
// sujeto, a la misma hora y en las mismas condiciones.
//
// El módulo es puro a propósito (ni React ni DOM) para que `scripts/test-cpt.mjs`
// pueda comprobar la secuencia y las métricas sin navegador.

// ---- Parámetros del paradigma ---------------------------------------------

/** Letras "go". Sin la I, que se confunde con una barra, y sin la X, que es el no-go. */
export const LETRAS_GO = 'ABCDEFGHJKLMNOPQRSTUVWYZ'.split('')
export const LETRA_NOGO = 'X'

/** Milisegundos que la letra permanece en pantalla. */
export const DURACION_ESTIMULO = 250

/** Intervalos entre inicios de estímulo (SOA). Uno por subbloque. */
export const ISIS = [1000, 2000, 4000]

/** Proporción de ensayos no-go. */
export const PROPORCION_NOGO = 0.1

/**
 * Por debajo de este tiempo no hay reacción posible a la letra: es una pulsación
 * lanzada antes de verla. No cuenta como acierto ni entra en el tiempo medio.
 */
export const TR_MINIMO = 100

export const PROTOCOLOS = {
  breve:    { id: 'breve',    nombre: 'Breve',    bloques: 3, porSubbloque: 10 },
  estandar: { id: 'estandar', nombre: 'Estándar', bloques: 4, porSubbloque: 15 },
  completo: { id: 'completo', nombre: 'Completo', bloques: 6, porSubbloque: 20 },
}

/** El protocolo completo reproduce la longitud del Conners: 360 ensayos, 14 minutos. */
export function ensayosDe(protocolo) {
  return protocolo.bloques * ISIS.length * protocolo.porSubbloque
}

export function duracionDe(protocolo) {
  const porBloque = ISIS.reduce((suma, isi) => suma + isi, 0) * protocolo.porSubbloque
  return protocolo.bloques * porBloque
}

// ---- Construcción de la secuencia -----------------------------------------

function barajar(lista, rng) {
  const copia = [...lista]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const guardado = copia[i]
    copia[i] = copia[j]
    copia[j] = guardado
  }
  return copia
}

/**
 * Reparto de los no-go entre subbloques por restos mayores, para que cada ISI
 * reciba su parte. Si las X se amontonaran en el ISI de 4 s, la tasa de comisión
 * estaría midiendo el ISI y no al sujeto.
 */
function cuotas(total, partes) {
  const base = Array.from({ length: partes }, () => Math.floor(total / partes))
  let resto = total - base.reduce((suma, n) => suma + n, 0)
  for (let i = 0; resto > 0; i++, resto--) base[i % partes] += 1
  return base
}

/**
 * k posiciones de [0, n) sin dos consecutivas, con todas las combinaciones
 * igual de probables.
 *
 * Se elige una combinación de k entre n-k+1 y se le suma su propio índice a cada
 * elemento: la biyección clásica que convierte cualquier combinación en una sin
 * adyacencias. Sortear y reintentar también valdría, pero con k cerca de n/2 el
 * reintento no termina nunca.
 */
function posicionesNoAdyacentes(n, k, rng) {
  if (k <= 0) return []
  const libres = n - k + 1
  if (libres < k) throw new Error(`no caben ${k} no-go separados en ${n} ensayos`)
  const elegidas = new Set()
  while (elegidas.size < k) elegidas.add(Math.floor(rng() * libres))
  return [...elegidas].sort((a, b) => a - b).map((c, i) => c + i)
}

/**
 * Secuencia completa de ensayos.
 *
 * Cada bloque tiene tres subbloques, uno por ISI, barajados dentro del bloque.
 * Los no-go van repartidos por subbloque, nunca seguidos ni en el primer ensayo,
 * y ninguna letra se repite dos veces seguidas: si la pantalla no cambia, el
 * sujeto no puede saber que hay un ensayo nuevo.
 */
export function construirSecuencia(protocolo, rng = Math.random) {
  const totalEnsayos = ensayosDe(protocolo)
  const subbloques = protocolo.bloques * ISIS.length
  const repartoNogo = cuotas(Math.round(totalEnsayos * PROPORCION_NOGO), subbloques)

  const ensayos = []
  let anteriorEsNogo = false
  let anteriorLetra = null
  let subbloqueGlobal = 0

  for (let bloque = 0; bloque < protocolo.bloques; bloque++) {
    const orden = barajar(ISIS, rng)

    for (const isi of orden) {
      const n = protocolo.porSubbloque
      // El primer ensayo del subbloque queda vetado si el anterior fue no-go, y
      // el primero de todos siempre: nadie responde bien a una X sin calentar.
      const vetaPrimero = anteriorEsNogo || ensayos.length === 0
      const hueco = vetaPrimero ? n - 1 : n
      const posiciones = new Set(
        posicionesNoAdyacentes(hueco, repartoNogo[subbloqueGlobal], rng)
          .map(p => (vetaPrimero ? p + 1 : p))
      )

      for (let i = 0; i < n; i++) {
        const nogo = posiciones.has(i)
        let letra = LETRA_NOGO
        if (!nogo) {
          do {
            letra = LETRAS_GO[Math.floor(rng() * LETRAS_GO.length)]
          } while (letra === anteriorLetra)
        }
        ensayos.push({
          indice: ensayos.length,
          bloque,
          subbloque: subbloqueGlobal,
          isi,
          letra,
          nogo,
        })
        anteriorLetra = letra
        anteriorEsNogo = nogo
      }
      subbloqueGlobal++
    }
  }

  return ensayos
}

/** Instante teórico de aparición de cada letra, medido desde el inicio. */
export function calendario(ensayos) {
  const inicios = new Array(ensayos.length)
  let t = 0
  for (let i = 0; i < ensayos.length; i++) {
    inicios[i] = t
    t += ensayos[i].isi
  }
  return inicios
}

/**
 * Estado del reloj en el instante `t`, medido desde el inicio de la pasada.
 *
 * Vive aquí, fuera del componente, porque es la regla que separa un despiste de
 * un fallo del navegador. Si un fotograma tarda más que un intervalo, el bucle
 * atraviesa varios ensayos de golpe y sólo el último llega a verse: los demás no
 * son omisiones, son letras que nunca se pintaron, y contarlas como despistes
 * inventa un síntoma que sólo estaba en la tarjeta gráfica.
 */
export function avanzarReloj({ indice, t, inicios, duracionEstimulo = DURACION_ESTIMULO }) {
  let actual = indice
  let avances = 0
  while (actual + 1 < inicios.length && t >= inicios[actual + 1]) {
    actual++
    avances++
  }

  const visible = actual >= 0 && t - inicios[actual] < duracionEstimulo
  const descartados = []
  for (let j = actual - avances + 1; j < actual; j++) descartados.push(j)
  // El propio ensayo tampoco se pintó si al llegar a él su ventana ya había pasado.
  if (avances > 0 && !visible) descartados.push(actual)

  return { indice: actual, avances, visible, descartados }
}

/** Ensayos de práctica: ritmo fijo, con corrección inmediata y sin puntuar. */
export function secuenciaPractica(n = 18, rng = Math.random) {
  const protocolo = { bloques: 1, porSubbloque: Math.ceil(n / ISIS.length) }
  return construirSecuencia(protocolo, rng)
    .slice(0, n)
    .map((ensayo, i) => ({ ...ensayo, indice: i, isi: 1500, bloque: 0, subbloque: 0 }))
}

// ---- Estadística ----------------------------------------------------------

export function media(xs) {
  return xs.length ? xs.reduce((suma, x) => suma + x, 0) / xs.length : null
}

export function mediana(xs) {
  if (!xs.length) return null
  const orden = [...xs].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2
}

/** Desviación típica muestral (n-1): con un solo dato no hay dispersión que medir. */
export function desviacion(xs) {
  if (xs.length < 2) return null
  const m = media(xs)
  return Math.sqrt(xs.reduce((suma, x) => suma + (x - m) ** 2, 0) / (xs.length - 1))
}

/** Pendiente por mínimos cuadrados de y frente a x. */
export function pendiente(puntos) {
  const validos = puntos.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (validos.length < 2) return null
  const mx = media(validos.map(p => p.x))
  const my = media(validos.map(p => p.y))
  let numerador = 0
  let denominador = 0
  for (const p of validos) {
    numerador += (p.x - mx) * (p.y - my)
    denominador += (p.x - mx) ** 2
  }
  return denominador === 0 ? null : numerador / denominador
}

/**
 * Inversa de la normal tipificada (Acklam). Error por debajo de 1,15e-9 en todo
 * el dominio, de sobra para d' y beta.
 */
export function probit(p) {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
             3.754408661907416]
  const bajo = 0.02425
  if (p < bajo) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - bajo) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/**
 * Detección de señales con corrección loglineal (Hautus): 0,5 a los conteos y 1
 * a los totales antes de dividir. Sin ella, quien no comete ninguna falsa alarma
 * saca d' infinito, que no es "atención perfecta" sino una división por cero
 * disfrazada de resultado.
 */
export function deteccionSenal({ aciertos, nGo, falsasAlarmas, nNogo }) {
  if (nGo <= 0 || nNogo <= 0) return { dPrima: null, beta: null, criterio: null }
  const zAcierto = probit((aciertos + 0.5) / (nGo + 1))
  const zFalsa = probit((falsasAlarmas + 0.5) / (nNogo + 1))
  return {
    dPrima: zAcierto - zFalsa,
    beta: Math.exp((zFalsa * zFalsa - zAcierto * zAcierto) / 2),
    criterio: -(zAcierto + zFalsa) / 2,
  }
}

// ---- Análisis de la sesión ------------------------------------------------

function resumenTr(trs) {
  const m = media(trs)
  const sd = desviacion(trs)
  return {
    n: trs.length,
    media: m,
    mediana: mediana(trs),
    desviacion: sd,
    cv: m && sd != null ? sd / m : null,
  }
}

function agrupar(ensayos, clave) {
  const grupos = new Map()
  for (const ensayo of ensayos) {
    if (!grupos.has(ensayo[clave])) grupos.set(ensayo[clave], [])
    grupos.get(ensayo[clave]).push(ensayo)
  }
  return [...grupos.entries()].sort((a, b) => a[0] - b[0])
}

function metricasDe(ensayos) {
  const go = ensayos.filter(e => !e.nogo)
  const nogo = ensayos.filter(e => e.nogo)
  const aciertos = go.filter(e => e.acierto).length
  const comisiones = nogo.filter(e => e.respondido).length
  return {
    n: ensayos.length,
    nGo: go.length,
    nNogo: nogo.length,
    aciertos,
    omisiones: go.length - aciertos,
    comisiones,
    tasaOmision: go.length ? (go.length - aciertos) / go.length : null,
    tasaComision: nogo.length ? comisiones / nogo.length : null,
    tr: resumenTr(go.filter(e => e.acierto).map(e => e.tr)),
  }
}

/**
 * Análisis de una sesión.
 *
 * `respuestas` son pulsaciones sueltas `{ indice, tr }`, con el tiempo medido
 * desde la aparición real de la letra de ese ensayo, y puede haber varias en el
 * mismo ensayo. `descartados` son los ensayos que el navegador nunca llegó a
 * pintar: se sacan de todos los recuentos en lugar de contarse como omisiones,
 * porque un fotograma perdido no es un despiste.
 */
export function analizar(secuencia, respuestas, { descartados = [] } = {}) {
  const fuera = new Set(descartados)
  const porEnsayo = new Map()
  for (const respuesta of respuestas) {
    if (fuera.has(respuesta.indice)) continue
    if (!porEnsayo.has(respuesta.indice)) porEnsayo.set(respuesta.indice, [])
    porEnsayo.get(respuesta.indice).push(respuesta.tr)
  }

  let anticipaciones = 0
  let multiples = 0

  const ensayos = secuencia
    .filter(ensayo => !fuera.has(ensayo.indice))
    .map(ensayo => {
      const pulsaciones = (porEnsayo.get(ensayo.indice) || []).sort((a, b) => a - b)
      const validas = pulsaciones.filter(tr => tr >= TR_MINIMO)
      anticipaciones += pulsaciones.length - validas.length
      multiples += Math.max(0, pulsaciones.length - 1)
      const respondido = validas.length > 0
      return {
        ...ensayo,
        pulsaciones,
        respondido,
        tr: respondido ? validas[0] : null,
        acierto: !ensayo.nogo && respondido,
        omision: !ensayo.nogo && !respondido,
        comision: ensayo.nogo && respondido,
      }
    })

  const global = metricasDe(ensayos)

  const porBloque = agrupar(ensayos, 'bloque').map(([bloque, lista]) => ({
    bloque,
    ...metricasDe(lista),
  }))
  const porIsi = agrupar(ensayos, 'isi').map(([isi, lista]) => ({
    isi,
    ...metricasDe(lista),
  }))

  const sdt = deteccionSenal({
    aciertos: global.aciertos,
    nGo: global.nGo,
    falsasAlarmas: global.comisiones,
    nNogo: global.nNogo,
  })

  // Deriva del tiempo de reacción a lo largo de la prueba: positiva es
  // enlentecimiento, el decremento de vigilancia clásico.
  const derivaBloques = pendiente(porBloque.map(b => ({ x: b.bloque, y: b.tr.media })))
  // Deriva frente al ISI, en ms de tiempo de reacción por segundo de espera.
  const derivaIsi = pendiente(porIsi.map(b => ({ x: b.isi / 1000, y: b.tr.media })))

  return {
    ...global,
    ...sdt,
    anticipaciones,
    multiples,
    descartados: fuera.size,
    porBloque,
    porIsi,
    derivaBloques,
    derivaIsi,
    variabilidadEntreBloques: desviacion(porBloque.map(b => b.tr.media).filter(Number.isFinite)),
    ensayos,
  }
}

// ---- Lectura orientativa --------------------------------------------------

/**
 * Umbrales orientativos, no un baremo. Están puestos donde la literatura de
 * X-CPT en adultos sitúa el grueso de la población sana, pero ni el corte ni la
 * muestra son los de una prueba normalizada: sirven para señalar dónde mirar,
 * no para clasificar a nadie.
 */
export const REFERENCIAS = {
  tasaOmision:    { atencion: 0.05, alerta: 0.10 },
  tasaComision:   { atencion: 0.35, alerta: 0.50 },
  cv:             { atencion: 0.22, alerta: 0.30 },
  dPrima:         { atencion: 2.5,  alerta: 1.5, menorEsPeor: true },
  derivaBloques:  { atencion: 15,   alerta: 30 },
  anticipaciones: { atencion: 3,    alerta: 8 },
}

export function nivelDe(valor, referencia) {
  if (valor == null || !Number.isFinite(valor)) return 'nd'
  if (referencia.menorEsPeor) {
    if (valor < referencia.alerta) return 'alerta'
    return valor < referencia.atencion ? 'atencion' : 'ok'
  }
  if (valor > referencia.alerta) return 'alerta'
  return valor > referencia.atencion ? 'atencion' : 'ok'
}

/**
 * Traduce las métricas a frases. Cada una dice qué mide, no qué eres: la
 * interpretación clínica no sale de aquí.
 */
export function interpretar(metricas) {
  return [
    {
      clave: 'omisiones',
      etiqueta: 'Omisiones',
      valor: metricas.tasaOmision,
      nivel: nivelDe(metricas.tasaOmision, REFERENCIAS.tasaOmision),
      texto: 'Letras que pasaron sin respuesta. Es el índice más directo de atención sostenida: se despega cuando el foco se va de la pantalla.',
    },
    {
      clave: 'comisiones',
      etiqueta: 'Comisiones',
      valor: metricas.tasaComision,
      nivel: nivelDe(metricas.tasaComision, REFERENCIAS.tasaComision),
      texto: 'X respondidas. Mide inhibición, no atención: la mano ya iba. Sube sola cuando se responde muy rápido, así que se lee junto al tiempo de reacción.',
    },
    {
      clave: 'variabilidad',
      etiqueta: 'Variabilidad del TR',
      valor: metricas.tr.cv,
      nivel: nivelDe(metricas.tr.cv, REFERENCIAS.cv),
      texto: 'Coeficiente de variación del tiempo de reacción. Es el índice que mejor separa grupos en la literatura: no importa ser lento, importa ser irregular.',
    },
    {
      clave: 'discriminacion',
      etiqueta: "Discriminación (d')",
      valor: metricas.dPrima,
      nivel: nivelDe(metricas.dPrima, REFERENCIAS.dPrima),
      texto: 'Separación entre responder a una letra y responder a una X, descontando lo dispuesto que se esté a pulsar. Baja cuando los dos tipos de error suben a la vez.',
    },
    {
      clave: 'vigilancia',
      etiqueta: 'Deriva por bloque',
      valor: metricas.derivaBloques,
      nivel: nivelDe(metricas.derivaBloques, REFERENCIAS.derivaBloques),
      texto: 'Milisegundos que se enlentece el tiempo de reacción por cada bloque. Positiva y grande es el decremento de vigilancia: cansarse durante la propia prueba.',
    },
    {
      clave: 'anticipaciones',
      etiqueta: 'Anticipaciones',
      valor: metricas.anticipaciones,
      nivel: nivelDe(metricas.anticipaciones, REFERENCIAS.anticipaciones),
      texto: `Pulsaciones antes de ${TR_MINIMO} ms, imposibles de haber decidido viendo la letra. Muchas significan responder al ritmo y no al estímulo, y eso invalida el resto.`,
    },
  ]
}

/** Una fila por ensayo, para analizar la sesión fuera de aquí. */
export function aCsv(metricas) {
  const cabecera = ['indice', 'bloque', 'subbloque', 'isi_ms', 'letra', 'tipo', 'respondido', 'tr_ms', 'resultado']
  const filas = metricas.ensayos.map(ensayo => [
    ensayo.indice,
    ensayo.bloque + 1,
    ensayo.subbloque + 1,
    ensayo.isi,
    ensayo.letra,
    ensayo.nogo ? 'nogo' : 'go',
    ensayo.respondido ? 1 : 0,
    ensayo.tr == null ? '' : Math.round(ensayo.tr),
    ensayo.comision ? 'comision' : ensayo.omision ? 'omision' : ensayo.acierto ? 'acierto' : 'rechazo_correcto',
  ])
  return [cabecera, ...filas].map(fila => fila.join(',')).join('\n')
}
