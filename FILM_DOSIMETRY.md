# Dosimetría multicanal de película

El módulo disponible en `/dosimetria-pelicula` procesa las imágenes íntegramente en el navegador. Está planteado como herramienta técnica de apoyo y requiere una validación local del protocolo, del escáner y de la importación DICOM antes de utilizar sus resultados en un flujo clínico.

## Protocolo de calibración

La calibración ofrece dos protocolos excluyentes. La selección se aplica a todos los puntos: no se pueden mezclar dosis con y sin TIFF pre.

- **TIFF pre y post:** cada dosis utiliza escaneos de la misma película antes y después de irradiarla. La respuesta es `netOD = log10(Ipre / Ipost)`.
- **Solo TIFF post:** no utiliza un TIFF pre, una película de velo ni una referencia común. La respuesta es la intensidad media de la ROI normalizada a 16 bits, `I / 65535`. Si el punto contiene una sola imagen se usa directamente su valor; si contiene varias repeticiones se promedian píxel a píxel.

Todos los archivos de una calibración deben mantener posición, orientación, resolución y dimensiones; el módulo no realiza registro automático.

1. Preparar al menos cuatro dosis positivas distintas. La interfaz propone 50–700 cGy. El protocolo pre/post añade automáticamente el anclaje 0 Gy, netOD 0; el protocolo solo post no extrapola hasta 0 Gy y su rango comienza en la menor dosis medida.
2. Mantener constantes el lote de película, el escáner, la orientación, la resolución, el calentamiento del equipo y el intervalo postirradiación.
3. Elegir la zona de cálculo de cada TIFF. Cada imagen tiene su propia previsualización y puede llevar una ROI en coordenadas diferentes. Si no se define una ROI para una imagen, se utiliza completa. Conviene evitar bordes, marcas y artefactos.
   En el protocolo pre/post, la ROI dibujada sobre un TIFF pre o velo puede copiarse al TIFF irradiado correspondiente. Si el número de TIFF pre y post no coincide —por ejemplo, un único velo para varias irradiaciones— puede aplicarse esa ROI a todos los TIFF post.
4. Procesar los puntos. Las repeticiones se promedian antes de obtener netOD o intensidad normalizada, según el protocolo.

5. Ajustar y guardar. La aplicación conserva las curvas, la base de respuesta, la covarianza entre canales, los puntos y los metadatos. La referencia RGB solo existe en calibraciones pre/post.
6. Exportar el archivo `.filmcal.json` como copia independiente del almacenamiento del navegador.

Antes de guardar, **Ajustar y verificar** reconstruye la dosis de cada punto a partir de las mismas imágenes de calibración. La tabla situada después de las películas compara la dosis nominal con la dosis multicanal, RGB ponderada y de cada canal, e informa del error porcentual y el RMSE. Es una autoverificación de la consistencia del ajuste y queda almacenada con la calibración; no sustituye una validación independiente con películas diferentes.

El botón se habilita cuando hay al menos cuatro dosis positivas diferentes con los archivos requeridos. No es necesario pulsar antes **Procesar disponibles**: **Ajustar y verificar** procesa automáticamente los puntos pendientes. Los TIFF pre y post pueden tener dimensiones globales diferentes; cada ROI se resuelve dentro de su propia imagen y, si sus tamaños no coinciden, las repeticiones se combinan con el mismo peso estadístico por imagen.

El mismo paso muestra una gráfica de las tres curvas RGB con los puntos medidos superpuestos al ajuste racional. La gráfica también puede abrirse posteriormente desde **Ver ajuste** en la tarjeta de cada calibración guardada.

Para cada canal se ajusta la función racional monótona

`respuesta(D) = -log10((a + bD) / (c + D))`.

Los parámetros se transforman durante el ajuste para mantenerlos positivos. Se impone `a > b·c` para netOD creciente y `a < b·c` para intensidad decreciente. La tarjeta de calibración muestra R² y el RMSE de dosis reconstruida por canal. Esta comprobación interna no sustituye una validación dosimétrica independiente.

## TIFF admitido

- Una imagen por archivo.
- RGB entrelazado, tres muestras por píxel.
- Entero sin signo de 16 bits por canal: 48 bits RGB.
- Orientación TIFF 1, 3, 6 u 8.
- Todas las repeticiones deben compartir dimensiones y, cuando esté informado, Pixel Spacing.

El lector conserva los valores `Uint16`; no reduce la imagen a 8 bits. Si el TIFF contiene resolución física, se deriva el espaciado en milímetros. En caso contrario se utiliza el DPI nominal de la calibración.

## Métodos de reconstrucción

| Método | Uso |
| --- | --- |
| Multicanal con perturbación común | Ajusta simultáneamente la dosis y una perturbación común en la base de respuesta de la calibración usando la covarianza RGB. Es el método predeterminado. |
| RGB ponderado | Combina las dosis de los tres canales según la pendiente local y la dispersión de cada canal. |
| Rojo, verde o azul | Invierte una única curva; resulta útil para diagnóstico y comparación. |

El cálculo se ejecuta en un Web Worker. El resultado incluye dosis, incertidumbre local aproximada, perturbación común, píxeles saturados, valores fuera del rango de calibración y perfiles centrales.

Con una calibración pre/post puede cargarse una referencia sin irradiar de la misma geometría. Si se omite, se utiliza el `I0` medio guardado en la calibración; esta alternativa no corrige la falta de uniformidad espacial del escáner. Una calibración solo post trabaja directamente con `I/65535` y no admite una referencia sin irradiar.

## Persistencia

Las calibraciones se almacenan en IndexedDB, en la base `bloggy-film-dosimetry`. La calibración activa se recuerda en `localStorage`. Se pueden activar, duplicar, eliminar, importar y exportar sin usar Firebase ni enviar imágenes al servidor.

## Exportación DICOM RT Dose

El exportador crea una matriz RT Dose 2D de 32 bits sin signo, con `DoseUnits=GY`, `DoseType=PHYSICAL` y `DoseSummationType=PLAN`. Requiere:

- un CT o RT Dose que aporte paciente, estudio, Frame of Reference y geometría;
- un RT Plan o RT Ion Plan del mismo estudio y Frame of Reference, salvo que el RT Dose de referencia ya lo contenga;
- revisar `ImagePositionPatient` e `ImageOrientationPatient` para que describan la posición real de la película.

El `PixelSpacing` procede del TIFF o del DPI de calibración. `DoseGridScaling` se calcula a partir de la dosis máxima y la salida se vuelve a abrir con `dcmjs` antes de descargarla. El flujo sigue los atributos condicionales del [módulo RT Dose de DICOM PS3.3](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.8.8.3.html), pero cada sistema clínico debe validar su propia compatibilidad de importación.

## Verificación

```bash
npm run test:film
npm run build:web
```

Las pruebas generan un TIFF RGB de 16 bits, verifican el cálculo con imagen completa y con ROI, comprueban los protocolos pre/post y solo post —incluidos TIFF únicos y repetidos—, reconstruyen mapas sintéticos y vuelven a leer un RT Dose para comprobar geometría, escala y referencias.

## Límites actuales

- No hay registro automático, corrección lateral del escáner ni corrección de orientación de la película distinta a la etiqueta TIFF.
- No se extrapola fuera del rango calibrado: esos píxeles se marcan y la dosis se limita al intervalo disponible.
- La incertidumbre mostrada es local y derivada del ajuste/covarianza; no es un presupuesto completo de incertidumbre.
- La exportación representa un solo plano y solo ofrece la semántica de suma `PLAN`.
- No se realiza comparación gamma con una distribución de referencia.
