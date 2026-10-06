# Protocolo experimental de radio para emergencias

Versión 0.1. Laboratorio web en `/red-emergencia`, dentro de Radioafición.

El objetivo es estudiar si una red de estaciones que aparecen progresivamente puede
descubrir enlaces, enviar mensajes breves y recuperar rutas sin un servidor central.
La recepción se evalúa por estación: que una trama llegue a un receptor no implica
que llegue a los demás. El primer escenario de validación es el terminal oculto:
A y C alcanzan a B, no se detectan entre sí y pueden transmitir simultáneamente.

## Alcance

Esta versión es una simulación experimental con reproducción y exportación de
audio sintético. No captura el micrófono, no acciona PTT ni VOX, no transmite RF y
no implementa una PWA sin conexión. No es un protocolo oficial Romeo Echo ni una
implementación interoperable de OLSR. Los datos y mensajes permanecen en memoria
del navegador, salvo las exportaciones que solicita el usuario.

## Separación entre canal y protocolo

`emergencyRadioAudio.js` contiene la trama binaria, CRC, modulación, demodulación,
ruido determinista y mezcla de muestras por receptor. `emergencyRadio.js` contiene
el simulador de eventos y el estado independiente de cada estación. La página
React solo presenta el estado y acepta acciones del observador.

El observador conoce posiciones, potencia y estados físicos para representar el
experimento. `selectMpr()` y `computeRoutes()` solo reciben información aprendida
mediante paquetes, nunca posiciones ni la matriz física de enlaces. Apagar una
estación no borra inmediatamente las rutas de las otras.

## Canal equivalente de audio

- BFSK de fase continua: 1200 Hz para cero y 2400 Hz para uno.
- 9600 muestras/s, con 100, 300, 600 o 1200 bit/s. No hay FEC en esta versión.
- Potencia recibida relativa: `18 + potencia_tx - 30 log10(max(d,20)/100) - pérdidas`.
  Son unidades de un escenario conceptual, no un cálculo de cobertura en campo.
- Ruido blanco uniforme, RMS unitario a 0 dB, con semilla y muestra temporal
  deterministas. Una misma grabación y el decodificador usan las mismas muestras.
- Las señales que se solapan se suman en el receptor antes de demodular. La trama
  debe superar el umbral simplificado de apertura y tener sincronismo, estructura
  y CRC válidos. La sincronización temporal de símbolos se proporciona idealmente
  desde el canal; aún no existe adquisición autónoma del reloj.
- Mientras transmite, la estación no recibe. Su audio de escucha se silencia.
- La geometría y las ganancias se fijan al comenzar cada emisión; movimientos
  durante esa emisión afectarán a las siguientes.
- La mezcla lineal puede recuperar una señal dominante, pero no implementa la
  captura, el limitador o el demodulador de un receptor FM real. Tampoco modela
  reverberación, osciladores, AGC, filtrado del equipo, colas de VOX o PTT.
- La reproducción usa normalización común de toda la mezcla, conservando las
  proporciones entre señales y ruido. El gráfico muestra una envolvente RMS.

Las pérdidas con solapamiento se etiquetan como tales; no se atribuye causalidad
exclusiva a la interferencia cuando también existe ruido. Las recepciones bajo
umbral no se incluyen en el porcentaje de CRC válidos mostrado.

## Trama de simulación

Prefijo de cuatro bytes `AA`, sincronismo `D3 91`, cabecera de 16 bytes,
contenido de hasta 240 bytes y CRC-16/CCITT-FALSE (polinomio 0x1021, inicio FFFF).
El CRC cubre cabecera y contenido. Se valida con el vector `123456789` = 29B1.

| Campo de cabecera | Bytes |
| --- | ---: |
| Versión, tipo y red | 3 |
| Origen, emisor de este salto, destino y siguiente salto | 4 |
| TTL y prioridad | 2 |
| Sesión de arranque y secuencia | 4 |
| Intento y longitud del contenido | 3 |

Los identificadores se asignan al crear el escenario; cero es válido y 255 es
difusión. La resolución distribuida de IDs duplicados no está implementada.
El CRC detecta errores accidentales, no autentica remitentes. Antes de una
implementación real habrá que resolver identidad, reinicios, secuencias,
autenticación y condiciones de uso de la banda.

| Tipo | Función y contenido |
| --- | --- |
| HELLO | Vecinos escuchados, enlace simétrico y selección de MPR; no se retransmite. |
| TOPOLOGY | Lista de vecinos simétricos del origen; se propaga con TTL y supresión de duplicados. |
| DATA | Texto UTF-8, máximo 96 bytes, destino concreto y prioridad. |
| ACK | Identidad del DATA recibido; vuelve al origen por una ruta descubierta. |
| PROBE | Prueba aislada del canal; no necesita rutas y no confirma mensajes de usuario. |

## Formación de la red

1. La estación escucha y programa HELLO con espera aleatoria. El periodo inicial
   es 20 s con variación del 20 %. Los cambios de vecindad adelantan anuncios.
2. Un enlace es simétrico cuando se reciben tramas del vecino y su HELLO incluye
   a la propia estación. Los reportes caducan tras tres periodos HELLO más 5 s.
