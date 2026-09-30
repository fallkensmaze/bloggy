# Centro de rotación SPECT

La ruta `/centro-rotacion-spect` analiza en el navegador un objeto DICOM NM
multiframe con la adquisición de tres fuentes puntuales descrita por NEMA NU
1-2007 §4.1. Los píxeles y los metadatos no salen del equipo del usuario.

## Rama NEMA NU 1-2007

Condiciones que comprueba la interfaz:

- tres fuentes puntuales coplanares;
- píxel menor de 5 mm;
- número par de vistas, al menos ocho, uniformemente distribuidas en 360°;
- vistas de 0° y 180° para cada detector;
- menos de 20 000 cps;
- al menos 5000 cuentas en el píxel máximo de cada fuente en la vista de 0°.

Las tres fuentes se identifican por separado en la vista más próxima a 0° de cada
cabezal. Su orden axial define regiones de búsqueda separadas por los puntos medios
entre fuentes. Cada proyección vuelve a localizar cada fuente dentro de su región;
no utiliza como posición de respaldo el centroide de la vista anterior. Después
recentra una ROI física de 45 mm (número impar de píxeles más cercano), con hasta
seis iteraciones y convergencia al mismo centro de píxel. El tamaño efectivo por
eje se informa explícitamente y debe permanecer entre 40 y 50 mm.

El perfil X integra una banda axial centrada en la fuente, en todo el ancho de la
matriz. El perfil Y integra una ventana transversal centrada en el pico, dentro de
esa banda. El centroide usa una ventana simétrica impar alrededor del máximo que
incluye ambos cruces de semialtura (ecuación 2-3). No se suaviza el perfil medido ni
se resta el movimiento axial al resultado. La localización inicial sí usa suavizado.

La identidad se conserva por orden axial: fuentes que cruzan regiones, ejes invertidos
y configuraciones distintas requieren revisión y pueden no ser analizables. La
comprobación de picos no distingue de forma infalible una fuente de contaminación;
por eso se requiere revisar todas las proyecciones con las superposiciones.

La aplicación informa los cuatro límites superiores de §4.1.5:

- `δCOR,1`: máximo error COR de cualquier fuente y detector;
- `δCOR,12`: máxima diferencia COR entre una pareja de detectores;
- `δAXIAL,1`: máxima excursión axial de una fuente en un detector;
- `δAXIAL,12`: máximo desalineamiento axial medio entre detectores.

NEMA especifica el método de medida, pero no un límite de aceptación universal:
los valores deben compararse con la especificación del sistema. Las tolerancias
empiezan vacías y necesitan una procedencia documentada; vacío nunca significa cero.

## Rama geométrica 3D

La fuente con menor excursión transversal se identifica como la fuente central.
Para cada vista, su centroide transversal y axial define una línea 3D paralela
al eje del colimador. El punto `p` se obtiene minimizando la suma de las
distancias cuadráticas a todas las líneas:

`[Σ(I - n nᵀ)] p = Σ(I - n nᵀ) q`

donde `n` es la dirección de retroproyección y `q` un punto de la línea. Esta
construcción separa el desplazamiento físico de la fuente respecto al centro de
la matriz de la falta de intersección de las líneas.

Se informan dos envolventes:

- una esfera cuyo radio es la mayor distancia del punto ajustado a una línea,
  comparable conceptualmente al tamaño de isocentro por retroproyección de
  Winston-Lutz;
- un elipsoide orientado según los autovectores de la covarianza de los puntos
  más próximos. Se escala hasta contener todos los puntos observados.

El elipsoide es una métrica experimental del proyecto; no forma parte de NEMA
NU 1-2007 ni de pylinac.

## Validación de la tolerancia

Una sola adquisición permite clasificar un resultado respecto a un límite,
pero no estimar sensibilidad ni especificidad. La sección de validación acepta
un CSV con:

```csv
score_mm,label
0.82,0
2.31,1
```

`score_mm` es el diámetro mayor del elipsoide y `label` es la referencia
independiente (`0` apto, `1` defecto). Con ambos grupos presentes se calculan
sensibilidad, especificidad, VPP, VPN, ROC, AUC y el corte que maximiza el índice
de Youden. El rendimiento calculado en la cohorte de desarrollo es optimista;
el corte debe confirmarse en una cohorte independiente y con intervalos de
confianza antes de utilizarse como tolerancia clínica.


## Validación de entrada (cor-qc-1.1)

El COR individual y el informe mensual comparten `corGeometry.js`: exigen vectores
válidos de detector y vista, un paso, sentido y ángulo inicial explícitos, y una
única ventana de energía identificada. Solo se omite el vector de rotación/energía
si su secuencia tiene un único elemento. No se inventan ángulos ni cabezales.

Cada fuente de cada frame debe tener señal positiva, ambos cruces al 50 % y una
ventana simétrica completa. Los perfiles planos, truncados o con otro pico separado
que alcance el 50 % bloquean el cálculo e identifican cabezal, frame y fuente.
No se descartan medidas para obtener una media. Estas comprobaciones no sustituyen
la revisión visual ni garantizan la identidad de una fuente confundida con ruido.

La coincidencia con 0° y 180° admite 0,1° de redondeo, un criterio de la herramienta,
no una tolerancia NEMA. No depende del intervalo entre vistas. La tasa de cuentas
usa la duración de cada frame. Los límites individuales quedan sin veredicto si
alguna comprobación de adquisición falla o es desconocida; el informe mensual usa
la misma condición. El método 3D sigue siendo experimental.

## Revisión cor-qc-1.2

- `corGeometry.js` rechaza combinaciones de RotationVector y conserva un radio escalar
  de RadialPosition en todas las vistas. El motor también rechaza vistas repetidas y
  mezclas de rotación si recibe datos directamente.
- El radio debe ser 200 mm. El margen de 0,5 mm es una decisión explícita de la herramienta
  para redondeo, **no una tolerancia publicada por NEMA**. Un valor manual solo completa
  radios DICOM ausentes; jamás sobreescribe un valor conocido incompatible.
- `corValidation.js` comparte el mismo veredicto en la página individual y el informe
  mensual. Exige tamaño de ROI, cuentas sin reescalado, muestreo, cuentas/tasa, radio y
  declaraciones de fuentes/montaje, colimador/ventana, mesa, calibración, orientación
  y revisión visual. Estas declaraciones documentan comprobaciones humanas, no una
  verificación automática del montaje. Los datos reescalados no permiten conformidad.
- La interfaz no hereda declaraciones, límites ni cohorte al cargar otro DICOM. Un
  fallo de medición conserva la imagen legible para inspeccionarla, sin centroides.
- El visor recorre todas las vistas y superpone bandas, ROI y centroides, con perfiles
  X/Y y ventanas de semialtura. Las curvas permiten elegir cualquiera de las tres
  fuentes; el origen axial común conserva el desfase entre cabezales.
- El CSV contiene las 72 medidas de una serie 2×3×12, coordenadas de píxel en base cero
  y límites de ROI inclusivos. El JSON incluye resultados por fuente/vista/cabezal,
  condiciones, declaraciones, parejas, geometría experimental y versión del método.
- La diferencia axial entre cabezales usa la diferencia de las medias: cada vista se
  utiliza una sola vez; no se reutilizan vecinos angulares para rellenar vistas.
- Las pruebas incluyen excursión axial analítica de 32 mm, desfase entre cabezales de
  50 mm, radio conocido erróneo/desconocido, rotaciones mezcladas, fuentes perdidas,
  ROI inválida, límites vacíos y declaraciones independientes. Son datos sintéticos;
  queda pendiente la comparación con una adquisición real y su referencia independiente.
