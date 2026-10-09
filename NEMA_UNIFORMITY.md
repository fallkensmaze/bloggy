# Uniformidad intrínseca: alcance y comprobaciones

Versión del método: `nema-nu1-2007/2026.09`.

La herramienta analiza floods planares con FOV rectangular. La referencia histórica es
NEMA NU 1-2007; el procedimiento público de contraste es OIEA, *Quality Assurance for SPECT
Systems*, HHS 6, apartado 2.3.3, páginas impresas 58–61:
[publicación del OIEA](https://www-pub.iaea.org/MTCD/Publications/PDF/Pub1394_web.pdf#page=70).
No se ha contrastado el texto completo de NU 1-2023 y no se declara conformidad con esa edición.
Los límites Siemens del perfil son especificaciones internas del servicio, no límites universales
de NEMA. La edición, el equipo y las condiciones del ensayo deben constar al comparar resultados.

## Geometría y medida

- Suma de bloques enteros, sin interpolación de cuentas. Se comprueba el píxel efectivo
  de 6,4 mm ±30 % (4,48–8,32 mm) y su forma cuadrada.
- El UFOV conserva sus límites físicos continuos, incluido el centro original tras recortes
  impares de la matriz. El CFOV se obtiene escalando al 75 % cada dimensión física del UFOV.
- Un píxel entra si al menos el 50 % de su área está dentro del campo. Se multiplica el
  solapamiento de las dos dimensiones; no basta con redondear filas y columnas por separado.
- La regla de borde se aplica una sola vez sobre cuentas sin suavizar. Después se suaviza una
  vez con pesos `1 2 1 / 2 4 2 / 1 2 1`, normalizando por los pesos válidos.
- IU = `100*(max-min)/(max+min)`. DU usa todos los segmentos válidos de cinco píxeles
  contiguos, por separado en filas y columnas. Se informa también cuántos segmentos existen.

## Ceros y exclusiones

Propagar el fondo exterior durante la suma es una extensión explícita de esta implementación;
no es una cita literal de la norma. Se utiliza conectividad de cuatro vecinos a los bordes de
la matriz para identificar el fondo a cero. Un bloque que lo toca se excluye junto con sus
vecinos directos, conservando la protección frente a bloques de borde parcialmente llenos.

Un cero original aislado dentro del flood **no elimina un bloque cuya suma sea positiva**.
Sus cuentas se conservan: puede tratarse de estadística o de un defecto frío. Si un píxel de
análisis interior entero está a cero, se documenta aunque la regla de ceros lo excluya; no se
permite declarar conforme el campo restante. Tampoco se permite si un bloque excluido por
fondo exterior tiene sus cuatro vecinos dentro del UFOV geométrico: puede ser un defecto que
se comunica con el exterior o una geometría incorrecta. Estos bloqueos son controles de
integridad de la herramienta, no nuevos límites porcentuales de NEMA.

El algoritmo no sustituye la inspección visual del flood ni la comparación con una adquisición
de referencia del equipo. La vía de contraste es una aproximación a Pylinac, no una ejecución
de esa biblioteca ni un segundo método oficial del OIEA.

## Validez y adquisición

Para declarar «Conforme» se requieren todas las medidas IU/DU finitas, segmentos válidos en
ambas direcciones y regiones, geometría completa declarada, datos de adquisición verificados
y un perfil completo de límites aplicable. Una máscara insuficiente, geometría truncada o
medidas `NaN` producen «No evaluable». Un UFOV estimado no obtiene conformidad automáticamente.

Los valores vacíos o con espacios son desconocidos. La tasa debe ser positiva; cero y valores
negativos no son una tasa válida. La casilla de distancia permite confirmarla sin anotar una
cifra si se conoce el UFOV, pero no sustituye un valor numérico que incumple el mínimo.

La ventana se comprueba independientemente del detector. Se requieren límites positivos
ordenados y la confirmación de que corresponden al fotopeak y al protocolo del radionucleido
en todos los frames. Los límites DICOM tienen prioridad. Los manuales solo se usan cuando no
hay ninguno de los dos en el DICOM; no completan ni reemplazan un rango DICOM inválido.
La declaración se limpia al cargar otro archivo para evitar heredar una verificación anterior.

## Regresiones reproducibles

Ejecutar `npm run test:nema`. La suite genera datos sintéticos, incluidos DICOM, sin archivos
clínicos. Entre los casos con resultado independiente conocido:

| Caso | Resultado requerido |
| --- | --- |
| UFOV 100×100, CFOV físico [12,87] | 76×76 menos cuatro esquinas: 5772 píxeles |
| Defecto de 5000 sobre fondo 10000 en fila 12 o 87 | IU CFOV idéntica: 6,666667 % |
| Solapamiento del 60 % por eje en esquina de UFOV | 36 % de área: excluir |
| Solapamiento del 70 % por eje en esquina de CFOV | 49 % de área: excluir |
| Bloque frío con cuentas originales 0,100,100,100 | Conservar suma 300 y defecto; IU ≈13,80 % |
| Bloque de borde con diez filas activas de trece | Mantener exclusión del fondo exterior |
| Solo un píxel válido tras las exclusiones | DU no calculable; nunca Conforme |
| Tasa o distancia en blanco | Desconocidas, no cero |
| Detector conocido, ventana ausente o sin verificar | Adquisición no verificada |

La compilación de la interfaz se comprueba con `npm run build:web`, que incluye la auditoría de
artefactos públicos. El build completo añade la compilación Rust/WASM de la aplicación de
antenas y requiere `wasm-pack`.


## Comparación Siemens-like experimental

Versión `siemens-like-experimental/2026.10`. Tercera vía independiente en la página,
con tabla IU y DU (máxima y por dirección), máscaras, copia de resultados y trazabilidad.
No es software Siemens, un protocolo oficial del fabricante ni un dictamen de conformidad.
La evaluación de adquisición y límites sigue usando exclusivamente NEMA geométrico.

Comparte suma de bloques enteros, recorte centrado, centro físico original, UFOV con
inclusión por al menos 50 % de área y CFOV del 75 % con la vía geométrica. El selector
controla ambas; Pylinac-like conserva su binning por potencias de dos cuando hay espaciado.
Se muestran matrices y píxeles efectivos para evitar comparar resoluciones implícitas.

Sobre las cuentas sumadas, calcula la media del CFOV geométrico **incluidos sus ceros**.
Marca las filas/columnas exteriores del UFOV por debajo del 75 % de esa media. Añade
los píxeles de suma cero y todo el exterior geométrico como semillas. Excluye semillas
y cuatro vecinos directos **una sola vez**; no itera ni incluye diagonales. No propaga
el fondo original a un bloque cuya suma es positiva. Suaviza una vez con el núcleo
normalizado sobre su máscara válida y obtiene IU/DU con las funciones comunes.

Esta diferencia de borde puede conservar una fila que la protección del fondo elimina,
a la vez que elimina una columna adyacente al exterior geométrico. No siempre aumenta
ni siempre disminuye IU. Los ceros interiores excluidos se documentan; esta vía no emite
conformidad aunque las medidas del campo restante sean pequeñas.

Comprobación exploratoria local: tres adquisiciones extrínsecas de Co-57, seis detectores,
1024×1024, píxel 0,5994 mm, UFOV 386×532 mm, bloques 13×13 y matriz final 78×78.
Los 24 valores de IU y DU máxima se compararon con valores Siemens mostrados a dos
decimales: 23 diferencias absolutas inferiores a 0,01 puntos porcentuales y una de
0,020203 puntos. No constituye validación independiente ni identifica el algoritmo
propietario. No se fuerza el redondeo del fabricante. Los archivos fuente se mantienen
fuera del repositorio; las regresiones públicas usan únicamente datos sintéticos.

La coincidencia numérica no demuestra conformidad con una edición de NEMA: un flood
extrínseco con colimador sigue siendo extrínseco, y unas cuentas inferiores al protocolo
no se corrigen por elegir otro algoritmo. Conservar revisión de adquisición y de máscaras.
