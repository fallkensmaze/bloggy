# Control de gammacámaras

## Aplicaciones

- `/resolucion-espacial-gamma`: fuentes lineales, por cabezal/frame y eje de medida.
- `/sensibilidad-gamma`: sensibilidad planar, por cabezal/frame/ventana.
- `/informe-mensual-gamma`: lote mensual privado; usa el mismo `useAuthUser`/propietario que Examen radio.
- Uniformidad y COR conservan sus páginas existentes. El lote mensual reutiliza sus motores puros y comprobaciones de adquisición.

El catálogo `src/utils/navigation.js` se comparte entre menús de escritorio y móvil. Agrupa medicina nuclear, radioterapia, resonancia magnética, radioafición y herramientas.

## Entrada y validación del lote

Todos los DICOM se leen en el navegador. El lector permite NM clásico con píxeles nativos de 8/16/32 bits, aplica BitsStored/HighBit y respeta NumberOfFrames, DetectorVector y EnergyWindowVector. No admite grupos funcionales NM ni transferencias comprimidas. Solo se retienen metadatos de QC explícitos, nunca nombre/ID del paciente.

Antes de ejecutar los motores del informe se comprueba el lote completo:

1. Cada archivo debe ser legible y tener fecha de adquisición válida (AcquisitionDate, o AcquisitionDateTime). SeriesDate/exportación/nombre de archivo no sustituyen la fecha de adquisición.
2. Todos deben pertenecer al mismo mes natural.
3. Debe coincidir la identidad compuesta de StationName, DeviceSerialNumber y fabricante/modelo, normalizando espacios y mayúsculas. Se requiere al menos estación o número de serie. Un modelo por sí solo no identifica una cámara. Si cambia/falta un identificador en parte del lote se bloquea; no se adivina una equivalencia.
4. Los SOPInstanceUID repetidos bloquean la duplicación de resultados.

Un fallo conserva los archivos en la lista para retirarlos: no se separan silenciosamente en lotes ni se descartan archivos problemáticos. La clasificación por descripción es una propuesta editable; los desconocidos quedan pendientes.

Las declaraciones pertenecen a cada archivo, y fondo, tiempo y sensibilidad de referencia pueden variar por cabezal. Cambiar parámetros elimina sus resultados anteriores y la vista de informe. La escala de visualización no cambia las cuentas utilizadas.

## Resolución espacial

Método adaptado para una única fuente lineal. La covarianza de la señal permite proponer el eje y la ROI. Se excluyen los extremos de la línea y se integran cinco franjas independientes de hasta ocho píxeles, sin suavizar ni ajustar gaussianas. Los cruces al 50 % y al 10 % se interpolan linealmente alrededor del máximo muestreado. Se informa la media FWHM/FWTM y la dispersión entre franjas.

X usa el espaciado de columnas; Y el de filas. La conversión a mm utiliza PixelSpacing. Una ROI puede dibujarse o editarse por coordenadas. No se descuentan el diámetro del capilar ni el tamaño del píxel. Se rechazan perfiles truncados, picos separados y líneas inclinadas más de 2° (control de la herramienta, no tolerancia NEMA). Se avisa del muestreo inferior a diez puntos por FWHM, pico inferior a 10 000 cuentas y posible ensanchamiento por inclinación.

