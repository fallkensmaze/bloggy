const DEFAULT_ROI_MM = 45
const EXPECTED_SOURCES = 3
const EPSILON = 1e-10

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function maxFinite(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? Math.max(...finite) : Number.NaN
}

function angleDistance(a, b) {
  const difference = Math.abs(((a - b + 180) % 360 + 360) % 360 - 180)
  return difference
}

function smoothProfile(profile) {
  const out = new Float64Array(profile.length)
  for (let index = 0; index < profile.length; index++) {
    const left = profile[Math.max(0, index - 1)]
    const centre = profile[index]
    const right = profile[Math.min(profile.length - 1, index + 1)]
    out[index] = (left + 2 * centre + right) / 4
  }
  return out
}

function weightedCentroid(profile, start, end) {
  let weighted = 0
  let total = 0
  for (let index = start; index <= end; index++) {
    const counts = Math.max(0, profile[index])
    weighted += index * counts
    total += counts
  }
  return total > 0 ? weighted / total : (start + end) / 2
}

function centroidAroundPeak(profile, peakIndex, minimum = 0, maximum = profile.length - 1) {
  const peak = clamp(Math.round(peakIndex), minimum, maximum)
  const halfMaximum = profile[peak] / 2
  let left = peak
  let right = peak

  while (left > minimum && profile[left] >= halfMaximum) left--
  while (right < maximum && profile[right] >= halfMaximum) right++

  const radius = Math.max(1, peak - left, right - peak)
  const start = Math.max(minimum, peak - radius)
  const end = Math.min(maximum, peak + radius)
  return {
    value: weightedCentroid(profile, start, end),
    start,
    end,
    fwhmPixels: Math.max(1, right - left)
  }
}

function detectAxialSources(frames, rows, cols, expectedSources, pixelHeight, roiSizeMm) {
  const profile = new Float64Array(rows)
  for (const frame of frames) {
    for (let row = 0; row < rows; row++) {
      const offset = row * cols
      let sum = 0
      for (let col = 0; col < cols; col++) sum += frame[offset + col]
      profile[row] += sum
    }
  }

  const smoothed = smoothProfile(smoothProfile(profile))
  const candidates = []
  for (let row = 1; row < rows - 1; row++) {
    if (smoothed[row] >= smoothed[row - 1] && smoothed[row] > smoothed[row + 1]) {
      candidates.push({ row, counts: smoothed[row] })
    }
  }
  candidates.sort((a, b) => b.counts - a.counts)

  const minimumSeparation = Math.max(4, Math.round(0.55 * roiSizeMm / pixelHeight))
  const selected = []
  for (const candidate of candidates) {
    if (selected.every((item) => Math.abs(item.row - candidate.row) >= minimumSeparation)) {
      const start = Math.max(0, candidate.row - Math.round(minimumSeparation / 3))
      const end = Math.min(rows - 1, candidate.row + Math.round(minimumSeparation / 3))
      selected.push({
        row: weightedCentroid(smoothed, start, end),
        counts: candidate.counts
      })
      if (selected.length === expectedSources) break
    }
  }

  if (selected.length !== expectedSources) {
    throw new Error(
      `Se detectaron ${selected.length} fuentes axiales; NEMA NU 1-2007 requiere ${expectedSources}`
    )
  }
  return selected.sort((a, b) => a.row - b.row)
}

function measureSource(frame, rows, cols, axialHint, roiRows, roiCols) {
  const halfRows = Math.max(2, Math.floor(roiRows / 2))
  const halfCols = Math.max(2, Math.floor(roiCols / 2))
  const centreRow = Math.round(axialHint)
  const minRow = Math.max(0, centreRow - halfRows)
  const maxRow = Math.min(rows - 1, centreRow + halfRows)
  const xProfile = new Float64Array(cols)

  for (let row = minRow; row <= maxRow; row++) {
    const offset = row * cols
    for (let col = 0; col < cols; col++) xProfile[col] += frame[offset + col]
  }

  let xPeak = 0
  for (let col = 1; col < cols; col++) {
    if (xProfile[col] > xProfile[xPeak]) xPeak = col
  }
  const xCentroid = centroidAroundPeak(xProfile, xPeak)
  const minCol = Math.max(0, Math.round(xCentroid.value) - halfCols)
  const maxCol = Math.min(cols - 1, Math.round(xCentroid.value) + halfCols)
  const yProfile = new Float64Array(rows)
  let maximumPixel = 0
  let roiCounts = 0

  for (let row = minRow; row <= maxRow; row++) {
    const offset = row * cols
    for (let col = minCol; col <= maxCol; col++) {
      const value = frame[offset + col]
      yProfile[row] += value
      roiCounts += value
      if (value > maximumPixel) maximumPixel = value
    }
  }

  let yPeak = minRow
  for (let row = minRow + 1; row <= maxRow; row++) {
    if (yProfile[row] > yProfile[yPeak]) yPeak = row
  }
  const yCentroid = centroidAroundPeak(yProfile, yPeak, minRow, maxRow)

  return {
    x: xCentroid.value,
    y: yCentroid.value,
    maximumPixel,
    roiCounts,
    transverseFwhmPixels: xCentroid.fwhmPixels,
    axialFwhmPixels: yCentroid.fwhmPixels,
    roi: { minRow, maxRow, minCol, maxCol }
  }
}

