# Falken's Maze

Blog y herramientas de Física Médica y Medicina Nuclear.

## Tecnologías

- **React 18** - interfaz web
- **Vite 8** - desarrollo y build
- **React Router** - navegación SPA
- **Firebase** - Firestore y autenticación
- **Chart.js** - gráficos
- **dicom-parser** y **dcmjs** - procesamiento DICOM
- **marked**, **highlight.js** y **KaTeX** - contenido técnico

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
```

Los archivos compilados se generan en `dist/`. La configuración de producción en `vercel.json` redirige las rutas a `index.html` para que React Router gestione la navegación.

## Herramientas clínicas y técnicas

| Ruta | Herramienta | Descripción |
| --- | --- | --- |
| `/convert-units` | Conversor Ci-Bq | Conversión entre unidades de actividad radiactiva. |
| `/decay-calculator` | Decay Calculator | Actividad residual mediante `A(t) = A0 · exp(-ln(2) · t / T1/2)`. |
| `/restricciones-lu177` | Restricciones Lu-177 | Estimación de restricciones dosimétricas para DOTA-TATE y PSMA-617. |
| `/uniformidad-gamma` | Uniformidad NEMA | Análisis de uniformidad intrínseca de gammacámara y comparación NEMA / Pylinac-IAEA. |
| `/centro-rotacion-spect` | Centro de rotación SPECT | NEMA NU 1-2007 §4.1, retroproyección 3D y validación ROC de límites locales. |
| `/pet-nema-fraccionamiento` | PET NEMA IQ | Preparación guiada del maniquí de esferas con actividades F-18 actualizadas en tiempo real y cronómetros operativos. |
| `/rtplan-compare` | Comparar RT Plans | Comparación de planes DICOM RT. |
| `/tg43-calculator` | Calculador TG-43 | Verificación de dosis HDR para Ir-192. |
| `/acr-qc` | ACR MRI QC | Análisis DICOM del maniquí ACR Medium. |
| `/lector` | Lector rápido | Lectura RSVP con persistencia local del progreso. |
| `/informe-tanques` | Tanques Lu-177 | Informe interactivo para residuos líquidos. |

El detalle técnico del nuevo módulo PET está en [PET_NEMA_FRACTIONATION.md](PET_NEMA_FRACTIONATION.md).

## Otras funciones

| Ruta | Función |
| --- | --- |
| `/` | Blog técnico con contenido Markdown. |
| `/quizzes` | Listado de quizzes públicos. |
| `/quiz-creator` | Creación de quizzes. |
| `/quiz/:quizId` | Quiz individual. |
| `/host/:quizId` y `/join` | Sesiones multijugador en tiempo real. |
| `/ptb` y `/ptb/:pasteId` | Secure Paste cifrado en el navegador. |

## Estructura

```text
src/
├── components/             # Layout, Sidebar y Topbar
├── pages/                  # Páginas y calculadoras
├── utils/                  # Algoritmos reutilizables
│   ├── dicomParser.js
│   ├── nemaAlgorithms.js
│   ├── petNemaFractionation.js
│   ├── rtPlanParser.js
│   └── rsvp.js
├── lib/
│   ├── acr-qc.js           # Módulo ACR MRI QC
│   └── brachy/             # Cálculos TG-43
├── styles/                 # CSS global y estilos por módulo
├── firebase.js             # Configuración Firebase
├── App.jsx                 # Router principal
└── main.jsx                # Entry point
public/
└── Informe-Tanques-Terminal.html  # Informe estático servido en /informe-tanques
```

## Firebase

Colecciones utilizadas:

- `BLOG` - entradas del blog.
- `QUIZZES` - definición de quizzes.
- `QUIZ_SESSIONS` - sesiones multijugador en tiempo real.
- `PASTES` - contenido cifrado de Secure Paste.
- `USER_LIMITS` - control de frecuencia de Secure Paste.

## Seguridad

El repositorio es público, pero GitHub Pages publica solo el artefacto `dist/`.
Ejecuta `npm run check:security` antes de desplegar para compilar y comprobar
que no se versionan ni publican reglas privadas, credenciales, hojas Excel o
exportaciones DICOM. Consulta [SECURITY.md](SECURITY.md) para desplegar las reglas
de Firestore por separado y revisar las limitaciones del hosting estático.

## Documentación

- [PET_NEMA_FRACTIONATION.md](PET_NEMA_FRACTIONATION.md) - cálculo y cronómetros de la prueba PET NEMA de calidad de imagen.
- [COR_NEMA_ANALYSIS.md](COR_NEMA_ANALYSIS.md) - método NEMA de centro de rotación, modelo 3D y validación de tolerancias.
- [SECURITY.md](SECURITY.md) - auditoría del artefacto público y despliegue privado de reglas de Firestore.
- [DICOM_MIGRATION.md](DICOM_MIGRATION.md) - migración de lectura DICOM.
- [TG43_IMPROVEMENTS.md](TG43_IMPROVEMENTS.md) - mejoras del calculador TG-43.

## Licencia

Proyecto personal de Física Médica.
