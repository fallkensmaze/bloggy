He revisado los tres módulos de implementación, la UI, la integración de rutas, los tres documentos de diseño/revisión y he verificado el comportamiento real de `dcmjs` 0.50.1 en `node_modules`. Aquí está el informe.

---

# Informe de revisión — Anonimizador de estudios RT

**Veredicto: correcto con reservas.** La arquitectura central (remapeo de UID por VR=`UI`, tabla global única, borrado recursivo por nivel) es sólida y, en los puntos que más temías —consistencia de referencias y preservación de PixelData/constantes— es **correcta**. Las reservas son: (a) un par de huecos PHI concretos y demostrables, (b) un remapeo de UID que es *demasiado* agresivo en algunos casos límite, (c) una conformancia Type 2 dudosa y un default clínicamente destructivo, y (d) afirmaciones de memoria del doc que el código no cumple.

Ningún hallazgo es **Crítico** (no rompe el estudio ni filtra el nombre/ID/UID principal). Hay varios **Altos/Medios** que conviene corregir antes de considerarlo "listo para producción".

---

## 1. Remapeo de UID: consistencia y referencias — **CORRECTO** ✓

Confirmado leyendo `anonymizeStudy` (línea 419) y `processLevel` (línea 477):

- Hay **una sola** `table` (Map) compartida por todos los archivos (línea 423), aplicada **por valor** a cada elemento `VR=UI` de forma **recursiva** en `meta` y `dict` (líneas 538-541, 542-544). Esto garantiza que el mismo UID original → el mismo UID nuevo en todos los objetos.
- En consecuencia se preservan **automáticamente**: RTSTRUCT↔CT (`ContourImageSequence.ReferencedSOPInstanceUID` = `SOPInstanceUID` del corte), RTPLAN↔RTSTRUCT (`ReferencedStructureSetSequence`), RTDOSE↔RTPLAN (`ReferencedRTPlanSequence`), `FrameOfReferenceUID` compartido, y Study/Series/SOP.
- **`MediaStorageSOPInstanceUID (0002,0003)` == `SOPInstanceUID (0008,0018)`** se mantiene porque ambos parten del mismo valor original y pasan por la misma tabla. ✓ (Requisito que pedía explícitamente el doc §9).

La estrategia por VR (no por nombre de tag) es la correcta y es agnóstica a RT Ion / Enhanced RT, como bien señalaron ambos revisores previos.

## 2. ¿UID mal remapeados o constantes mal preservadas?

Aquí está el primer fallo real. `CONSTANT_POSITIONS` (líneas 87-92) preserva constantes **por posición de tag**, sólo cuatro: `SOPClassUID`, `MediaStorageSOPClassUID`, `TransferSyntaxUID`, `ReferencedSOPClassUID`. El problema es que hay UIDs **constantes por valor** que viven en otros tags `VR=UI` y que el código **remapeará indebidamente**:

- **[Medio] `(0008,010C) CodingSchemeUID`** — si un objeto usa un esquema de codificación con UID (p. ej. DCM = `1.2.840.10008.2.16.4`), `remap` (línea 424) le genera un UID `2.25.x` nuevo → rompe el concepto codificado. En RT aparece en secuencias de códigos de ROI/observación y dose-reference.
- **[Medio] `(0008,001A) RelatedGeneralSOPClassUID`, `(0008,001B) OriginalSpecializedSOPClassUID`** — contienen UIDs de **clase** (constantes) y no están en `CONSTANT_POSITIONS` → se remapean mal. Raros en la tríada, posibles en objetos derivados.
- **Well-known SOP/FoR UIDs** del arco `1.2.840.10008.*` (atlas estándar, color palettes) — mismo problema.

**Recomendación:** además de las 4 posiciones, tratar como constante cualquier valor que empiece por `1.2.840.10008.` **y** no haya sido recolectado como UID de instancia/estructura del estudio (o, más simple y seguro, una whitelist explícita de well-known UIDs + `CodingSchemeUID`).

En el otro sentido (UID que **debería** remapearse y no se hace): los UID alojados en `VR=UN` (privados o tags desconocidos en Implicit VR) **no** los ve el filtro `el.vr === 'UI'`. Está mitigado porque los privados se borran por defecto, pero con `keepPrivateTags` activado quedan **UID originales sin remapear**, y `scanForLeaks` (línea 580) sólo **avisa**, no corrige. Es coherente con lo que ya anticipaban los revisores.

## 3. Riesgos de `dd.write()` — **bajo riesgo, verificado** ✓ (con una salvedad)

