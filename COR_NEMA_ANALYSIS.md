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

Para cada fuente, vista y detector se forma una ROI cuadrada de 45 mm. La ROI
se integra en cada dirección y el centroide del perfil se calcula sobre un
número impar de píxeles centrado en el máximo que incluye ambos cruces de la
semialtura, conforme a la ecuación 2-3. Las coordenadas se mantienen en
subpíxel y solo se convierten a milímetros al final.

La aplicación informa los cuatro límites superiores de §4.1.5:

- `δCOR,1`: máximo error COR de cualquier fuente y detector;
- `δCOR,12`: máxima diferencia COR entre una pareja de detectores;
- `δAXIAL,1`: máxima excursión axial de una fuente en un detector;
- `δAXIAL,12`: máximo desalineamiento axial medio entre detectores.

NEMA especifica el método de medida, pero no un límite de aceptación universal:
los valores deben compararse con la especificación del sistema. Por eso la
interfaz etiqueta como provisionales los límites iniciales de medio píxel.

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

