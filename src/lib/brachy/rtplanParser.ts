// Parser DICOM RT Plan para Braquiterapia usando dcmjs
import dcmjs from 'dcmjs'
import type { BrachyPlan, Channel, Dwell } from './types'

const { DicomMessage } = dcmjs.data

export function parseRTPlanBrachy(arrayBuffer: ArrayBuffer): BrachyPlan {
  console.log('=== INICIO PARSING RT PLAN BRACHY con dcmjs ===')
  console.log('Tamaño del archivo:', arrayBuffer.byteLength, 'bytes')
  
  try {
    // Parse DICOM con dcmjs
    const dicomData = DicomMessage.readFile(arrayBuffer)
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict)
    
    console.log('✓ DICOM parseado correctamente')
    
    // Helper para extraer strings de campos DICOM que pueden ser objetos
    const extractString = (value: any): string => {
      if (!value) return ''
      if (typeof value === 'string') return value
      if (typeof value === 'object' && value.Alphabetic) return value.Alphabetic
      return String(value)
    }
    
    // Información básica del plan
    const plan: BrachyPlan = {
      patientName: extractString(dataset.PatientName),
      patientID: extractString(dataset.PatientID),
      planLabel: extractString(dataset.RTPlanLabel || dataset.RTPlanName),
      planDate: extractString(dataset.RTPlanDate),
      sourceIsotope: '',
      refAirKermaRate: 0,
      halfLife: 0,
      treatmentModel: '',
      channels: [],
      doseReferencePoints: [],
      sourceCalibrationDate: undefined,
      treatmentDate: undefined
    }

    // Source Sequence - información de la fuente
    if (dataset.SourceSequence && dataset.SourceSequence.length > 0) {
      const source = dataset.SourceSequence[0]
      
      // Isótopo
      if (source.SourceIsotopeName) {
        plan.sourceIsotope = extractString(source.SourceIsotopeName)
      }
      
      // Reference Air Kerma Rate (en unidades U = µGy·m²/h)
      if (source.ReferenceAirKermaRate) {
        plan.refAirKermaRate = parseFloat(source.ReferenceAirKermaRate)
      }
      
      // Source Calibration Date (fecha de calibración)
      if (source.SourceStrengthReferenceDate) {
        plan.sourceCalibrationDate = extractString(source.SourceStrengthReferenceDate)
        console.log('Fecha de calibración:', plan.sourceCalibrationDate)
      }
      
      // Active Source Diameter y Length (si están disponibles)
      if (source.ActiveSourceDiameter) {
        console.log('Active Source Diameter:', source.ActiveSourceDiameter, 'mm')
      }
      if (source.ActiveSourceLength) {
        console.log('Active Source Length:', source.ActiveSourceLength, 'mm')
      }
    }

    // Calcular vida media desde Radionuclide Half Life (en segundos)
    if (dataset.SourceSequence && dataset.SourceSequence[0]?.RadionuclideHalfLife) {
      const halfLifeSeconds = parseFloat(dataset.SourceSequence[0].RadionuclideHalfLife)
      plan.halfLife = halfLifeSeconds / 86400 // Convertir a días
      console.log('Half Life:', plan.halfLife.toFixed(2), 'días')
    } else {
      // Valor por defecto para Ir-192
      plan.halfLife = 73.83
      console.log('⚠️ Half Life no encontrado, usando valor por defecto Ir-192:', plan.halfLife, 'días')
    }

    // Treatment Date - fecha de tratamiento planeada
    if (dataset.RTPlanDate) {
      plan.treatmentDate = extractString(dataset.RTPlanDate)
      console.log('Fecha de tratamiento:', plan.treatmentDate)
    }

    // Treatment Machine Name
    if (dataset.TreatmentMachineName) {
      plan.treatmentModel = extractString(dataset.TreatmentMachineName)
    }

    // Dose Reference Sequence - puntos de referencia con dosis prescrita
    if (dataset.DoseReferenceSequence && dataset.DoseReferenceSequence.length > 0) {
      dataset.DoseReferenceSequence.forEach((doseRef: any, idx: number) => {
        // Dose Reference Point Coordinates (x, y, z en mm)
        if (doseRef.DoseReferencePointCoordinates && doseRef.DoseReferencePointCoordinates.length === 3) {
          const coords: [number, number, number] = [
            parseFloat(doseRef.DoseReferencePointCoordinates[0]),
            parseFloat(doseRef.DoseReferencePointCoordinates[1]),
            parseFloat(doseRef.DoseReferencePointCoordinates[2])
          ]
          
          // Dose Reference Description o usar nombre por defecto
          const name = extractString(doseRef.DoseReferenceDescription) || 
                      extractString(doseRef.DoseReferenceStructureType) ||
                      `Punto ${idx + 1}`
          
          // Target Prescription Dose (en Gy)
          let prescribedDose: number | undefined
          if (doseRef.TargetPrescriptionDose) {
            prescribedDose = parseFloat(doseRef.TargetPrescriptionDose)
          }
          
          const point: Point = {
            name,
            coords,
            prescribedDose
          }
          
          plan.doseReferencePoints!.push(point)
          console.log(`✓ Punto de referencia: ${name} en [${coords[0].toFixed(1)}, ${coords[1].toFixed(1)}, ${coords[2].toFixed(1)}] mm` +
                     (prescribedDose ? `, dosis: ${prescribedDose.toFixed(2)} Gy` : ''))
        }
      })
    }

    // Application Setup Sequence - contiene los canales y dwells
    if (dataset.ApplicationSetupSequence && dataset.ApplicationSetupSequence.length > 0) {
      dataset.ApplicationSetupSequence.forEach((appSetup: any, appIdx: number) => {
        // Channel Sequence
        if (appSetup.ChannelSequence && appSetup.ChannelSequence.length > 0) {
          appSetup.ChannelSequence.forEach((channelData: any) => {
            const channelNumber = parseInt(channelData.ChannelNumber) || 0
            const channelLength = parseFloat(channelData.ChannelLength) || 0
            
            const channel: Channel = {
              number: channelNumber,
              length: channelLength,
              dwells: []
            }

            // Brachy Control Point Sequence - contiene los dwells
            if (channelData.BrachyControlPointSequence && channelData.BrachyControlPointSequence.length > 0) {
              channelData.BrachyControlPointSequence.forEach((cpData: any) => {
                // Control Point 3D Position (coordenadas x, y, z en mm)
                let coords: [number, number, number] = [0, 0, 0]
                if (cpData.ControlPoint3DPosition && cpData.ControlPoint3DPosition.length === 3) {
                  coords = [
                    parseFloat(cpData.ControlPoint3DPosition[0]),
                    parseFloat(cpData.ControlPoint3DPosition[1]),
                    parseFloat(cpData.ControlPoint3DPosition[2])
                  ]
                }

                // Cumulative Time Weight (tiempo de permanencia en segundos)
                let dwellTime = 0
                if (cpData.CumulativeTimeWeight !== undefined) {
                  dwellTime = parseFloat(cpData.CumulativeTimeWeight)
                }

                // Crear dwell
                const dwell: Dwell = {
                  coords,
                  dwellTime,
                  timeWeight: 0 // Se calculará después si es necesario
                }

                channel.dwells.push(dwell)
              })
            }

            // Solo agregar canales con dwells
            if (channel.dwells.length > 0) {
              plan.channels.push(channel)
              console.log(`✓ Canal #${channel.number}: ${channel.dwells.length} dwells`)
            }
          })
        }
      })
    }

    console.log('\n=== RESUMEN ===')
    console.log('Isótopo:', plan.sourceIsotope)
    console.log('Ref Air Kerma Rate:', plan.refAirKermaRate, 'U')
    console.log('Half Life:', plan.halfLife.toFixed(2), 'días')
    console.log('Canales:', plan.channels.length)
    console.log('Total Dwells:', plan.channels.reduce((sum, ch) => sum + ch.dwells.length, 0))

    if (plan.channels.length === 0) {
      throw new Error('No se encontraron canales con dwells en el RT Plan')
    }

    return plan

  } catch (err) {
    console.error('❌ Error durante el parsing:', err)
    throw new Error('Error al parsear RT Plan de Braquiterapia: ' + (err as Error).message)
  }
}
