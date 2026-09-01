# Dosimetría multicanal de película

El módulo disponible en `/dosimetria-pelicula` procesa las imágenes íntegramente en el navegador. Está planteado como herramienta técnica de apoyo y requiere una validación local del protocolo, del escáner y de la importación DICOM antes de utilizar sus resultados en un flujo clínico.

## Protocolo de calibración

La calibración usa un protocolo pareado pre/post. Para cada punto de dosis se seleccionan uno o varios escaneos de la misma película antes de irradiarla y el mismo número o conjunto de repeticiones después de irradiarla. Todos deben mantener posición, orientación, resolución y dimensiones; el módulo no realiza registro automático.

1. Preparar al menos cuatro dosis positivas distintas. La interfaz propone 50–700 cGy y añade automáticamente el anclaje 0 Gy, netOD 0.
2. Mantener constantes el lote de película, el escáner, la orientación, la resolución, el calentamiento del equipo y el intervalo postirradiación.
3. Elegir la zona de cálculo. Por defecto se utiliza la imagen completa. Opcionalmente se puede activar **Seleccionar ROI** y dibujar un rectángulo sobre la previsualización del primer TIFF previo disponible; las coordenadas relativas de esa ROI se aplican por igual a todos los TIFF pre/post. Conviene evitar bordes, marcas y artefactos.
4. Procesar cada pareja pre/post. Las repeticiones se promedian antes de calcular, píxel a píxel,

   `netOD = log10(I0 / I)`.

5. Ajustar y guardar. La aplicación conserva las curvas, la referencia RGB, la covarianza entre canales, los puntos y los metadatos.
6. Exportar el archivo `.filmcal.json` como copia independiente del almacenamiento del navegador.

Para cada canal se ajusta la función racional monótona

`netOD(D) = -log10((a + bD) / (c + D))`.

Los parámetros se transforman durante el ajuste para mantenerlos positivos y garantizar `a > b·c`. La tarjeta de calibración muestra R² y el RMSE de dosis reconstruida por canal. Esta comprobación interna no sustituye una validación dosimétrica independiente.

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
| Multicanal con perturbación común | Ajusta simultáneamente la dosis y una perturbación común de netOD usando la covarianza RGB. Es el método predeterminado. |
| RGB ponderado | Combina las dosis de los tres canales según la pendiente local y la dispersión de cada canal. |
| Rojo, verde o azul | Invierte una única curva; resulta útil para diagnóstico y comparación. |

El cálculo se ejecuta en un Web Worker. El resultado incluye dosis, incertidumbre local aproximada, perturbación común, píxeles saturados, valores fuera del rango de calibración y perfiles centrales.

Una referencia sin irradiar de la misma geometría puede cargarse junto a la medida. Si se omite, se utiliza el `I0` medio guardado en la calibración; esta alternativa no corrige la falta de uniformidad espacial del escáner.

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

Las pruebas generan un TIFF RGB de 16 bits, verifican el cálculo con imagen completa y con ROI, ajustan una calibración sintética, reconstruyen un mapa con perturbación común conocida y vuelven a leer un RT Dose para comprobar geometría, escala y referencias.

## Límites actuales

- No hay registro automático, corrección lateral del escáner ni corrección de orientación de la película distinta a la etiqueta TIFF.
- No se extrapola fuera del rango calibrado: esos píxeles se marcan y la dosis se limita al intervalo disponible.
- La incertidumbre mostrada es local y derivada del ajuste/covarianza; no es un presupuesto completo de incertidumbre.
- La exportación representa un solo plano y solo ofrece la semántica de suma `PLAN`.
- No se realiza comparación gamma con una distribución de referencia.