function groupByDetector(series, sourceHints, roiRows, roiCols) {
  const grouped = new Map()
  series.frames.forEach((frame, frameIndex) => {
    const frameMeta = series.frameMeta[frameIndex]
    const detectorNumber = frameMeta.detectorNumber
    if (!grouped.has(detectorNumber)) grouped.set(detectorNumber, [])
    grouped.get(detectorNumber).push({
      ...frameMeta,
      frameIndex,
      totalCounts: frame.reduce((sum, value) => sum + value, 0),
      sources: sourceHints.map((hint, sourceIndex) => ({
        sourceIndex,
        ...measureSource(frame, series.rows, series.cols, hint.row, roiRows, roiCols)
      }))
    })
  })
  for (const frames of grouped.values()) frames.sort((a, b) => a.angleDeg - b.angleDeg)
  return grouped
}

function calculateDetectorNema(detectorNumber, frames, sourceCount, centreX, pixelSpacing, frameDurationMs) {
  const [pixelHeight, pixelWidth] = pixelSpacing
  const sources = Array.from({ length: sourceCount }, (_, sourceIndex) => {
    const measurements = frames.map((frame) => ({
      ...frame.sources[sourceIndex],
      frameIndex: frame.frameIndex,
      viewNumber: frame.viewNumber,
      angleDeg: frame.angleDeg
    }))
    const corPixels = mean(measurements.map((item) => item.x))
    const axialValues = measurements.map((item) => item.y)
    return {
      sourceIndex,
      measurements,
      corPixels,
      corMm: (corPixels - centreX) * pixelWidth,
      deltaCorMm: Math.abs(corPixels - centreX) * pixelWidth,
      meanAxialPixels: mean(axialValues),
      axialDeviationMm: (Math.max(...axialValues) - Math.min(...axialValues)) * pixelHeight,
      transverseRangeMm: (
        Math.max(...measurements.map((item) => item.x)) -
        Math.min(...measurements.map((item) => item.x))
      ) * pixelWidth
    }
  })

  const angularStep = frames[0]?.angularStepDeg || 360 / Math.max(1, frames.length)
  const angleTolerance = Math.max(0.6, angularStep / 3)
  const nearestZero = frames.reduce((best, frame) => (
    angleDistance(frame.angleDeg, 0) < angleDistance(best.angleDeg, 0) ? frame : best
  ), frames[0])
  const nearest180 = frames.reduce((best, frame) => (
    angleDistance(frame.angleDeg, 180) < angleDistance(best.angleDeg, 180) ? frame : best
  ), frames[0])
  const sortedAngles = frames.map((frame) => frame.angleDeg).sort((a, b) => a - b)
  const angleGaps = sortedAngles.map((angle, index) => {
    const next = index === sortedAngles.length - 1 ? sortedAngles[0] + 360 : sortedAngles[index + 1]
    return next - angle
  })
  const expectedGap = 360 / frames.length
  const uniformAngles = angleGaps.every((gap) => Math.abs(gap - expectedGap) <= Math.max(0.6, expectedGap * 0.02))
  const zeroMaxima = nearestZero.sources.map((source) => source.maximumPixel)
  const countRates = Number.isFinite(frameDurationMs) && frameDurationMs > 0
    ? frames.map((frame) => frame.totalCounts / (frameDurationMs / 1000))
    : []

  return {
    detectorNumber,
    frames,
    sources,
    deltaCorUpperMm: maxFinite(sources.map((source) => source.deltaCorMm)),
    axialUpperMm: maxFinite(sources.map((source) => source.axialDeviationMm)),
    acquisition: {
      viewCount: frames.length,
      evenViews: frames.length % 2 === 0,
      enoughViews: frames.length >= 8,
      uniformAngles,
      includesZero: angleDistance(nearestZero.angleDeg, 0) <= angleTolerance,
      includes180: angleDistance(nearest180.angleDeg, 180) <= angleTolerance,
      zeroAngleDeg: nearestZero.angleDeg,
      angle180Deg: nearest180.angleDeg,
      zeroMaximumPixels: zeroMaxima,
      minimumZeroMaximum: Math.min(...zeroMaxima),
      enoughCountsAtZero: zeroMaxima.every((value) => value >= 5000),
      maximumCountRateCps: countRates.length ? Math.max(...countRates) : Number.NaN,
      underMaximumCountRate: countRates.length ? Math.max(...countRates) <= 20000 : null
    }
  }
}