Verifiqué el `DicomDict.write()` real de dcmjs 0.50.1 (build, líneas ~11283-11296):

- **Reescribe siempre un preámbulo de 128 bytes a cero + "DICM"** → el preámbulo (posible PHI según PS3.15) queda limpio sin que tu código haga nada. ✓
- **Recalcula `FileMetaInformationGroupLength (0002,0000)`** con el tamaño real del meta → borrar `ImplementationClassUID`, AE titles, etc. del grupo `0002` (`META_DELETE`, líneas 200-210) es **seguro**, no deja longitud de grupo obsoleta. ✓
- El dataset se reescribe con **la Transfer Syntax original** (`this.meta[TransferSyntaxUID]`), así que **no recomprime ni cambia la sintaxis**, y `PixelData (7FE00010)` se salta explícitamente (líneas 484, condición `continue`). ✓

**Salvedad [Medio]:** para PixelData **encapsulado** (CT/RTDOSE comprimido JPEG/JPEG-LS/HTJ2K) la fidelidad byte-a-byte depende de que dcmjs reescriba fragmentos + Basic Offset Table sin pérdida. El doc avisa al usuario (línea 312-318) pero **no hay verificación**. No existe comprobación de hash de PixelData pre/post, que ambos revisores pedían en el QA. Riesgo concreto: un viewer abre el CT comprimido reescrito y los píxeles difieren. **Recomendación:** hash SHA/CRC de `PixelData` antes (en `prepareStudy`) y después (sobre el buffer escrito), y emitirlo en el informe de QA.

## 4. Limpieza PHI — **un hueco Alto y un par de Medios**

Lo bueno primero (es bastante robusto):
- El borrado por VR=`PN` salvo `PatientName` (líneas 498-501) es un catch-all excelente: atrapa `ReviewerName (300E,0008)`, `ROIInterpreter (3006,00A6)`, `OperatorsName`, `Performing/Referring/PhysicianOfRecord`, etc. **anidados en secuencias**, que era el punto ciego principal de los revisores. ✓
- El borrado es **por nivel y recursivo**, así que `InstitutionName/StationName/DeviceSerialNumber` **duplicados dentro de secuencias** se eliminan también; `ContributingEquipmentSequence (0018,A001)` se borra entera (línea 127). ✓
- Fechas por VR=`DA/TM/DT` salvo las de estudio (líneas 527-529). ✓
- `(0012,0062)=YES` y `(0012,0063)` se añaden (líneas 574-575). ✓

**[Alto] La lista base PHI se trunca silenciosamente.** `BASE_DELETE` se construye con `baseNames.map(H).filter(Boolean)` (línea 75). La lista de dcmjs usa **keywords no estándar abreviados** que **no resuelven** en `DicomMetaDictionary.nameMap`, así que `H()` devuelve `undefined` y `.filter(Boolean)` los **descarta**. Lo verifiqué contra la lista real de dcmjs. El catch-all VR=PN rescata los nombres de persona y el VR=fecha rescata las fechas, pero **sobreviven identificadores que no son ni PN ni fecha**:

- AE Titles: `PerformedStationAETitle`, `ScheduledStationAETitle`, `ScheduledStudyLocationAETitle` (dcmjs los llama `…AET`).
- Teléfonos: `PatientTelephoneNumbers (0010,2154)` (dcmjs: `PatientPhoneNumbers`), `ReferringPhysicianTelephoneNumbers (0008,0094)` (dcmjs: `…PhoneNumbers`).
- Secuencias de identificación/estación: `…IdentificationSequence`, `…NameCodeSequence` (dcmjs: `…IdSeq`, `…NameCodeSeq`).

Son PHI de institución/contacto. Raros en exportaciones RT, pero el fallo es sistémico, no de un tag suelto. **Recomendación:** construir `BASE_DELETE` mapeando **por número de tag** (la lista de dcmjs es resolvible a tags) en vez de por keyword, o mantener una lista de hardening explícita por tag. Es un fix barato que cierra todo el grupo de una vez.

**[Medio] Borrado de descriptores Type 2 como ausencia, no como zero-length.** En `processLevel` los descriptores se **eliminan** del dict (línea 531). `ROIName (3006,0026)` es **Type 2** en el RT Structure Set IOD: debe estar **presente aunque vacío**. Eliminarlo por completo es no-conformante y algunos TPS/viewers rechazan o ignoran el ROI. Lo mismo aplica a otros Type 2 de la lista `DESCRIPTOR_NAMES`. **Recomendación:** para Type 2, poner `Value: ['']` en vez de `delete`.

