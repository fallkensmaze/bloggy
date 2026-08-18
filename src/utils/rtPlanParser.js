// Parser DICOM RT Plan usando dcmjs
import dcmjs from 'dcmjs'

const { DicomMessage } = dcmjs.data

export function parseRTPlan(arrayBuffer) {
  console.log('=== INICIO PARSING RT PLAN con dcmjs ===')
  console.log('Tamaño del archivo:', arrayBuffer.byteLength, 'bytes')
  
  try {
    // Parse DICOM con dcmjs
    const dicomData = DicomMessage.readFile(arrayBuffer)
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict)
    
    console.log('✓ DICOM parseado correctamente')
    
    // Helper para extraer strings de campos DICOM que pueden ser objetos
    const extractString = (value) => {
      if (!value) return ''
      if (typeof value === 'string') return value
      if (typeof value === 'object' && value.Alphabetic) return value.Alphabetic
      return String(value)
    }
    
    const plan = {
      patientName: extractString(dataset.PatientName),
      patientID: extractString(dataset.PatientID),
      planLabel: extractString(dataset.RTPlanLabel || dataset.RTPlanName),
      planDate: extractString(dataset.RTPlanDate),
      planTime: extractString(dataset.RTPlanTime),
      planDescription: extractString(dataset.RTPlanDescription),
      numberOfFractions: 0,
      prescribedDose: 0,
      targetPrescriptionDose: 0,
      beams: [],
      machine: '',
      planGeometry: extractString(dataset.RTPlanGeometry),
      planIntent: extractString(dataset.PlanIntent),
      treatmentSites: extractString(dataset.TreatmentSites),
      numberOfBeams: 0,
      isoCenter: ''
    }

    // Dose Reference Sequence para dosis prescrita e isocéntro
    if (dataset.DoseReferenceSequence && dataset.DoseReferenceSequence.length > 0) {
      const doseRef = dataset.DoseReferenceSequence[0]
      if (doseRef.TargetPrescriptionDose) {
        plan.targetPrescriptionDose = parseFloat(doseRef.TargetPrescriptionDose)
        plan.prescribedDose = plan.targetPrescriptionDose
      }
      if (doseRef.DoseReferencePointCoordinates) {
        const coords = doseRef.DoseReferencePointCoordinates
        plan.isoCenter = `(${coords[0].toFixed(1)}, ${coords[1].toFixed(1)}, ${coords[2].toFixed(1)}) mm`
      }
    }

    // Fraction Group Sequence para número de fracciones y MU
    const beamMetersets = {}
    if (dataset.FractionGroupSequence && dataset.FractionGroupSequence.length > 0) {
      const fractionGroup = dataset.FractionGroupSequence[0]
      plan.numberOfFractions = parseInt(fractionGroup.NumberOfFractionsPlanned) || 0
      
      // Referenced Beam Sequence contiene los MU por beam
      if (fractionGroup.ReferencedBeamSequence) {
        fractionGroup.ReferencedBeamSequence.forEach(refBeam => {
          const beamNumber = parseInt(refBeam.ReferencedBeamNumber)
          const meterset = parseFloat(refBeam.BeamMeterset)
          if (!isNaN(beamNumber) && !isNaN(meterset)) {
            beamMetersets[beamNumber] = meterset
          }
        })
      }
    }

    // Beam Sequence
    if (dataset.BeamSequence && dataset.BeamSequence.length > 0) {
      plan.numberOfBeams = dataset.BeamSequence.length
      
      dataset.BeamSequence.forEach(beamData => {
        const beamNumber = parseInt(beamData.BeamNumber) || 0
        
        const beam = {
          number: beamNumber,
          name: extractString(beamData.BeamName) || `Haz ${beamNumber}`,
          type: extractString(beamData.BeamType),
          technique: extractString(beamData.TreatmentDeliveryType),
          radiationType: extractString(beamData.RadiationType),
          energy: extractString(beamData.NominalBeamEnergy),
          gantryAngle: null,
          gantryRotationDirection: '',
          collimatorAngle: null,
          couchAngle: null,
          mu: beamMetersets[beamNumber] || 0,
          doseRate: extractString(beamData.DoseRateSet),
          numControlPoints: 0,
          controlPoints: [],
          jawX: null,
          jawY: null,
          isArc: false,
          arcStartAngle: null,
          arcStopAngle: null,
          numWedges: 0,
          numBlocks: 0
        }

        // Machine name
        if (beamData.TreatmentMachineName && !plan.machine) {
          plan.machine = extractString(beamData.TreatmentMachineName)
        }

        // Detectar arco
        if (beam.type && (beam.type.includes('ARC') || beam.type.includes('VMAT'))) {
          beam.isArc = true
        }

        // Wedges y Blocks
        if (beamData.NumberOfWedges) {
          beam.numWedges = parseInt(beamData.NumberOfWedges) || 0
        }
        if (beamData.NumberOfBlocks) {
          beam.numBlocks = parseInt(beamData.NumberOfBlocks) || 0
        }

        // Control Point Sequence
        if (beamData.ControlPointSequence && beamData.ControlPointSequence.length > 0) {
          beam.numControlPoints = beamData.ControlPointSequence.length
          
          beamData.ControlPointSequence.forEach((cpData, idx) => {
            const cp = {
              index: parseInt(cpData.ControlPointIndex) || idx,
              gantryAngle: cpData.GantryAngle !== undefined ? parseFloat(cpData.GantryAngle) : null,
              collimatorAngle: cpData.BeamLimitingDeviceAngle !== undefined ? parseFloat(cpData.BeamLimitingDeviceAngle) : null,
              couchAngle: cpData.PatientSupportAngle !== undefined ? parseFloat(cpData.PatientSupportAngle) : null,
              mu: cpData.CumulativeMetersetWeight !== undefined ? parseFloat(cpData.CumulativeMetersetWeight) : null,
              jawX: null,
              jawY: null,
              mlcPositions: {}
            }

            // Gantry Rotation Direction
            if (cpData.GantryRotationDirection) {
              beam.gantryRotationDirection = extractString(cpData.GantryRotationDirection)
              if (beam.gantryRotationDirection !== 'NONE' && beam.gantryRotationDirection !== '') {
                beam.isArc = true
              }
            }

            // Beam Limiting Device Position Sequence (jaws y MLC)
            if (cpData.BeamLimitingDevicePositionSequence) {
              cpData.BeamLimitingDevicePositionSequence.forEach(device => {
                const deviceType = extractString(device.RTBeamLimitingDeviceType)
                const positions = device.LeafJawPositions
                
                if (!deviceType || !positions || positions.length === 0) return

                // Jaws X
                if ((deviceType === 'ASYMX' || deviceType === 'X') && positions.length === 2) {
                  cp.jawX = positions
                }
                // Jaws Y
                else if ((deviceType === 'ASYMY' || deviceType === 'Y') && positions.length === 2) {
                  cp.jawY = positions
                }
                // MLC
                else if (positions.length > 2) {
                  cp.mlcPositions[deviceType] = positions
                }
              })
            }

            // Copiar ángulos al beam si es el primer CP
            if (idx === 0) {
              if (cp.gantryAngle !== null) beam.gantryAngle = cp.gantryAngle
              if (cp.collimatorAngle !== null) beam.collimatorAngle = cp.collimatorAngle
              if (cp.couchAngle !== null) beam.couchAngle = cp.couchAngle
              if (cp.jawX) beam.jawX = cp.jawX
              if (cp.jawY) beam.jawY = cp.jawY
            }

            beam.controlPoints.push(cp)
          })

          // Propagar jaws a CPs que no los tienen (herencia DICOM)
          let lastJawX = null
          let lastJawY = null
          beam.controlPoints.forEach(cp => {
            if (cp.jawX) lastJawX = cp.jawX
            else if (lastJawX) cp.jawX = lastJawX
            
            if (cp.jawY) lastJawY = cp.jawY
            else if (lastJawY) cp.jawY = lastJawY
          })

          // Detectar arco por ángulos de gantry
          if (beam.controlPoints.length >= 2) {
            beam.arcStartAngle = beam.controlPoints[0].gantryAngle
            beam.arcStopAngle = beam.controlPoints[beam.controlPoints.length - 1].gantryAngle
            
            const uniqueAngles = new Set(
              beam.controlPoints
                .map(cp => cp.gantryAngle)
                .filter(a => a !== null)
            )
            if (uniqueAngles.size > 5) {
              beam.isArc = true
            }
          }
        }

        plan.beams.push(beam)
      })
    }

    console.log('\n=== RESUMEN ===')
    console.log('Haces:', plan.beams.length)
    plan.beams.forEach(beam => {
      console.log(`  Beam #${beam.number} "${beam.name}": ${beam.type}, ` +
        `CPs: ${beam.controlPoints.length}, ` +
        `JawX: ${beam.jawX}, JawY: ${beam.jawY}, ` +
        `MU: ${beam.mu}`)
    })

    return plan

  } catch (err) {
    console.error('❌ Error durante el parsing:', err)
    throw new Error('Error al parsear RT Plan: ' + err.message)
  }
}

