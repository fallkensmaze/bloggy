const list = value => value == null ? [] : Array.isArray(value) ? value : [value]
const number = value => value == null || String(value).trim() === '' ? NaN : Number(value)

/** Shared strict geometry for the standalone COR reader and monthly report. */
export function readCorGeometry(dataset, frameCount) {
  const detectors = list(dataset.DetectorInformationSequence)
  const rotations = list(dataset.RotationInformationSequence)
  const windows = list(dataset.EnergyWindowInformationSequence)
  const vector = (key, singleton = false) => {
    const values = list(dataset[key])
    if (!values.length && singleton) return Array(frameCount).fill(1)
    if (values.length !== frameCount || values.some(v => !Number.isInteger(number(v)) || number(v) < 1)) {
      throw new Error(`COR: vector ${key} ausente o inválido; no se infiere la geometría.`)
    }
    return values.map(number)
  }
  const heads = vector('DetectorVector')
  const views = vector('AngularViewVector')
  const rotationIds = vector('RotationVector', rotations.length === 1)
  const energyIds = vector('EnergyWindowVector', windows.length === 1)
  if (new Set(energyIds).size !== 1 || !windows[energyIds[0] - 1]) throw new Error('COR: se requiere una única ventana de energía identificada.')
  const seen = new Set()
  return heads.map((detectorNumber, frameIndex) => {
    const rotationNumber = rotationIds[frameIndex], viewNumber = views[frameIndex]
    const detector = detectors[detectorNumber - 1], rotation = rotations[rotationNumber - 1]
    const start = Number.isFinite(number(detector?.StartAngle)) ? number(detector.StartAngle) : number(rotation?.StartAngle)
    const step = number(rotation?.AngularStep)
    const direction = String(rotation?.RotationDirection ?? '').trim().toUpperCase()
    if (!detector || !rotation || !Number.isFinite(start) || !(step > 0 && step <= 360) || !['CW', 'CC'].includes(direction)) {
      throw new Error(`COR: geometría angular ausente o inválida en el frame ${frameIndex + 1}.`)
    }
    const count = number(rotation.NumberOfFramesInRotation)
    if (Number.isFinite(count) && (!Number.isInteger(count) || viewNumber > count)) throw new Error('COR: vista fuera de la rotación declarada.')
    const key = `${detectorNumber}:${viewNumber}`
    if (seen.has(key)) throw new Error('COR: vistas repetidas por cabezal; selecciona una sola rotación.')
    seen.add(key)
    return { frameIndex, detectorNumber, rotationNumber, viewNumber,
      angleDeg: ((start + (direction === 'CW' ? -1 : 1) * (viewNumber - 1) * step) % 360 + 360) % 360,
      angularStepDeg: step,
      frameDurationMs: number(rotation.ActualFrameDuration ?? dataset.ActualFrameDuration),
      radialPositionMm: number(list(detector.RadialPosition)[viewNumber - 1] ?? list(rotation.RadialPosition)[viewNumber - 1]) }
  })
}
