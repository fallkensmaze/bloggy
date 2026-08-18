===== CLAUDE OPUS 4.6 (via stdin) =====
Documento leído. Ahora doy mi dictamen técnico.

---

## Dictamen técnico — Segunda opinión: Anonimización RT DICOM

### 1. PHI obligatorio que NO debe faltar

Tu lista cubre el grueso del Basic Profile PS3.15. Estas omisiones son críticas:

**PS3.15 obligatorio que falta o está implícito:**

| Tag | Keyword | Riesgo |
|---|---|---|
| `(0008,0014)` | InstanceCreatorUID | Mencionado en §2.3 pero no en §3 — es UI, se remapea, pero si codifica OID institucional (ej. `1.2.826.0.1.xxxxx`) reidentifica la institución. Confirma que se remapea siempre. |
| `(0008,0081)` | InstitutionAddress | Lo listas, OK. |
| `(0008,1010)` | StationName | OK, pero verifica que también limpias `(0008,1010)` **dentro de** `ContributingEquipmentSequence (0018,A001)` — aparece anidado en RTPLAN/RTDOSE de Varian y Elekta. |
| `(0008,1155)` dentro de `ReferencedPatientSequence (0008,1120)` | — | Si existe, la secuencia entera apunta a un Patient SOP Instance. Bórrala completa, no solo remapees el UID. |
| `(0010,0050)` | InsurancePlanIdentification | PHI en LATAM/EU. Borrar. |
| `(0010,1000)` | OtherPatientIDs | Lo mencionas con `(0010,21…)` pero el tag real es `(0010,1000)`. Confirma. |
| `(0010,1002)` | OtherPatientIDsSequence | Borrar toda la secuencia. |
| `(0012,0062)` | PatientIdentityRemoved | **Debes escribir `YES`** post-anonimización (PS3.15 exige). |
| `(0012,0063)` | DeidentificationMethod | **Debes escribir** una cadena descriptiva (ej. `"PS3.15 Basic Profile + RT retain"`). |
| `(0012,0064)` | DeidentificationMethodCodeSequence | Recomendado: incluir CID 7050 coded entry. |
| `(0038,0010)` | AdmissionID | No lo veo explícito. Borrar. |
| `(0038,0020)` | AdmittingDate | Borrar. |
| `(0038,0500)` | PatientState | Puede contener texto libre. Borrar. |
| `(0040,0006)` | ScheduledPerformingPhysicianName | Si existe en SQ de Scheduled Procedure Step. Borrar. |
| `(0040,0244/0245)` | PerformedProcedureStepStartDate/Time | Borrar. |
| `(0040,1001)` | RequestedProcedureID | Borrar. |
| `(0040,A123)` | PersonName (en SR/Content items) | Si algún CT Enhanced trae Content Sequence con VR=PN, limpiar. |
| `(4008,0114)` | PhysicianApprovingInterpretation | Retirado pero vendors lo escriben. Borrar. |

**PHI dentro de secuencias RT específicas (tu punto ciego principal):**

| Ubicación | Tag en secuencia | Riesgo |
|---|---|---|
| `TreatmentMachineSequence (300A,00B2)` → items | `(0008,1010)` StationName, `(0008,0080)` InstitutionName, `(0008,1040)` InstitutionalDepartmentName | Varian Eclipse escribe el nombre de la máquina como StationName aquí. **Es PHI institucional.** Tu recorrido por tag debe entrar en esta SQ. |
| `FractionGroupSequence` → `ReferencedBeamSequence` → `ReferencedBolusSequence` | `(300A,00DD)` BolusDescription | Texto libre, puede tener PHI. |
| `PatientSetupSequence (300A,0180)` → items | `(0018,5100)` PatientPosition está bien, pero `(300A,0184)` SetupTechniqueDescription y `(300A,01B2)` SetupDeviceDescription son texto libre. Borrar. |
| `ApprovalStatus (300E,0002)` + `ReviewerName (300E,0008)` | — | `ReviewerName` es **PN** — nombre del oncólogo que aprobó el plan. **Borrar.** `ReviewDate (300E,0004)` y `ReviewTime (300E,0005)` — borrar también. |
| `OperatorsName` dentro de `TreatmentSessionBeamSequence` | `(0008,1070)` | En RT Record, pero si aceptas RTRECORD, está ahí. |
| RTSTRUCT `ROIObservationsSequence (3006,0080)` → `ROIInterpreter (3006,00A6)` | — | **Es PN.** Nombre del médico que delineó. **Borrar.** |

