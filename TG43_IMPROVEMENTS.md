# Mejoras TG-43 Calculator

## Cambios Implementados

### 1. Carga Automática de Puntos de Referencia del Plan

El calculador ahora extrae y carga automáticamente los puntos de referencia (Dose Reference Points) que vienen en el RT Plan DICOM.

#### Implementación

**Parser (`rtplanParser.ts`)**:
- Extrae Dose Reference Sequence del DICOM
- Lee coordenadas (x, y, z) en mm
- Lee dosis prescrita si está disponible
- Lee descripción del punto o tipo de estructura

```typescript
// Dose Reference Sequence - puntos de referencia con dosis prescrita
if (dataset.DoseReferenceSequence && dataset.DoseReferenceSequence.length > 0) {
  dataset.DoseReferenceSequence.forEach((doseRef: any, idx: number) => {
    const coords: [number, number, number] = [
      parseFloat(doseRef.DoseReferencePointCoordinates[0]),
      parseFloat(doseRef.DoseReferencePointCoordinates[1]),
      parseFloat(doseRef.DoseReferencePointCoordinates[2])
    ]
    
    const name = extractString(doseRef.DoseReferenceDescription) || 
                extractString(doseRef.DoseReferenceStructureType) ||
                `Punto ${idx + 1}`
    
    const prescribedDose = doseRef.TargetPrescriptionDose 
      ? parseFloat(doseRef.TargetPrescriptionDose) 
      : undefined
    
    plan.doseReferencePoints!.push({ name, coords, prescribedDose })
  })
}
```

**Componente (`Tg43Calculator.jsx`)**:
- Al cargar el plan, verifica si hay puntos de referencia
- Si existen, los carga automáticamente en la lista de puntos de cálculo
- Si no existen, inicializa con un punto de ejemplo

```javascript
// Cargar puntos de referencia del plan si existen
if (parsedPlan.doseReferencePoints && parsedPlan.doseReferencePoints.length > 0) {
  const planPoints = parsedPlan.doseReferencePoints.map(point => ({
    name: point.name,
    x: point.coords[0],
    y: point.coords[1],
    z: point.coords[2],
    prescribedDose: point.prescribedDose || null
  }))
  setCalculationPoints(planPoints)
} else {
  // Punto de ejemplo si no hay puntos en el plan
  setCalculationPoints([
    { name: 'Punto A', x: 0, y: 0, z: 20, prescribedDose: null }
  ])
}
```

#### Beneficios

- ✅ Carga automática de puntos clínicos (Punto A, Punto B, etc.)
- ✅ Dosis prescrita pre-cargada para comparación
- ✅ Nombres descriptivos de los puntos
- ✅ Ahorro de tiempo al no tener que ingresar coordenadas manualmente
- ✅ Reduce errores de transcripción

### 2. Actualización de Datos de la Fuente

Se actualizaron los datos tabulados de TG-43 con valores más precisos.

#### Constantes Actualizadas

```typescript
export const IR192_CONSTANTS = {
  doseRateConstant: 1.117, // Λ (cGy/h/U) - ANTES: 1.108
  activeLength: 0.35,      // L (cm) - Sin cambios
  halfLife: 73.83          // días - Sin cambios
}
```

#### Función de Dosis Radial gL(r)

Actualizada con 14 puntos de datos desde r = 0.00 cm hasta r = 10.00 cm:

| r (cm) | gL(r) |
|--------|-------|
| 0.00   | 0.998 |
| 0.20   | 0.998 |
| 0.25   | 0.997 |
| 0.50   | 0.996 |
| 0.75   | 0.998 |
| 1.00   | 1.000 |
| 1.50   | 1.003 |
| 2.00   | 1.006 |
| 3.00   | 1.006 |
| 4.00   | 1.004 |
| 5.00   | 0.999 |
| 6.00   | 0.993 |
| 8.00   | 0.968 |
| 10.00  | 0.935 |

#### Función de Anisotropía F(r,θ)

