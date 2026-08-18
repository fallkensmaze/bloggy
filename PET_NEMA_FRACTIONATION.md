# PET NEMA IQ: fraccionamiento y cronómetros

## Objetivo

El módulo `/pet-nema-fraccionamiento` planifica el llenado del maniquí PET de calidad de imagen con esferas y F-18. Traslada a la web el cálculo de la hoja histórica:

`PET.Prueba de calidad de imagen.Fraccionamiento.xlsx`

El Excel se utilizó como fuente durante la migración y ya no se mantiene dentro del repositorio.

Además de los cronómetros de adquisición, muestra una lista operativa de muestras. La actividad recomendada de cada muestra pendiente se actualiza cada segundo según la hora real. Al marcarla como preparada, el módulo solicita la actividad medida y propone automáticamente la hora actual.

## Archivos

- `src/pages/PetNemaFractionation.jsx` - interfaz, formularios, resultados y cronómetros.
- `src/utils/petNemaFractionation.js` - funciones puras de geometría, decaimiento, ratios teóricos y actividad necesaria por muestra.
- `src/styles/pet-nema.css` - estilos específicos.
- `src/App.jsx` - ruta `/pet-nema-fraccionamiento`.
- `src/components/Sidebar.jsx` y `src/components/Topbar.jsx` - enlaces de navegación.

## Secuencia operativa

1. Indicar la hora prevista de la primera adquisición.
2. Preparar `F1`, la disolución de esferas y, si se utiliza, la fuente lineal.
3. Marcar cada muestra al prepararla e introducir la actividad medida. La hora se rellena con el momento actual y se puede corregir.
4. Usar `F1` en el fondo durante la primera adquisición.
5. Preparar o añadir `F2` después de la primera adquisición.
6. Realizar la segunda adquisición 110 minutos después de la primera.

Con este procedimiento:

- El fondo queda en `5,3 kBq/ml` en ambas adquisiciones.
- Las esferas parten de `42,4 kBq/ml`, por lo que el ratio inicial es `8:1`.
- Tras una semivida de F-18, las esferas quedan en `21,2 kBq/ml`.
- Al añadir la segunda fracción de fondo, el ratio de la segunda adquisición es `4:1`.

## Parámetros por defecto

| Parámetro | Valor |
| --- | ---: |
| Semivida de F-18 e intervalo entre adquisiciones | `110 min` |
| Concentración de fondo | `5,3 kBq/ml` |
| Ratio esferas / fondo, primera adquisición | `8:1` |
| Ratio esferas / fondo, segunda adquisición | `4:1` (derivado, no configurable) |
| Volumen de la cavidad sin insertos | `9700 ml` |
| Diámetro del inserto cilíndrico | `5,1 cm` |
| Longitud del inserto cilíndrico | `18 cm` |
| Diámetros de las esferas | `3,7`, `2,8`, `2,2`, `1,7`, `1,3`, `1,0 cm` |
| Volumen de la disolución de esferas | `500 ml` |
| Actividad de la fuente lineal en la primera adquisición | `116 MBq` |
| Volumen de la fuente lineal | `5,5 ml` |

Los parámetros geométricos y la fuente lineal se pueden ajustar desde la interfaz.

## Cálculos

### Geometría

Para cada esfera:

```text
V_esfera = 4 / 3 · π · (diámetro / 2)^3
```

Para el inserto cilíndrico:

```text
V_inserto = π · (diámetro / 2)^2 · longitud
```

El volumen útil de fondo se obtiene descontando esferas e inserto:

```text
V_fondo = V_fantoma - ΣV_esferas - V_inserto
```

Con los valores por defecto:

```text
V_fondo = 9284,454732925595 ml
```

### Decaimiento

El factor de decaimiento entre dos instantes separados por `t` minutos es:

```text
factor(t) = exp(-ln(2) · t / T1/2)
```

La actividad necesaria al fraccionar para disponer de una actividad objetivo en la adquisición es:

```text
A_preparacion = A_objetivo / factor(t)
```

La hora de preparación es la hora actual mientras la muestra siga pendiente. Cada muestra queda fijada de forma independiente al pulsar **Marcar preparada**.

### Fondo

La actividad de fondo requerida en la primera adquisición es:

```text
A_fondo = 5,3 kBq/ml · V_fondo / 1000
```

El módulo calcula la actividad corregida por decaimiento para preparar `F1`. En la segunda adquisición, `F1` ya ha decaído una semivida y aporta la mitad del fondo. `F2` completa la mitad restante.