function calculateHeadPairs(detectors, pixelSpacing) {
  const [pixelHeight, pixelWidth] = pixelSpacing
  const pairs = []
  for (let first = 0; first < detectors.length; first++) {
    for (let second = first + 1; second < detectors.length; second++) {
      const detectorA = detectors[first]
      const detectorB = detectors[second]
      const sourceCount = Math.min(detectorA.sources.length, detectorB.sources.length)
      const sources = Array.from({ length: sourceCount }, (_, sourceIndex) => {
        const sourceA = detectorA.sources[sourceIndex]
        const sourceB = detectorB.sources[sourceIndex]
        const viewDifferences = []
        for (const measurementA of sourceA.measurements) {
          const sameView = sourceB.measurements.find(
            (candidate) => candidate.viewNumber === measurementA.viewNumber
          )
          const measurementB = sameView || sourceB.measurements.reduce((best, candidate) => (
            angleDistance(candidate.angleDeg, measurementA.angleDeg) <
            angleDistance(best.angleDeg, measurementA.angleDeg) ? candidate : best
          ), sourceB.measurements[0])
          viewDifferences.push(measurementA.y - measurementB.y)
        }
        return {
          sourceIndex,
          deltaCorMm: Math.abs(sourceA.corPixels - sourceB.corPixels) * pixelWidth,
          relativeAxialMm: Math.abs(mean(viewDifferences)) * pixelHeight
        }
      })
      pairs.push({
        detectorA: detectorA.detectorNumber,
        detectorB: detectorB.detectorNumber,
        sources,
        deltaCorUpperMm: maxFinite(sources.map((source) => source.deltaCorMm)),
        relativeAxialUpperMm: maxFinite(sources.map((source) => source.relativeAxialMm))
      })
    }
  }
  return pairs
}

function matrixVector(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0))
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0)
}

function subtract(a, b) {
  return a.map((value, index) => value - b[index])
}

function add(a, b) {
  return a.map((value, index) => value + b[index])
}

function scale(vector, factor) {
  return vector.map((value) => value * factor)
}

function norm(vector) {
  return Math.sqrt(dot(vector, vector))
}

function solve3x3(matrix, vector) {
  const augmented = matrix.map((row, index) => [...row, vector[index]])
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row
    }
    if (Math.abs(augmented[pivot][col]) < EPSILON) {
      throw new Error('Geometría angular insuficiente para resolver el punto 3D')
    }
    ;[augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]]
    const divisor = augmented[col][col]
    for (let item = col; item < 4; item++) augmented[col][item] /= divisor
    for (let row = 0; row < 3; row++) {
      if (row === col) continue
      const factor = augmented[row][col]
      for (let item = col; item < 4; item++) {
        augmented[row][item] -= factor * augmented[col][item]
      }
    }
  }
  return augmented.map((row) => row[3])
}