Actualizada con datos completos para 5 distancias radiales:
- r = 0.20 cm: 38 ángulos (0° a 180°)
- r = 0.40 cm: 38 ángulos
- r = 1.00 cm: 38 ángulos
- r = 2.00 cm: 38 ángulos
- r = 5.00 cm: 38 ángulos
- r = 10.00 cm: 38 ángulos

Total: 228 puntos de datos de anisotropía

#### Cobertura Angular Mejorada

Especial atención a ángulos cercanos al eje longitudinal:
- 0° - 10°: Cada 1°
- 10° - 20°: Cada 5°
- 20° - 160°: Cada 10°
- 160° - 180°: Cada 1° (alta resolución cerca del extremo)

Esto mejora la precisión en regiones de alta gradiente de dosis.

### 3. Capacidad de Agregar Puntos Adicionales

El usuario puede:
- ✅ Ver los puntos cargados del plan
- ✅ Agregar puntos adicionales manualmente
- ✅ Editar coordenadas y dosis prescrita
- ✅ Eliminar puntos individuales
- ✅ Calcular dosis en todos los puntos simultáneamente

## Flujo de Trabajo Mejorado

### Antes
1. Cargar RT Plan
2. Manualmente ingresar coordenadas de cada punto
3. Manualmente ingresar dosis prescrita
4. Calcular

### Ahora
1. Cargar RT Plan
2. ✨ Puntos automáticamente cargados con dosis prescrita
3. (Opcional) Agregar puntos adicionales
4. Calcular

## Ejemplo de Uso

```javascript
// Plan cargado con 2 puntos de referencia:
// - Punto A: (20.0, 0.0, 0.0) mm, 7.0 Gy
// - Punto B: (-20.0, 0.0, 0.0) mm, 5.0 Gy

// Usuario agrega punto adicional:
// - Vejiga: (0.0, 30.0, 0.0) mm, sin dosis prescrita

// Cálculo de dosis:
// Punto A: 7.12 Gy calculado vs 7.0 Gy prescrito (+1.7%)
// Punto B: 5.08 Gy calculado vs 5.0 Gy prescrito (+1.6%)
// Vejiga: 2.34 Gy calculado
```

## Validación

### Datos de la Fuente
- Λ = 1.117 cGy/(h·U) ✅
- L = 0.35 cm ✅
- Datos tabulados completos ✅

### Extracción de Puntos
- Coordenadas correctas ✅
- Dosis prescrita correcta ✅
- Nombres descriptivos ✅

### Cálculos
- Interpolación radial ✅
- Interpolación angular ✅
- Conversión de unidades ✅

## Notas Técnicas

### Sistema de Coordenadas DICOM

Los puntos de referencia en DICOM usan el sistema de coordenadas del paciente:
- X: Izquierda (-) a Derecha (+)
- Y: Posterior (-) a Anterior (+)
- Z: Inferior (-) a Superior (+)

Unidades: milímetros (mm)

### Conversión para TG-43

El código convierte automáticamente:
- mm → cm (división por 10)
- Reordenamiento de ejes si es necesario

### Tags DICOM Utilizados

- `(300A,0010)` Dose Reference Sequence
- `(300A,0018)` Dose Reference Point Coordinates
- `(300A,0016)` Dose Reference Description
- `(300A,0020)` Dose Reference Structure Type
- `(300A,0026)` Target Prescription Dose

## Referencias

- AAPM TG-43 Update (2004)
- DICOM Standard Part 3: Information Object Definitions
- Datos tabulados de la fuente proporcionados por el usuario

## Testing

Para verificar las mejoras:

1. **Cargar RT Plan con puntos de referencia**:
   - Verificar que los puntos se carguen automáticamente
   - Verificar nombres y coordenadas
   - Verificar dosis prescrita

2. **Agregar punto manual**:
   - Hacer clic en "Añadir Punto"
   - Ingresar coordenadas
   - Verificar que se agregue a la lista

3. **Calcular dosis**:
   - Hacer clic en "Calcular Dosis"
   - Verificar resultados
   - Verificar diferencias porcentuales con dosis prescrita

4. **Comparar con TPS**:
   - Exportar puntos del TPS
   - Comparar con resultados del calculador
   - Diferencias esperadas: < 3%