**[Medio] El default destruye interpretabilidad clínica.** Con `keepDescriptors=false` (default) se **borran `ROIName` y `BeamName`** (líneas 174-177). Esos campos casi nunca son PHI ("PTV", "Médula", "LAO 45") y sin ellos el structure set y el plan quedan clínicamente ilegibles. Ambos revisores recomendaban *conservar con aviso* o *sanitizar*, no borrar a ciegas. **Recomendación:** separar "labels libres de objeto" (`RTPlanLabel/Name`, `StructureSetLabel/Description` → sustituir/avisar) de "nombres técnicos" (`ROIName`, `BeamName` → conservar con aviso UI).

## 5. `BurnedInAnnotation` / `RecognizableVisualFeatures` — **correcto como está** ✓

La herramienta **no** toca `(0028,0301)/(0028,0302)` ni declara `NO`. Es lo correcto: como no limpia píxeles, no debe afirmar que no hay PHI quemada (PS3.15 lo prohíbe). El aviso de la UI (líneas 414-417) ya responsabiliza al usuario de la inspección visual. **No cambiar.** Único matiz: si quisieras ser estricto, podrías *avisar* específicamente cuando `ImageType` contenga `LOCALIZER` (scouts), que es donde suele haber texto quemado.

## 6. ZIP y UI — **un Medio de memoria, dos Bajos**

**[Medio] El ZIP no es streaming, contradiciendo el doc.** El doc §6.4 promete "generamos el ZIP en flujo para no duplicar en RAM", pero `makeZip` aloja **todo el ZIP en un único `new Uint8Array(totalSize)`** (zipDownload.js línea 69), mientras simultáneamente se mantienen vivos `entry.buffer` (original), `entry.dd` (parseado, **con PixelData**) y todos los `outputs`. Pico de memoria ≈ 3-4× el tamaño del estudio. Un estudio RT de varios cientos de MB puede provocar **OOM en el navegador**. Además **no hay Zip64**: con >4 GB o >65535 archivos los offsets/contadores de 32 bits se desbordan → **corrupción silenciosa**. Para un estudio típico (<4 GB, cientos de cortes) funciona; conviene documentar el límite o trocear.

