# Estudio — Anonimizador de estudios de Radioterapia (CT + RTSTRUCT + RTPLAN + RTDOSE)

> Módulo nuevo, 100 % en el navegador (sin servidor, sin subir nada). Se arrastra un
> estudio completo, se indican los nuevos datos de cabecera y se descarga un ZIP con
> los objetos DICOM anonimizados manteniendo todas las referencias internas intactas.

Fecha del estudio: 2026-06-19 · Basado en **DICOM PS3.15 Anexo E (Basic Application
Confidentiality Profile)** + reglas específicas para objetos RT.

---

## 1. Objetivo y alcance

**Entrada:** un estudio de radioterapia formado por cualquier combinación de:

| Objeto | SOP Class UID | Modality | ¿PixelData? |
|---|---|---|---|
| CT Image Storage | `1.2.840.10008.5.1.4.1.1.2` (+ Enhanced `.2.1`) | CT | Sí (varios cortes) |
| RT Structure Set Storage | `1.2.840.10008.5.1.4.1.1.481.3` | RTSTRUCT | No |
| RT Plan Storage | `1.2.840.10008.5.1.4.1.1.481.5` | RTPLAN | No |
| RT Dose Storage | `1.2.840.10008.5.1.4.1.1.481.2` | RTDOSE | Sí (grid 3D) |
| *(opcional)* RT Image / RT Record | `…481.1` / `…481.4` | RTIMAGE/RTRECORD | depende |

**Salida:** los mismos objetos, con la identidad reemplazada y **todos los UID
regenerados de forma consistente**, de modo que el estudio siga siendo navegable y
geometricamente coherente (los contornos siguen sobre el CT, el plan sigue apuntando
a las estructuras, la dosis sigue asociada al plan).

**No es objetivo de esta fase:** anonimizar PixelData (burned-in PHI) ni manejar
SR/SEG u otros objetos fuera de la tríada RT + CT.

---

## 2. El reto central: los UID están cruzados entre objetos

Esta es la parte delicada que pediste estudiar. En un estudio RT, los UID no se
repiten solo como identidad de cada objeto: **aparecen referenciados unos dentro de
otros**. Cambiarlos unilateralmente rompe el estudio.

### 2.1 Grafo de referencias (qué apunta a qué)

```
                     ┌──────────────────────────────────────────────┐
                     │            Frame of Reference UID            │  ← (0020,0052)
                     │   lo comparten CT + RTSTRUCT (+RTPLAN vía FOR)│
                     └───────────────▲───────────────────▲──────────┘
                                     │                   │
   RTDOSE ──(RefRTPlan)──────────► RTPLAN ──(RefStructSet)──► RTSTRUCT ──(ContourImageSeq)──► CT slices
     │                              │                          │                                 │
     └─ RefSOPClass+Instance ───────┘                          └─ RTReferencedSeriesSeq ──► SeriesInstanceUID del CT
                                                                ReferencedFrameOfReferenceUID ──► FOR
```

Concretamente, el mecanismo DICOM universal de referencia es un **ítem de secuencia**
con dos elementos `UI`:

- `(0008,1150)` **ReferencedSOPClassUID** → constante (clase del objeto apuntado). **No se toca.**
- `(0008,1155)` **ReferencedSOPInstanceUID** → UID de la instancia apuntada. **Hay que reasignar**.

Y apariciones de UID sueltos que también enlazan:

- `(0020,000D)` StudyInstanceUID — común a **todo** el estudio.
- `(0020,000E)` SeriesInstanceUID — CT, RTSTRUCT, RTPLAN y RTDOSE tienen series distintas,
  pero RTSTRUCT referencia la serie del CT vía `RTReferencedSeriesSequence (3006,0014)`.
- `(0020,0052)` FrameOfReferenceUID — enlace geométrico CT↔RT.
- `(3006,0024)` ReferencedFrameOfReferenceUID — RTSTRUCT → FOR.
- `(0008,1115)`… dentro de `ReferencedImageSequence (0008,1140)`, `SourceImageSequence (0008,2112)`,
  `ContourImageSequence (3006,0016)` → apuntan a los cortes de CT.
