<!-- Dictamen de revisión generado por OpenAI Codex (gpt-5.5), modelo 5.5, modo exec -->
<!-- Fecha: 2026-06-19. Contexto: revisión de DICOM_RT_ANONYMIZATION_STUDY.md -->

Leído. Dictamen: la estrategia base es buena, pero yo no la firmaría como “anónimo PS3.15” si conservas por defecto descriptores RT, características del paciente y huella de equipo. PS3.15 Basic es conservador: elimina identidad/demografía, personal, instituciones, UIDs/fechas y privados; además exige consistencia de UID y declara que pixel data queda fuera salvo opción específica de limpieza. Fuentes: DICOM PS3.15 2026b, perfil E.1/E.2 y opciones E.3.1/E.3.5.

**1. No Olvidar**
Marca: `[BASIC]` consenso PS3.15; `[HARD]` endurecimiento razonable.

- `[BASIC]` Paciente: `(0010,0010)` PatientName, `(0010,0020)` PatientID, `(0010,0030/0032)` BirthDate/Time, `(0010,1000/1001/1002/1005/1060/1090)`, `(0010,1040)` Address, `(0010,2154/2155)` Telephone/Telecom, `(0010,2160)` EthnicGroup, `(0010,2180)` Occupation, `(0010,21B0)` AdditionalPatientHistory, `(0010,4000)` PatientComments.
- `[BASIC]` No conserves `(0010,0040)` Sex, `(0010,1010)` Age, `(0010,1020)` Size, `(0010,1030)` Weight salvo que declares explícitamente `Retain Patient Characteristics`.
- `[BASIC]` Orden/episodio: `(0008,0050)` AccessionNumber, `(0020,0010)` StudyID, `(0032,1032/1033)`, `(0032,1060/1070/4000)`, `(0040,0275)`, `(0040,1001-100A)`, `(0040,2001/2004/2005/2008/2009/2010/2016/2017/2400)`.
- `[BASIC]` Personas/institución: `(0008,0080/0081/1040)` Institution*, `(0008,0090/0092/0094/0096)` ReferringPhysician*, `(0008,1048/1050/1060/1070)` physicians/operators, sus identification sequences, `(300E,0008)` ReviewerName, `(3006,00A6)` ROIInterpreter.
- `[BASIC]` Fechas/horas: todas las DA/TM/DT identificantes, incluidas `(0008,0020-0035)`, `(0008,002A)`, `(0008,0201)`, `(0018,1200/1201/1202/1204/1205)`, `(300A,0006/0007)`, `(3006,0008/0009)`, `(3008,0054)`, `(3008,0250/0251)`, `(300E,0004/0005)`.
- `[BASIC]` Equipo: `(0008,1010)` StationName, `(0008,1090)` ManufacturerModelName, `(0018,1000)` DeviceSerialNumber, `(0018,1002)` DeviceUID, `(0018,1003-1009)`, `(0018,100A)` UDISequence, `(0018,100B)` ManufacturerDeviceClassUID, `(300A,00B2)` TreatmentMachineName.
- `[HARD]` También borraría/limpiaría `(0008,0070)` Manufacturer y `(0018,1020)` SoftwareVersions salvo que declares `Retain Device Identity`; juntos con modelo/versión/linac pueden fingerprintar un centro.
- `[BASIC]` File meta/preamble: reemplaza preámbulo de 128 bytes y meta no esencial. No conserves `(0002,0012)` ImplementationClassUID, `(0002,0013)` ImplementationVersionName, `(0002,0016/0017/0018)` AE Titles, `(0002,0100/0102)` PrivateInformation*.
- `[BASIC]` Clinical Trial: `(0012,0010-0084)` salvo campos añadidos por tu de-identificación: `(0012,0062)=YES`, `(0012,0063)` método, `(0012,0064)` códigos si los usas.
- `[BASIC]` Privados: borrar todos los grupos impares, incluidos Siemens CSA `(0029,xx..)`, GE `(0019/0043,xx..)`, Philips `(2001/2005/7053,xx..)`, Varian/Elekta/TPS `(300B/300D,xx..)`. `Retain Safe Private` solo con whitelist revisada.

**2. No Borrar Porque Rompe RT**
- Conserva y remapea UIDs en: `(0020,000D)` StudyInstanceUID, `(0020,000E)` SeriesInstanceUID, `(0008,0018)` SOPInstanceUID, `(0002,0003)` MediaStorageSOPInstanceUID, `(0020,0052)` FrameOfReferenceUID.
- Conserva secuencias de referencia y remapea dentro: `(0008,1115)`, `(0008,1140)`, `(0008,2112)`, `(0008,9124)`, `(3006,0010/0012/0014/0016/0024)`, `(300C,0002/0060/0080)`, `(0008,1150/1155)`.
- No borres geometría/dosis: `(0020,0032/0037)`, `(0028,0030)`, `(0018,0050)`, `(3006,0050)`, `(3004,0002/0004/000A/000C/000E)`, `PixelData (7FE0,0010)`, MU, MLC, ángulos, fraccionamiento.
- Para tags Type 1/2 que sean PHI, no los elimines si rompen IOD: usa dummy/zero-length válido. Ej.: `(300A,0002)` RTPlanLabel, `(3006,0002)` StructureSetLabel, `(300A,00B2)` TreatmentMachineName.

