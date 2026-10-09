# Uniformidad tomográfica SPECT con esferas 3D

Ruta: `/uniformidad-tomografica`. Acceso desde Medicina nuclear en el catálogo
compartido de escritorio y móvil. Es una herramienta propia para volúmenes
reconstruidos de gammacámara, independiente del análisis planar NU 1.

## Alcance

Medida complementaria experimental de uniformidad según la escala. No certifica
conformidad SEFM/NEMA y no asigna una tolerancia clínica. Debe establecerse una
referencia local con adquisiciones repetidas antes de usar niveles de actuación.
La ficha SEFM GTM03 (2020, páginas GTM03-7/8) basa la revisión en cortes
transversales y señala la dificultad de estandarizar la cuantificación por el ruido.
IAEA HHS 6 §4.3.3 describe perfiles, contraste de anillos y centro/periferia; sus
límites **no corresponden** al índice propuesto aquí. Sus recomendaciones sobre
sumar/suavizar cortes difieren: conservar siempre la revisión de cortes originales.

Referencias:
- https://sefm.es/wp-content/uploads/Protocolo-2020-final.pdf
- https://www-pub.iaea.org/MTCD/Publications/PDF/Pub1394_web.pdf
- DICOM PS3.3 C.8.4.8 y C.8.4.15: SliceVector, volúmenes reconstruidos NM y
  SpacingBetweenSlices con signo.

## Entrada y geometría

`tomoDicom.js` acepta exclusivamente NM con ImageType[2] = RECON TOMO: un
multiframe o una serie de cortes con posiciones y orientación compatibles.
No selecciona silenciosamente una serie entre varias ni descarta archivos fallidos.
Se rechazan proyecciones TOMO, CT/PET, gated, ventanas/fases mezcladas, duplicados,
cortes con desplazamiento lateral, orientaciones distintas y espaciado irregular.
El umbral geométrico de regularidad es max(0,01 mm, 0,1 % de dz), una tolerancia
numérica de la herramienta, no una tolerancia de QC.

Reutiliza `dicomPixels.js` para transferencias nativas, BitsStored/HighBit/signo y
longitud del PixelData. Aplica Rescale por frame > compartido > raíz > identidad.
LUT/RealWorldValueMapping no soportados se rechazan; no se aplica factor privado.
El resultado no presupone Bq/ml ni estadística de Poisson para intensidades reconstruidas.

El multiframe clásico usa SliceVector y SpacingBetweenSlices, incluido su signo;
ImagePositionPatient/ImageOrientationPatient se pueden leer de DetectorInformationSequence.
Si no hay SliceVector, se conserva el orden de frames con advertencia explícita.
Si faltan orientación/posición completas pero el único multiframe tiene separación
conocida, se trabaja en una rejilla local sin etiquetas anatómicas. Una serie de
archivos separados necesita posiciones físicas; nunca se ordena por nombre de archivo.
SliceThickness no sustituye a la separación entre centros. Límite: 32 millones de vóxeles.

Los tres visores son planos XY/XZ/YZ nativos, no necesariamente planos anatómicos.
El cilindro tiene eje paralelo a Z. Centro, radio, primer/último corte y márgenes
se revisan antes de habilitar el cálculo. La detección inicial solo propone una
geometría a partir de un umbral; **el umbral no enmascara vóxeles del análisis**.
Los defectos interiores fríos, ceros y negativos se conservan.

## Definición del método

Para cada diámetro d y centro de vóxel c, se promedian los centros de vóxel v que
cumplen la distancia física `|v-c| <= d/2`, utilizando dx, dy y dz independientes.
Es un núcleo esférico de valor uniforme (top-hat), sin interpolación ni ponderación
de volumen parcial. Se publican el número de vóxeles y el volumen efectivo. Los
diámetros pequeños pueden tener el mismo núcleo discretizado.

La **esfera completa**, no solo su centro, debe permanecer a los márgenes radial y
axial seleccionados de la pared y bases. Las bases geométricas se colocan media
separación antes/después de los centros del primer/último corte seleccionados. No
se recortan esferas ni se rellena el exterior con ceros.

