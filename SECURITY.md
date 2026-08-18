# Seguridad del despliegue

Este repositorio es publico. El workflow de GitHub Pages compila la aplicacion y
publica solo el contenido de `dist/`, pero cualquier archivo versionado tambien
se puede leer desde GitHub aunque no llegue al sitio web.

## Comprobacion automatica

Antes de publicar, ejecuta:

```bash
npm run check:security
```

El comando compila el sitio y bloquea el despliegue si encuentra configuracion
local, reglas de produccion, credenciales, hojas Excel, exportaciones DICOM o
mapas de fuentes entre los archivos versionados o dentro de `dist/`. El workflow
de GitHub Pages ejecuta la misma auditoria.

## Firebase

La configuracion web de Firebase incluida en `src/firebase.js` termina dentro
del JavaScript descargado por el navegador. La API key web identifica el
proyecto, pero no sustituye a una credencial de autorizacion. No se debe intentar
proteger Firebase ocultando esa configuracion con Base64.

Las reglas reales de Firestore se mantienen en `firestore.rules`, que esta
ignorado por Git. Se despliegan desde un entorno privado:

```bash
firebase deploy --only firestore:rules
```

Activa tambien Firebase App Check para reducir el abuso desde clientes no
autorizados y aplica restricciones adecuadas a la API key desde Google Cloud.

## Acciones externas pendientes

Estas acciones requieren acceso al proyecto de Firebase o al historial remoto y
no forman parte del despliegue de GitHub Pages:

1. Despliega el archivo local `firestore.rules` desde un entorno privado.
2. Revisa que la API key web solo permita las APIs de Firebase necesarias.
3. Registra el dominio publico en App Check con reCAPTCHA Enterprise, observa
   las metricas y habilita enforcement cuando el trafico legitimo funcione.
4. Valora reescribir el historial remoto si los archivos antiguos bajo
   `borrar/`, `NEMA/` o las reglas anteriores no deben seguir recuperables.

## Archivos locales

No se deben subir al repositorio:

- `firestore.rules`
- `.env*`, `.firebase/` y `.claude/`
- credenciales, certificados o claves privadas
- hojas de calculo usadas como fuente de trabajo
- exportaciones DICOM o cualquier dato clinico

Si uno de estos archivos ya estuvo versionado, ignorarlo evita nuevas
publicaciones pero no elimina sus revisiones antiguas del historial de Git.

## Limitaciones conocidas

- `public/Informe-Tanques-Terminal.html` es un informe estatico y publico. Su
  `iframe` permite scripts, pero queda aislado del origen principal mediante
  `sandbox`.
- Secure Paste publica metadatos y texto cifrado; la clave AES permanece en el
  fragmento de la URL. Elimina los pastes antiguos sin cifrar tras migrarlos.
- Los quizzes multijugador no son un mecanismo de evaluacion de alta confianza:
  la puntuacion se calcula en el navegador. Para evitar trampas se necesita una
  funcion de backend que valide las respuestas.
- `public/_headers` se conserva para proveedores compatibles. GitHub Pages lo
  sirve como archivo estatico y no lo aplica como configuracion de cabeceras
  HTTP. Si se requieren cabeceras estrictas, usa un hosting o proxy que permita
  configurarlas.

## Referencias

- [Firebase: API keys](https://firebase.google.com/docs/projects/api-keys)
- [Firebase: App Check para web](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
- [Firestore: consultas y reglas](https://firebase.google.com/docs/firestore/security/rules-query)
- [GitHub Pages: workflows personalizados](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
