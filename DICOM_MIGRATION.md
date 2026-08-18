# Migración a dcmjs para Parsing DICOM

## Resumen de Cambios

Se ha migrado el parsing DICOM manual usando `dicom-parser` a la librería más robusta `dcmjs`.

## Archivos Actualizados

### 1. `src/utils/rtPlanParser.js`
- **Antes**: Parser manual de bajo nivel con ~500 líneas de código complejo
- **Después**: Parser usando dcmjs con ~250 líneas, más limpio y mantenible
- **Mejoras**:
  - Manejo automático de secuencias DICOM
  - Extracción correcta de tags sin lógica manual
  - Mejor manejo de Beam Limiting Devices (jaws y MLC)
  - Extracción correcta de MU desde Fraction Group Sequence

### 2. `src/lib/brachy/rtplanParser.ts`
- **Antes**: Parser manual para braquiterapia
- **Después**: Parser usando dcmjs con tipado TypeScript
- **Mejoras**:
  - Extracción correcta de Source Sequence
  - Manejo robusto de Application Setup Sequence
  - Mejor parsing de Brachy Control Points
  - Cálculo automático de vida media desde Radionuclide Half Life

### 3. `src/utils/dicomParser.js`
- **Antes**: Parser básico para imágenes DICOM
- **Después**: Parser usando dcmjs con mejor manejo de pixel data
- **Mejoras**:
  - Soporte para múltiples bits allocated (8, 16, 32)
  - Manejo correcto de pixel representation (signed/unsigned)
  - Mejor extracción de frames múltiples

## Beneficios de dcmjs

### 1. Robustez
- Librería mantenida activamente por la comunidad de imaging médico
- Probada en producción en múltiples aplicaciones médicas
- Manejo completo del estándar DICOM

### 2. Simplicidad
- API de alto nivel que abstrae la complejidad de DICOM
- Naturalización automática de datasets (convierte tags a nombres legibles)
- Menos código = menos bugs

### 3. Funcionalidad
- Soporte completo para RT Plans, RT Structures, RT Dose
- Manejo automático de secuencias anidadas
- Soporte para Transfer Syntaxes comprimidos (JPEG, RLE, etc.)

### 4. Mantenibilidad
- Código más legible y fácil de entender
- Menos lógica manual propensa a errores
- Mejor documentación y ejemplos en la comunidad

## Problemas Resueltos

### RT Plan Comparison
1. ✅ Extracción incorrecta de jaw positions
2. ✅ Confusión entre tags de dispositivos limitadores
3. ✅ MU incorrectos (se multiplicaban por 100)
4. ✅ Manejo inconsistente de secuencias anidadas

### TG-43 Calculator
1. ✅ Parsing incorrecto de Source Sequence
2. ✅ Extracción incorrecta de Reference Air Kerma Rate
3. ✅ Problemas con Brachy Control Points
4. ✅ Coordenadas de dwells mal parseadas

## Testing

Para probar los cambios:

1. **RT Plan Comparison**: Carga dos RT Plans DICOM y verifica que:
   - Los haces se muestren correctamente
   - Las jaw positions sean correctas
   - Los MU coincidan con el TPS
   - Los control points se comparen correctamente

2. **TG-43 Calculator**: Carga un RT Plan de braquiterapia y verifica que:
   - La información de la fuente sea correcta
   - Los dwells se extraigan correctamente
   - Los cálculos de dosis sean precisos

## Dependencias

```json
{
  "dcmjs": "^0.x.x"  // Instalado
}
```

## Notas Técnicas

### Naturalización de Datasets
dcmjs convierte automáticamente tags DICOM a nombres legibles:
- `(0010,0010)` → `PatientName`
- `(300A,00C0)` → `BeamNumber`
- `(300A,0112)` → `ControlPointIndex`

### Manejo de Secuencias
Las secuencias DICOM se convierten en arrays de JavaScript:
```javascript
dataset.BeamSequence.forEach(beam => {
  beam.ControlPointSequence.forEach(cp => {
    // Procesar control point
  })
})
```

### Tipos de Datos
dcmjs maneja automáticamente la conversión de tipos:
- Strings → `string`
- Números → `number`
- Arrays → `Array`
- Secuencias → `Array<Object>`

## Próximos Pasos

1. Considerar agregar soporte para RT Structures
2. Implementar parsing de RT Dose para verificación de dosis
3. Agregar validación de conformidad DICOM
4. Implementar caching de archivos parseados para mejor performance

## Referencias

- [dcmjs Documentation](https://github.com/dcmjs-org/dcmjs)
- [DICOM Standard](https://www.dicomstandard.org/)
- [RT Plan IOD](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_A.19.html)