**Vendors privados con PHI conocida:**

- **Varian (grupo `3243,xx`)**: `(3243,1001)` a menudo contiene el login del planificador. Borrar privados lo resuelve, pero documéntalo.
- **Elekta (grupo `0009,xx` / `3001,xx`)**: `(3001,xxxx)` puede contener el nombre del operador codificado.
- **Philips (grupo `2001,xx` / `7053,xx`)**: metadatos de reconstrucción. No suelen llevar PHI pero sí IDs de estación.
- Tu política de "borrar todos los privados" es correcta y es la más segura. No cambies esto.

---

### 2. Tags que planeas borrar pero que NO deberías (falsos positivos)

| Tag | Keyword | Veredicto |
|---|---|---|
| `(0008,1030)` StudyDescription | Generalmente seguro borrar, pero en investigación RT la descripción suele ser `"HEAD NECK IMRT"` — puramente clínica. **Ofrecer opción de conservar** (ya la tienes, bien). |
| `(0008,103E)` SeriesDescription | Mismo caso. En CT de planificación dice `"CT 2mm HEAD"`. Configurable OK. |
| `(0018,1020)` SoftwareVersions | **No es PHI.** Correcto que lo conservas. |
| `(0008,0060)` Modality | **Jamás borrar.** Verificar que no está en tu lista. |
| `(0020,0010)` StudyID | Lo borras. Cuidado: algunos visores lo usan para agrupar. Recomiendo sustituir por un valor genérico (`"1"`) en vez de vaciar. |
| `ReferencedStudySequence (0008,1110)` | PS3.15 dice borrar. **En RT es seguro borrar** porque las referencias operativas van por las SQ específicas de `300C`. No rompe nada. |

---

### 3. Tags que conservas y podrían reidentificar (falsos negativos)

| Tag | Keyword | Riesgo de reidentificación |
|---|---|---|
| `(0008,0070)` Manufacturer + `(0008,1090)` ManufacturerModelName | Bajo riesgo individual, pero combinado con geometría/fecha, reduce el anonimato set. **PS3.15 dice retirar ManufacturerModelName.** Recomiendo configurable, default borrar. |
| `(0018,1000)` DeviceSerialNumber | **Lo borras, correcto.** Solo confirma que también lo buscas dentro de `ContributingEquipmentSequence`. |
| `(0008,0080)` InstitutionName + `(0008,0081)` InstitutionAddress | Los borras. Pero verifica que también limpias dentro de `ContributingEquipmentSequence (0018,A001)` — tiene su propia copia. |
| `(300A,00B2)` → `InstitutionName` anidado | Ver punto 1 arriba. |
| `(0010,0040)` PatientSex + `(0010,1010)` PatientAge + `(0010,1030)` PatientWeight | Combinados con fecha de estudio y modalidad, en un dataset pequeño pueden reidentificar. **PS3.15 los marca para retirar.** Tu decisión de conservar es legítima si el uso es docencia/investigación interna con consentimiento, pero documenta que es una desviación del Basic Profile. |
| `StructureSetLabel (3006,0002)` / `RTPlanLabel (300A,0002)` | Muchos centros ponen el apellido del paciente como label (ej. `"GARCIA_HDRNK"`). **Recomiendo: avisar al usuario que revise estos campos, o sanitizarlos con el nuevo nombre.** |
| `RTPlanName (300A,0003)` / `RTPlanDescription (300A,0004)` | Mismo riesgo. Texto libre. |
| `(3006,0006)` StructureSetDescription | Texto libre, puede tener `"Plan para Juan García"`. Borrar. |
| `(3006,0026)` ROIName | Generalmente clínico (`"PTV"`, `"Médula"`) pero vendors como Pinnacle permiten nombres libres que a veces incluyen iniciales del paciente. **Avisar en la UI.** |
| `(300A,00C6)` BeamName | Mismo caso. Generalmente `"Beam 1"` o `"LAO 45"`, pero verificar. |

---

### 4. Errores y riesgos en el remapeo de UID

**¿Recorrer por VR=UI es suficiente?**

Es la estrategia más robusta y la correcta. Pero ojo con estos casos:

