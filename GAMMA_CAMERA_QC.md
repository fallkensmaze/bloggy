# Control de gammacámaras

## Aplicaciones

- `/resolucion-espacial-gamma`: fuentes lineales, por cabezal/frame y eje de medida.
- `/sensibilidad-gamma`: sensibilidad planar, por cabezal/frame/ventana.
- `/uniformidad-tomografica`: uniformidad SPECT 3D con esferas manuales y barrido
  por diámetro. Método cuantitativo complementario; ver `TOMO_UNIFORMITY.md`.
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

La revisión tomográfica muestra los frames NM y permite anotar protocolo, hallazgos y valoración del especialista. El volumen se valida también con el lector estricto `tomoDicom.js`; las proyecciones no se aceptan como cortes. Integra la aplicación de esferas 3D, sin reconstruir proyecciones. La conformidad visual exige texto y confirmación del usuario y es independiente del índice cuantitativo complementario.

El botón «Preparar imagen y consulta» descarga un mosaico PNG de hasta doce frames (incluye el seleccionado), con escala lineal común y números de frame, y copia una consulta orientativa. El usuario abre ChatGPT y adjunta el PNG. No hay envío automático, clave ni llamada a OpenAI desde el navegador. El mosaico es un apoyo: no sustituye revisar el resto de cortes.

Para una futura API automática, el flujo sería navegador → función de servidor autenticada → Responses API. El servidor debe verificar el ID token de Firebase y el UID del propietario, limitar tamaños/frecuencia y cargar la clave desde un secreto de servidor. Una variable `VITE_*`, un archivo `.env` incorporado al build o una clave ofuscada no son un almacén privado. El análisis del modelo debe seguir pendiente de revisión humana y no cambiar por sí solo el veredicto del informe.

