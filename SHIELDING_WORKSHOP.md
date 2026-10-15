# Taller temporal de blindajes

Primera versión de la herramienta React en `/blindajes`. Su objetivo es completar
un recorrido usable: abrir un plano, calibrarlo, dibujar la sala, colocar las
orientaciones de un equipo convencional y evaluar puntos con CSN y NCRP.

## Acceso y sesión

`ShieldingPage.jsx` utiliza el login de Google y la identidad de propietario que
Bloggy ya conoce mediante `useAuthUser`. El editor solo se monta cuando `isAdmin`
está confirmado; una sesión en comprobación, ausente o de otra cuenta no lo abre.
El código distribuido por el sitio estático sigue siendo público: esta ruta no
incorpora un backend privado ni una colección de datos.

El plano, la escena, el historial de deshacer y los resultados viven en memoria
de la pestaña. No se envían a Firebase ni se guardan en `localStorage`,
`sessionStorage`, IndexedDB o archivos. Cerrar, recargar o abandonar el editor
pierde el trabajo. El login existente tiene su propio ciclo de sesión y no guarda
la escena. Cambiar datos o geometría invalida los resultados anteriores.

## Editor implementado

- PDF, PNG y JPEG locales, hasta 20 MiB; el PDF permite escoger una página.
  PDF.js y su worker se sirven con la aplicación; el archivo se decodifica en el
  navegador. Hay límites de dimensiones y rasterización en `shieldingFiles.js`.
- Plano como fondo con opacidad, giro de 90° antes de calibrar, zoom y desplazamiento.
- Calibración por dos puntos y longitud real en metros. Recalibrar cambia las
  coordenadas de toda la escena y puede deshacerse. El lienzo vacío ya usa metros.
- Sala rectangular o poligonal, paredes, puertas, ventanas, selección y tiradores,
  medidas, borrado, deshacer y rehacer.
- Varias configuraciones del mismo equipo: foco, dirección, apertura completa
  del haz, entrada del haz en el paciente y porcentaje de carga CSN.
- Parámetros NCRP iniciales editables: se puede calcular después de dibujar.
  El segundo clic de una orientación sitúa la entrada al paciente y la dirección;
  ambos se mueven juntos hasta usar «Mover entrada al paciente» por separado.
- Puntos de cálculo con ocupaciones CSN/NCRP independientes y comparación de
  resultados mediante un único botón.
- Resultados guiados: una lista indica qué falta para calcular (escala,
  orientación, punto) y si CSN tiene perfil; la barra inferior ofrece «Calcular»
  en cuanto hay orientación y punto. Tras calcular, el panel se desplaza a los
  resultados y cada punto muestra en el plano su total semanal NCRP/CSN. La
  etiqueta desaparece con cualquier cambio, igual que los resultados.

Las coordenadas de la escena son metros en planta; el eje Y de SVG crece hacia
abajo. El zoom modifica la vista, nunca las distancias físicas. El marcador de
dirección no es un receptor absorbente: el haz continúa más allá de él. Una pared
dibujada tampoco hace desaparecer la primaria.

## Contrato de cálculo

`src/utils/shieldingCalculations.js` exporta `evaluateShielding(scene)`, sin React,
red, persistencia ni dependencias de terceros. Recibe la escena calibrada,
`csnTotalWorkload`, `configurations[]` y `points[]`. El panel de entrada está en
`src/components/shielding/ShieldingCalculationPanel.jsx`.

Para cada configuración `i` y punto `q`, se obtienen tres distancias en metros:
`d_fq` (foco–punto), `d_fp` (foco–paciente) y `d_pq` (paciente–punto).
`I_i(q)` vale uno cuando la proyección del punto está dentro del haz declarado,
incluido su borde, y cero cuando está fuera. Una geometría incompleta produce un
estado pendiente, nunca un cero supuesto. La entrada al paciente se sitúa al
dibujar y puede moverse por separado; debe pertenecer al haz.

### Valores iniciales NCRP

A petición del propietario, el taller precarga referencias numéricas seleccionadas
de NCRP 147 mediante `shieldingPresets.js`; el motor de cálculo sigue exigiendo
entradas explícitas y no sustituye campos borrados por valores supuestos.

- Inicio: radiología general, componente bucky mural; N = 120 pacientes/semana,
  Kp¹ = 2,3 y Ksec¹ = 0,0073 mGy/paciente a 1 m. Los puntos comienzan con T = 1.