La referencia metodológica es [IAEA HHS 6, §2.3.8, método cuantitativo](https://www-pub.iaea.org/MTCD/Publications/PDF/Pub1394_web.pdf). La adaptación de una sola fuente/PixelSpacing **no implementa una aceptación NEMA completa**, ni toda la geometría de fuentes/posiciones del procedimiento IAEA. Las tolerancias se introducen con su origen y protocolo de referencia.

## Sensibilidad

Se requieren cuentas originales STATIC EMISSION no negativas y sin transformación de unidades. No se aceptan como cuentas una imagen reescalada o corregida por decaimiento, atenuación o dispersión. Las unidades ausentes son habituales en NM original; su interpretación y el protocolo deben ser revisados por el usuario.

Por frame, con actividad medida `A`, residual opcional `Ar` y tiempos de medida propios:

```
Ainicio = A·exp(-λ·(tinicio-tA)) - Ar·exp(-λ·(tinicio-tAr))
Amedia  = Ainicio·(1-exp(-λ·T))/(λ·T)
Rneta   = C/T - Cf/Tf
S       = Rneta/Amedia                [cps/MBq]
u(S)    = sqrt(C/T² + Cf/Tf²)/Amedia  [solo estadística de conteo]
```

Se usan cuentas de toda la matriz para muestra y fondo. ActualFrameDuration está en ms y se convierte a segundos por frame; nunca se suman tiempos entre cabezales. La corrección de fondo requiere medida o declaración explícita de fondo despreciable. El semiperiodo se introduce/selecciona expresamente. No se usa RadionuclideTotalDose como medida del activímetro. Fecha y hora son los relojes locales del equipo/activímetro, que deben estar sincronizados.

La comparación utiliza desviación absoluta porcentual frente a una referencia por cabezal. Se necesitan referencia, tolerancia, procedencia y adquisición confirmada para declarar conformidad. La incertidumbre de actividad/calibración no está incluida en la incertidumbre estadística mostrada.

Referencia: IAEA HHS 6 §2.3.9. La integración temporal exacta es una implementación de la ley de decaimiento durante la exposición.

## Informe y reconstrucción tomográfica

La lista de pruebas esperadas contiene uniformidad, sensibilidad y resolución X/Y por cabezal, COR y revisión tomográfica. Se puede indicar 1, 2 o 3 cabezales. Un informe incompleto se puede imprimir como incompleto; no recibe un estado conforme. Se exporta JSON con medidas, parámetros, tolerancias, fecha, equipo y versiones, y una vista de impresión/PDF.

La revisión tomográfica muestra los frames NM y permite anotar protocolo, hallazgos y valoración del especialista. No calcula todavía índices tomográficos de fantoma ni reconstruye proyecciones. La conformidad visual exige texto y confirmación del usuario. Debe validarse con una adquisición reconstruida representativa antes de introducir un protocolo cuantitativo específico.

El botón «Preparar imagen y consulta» descarga un mosaico PNG de hasta doce frames (incluye el seleccionado), con escala lineal común y números de frame, y copia una consulta orientativa. El usuario abre ChatGPT y adjunta el PNG. No hay envío automático, clave ni llamada a OpenAI desde el navegador. El mosaico es un apoyo: no sustituye revisar el resto de cortes.

Para una futura API automática, el flujo sería navegador → función de servidor autenticada → Responses API. El servidor debe verificar el ID token de Firebase y el UID del propietario, limitar tamaños/frecuencia y cargar la clave desde un secreto de servidor. Una variable `VITE_*`, un archivo `.env` incorporado al build o una clave ofuscada no son un almacén privado. El análisis del modelo debe seguir pendiente de revisión humana y no cambiar por sí solo el veredicto del informe.

Documentación oficial de OpenAI: [autenticación y claves](https://developers.openai.com/api/reference/overview), [imágenes de entrada](https://developers.openai.com/api/docs/guides/images-vision). El backend de API no está implementado ni desplegado en este cambio.

## Privacidad y almacenamiento

Las imágenes y resultados viven solo en memoria de la pestaña. El área mensual se desmonta al perder la sesión del propietario. No se crea una colección Firestore ni se guardan DICOM/resultados en localStorage. El código de la SPA es público; lo privado es el acceso a la interfaz del informe y los datos que se procesan localmente. La descarga JSON/PDF queda en manos del usuario. No se incluyen DICOM de muestra, capturas reales, informes ni secretos en Git o `dist`.

## Verificación

`npm run test:gamma` usa DICOM sintéticos y resultados analíticos: ejes/espaciados, anchuras gaussianas, truncamiento, picos múltiples, fondo, semiperiodos, residual, medianoche, identificación de cabezales, bloqueos de lote y estados incompletos. Opcionalmente `GAMMA_QC_FIXTURE_DIR=/ruta/local npm run test:gamma` valida los tres ejemplos facilitados, sin copiarlos al repositorio.

Se ejecutan también `npm run test:nema`, `npm run test:cor` y `npm run build:web`. El workflow ejecuta las tres suites de gammacámara y el build completo (incluido WASM del simulador FDTD).

Decay Calculator incluye ahora Y-90 con T½ = 64,053 h, valor de [IAEA TRS 473](https://www.iaea.org/publications/8522/nuclear-data-for-the-production-of-therapeutic-radionuclides) y la [medida de referencia de PTB](https://pubmed.ncbi.nlm.nih.gov/15082054/). El acceso rápido de sensibilidad utiliza Tc-99m = 6,0067 h, valor usado en la [comparación BIPM](https://www.bipm.org/documents/20126/48150639/BIPM.RI%28II%29-K4.Tc-99m-F-18-Cu-64-POLATOM-2022.pdf/421b70ab-dd81-bb62-e134-ac71c1850ff7).
