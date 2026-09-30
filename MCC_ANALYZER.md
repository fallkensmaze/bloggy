# Analizador MCC

Ruta `/analizador-mcc`, catálogo compartido **Radioterapia → Analizador MCC**.
Los datos se procesan en memoria en el navegador. No se suben a Firebase ni se
persisten. JSON exporta datos, metadatos, opciones, resultados y versión del método;
CSV exporta las curvas y el factor s(w,air) aplicado a cada punto.

## Formato

Lector JavaScript independiente, informado por el formato documentado y los ejemplos
de [tbezo/pymcc](https://github.com/tbezo/pymcc), MIT, Thomas Bezold.
Los cuatro archivos de prueba proceden de ese proyecto; la licencia se conserva en
`scripts/fixtures/mcc/LICENSE-pymcc.txt`. No se ejecuta Python en el navegador.
No se copian la conversión DIN de electrones ni la renormalización específica de
TrueBeam de pymcc como métodos universales.

Admite `PDD`, `INPLANE_PROFILE`, `CROSSPLANE_PROFILE`, bloques múltiples, lectura
ascendente/descendente, notación científica, coma decimal, datos con/sin referencia,
UTF-8 y UTF-16 con BOM. Las coordenadas PTW se interpretan en mm. Cada barrido tiene
metadatos propios; faltantes nunca heredan energía, filtro o geometría del anterior.
Rechaza datos truncados, columnas mal formadas y posiciones duplicadas. Límites:
20 MB por fichero, 30 archivos/40 MB y 250000 puntos/1000 barridos por lote.

La tercera columna **no** se divide automáticamente: algunas exportaciones ya están
normalizadas al monitor. La opción explícita exige referencia positiva en cada punto.
La magnitud (ionización/dosis) siempre requiere declaración; el tipo de detector no
garantiza que una exportación no haya sido corregida. Perfiles diagonales no se
analizan como ortogonales. No se implementa una reconstrucción 2D de arrays.

## Electrones: dos pasos distintos

Fuente: [TRS-398 Rev.1 (2024)](https://www-pub.iaea.org/MTCD/Publications/PDF/p15048-DOC-010-398-Rev1_web.pdf),
§7.3.2, ec.37, §7.7.1 y tabla 22, pp.118–119.

1. Normalizar I(z), interpolar el primer cruce distal al 50% y convertir las unidades:
   R50,ion en g/cm² = profundidad en mm / 10 para agua con rho=1 g/cm³.
2. R50 = 1.029 R50,ion − 0.06 para R50,ion ≤ 10; 1.059 R50,ion − 0.37 para >10.
3. Para cada punto, interpolar **bilinealmente** s(w,air) en R50 y z/R50 de tabla 22.
4. Calcular D(z) proporcional a I(z)·s(w,air) y normalizar al máximo de la dosis
   corregida, que puede cambiar de profundidad. Nunca aplicar esta corrección a
   datos declarados como dosis.

Tabla: R50 entre 1 y 10 g/cm², z/R50 entre 0.02 y 1.20. Sin extrapolación ni
relleno constante. Puntos fuera de tabla se excluyen de la curva de dosis, se
mantienen en la curva de ionización y se cuentan en una advertencia. Si el máximo
corregido queda en un extremo del segmento disponible, no se normaliza ese segmento.
El R50 de ec.37 (selector de tabla) y el medido en la curva corregida se presentan
por separado. zref = 0.6 R50 − 0.1 g/cm² usa el índice de ec.37.

El desplazamiento de profundidad es explícito y aditivo en mm. No se aplica
automáticamente −0.5 r_cyl, porque puede estar ya aplicado por el software de tanque.
La corrección de ventana, recombinación y polaridad debe estar resuelta en origen.
Se asume perturbación relativa constante, como aproximación de §7.7.1; no se inventan
factores del detector. Los índices en g/cm² requieren confirmar agua.

dmax es el máximo muestreado. R90/R80/R50/R20 se obtienen por interpolación lineal
en la rama distal. Rp aproximado requiere una cola de dosis disponible: intersección
de secante 60–40% con regresión de ≥5 puntos ≤10%, más allá de 1.3 R50, cubriendo
≥5 mm. No es una tangente exacta y no se extrapolan s(w,air) para fabricarlo. En una
conversión tabulada de ionización puede quedar sin evaluar por falta de cola.

## Perfiles

FWHM y penumbras 80–20% referidas al máximo global; interpolación de las muestras
originales, sin suavizado ni remuestreo previo. Simetría = máximo |D(x)−D(−x)|/D(CAX)
en el 80% central disponible simétricamente respecto al CAX declarado. No se recentra
para ocultar una desviación. Planitud WFF = 100(Dmax−Dmin)/(Dmax+Dmin) en esa región;
no se aplica a FFF ni a campos declarados pequeños.

FFF: cociente descriptivo CAX/media en los límites del 80% central y distancia entre
inflexiones aproximadas por gradiente local de cinco muestras. En campos amplios,
FWHM y penumbra respecto al máximo global no equivalen al borde renormalizado. No
se les asignan límites universales de aceptación.

El umbral de 40 mm es solo una orientación de interfaz para posible campo pequeño,
con modificación manual. **No es la definición física de TRS-483.** Se ofrece el
margen LCPE con rLCPE=8.369 TPR20,10(10)−4.382 cm y la dimensión externa del detector.
No certifica ausencia de oclusión de fuente ni de perturbación/volumen promediado.

## TRS-483: dos equivalencias

Fuente: [TRS-483 (2017)](https://www-pub.iaea.org/MTCD/Publications/PDF/D483_web.pdf),
§5.3.3, tablas 15–17, ec.28, y §6.5.2, ec.45.

- Sclin = sqrt(FWHM_inplane·FWHM_crossplane) en el plano de medida. Se seleccionan
  explícitamente dos perfiles; se verifican modalidad, filtro, energía, máquina,
  campo, profundidad, SSD, ángulos y ausencia de offsets/cuñas. El usuario confirma
  que corresponden a la misma sesión y campo pequeño. Fuera de 0.7 < A/B < 1.4,
  no se debe usar la incertidumbre habitual de los factores tabulados sin revisión.
- S uniforme del campo msr: tablas 15 (WFF), 16 (6–7 MV FFF), 17 (10 MV FFF).
  Interpolación bilineal de la tabla simétrica completa, lados 3–12 cm. Calculadora
  independiente con dimensiones introducidas en el plano del detector; no sustituir
  por FWHM de un campo FFF amplio. 10×10 cm da 9.5 cm a 6–7 MV y 9.1 cm a 10 MV.
  Valores genéricos publicados, no integración de los perfiles propios. No CyberKnife.
- TPR20,10(10) = [TPR20,10(S)+0.01615(10−S)]/[1+0.01615(10−S)], solo para 4≤S≤12,
  con confirmación de TPR **medido a distancia fuente–detector constante** y condiciones
  msr. Este paso no convierte un PDD en TPR.

## PDD → TPR

TRS-398 Rev.1, §6.3.1, nota 36 (p.84):
TPR20,10 = 1.2661·PDD(20)/PDD(10)−0.0595. Se habilita para WFF, agua, SSD 100 cm,
10×10 cm **en superficie**, curva declarada como dosis y datos que abarquen 10 y 20 cm.
Geometría y medida central sin cuña se confirman explícitamente por barrido.
La publicación menciona evidencia de aplicación aproximada a FFF; esta versión
no la generaliza automáticamente ni la encadena a una corrección msr.
No se presenta una corrección de inverso del cuadrado como conversión general de
PDD a TPR: faltarían la geometría de campo y la contribución de dispersión.

No se calculan kQ, dosis absoluta ni output factors de perfiles. Antes de usar en
clínica se necesita validación con archivos y resultados de referencia del servicio.

## Verificación

`npm run test:mcc` cubre formato real y sintético, no herencia entre barridos,
valores de tabla, interpolación bilineal, ambas ramas R50, unidades mm/cm,
corrección punto a punto y ausencia de doble corrección, límites de tabla,
perfil trapezoidal analítico, tablas FFF, Sclin y restricciones TPR. CI ejecuta esta
suite además de los controles existentes. `npm run build:web` verifica la integración
React/Vite y la auditoría de artefactos públicos. La compilación Rust/WASM existente
se mantiene en el workflow de CI.