- `(300C,0060)` ReferencedStructureSetSequence → RTPLAN apunta a RTSTRUCT.
- `(300C,0002)` ReferencedRTPlanSequence → RTDOSE apunta a RTPLAN.
- `(300C,0080)` ReferencedDoseSequence → RTPLAN apunta a RTDOSE.
- `MediaStorageSOPInstanceUID (0002,0003)` del meta del archivo — **debe coincidir** con el
  `SOPInstanceUID (0008,0018)` del propio objeto (se remapean a la par).

### 2.2 UID que NO se deben tocar (constantes estándar)

Estos identifican *tipos*, no instancias, y se rompería el objeto si cambian:

- `(0008,0016)` SOPClassUID y `(0002,0002)` MediaStorageSOPClassUID (`1.2.840.10008…`)
- `(0002,0010)` TransferSyntaxUID (`1.2.840.10008.1.2.x`)
- `(0008,1150)` ReferencedSOPClassUID.
- `(0008,010C)` CodingSchemeUID y UIDs de clase como `(0008,001A)` / `(0008,001B)`.
- Cualquier UID estándar DICOM bajo el arco `1.2.840.10008.*`, porque identifica
  clases, sintaxis, esquemas de codificación o recursos estándar, no pacientes.

Los UID nuevos se generan como `2.25.<entero>` mediante `dcmjs.DicomMetaDictionary.uid()`.
No pueden contener texto como `anon` porque un UID DICOM solo admite dígitos y puntos;
por eso la marca visible se escribe en `(0012,0063) DeidentificationMethod` como
`ANON_UID_REMAP_2.25_UUID_OID`.

### 2.3 Estrategia de remapeo consistente

1. **Recoger constantes** de todos los archivos: valores de `(0008,0016)`, `(0002,0002)`,
   `(0002,0010)` → set `CONSTANTS` (se preservan tal cual).
2. **Construir tabla global** `oldUID → newUID` **única para todo el estudio**, añadiendo:
   - UID de identidad: Study, Series, SOPInstance, MediaStorageSOPInstance, FrameOfReference.
   - UID de referencia: ReferencedSOPInstanceUID, ReferencedFrameOfReferenceUID.
   - Otros UID generados por el escáner: `InstanceCreatorUID (0008,0014)`, etc.
   - Cada UID nuevo se genera con `2.25.<entero de 128 bits (UUID)>` (esquema libre, válido,
     que ya usa `dcmjs.DicomMetaDictionary.uid()`).
3. **Aplicar la tabla** recorriendo **todos** los elementos del dataset (incluidas las
   secuencias anidadas y el grupo `0002` de meta): para cada elemento `UI`, si su valor
   está en `CONSTANTS` → se deja; si está en la tabla → se reemplaza; en caso contrario
   se genera un nuevo UID al vuelo. El recorrido es **por VR (`UI`)**, no por nombre de tag,
   así que cualquier referencia nueva o inesperada se trata igual.

> Como la tabla es compartida por los 4 objetos, el RTPLAN seguirá apuntando al RTSTRUCT
> correcto, el RTSTRUCT a los cortes CT correctos, etc. **Sin excepciones manuales por tag.**

---

## 3. Inventario de datos identificadores (PHI) a tratar

Basado en la lista `tagNamesToEmpty` de `dcmjs.anonymizer` (que reproduce el perfil de
CTP/PS3.15), filtrada y adaptada para no romper RT.

### 3.1 Identidad del paciente
- `(0010,0010)` PatientName **→** nombre nuevo que indique el usuario (formato DICOM `Apel^Nombre`).
- `(0010,0020)` PatientID **→** ID nuevo (por defecto derivado del nombre).
- `(0010,0030)` PatientBirthDate **→** borrar.
- `(0010,0032)` PatientBirthTime, `(0010,1005)` PatientBirthName, `(0010,1001)` OtherPatientNames,
  `(0010,1060)` PatientMotherBirthName **→** borrar.