**3. Falsos Negativos**
Lo más peligroso que ahora conservas: descriptores RT. PS3.15 Clean Descriptors advierte que cualquier SH/LO/ST/LT/UT controlado por operador puede contener identidad.

- RTSTRUCT: `(3006,0002/0004/0006)` StructureSet*, `(3006,0026)` ROIName, `(3006,0028)` ROIDescription, `(3006,0085/0088)` ROIObservation*, `(3006,004D/004E)` creator/interpreter sequences.
- RTPLAN: `(300A,0002/0003/0004)` RTPlan*, `(300A,0009)` TreatmentProtocols, `(300A,000B)` TreatmentSites, `(300A,000E)` PrescriptionDescription, `(300A,0016)` DoseReferenceDescription, `(300A,00C2/00C3)` BeamName/Description.
- Setup/accesorios: `(300A,0183/0184)`, `(300A,0194/0196/0198)`, `(300A,01A4/01A6/01A8)`, `(300A,01B2/01B8/01BA/01D0)`.
- Brachy: `(300A,0216/021B/021C)`, `(300A,0236/0238/0244)`, `(300A,0263/0266)`, `(300A,0273)`, `(300A,0291/0294/0298)`.
- RTDOSE: `(3004,0006)` DoseComment.
- CT/general: `(0018,1030)` ProtocolName, `(0018,9423/9424)` AcquisitionProtocolName/Description, `(0008,1030/103E)`, `(0008,2111)`, `(0020,4000)`.

Mi recomendación: conservar ROI/beam names solo con modo “limpieza de descriptores”: whitelist de nombres anatómicos/técnicos o revisión humana. RTPlanLabel/StructureSetLabel, mejor sustituir por genéricos.

**4. UID**
Recorrer por VR=`UI` es necesario, pero no suficiente como prueba final.

- Correcto: remap global, recursivo, incluyendo SQ anidadas y grupo `0002`.
- Preserva solo UIDs de clase/sintaxis estándar: `(0008,0016)`, `(0002,0002)`, `(0002,0010)`. Remapea `(0008,0014)`, `(0008,0018)`, `(0020,000D/000E/0052/0200)`, `(0008,1155)`, `(300A,0013)`, `(300A,0054)`, `(300A,0650)`, `(300A,0609)`, `(300A,0700)`, `(3010,003B)`, `(3010,006E)`, tracking/fiducial/irradiation/event UIDs si aparecen.
- UID en privados o texto no tendrá VR=`UI`; como borras privados y limpias texto, mitigado. Añade byte-scan final de todos los UID originales.
- PixelData encapsulado no debe editarse por búsqueda de UID. Si hay Encapsulated Document `(0042,0011)` o SR/PR/SC fuera de alcance, rechaza o implementa limpieza específica.
- RT Ion Plan/Dose y Second Generation RT: no declares soporte si no los validas. Tu algoritmo genérico ayuda, pero hay más UID/descriptores `(3010,xxxx)` y secuencias profundas.

**5. Píxeles/Overlays**
Sin limpiar píxeles no puedes afirmar `Clean Pixel Data`. No pongas `(0028,0301)=NO` ni `(0028,0302)=NO` salvo inspección/limpieza real. El estándar exige limpieza de pixel data solo con esa opción; y la limpieza puede requerir aprobación humana.

Elimina o limpia overlays/graphics: `(6000-60FF,0022/0045/1500/3000)`, `(0070,0001)` GraphicAnnotationSequence, `(0070,0006)` UnformattedTextValue, iconos `(0088,0200)`. Ojo: los contornos RT `(3006,0050)` no son overlays y deben conservarse.

**6. Qué Conservar**
Conserva geometría, PixelData si aceptas la limitación, contornos, dosis, DVH, MU, energías, MLC, ángulos, couch, fraccionamiento y referencias. Conserva códigos/CS estándar. No conserves por defecto nombres/descripciones libres; son clínicamente útiles, pero no seguros.

**7. QA Mínima**
- DICOMDIR y nombres de archivo del ZIP: regenerar/sanitizar; borrar grupo `(0004,xxxx)` salvo DICOMDIR nuevo.
- Validar `(0002,0003)==(0008,0018)` y preámbulo/meta reemplazados.
- Verificar cero ocurrencias serializadas de PN/ID/accesion/StudyID/UIDs/fechas/institución/AE/serial originales.
- Verificar que no quedan privados ni private creators.
- Validar grafo: todas las referencias resuelven o se reportan como externas.
- Hash de PixelData CT/RTDOSE antes/después si prometes no tocarlo.
- Abrir en 3D Slicer/TPS: CT+RTSTRUCT+dosis alineados.
- Revisión visual de slices/RTDOSE/RTIMAGE para texto quemado, overlays y cara reconocible.
- Emitir informe: perfil PS3.15, opciones usadas, campos conservados por excepción y limitación explícita de PixelData.
