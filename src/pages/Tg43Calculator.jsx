import { useState, useRef } from 'react'
import { parseRTPlanBrachy } from '../lib/brachy/rtplanParser'
import {
  makeSourceTrain,
  calculateTotalDose,
  calculateDecayFactor,
  getSetupFractionMultiplier
} from '../lib/brachy/tg43'
import { IR192_CONSTANTS, SOURCE_MODEL } from '../lib/brachy/sourceData'
import Tg43Plan3D from '../components/brachy/Tg43Plan3D'
import '../styles/tg43.css'

function Tg43Calculator() {
  const [plan, setPlan] = useState(null)
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [calculationPoints, setCalculationPoints] = useState([])
  const [results, setResults] = useState(null)
  const [adjustedActivity, setAdjustedActivity] = useState(null)
  const [useAdjustedActivity, setUseAdjustedActivity] = useState(false)
  const [doseScope, setDoseScope] = useState('perFraction')
  
  const fileInputRef = useRef()

  const handleFileLoad = (file) => {
    if (!file) return

    setLoading(true)
    setError('')
    setResults(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsedPlan = parseRTPlanBrachy(e.target.result)
        setPlan(parsedPlan)
        setFileName(file.name)
        setLoading(false)
        
        // Cargar puntos de referencia del plan si existen
        if (parsedPlan.doseReferencePoints && parsedPlan.doseReferencePoints.length > 0) {
          const planPoints = parsedPlan.doseReferencePoints.map(point => ({
            name: point.name,
            x: point.coords[0],
            y: point.coords[1],
            z: point.coords[2],
            prescribedDosePerFraction: point.prescribedDosePerFraction ?? null,
            prescribedDoseTotal: point.prescribedDoseTotal ?? null,
            prescriptionSource: point.prescriptionSource || ''
          }))
          setCalculationPoints(planPoints)
          console.log('✓ Cargados', planPoints.length, 'puntos de referencia del plan')
        } else {
          // Si no hay puntos en el plan, inicializar con un punto de ejemplo
          setCalculationPoints([
            {
              name: 'Punto A', x: 0, y: 0, z: 20,
              prescribedDosePerFraction: null,
              prescribedDoseTotal: null,
              prescriptionSource: ''
            }
          ])
        }
      } catch (err) {
        setError('Error al parsear el archivo: ' + err.message)
        setLoading(false)
      }
    }
    reader.onerror = () => {
      setError('Error al leer el archivo')
      setLoading(false)
    }
    reader.readAsArrayBuffer(file)
  }

  const addCalculationPoint = () => {
    setCalculationPoints([
      ...calculationPoints,
      {
        name: `Punto ${calculationPoints.length + 1}`, x: 0, y: 0, z: 0,
        prescribedDosePerFraction: null,
        prescribedDoseTotal: null,
        prescriptionSource: ''
      }
    ])
  }

  const updatePoint = (index, field, value) => {
    const updated = [...calculationPoints]
    if (field === 'name') updated[index][field] = value
    else if (value === '') updated[index][field] = null
    else {
      const parsed = Number(value)
      updated[index][field] = Number.isFinite(parsed) ? parsed : null
    }
    setCalculationPoints(updated)
  }

  const removePoint = (index) => {
    setCalculationPoints(calculationPoints.filter((_, i) => i !== index))
  }

  const calculateDoses = () => {
    if (!plan || calculationPoints.length === 0) return

    try {
      // Usar actividad ajustada si está habilitada, sino usar la del plan
      const activityToUse = useAdjustedActivity && adjustedActivity !== null 
        ? adjustedActivity 
        : plan.refAirKermaRate

      const sessionSources = []
      const totalPlanSources = []
      plan.applicationSetups.forEach(setup => {
        const dwells = setup.channels.flatMap(channel => channel.dwells)
        sessionSources.push(...makeSourceTrain(
          dwells,
          activityToUse,
          IR192_CONSTANTS.doseRateConstant,
          IR192_CONSTANTS.activeLength,
          plan.halfLife
        ))
        totalPlanSources.push(...makeSourceTrain(
          dwells,
          activityToUse,
          IR192_CONSTANTS.doseRateConstant,
          IR192_CONSTANTS.activeLength,
          plan.halfLife,
          getSetupFractionMultiplier(plan, setup.number)
        ))
      })

      // Calcular dosis en cada punto
      const calculatedResults = calculationPoints.map(point => {
        // Convertir coordenadas de mm a cm
        const pointCm = {
          x: point.x / 10,
          y: point.y / 10,
          z: point.z / 10
        }

        const dosePerFraction = calculateTotalDose(sessionSources, pointCm)
        const doseTotal = calculateTotalDose(totalPlanSources, pointCm)
        const prescribedPerFraction = point.prescribedDosePerFraction
        const prescribedTotal = point.prescribedDoseTotal
        
        return {
          name: point.name,
          coords: [point.x, point.y, point.z],
          prescribedDosePerFraction: prescribedPerFraction,
          prescribedDoseTotal: prescribedTotal,
          prescriptionSource: point.prescriptionSource,
          calculatedDosePerFraction: dosePerFraction,
          calculatedDoseTotal: doseTotal,
          differencePerFraction: prescribedPerFraction !== null && prescribedPerFraction !== 0
            ? (dosePerFraction - prescribedPerFraction) / prescribedPerFraction * 100
            : null,
          differenceTotal: prescribedTotal !== null && prescribedTotal !== 0
            ? (doseTotal - prescribedTotal) / prescribedTotal * 100
            : null
        }
      })

      setResults(calculatedResults)
      console.log('Resultados:', calculatedResults)
    } catch (err) {
      setError('Error al calcular dosis: ' + err.message)
      console.error(err)
    }
  }

  const clearPlan = () => {
    setPlan(null)
    setFileName('')
    setCalculationPoints([])
    setResults(null)
    setAdjustedActivity(null)
    setUseAdjustedActivity(false)
    setDoseScope('perFraction')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Función para parsear fecha DICOM (YYYYMMDD) a Date
  const parseDicomDate = (dicomDate) => {
    if (!dicomDate || dicomDate.length < 8) return null
    const year = parseInt(dicomDate.substring(0, 4))
    const month = parseInt(dicomDate.substring(4, 6)) - 1
    const day = parseInt(dicomDate.substring(6, 8))
    return new Date(year, month, day)
  }

  // Calcular información de decaimiento
  const getDecayInfo = () => {
    if (!plan || !plan.sourceCalibrationDate) return null
    
    const calibrationDate = parseDicomDate(plan.sourceCalibrationDate)
    const treatmentDate = plan.treatmentDate ? parseDicomDate(plan.treatmentDate) : new Date()
    
    if (!calibrationDate || !treatmentDate) return null
    
    const decayFactor = calculateDecayFactor(calibrationDate, treatmentDate, plan.halfLife)
    const currentActivity = plan.refAirKermaRate * decayFactor
    const daysDiff = Math.floor((treatmentDate - calibrationDate) / (1000 * 60 * 60 * 24))
    
    return {
      calibrationDate,
      treatmentDate,
      daysDiff,
      decayFactor,
      initialActivity: plan.refAirKermaRate,
      currentActivity,
      percentRemaining: decayFactor * 100
    }
  }

  const decayInfo = getDecayInfo()

  return (
    <div className="page-body" style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
      <div className="page-header">
        <div className="page-icon"><i className="bi bi-radioactive"></i></div>
        <h1 className="page-title">Calculador TG-43</h1>
        <p className="page-subtitle">Verificación de dosis en braquiterapia HDR (Ir-192)</p>
      </div>

      {/* Upload Section */}
      {!plan ? (
        <div className="tg43-upload-section">
          <input
            ref={fileInputRef}
            type="file"
            accept=".dcm,.dicom,application/dicom"
            style={{ display: 'none' }}
            onChange={(e) => handleFileLoad(e.target.files[0])}
          />

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              e.currentTarget.style.borderColor = 'var(--accent-color)'
              e.currentTarget.style.background = 'rgba(102, 126, 234, 0.05)'
            }}
            onDragLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)'
              e.currentTarget.style.background = 'transparent'
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.style.borderColor = 'var(--border-color)'
              e.currentTarget.style.background = 'transparent'
              handleFileLoad(e.dataTransfer.files[0])
            }}
            className="tg43-dropzone"
          >
            {loading ? (
              <>
                <div className="spinner"></div>
                <p>Cargando RT Plan...</p>
              </>
            ) : (
              <>
                <i className="bi bi-file-earmark-medical" style={{ fontSize: '3rem', color: 'var(--text-muted)' }}></i>
                <p style={{ fontWeight: 600, marginTop: '12px' }}>Arrastra RT Plan de Braquiterapia aquí</p>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>o haz clic para seleccionar</p>
              </>
            )}
          </div>

          {error && (
            <div className="tg43-error">
              <i className="bi bi-exclamation-triangle"></i> {error}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Plan Info */}
          <div className="tg43-plan-info">
            <div className="tg43-plan-header">
              <div>
                <i className="bi bi-file-earmark-check"></i> {fileName}
              </div>
              <button onClick={clearPlan} className="btn-clear">
                <i className="bi bi-x-circle"></i>
              </button>
            </div>
            
            <div className="tg43-info-grid">
              <div className="tg43-info-item">
                <span className="tg43-info-label">Isótopo</span>
                <span className="tg43-info-value">{plan.sourceIsotope || 'Ir-192'}</span>
              </div>
              <div className="tg43-info-item">
                <span className="tg43-info-label">Modelo de fuente</span>
                <span className="tg43-info-value">{SOURCE_MODEL.id}</span>
              </div>
              <div className="tg43-info-item">
                <span className="tg43-info-label">Ref. Air Kerma Rate</span>
                <span className="tg43-info-value">{plan.refAirKermaRate.toFixed(3)} U</span>
              </div>
              <div className="tg43-info-item">
                <span className="tg43-info-label">Sesiones planificadas</span>
                <span className="tg43-info-value">{plan.numberOfFractions}</span>
              </div>
              <div className="tg43-info-item">
                <span className="tg43-info-label">Setups / canales</span>
                <span className="tg43-info-value">
                  {plan.applicationSetups.length} / {plan.channels.length}
                </span>
              </div>
              <div className="tg43-info-item">
                <span className="tg43-info-label">Total Dwells</span>
                <span className="tg43-info-value">
                  {plan.channels.reduce((sum, ch) => sum + ch.dwells.length, 0)}
                </span>
              </div>
            </div>

            <div className="tg43-model-note">
              <strong>{SOURCE_MODEL.name}</strong> · Λ = {SOURCE_MODEL.doseRateConstant.toFixed(4)} cGy·h⁻¹·U⁻¹ ·
              L = {SOURCE_MODEL.activeLength.toFixed(2)} cm. Datos de consenso AAPM/ESTRO 2012.
            </div>

            {plan.warnings.length > 0 && (
              <div className="tg43-warning-list">
                {plan.warnings.map((warning, index) => (
                  <div key={index}><i className="bi bi-exclamation-triangle"></i> {warning}</div>
                ))}
              </div>
            )}
          </div>

          {/* Physical source model */}
          <div className="tg43-section tg43-source-section">
            <h3><i className="bi bi-capsule"></i> Fuente y cápsula</h3>
            <div className="tg43-source-layout">
              <div>
                <div className="tg43-source-schematic" role="img" aria-label="Esquema longitudinal de la fuente GammaMed Plus HDR">
                  <div className="tg43-source-cable"><span>Cable AISI 304</span></div>
                  <div className="tg43-source-capsule">
                    <div className="tg43-source-core"><span>¹⁹²Ir</span></div>
                  </div>
                </div>
                <div className="tg43-source-dimensions">
                  <span>Cápsula: {(SOURCE_MODEL.capsuleLength * 10).toFixed(2)} × {(SOURCE_MODEL.capsuleDiameter * 10).toFixed(2)} mm</span>
                  <span>Núcleo: {(SOURCE_MODEL.activeLength * 10).toFixed(2)} × {(SOURCE_MODEL.activeDiameter * 10).toFixed(2)} mm</span>
                </div>
                <p className="tg43-source-caption">Esquema longitudinal orientativo; diámetros no representados a escala.</p>
              </div>
              <div className="tg43-source-specs">
                <div><span>Núcleo activo</span><strong>{SOURCE_MODEL.activeMaterial}</strong></div>
                <div><span>Encapsulado</span><strong>{SOURCE_MODEL.capsuleMaterial}</strong></div>
                <div><span>Diámetro interior</span><strong>{(SOURCE_MODEL.capsuleInnerDiameter * 10).toFixed(2)} mm</strong></div>
                <div><span>Densidad cápsula</span><strong>{SOURCE_MODEL.capsuleDensity.toFixed(1)} g/cm³</strong></div>
                <div><span>Cable</span><strong>{SOURCE_MODEL.cableMaterial}</strong></div>
                <div><span>Diámetro cable</span><strong>{(SOURCE_MODEL.cableDiameter * 10).toFixed(2)} mm</strong></div>
              </div>
            </div>
            <div className="tg43-source-references">
              <i className="bi bi-journal-medical"></i>
              <span>Geometría: </span>
              <a href={SOURCE_MODEL.geometryUrl} target="_blank" rel="noreferrer">{SOURCE_MODEL.geometryReference}</a>
              <span> · Dosimetría: </span>
              <a href={SOURCE_MODEL.doi} target="_blank" rel="noreferrer">AAPM/ESTRO 2012</a>
            </div>
          </div>

          {/* Decay Information */}
          {decayInfo && (
            <div className="tg43-decay-info">
              <h3><i className="bi bi-hourglass-split"></i> Referencia temporal de la fuente</h3>
              
              <div className="tg43-decay-grid">
                <div className="tg43-decay-item">
                  <span className="tg43-info-label">Fecha de referencia de Sk</span>
                  <span className="tg43-info-value">
                    {decayInfo.calibrationDate.toLocaleDateString('es-ES')}
                  </span>
                </div>
                <div className="tg43-decay-item">
                  <span className="tg43-info-label">Fecha del RTPLAN</span>
                  <span className="tg43-info-value">
                    {decayInfo.treatmentDate.toLocaleDateString('es-ES')}
                  </span>
                </div>
                <div className="tg43-decay-item">
                  <span className="tg43-info-label">Días Transcurridos</span>
                  <span className="tg43-info-value">{decayInfo.daysDiff} días</span>
                </div>
                <div className="tg43-decay-item">
                  <span className="tg43-info-label">Sk indicado en DICOM</span>
                  <span className="tg43-info-value">{decayInfo.initialActivity.toFixed(3)} U</span>
                </div>
                <div className="tg43-decay-item">
                  <span className="tg43-info-label">Sk decaído a fecha del plan</span>
                  <span className="tg43-info-value" style={{ color: 'var(--accent-color)', fontWeight: 600 }}>
                    {decayInfo.currentActivity.toFixed(3)} U
                  </span>
                </div>
                <div className="tg43-decay-item">
                  <span className="tg43-info-label">Actividad Restante</span>
                  <span className="tg43-info-value">{decayInfo.percentRemaining.toFixed(1)}%</span>
                </div>
              </div>

              <div className="tg43-activity-adjust">
                <label className="tg43-checkbox-label">
                  <input
                    type="checkbox"
                    checked={useAdjustedActivity}
                    onChange={(e) => {
                      setUseAdjustedActivity(e.target.checked)
                      if (e.target.checked && adjustedActivity === null) {
                        setAdjustedActivity(decayInfo.currentActivity)
                      }
                    }}
                  />
                  <span>Usar otro Sk para simular la entrega en una fecha distinta</span>
                </label>
                
                {useAdjustedActivity && (
                  <div className="tg43-activity-input">
                    <label>Sk alternativo (U):</label>
                    <input
                      type="number"
                      step="0.001"
                      value={adjustedActivity || ''}
                      onChange={(e) => setAdjustedActivity(parseFloat(e.target.value) || 0)}
                      className="dark-input"
                      placeholder="Ingrese actividad"
                    />
                    <button 
                      onClick={() => setAdjustedActivity(decayInfo.currentActivity)}
                      className="btn-sm"
                      style={{ marginLeft: '8px' }}
                    >
                      Usar Calculada
                    </button>
                  </div>
                )}
              </div>

              <div className="tg43-inline-note">
                Por defecto se usa el Reference Air Kerma Rate del RTPLAN: los Channel Total Time están
                definidos respecto a ese valor. El ajuste por decaimiento es opcional y cambia la entrega simulada.
              </div>
            </div>
          )}

          {/* Calculation Points */}
          <div className="tg43-section">
            <div className="tg43-section-header">
              <h3><i className="bi bi-geo-alt"></i> Puntos de Cálculo</h3>
              <button onClick={addCalculationPoint} className="btn-add">
                <i className="bi bi-plus-circle"></i> Añadir Punto
              </button>
            </div>

            <div className="tg43-points-list">
              {calculationPoints.map((point, idx) => (
                <div key={idx} className="tg43-point-card">
                  <div className="tg43-point-header">
                    <input
                      type="text"
                      value={point.name}
                      onChange={(e) => updatePoint(idx, 'name', e.target.value)}
                      className="dark-input tg43-point-name"
                      placeholder="Nombre del punto"
                    />
                    <button onClick={() => removePoint(idx)} className="btn-remove">
                      <i className="bi bi-trash"></i>
                    </button>
                  </div>
                  
                  <div className="tg43-point-coords">
                    <div className="tg43-coord-input">
                      <label>X (mm)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={point.x}
                        onChange={(e) => updatePoint(idx, 'x', e.target.value)}
                        className="dark-input"
                      />
                    </div>
                    <div className="tg43-coord-input">
                      <label>Y (mm)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={point.y}
                        onChange={(e) => updatePoint(idx, 'y', e.target.value)}
                        className="dark-input"
                      />
                    </div>
                    <div className="tg43-coord-input">
                      <label>Z (mm)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={point.z}
                        onChange={(e) => updatePoint(idx, 'z', e.target.value)}
                        className="dark-input"
                      />
                    </div>
                    <div className="tg43-coord-input">
                      <label>Dosis por sesión (Gy)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={point.prescribedDosePerFraction ?? ''}
                        onChange={(e) => updatePoint(idx, 'prescribedDosePerFraction', e.target.value)}
                        className="dark-input"
                        placeholder="Opcional"
                      />
                    </div>
                    <div className="tg43-coord-input">
                      <label>Dosis total (Gy)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={point.prescribedDoseTotal ?? ''}
                        onChange={(e) => updatePoint(idx, 'prescribedDoseTotal', e.target.value)}
                        className="dark-input"
                        placeholder="Opcional"
                      />
                    </div>
                  </div>
                  {point.prescriptionSource && (
                    <div className="tg43-prescription-source">
                      <i className="bi bi-tag"></i> {point.prescriptionSource}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button onClick={calculateDoses} className="btn-calculate">
              <i className="bi bi-calculator"></i> Calcular Dosis
            </button>
          </div>

          {/* Results */}
          {results && (
            <div className="tg43-section">
              <div className="tg43-section-header">
                <h3><i className="bi bi-clipboard-data"></i> Resultados</h3>
                <div className="tg43-scope-toggle" role="group" aria-label="Alcance de dosis">
                  <button
                    className={doseScope === 'perFraction' ? 'active' : ''}
                    onClick={() => setDoseScope('perFraction')}
                  >
                    Por sesión
                  </button>
                  <button
                    className={doseScope === 'total' ? 'active' : ''}
                    onClick={() => setDoseScope('total')}
                  >
                    Plan completo
                  </button>
                </div>
              </div>

              <div className="tg43-inline-note tg43-dose-meaning">
                {doseScope === 'perFraction'
                  ? 'Dosis calculada con los tiempos de permanencia escritos en el RTPLAN para una sesión.'
                  : `Dosis acumulada aplicando los ${plan.numberOfFractions} tratamientos indicados en Fraction Group Sequence.`}
              </div>
              
              <div className="tg43-results-table">
                <table>
                  <thead>
                    <tr>
                      <th>Punto</th>
                      <th>Coordenadas (mm)</th>
                      <th>Dosis calculada (Gy)</th>
                      <th>Dosis DICOM (Gy)</th>
                      <th>Diferencia (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result, idx) => {
                      const calculatedDose = doseScope === 'perFraction'
                        ? result.calculatedDosePerFraction
                        : result.calculatedDoseTotal
                      const prescribedDose = doseScope === 'perFraction'
                        ? result.prescribedDosePerFraction
                        : result.prescribedDoseTotal
                      const difference = doseScope === 'perFraction'
                        ? result.differencePerFraction
                        : result.differenceTotal
                      return (
                      <tr key={idx}>
                        <td className="tg43-result-name">{result.name}</td>
                        <td className="tg43-result-coords">
                          [{result.coords[0].toFixed(1)}, {result.coords[1].toFixed(1)}, {result.coords[2].toFixed(1)}]
                        </td>
                        <td className="tg43-result-dose">{calculatedDose.toFixed(3)}</td>
                        <td className="tg43-result-prescribed">
                          {prescribedDose !== null && prescribedDose !== undefined
                            ? prescribedDose.toFixed(3) : '-'}
                        </td>
                        <td className={`tg43-result-diff ${
                          difference !== null
                            ? Math.abs(difference) < 3 ? 'good' : Math.abs(difference) < 5 ? 'warning' : 'bad'
                            : ''
                        }`}>
                          {difference !== null ? `${difference > 0 ? '+' : ''}${difference.toFixed(2)}%` : '-'}
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>

              <div className="tg43-info-box">
                <i className="bi bi-info-circle"></i>
                <div>
                  <strong>Nota:</strong> Cálculo independiente TG-43 con el modelo {SOURCE_MODEL.id}. La dosis
                  “por sesión” procede de los tiempos DICOM; la dosis total usa Number of Fractions Planned.
                  Las coordenadas se conservan en el sistema paciente DICOM.
                </div>
              </div>

              <div className="tg43-3d-result-block">
                <div className="tg43-section-header">
                  <h3><i className="bi bi-box"></i> Geometría 3D del plan</h3>
                </div>
                <Tg43Plan3D plan={plan} results={results} doseScope={doseScope} />
              </div>
            </div>
          )}

          {error && (
            <div className="tg43-error">
              <i className="bi bi-exclamation-triangle"></i> {error}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default Tg43Calculator