- `(0010,0040)` PatientSex **→** borrar por defecto; configurable.
- `(0010,1010)` PatientAge, `(0010,1020)` PatientSize, `(0010,1030)` PatientWeight **→**
  borrar por defecto conforme a PS3.15; configurable si el usuario acepta retener
  características clínicas.

### 3.2 IDs y localizadores secundarios
- `(0008,0050)` AccessionNumber, `(0020,0010)` StudyID, `(0008,0051)`… Issuer **→** borrar.
- `(0010,21…)` OtherPatientIDs* / sequences **→** borrar.
- `(0010,1090)` MedicalRecordLocator, `(0010,2000)`… MedicalAlerts, Allergies, Address,
  Telephone, EthnicGroup, Occupation, Country/RegionOfResidence, AdditionalPatientHistory,
  PregnancyStatus, LastMenstrualDate, ReligiousPreference, ResponsiblePerson/Organization,
  PatientComments **→** borrar.

### 3.3 Fechas y horas (DA / TM / DT)
El usuario quiere fijar la **fecha del estudio** (por defecto la de hoy). Política:
- **Se fijan a la fecha/hora nueva:** StudyDate/Time `(0008,0020/30)`, SeriesDate,
  ContentDate/Time, AcquisitionDate/Time `(0008,0022/32)`, InstanceCreationDate/Time
  `(0008,0012/13)`, RTPlanDate/Time `(300A,0006/7)`, StructureSetDate/Time `(3006,0008/9)`.
- **Se borran:** PatientBirthDate y cualquier otra fecha/timestamp que no sea de estudio
  (DateOfLastCalibration, FrameAcquisitionDatetime, VerificationDateTime, *…Datetime*,
  fechas de admisión/alta, etc. — ya están en la lista `tagNamesToEmpty`).
- *(Opcional futuro)* desplazamiento relativo (date-shift) en lugar de fijar — no para esta versión.

### 3.4 Institución, médicos y operadores
Identifican institución/equipo/persona → borrar:
- `(0008,0080)` InstitutionName, `(0008,0081)` InstitutionAddress, `(0008,1040)`
  InstitutionalDepartmentName, secuencias InstitutionCodeSequence.
- `(0008,0090)` ReferringPhysicianName + su dirección/teléfono/secuencia de IDs.
- `(0008,1050)` PhysiciansOfRecord, `(0008,1060)` PhysicianOfRecord, `(0008,1048)`
  PerformingPhysicianName, `(0008,1062)` PerformingPhysician, `(0008,1040)`…
  `(0008,1060)` NameOfPhysicianReadingStudy, etc. y sus secuencias de identificación.
- `(0008,1070)` OperatorsName + `OperatorsIdentificationSequence`.
- `(0002,0016)` SourceApplicationEntityTitle (AE del origen) **→** borrar.

### 3.5 Equipo / serie / estación
- `(0008,1010)` StationName, `(0018,1000)` DeviceSerialNumber, `(0018,1005)` DeviceID,
  `(0018,1007)` CassetteID, `(0018,1008)` GantryID, `(0018,1004)` PlateID, `(0018,1003)`
  GeneratorID **→** borrar (pueden identificar equipo/institución).
- `SoftwareVersions`, `(0018,1020)`, `Manufacturer` y `ManufacturerModelName` → borrar
  por defecto para reducir fingerprinting de centro/equipo; configurable con la opción
  “conservar identidad de equipo”.
- `TreatmentMachineName` se sustituye por `LINAC` salvo que se active la retención de
  identidad de equipo.

### 3.6 Textos libres (pueden contener PHI escrita a mano)
- `(0008,1030)` StudyDescription, `(0008,103E)` SeriesDescription, `(0020,4000)`
  ImageComments, `(0008,4000)` IdentifyingComments, `(0008,2111)` DerivationDescription,
  `(0040,A073)`… y comentarios de estudio/admisión/visita **→** borrar por defecto
  (configurable “conservar descripciones”).