**[Bajo] Aplanamiento de carpetas.** `sanitizeName` (línea 646) reemplaza `/` y `\` por `_`, así que la jerarquía de carpetas del estudio se aplana en el ZIP. Aceptable (sin colisiones probables), pero algunos flujos esperan estructura.

**[Bajo] `scanForLeaks` es O(N_archivos × M_UIDs)** sobre strings del tamaño completo del archivo (incluye PixelData), con `latinToText` materializando cada archivo como string (líneas 614-621) → coste alto en estudios grandes. Y `check` con `needle.length >= 3` (línea 586) puede dar **falsos positivos** de partes de nombre cortas contra el ruido de PixelData.

UI en general correcta: acepta archivos sin extensión (sólo filtra `size>0`), drag&drop de carpetas vía `FileSystemEntry`, DICOMDIR se ignora con aviso (líneas 280-282) — razonable.

## 7. Pruebas mínimas recomendadas antes de "listo"

1. **Round-trip en un viewer real** (3D Slicer / OHIF): CT + RTSTRUCT alineados, dosis sobre plan, plan→struct→CT navegable. Es la prueba que valida toda la cadena de referencias de una vez.
2. **Hash de PixelData pre/post** en CT y RTDOSE (cubre el riesgo §3, especialmente si hay comprimido).
3. **Grafo de referencias cerrado:** script que verifique que todo `ReferencedSOPInstanceUID` de salida resuelve a un `SOPInstanceUID` de salida, y que `(0002,0003)==(0008,0018)` por archivo.
4. **Barrido VR=PN y VR=DA/DT residual** sobre la salida: deben ser vacíos / nombre anonimizado / fecha nueva. (Atrapa exactamente los huecos §4).
5. **Caso con `CodingSchemeUID` / contenido codificado** para confirmar el bug §2 antes/después del fix.
6. **Caso "conservar privados" + Implicit VR** para confirmar el comportamiento de UID en VR=UN (§2).
7. **Estudio grande (~300-500 cortes)** para medir pico de memoria y validar que el ZIP no se corrompe (§6).
8. **RTSTRUCT con un visor estricto** tras borrar `ROIName` para confirmar/descartar el problema Type 2 (§4).

## 8. Valoración final

**Correcto con reservas.** El núcleo —lo que pediste blindar— está bien: remapeo de UID global y consistente, referencias intactas, constantes de clase/sintaxis preservadas, PixelData no tocado, preámbulo y longitud de meta gestionados por dcmjs, marcado PS3.15 presente, y un catch-all VR=PN que cubre los nombres anidados de RT que suelen escaparse.

Severidad de hallazgos:

| Sev. | Hallazgo | Ref. |
|---|---|---|
| **Alto** | Lista base PHI truncada por keywords no resolubles; sobreviven AE Titles, teléfonos y *IdentificationSequence | dicomAnonymizer.js:74-84 |
| Medio | Constantes sólo por posición; `CodingSchemeUID` / `RelatedGeneralSOPClassUID` / well-known UIDs se remapean mal | :87-92, :424 |
| Medio | Sin verificación de integridad de PixelData (sobre todo encapsulado) | :449-455 |
| Medio | Descriptores Type 2 (`ROIName`) eliminados en vez de zero-length → no conformante | :531 |
| Medio | Default borra `ROIName`/`BeamName` → estudio clínicamente ilegible | :174-177 |
| Medio | ZIP no streaming + sin Zip64 → riesgo OOM / corrupción en estudios grandes | zipDownload.js:69 |
| Bajo | UID en VR=UN no remapeados con `keepPrivateTags` (sólo se avisa) | :580 |
| Bajo | Aplanamiento de carpetas; coste y falsos positivos en `scanForLeaks` | :586, :646 |

Prioridad de corrección: **§4 (lista PHI por tag)** y **§2 (constantes por valor)** primero, porque son los que afectan a la promesa central de "anonimiza todo lo identificante / no rompe lo constante"; luego §6 (memoria) y §4 Type 2/default si esto va a manejar estudios reales de pacientes.

---

Nota: hay dos ficheros temporales sin trackear en el repo (`.tmp_claude_impl_review_prompt.txt`, `.tmp_claude_impl_review_stderr.txt`); no los toqué, pero quizá quieras borrarlos antes de commitear. No modifiqué ningún archivo, como pediste.

---

## 9. Correcciones aplicadas tras esta revisión (2026-06-19)

Se implementaron las correcciones de mayor impacto y bajo riesgo:

1. **UID constantes adicionales / por valor**
   - Se preservan `CodingSchemeUID (0008,010C)`, `RelatedGeneralSOPClassUID (0008,001A)`, `OriginalSpecializedSOPClassUID (0008,001B)` y cualquier UID estándar bajo `1.2.840.10008.*`.
   - Los UID nuevos siguen el root válido `2.25.*` generado por `dcmjs.DicomMetaDictionary.uid()`.
   - Se añadió marca visible en `DeidentificationMethod`: `ANON_UID_REMAP_2.25_UUID_OID`.

2. **Hardening PHI explícito**
   - Se añadió una lista explícita de keywords actuales para cubrir huecos de la lista base de dcmjs: AE titles, teléfonos, direcciones, institución/departamento, emisores de ID, estación/localización, secuencias institucionales y datos de procedimientos/requests.
   - Se mantiene el borrado recursivo de todo `VR=PN` salvo `PatientName`.

3. **Descriptores RT Type 1/2**
   - `ROIName` ya no se elimina: se sustituye por `ROI_<ROINumber>`.
   - `BeamName` ya no se elimina: se sustituye por `BEAM_<BeamNumber>`.
   - `StructureSetLabel`, `RTPlanLabel` y `TreatmentMachineName` siguen sustituyéndose por valores genéricos (`RTSTRUCT`, `PLAN`, `LINAC`) cuando no se conservan descriptores/equipo.

4. **Verificación de PixelData**
   - Se calcula CRC32 de `PixelData` antes y después de `dd.write()`.
   - Si cambia, se informa como error QA.
   - La UI muestra cuántos PixelData fueron verificados.

5. **ZIP / rutas**
   - El ZIP conserva rutas relativas seguras y evita traversal.
   - Se añadieron errores explícitos para límites no soportados sin Zip64: >65535 archivos, archivo >4 GiB o ZIP total >4 GiB.

6. **UI**
   - La pantalla final muestra root `2.25.*` y ejemplos de UID anonimizados para verificar visualmente que cambiaron.

Pendiente/no implementado todavía:
- ZIP streaming / Zip64.
- Pruebas con estudios reales en 3D Slicer/OHIF.
- Soporte validado para objetos RT Ion / Enhanced RT más allá del recorrido genérico por VR=`UI`.
