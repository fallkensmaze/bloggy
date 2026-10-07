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
- Puntos de cálculo con ocupaciones CSN/NCRP independientes y comparación de
  resultados mediante un único botón.

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
estado pendiente, nunca un cero supuesto. La entrada al paciente se declara
separadamente y debe pertenecer al haz.

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
La aplicación no incorpora una corrección ni una conversión mSv→mGy implícitas.
La normalización `a/S_ref` debe proceder de datos coherentes; no hay valor físico
precargado. Las ecuaciones parten del anexo «Cálculo de blindajes», apartados
a.1 y a.2, de la [Guía CSN GS 05-11, octubre de 1990](https://www.csn.es/documents/10182/896572/GS%2005-11%20Aspectos%20t%C3%A9cnicos%20de%20seguridad%20y%20protecci%C3%B3n%20radiol%C3%B3gica%20de%20instalaciones%20m%C3%A9dicas%20de%20rayos%20X%20para%20diagn%C3%B3stico%20%28Octubre%201990%29).

### NCRP 147 por configuración

Entradas: `patients_per_week` (`N_i`), `primary_mGy_per_patient_at_1m` (`K¹_p,i`),
`secondary_mGy_per_patient_at_1m` (`K¹_sec,i`), perfil y procedencia. Las dos
constantes se expresan en mGy/paciente a 1 m y pertenecen al mismo perfil.
`N_i` corresponde solo a esa configuración; no se multiplica por `usePercent`.
Repetir un perfil de sala completa con todos sus pacientes en cada orientación
duplicaría la carga.

La secundaria integra dispersión y fuga. Su aplicabilidad como envolvente para
todas las direcciones evaluadas debe confirmarse expresamente. No se calcula
ni suma otra fuga NCRP.

```text
d_sec = min(d_fq, d_pq)
K_primaria,i = T_NCRP × I_i(q) × K¹_p,i × N_i / d_fq²
K_secundaria,i = T_NCRP × K¹_sec,i × N_i / d_sec²
K_total = suma_i(K_primaria,i + K_secundaria,i)
```

Referencias: [NCRP Report 147, copia publicada por AAPM](https://www.aapm.org/pubs/protected_files/NCRP/NCRP_Report_147_AAPM.pdf),
§4.1.7.3, ecuación 4.4 y elección conservadora de distancia, página impresa 48;
apéndice B, ecuación B.6, página 127. Estas referencias no autorizan incorporar
sus tablas al repositorio.

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

Los coeficientes se introducen durante la sesión con procedencia. El repositorio
no contiene tablas protegidas, datos clínicos de equipos ni datos reales
inventados. Los casos numéricos de las pruebas están marcados como ficticios.
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
del editor y la pérdida del trabajo al reiniciar. Pasarlas verifica este alcance
implementado; no valida un cálculo completo de blindajes que aún no existe.
