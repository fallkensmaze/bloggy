# Estación de audio · VOX v0.1

La ruta pública `/estacion-radio` es una aplicación de micrófono y altavoz,
independiente del simulador `/red-emergencia`. El navegador recibe muestras reales,
busca tramas BFSK y reproduce audio para activar el VOX de un walkie cercano.
No controla PTT, frecuencia, potencia ni subtonos del equipo. No requiere un
servidor para el transporte de audio ni sube las muestras del micrófono.

La web general conserva sus servicios existentes. Una vez cargada esta página,
el transporte funciona localmente; volver a cargarla necesita conexión. No se ha
añadido caché offline, PWA ni ejecución fiable en segundo plano.

## Puesta en marcha

1. Primero usa la autoprueba local, que no emite sonido, y dos dispositivos
   comunicándose por altavoz y micrófono, sin radio.
2. En cada estación asigna un ID distinto de 1 a 254; por ejemplo, 1 y 2.
   Usa el mismo grupo (17 por defecto) y tasa (300 bit/s inicialmente).
3. Para la prueba con radio, configura los dos walkies en el mismo canal y
   subtono, activa VOX y coloca cada navegador junto a su equipo. Empieza con
   volumen moderado y permite el micrófono.
4. Anuncia manualmente la presencia en una estación y comprueba que la otra
   recibe su nombre. No hay anuncios periódicos ni tráfico continuo.
5. Envía un texto breve al ID remoto. Solo «Recepción confirmada» significa que
   ha vuelto un acuse coincidente. «Sin confirmación» puede indicar pérdida del
   mensaje o pérdida del acuse.
6. Ajusta el tono previo para evitar que VOX recorte el comienzo. Ajusta el
   retorno a recepción para superar el tiempo de retención del VOX de ambos
   walkies. Mantén la página visible y la pantalla encendida.

Esta versión es directa, TTL 1: no reenvía mensajes ajenos ni implementa MPR,
topología o descubrimiento de rutas. Los anuncios solo registran estaciones
oídas; no prueban conectividad bidireccional. El enlace de audio se valida antes
de trasladar el protocolo de varios saltos del simulador.