1. **UID codificados como VR=LO o VR=SH:** Algunos tags legacy o retirados almacenan UID como LO en vez de UI. Caso conocido: `(0020,0052)` siempre es UI, pero `(0040,E011)` RetrieveLocationUID puede aparecer como LO en datasets viejos. Riesgo bajo en RT, pero documentar.

2. **UID dentro de PixelData encapsulado:** No hay UIDs dentro de los fragmentos de píxeles. Los Offset Table items son binarios. No es un riesgo real.

3. **UID dentro de tags privados:** Si borras todos los privados (tu política), no hay riesgo. Si el usuario elige conservar privados, el recorrido por VR=UI **sí** entra en privados con VR declarado — pero en Implicit VR (Transfer Syntax `1.2.840.10008.1.2`) no hay VR explícito y `dcmjs` adivinará. Verifica que `dcmjs` asigna VR=UN a privados desconocidos en Implicit VR → esos UID se quedarían sin remapear. **Solución: si conservas privados, busca también por patrón de UID (`1.2.x` o `2.25.x`) en valores de VR=UN/LO.**

4. **`MediaStorageSOPInstanceUID (0002,0003)` vs `SOPInstanceUID (0008,0018)`:** Tu documento lo menciona. Punto clave: el grupo `0002` (File Meta) puede tener un VR distinto al del dataset si la Transfer Syntax del meta es siempre Explicit VR LE. `dcmjs` trata el meta separado (`meta` vs `dict`). **Asegúrate de recorrer AMBOS** (`_meta` y `dict` en el objeto de dcmjs).

5. **RT Ion Plan (`1.2.840.10008.5.1.4.1.1.481.8`) y RT Ion Beams Treatment Record:** Tienen las mismas secuencias de referencia que RTPLAN pero con tags `(300A,03A2)` IonBeamSequence en vez de `(300A,00B0)` BeamSequence. Tu recorrido por VR=UI es agnóstico al tag → **funciona igual.** Correcto.

6. **Enhanced RT (PS3.3 Supplement 175+):** Usa `EnhancedRTPlanStorage`, `RTRadiationSetStorage`, etc. Misma lógica de VR=UI aplica. Sin riesgo adicional si no filtras por SOP Class.

7. **`FrameOfReferenceUID` en `ReferencedFrameOfReferenceSequence (3006,0010)` de RTSTRUCT:** Tiene una **copia** del FOR UID en `(3006,0024)`. Tu recorrido por VR=UI lo cubre, pero verifica que no hay colisión en la tabla (el mismo UID viejo debe mapear al mismo nuevo).

8. **`RelatedFrameOfReferenceUID (3006,00C4)` dentro de `FrameOfReferenceRelationshipSequence (3006,00C0)`:** Si existe un registro de fusión/corregistro, tiene UIDs de otros Frame of Reference. Tu recorrido los remapeará, lo cual es correcto si todos los objetos están presentes; si no, quedarán huérfanos (tu §6.3 ya avisa).

9. **SQ items sin VR explícito:** En `DicomMessage.readFile`, `dcmjs` parsea recursivamente las secuencias. Confirma que tu recorrido recursivo entra en cada `Value[]` de elementos con `vr:"SQ"` hasta el fondo. No confíes en un `Object.entries` de primer nivel.

---

### 5. PHI quemada en píxeles / overlays

- **CT burned-in:** Scout/localizer images (`(0008,0008)` ImageType contiene `LOCALIZER`) a menudo tienen texto overlay con nombre/fecha/institución renderizado en los píxeles. **Recomendación: detectar scouts por ImageType y avisar explícitamente.**
- **Overlays (grupo `60xx`):** Tags `(60xx,3000)` OverlayData y `(60xx,0010-0100)` pueden contener gráficos con texto. **PS3.15 recomienda borrar grupos `60xx`.** Tu documento no los menciona. Si los conservas, advierte; si los borras, no pierdes nada clínico en RT (los overlays en CT de planificación son raros).
- **RTDOSE:** No tiene burned-in text. Sin riesgo.
- **RT Image (portal):** Si aceptas `RTIMAGE`, **sí** puede tener texto superpuesto en PixelData (nombre, fecha, campo). Avisar.
- **Pixel Padding Value `(0028,0120)`:** No es PHI, conservar.

---