- Otros perfiles: radiología general/otras direcciones, sala dedicada de tórax y
  tubo radiográfico de sala R&F. No son perfiles de TC, mamografía o fluoroscopia.
- Referencias: tablas 4.1 (ocupación), 4.3 (N de actividad media), 4.5 (primaria)
  y 4.7 (secundaria), páginas impresas 31, 40, 43 y 46–47. La secundaria incluye
  fuga y usa el mayor de los valores direccionales tabulados para ese perfil.

La apertura inicial es una hipótesis geométrica de la aplicación:
`2 atan(ancho / (2 distancia_referencia))`. Se usa el lado de 43 cm para tórax
y un campo cuadrado equivalente de 1.000 cm² para los demás perfiles. No es una
apertura universal prescrita por NCRP ni una dimensión deducida del plano.
El perfil conserva su campo/espectro de referencia: el dibujo aporta posiciones,
no recalcula los coeficientes para otros tamaños de campo o distribuciones de kV.
No hay atenuación implícita por el paciente o el receptor.

Al añadir o eliminar orientaciones, las que mantienen N automático reciben
`N_típico / número_de_orientaciones_del_mismo_perfil`. Este reparto uniforme es
una elección inicial editable de la aplicación, no un factor U de NCRP. Bucky
y otras direcciones son componentes diferentes y cada uno usa N de la sala,
como explica §4.1.4. No se añade una segunda contribución «all barriers».

Editar N lo convierte en manual y lo conserva literalmente, incluso en blanco.
Las orientaciones automáticas siguen usando el número total de posiciones de
su perfil como divisor; los N manuales se suman tal como se han declarado. El
panel muestra la suma por perfil para revisar cargas personalizadas: con
entradas manuales la suma no tiene por qué coincidir con N típico. Cambiar el
porcentaje CSN no modifica N. Cambiar o restaurar un perfil restablece sus datos
NCRP y el reparto automático; conserva las posiciones y la apertura si se editó.

Los valores pueden cambiarse individualmente; editar Ksec¹ desactiva la
aceptación automática de la envolvente y exige revisar su aplicabilidad.
Los parámetros modificados se identifican como personalizados. El uso del
espacio carga T NCRP y admite un valor manual, sin modificar T CSN. Borrar
cualquier dato necesario vuelve a dejar el resultado pendiente. Cada cambio
invalida resultados y se puede deshacer o rehacer.

### Valores iniciales CSN 5.11

El selector «Valores iniciales CSN 5.11 · equipo completo» aparece en Equipo y
Resultados. Carga un escenario de radiografía convencional para todas las
orientaciones del mismo equipo, conservando geometría y datos NCRP. Puede
seleccionarse antes o después de dibujar. Los perfiles son escenarios alternativos,
no tres cargas que deban sumarse.

| Perfil | W (mA·min/semana) | G aproximado (mGy·m²/(mA·min)) | Qh (mA·min/h) |
| --- | ---: | ---: | ---: |
| Radiografía sin radioscopia, 100 kVp | 160 | 10 | 300 |
| Radiografía sin radioscopia, 125 kVp | 80 | 15 | 240 |
| Radiografía sin radioscopia, 150 kVp | 40 | 20 | 200 |

Fuente: CSN GS 5.11, octubre de 1990, páginas **impresas** 16–18, 21 y 23.
W procede de la tabla 2 y Qh de los ejemplos de la página 18. G es una lectura
gráfica redondeada de la figura 1 para wolframio, tensión constante y 2 mm Al.
La figura expresa Γ en mSv·m²/(mA·min): estos perfiles adoptan explícitamente
la equivalencia numérica aproximada mSv/mGy = 1 que la guía admite para
radiodiagnóstico en la página 18. No es una medición del rendimiento en kerma del
equipo ni una conversión a dosis efectiva; la UI y la procedencia lo indican.
No se extrapolan estos perfiles a TC, mamografía o radioscopia.

La fracción dispersa inicial es 0,002 para 400 cm² (p. 17). El campo real inicial
20 × 20 cm es una hipótesis editable de la aplicación; no se deduce del plano ni
modifica la apertura dibujada. Deben revisarse ambos datos para el campo real.
La fuga se calcula como `L = límite × f / Qh`, inicialmente con límite
1 mGy/h a 1 m y f = 1 conservador, sin reducción por tensión de diseño de la
carcasa. Qh, f y límite pueden editarse: se recalcula L; un campo borrado o
inválido deja L pendiente. Editar L directamente lo convierte en manual, como
indica el panel. Volver a editar Qh, f o límite reactiva la fórmula.