Documentación oficial de OpenAI: [autenticación y claves](https://developers.openai.com/api/reference/overview), [imágenes de entrada](https://developers.openai.com/api/docs/guides/images-vision). El backend de API no está implementado ni desplegado en este cambio.

## Privacidad y almacenamiento

Las imágenes y resultados viven solo en memoria de la pestaña. El área mensual se desmonta al perder la sesión del propietario. No se crea una colección Firestore ni se guardan DICOM/resultados en localStorage. El código de la SPA es público; lo privado es el acceso a la interfaz del informe y los datos que se procesan localmente. La descarga JSON/PDF queda en manos del usuario. No se incluyen DICOM de muestra, capturas reales, informes ni secretos en Git o `dist`.

## Verificación

`npm run test:gamma` usa DICOM sintéticos y resultados analíticos: ejes/espaciados, anchuras gaussianas, truncamiento, picos múltiples, fondo, semiperiodos, residual, medianoche, identificación de cabezales, bloqueos de lote y estados incompletos. Opcionalmente `GAMMA_QC_FIXTURE_DIR=/ruta/local npm run test:gamma` valida los tres ejemplos facilitados, sin copiarlos al repositorio.

Se ejecutan también `npm run test:nema`, `npm run test:cor` y `npm run build:web`. El workflow ejecuta las tres suites de gammacámara y el build completo (incluido WASM del simulador FDTD).

Decay Calculator incluye ahora Y-90 con T½ = 64,053 h, valor de [IAEA TRS 473](https://www.iaea.org/publications/8522/nuclear-data-for-the-production-of-therapeutic-radionuclides) y la [medida de referencia de PTB](https://pubmed.ncbi.nlm.nih.gov/15082054/). El acceso rápido de sensibilidad utiliza Tc-99m = 6,0067 h, valor usado en la [comparación BIPM](https://www.bipm.org/documents/20126/48150639/BIPM.RI%28II%29-K4.Tc-99m-F-18-Cu-64-POLATOM-2022.pdf/421b70ab-dd81-bb62-e134-ac71c1850ff7).

### Correcciones gamma-qc-1.1

COR utiliza la geometría y las condiciones de adquisición compartidas con la página
individual. Una fuente ausente, truncada o ambigua en cualquier vista bloquea el
análisis completo. Las pruebas sintéticas incluyen un lote COR válido y el mismo
lote con la fuente central ausente en 30°: solo el primero puede resultar conforme.
La clasificación da prioridad a reconstrucciones tomográficas sobre «resolución»;
wholebody y variación longitudinal de sensibilidad quedan como tipo desconocido,
pues no equivalen a sensibilidad planar. La propuesta sigue siendo editable.

### COR cor-qc-1.2

El informe mensual comparte las nuevas declaraciones COR por archivo, el control de
radio y reescalado, el recentrado por vista y el rechazo de rotaciones mezcladas.
El visor COR permite comprobar los centroides y ROI. Si se editan las condiciones,
el resultado se invalida y se recalcula con «Analizar / actualizar todas las pruebas».
El JSON conserva los centroides y la versión COR junto con los datos de adquisición.

### Informe mensual gamma-qc-2.0

El resumen reproduce los cinco bloques del informe facilitado: uniformidad intrínseca
(UDCC, UDCT, UICC, UICT), resolución FWHM/FWTM con X, Y y media, sensibilidad,
cuatro cotas COR y revisión tomográfica con tres planos. UDCC y UDCT son el máximo
de las dos direcciones diferenciales en CFOV y UFOV; una dirección ausente no se
oculta mediante un máximo parcial. Se corrige la asociación de claves DU a sus
límites (DUvertUfov → DUufov, DUvertCfov → DUcfov).

El perfil mensual de Sala 1 se precarga para la cámara 1660 en adquisiciones de
2026, usando las tolerancias del Excel facilitado (ver actualización 2.1 al final).
«Restablecer tolerancias del Excel · Sala 1» permite recuperar esos valores, sin
copiar resultados, actividades, protocolos ni confirmaciones de adquisición.
No cambia el píxel de análisis NEMA. Este se
revisa por DICOM (Auto o binning hacia 78 × 78); los números geométricos no se
presentan como equivalentes al procesamiento propietario de Siemens.

**Unidades de sensibilidad:** el Excel identifica explícitamente **202 cpm/µCi**.
Coincide con la especificación Siemens Symbia LEHR a 10 cm y es
equivalente a **90,99099099 cps/MBq**. La equivalencia exacta es
1 cps/MBq = 2,22 cpm/µCi. Se añade comparación por mínimo absoluto, además de
desviación respecto a referencia. Resultado y límite usan la misma unidad elegida.
Cambiar de unidad borra los valores de referencia/límite de ese cabezal para
evitar reinterpretar el mismo número. El cálculo y su incertidumbre estadística
siguen almacenados internamente en cps/MBq.

Fuente del fabricante:
https://www.siemens-healthineers.com/es/refurbished-systems-medical-imaging-and-therapy/ecoline-refurbished-systems/molecular-imaging-ecoline/symbia-intevo-eco

**Resolución:** el resumen permite comparar la media aritmética X/Y, como el
ejemplo, o cada eje por separado. Para la media se requieren ambas medidas,
límites coincidentes, procedencia/protocolo y verificación de ambas adquisiciones.
Una anchura ausente no se promedia. El JSON y el anexo conservan las medidas y
evaluaciones individuales y explican cuándo el criterio del resumen es distinto.

**Repeticiones:** todas las imágenes se validan y analizan. Dos resultados para
la misma prueba/cabezal/eje bloquean la preparación del resumen; no se elige el
más reciente ni el mejor automáticamente. «Incluir» permite excluir una adquisición
del resumen indicando un motivo; la fecha, tipo, archivo y motivo permanecen en
JSON y en el anexo. Los archivos excluidos siguen pasando la validación de cámara,
mes, legibilidad y duplicados SOP. Los informes incompletos pueden prepararse con
sus ausencias y errores explícitos; las repeticiones ambiguas deben resolverse.

**Tomografía:** se proponen tres planos centrales recortados al cilindro detectado.
En «Explorar los tres planos» se pueden cambiar posiciones, ventana y geometría y
capturarlos para el informe. Se etiquetan XY/XZ/YZ nativos, sin inventar planos
anatómicos. El mismo worker de la aplicación 3D calcula la curva y la incorpora
al JSON y a un anexo con tabla y gráfica. Cambiar geometría/parámetros elimina el
resultado anterior y exige recalcular; el índice no sustituye la medida del
protocolo ni altera el veredicto visual.

La cabecera, sala, número de serie, responsable y observaciones son editables. Se
puede aportar un logotipo y una imagen de QC diario PNG/JPEG, exclusivamente en
memoria. La impresión A4 usa una hoja de resumen para el caso de dos cabezales y
notas breves, seguida de trazabilidad opcional y del anexo cuantitativo cuando exista.
Notas largas o más cabezales pueden ocupar más páginas. No se incorporan informes,
logotipos privados, DICOM ni capturas reales al repositorio.

Verificación: `test:gamma` incluye `test-gamma-monthly.mjs`. La variable opcional
`GAMMA_MONTHLY_FIXTURE_DIR=/ruta/local` prueba un lote mensual completo sin copiarlo
al repositorio. Se ha comprobado localmente el lote de siete DICOM aportado, con
dos COR, ambos ejes de resolución y una reconstrucción 128 × 128 × 49. La prueba
en navegador cubre importación, selección COR, worker 3D, invalidación, JSON y
maquetación PDF. La verificación informática no establece una nueva referencia
clínica ni permite calcular sensibilidad sin la actividad medida.

### Tolerancias del Excel, gamma-qc-2.1

Fuente: `QC.Sala-01.2026.xlsx`, hoja `Resumen mensuales`. Solo se transcriben los
límites; el archivo, las imágenes incrustadas y sus resultados no se publican.

| Prueba | Límite | Celdas |
| --- | --- | --- |
| UDCC / UDCT | ≤ 2,5 / 2,7 % | E7:F7, I7:J7 |
| UICC / UICT | ≤ 2,9 / 3,7 % | C7:D7, G7:H7 |
| FWHM / FWTM, media X/Y | ≤ 7,5 / 13,6 mm | C27:F27 |
| Sensibilidad, ambos cabezales | ≥ 202 cpm/µCi | C47:D47 |
| δCOR,1 / δCOR,12 / δAXIAL,1 / δAXIAL,12 | ≤ 1,1988 mm | C66:F66, fórmula 2,3976 × 0,5 |
| Uniformidad tomográfica del protocolo | ≤ 10 % | C102 |

Las hojas mensuales confirman la correspondencia DU/IU; `Resumen anual` intercambia
sus rótulos y no se usa para ese mapeo. Los resúmenes conservan 1,1988 mm para COR,
mientras que las hojas mensuales contienen 1,2 mm. La web muestra cuatro decimales
y compara con el valor exacto del resumen, sin redondear resultados antes de evaluar.
No se trasladan las fórmulas de cálculo ni formatos condicionales del Excel.

La detección exige StationName SYMBIA1660 o serial 1660, sin identificadores
contradictorios, y adquisición en 2026. Modelo genérico, otro equipo o año no
seleccionan este perfil. Las herramientas planares independientes conservan su
configuración manual. Las tolerancias son editables y se exporta su procedencia
por prueba. Un resultado pendiente no borra un límite conocido ni inventa una medida.

**Tomografía:** el Excel ofrece un 10 % pero no define su fórmula. Sus notas citan
VOI de 10 cc, sin precisar normalización ni equivalencia con U3D. La ficha SEFM
GTM03 tampoco establece un límite universal para este índice esférico. Se añaden
campos para registrar la uniformidad del protocolo y su definición. La conformidad
requiere medida válida, definición, tolerancia, procedencia, protocolo y revisión
visual firmada; un resultado visual no conforme no queda oculto por un porcentaje
favorable. U3D sigue siendo complementario y no rellena esos campos automáticamente.