- Por defecto se **sanitizan/sustituyen** los descriptores clínicos potencialmente libres:
  `StructureSetLabel → RTSTRUCT`, `RTPlanLabel → PLAN`, `ROIName → ROI_<ROINumber>` y
  `BeamName → BEAM_<BeamNumber>`. Esto evita PHI escrita en labels sin romper Type 1/2.
- El usuario puede activar “conservar descriptores” si necesita mantener nombres clínicos
  originales y acepta revisar manualmente el riesgo de PHI.
- Se conservan datos técnicos no textuales como `(3004,0002) DoseUnits`, geometría y dosis.

### 3.7 Tags privados (grupos impares)
Los elementos privados (group `gggg` impar) suelen llevar PHI o datos de fabricante.
Política por defecto: **eliminar TODOS los tags privados** del dataset (recorrido de
grupo impar). Configurable (avanzado: retener “safe private”).

### 3.8 Secuencias de referencia — ¡NO borrarlas, remapearlas!
La lista original de `dcmjs` vacía `ReferencedImageSequence`, `SourceImageSequence`,
`ReferencedStudySequence`, etc. **Para RT eso es peligroso**: mejor **conservar la
secuencia y solo remapear los UID que contiene**. Por eso no usamos `cleanTags` a
ciegas: hacemos nuestro propio recorrido que conserva la estructura y remapea por VR.

---

## 4. Preservación de PixelData (crítico)

- CT y RTDOSE llevan PixelData grande que **debe quedar byte-a-byte intacto**.
- Trabajamos siempre sobre el objeto crudo que devuelve `dcmjs.data.DicomMessage.readFile()`
  (forma `{tag:{vr,Value}}`). Solo editamos/eliminamos elementos concretos y **nunca
  tocamos `(7FE0,0010) PixelData`**. Al llamar a `dicomData.write()` los píxeles se
  reescriben idénticos (también para encapsulado/JPEG, que `dcmjs` reproduce).
- Para CT comprimido (transfer syntaxes de JPEG/JPEG-LS/JPEG-XL/HTJ2K) el soporte
  depende de que `dcmjs.write()` reproduzca los fragmentos encapsulados: en la práctica
  los CT de RT suelen venir en Explicit VR Little Endian (sin comprimir). Se avisa al
  usuario si se detecta un Transfer Syntax comprimido.
- La implementación calcula un CRC32 del `PixelData` antes y después de escribir cada
  objeto con píxeles; si cambia, lo informa como error de QA.

---

## 5. Lo que se conserva (no es PHI y es necesario clínicamente)

- Geometría: `ImagePositionPatient`, `ImageOrientationPatient`, `PixelSpacing`,
  `SliceThickness`, `GridFrameOffsetVector`, `FrameOfReferenceUID` (remapeado pero coherente).
- Dosis: `DoseGridScaling`, `DoseUnits`, `DoseSummationType`, grid, `PixelData` de RTDOSE.
- Plan: MU por haz, ángulos, energías, MLC, número de fracciones, dosis prescrita.
- Nombres de haz y estructura se conservan solo si el usuario activa “conservar
  descriptores”; por defecto se sustituyen por `BEAM_<n>` y `ROI_<n>`.
- Nombres de estructuras y haces (ver §3.6).

---

## 6. Riesgos y limitaciones

1. **PHI “quemada” en píxeles** (burned-in): un CT/RTDose puede llevar texto superpuesto.
   Este módulo no la detecta — responsabilidad del usuario revisar visualmente.
2. **CT comprimido**: si el Transfer Syntax no es little-endian sin comprimir, la
   reescritura puede fallar. Se advertirá y, si procede, se propondrá dejar el objeto tal
   cual (solo cabeceras) o rechazarlo.
3. **Referencias externas** que apunten a objetos que el usuario **no incluyó** en el drop:
   se remapean igualmente (consistencia interna) pero quedarán huérfanas respecto al
   objeto real (que conserva su UID original en otro sitio). Se mostrará un aviso listando
   UID referenciados que no aparecen como instancia en el estudio.