Seleccionar/restaurar el perfil carga W y los coeficientes de todas las
orientaciones. Inicia T CSN = 1 solo en puntos aún sin ocupación. Conserva
ocupaciones elegidas, porcentajes manuales y blancos introducidos manualmente.
Las orientaciones automáticas reciben 100/n por ciento; es una hipótesis inicial
de la aplicación, no U tabulado. Añadir o quitar orientaciones recalcula solo los
porcentajes automáticos; con porcentajes manuales se exige revisar la suma 100 %.
Los nuevos puntos y orientaciones heredan el perfil activo. Borrar cualquier
entrada necesaria deja CSN pendiente hasta editarla o restaurar expresamente el
perfil; el motor nunca rellena datos.

La ocupación CSN es independiente de NCRP: total 1, parcial 1/4 y ocasional 1/16
(p. 16). Los dos valores reducidos se ofrecen para público; para personal expuesto
se indica T = 1. Un uso desconocido comienza en 1 por decisión conservadora de
la aplicación. Esta distribución direccional no incorpora el mínimo U×T = 0,1
recomendado para el método de barreras con U tabulado: ese método sigue fuera
del alcance actual.

### CSN con distribución direccional declarada

Esta primera ruta adapta el término fuente a las orientaciones dibujadas. La
distribución sustituye al factor `U` tabulado: no se multiplican ambas cosas. No
implementa todavía la comparación con la política `U` tabulado de la Guía.

Por configuración se declara:

| Entrada | Significado y unidad |
| --- | --- |
| `usePercent` | Porcentaje de carga del equipo; todas las configuraciones suman 100 %. |
| `output_mGy_m2_per_mA_min` | Rendimiento primario `G`, normalizado a 1 m, en mGy·m²/(mA·min). |
| `scatter_fraction` | Fracción dispersa `a` para el área de referencia declarada. |
| `reference_field_area_cm2` | Área `S_ref` correspondiente a `a`, en cm². |
| `field_area_cm2` | Área real `S` sobre el paciente, en cm². |
| `largest_field_side_m` | Lado mayor del campo sobre el paciente, en metros. |
| `leakage_mGy_m2_per_mA_min` | Rendimiento efectivo de fuga `L`, en mGy·m²/(mA·min). |
| `provenance` | Referencia, fecha y condiciones de los valores introducidos. |

Con `W_total` en mA·min/semana y `T_CSN` propio del punto, las contribuciones
mostradas ya incluyen ocupación:

```text
W_i = W_total × usePercent_i / 100
K_primaria,i = T_CSN × I_i(q) × G_i × W_i / d_fq²
K_dispersa,i = T_CSN × G_i × W_i × a_i × (S_i / S_ref,i) / (d_fp² × d_pq²)
K_fuga,i = T_CSN × L_i × W_i / d_fq²
K_total = suma_i(K_primaria,i + K_dispersa,i + K_fuga,i)
```

