# Fix: TG-43 Calculator - Cannot read properties of undefined (reading '0')

## Problema

Al hacer clic en "Calcular Dosis" en el TG-43 Calculator, aparecía el error:
```
Cannot read properties of undefined (reading '0')
```

## Causa Raíz

Había una inconsistencia entre los tipos TypeScript y la implementación del parser:

1. **Tipo `Dwell` definía**: `coords: [number, number, number]`
2. **Parser creaba**: `position: [number, number, number]` e `index: number`
3. **Función `makeSourceTrain` esperaba**: `coords`

Cuando `makeSourceTrain` intentaba acceder a `dwell.coords[0]`, `coords` era `undefined`, causando el error.

## Solución

### 1. Actualizado `types.ts`

Se agregó el tipo `BrachyPlan` que faltaba y se actualizó `Channel`:

```typescript
export type BrachyPlan = {
  patientName: string
  patientID: string
  planLabel: string
  planDate: string
  sourceIsotope: string
  refAirKermaRate: number
  halfLife: number
  treatmentModel: string
  channels: Channel[]
}

export type Channel = {
  number: number          // número del canal
  length: number          // longitud en mm
  totalTime?: number      // opcional
  numberOfDwells?: number // opcional
  dwells: Dwell[]
}

export type Dwell = {
  coords: [number, number, number] // [x, y, z] en mm
  dwellTime: number                // segundos
  timeWeight: number               // peso normalizado
}
```

### 2. Actualizado `rtplanParser.ts`

Cambiado de `position` e `index` a `coords` y `timeWeight`:

```typescript
// ANTES (incorrecto)
const dwell: Dwell = {
  index: cpIndex,
  position,
  dwellTime
}

// DESPUÉS (correcto)
const dwell: Dwell = {
  coords,
  dwellTime,
  timeWeight: 0
}
```

### 3. Función `makeSourceTrain` ahora funciona

```typescript
export function makeSourceTrain(
  dwells: { coords: [number, number, number]; dwellTime: number }[],
  ...
): SourcePosition[] {
  return dwells.map(dwell => ({
    x: dwell.coords[0] / 10,  // ✅ Ahora coords existe
    y: dwell.coords[2] / 10,
    z: dwell.coords[1] / 10,
    dwellTime: dwell.dwellTime,
    ...
  }))
}
```

## Archivos Modificados

1. **`src/lib/brachy/types.ts`**
   - Agregado tipo `BrachyPlan`
   - Actualizado tipo `Channel` con `number` y `length`
   - Mantenido tipo `Dwell` con `coords`

2. **`src/lib/brachy/rtplanParser.ts`**
   - Cambiado `position` → `coords`
   - Eliminado `index`
   - Agregado `timeWeight: 0`

## Testing

Para verificar el fix:

1. Cargar un RT Plan de braquiterapia DICOM
2. Verificar que se muestre la información del plan correctamente
3. Agregar uno o más puntos de cálculo
4. Hacer clic en "Calcular Dosis"
5. Verificar que se calculen las dosis sin errores

## Flujo de Datos Correcto

```
DICOM File
    ↓
parseRTPlanBrachy()
    ↓
BrachyPlan {
  channels: [
    {
      dwells: [
        { coords: [x, y, z], dwellTime: t }  ← Formato correcto
      ]
    }
  ]
}
    ↓
makeSourceTrain(dwells, ...)
    ↓
SourcePosition[] {
  x: coords[0] / 10  ← Acceso exitoso
  y: coords[2] / 10
  z: coords[1] / 10
}
    ↓
calculateTotalDose(sources, point)
    ↓
Resultado en Gy
```

## Notas Técnicas

### Conversión de Coordenadas

El código hace una conversión de ejes y unidades:
- **DICOM**: [x, y, z] en mm
- **TG-43**: x=x/10, y=z/10, z=y/10 en cm

Esto es porque DICOM usa un sistema de coordenadas diferente al usado en los cálculos TG-43.

### timeWeight

El campo `timeWeight` se inicializa en 0 porque:
- No se usa en los cálculos actuales
- Se puede calcular después si es necesario (normalización de tiempos)
- Es requerido por el tipo `Dwell`

## Lecciones Aprendidas

1. **Consistencia de tipos**: Los tipos TypeScript deben coincidir exactamente con la implementación
2. **Validación temprana**: Compilar TypeScript ayuda a detectar estos errores antes de runtime
3. **Documentación**: Los tipos bien documentados ayudan a entender el flujo de datos