export function formatRTPlanData(plan) {
  return {
    general: [
      { label: 'Paciente', value: plan.patientName || 'N/A' },
      { label: 'ID Paciente', value: plan.patientID || 'N/A' },
      { label: 'Nombre del Plan', value: plan.planLabel || 'N/A' },
      { label: 'Descripción', value: plan.planDescription || 'N/A' },
      { label: 'Fecha', value: formatDate(plan.planDate) },
      { label: 'Hora', value: formatTime(plan.planTime) },
      { label: 'Intención', value: plan.planIntent || 'N/A' },
      { label: 'Sitio de Tratamiento', value: plan.treatmentSites || 'N/A' },
      { label: 'Número de Fracciones', value: plan.numberOfFractions || 'N/A' },
      { label: 'Dosis Prescrita', value: plan.prescribedDose ? `${plan.prescribedDose.toFixed(2)} Gy` : 'N/A' },
      { label: 'Máquina', value: plan.machine || 'N/A' },
      { label: 'Número de Haces', value: plan.numberOfBeams || plan.beams.length },
      { label: 'Isocéntro', value: plan.isoCenter || 'N/A' }
    ],
    beams: plan.beams.map(beam => ({
      number: beam.number,
      name: beam.name || `Haz ${beam.number}`,
      type: beam.type || 'N/A',
      technique: beam.technique || detectTechnique(beam),
      radiationType: beam.radiationType || 'N/A',
      energy: beam.energy || 'N/A',
      doseRate: beam.doseRate || 'N/A',
      isArc: beam.isArc,
      gantryAngle: beam.gantryAngle !== null ? beam.gantryAngle.toFixed(1) : 'N/A',
      gantryRotationDirection: beam.gantryRotationDirection || 'N/A',
      arcStartAngle: beam.arcStartAngle !== null ? beam.arcStartAngle.toFixed(1) : null,
      arcStopAngle: beam.arcStopAngle !== null ? beam.arcStopAngle.toFixed(1) : null,
      collimatorAngle: beam.collimatorAngle !== null ? beam.collimatorAngle.toFixed(1) : 'N/A',
      couchAngle: beam.couchAngle !== null ? beam.couchAngle.toFixed(1) : 'N/A',
      mu: beam.mu ? beam.mu.toFixed(2) : 'N/A',
      numControlPoints: beam.numControlPoints || beam.controlPoints.length,
      controlPoints: beam.controlPoints,
      jawX: beam.jawX ? `[${beam.jawX[0].toFixed(1)}, ${beam.jawX[1].toFixed(1)}]` : 'N/A',
      jawY: beam.jawY ? `[${beam.jawY[0].toFixed(1)}, ${beam.jawY[1].toFixed(1)}]` : 'N/A',
      numWedges: beam.numWedges || 0,
      numBlocks: beam.numBlocks || 0
    }))
  }
}

function detectTechnique(beam) {
  if (beam.isArc || beam.type?.includes('ARC') || beam.type?.includes('VMAT')) return 'VMAT'
  if (beam.gantryRotationDirection && beam.gantryRotationDirection !== 'NONE') return 'VMAT'
  
  if (beam.numControlPoints > 10 && beam.controlPoints?.length > 10) {
    const uniqueAngles = new Set(beam.controlPoints.map(cp => cp.gantryAngle).filter(a => a !== null))
    if (uniqueAngles.size > 5) return 'VMAT'
  }
  
  if (beam.arcStartAngle !== null && beam.arcStopAngle !== null) return 'VMAT'
  if (beam.numControlPoints > 2 || beam.controlPoints?.length > 2) return 'IMRT'
  if (beam.type?.includes('STATIC')) return '3DCRT'
  
  return 'N/A'
}

function formatDate(dateStr) {
  if (!dateStr || dateStr.length < 8) return 'N/A'
  return `${dateStr.slice(6, 8)}/${dateStr.slice(4, 6)}/${dateStr.slice(0, 4)}`
}

function formatTime(timeStr) {
  if (!timeStr || timeStr.length < 6) return 'N/A'
  return `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}`
}