La dispersión exige `d_pq > 5 × lado_mayor`, con desigualdad estricta. La fuga
efectiva debe incluir la corrección correspondiente a las condiciones de trabajo.
El motor no incorpora una corrección ni una conversión mSv→mGy implícitas;
la aproximación del perfil inicial se declara al cargarlo, como se explica arriba.
La normalización `a/S_ref` debe proceder de datos coherentes; el perfil CSN usa
0,002/400 cm² como se indica arriba. Las ecuaciones parten del anexo «Cálculo de blindajes», apartados
a.1 y a.2, de la [Guía CSN GS 05-11, octubre de 1990](https://www.csn.es/documents/10182/896572/GS%2005-11%20Aspectos%20t%C3%A9cnicos%20de%20seguridad%20y%20protecci%C3%B3n%20radiol%C3%B3gica%20de%20instalaciones%20m%C3%A9dicas%20de%20rayos%20X%20para%20diagn%C3%B3stico%20%28Octubre%201990%29).

### NCRP 147 por configuración

Entradas: `patients_per_week` (`N_i`), `primary_mGy_per_patient_at_1m` (`K¹_p,i`),
`secondary_mGy_per_patient_at_1m` (`K¹_sec,i`), perfil y procedencia. Las dos
constantes se expresan en mGy/paciente a 1 m y pertenecen al mismo perfil.
`N_i` corresponde solo a esa configuración; no se multiplica por `usePercent`.
Repetir un perfil de sala completa con todos sus pacientes en cada orientación
duplicaría la carga.

La secundaria integra dispersión y fuga. Los perfiles iniciales usan la envolvente
tabulada; un coeficiente secundario editado requiere confirmar su aplicabilidad
para las direcciones evaluadas. No se calcula ni suma otra fuga NCRP.

```text
d_sec = min(d_fq, d_pq)
K_primaria,i = T_NCRP × I_i(q) × K¹_p,i × N_i / d_fq²
K_secundaria,i = T_NCRP × K¹_sec,i × N_i / d_sec²
K_total = suma_i(K_primaria,i + K_secundaria,i)
```

Referencias: [NCRP Report 147, copia publicada por AAPM](https://www.aapm.org/pubs/protected_files/NCRP/NCRP_Report_147_AAPM.pdf),
§4.1.7.3, ecuación 4.4 y elección conservadora de distancia, página impresa 48;
apéndice B, ecuación B.6, página 127. El repositorio incluye solo las referencias
numéricas necesarias para los perfiles, con atribución; no redistribuye el informe.

### Salidas y validación

Cada método devuelve contribuciones, detalle por orientación, errores y total
en mGy/semana **ponderado por su ocupación T**. No es dosis efectiva ni mSv.
La ausencia de un dato necesario deja el total del método pendiente. El otro
método puede seguir completo: no lo sustituye ni le presta valores.

Se rechazan blancos, booleanos, números no finitos, distancias nulas,
ocupaciones fuera de `(0, 1]`, reparto CSN distinto de 100 % y desbordamientos
o subdesbordamientos que pudieran producir falsos ceros. Una configuración con
0 % CSN o cero pacientes NCRP aporta cero explícito solo a ese método.

## Límites de esta versión y trabajo pendiente

La comparación actual es **en planta y SIN BLINDAJE**. No modela alturas,
suelo, techo, transmisión por paredes/receptores ni capas de materiales. No
obtiene espesores, límites regulatorios, conformidad o prescripciones. La
dirección declarada CSN no equivale al cálculo completo de la Guía 5.11.

Los coeficientes NCRP se inicializan con referencias publicadas y pueden editarse
durante la sesión. No son medidas del equipo del usuario. Los coeficientes CSN
pueden cargarse con sus propios perfiles y editarse independientemente. Las pruebas distinguen los oráculos
ficticios del motor de los valores bibliográficos de los perfiles iniciales.
No hay snapshots persistidos, cadenas de hashes o flujos de aprobación.

Siguientes pasos técnicos, cuando se habiliten:

1. Completar geometría tridimensional y posiciones de mesa/bucky, con alturas y
   cobertura de suelo/techo verificables.
2. Incorporar datos completos con su aplicabilidad de tensión, espectro, material
   y perfil; conservar las diferencias entre CSN y NCRP y comparar `U` tabulado
   frente a distribución declarada.
3. Atenuar cada contribución a lo largo de su trayectoria con modelos y datos
   adecuados; comprobar preblindajes y evitar duplicar dispersión/fuga.
4. Validar después el dimensionamiento y las reglas de combinación de barreras
   con casos independientes revisados. Guardado/exportación requerirán una
   decisión de producto posterior: no forman parte de este taller temporal.

## Comprobaciones para mantener el módulo

```bash
npm run test:shielding
npm run test:shielding:browser
npm run build:web
```

Las pruebas de cálculo usan oráculos aritméticos ficticios, reparto de carga,
ausencia de datos, distancias singulares, régimen de dispersión, invariancia
geométrica y estabilidad numérica. Las pruebas de navegador cubren los flujos
del editor, cálculo NCRP directo, edición/restauración y pérdida del trabajo al
reiniciar. `test-shielding-presets.mjs` comprueba los perfiles con cálculos
independientes, reparto sin duplicación, ocupación y conservación de cambios.
`test-shielding-csn-presets.mjs` añade los tres escenarios CSN, el cálculo de
fuga, la independencia de métodos, blancos manuales y herencia del perfil.
La suite de navegador verifica selección, edición, restauración y ocupación CSN.
Pasarlas verifica este alcance
implementado; no valida un cálculo completo de blindajes que aún no existe.
