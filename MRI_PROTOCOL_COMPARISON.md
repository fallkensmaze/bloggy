# Comparador de protocolos RM

Ruta: `/comparar-protocolos-rm`, en **Resonancia magnética → Comparar protocolos RM**.

Implementación independiente en JavaScript del flujo de inventario y comparación mostrado en las diapositivas de GIfMI. Referencia de formato: [declutter-mri-protocols](https://github.com/GIfMI/declutter-mri-protocols), Pullens et al., Physica Medica 120 (2024), 103342, DOI 10.1016/j.ejmp.2024.103342. No se incorpora código Python del proyecto.

## Uso

1. Exportar la impresión de protocolos Siemens en XML y cargar uno o varios archivos. Un XML sirve para revisar nombres repetidos; varios permiten comparar equipos o versiones.
2. **Entre equipos** cruza región, examen, programa y nombre; opcionalmente solo región y nombre. Cada celda muestra el número de entradas por archivo. Los emparejamientos ambiguos conservan todas sus entradas.
3. **Nombres repetidos** agrupa por archivo, región y nombre. Distingue parámetros exportados iguales, variantes y entradas no evaluables.
4. Seleccionar un grupo y elegir explícitamente A y B. Cada parámetro muestra ambos valores, además de campos presentes en un solo lado. Cambiar A/B invierte la lectura, sin recomendar cambios clínicos.
5. Excel contiene el inventario completo, los grupos del modo activo, el criterio y la comparación del par seleccionado. CSV contiene ese par. Los filtros visuales no recortan la exportación.

## Lectura y límites

- Formato Siemens `PrintTOC/TOC`, `region`, `NormalExam_dot_engine`, `program`, `Protocol`, `HeaderProtPath`, `HeaderProperty`, `Card`, `ProtParameter`. Se admite namespace XML y la disposición posicional de cabecera usada en el lector original.
- UTF-8, UTF-16 con BOM/detección y codificaciones declaradas que soporte TextDecoder.
- Valores textuales, recortando solo espacios exteriores. Sin conversión de unidades, tolerancias numéricas o normalización clínica. Las mayúsculas de los nombres/rutas son configurables; las de los valores siempre se conservan.
- Unión de parámetros de A y B. Un valor vacío difiere de un parámetro ausente. Los parámetros repetidos se conservan como listas ordenadas; no se sobrescriben.
- Id y ruta identifican la entrada; no determinan igualdad de parámetros. Las claves internas incluyen archivo y ordinal para conservar Id repetidos.
- Un índice sin cuerpo de parámetros, un parámetro mal formado o una secuencia incompleta impiden afirmar igualdad. Una igualdad en XML no implica equivalencia clínica ni cubre parámetros no exportados.
- Hasta 12 archivos, 25 MiB por archivo, 75 MiB en total y 10 000 entradas por archivo. No se generan todas las parejas posibles; se comparan los dos miembros seleccionados.
- DTD y entidades se rechazan. XML/valores se muestran como texto React. XLSX usa cadenas literales y CSV neutraliza fórmulas.
- Procesamiento en memoria en el navegador; sin envío de XML, almacenamiento persistente, nuevas APIs ni colecciones Firebase.
- Los ejemplos son sintéticos. No se ha aportado un XML real del equipo del usuario: verificar la primera importación contra su impresión original. GE/Philips requieren adaptadores propios.

## Verificación

`npm run test:mri`: comparación, agrupación, codificación y seguridad de las exportaciones.

`MRI_CHROME=google-chrome npm run test:mri:browser`: lector XML real de Chromium y flujo React con ficheros sintéticos. La variable puede apuntar a otro ejecutable Chromium instalado.

`npm run build`: integración completa (requiere wasm-pack para el simulador FDTD existente).