3. La selección MPR cubre vecinos estrictos a dos saltos. Primero selecciona
   vecinos imprescindibles y después máxima cobertura marginal; en empates
   conserva selecciones previas y usa grado e ID como desempate determinista.
   Es una heurística, no una garantía de mínimo global.
4. Las estaciones elegidas como MPR emiten TOPOLOGY con periodo inicial de 60 s
   y variación del 20 %; sus listas incluyen los vecinos simétricos. Al dejar de
   ser MPR, emiten una retirada vacía. Los cambios adelantan anuncios con un
   mínimo de 5 s entre HELLO y 15 s entre TOPOLOGY. La opción MPR solo reenvía
   anuncios recibidos de un selector; la opción difusión permite que todos los
   receptores los retransmitan una vez. Ambas usan los mismos originadores y canal.
5. El grafo local combina vecindad confirmada, reportes HELLO y anuncios recibidos.
   Las rutas minimizan saltos mediante BFS. Los anuncios remotos caducan a los
   tres periodos de topología. Las rutas pueden estar desactualizadas durante
   ese intervalo: la pantalla nunca debe equiparar ruta calculada con entrega.

Procesar un anuncio y autorizar su retransmisión tienen cachés diferentes. Una
copia recibida antes de un no selector no impide reenviar después una copia
recibida de un selector MPR. Esta distinción evita perder cobertura silenciosamente.

## Acceso al canal y mensajes

Se escucha la energía recibida localmente antes de transmitir. Si está ocupado,
se difiere con espera aleatoria. El detector no conoce transmisores ocultos. Las
prioridades socorro, urgente y rutina ordenan la cola de cada estación; no pueden
interrumpir una trama en curso ni garantizan prioridad global.

Los DATA dirigidos usan rutas locales. El origen conserva un mensaje sin ruta
hasta su caducidad y admite hasta tres transmisiones del mismo mensaje. Cada
intento conserva la identidad original y permite reenviarlo tras una pérdida.
El destino presenta el texto una sola vez y repite ACK si vuelve a recibirlo.
La identidad del mensaje confirmado y el origen del ACK deben coincidir con
el pendiente. El acuse confirma decodificación, no lectura humana ni asistencia.

Estados visibles: esperando ruta, en cola, esperando acuse, recepción confirmada,
sin confirmación y caducado. La caducidad inicial es 180 s. No se ofrece una
latencia máxima garantizada. La reserva de capacidad para voz y el almacenamiento
persistente durante particiones largas quedan pendientes de evaluación.

## Uso del laboratorio

- Barrio: 20, 25 o 30 estaciones se incorporan de forma escalonada. Iniciar y avanzar el
  tiempo permite observar descubrimiento, tablas y mensajes entre extremos.
- Terminal oculto: tres estaciones, sin balizas automáticas. Comparar emisiones
  simultáneas y por turnos; seleccionar A, B o C para escuchar la misma ventana.
- Dos grupos y un enlace: apagar la estación Enlace, observar rutas antiguas,
  pérdida de entrega y caducidad; encenderla para estudiar recuperación.
- Mover nodos o cambiar potencia puede generar enlaces asimétricos. El modo
  físico muestra flechas; el protocolo sigue exigiendo bidireccionalidad.
- Cambiar tamaño del barrio, ruido, tasa binaria, intervalos de anuncio, estrategia
  o acceso al canal reinicia el ensayo. Alargar intervalos reduce tráfico periódico
  y retrasa la detección de cambios. En una red densa, las colisiones pueden impedir
  la confirmación incluso con una ruta calculada; no hay garantía de entrega.
- WAV conserva la última ventana del receptor; JSON exporta configuración,
  posiciones finales, estado, recepciones y eventos recientes. No es un archivo
  completo para reproducir todas las acciones manuales. La historia de señales
  se limita a 120 s y la de recepciones a 500 entradas.

## Verificación y siguiente fase

Ejecutar `npm run test:emergency-radio` y `npm run build:web`. La suite comprueba
CRC contra un vector externo conocido, BFSK, terminal oculto, potencias distintas,
half duplex, espera por canal, ruido, coherencia de reproducción, vecindad
asimétrica, MPR, ruta de cuatro saltos, ACK, partición, reconexión, caducidad,
duplicados, TTL, prioridad y reproducibilidad.

Para un módem real, evaluar primero Ribbit y comparar con esta capa simplificada.
Medir tasas de error con grabaciones y equipos concretos; añadir sincronización,
FEC, temporización PTT/VOX y validación de micrófono y suspensión móvil antes de
atribuir capacidad operativa en emergencias. La UN-110 española restringe PMR446
como repetidor; el simulador no equivale a una autorización de despliegue.

Referencias primarias:

- OLSR y selección MPR: https://www.rfc-editor.org/rfc/rfc3626
- Ribbit Web App: https://github.com/OpenResearchInstitute/ribbit_webapp
- CNAF 2026, UN-110: https://www.boe.es/boe/dias/2026/07/17/pdfs/BOE-A-2026-15661.pdf
