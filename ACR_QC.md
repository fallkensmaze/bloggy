# ACR Medium: alcance y método

Versión del método: `medium-2026.09.25`. Este módulo evalúa las series ACR T1 y T2
y la longitud del localizador sagital del maniquí Medium. No representa el proceso
completo de acreditación: faltan las series clínicas del centro y la evaluación
de imágenes clínicas. Tampoco implementa las vías de evaluación alternativa con
series clínicas cuando falla una serie ACR.

Referencias para revisar los criterios:

- [ACR Large/Medium Phantom Testing, revisión 6-2-2026](https://accreditationsupport.acr.org/support/solutions/articles/11000061035-large-phantom-testing-mri-revised-12-12-19-).
- ACR Large and Medium Phantom Test Guidance, octubre de 2022, secciones de
  geometría, resolución, espesor, posición, uniformidad, ghosting y bajo contraste.

## Datos y adquisición

Se admiten MR MONOCHROME2, un archivo por corte, con píxeles nativos de 8, 16 o
32 bits, signo, BitsStored/HighBit, orden de bytes y RescaleSlope/Intercept.
Se rechazan compresión, Enhanced MR, multiframe, datos truncados, geometría
oblicua y calibración espacial ausente. Los planos ortogonales se reindexan sin
interpolar; la máscara de padding sigue la misma transformación.

El lote debe pertenecer al mismo estudio y equipo. Cada grupo axial requiere
11 SOP distintos, posiciones distintas, origen en el plano y orientación
consistentes y separación física de 10 mm. Las tolerancias de redondeo son
0,1 mm para origen/duplicados y 0,2 mm para separación; son tolerancias del
programa, no límites de aceptación publicados por ACR.

El protocolo se verifica mediante ambas dimensiones de la matriz reconstruida
y de adquisición (256), FOV derivado de PixelSpacing en ambos ejes (250 mm),
espesor prescrito (5 mm), NEX (1), ETL (1), secuencia SE y TR/TE (500/20 o
2000/80 ms). Los campos ausentes quedan sin verificar. La tolerancia de
metadatos es 1 mm para FOV, 0,1 mm para espesor, 1 % para TR/NEX y 1 ms para TE.
No se supone que una descripción que contiene «T1» o «T2» acredita el protocolo.
Los ecos se agrupan por separado; un doble eco con ETL distinto de 1 puede
requerir comprobación externa aunque ACR permita esa adquisición.

La categoría de campo se propone desde MagneticFieldStrength y se contrasta
con la elegida. La ausencia de ese dato impide una conclusión conforme. La
ausencia de reconstrucción IA y la corrección de intensidad apropiada a la
bobina se confirman manualmente.

## Medidas y límites

| Prueba | Aplicación y criterio |
| --- | --- |
| Geometría | Sagital: 134 ± 2 mm; axial T1: 165 ± 2 mm |
| Resolución | Lectura horizontal y vertical ≤ 1,0 mm en T1 y T2 |
| Espesor | Objetivo 5 ± 0,7 mm; aviso hasta ± 1,0 mm; fuera de ese intervalo falla |
| Posición | Diferencia entre barras ≤ 5 mm como objetivo y ≤ 7 mm aceptable; corte 11 avisa también si supera 4 mm por su efecto en bajo contraste |
| PIU | ≥ 90 % por debajo de 3 T; ≥ 85 % a 3 T, en T1 y T2 |
| Ghosting | PSG ≤ 3 % en T1 |
| Bajo contraste Medium | Suma de radios completos de cortes 8–11: ≥ 7 en ambas series por debajo de 1,5 T; ≥ 30 T1 y ≥ 25 T2 entre 1,5 y < 3 T; ≥ 37 en ambas a 3 T |

La diferencia de longitud de barras se exporta como `pos_s1_mm` y
`pos_s11_mm`; no es el desplazamiento físico del corte, que es su mitad.

PIU usa una ROI circular nominal de 160 cm² y busca medias extremas con
ROIs de 1 cm² enteramente contenidas en ella, en pasos de un píxel. Las áreas
efectivas discretizadas se muestran. No se filtran los píxeles interiores
oscuros según su intensidad. La única exclusión propuesta es la muesca
anterior conectada al exterior, dentro de una guarda de ±20 mm lateral y
a más de 40 mm anterior al centro. Esta guarda es una heurística del programa:
la superposición naranja debe comprobarse visualmente. Una pérdida de señal
anterior conectada al exterior puede confundirse con la muesca; si ocurre, la
medida automática no es válida.

PSG utiliza la media de toda la ROI de 160 cm², incluida la muesca. Sus cuatro
ROIs de fondo conservan 10 cm² cada una mediante pesos de área de píxel. Parten
de una relación 4:1 y se alargan si el espacio disponible lo exige. La separación
de 3 mm es una elección del programa. Si no caben o contienen padding, la
prueba no es evaluable. No se reduce silenciosamente su área.

El ajuste elíptico, la rejilla de perdigones con paso supuesto de 40 mm y límite
local < 1 mm, y geometría/PSG de T2 son medidas complementarias. Se muestran
y exportan, pero no determinan la conclusión de las pruebas ACR.

## Revisión, estados e informes

Ejecutar una primera vez, revisar las imágenes y perfiles en el informe y
contrastar las lecturas con el visor/consola. Registrar resolución, los cuatro
recuentos de bajo contraste, artefactos, adquisición y validez de las medidas.
Volver a ejecutar para incorporar las confirmaciones al informe.

El orden CHIN→HEAD y la elección del sagital central son propuestas automáticas;
deben comprobarse, al igual que bordes, rampas, barras y muesca. El sagital se
elige por proximidad al centro del maniquí axial, no a la coordenada X=0.
Los algoritmos de bordes y perfiles de geometría, espesor y posición mantienen
heurísticas del módulo original. En espesor se emplea FWHM sobre perfiles
suavizados con umbral por rampa: necesita contraste con la lectura ACR manual
y no está validado con una colección de imágenes reales de referencia.
Una confirmación visual no sustituye esa validación independiente del algoritmo.

«Conforme» exige todas las pruebas requeridas, ambas series, sagital,
adquisición verificada y lecturas/revisión visual registradas. Un fallo conocido
produce «No conforme»; datos ausentes o errores sin fallo conocido producen
«No evaluable / incompleto». Las medidas complementarias no se cuentan en ese
estado. La conclusión se limita a las pruebas de este módulo.

Cambiar serie, campo, lectura visual o archivos invalida resultados y desactiva
exportación. Excel y PDF utilizan la selección de la última ejecución, su fecha,
versión de método y estado; no mezclan resultados antiguos con nuevas series.
No se persisten imágenes ni declaraciones entre cargas.

## Verificación

`npm run test:acr` cubre defectos oscuros interiores/periféricos, PIU física con
píxeles anisótropos, muesca, denominador y áreas de PSG, umbrales, duplicados,
mezcla de estudios, protocolos incompletos, lectura DICOM nativa, signo/endianness,
orientación, pruebas pendientes y exportación. Son regresiones con datos
sintéticos: antes de confiar en medidas automáticas se necesita validación
independiente con adquisiciones reales y medidas de referencia.