function symmetricEigen3(matrix) {
  const values = matrix.map((row) => [...row])
  const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

  for (let iteration = 0; iteration < 40; iteration++) {
    let p = 0
    let q = 1
    let largest = Math.abs(values[p][q])
    for (const [row, col] of [[0, 2], [1, 2]]) {
      if (Math.abs(values[row][col]) > largest) {
        p = row
        q = col
        largest = Math.abs(values[row][col])
      }
    }
    if (largest < 1e-12) break

    const angle = 0.5 * Math.atan2(2 * values[p][q], values[q][q] - values[p][p])
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const rotation = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    rotation[p][p] = cosine
    rotation[q][q] = cosine
    rotation[p][q] = sine
    rotation[q][p] = -sine

    const rotated = Array.from({ length: 3 }, () => Array(3).fill(0))
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        for (let k = 0; k < 3; k++) {
          for (let l = 0; l < 3; l++) {
            rotated[row][col] += rotation[k][row] * values[k][l] * rotation[l][col]
          }
        }
      }
    }
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) values[row][col] = rotated[row][col]
    }

    const nextVectors = Array.from({ length: 3 }, () => Array(3).fill(0))
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        for (let k = 0; k < 3; k++) nextVectors[row][col] += vectors[row][k] * rotation[k][col]
      }
    }
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) vectors[row][col] = nextVectors[row][col]
    }
  }

  return [0, 1, 2]
    .map((index) => ({
      value: Math.max(values[index][index], 1e-8),
      vector: vectors.map((row) => row[index])
    }))
    .sort((a, b) => b.value - a.value)
}

function calculateBackprojectionModel(detectors, centralSourceIndex, centreX, pixelSpacing) {
  const [pixelHeight, pixelWidth] = pixelSpacing
  const centralMeasurements = detectors.flatMap((detector) => (
    detector.sources[centralSourceIndex].measurements.map((measurement) => ({
      ...measurement,
      detectorNumber: detector.detectorNumber
    }))
  ))
  const axialOrigin = mean(centralMeasurements.map((item) => item.y))
  const lines = centralMeasurements.map((measurement) => {
    const angleRad = measurement.angleDeg * Math.PI / 180
    const tangent = [-Math.sin(angleRad), Math.cos(angleRad), 0]
    const direction = [Math.cos(angleRad), Math.sin(angleRad), 0]
    const transverseMm = (measurement.x - centreX) * pixelWidth
    const axialMm = (measurement.y - axialOrigin) * pixelHeight
    return {
      detectorNumber: measurement.detectorNumber,
      frameIndex: measurement.frameIndex,
      angleDeg: measurement.angleDeg,
      transverseMm,
      axialMm,
      direction,
      point: add(scale(tangent, transverseMm), [0, 0, axialMm])
    }
  })

  const normalMatrix = Array.from({ length: 3 }, () => Array(3).fill(0))
  const right = [0, 0, 0]
  for (const line of lines) {
    const projector = Array.from({ length: 3 }, (_, row) => (
      Array.from({ length: 3 }, (_, col) => (row === col ? 1 : 0) - line.direction[row] * line.direction[col])
    ))
    const projectedPoint = matrixVector(projector, line.point)
    for (let row = 0; row < 3; row++) {
      right[row] += projectedPoint[row]
      for (let col = 0; col < 3; col++) normalMatrix[row][col] += projector[row][col]
    }
  }
  const centre = solve3x3(normalMatrix, right)
  const closestPoints = lines.map((line) => {
    const along = dot(line.direction, subtract(centre, line.point))
    const point = add(line.point, scale(line.direction, along))
    return {
      ...line,
      closestPoint: point,
      residual: subtract(point, centre),
      distanceMm: norm(subtract(point, centre))
    }
  })
  const sphereRadiusMm = Math.max(...closestPoints.map((item) => item.distanceMm))

  const covariance = Array.from({ length: 3 }, () => Array(3).fill(0))
  const denominator = Math.max(1, closestPoints.length - 1)
  for (const item of closestPoints) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        covariance[row][col] += item.residual[row] * item.residual[col] / denominator
      }
    }
  }
  const eigen = symmetricEigen3(covariance)
  let maximumMahalanobis = 1
  for (const item of closestPoints) {
    const squared = eigen.reduce((sum, axis) => {
      const component = dot(item.residual, axis.vector)
      return sum + component * component / axis.value
    }, 0)
    maximumMahalanobis = Math.max(maximumMahalanobis, squared)
  }
  const axes = eigen.map((axis) => ({
    semiAxisMm: Math.sqrt(axis.value * maximumMahalanobis),
    direction: axis.vector
  }))

  return {
    centralSourceIndex,
    centre,
    lines: closestPoints,
    sphereRadiusMm,
    sphereDiameterMm: 2 * sphereRadiusMm,
    axes,
    maximumSemiAxisMm: axes[0].semiAxisMm,
    maximumDiameterMm: 2 * axes[0].semiAxisMm,
    volumeMm3: 4 / 3 * Math.PI * axes.reduce((product, axis) => product * axis.semiAxisMm, 1),
    rmsLineDistanceMm: Math.sqrt(mean(closestPoints.map((item) => item.distanceMm ** 2)))
  }
}

