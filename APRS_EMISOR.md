# Emisor APRS firmado · `/aprs-emisor`

Página **solo para el propietario** que firma un mensaje corto y genera el audio
AFSK 1200 baudios (Bell 202, AX.25 UI) del paquete APRS. El propietario
reproduce el audio hacia la radio y acciona el PTT él mismo. La página **no
transmite por sí sola**, no usa APRS-IS y no sube audio. El receptor `/aprs` sigue
siendo de solo recepción y no comparte estado con esta página.

El destino habitual es la pasarela de Google Apps Script que vigila aprs.fi y
reenvía por correo los mensajes que superan su verificación de firma.

## Mensaje

Texto del mensaje APRS, hasta 67 caracteres:

```
<letra> <contador> <firma> <texto>        A 42 K7Q2MD llego tarde
```

- `letra`: destinatario en el directorio de la pasarela (A–Z).
- `contador`: entero que solo sube. La pasarela acepta hasta 50 de adelanto, así
  que se toleran mensajes perdidos, y rechaza cualquiera ≤ al último aceptado.
- `firma`: 6 símbolos (30 bits, alfabeto sin `I O 0 1`) del HMAC-SHA256 de
  `contador|LETRA|TEXTO EN MAYÚSCULAS` con espacios colapsados, con el secreto
  compartido (clave = bytes UTF-8 de la cadena). Cubre letra, contador y texto:
  no se puede reutilizar con otro texto ni repetir.
- El texto viaja **en claro**: la firma autentica, no cifra.
- Solo ASCII imprimible, sin `{ | ~` (`{` abre el número de mensaje, que la
  pasarela recorta; `|` y `~` están reservados por APRS).

Paquete: `ORIGEN>APZ001,RUTA::DESTINATARIO:<mensaje>` con el destinatario relleno
a 9 caracteres y sin número de mensaje. `APZ001` es un *tocall* experimental.

## Datos en Firestore

Documento `APRS_PRIVADO/emisor`:

| Campo | Contenido |
| --- | --- |
| `secreto` | Secreto compartido con la pasarela (`verSecreto()` en Apps Script). |
| `contador` | Último contador **reservado**. El siguiente mensaje lleva este valor + 1. |
| `indicativo` | Indicativo de origen con SSID. |
| `destinatario` | Destinatario del mensaje APRS; debe coincidir con `DESTINO_APRS` de la pasarela. |
| `ruta` | Digipetidores separados por comas (`WIDE1-1,WIDE2-1`). |

El secreto no pasa por `localStorage`, ni por el estado de React, ni por la URL:
la interfaz solo conoce su longitud y lo lee dentro de la transacción que reserva
el contador, justo antes de firmar. El campo se vacía tras guardar y el valor no
se vuelve a mostrar. Las preferencias de audio (nivel, preámbulo, retardo,
letra) sí van a `localStorage`, y no son sensibles.

### Regla de Firestore (obligatoria)

`firestore.rules` es local y está fuera de Git; hay que añadir esto y desplegarlo
desde un entorno privado (`firebase deploy --only firestore:rules`):

```
match /APRS_PRIVADO/{docId} {
  allow read, write: if soyAdmin();
}
```

`soyAdmin()` es la función de las reglas actuales que identifica al propietario.
Sin esta regla Firestore rechaza todo (`permission-denied`) y la página lo indica.
Lectura y escritura son necesarias: guardar la configuración y reservar el
contador en una transacción. **Nada de esto protege el secreto si la regla no se
ha desplegado**: el código de la página es público; solo la regla decide quién
puede leerlo.

## Contador

Cada «Firmar y reproducir» reserva el siguiente contador con una transacción de
Firestore, de modo que dos pestañas o dos móviles nunca emiten el mismo. El
contador queda gastado aunque luego no se emita (la ventana de 50 lo tolera).
«Repetir el último» reproduce el mismo paquete sin gastar otro; si el primero ya
llegó, la pasarela rechazará la repetición como contador repetido y la cuenta
como fallo (a los tres fallos en una hora avisa por correo).

Si se pierde la sincronía, «Último contador usado» se edita en la configuración:
debe ser mayor que `ULTIMO_CONTADOR` de la pasarela y no pasarse en más de 50.
Si se regenera el secreto en Apps Script, el contador de la pasarela vuelve a 0.

## Uso con la radio

1. Conecta la salida de audio al micrófono de la radio (mejor con cable y nivel
   bajo) o acerca el altavoz al micrófono.
2. Escribe letra y texto y pulsa «Firmar y reproducir». El retardo (3 s por
   defecto) deja tiempo para pulsar y mantener el PTT antes de que suene.
3. Mantén el PTT hasta que termine el sonido. El preámbulo (60 flags ≈ 0,4 s por
   defecto) cubre lo que tarda la radio en emitir tras el PTT; sube si pierde el
   principio del paquete.
4. Ajusta el nivel hasta modular sin distorsión. Una radio sobremodulada o con
   poca desviación puede no decodificarse en el iGate.

Solo valen radios FM analógicas en la frecuencia APRS local (144,800 MHz en
Europa). Un hotspot DMR/D-STAR no recibe este audio: allí el texto se teclea en
la radio y la pasarela lo ve con el destinatario que ponga la red; la línea
firmada se puede copiar de la página.

## Pruebas

`npm run test:aprs` ejecuta `scripts/test-aprs-sender.mjs`, además de las
suites del receptor. Un fallo aquí es silencioso en producción: el mensaje sale,
aprs.fi lo muestra y la pasarela lo descarta como firma inválida. Por eso la
suite:

- fija vectores calculados con el firmador original (`firmador.html`), que ya
  coincidió con el script de Apps Script;
- compara con una réplica de Apps Script hecha con `node:crypto` y **bytes con
  signo** (lo que devuelve `Utilities.computeHmacSha256Signature`), en 300
  combinaciones que incluyen primeros bytes ≥ 128;
- recorre firma → AX.25 → AFSK a 48 000 y 44 100 Hz con ruido → demodulador →
  parser → verificación, exigiendo recuperar el mensaje exacto;
- comprueba el límite de 67 caracteres, los caracteres prohibidos y que una
  trama con un bit alterado se descarta.

No valida un enlace de radio real ni la pasarela desplegada; para eso sirve
enviar un mensaje de prueba y mirar la pestaña `Log` o ejecutar `diagnostico()`
en Apps Script.
