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
TPR20,10 = 1.2661·PDD(20)/PDD(10)−0.0595. Se habilita para WFF o, como estimación aproximada, FFF hasta 10 MV, agua, SSD 100 cm,
10×10 cm **en superficie**, curva declarada como dosis y datos que abarquen 10 y 20 cm.
Geometría y medida central sin cuña se confirman explícitamente por barrido.
La confirmación declara también que se acepta la curva exportada de fotones como
dosis relativa; se actualiza la magnitud en esa misma acción. La unidad Gy/min
se muestra como información y nunca basta para inferir dosis corregida, especialmente
en electrones. Para SSD igual a la distancia al isocentro se proponen las dimensiones
FIELD_INPLANE/CROSSPLANE (mm → cm) en superficie, sujetas a revisión y confirmación.
No se usan REF_FIELD_*: pueden describir un campo de referencia diferente. Sin un
plano común conocido se mantienen las dimensiones vacías para entrada manual.
Para FFF se exige energía nominal conocida y confirmación explícita del uso aproximado.
Se informa el alcance de la nota 36, se recomienda contraste con TPR medido antes
de calibración y se conserva esa advertencia en el vínculo a kQ y en el JSON.
No se encadena la estimación a una corrección msr.
No se presenta una corrección de inverso del cuadrado como conversión general de
PDD a TPR: faltarían la geometría de campo y la contribución de dispersión.

El botón **Vincular este TPR al cálculo de kQ** fija el barrido de origen y mantiene
el vínculo con su resultado calculado, no con una copia redondeada del número.
Ese resultado ya es una estimación del TPR de referencia WFF/FFF: no vuelve a pasar por ec.28. Cambiar de barrido
activo no cambia el vínculo; editar el PDD lo recalcula, e invalidar sus condiciones,
vaciar o cargar otro lote invalida el resultado. Se informa archivo y número de scan.
Para trabajar directamente con un TPR de referencia medido hay un tercer origen,
**TPR medido · referencia 10×10 (TRS-398)**, sin corrección msr.

## kQ,Q0 por cámara

`mccKqData.js` contiene las entradas numéricas publicadas y celdas vacías explícitas.
`mccKq.js` calcula por interpolación lineal sin extrapolación y devuelve la procedencia,
la tabla y los extremos de cada interpolación. Selección explícita del modelo exacto:
no se infiere por semejanza ni del detector que midió el MCC, que puede ser distinto
de la cámara de referencia.

| Índice/origen | Tabla | Q0 admitida |
|---|---|---|
| TPR vinculado a PDD WFF/FFF (estimado) o medido directamente | TRS-398 Rev.1, 16, pp.90–93; 26 modelos | Co-60 |
| TPR(10) obtenido desde TPR(S) msr WFF | TRS-483, 12, pp.83–85; 28 entradas | Co-60 |
| TPR(10) obtenido desde TPR(S) msr FFF | TRS-483, 13, pp.88–90; 28 entradas | Co-60 |
| R50 activo de electrones | TRS-398 Rev.1, 20, pp.110–111; 8 modelos | Co-60 |
| R50 activo de electrones | TRS-398 Rev.1, 21, pp.115–116; 16 modelos | Haz de electrones con R50,Q0 explícito |

En fotones de referencia, TRS-398 Rev.1 usa TPR para WFF y FFF convencional hasta
10 MV (§6.3.1). En ese caso kvol se trata separadamente. La tabla 13 de TRS-483 ya
incluye un promediado de volumen genérico: el programa lo advierte para evitar una
doble corrección. No se mezclan esas tablas con el índice de otro formalismo ni se
implementan las columnas CyberKnife/TomoTherapy en este módulo.

En calibración cruzada de electrones se usa
k(Q,Q0)=k(Q,Qint)/k(Q0,Qint) de tabla 21 (§7.6), con Qint definido como R50=7.5 g/cm².
Se inserta el punto de normalización exacto (7.5,1) entre los nodos 7 y 8; los demás
valores se interpolan. Las cámaras cilíndricas sin valores por debajo de R50=3 se
mantienen sin resultado en ese intervalo. Advanced Markus no aparece en tabla 20;
no se reutiliza su fila de calibración cruzada como si correspondiera a Co-60.
Para R50<1.4 se muestra la nota de mayor incertidumbre y recomendación de factores
experimentales del protocolo. Se muestran cuatro decimales para cálculo, no como
declaración de incertidumbre.

El JSON incluye el estado de origen, el barrido vinculado, el índice final, el
formalismo, Q0, cámara y los valores usados para interpolar numerador/denominador.
La opción **R50,ion / R50 manual** funciona sin cargar un MCC. Acepta el índice de
ionización o dosis de Q, y la misma elección para Q0; todos en g/cm². Convierte
solo los índices declarados como ionización mediante ec.37. Un R50 ya de dosis
permanece intacto. Esta conversión de índice no reemplaza la corrección por
stopping powers punto a punto de una curva completa.
Se presentan separadamente k(Q,Qint), k(Q0,Qint) y su cociente. El primero puede
consultarse aun sin introducir Q0; el cociente requiere ambos índices válidos.
Un botón permite declarar explícitamente Q0=Qint. Los 7.5 son g/cm² de R50,
no MeV; Qint es una referencia matemática y no requiere una medida en ese haz
(TRS-398 Rev.1 §3.2.2). Se conservan ambos valores originales y sus conversiones
en la exportación JSON. No se infiere R50 a partir de energía nominal en MeV.
El certificado individual tiene prioridad sobre factores genéricos. Este módulo
no importa certificados ni calcula dosis absoluta u output factors de perfiles.
Antes de usar en clínica se necesita validación con resultados de referencia del servicio.

## Verificación

`npm run test:mcc` cubre formato real y sintético, no herencia entre barridos,
valores de tabla, interpolación bilineal, ambas ramas R50, unidades mm/cm,
corrección punto a punto y ausencia de doble corrección, límites de tabla,
perfil trapezoidal analítico, tablas FFF, Sclin y restricciones TPR. CI ejecuta esta
suite además de los controles existentes. La suite adicional `test-mcc-kq.mjs`
verifica valores de las cinco tablas, interpolación, celdas nulas, normalización Qint,
cociente de calibración cruzada, incompatibilidad de Q0, trazabilidad y ausencia de
doble corrección del TPR. `npm run build:web` verifica la integración
React/Vite y la auditoría de artefactos públicos. La compilación Rust/WASM existente
se mantiene en el workflow de CI.

## Resumen de todos los barridos

La tabla de PDD y perfiles muestra una fila por scan con archivo, identificador,
metadatos geométricos, métricas y avisos propios. Los PDD permiten declarar la
magnitud en su fila; «Ver / ajustar» abre la curva y condiciones del scan seleccionado.
No se copian confirmaciones ni ajustes entre barridos. El cálculo por lote aísla
los errores de análisis: un perfil no evaluable no elimina los resultados de los demás.
La exportación JSON conserva todos los resultados, incluidas las condiciones y
la procedencia del TPR estimado de cada PDD.