export function analyzeCor(series, options = {}) {
  if (!series?.frames?.length || !series?.frameMeta?.length) {
    throw new Error('La serie COR no contiene frames o metadatos angulares')
  }
  if (!series.pixelSpacing || series.pixelSpacing.length < 2) {
    throw new Error('PixelSpacing es necesario para informar los resultados en milímetros')
  }
  if (series.frames.length !== series.frameMeta.length) {
    throw new Error('El número de frames no coincide con el vector angular DICOM')
  }

  const roiSizeMm = Number.isFinite(options.roiSizeMm) ? options.roiSizeMm : DEFAULT_ROI_MM
  const expectedSources = Number.isFinite(options.expectedSources)
    ? options.expectedSources
    : EXPECTED_SOURCES
  const [pixelHeight, pixelWidth] = series.pixelSpacing
  const centreX = (series.cols - 1) / 2
  const sourceHints = detectAxialSources(
    series.frames,
    series.rows,
    series.cols,
    expectedSources,
    pixelHeight,
    roiSizeMm
  )
  const roiRows = Math.max(3, Math.round(roiSizeMm / pixelHeight))
  const roiCols = Math.max(3, Math.round(roiSizeMm / pixelWidth))
  const grouped = groupByDetector(series, sourceHints, roiRows, roiCols)
  const detectors = [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([detectorNumber, frames]) => calculateDetectorNema(
      detectorNumber,
      frames,
      expectedSources,
      centreX,
      series.pixelSpacing,
      series.metadata?.frameDurationMs
    ))
  const pairs = calculateHeadPairs(detectors, series.pixelSpacing)
  const centralSourceIndex = Array.from({ length: expectedSources }, (_, sourceIndex) => ({
    sourceIndex,
    range: mean(detectors.map((detector) => detector.sources[sourceIndex].transverseRangeMm))
  })).sort((a, b) => a.range - b.range)[0].sourceIndex
  const geometry3d = calculateBackprojectionModel(
    detectors,
    centralSourceIndex,
    centreX,
    series.pixelSpacing
  )

  return {
    method: 'NEMA NU 1-2007 §4.1',
    roiSizeMm,
    roiPixels: [roiRows, roiCols],
    imageCentrePixels: [centreX, (series.rows - 1) / 2],
    sourceHints,
    centralSourceIndex,
    detectors,
    pairs,
    upperBounds: {
      deltaCorSingleMm: maxFinite(detectors.map((detector) => detector.deltaCorUpperMm)),
      deltaCorPairMm: maxFinite(pairs.map((pair) => pair.deltaCorUpperMm)),
      deltaAxialSingleMm: maxFinite(detectors.map((detector) => detector.axialUpperMm)),
      deltaAxialPairMm: maxFinite(pairs.map((pair) => pair.relativeAxialUpperMm))
    },
    geometry3d,
    acquisition: {
      pixelSizeUnder5Mm: pixelHeight < 5 && pixelWidth < 5,
      detectorChecks: detectors.map((detector) => ({
        detectorNumber: detector.detectorNumber,
        ...detector.acquisition
      }))
    }
  }
}

function parseLabel(value) {
  const normalised = String(value).trim().toLowerCase()
  if (['1', 'true', 'defecto', 'defect', 'fallo', 'fail', 'positivo', 'positive'].includes(normalised)) return 1
  if (['0', 'false', 'apto', 'pass', 'normal', 'negativo', 'negative'].includes(normalised)) return 0
  return Number.NaN
}

export function parseValidationCsv(text) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('El CSV debe incluir cabecera y al menos un caso')
  const delimiter = lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(delimiter).map((header) => header.trim().toLowerCase())
  const scoreIndex = headers.findIndex((header) => ['score_mm', 'resultado_mm', 'metric_mm', 'valor_mm'].includes(header))
  const labelIndex = headers.findIndex((header) => ['label', 'estado', 'defecto', 'clase'].includes(header))
  if (scoreIndex < 0 || labelIndex < 0) {
    throw new Error('Cabeceras requeridas: score_mm,label')
  }

  const records = lines.slice(1).map((line, index) => {
    const fields = line.split(delimiter).map((field) => field.trim())
    const score = Number(fields[scoreIndex].replace(',', '.'))
    const label = parseLabel(fields[labelIndex])
    if (!Number.isFinite(score) || !Number.isFinite(label)) {
      throw new Error(`Fila ${index + 2}: score o etiqueta no válidos`)
    }
    return { score, label }
  })
  if (!records.some((record) => record.label === 1) || !records.some((record) => record.label === 0)) {
    throw new Error('La cohorte debe contener casos aptos y casos con defecto')
  }
  return records
}

