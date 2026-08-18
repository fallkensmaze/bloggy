# Fix: React Error #31 - Objects are not valid as a React child

## Problema

Al usar dcmjs, algunos campos DICOM como `PatientName` pueden devolver objetos en lugar de strings simples:

```javascript
// En lugar de:
dataset.PatientName = "John Doe"

// dcmjs puede devolver:
dataset.PatientName = {
  Alphabetic: "John Doe",
  Ideographic: "ジョン・ドウ",
  Phonetic: "Jon Dou"
}
```

Cuando React intenta renderizar estos objetos directamente, lanza el error:
```
Objects are not valid as a React child (found: object with keys {Alphabetic})
```

## Solución

Se agregó una función helper `extractString()` en ambos parsers que:

1. Verifica si el valor es un string → lo devuelve directamente
2. Si es un objeto con propiedad `Alphabetic` → extrae ese valor
3. Si es null/undefined → devuelve string vacío
4. En cualquier otro caso → convierte a string

```javascript
const extractString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value.Alphabetic) return value.Alphabetic
  return String(value)
}
```

## Archivos Modificados

### 1. `src/utils/rtPlanParser.js`

Campos actualizados con `extractString()`:
- `patientName`
- `patientID`
- `planLabel`
- `planDate`
- `planTime`
- `planDescription`
- `planGeometry`
- `planIntent`
- `treatmentSites`
- `beam.name`
- `beam.type`
- `beam.technique`
- `beam.radiationType`
- `beam.energy`
- `beam.doseRate`
- `beam.gantryRotationDirection`
- `machine`
- `deviceType` (en Beam Limiting Devices)

### 2. `src/lib/brachy/rtplanParser.ts`

Campos actualizados con `extractString()`:
- `patientName`
- `patientID`
- `planLabel`
- `planDate`
- `sourceIsotope`
- `treatmentModel`

## Campos Afectados en las Interfaces

### RT Plan Compare
- Información del paciente (nombre, ID)
- Información del plan (nombre, descripción, fecha)
- Información de haces (nombre, tipo, técnica, radiación, energía)
- Nombre de la máquina

### TG-43 Calculator
- Información del paciente
- Isótopo de la fuente
- Modelo de tratamiento

## Testing

Para verificar el fix:

1. **RT Plan Compare**: 
   - Cargar un RT Plan DICOM
   - Verificar que se muestre correctamente la información del paciente y plan
   - No debe aparecer el error React #31

2. **TG-43 Calculator**:
   - Cargar un RT Plan de braquiterapia
   - Verificar que se muestre el isótopo y modelo de tratamiento
   - No debe aparecer el error React #31

## Notas Técnicas

### ¿Por qué dcmjs devuelve objetos?

El estándar DICOM soporta nombres de pacientes en múltiples alfabetos:
- **Alphabetic**: Caracteres latinos (A-Z, a-z)
- **Ideographic**: Caracteres ideográficos (Kanji, Hanzi)
- **Phonetic**: Representación fonética (Katakana, Hiragana)

Ejemplo real:
```
Patient Name: 山田^太郎=Yamada^Taro=やまだ^たろう
```

dcmjs parsea esto como:
```javascript
{
  Alphabetic: "Yamada^Taro",
  Ideographic: "山田^太郎",
  Phonetic: "やまだ^たろう"
}
```

### Campos que pueden ser objetos

Según el estándar DICOM, estos campos pueden tener múltiples representaciones:
- Patient Name (0010,0010)
- Referring Physician Name (0008,0090)
- Performing Physician Name (0008,1050)
- Operator Name (0008,1070)

Nuestra función `extractString()` siempre usa la representación `Alphabetic` que es la más común en sistemas occidentales.

## Referencias

- [DICOM Standard - Person Name](https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_6.2.html#sect_6.2.1.2)
- [dcmjs Documentation](https://github.com/dcmjs-org/dcmjs)
- [React Error #31](https://react.dev/errors/31)