Si `F1` y `F2` se preparan simultáneamente, ambas requieren la misma actividad. Si `F2` se prepara más tarde, el módulo reduce automáticamente su actividad necesaria.

### Esferas

La concentración inicial de la disolución de esferas es:

```text
C_esferas_1 = 5,3 kBq/ml · 8 = 42,4 kBq/ml
```

Para `500 ml`:

```text
A_esferas_1 = 42,4 kBq/ml · 500 ml / 1000 = 21,2 MBq
```

El módulo corrige esa actividad a la hora actual hasta que se marca la muestra como preparada.

El ratio de la segunda adquisición **no es un parámetro de entrada**: es consecuencia de que el intervalo entre adquisiciones sea una semivida, lo que deja las esferas a la mitad mientras el fondo se restaura. Se muestra calculado a partir del decaimiento real. La tabla de comprobación teórica describe por tanto los objetivos del plan, no una validación independiente.

El análisis posterior (`/pet-nema-analisis`) no consume estos ratios nominales: recibe las concentraciones `a_H` y `a_B` medidas y calcula el ratio real. Sólo interviene su cociente, así que la unidad empleada se cancela siempre que ambas se expresen igual y estén referidas al mismo instante.

### Fuente lineal

La fuente lineal es opcional. El valor por defecto es `116 MBq` a la hora de la primera adquisición. La interfaz muestra su actividad corregida a la hora actual y la incluye en el total pendiente con fuente lineal.

## Cronómetros

La página mantiene dos indicadores:

- **1a adquisición** - hora prevista de la primera imagen.
- **2a adquisición** - hora prevista calculada como primera adquisición `+ 110 min`.

Antes del evento se muestra una cuenta atrás. Después del evento se muestra el tiempo transcurrido.

## Preparación guiada

La interfaz mantiene cuatro tarjetas:

- **Fondo F1** - apunta a la primera adquisición.
- **Fondo F2** - apunta a la segunda adquisición y completa la contribución decaída de `F1`.
- **Disolución esferas** - apunta a la primera adquisición.
- **Fuente lineal** - opcional, apunta a la primera adquisición.

Mientras una tarjeta está pendiente, su actividad recomendada se recalcula cada segundo. Cada tarjeta indica la actividad objetivo y la hora de imagen a la que se refiere, para que quede claro por qué `F1` y `F2` pueden requerir actividades de preparación distintas.

Al pulsar **Marcar preparada**, la recomendación queda congelada y se abre el registro de la actividad inicial medida. La hora se rellena con el momento actual. Tras confirmar, la tarjeta muestra la actividad inicial proyectada en la imagen y su desviación porcentual respecto al objetivo.

Después de inyectar la muestra, **Registrar residual** permite introducir la actividad que queda en la jeringa. La hora residual también se rellena con el momento actual. El módulo corrige ambas medidas por decaimiento hasta la hora de imagen y muestra:

```text
actividad_neta_en_imagen =
  actividad_inicial_corregida_a_imagen
  - actividad_residual_corregida_a_imagen

desviación (%) =
  (actividad_neta_en_imagen - actividad_objetivo_en_imagen)
  / actividad_objetivo_en_imagen · 100
```

Los botones de edición permiten corregir una medida introducida por error.

Si se modifica la planificación o cualquier parámetro después de registrar medidas, el módulo **no las borra**: muestra un aviso indicando que las recomendaciones congeladas y las desviaciones ya no corresponden a los parámetros actuales, y deja descartarlas explícitamente. Las medidas de actividad tomadas durante el procedimiento no se pierden por una pulsación accidental.

## Validación

La implementación se contrastó con las pestañas `PET450` y `PET650` del Excel de referencia.

Para el ejemplo `PET450`, preparando todas las muestras a las `15:30` y realizando la primera adquisición a las `16:30`:

| Resultado | Valor |
| --- | ---: |
| Fondo `F1` | `71,8175279665 MBq` |
| Fondo `F2` | `71,8175279665 MBq` |
| Disolución de esferas | `30,9409782404 MBq` |
| Fuente lineal | `169,2996922590 MBq` |
| Total sin fuente lineal | `174,5760341734 MBq` |
| Total con fuente lineal | `343,8757264324 MBq` |

Si `F2` se deja pendiente, su actividad disminuye progresivamente hasta el momento en que se prepara. La comprobación teórica mantiene el objetivo `8:1` en la primera adquisición y `4:1` en la segunda.

## Alcance

El módulo es una ayuda de planificación y comprobación. Antes de utilizarlo en producción, los valores configurados deben revisarse según el protocolo local, el maniquí utilizado y la trazabilidad metrológica del activímetro.