Para cada d:
- `minimum`, `maximum`: las menores/mayores medias esféricas y sus coordenadas.
- `minimumPercent`, `maximumPercent`: 100 × media esférica / media de referencia.
- `U3D = 100*(maximum-minimum)/(maximum+minimum)`. Nulo si el mínimo es negativo
  o el máximo no es positivo; se siguen mostrando las medias originales.
- P5/P95: cuantiles descriptivos de todas las medias, con interpolación lineal.
  Las esferas se solapan y estos cuantiles **no son intervalos de confianza**.

La referencia es la media de todos los centros de vóxel del cilindro tras aplicar
solo los márgenes, independiente del diámetro. Debe ser positiva. El barrido
ordinario examina todos los centros válidos para cada tamaño. El modo de centros
comunes restringe todas las esferas a donde cabe la mayor. Se informa cuántos
centros se han explorado: cambiar el dominio afecta a la selección de extremos.
La rejilla está anclada en (0,0,0), con paso entero configurable; paso 1 recorre
todos los centros de vóxel, no posiciones subvoxel continuas. Un paso mayor puede
omitir extremos. Las curvas no se fuerzan a ser monótonas.

## Interfaz y trazabilidad

Permite añadir hasta 20 esferas manuales, consultar sus medias, revisar las
intersecciones en los tres planos y girar una vista geométrica del cilindro.
Las esferas manuales son exploratorias: los extremos de la curva proceden del
barrido automático. Botones «Ver mínimo/máximo» localizan las esferas extremas.
La ventana solo modifica la visualización. Los datos no se suavizan antes de medir.

La UI muestra índices desde 1. JSON y CSV exportan centros `[columna,fila,corte]`
desde 0; las distancias son mm. El JSON conserva la versión de método,
parámetros de la ejecución, geometría, calibración, referencia, avisos y esferas
manuales; el CSV contiene la tabla numérica. Para reproducir una ejecución,
guardar ambos archivos y la reconstrucción original. No se exportan identificadores
de paciente, UIDs ni nombres de archivo. Las notas introducidas son responsabilidad
del usuario. Los resultados y volúmenes viven solo en memoria de la pestaña.

Los cambios de parámetros invalidan los resultados antes de exportar. Cambiar la
geometría elimina las esferas manuales y exige revisarla de nuevo. El cálculo usa
un Web Worker cancelable: sumas prefijas por fila y secciones del núcleo reducen
el coste de integrar cada esfera manteniendo la definición discreta exacta.

Para comparar estudios deben fijarse adquisición, cuentas, correcciones,
reconstrucción, rejilla, cilindro, márgenes, diámetros y dominio. Una esfera grande
atenúa tanto ruido como defectos pequeños. La curva aislada no los distingue.
La misma aplicación puede abrirse integrada en el informe mensual privado con
el volumen ya validado. El worker transmite la instantánea del cálculo al informe;
cambiar geometría o parámetros la invalida. Los tres planos seleccionados pueden
capturarse para el resumen y la curva se imprime en un anexo. El resultado
cuantitativo no modifica la valoración tomográfica visual.

El informe mensual admite además la tolerancia local del Excel de Sala 1 (10 %),
con una medida y definición registradas por el usuario. El Excel no especifica la
normalización del porcentaje; ese límite no se asigna automáticamente a U3D ni a
cada diámetro del barrido. La evaluación mensual combina dicha comparación local
con la revisión visual, conservando ambas y sin presentar una conformidad normativa
de la curva experimental.

## Verificación

`npm run test:tomo` construye volúmenes y DICOM sintéticos. Incluye un oráculo
independiente de integración exhaustiva con vóxeles 2×3×4 mm, defectos en Z,
ceros/negativos interiores, límites radiales y en las bases, dominios de centros y
geometrías/calibraciones DICOM. `npm run build:web` comprueba la integración y
audita el artefacto público. La suite se incluye en el workflow de GitHub.

Comprobada la importación de la exportación Siemens aportada (NM multiframe,
128 × 128 × 49), incluyendo geometría, planos y ejecución del barrido. Pendiente:
validación de exportaciones GE, comparación con otra herramienta y repetibilidad
de adquisiciones de referencia.