4. **Memoria**: un estudio RT puede pesar cientos de MB. La versión implementada mantiene
   buffers originales, objetos parseados y salidas antes de crear un ZIP STORE-only en
   memoria. No es streaming ni Zip64. Se rechazan ZIPs clásicos inválidos (>65535 archivos,
   archivo >4 GiB o ZIP total >4 GiB), pero estudios grandes pueden agotar memoria del
   navegador.
5. **Privados “útiles”**: algunos vendors guardan geometría/escalado en privados. Borrar
   privados es lo seguro para anonimizar; se puede perder metadata no estándar. Es el
   compromiso habitual y se avisa en la UI.

---

## 7. Arquitectura propuesta (dentro del proyecto)

| Pieza | Ruta | Responsabilidad |
|---|---|---|
| Lógica pura (testable sin UI) | `src/utils/dicomAnonymizer.js` | parse+edita+escribe por archivo; tabla de UID compartida; perfil PHI. |
| ZIP / descarga | `src/utils/zipDownload.js` | empaqueta los `ArrayBuffer` y dispara la descarga. |
| Página React | `src/pages/RtAnonymizer.jsx` | drop zone multi-archivo/carpeta, panel de parámetros, vista previa, botón ejecutar. |
| Estilos | `src/styles/rt-anonymizer.css` | look consistente con el resto (variables Nord). |
| Ruta + nav | `src/App.jsx` + `src/components/Sidebar.jsx` | `/rt-anonymizer`, icono `bi-shield-lock`. |

### Dependencias
- **ZIP en navegador**: se implementó un ZIP STORE-only propio (`src/utils/zipDownload.js`),
  sin compresión ni dependencias. Conserva rutas relativas seguras dentro del ZIP, usa
  nombres UTF-8 y valida límites de ZIP clásico; no implementa streaming ni Zip64.
- `dcmjs` ya incluido: usa `DicomMessage.readFile/write`, `DicomMetaDictionary.uid()`,
  `nameMap` (keyword→tag/vr) y `anonymizer.getTagsNameToEmpty()` como base de la lista PHI.

### Algoritmo (dos pasadas, tabla compartida)
```
1. leer todos los archivos -> Array<{name, buffer}>
2. PARSE 1 (reconocimiento): por cada archivo
     - dicomData = DicomMessage.readFile(buffer)
     - extraer SOPClassUID -> clasificar (CT/RTSTRUCT/RTPLAN/RTDOSE)
     - extraer Study/Series/SOPInstance/MediaStorageSOP/FrameOfReference + constantes
3. construir CONSTANTS + mapa oldUID->newUID (añadir Referenced* de pasada 4 si faltan)
4. PARSE 2 (anonimizar y escribir): por cada archivo
     - recorrer dict+meta recursivo:
         · VR=UI  -> remapear (constante | tabla | generar)
         · grupo impar -> eliminar (privados)
         · tag PHI de la lista -> borrar o reemplazar (nombre/ID/fecha nuevos)
     - NUNCA tocar PixelData (7FE00010)
     - outBuffer = dicomData.write()
     - alimentar al ZIP
5. descargar ZIP (mismos nombres, opcional sufijo _anon)
```

### UI (lo que pediste)
- **Drop zone** grande: archivos `.dcm/.ima/.dicom` **o carpeta** arrastrada
  (`webkitdirectory` + `DataTransferItem` para carpetas).
- Listado de objetos detectados con su tipo (badge CT/RTSTRUCT/RTPLAN/RTDOSE), nº de
  instancias y avisos (CT comprimido, refs externas).
- **Panel de parámetros** (“pestaña”/acordeón):
  - Nombre del paciente nuevo (texto, se sugiere `Anon^Anon`).
  - ID nuevo (se autocompleta del nombre).
  - Fecha de estudio (`<input type=date>`, por defecto hoy) y hora (por defecto `00:00:00`).
  - Opciones: conservar descripciones, conservar sexo/peso/talla, conservar privados (off por defecto).
- **Botón Ejecutar** → genera el ZIP y dispara la descarga. Barra de progreso por archivo.
- Todo en cliente; nada se sube.

---

