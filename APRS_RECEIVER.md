# Receptor APRS · `/aprs`

Página de solo recepción que decodifica paquetes APRS de VHF (AFSK 1200 bd,
Bell 202, AX.25 UI) a partir del micrófono o de una grabación. No emite por
radio, no graba el micrófono, no sube audio y no reenvía nada a APRS-IS. Las
únicas preferencias guardadas en `localStorage` son el micrófono elegido y la
posición propia opcional usada para calcular distancias.

## Cadena de recepción

1. `aprsCapture.worklet.js` recibe el audio a la frecuencia nativa del
   `AudioContext` (sin remuestreo) y lo pasa a `AfskDemodulator`.
2. `aprsModem.js`: filtro paso alto de 100 Hz (offset DC), correladores de
   1200 y 2200 Hz con ventana de un bit, y un banco de siete *slicers* que
   suponen un desequilibrio entre tonos (*twist*) de −9 a +9 dB. El de-énfasis
   de los receptores FM atenúa el tono de 2200 Hz; con una sola decisión
   equilibrada muchas radios no se decodifican. Cada slicer tiene su propio
   reloj (DPLL), decodificación NRZI y desentramado HDLC con eliminación de bits
   de relleno. Solo se aceptan tramas con FCS (CRC-16/X.25) válido; la misma
   trama decodificada por varios slicers se informa una vez, con la lista de
   compensaciones que la recuperaron.
3. `ax25.js` valida el campo de direcciones y produce la línea TNC2
   (`ORIGEN>DESTINO,DIGI*:info`), marcando solo el último digipetidor usado.
4. `aprsParser.js` interpreta el campo de información: posiciones sin
   comprimir y comprimidas, Mic-E, mensajes/acuses/boletines, estado, objetos,
   ítems, meteorología, telemetría, terceros y capacidades. Todo en unidades
   métricas; un campo ausente (`...`) queda ausente, nunca cero.

«Decodificar grabación» usa el mismo demodulador sobre el primer canal de
cualquier archivo que el navegador sepa abrir, a su frecuencia de muestreo.

## Uso

- Conecta la salida de audio del receptor a la entrada de línea/micrófono o
  coloca el micrófono junto al altavoz. Ajusta el volumen para quedar entre
  −30 y −10 dBFS sin saturar.
- La página pide el micrófono sin cancelación de eco, supresión de ruido ni
  control automático de ganancia; si el navegador los mantiene activos lo
  indica en el estado, porque distorsionan los tonos.
- «Autoprueba» modula un paquete con el tono alto 6 dB más bajo y lo
  decodifica sin micrófono ni altavoz. «Emitir paquete de prueba» lo reproduce
  por el altavoz para probar otro dispositivo que esté escuchando.

## Límites

- Solo 1200 bd AFSK (VHF). No hay 300 bd HF ni 9600 bd G3RUH.
- No corrige errores de bit: una trama con un bit erróneo se descarta.
- No se decodifican NMEA crudo (`$`), formatos Peet Bros/Ultimeter, DAO ni
  PHG/RNG (PHG queda en el comentario), ni la telemetría Mic-E.
- La página debe permanecer visible: el navegador puede suspender el audio en
  segundo plano.

## Pruebas

`npm run test:aprs` ejecuta `scripts/test-aprs.mjs` (CRC, AX.25 y
demodulador sobre audio modulado con ruido, twist, error de reloj, offset DC y
distintos tamaños de bloque, más una prueba de extremo a extremo) y
`scripts/test-aprs-parser.mjs` (ejemplos de APRS101 con los valores esperados
derivados en el propio archivo). Una lista vacía no demuestra nada: las pruebas
exigen recuperar la trama exacta.