export function diagnosticPerformance(records, threshold) {
  if (!records?.length || !Number.isFinite(threshold)) return null
  let tp = 0
  let tn = 0
  let fp = 0
  let fn = 0
  for (const record of records) {
    const predictedPositive = record.score > threshold
    if (record.label === 1 && predictedPositive) tp++
    else if (record.label === 0 && !predictedPositive) tn++
    else if (record.label === 0 && predictedPositive) fp++
    else fn++
  }
  const wilsonInterval = (successes, total) => {
    if (!total) return [Number.NaN, Number.NaN]
    const z = 1.959963984540054
    const proportion = successes / total
    const denominator = 1 + z ** 2 / total
    const centre = (proportion + z ** 2 / (2 * total)) / denominator
    const halfWidth = z / denominator * Math.sqrt(
      proportion * (1 - proportion) / total + z ** 2 / (4 * total ** 2)
    )
    return [Math.max(0, centre - halfWidth), Math.min(1, centre + halfWidth)]
  }
  const sensitivity = tp + fn ? tp / (tp + fn) : Number.NaN
  const specificity = tn + fp ? tn / (tn + fp) : Number.NaN
  return {
    threshold,
    tp,
    tn,
    fp,
    fn,
    sensitivity,
    specificity,
    sensitivityCi95: wilsonInterval(tp, tp + fn),
    specificityCi95: wilsonInterval(tn, tn + fp),
    positivePredictiveValue: tp + fp ? tp / (tp + fp) : Number.NaN,
    negativePredictiveValue: tn + fn ? tn / (tn + fn) : Number.NaN
  }
}

export function rocAnalysis(records) {
  if (!records?.length) return null
  const scores = [...new Set(records.map((record) => record.score))].sort((a, b) => b - a)
  const padding = Math.max(1e-6, (scores[0] - scores[scores.length - 1]) * 0.01)
  const thresholds = [scores[0] + padding, ...scores, scores[scores.length - 1] - padding]
  const points = thresholds.map((threshold) => {
    const result = diagnosticPerformance(records, threshold)
    return {
      threshold,
      sensitivity: result.sensitivity,
      specificity: result.specificity,
      falsePositiveRate: 1 - result.specificity,
      youden: result.sensitivity + result.specificity - 1
    }
  }).sort((a, b) => a.falsePositiveRate - b.falsePositiveRate || a.sensitivity - b.sensitivity)
  let auc = 0
  for (let index = 1; index < points.length; index++) {
    const width = points[index].falsePositiveRate - points[index - 1].falsePositiveRate
    auc += width * (points[index].sensitivity + points[index - 1].sensitivity) / 2
  }
  const best = points.reduce((current, point) => point.youden > current.youden ? point : current, points[0])
  return { points, auc, best }
}

export function toleranceStatus(results, limits) {
  if (!results) return []
  const metrics = [
    ['deltaCorSingleMm', 'δCOR,1', results.upperBounds.deltaCorSingleMm, limits.deltaCorSingleMm],
    ['deltaCorPairMm', 'δCOR,12', results.upperBounds.deltaCorPairMm, limits.deltaCorPairMm],
    ['deltaAxialSingleMm', 'δAXIAL,1', results.upperBounds.deltaAxialSingleMm, limits.deltaAxialSingleMm],
    ['deltaAxialPairMm', 'δAXIAL,12', results.upperBounds.deltaAxialPairMm, limits.deltaAxialPairMm],
    ['ellipsoidDiameterMm', 'Diámetro elipsoide 3D', results.geometry3d.maximumDiameterMm, limits.ellipsoidDiameterMm]
  ]
  return metrics.map(([key, label, value, limit]) => ({
    key,
    label,
    value,
    limit,
    available: Number.isFinite(value) && Number.isFinite(limit),
    pass: Number.isFinite(value) && Number.isFinite(limit) ? value <= limit : null
  }))
}