## 8. Plan de implementación (pasos)

> Estado 2026-06-19: implementación completada en `/rt-anonymizer`, con revisión externa
> de Claude documentada en `DICOM_RT_ANON_IMPLEMENTATION_REVIEW_CLAUDE.md` y correcciones
> aplicadas para UID constantes, hardening PHI, descriptores RT, hash de PixelData y límites ZIP.

1. `npm i jszip` (o escribir `zipDownload.js` STORE-only).
2. `src/utils/dicomAnonymizer.js`: perfiles + remapeo UID + escritura (funciones puras,
   asertables con Node).
3. `src/utils/zipDownload.js`: empaquetado + descarga.
4. `src/pages/RtAnonymizer.jsx` + `src/styles/rt-anonymizer.css`.
5. Registrar ruta `/rt-anonymizer` en `App.jsx` y enlace en `Sidebar.jsx`.
6. `npm run build` como chequeo de integración; aserciones Node sobre `dicomAnonymizer.js`.
7. Documentar en `AGENTS.md` el nuevo módulo y esta guía.

---

## 9. Validación funcional mínima (caso de prueba)

Con un estudio RT real de 4 objetos:
- Tras anonimizar: ningún UID original queda en ningún archivo (busca el StudyInstanceUID
  viejo → 0 ocurrencias).
- `MediaStorageSOPInstanceUID` del meta == `SOPInstanceUID` del dataset en cada archivo.
- Las referencias siguen resolviendo: RTPLAN.ReferencedStructureSetSequence.ReferencedSOPInstanceUID
  == RTSTRUCT.SOPInstanceUID; RTDOSE.ReferencedRTPlanSequence → RTPLAN; RTSTRUCT.ContourImageSequence
  → cortes CT; todos los objetos comparten el mismo StudyInstanceUID y FOR remapeados.
- Un visor DICOM cualquiera (p.ej. OHB/3D Slicer) abre el estudio anonimizado como un
  estudio coherente (cortes, estructuras sobre el CT, dosis sobre el plan).

---

## 10. Revisión externa y correcciones (Claude Opus 4.6 + Codex gpt-5.5)

> Ambos dictámenes íntegros se conservan en `DICOM_RT_ANON_REVIEW_CLAUDE.md` y
> `DICOM_RT_ANON_REVIEW_CODEX.md`. **Consenso:** la estrategia de remapeo por VR=`UI`
(es recursiva, entra en secuencias anidadas y en el grupo `0002`) es correcta y superior
a recorrer por lista de tags. Las correcciones que **actualizan** la política de las
secciones 3/4/6 son las siguientes.

### 10.1 Lo que HAY QUE AÑADIR (lo más crítico, me lo salté)

- **Marcar el objeto como de-identificado (PS3.15 lo exige):** escribir
  `(0012,0062) PatientIdentityRemoved = YES`, `(0012,0063) DeidentificationMethod`
  (texto descriptivo) y, opcional, `(0012,0064) DeidentificationMethodCodeSequence`
  (CID 7050). Sin esto, el estudio no es “PS3.15 Basic” formalmente.
- **Nombres de persona (PN) DENTRO de secuencias RT** (no aparecen como tags sueltos):
  - `(300E,0008) ReviewerName`, `(300E,0004/0005) ReviewDate/Time` (quién aprobó el plan).
  - `(3006,00A6) ROIInterpreter` y las secuencias `(3006,004D) ROICreatorSequence`,
    `(3006,004E) ROIInterpreterSequence` (médico que delineó).
  - `(0008,1070) OperatorsName` dentro de `TreatmentSessionBeamSequence` (si se acepta RTRECORD).
  → El QA final debe escanear **todos los VR=PN** residuales.
- **PHI duplicada dentro de secuencias de equipo** (el recorrido por tag de primer nivel
  NO la ve; hay que entrar en las SQ):
  - `(0018,A001) ContributingEquipmentSequence` → copia propia de InstitutionName,
    StationName, DeviceSerialNumber, SoftwareVersions, InstitutionName/Address.
  - `(300A,00B2)→` `TreatmentMachineSequence` items → `(0008,1010) StationName`,
    `(0008,0080) InstitutionName`, `(0008,1040) InstitutionalDepartmentName` (Varian/Elekta).
  - `ReferencedPatientSequence (0008,1120)` → borrar la SQ entera, no solo remapear.
