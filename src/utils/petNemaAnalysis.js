export const NEMA_SPHERE_DIAMETERS_MM = Object.freeze([10, 13, 17, 22, 28, 37])

export const PET_NEMA_DEFAULTS = Object.freeze({
  sphereThresholdFraction: 0.4,
  backgroundRoiCount: 12,
  edgeMarginMm: 15,
  sphereMarginMm: 15,
  lungInsertDiameterMm: 50,
  lungRoiDiameterMm: 30,
  lungAxialMarginMm: 30,
  partialPixelSubsamples: 8
})

function assertFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} debe ser un número mayor que cero.`)
  }
}

function swap(values, a, b) {
  const tmp = values[a]
  values[a] = values[b]
  values[b] = tmp
}

function quickSelect(values, target) {
  let left = 0
  let right = values.length - 1

  while (left < right) {
    const pivot = values[(left + right) >> 1]
    let i = left
    let j = right

    while (i <= j) {
      while (values[i] < pivot) i++
      while (values[j] > pivot) j--
      if (i <= j) {
        swap(values, i, j)
        i++
        j--
      }
    }

    if (target <= j) right = j
    else if (target >= i) left = i
    else return values[target]
  }

  return values[target]
}

function percentileWithScratch(values, percentileValue, scratch) {
  if (!values.length) throw new Error('No se puede calcular un percentil sin datos.')
  if (percentileValue < 0 || percentileValue > 100) {
    throw new Error('El percentil debe estar entre 0 y 100.')
  }

  scratch.set(values)
  const rank = (values.length - 1) * percentileValue / 100
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  const lowerValue = quickSelect(scratch, lower)
  if (lower === upper) return lowerValue

  const upperValue = quickSelect(scratch, upper)
  return lowerValue + (upperValue - lowerValue) * (rank - lower)
}

export function percentile(values, percentileValue) {
  const scratch = Float64Array.from(values)
  return percentileWithScratch(values, percentileValue, scratch)
}

function mean(values) {
  let total = 0
  for (const value of values) total += value
  return total / values.length
}

function sampleStandardDeviation(values, average = mean(values)) {
  if (values.length < 2) return Number.NaN
  let squared = 0
  for (const value of values) squared += (value - average) ** 2
  return Math.sqrt(squared / (values.length - 1))
}

function pythonRound(value) {
  const lower = Math.floor(value)
  const fraction = value - lower
  if (Math.abs(fraction - 0.5) < 1e-12) return lower % 2 === 0 ? lower : lower + 1
  return Math.round(value)
}

function connectedComponents(image, rows, cols, threshold) {
  const labels = new Int32Array(image.length)
  const queue = new Int32Array(image.length)
  const components = []
  let nextLabel = 0

  for (let start = 0; start < image.length; start++) {
    if (labels[start] !== 0 || !(image[start] > threshold)) continue

    nextLabel++
    let head = 0
    let tail = 0
    let area = 0
    let sumX = 0
    let sumY = 0
    labels[start] = nextLabel
    queue[tail++] = start

    while (head < tail) {
      const index = queue[head++]
      const y = Math.floor(index / cols)
      const x = index - y * cols
      area++
      sumX += x
      sumY += y

      if (x > 0) {
        const candidate = index - 1
        if (labels[candidate] === 0 && image[candidate] > threshold) {
          labels[candidate] = nextLabel
          queue[tail++] = candidate
        }
      }
      if (x + 1 < cols) {
        const candidate = index + 1
        if (labels[candidate] === 0 && image[candidate] > threshold) {
          labels[candidate] = nextLabel
          queue[tail++] = candidate
        }
      }
      if (y > 0) {
        const candidate = index - cols
        if (labels[candidate] === 0 && image[candidate] > threshold) {
          labels[candidate] = nextLabel
          queue[tail++] = candidate
        }
      }
      if (y + 1 < rows) {
        const candidate = index + cols
        if (labels[candidate] === 0 && image[candidate] > threshold) {
          labels[candidate] = nextLabel
          queue[tail++] = candidate
        }
      }
    }

    components.push({ label: nextLabel, area, sumX, sumY })
  }

  return { labels, components }
}

function locateBodyRange(volume, scratch) {
  const p99 = new Float64Array(volume.length)
  let maximum = -Infinity
  let maximumIndex = 0

  for (let index = 0; index < volume.length; index++) {
    const value = percentileWithScratch(volume[index], 99, scratch)
    p99[index] = value
    if (value > maximum) {
      maximum = value
      maximumIndex = index
    }
  }

  if (!(maximum > 0)) {
    throw new Error('El volumen PET no contiene señal positiva suficiente para localizar el maniquí.')
  }

  const cutoff = maximum * 0.25
  let start = maximumIndex
  let end = maximumIndex
  while (start > 0 && p99[start - 1] > cutoff) start--
  while (end + 1 < volume.length && p99[end + 1] > cutoff) end++

  return { start, end, p99 }
}

function detectCentralSlice(volume, bodyRange, rows, cols, pixelWidth, pixelHeight, thresholdFraction, scratch) {
  const minimumAreaPx = 20 / (pixelWidth * pixelHeight)
  const maximumAreaPx = 1600 / (pixelWidth * pixelHeight)
  let bestIndex = null
  let bestArea = -Infinity

  for (let index = bodyRange.start; index <= bodyRange.end; index++) {
    const slice = volume[index]
    const threshold = thresholdFraction * percentileWithScratch(slice, 99.9, scratch)
    if (!(threshold > 0)) continue

    const { components } = connectedComponents(slice, rows, cols, threshold)
    const valid = components.filter((component) => (
      component.area >= minimumAreaPx && component.area <= maximumAreaPx
    ))

    if (
      valid.length === NEMA_SPHERE_DIAMETERS_MM.length
      && Math.max(...valid.map((component) => component.area)) * pixelWidth * pixelHeight >= 200
    ) {
      const totalArea = valid.reduce((total, component) => total + component.area, 0)
      if (totalArea > bestArea) {
        bestArea = totalArea
        bestIndex = index
      }
    }
  }

  if (bestIndex == null) {
    throw new Error(
      'No se ha encontrado un corte con las seis esferas. Indica el corte central manualmente o revisa el umbral.'
    )
  }

  return bestIndex
}

export function circularRoiMean(image, rows, cols, centerX, centerY, radius, subsamples = 8) {
  const x0 = Math.max(Math.trunc(centerX - radius) - 1, 0)
  const x1 = Math.min(Math.ceil(centerX + radius) + 1, cols)
  const y0 = Math.max(Math.trunc(centerY - radius) - 1, 0)
  const y1 = Math.min(Math.ceil(centerY + radius) + 1, rows)
  const radiusSquared = radius ** 2
  const subsampleArea = subsamples ** 2
  let weightedTotal = 0
  let totalWeight = 0

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let inside = 0
      for (let sy = 0; sy < subsamples; sy++) {
        const sampleY = y + (sy + 0.5) / subsamples
        for (let sx = 0; sx < subsamples; sx++) {
          const sampleX = x + (sx + 0.5) / subsamples
          if ((sampleX - centerX) ** 2 + (sampleY - centerY) ** 2 <= radiusSquared) inside++
        }
      }

      if (inside > 0) {
        const weight = inside / subsampleArea
        weightedTotal += image[y * cols + x] * weight
        totalWeight += weight
      }
    }
  }

  if (!(totalWeight > 0)) throw new Error('La ROI circular queda fuera de la imagen.')
  return weightedTotal / totalWeight
}

function detectSpheres(slice, rows, cols, pixelWidth, pixelHeight, thresholdFraction, scratch, subsamples) {
  const threshold = thresholdFraction * percentileWithScratch(slice, 99.9, scratch)
  const { components } = connectedComponents(slice, rows, cols, threshold)

  if (components.length < NEMA_SPHERE_DIAMETERS_MM.length) {
    throw new Error(
      `Solo se han detectado ${components.length} regiones calientes; se esperaban seis esferas.`
    )
  }

  const selected = components
    .slice()
    .sort((a, b) => a.area - b.area)
    .slice(-NEMA_SPHERE_DIAMETERS_MM.length)
    .sort((a, b) => a.area - b.area)

  return selected.map((component, index) => {
    const diameterMm = NEMA_SPHERE_DIAMETERS_MM[index]
    const centerX = component.sumX / component.area + 0.5
    const centerY = component.sumY / component.area + 0.5
    return {
      diameterMm,
      centerX,
      centerY,
      detectedAreaMm2: component.area * pixelWidth * pixelHeight,
      hotConcentration: circularRoiMean(
        slice,
        rows,
        cols,
        centerX,
        centerY,
        diameterMm / 2 / pixelWidth,
        subsamples
      )
    }
  })
}

function fitSpherePlane(volume, spheres, centralSlice, rows, cols, pixelWidth, pixelHeight, dz, subsamples) {
  const firstSlice = Math.max(centralSlice - 4, 0)
  const lastSlice = Math.min(centralSlice + 4, volume.length - 1)
  const peakOffsetsMm = []

  for (const sphere of spheres) {
    const profile = []
    for (let sliceIndex = firstSlice; sliceIndex <= lastSlice; sliceIndex++) {
      profile.push(circularRoiMean(
        volume[sliceIndex],
        rows,
        cols,
        sphere.centerX,
        sphere.centerY,
        sphere.diameterMm / 2 / pixelWidth,
        subsamples
      ))
    }

    let peak = 0
    for (let index = 1; index < profile.length; index++) {
      if (profile[index] > profile[peak]) peak = index
    }

    let subSlicePeak = peak
    if (peak > 0 && peak + 1 < profile.length) {
      const y1 = profile[peak - 1]
      const y2 = profile[peak]
      const y3 = profile[peak + 1]
      const denominator = y1 - 2 * y2 + y3
      if (denominator !== 0) subSlicePeak += 0.5 * (y1 - y3) / denominator
    }

    peakOffsetsMm.push((firstSlice + subSlicePeak - centralSlice) * dz)
  }

  const xValues = spheres.map((sphere) => sphere.centerX * pixelWidth)
  const yValues = spheres.map((sphere) => sphere.centerY * pixelHeight)
  const xMean = mean(xValues)
  const yMean = mean(yValues)
  const zMean = mean(peakOffsetsMm)
  let sxx = 0
  let syy = 0
  let sxy = 0
  let sxz = 0
  let syz = 0

  for (let index = 0; index < spheres.length; index++) {
    const x = xValues[index] - xMean
    const y = yValues[index] - yMean
    const z = peakOffsetsMm[index] - zMean
    sxx += x * x
    syy += y * y
    sxy += x * y
    sxz += x * z
    syz += y * z
  }

  const determinant = sxx * syy - sxy ** 2
  const slopeX = Math.abs(determinant) > 1e-12 ? (sxz * syy - syz * sxy) / determinant : 0
  const slopeY = Math.abs(determinant) > 1e-12 ? (syz * sxx - sxz * sxy) / determinant : 0
  const inclinationDegrees = Math.atan(Math.hypot(slopeX, slopeY)) * 180 / Math.PI
  const maximumAxialDeviationMm = Math.max(...peakOffsetsMm.map((value) => Math.abs(value - zMean)))

  return {
    peakOffsetsMm,
    inclinationDegrees,
    maximumAxialDeviationMm,
    withinCoplanarityTolerance: maximumAxialDeviationMm <= 3
  }
}

function segmentPhantom(slice, rows, cols, scratch) {
  let backgroundLevel = percentileWithScratch(slice, 99, scratch)
  let mask = null

  for (let iteration = 0; iteration < 2; iteration++) {
    const { labels, components } = connectedComponents(slice, rows, cols, backgroundLevel * 0.5)
    if (!components.length) throw new Error('No se ha podido segmentar el cuerpo del maniquí.')

    const largest = components.reduce((best, component) => (
      component.area > best.area ? component : best
    ))
    mask = new Uint8Array(slice.length)
    const selectedValues = new Float64Array(largest.area)
    let selectedIndex = 0
    for (let index = 0; index < labels.length; index++) {
      if (labels[index] === largest.label) {
        mask[index] = 1
        selectedValues[selectedIndex++] = slice[index]
      }
    }
    backgroundLevel = percentile(selectedValues, 50)
  }

  return { mask, backgroundLevel }
}

function edt1d(input, output, length, locations, boundaries) {
  const infinity = 1e20
  let k = 0
  locations[0] = 0
  boundaries[0] = -infinity
  boundaries[1] = infinity

  for (let q = 1; q < length; q++) {
    let separation
    while (true) {
      const previous = locations[k]
      separation = (
        (input[q] + q * q) - (input[previous] + previous * previous)
      ) / (2 * q - 2 * previous)
      if (separation > boundaries[k]) break
      k--
    }

    k++
    locations[k] = q
    boundaries[k] = separation
    boundaries[k + 1] = infinity
  }

  k = 0
  for (let q = 0; q < length; q++) {
    while (boundaries[k + 1] < q) k++
    const delta = q - locations[k]
    output[q] = delta * delta + input[locations[k]]
  }
}

export function distanceTransform(mask, rows, cols) {
  const far = 1e12
  const intermediate = new Float64Array(mask.length)
  const result = new Float32Array(mask.length)
  const maximumLength = Math.max(rows, cols)
  const input = new Float64Array(maximumLength)
  const output = new Float64Array(maximumLength)
  const locations = new Int32Array(maximumLength)
  const boundaries = new Float64Array(maximumLength + 1)

  for (let y = 0; y < rows; y++) {
    const offset = y * cols
    for (let x = 0; x < cols; x++) input[x] = mask[offset + x] ? far : 0
    edt1d(input, output, cols, locations, boundaries)
    for (let x = 0; x < cols; x++) intermediate[offset + x] = output[x]
  }

  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) input[y] = intermediate[y * cols + x]
    edt1d(input, output, rows, locations, boundaries)
    for (let y = 0; y < rows; y++) result[y * cols + x] = Math.sqrt(output[y])
  }

  return result
}

function generateBackgroundRois(
  distanceToEdgePx,
  rows,
  cols,
  pixelWidth,
  pixelHeight,
  phantomCenter,
  spheres,
  options
) {
  const radius = NEMA_SPHERE_DIAMETERS_MM.at(-1) / 2
  const candidates = []

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const index = y * cols + x
      const depthMm = distanceToEdgePx[index] * pixelWidth
      if (depthMm < radius + options.edgeMarginMm) continue

      const xMm = (x + 0.5) * pixelWidth
      const yMm = (y + 0.5) * pixelHeight
      if (
        Math.hypot(xMm - phantomCenter.xMm, yMm - phantomCenter.yMm)
        < options.lungInsertDiameterMm / 2 + radius
      ) continue

      let sphereGapMm = Infinity
      for (const sphere of spheres) {
        const gap = Math.hypot(
          xMm - sphere.centerX * pixelWidth,
          yMm - sphere.centerY * pixelHeight
        ) - radius - sphere.diameterMm / 2
        sphereGapMm = Math.min(sphereGapMm, gap)
      }

      let angleDegrees = Math.atan2(yMm - phantomCenter.yMm, xMm - phantomCenter.xMm) * 180 / Math.PI
      if (angleDegrees < 0) angleDegrees += 360
      candidates.push({ xMm, yMm, depthMm, sphereGapMm, angleDegrees })
    }
  }

  const selected = []
  const desiredSeparation = NEMA_SPHERE_DIAMETERS_MM.at(-1) * 0.8
  const fallbackMargins = [options.sphereMarginMm, 10, 6, 3, 0]

  for (let sectorIndex = 0; sectorIndex < options.backgroundRoiCount; sectorIndex++) {
    const lowerAngle = sectorIndex * 360 / options.backgroundRoiCount
    const upperAngle = (sectorIndex + 1) * 360 / options.backgroundRoiCount
    const sector = candidates.filter((candidate) => (
      candidate.angleDegrees >= lowerAngle && candidate.angleDegrees < upperAngle
    ))

    let available = []
    for (const margin of fallbackMargins) {
      available = sector.filter((candidate) => candidate.sphereGapMm >= margin)
      if (available.length) break
    }
    if (!available.length) continue

    let chosen = available[0]
    if (!selected.length) {
      for (const candidate of available) {
        if (candidate.depthMm < chosen.depthMm) chosen = candidate
      }
    } else {
      const withSeparation = available.map((candidate) => ({
        candidate,
        nearestMm: Math.min(...selected.map((previous) => (
          Math.hypot(candidate.xMm - previous.xMm, candidate.yMm - previous.yMm)
        )))
      }))
      const free = withSeparation.filter((entry) => entry.nearestMm >= desiredSeparation)
      if (free.length) {
        let best = free[0]
        for (const entry of free) {
          if (entry.candidate.depthMm < best.candidate.depthMm) best = entry
        }
        chosen = best.candidate
      } else {
        let best = withSeparation[0]
        for (const entry of withSeparation) {
          if (entry.nearestMm > best.nearestMm) best = entry
        }
        chosen = best.candidate
      }
    }

    selected.push(chosen)
  }

  return selected
}

function maskBounds(mask, rows, cols) {
  let minRow = rows
  let maxRow = -1
  let minCol = cols
  let maxCol = -1

  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue
    const row = Math.floor(index / cols)
    const col = index - row * cols
    minRow = Math.min(minRow, row)
    maxRow = Math.max(maxRow, row)
    minCol = Math.min(minCol, col)
    maxCol = Math.max(maxCol, col)
  }

  return { minRow, maxRow, minCol, maxCol }
}

function ringGeometry(spheres, phantomCenter, pixelWidth, pixelHeight) {
  const radiiMm = spheres.map((sphere) => Math.hypot(
    sphere.centerX * pixelWidth - phantomCenter.xMm,
    sphere.centerY * pixelHeight - phantomCenter.yMm
  ))
  const averageRadiusMm = mean(radiiMm)
  const radiusSdMm = Math.sqrt(mean(radiiMm.map((value) => (value - averageRadiusMm) ** 2)))
  const angles = spheres
    .map((sphere) => {
      let angle = Math.atan2(
        sphere.centerY * pixelHeight - phantomCenter.yMm,
        sphere.centerX * pixelWidth - phantomCenter.xMm
      ) * 180 / Math.PI
      if (angle < 0) angle += 360
      return angle
    })
    .sort((a, b) => a - b)
  const angularSeparationsDegrees = angles.map((angle, index) => {
    const next = index + 1 < angles.length ? angles[index + 1] : angles[0] + 360
    return next - angle
  })

  return {
    averageRadiusMm,
    radiusSdMm,
    angularSeparationsDegrees,
    regular: radiusSdMm <= 0.1 * averageRadiusMm
      && Math.max(...angularSeparationsDegrees.map((gap) => Math.abs(gap - 60))) <= 20
  }
}

function validateSeries(series) {
  if (!series || !Array.isArray(series.volume) || !series.volume.length) {
    throw new Error('No hay un volumen PET cargado.')
  }
  if (!Number.isInteger(series.rows) || !Number.isInteger(series.cols)) {
    throw new Error('La matriz del volumen PET no es válida.')
  }
  const [pixelHeight, pixelWidth] = series.pixelSpacing || []
  assertFinitePositive(pixelWidth, 'El ancho de píxel')
  assertFinitePositive(pixelHeight, 'El alto de píxel')
  assertFinitePositive(series.dz, 'La separación axial')
  if (Math.abs(pixelWidth - pixelHeight) / pixelWidth > 1e-3) {
    throw new Error(
      `El análisis requiere píxel cuadrado (actual: ${pixelWidth.toFixed(3)} × ${pixelHeight.toFixed(3)} mm).`
    )
  }
  if (series.volume.some((slice) => slice.length !== series.rows * series.cols)) {
    throw new Error('Los cortes PET no tienen una matriz homogénea.')
  }
}

export function analyzePetNema(series, userOptions = {}) {
  validateSeries(series)
  const options = { ...PET_NEMA_DEFAULTS, ...userOptions }
  const { rows, cols, volume, dz } = series
  const [pixelHeight, pixelWidth] = series.pixelSpacing
  const sphereActivity = Number(options.sphereActivity)
  const backgroundActivity = Number(options.backgroundActivity)
  assertFinitePositive(sphereActivity, 'La actividad de las esferas')
  assertFinitePositive(backgroundActivity, 'La actividad del fondo')
  if (sphereActivity <= backgroundActivity) {
    throw new Error('La actividad de las esferas debe ser mayor que la actividad del fondo.')
  }
  if (!(options.sphereThresholdFraction > 0 && options.sphereThresholdFraction < 1)) {
    throw new Error('El umbral de esferas debe ser una fracción entre 0 y 1.')
  }

  const warnings = []
  const scratch = new Float32Array(rows * cols)
  const bodyRange = locateBodyRange(volume, scratch)
  let automaticCentralSlice = null
  let automaticDetectionError = null
  try {
    automaticCentralSlice = detectCentralSlice(
      volume,
      bodyRange,
      rows,
      cols,
      pixelWidth,
      pixelHeight,
      options.sphereThresholdFraction,
      scratch
    )
  } catch (error) {
    automaticDetectionError = error
  }

  const manualCentralSlice = options.centralSliceIndex == null || options.centralSliceIndex === ''
    ? null
    : Number(options.centralSliceIndex)
  if (manualCentralSlice != null && !Number.isInteger(manualCentralSlice)) {
    throw new Error('El corte central manual debe ser un número entero.')
  }
  const centralSlice = manualCentralSlice ?? automaticCentralSlice
  if (centralSlice == null) throw automaticDetectionError
  if (centralSlice < 0 || centralSlice >= volume.length) {
    throw new Error(`El corte central debe estar entre 1 y ${volume.length}.`)
  }
  if (automaticDetectionError && manualCentralSlice != null) {
    warnings.push(`No se pudo obtener un corte automático: ${automaticDetectionError.message}`)
  }

  const centralImage = volume[centralSlice]
  const spheres = detectSpheres(
    centralImage,
    rows,
    cols,
    pixelWidth,
    pixelHeight,
    options.sphereThresholdFraction,
    scratch,
    options.partialPixelSubsamples
  )
  const alignment = fitSpherePlane(
    volume,
    spheres,
    centralSlice,
    rows,
    cols,
    pixelWidth,
    pixelHeight,
    dz,
    options.partialPixelSubsamples
  )
  alignment.peakOffsetsMm.forEach((offset, index) => {
    spheres[index].peakOffsetMm = offset
  })
  if (!alignment.withinCoplanarityTolerance) {
    warnings.push(
      `La desviación axial máxima del plano de esferas es ${alignment.maximumAxialDeviationMm.toFixed(1)} mm; supera los 3 mm de NEMA §7.3.3.`
    )
  }

  const { mask: phantomMask, backgroundLevel } = segmentPhantom(centralImage, rows, cols, scratch)
  const distanceToEdgePx = distanceTransform(phantomMask, rows, cols)
  const phantomCenter = {
    xMm: mean(spheres.map((sphere) => sphere.centerX * pixelWidth)),
    yMm: mean(spheres.map((sphere) => sphere.centerY * pixelHeight))
  }
  const geometry = ringGeometry(spheres, phantomCenter, pixelWidth, pixelHeight)
  if (!geometry.regular) {
    warnings.push(
      `La geometría detectada de las esferas es irregular (radio ${geometry.averageRadiusMm.toFixed(0)} ± ${geometry.radiusSdMm.toFixed(0)} mm). Revisa el corte y las ROIs.`
    )
  }

  const backgroundRois = generateBackgroundRois(
    distanceToEdgePx,
    rows,
    cols,
    pixelWidth,
    pixelHeight,
    phantomCenter,
    spheres,
    options
  )
  if (backgroundRois.length !== options.backgroundRoiCount) {
    throw new Error(
      `Solo se han colocado ${backgroundRois.length}/${options.backgroundRoiCount} ROIs de fondo; no se pueden completar las 60 ROIs de NEMA §7.4.1.`
    )
  }

  let minimumBackgroundRoiSeparationMm = Infinity
  for (let a = 0; a < backgroundRois.length; a++) {
    for (let b = a + 1; b < backgroundRois.length; b++) {
      minimumBackgroundRoiSeparationMm = Math.min(
        minimumBackgroundRoiSeparationMm,
        Math.hypot(
          backgroundRois[a].xMm - backgroundRois[b].xMm,
          backgroundRois[a].yMm - backgroundRois[b].yMm
        )
      )
    }
  }
  const tightBackgroundRois = backgroundRois.filter((roi) => roi.sphereGapMm < options.sphereMarginMm).length
  if (tightBackgroundRois) {
    warnings.push(
      `${tightBackgroundRois} ROI${tightBackgroundRois === 1 ? '' : 's'} de fondo queda${tightBackgroundRois === 1 ? '' : 'n'} a menos de ${options.sphereMarginMm} mm de una esfera; se informa la holgura real.`
    )
  }

  const backgroundSliceOffsetsMm = [-20, -10, 0, 10, 20]
  const backgroundSlices = backgroundSliceOffsetsMm.map((offsetMm) => {
    const index = centralSlice + pythonRound(offsetMm / dz)
    return { index, offsetMm: (index - centralSlice) * dz }
  })
  if (backgroundSlices.some(({ index }) => index < 0 || index >= volume.length)) {
    throw new Error('Los cortes de fondo a ±2 cm se salen del volumen PET.')
  }
  if (new Set(backgroundSlices.map(({ index }) => index)).size < backgroundSlices.length) {
    warnings.push('El espaciado axial hace que dos o más cortes de fondo coincidan.')
  }

  for (const sphere of spheres) {
    const roiMeans = []
    for (const backgroundSlice of backgroundSlices) {
      for (const roi of backgroundRois) {
        roiMeans.push(circularRoiMean(
          volume[backgroundSlice.index],
          rows,
          cols,
          roi.xMm / pixelWidth,
          roi.yMm / pixelHeight,
          sphere.diameterMm / 2 / pixelWidth,
          options.partialPixelSubsamples
        ))
      }
    }
    sphere.backgroundConcentration = mean(roiMeans)
    sphere.backgroundStandardDeviation = sampleStandardDeviation(roiMeans, sphere.backgroundConcentration)
  }

  const activityRatio = sphereActivity / backgroundActivity
  for (const sphere of spheres) {
    sphere.contrastPercent = (
      (sphere.hotConcentration / sphere.backgroundConcentration - 1) / (activityRatio - 1) * 100
    )
    sphere.backgroundVariabilityPercent = (
      sphere.backgroundStandardDeviation / sphere.backgroundConcentration * 100
    )
  }

  let lungStartSlice
  let lungEndSlice
  if (options.lungRangeStartIndex != null || options.lungRangeEndIndex != null) {
    if (options.lungRangeStartIndex == null || options.lungRangeEndIndex == null) {
      throw new Error('Para fijar el rango pulmonar hay que indicar tanto el primer como el último corte.')
    }
    lungStartSlice = Number(options.lungRangeStartIndex)
    lungEndSlice = Number(options.lungRangeEndIndex)
  } else {
    const marginSlices = pythonRound(options.lungAxialMarginMm / dz)
    lungStartSlice = bodyRange.start + marginSlices
    lungEndSlice = bodyRange.end - marginSlices
  }
  if (
    !Number.isInteger(lungStartSlice)
    || !Number.isInteger(lungEndSlice)
    || lungStartSlice < 0
    || lungEndSlice >= volume.length
    || lungStartSlice > lungEndSlice
  ) {
    throw new Error('El rango axial del inserto pulmonar no es válido.')
  }

  const background37 = spheres.at(-1).backgroundConcentration
  const lungProfile = []
  for (let index = lungStartSlice; index <= lungEndSlice; index++) {
    const concentration = circularRoiMean(
      volume[index],
      rows,
      cols,
      phantomCenter.xMm / pixelWidth,
      phantomCenter.yMm / pixelHeight,
      options.lungRoiDiameterMm / 2 / pixelWidth,
      options.partialPixelSubsamples
    )
    lungProfile.push({
      sliceIndex: index,
      distanceMm: (index - centralSlice) * dz,
      concentration,
      residualErrorPercent: concentration / background37 * 100
    })
  }
  const lungErrors = lungProfile.map((point) => point.residualErrorPercent)
  const lung = {
    startSlice: lungStartSlice,
    endSlice: lungEndSlice,
    profile: lungProfile,
    meanPercent: mean(lungErrors),
    percentile5: percentile(lungErrors, 5),
    percentile95: percentile(lungErrors, 95)
  }

  const centralWindowScratch = new Float32Array(centralImage.length)
  const displayMinimum = percentileWithScratch(centralImage, 1, centralWindowScratch)
  const displayMaximum = percentileWithScratch(centralImage, 99.9, centralWindowScratch)

  return {
    standard: 'NEMA NU 2-2018 §7.4',
    options,
    activityRatio,
    bodyRange: {
      startSlice: bodyRange.start,
      endSlice: bodyRange.end,
      lengthMm: (bodyRange.end - bodyRange.start + 1) * dz
    },
    centralSlice,
    automaticCentralSlice,
    spheres,
    alignment,
    phantom: {
      ...phantomCenter,
      backgroundLevel,
      ...geometry,
      bounds: maskBounds(phantomMask, rows, cols)
    },
    backgroundRois,
    backgroundSlices,
    minimumBackgroundRoiSeparationMm,
    tightBackgroundRois,
    lung,
    displayWindow: {
      minimum: displayMinimum,
      maximum: displayMaximum > displayMinimum ? displayMaximum : displayMinimum + 1
    },
    warnings
  }
}