El objetivo es estudiar comunicaciones de socorro. El artículo 4.9 del
[Reglamento de Radiocomunicaciones de la UIT, edición 2024](https://www.itu.int/pub/R-REG-RR-2024)
contempla el uso de los medios disponibles por una estación en peligro o que la
asiste para pedir o prestar auxilio. Esto no supone una autorización general
para los ensayos o el uso habitual. En España, la UN-110 del
[CNAF de 2026](https://www.boe.es/buscar/act.php?id=BOE-A-2026-15661)
excluye repetidores y estaciones base en PMR446. La aplicación actual no
retransmite; la adecuación de una futura red a un caso de socorro requiere
considerar sus circunstancias y el marco aplicable.

## Audio y sincronización

- BFSK de fase continua: 1200 Hz para 0 y 2400 Hz para 1, a 300 o 600 bit/s.
  El audio generado usa 9600 muestras/s; Web Audio lo reproduce a la tasa nativa.
- Tono VOX de 1200 Hz, 700 ms por defecto, seguido de 16 bytes AA de
  entrenamiento y la trama. Cola de tono de 120 ms y retorno de 1200 ms por
  defecto; los tiempos y el volumen se pueden ajustar antes de activar.
- Formato común de audio: prefijo AA AA AA AA D3 91, cabecera de 16 bytes,
  longitud y payload, CRC-16/CCITT-FALSE. Los bytes viajan MSB primero.
- Captura con AudioWorklet a la frecuencia nativa. Filtros de 300 y 3000 Hz
  antes de un remuestreador continuo a 9600 Hz. Se solicita captura sin eco,
  supresión de ruido ni ganancia automática; se muestran los ajustes que el
  navegador informa, porque el dispositivo puede no respetarlos.
- El receptor mantiene la correlación de un símbolo completo con ocho fases
  para conservar sensibilidad al ruido. En paralelo, una ventana de ocho
  muestras (un ciclo de 1200 Hz) busca fases de media muestra. Ambos caminos
  prueban 17 balances de energía de −12 a +12 dB, en pasos de 1,5 dB.
  El camino corto tolera diferencias
  entre tonos y transiciones mezcladas por eco; las energías interpoladas permiten
  probar las fases intermedias sin modificar las muestras. El estado está
  acotado a 1224 candidatos a 300 bit/s y 680 a 600 bit/s.
  Encuentra el prefijo en el flujo continuo sin una marca externa de
  inicio o fin. Adquiere un candidato cuando coinciden los 48 bits del prefijo;
  solo entrega una trama tras comprobar cabecera, longitud y CRC. El contraste
  de tonos se informa, pero no bloquea la adquisición: un eco puede reducirlo
  aunque el prefijo y la trama completa sigan siendo correctos. Al aceptar una
  trama se vacían todos los candidatos para no entregar duplicados. El contraste
  informado corresponde al balance del candidato que pasó el CRC.
- Mantiene la tasa nominal dentro de cada trama. No tiene PLL, compensación de
  grandes diferencias de reloj, FEC, cifrado ni autenticación. CRC detecta errores
  accidentales; no impide suplantación. El contraste de tonos no es SNR calibrado.

No se reproduce la entrada del micrófono. Durante TX y retorno se descarta la
recepción local para evitar eco. La espera de canal libre exige 600 ms sin audio
por encima del umbral ni una trama en recepción. Esto no evita colisiones con
estaciones ocultas y la voz o el ruido pueden aplazar emisiones.

## Protocolo directo

`AudioStationProtocol` conoce únicamente su configuración y las tramas recibidas
por el módem, nunca posiciones, enlaces del simulador o estado de otras apps.

- HELLO: anuncio manual al grupo, nombre de hasta 32 bytes UTF-8. No genera
  respuestas, mantenimiento periódico ni rutas.
- DATA: texto de 1 a 96 bytes UTF-8, dirigido a un ID o a 255 (grupo). Prioridad
  0 emergencia, 1 urgente o 2 normal dentro de la cola local.
- ACK: seis bytes con origen, época y secuencia del DATA, más número de intento.
  Solo confirma un mensaje enviado al emisor esperado, en el grupo y destino
  correctos, con identidad e intento realmente emitidos y antes de su caducidad.
- El receptor presenta una identidad DATA una sola vez y vuelve a acusar un
  duplicado dirigido. Coalesce acuses pendientes para la misma identidad.
  Un DATA a 255 no recibe acuses, evitando una tormenta de respuestas.
- Hasta tres intentos de DATA dirigido, misma identidad en cada reintento y
  espera aleatoria. La espera de ACK es de al menos 10 s y contempla el audio y
  los retornos configurados. Cada entrada caduca a los 120 s.
- Cola de 24 entradas, 100 mensajes, 100 recibidos, 100 eventos y 256 identidades
  para deduplicar. Un anuncio ya pendiente no se duplica. No se acumulan balizas.
- Otra época usando el ID local provoca conflicto y bloquea nuevas emisiones.
  El eco de la propia época se ignora. Un reinicio requiere volver a anunciarse.

El grupo por defecto es 17, separado del 7 del simulador. Aunque se comparte
el formato de trama, los HELLO y el transporte TTL-1 son específicos de esta
estación y no son interoperables con el encaminamiento del simulador.

## Ciclo de vida y exportación

«Detener todo», cambio de página, pestaña oculta, audio suspendido, desconexión
del micrófono o fallo del procesador cancelan audio, captura, cola y reintentos.
No hay reinicio automático al volver a la pestaña. Se solicita un bloqueo de
pantalla si está disponible, sin depender de que sea concedido.

El arranque reactiva el AudioContext tras obtener el permiso y conectar la
captura: abrir el micrófono puede suspender o cambiar la ruta de audio después
de la activación inicial. Solo se declara la estación activa si la pestaña
sigue visible, el micrófono sigue conectado y el contexto está en ejecución.
La recuperación es exclusiva del arranque: una suspensión posterior conserva
la parada inmediata y requiere una nueva activación manual. Cancelar durante
el permiso o la activación no debe iniciar una captura tardía.

Solo las preferencias se guardan en localStorage. Una sesión nueva o recarga
borra los mensajes. El JSON `RADIO_AUDIO_STATION_V1` incluye la configuración
de la sesión y estados locales, sin grabación de muestras. Descargar un WAV
genera una señal de prueba y no cuenta como envío confirmado. La autoprueba
verifica el DSP local sin usar micrófono ni reproducir audio.

### Diagnóstico de recepción

El panel muestra el nivel de 1200 y 2400 Hz, los candidatos que adquirieron el
prefijo, los rechazados y las tramas con CRC válido de cualquier grupo. Los
candidatos se cuentan por ventana, fase de símbolo y balance de tonos, no como
paquetes independientes. Los contadores duran toda la sesión, incluido el
retorno de TX, para no perder sincronismos demasiado breves para la pantalla.
Los niveles son el máximo RMS de las ventanas de símbolo en cada intervalo de
reporte de unos 100 ms, después de los filtros; no son SPL ni SNR calibrado.
Durante TX o parada se identifica la lectura como pausada.

«Grabar recepción · 10 s» captura únicamente por solicitud explícita las
muestras mono a 9600 Hz que entran al decodificador. No es una grabación cruda:
ya incluye el procesamiento del dispositivo, los filtros y el remuestreo.
El búfer está limitado a 96 000 muestras y queda solo en memoria; puede contener
voces del entorno. Las descargas WAV y JSON son manuales, sin subida ni
persistencia automática. Se puede cancelar o descartar y una sesión nueva
borra la grabación anterior. La parada cancela y descarta una toma incompleta.
Una toma que no termina en 15 s de tiempo real se cancela con un aviso.

Durante esos diez segundos se aplaza la transmisión local, incluidos los
acuses, por lo que esta prueba debe usar un anuncio HELLO remoto y no medir
tiempos de confirmación. No se inicia mientras haya emisiones pendientes.
El JSON de diagnóstico incluye ajustes de captura, configuración y contadores
antes/después; no incluye muestras. El JSON general de sesión sigue sin audio.
No se altera el prefijo ni se relaja el CRC: el panel permite investigar un
fallo real, pero no constituye una corrección validada en iPhone ni en RF.

## Verificación y límites

`npm run test:radio-audio` cubre 21 casos: sincronización con comienzo y bloques
desconocidos, captura a 44,1/48 kHz, ruido y pequeñas diferencias de reloj,
CRC corrupto y recuperación, VOX, intercambio DATA/ACK mediante muestras,
identidades de acuse incorrectas, acuse perdido, reintentos y caducidad,
difusión, silencio sin tráfico, canal ocupado, parada, IDs duplicados y límites.
Incluye eco sintético de un símbolo a 300/600 bit/s: recepción con bajo contraste
de tonos y rechazo de una trama con CRC corrupto bajo el mismo canal.
Incluye desequilibrio sintético de ±9 dB entre tonos junto a un eco, llegadas
fraccionarias, textos de 96 bytes, CRC corrupto y reinicio de candidatos a
ambas tasas. Las regresiones sintéticas no contienen grabaciones de usuarios.
Otro caso combina eco de amplitud 0,25, desequilibrio de ±6 dB y ruido blanco
con relación señal/ruido de 6 dB a 300 bit/s y 9 dB a 600 bit/s a la entrada
del decodificador: ocho semillas
por tasa y balance (48 combinaciones). El balance también se busca en las
ventanas completas para conservar la integración frente al ruido. Ese ensayo
no valida voces, interferencias tonales o impulsivas, ni un umbral acústico de
funcionamiento. El ruido y el eco más intensos aún pueden impedir la recepción.
También ejecuta cuatro pruebas de diagnóstico: niveles RMS de tonos conocidos,
contadores de sincronismo y CRC, captura acotada a diez segundos a 44,1/48 kHz,
y cancelación sin retención de audio ni reproducción del micrófono.
Las pruebas del ciclo de vida reproducen suspensión durante el permiso,
cancelación durante el arranque y parada por suspensión u ocultación posterior.
`npm run test:emergency-radio` verifica la compatibilidad del formato compartido.

La prueba del navegador usa entrada PCM de micrófono de prueba a 48 kHz,
AudioWorklet y filtros reales de Web Audio: recibe HELLO y DATA UTF-8 y genera
el ACK por el altavoz. Verifica también la parada y el ancho móvil. Estas pruebas
no validan VOX, RF, subtonos, distorsión o comportamiento de walkies físicos.
Quedan por medir con equipos reales, especialmente el retorno del acuse y las
colisiones. No se presenta el prototipo como un sistema de emergencia validado.