- **Grupo ensayo clínico completo** `(0012,0010-0084)` (Sponsor/Protocol/Site/Subject/…),
  salvo los tres tags que añadimos nosotros en §10.1 primero.
- **File meta + preámbulo:** reemplazar los 128 bytes de preámbulo y limpiar del grupo
  `0002`: `(0002,0012) ImplementationClassUID`, `(0002,0013) ImplementationVersionName`,
  `(0002,0016/0017/0018)` AE titles de origen/destino, `(0002,0100/0102) PrivateInformation*`.
  Conservar `(0002,0002)` SOPClass, `(0002,0003)` MediaStorageSOPInstance (remapeado =
  `(0008,0018)`), `(0002,0010)` TransferSyntax.
- **Overlays / gráficos / iconos** (no mencionados en §3; posible leak): grupos `60xx`
  (`(60xx,3000) OverlayData`, `(60xx,0022) OverlayDescription`, `(60xx,1500) OverlayLabel`),
  `(0070,0001) GraphicAnnotationSequence`, `(0070,0006) UnformattedTextValue`,
  `(0088,0200) IconImageSequence`. Ojo: los contornos RT `(3006,0050)` **NO** son overlays
  y se conservan.
- **No declarar `BurnedInAnnotation`/`RecognizableVisualFeatures`** `(0028,0301/0302)` en
  `NO` salvo inspección/limpieza real de píxeles (PS3.15 lo exige para esa opción).
- **DICOMDIR + nombres de archivo del ZIP** y grupo `(0004,xxxx)`: regenerar/sanitizar.

### 10.2 Cambios de política por defecto (más restrictivo que la versión inicial)

- **Descriptores RT = principal fuente residual de PHI.** Cambiar el *default* a
  **sanitizar/sustituir** (no “conservar”): `StructureSetLabel/Description (3006,0002/0006)`,
  `RTPlanLabel/Name/Description (300A,0002/0003/0004)`, `ROIName/ROIDescription
  (3006,0026/0028)`, `ROIObservationLabel/Description (3006,0085/0088)`, `BeamName/
  BeamDescription (300A,00C2/00C3)`, `DoseComment (3004,0006)`, `TreatmentProtocols
  (300A,0009)`, `TreatmentSites (300A,000B)`, `PrescriptionDescription (300A,000E)`,
  `DoseReferenceDescription (300A,0016)`, setup/bolus/brachy descriptors
  (`(300A,0184/0194/0196/0198/01A4/01A6/01A8/01B2/01B8/01BA/01D0/00DD)`, fuentes
  `(300A,0216/021B/021C/0236/0238/0244/0263/0266/0273/0291/0294/0298)`),
  `ProtocolName (0018,1030)`, `AcquisitionProtocolName/Description (0018,9423/9424)`,
  `StudyDescription/SeriesDescription (0008,1030/103E)`, `DerivationDescription
  (0008,2111)`, `ImageComments (0020,4000)`. Motivo: muchos centros ponen el apellido/
  iniciales del paciente en estos campos.→ Ofrecer toggle “conservar descriptores clínicos”
  (off por defecto) + aviso UI para que el usuario revise labels.
- **Huella de equipo:** por defecto también borrar `(0008,1090) ManufacturerModelName`,
  `(0008,0070) Manufacturer` y `(0018,1020) SoftwareVersions` (toggle “retener identidad
  de equipo”). Juntos pueden fingerprintar el centro.
- **Características del paciente:** por defecto alinearse con PS3.15 y **borrar**
  `(0010,0040) PatientSex`, `(0010,1010) PatientAge`, `(0010,1020) PatientSize`,
  `(0010,1030) PatientWeight`, `(0010,21B0) AdditionalPatientHistory`, `(0038,0500)
  PatientState` (toggle “retener características”, documenta que es desviación del Basic).