### 6. Confirmación/corrección del "qué conservar"

| Elemento | Veredicto |
|---|---|
| PixelData CT | Conservar. Correcto. |
| PixelData RTDOSE | Conservar. Correcto. |
| Geometría (IPP, IOP, PixelSpacing, SliceThickness, GridFrameOffsetVector) | Conservar. Correcto y necesario. |
| DoseGridScaling, DoseUnits, DoseSummationType | Conservar. Correcto. |
| MU, ángulos, energías, MLC, fracciones, dosis prescrita | Conservar. Correcto. |
| ROIName `(3006,0026)` | Conservar **con aviso** — puede contener PHI (ver §3). |
| BeamName `(300A,00C6)` | Conservar **con aviso**. |
| **StructureSetLabel, RTPlanLabel, RTPlanName** | **Sanitizar o avisar** — frecuentemente contienen nombre del paciente. |
| ROIContourSequence geometría `(3006,0039)` / ContourData `(3006,0050)` | Conservar intacto. Es la geometría de las estructuras. |
| DVHSequence `(3004,0050)` si existe | Conservar (datos dosimétricos puros). |
| `ReferencedROINumber`, `ROINumber`, `BeamNumber` | Conservar (índices internos, no PHI). |

---

### 7. Checklist QA antes de declarar anónimo

1. **Grep de UIDs viejos:** Tras anonimizar, serializar cada archivo a string y buscar **cualquier** UID original del estudio → 0 hits.
2. **Grep del nombre original:** Buscar el PatientName y PatientID originales (y substrings de 4+ chars) en **todo** el output binario → 0 hits. Incluye búsqueda case-insensitive.
3. **Meta ↔ Dataset coherencia:** Para cada archivo, `(0002,0003)` == `(0008,0018)`.
4. **Referencia cerrada:** Todo `ReferencedSOPInstanceUID` en el estudio debe existir como `SOPInstanceUID` de algún otro archivo del estudio (o estar documentado como referencia externa).
5. **FOR coherencia:** Todos los objetos que compartían el mismo FOR original ahora comparten el mismo FOR nuevo.
6. **StudyInstanceUID único:** Todos los archivos del estudio comparten un solo `StudyInstanceUID` nuevo.
7. **`(0012,0062)` == `YES`** en cada archivo.
8. **`(0012,0063)` presente** con descripción del método.
9. **Carga en visor:** Abrir en 3D Slicer u OHIF — CT visible, estructuras alineadas, dosis superpuesta, plan asociado.
10. **Inspección manual de labels:** Revisar StructureSetLabel, RTPlanLabel, RTPlanName, ROINames → que no contengan el nombre real.
11. **Overlay groups `60xx`:** Verificar ausencia o que se borraron.
12. **Scouts/localizers:** Si existen, confirmar aviso de burned-in.
13. **Tags VR=PN residuales:** Buscar todos los elementos con VR=PN en el output → deben ser vacíos o contener el nombre anonimizado. Esto atrapa cualquier campo persona que se haya escapado (como `ROIInterpreter`, `ReviewerName`).
14. **Tags de fecha residuales:** Listar todos VR=DA/DT → deben ser la fecha nueva, vacíos, o fechas que no son del paciente (como calibration dates que borraste).

---

### Resumen ejecutivo

Tu análisis es sólido. Los gaps principales son:

- **`ReviewerName (300E,0008)`** y **`ROIInterpreter (3006,00A6)`** — nombres PN dentro de secuencias RT que se te escapan.
- **`ContributingEquipmentSequence (0018,A001)`** — duplica InstitutionName/StationName a nivel anidado.
- **`TreatmentMachineSequence`** → InstitutionName/StationName anidado.
- **`(0012,0062/0063)`** — PS3.15 exige marcar que el objeto fue de-identificado.
- **StructureSetLabel / RTPlanLabel / RTPlanName** — frecuente fuente de PHI no reconocida.
- **Overlay groups `60xx`** — no mencionados, potencial leak.
- **QA post-proceso con grep de VR=PN** como red de seguridad final.

Tu estrategia de recorrido por VR=UI es correcta y superior a recorrer por lista de tags. Asegúrate de que el recorrido entra en `_meta`, y de que en modo "conservar privados" tratas VR=UN como sospechoso.

===== FIN CLAUDE (exit=0) =====