### 10.3 UID remapeo — confirmaciones y casos límite

- Recorrer **ambos** bloques de dcmjs (`meta` grupo 0002 **y** `dict`), recursivo por SQ.
- Preservar **solo** `(0008,0016)`, `(0002,0002)`, `(0002,0010)`. Remapear todo lo demás,
  incluyendo los UI específicos RT que cita Codex: `(300A,0013)`, `(300A,0054)`,
  `(300A,0609)`, `(300A,0650)`, `(300A,0700)`, `(3010,003B/006E)` (cubiertos por el
  recorrido por VR=UI, pero verificarlos en el QA).
- **Edge Implicit VR:** si el usuario activa “conservar privados”, los UID en privados
  declarados como VR=`UN`/`LO` en implicit little-endian NO se ven por VR=UI → añadir un
  *byte-scan* final de todos los UID originales (regex `1\.2\.` / `2\.25\.`) sobre la
  salida binaria. (Como el default es borrar privados, el riesgo queda mitigado.)
- **PixelData encapsulado:** no contiene UIDs; nunca editar fragmentos por búsqueda de UID.
- **Tipos Type 1/2 que son PHI** (`StructureSetLabel`, `RTPlanLabel`,
  `TreatmentMachineName`): **no eliminar** (rompe el IOD) → sustituir por valor válido
  genérico (p.ej. `RTSTRUCT`, `PLAN`, `LINAC`) o zero-length si el IOD lo permite.
- **RT Ion / Enhanced RT:** el recorrido agnóstico por VR=UI los cubre; **no declarar**
  soporte hasta validar con ejemplos reales (hay más UID/descriptores en `(3010,xxxx)`
  y secuencias profundas). Rechazar o procesar solo cabeceras con aviso.

### 10.4 QA reforzado (añadir al §9)

- Byte-scan de **0 ocurrencias** de: UID originales, PatientName/ID, AccessionNumber,
  StudyID, fechas/institución/AE/serial originales (sobre el binario de salida, no solo cabeceras).
- Listar **todos los VR=PN** residuales → deben ser vacíos o el nombre anonimizado
  (atrapa `ReviewerName`/`ROIInterpreter` anidados).
- Listar todos los **VR=DA/DT** → solo la fecha nueva o eliminados.
- Verificar `(0002,0003) == (0008,0018)` y preámbulo/meta reemplazados en cada archivo.
- Verificar ausencia de grupos impares (privados) y private creators.
- Hash/CRC de PixelData CT/RTDOSE **antes/después** (implementado; confirma que no cambió).
- Cargar en 3D Slicer: CT + RTSTRUCT alineados + dosis sobre el plan; inspección visual de
  scouts/RTIMAGE por texto quemado.
- Emitir **informe** por estudio: perfil PS3.15, opciones activadas, campos conservados por
  excepción y limitación explícita de PixelData.

### 10.5 Lista única de UIDs a preservar (constantes) vs remapear (consolidada)

- **Preservar tal cual:** `SOPClassUID (0008,0016)`, `MediaStorageSOPClassUID (0002,0002)`,
  `TransferSyntaxUID (0002,0010)`. (Cualquier otro `(0002,00xx)` UID del file meta se borra.)
- **Remapear (id↔referencias), recorr. por VR=UI:** `InstanceCreatorUID (0008,0014)`,
  `RelatedGeneralSOP (0008,1250)`, `OriginalSpecializedSOPClassUID (0008,1250b…)`,
  `SOPInstanceUID (0008,0018)`, `MediaStorageSOPInstanceUID (0002,0003)`,
  `StudyInstanceUID (0020,000D)`, `SeriesInstanceUID (0020,000E)`, `FrameOfReferenceUID
  (0020,0052)`, `ReferencedSOPInstanceUID (0008,1155)` (y todo `(0008,1155)` dentro de SQs),
  `ReferencedFrameOfReferenceUID (3006,0024)`, UIDs de segundo/tercer gen RT en `(300A/3010)`.
