// NEMA NU-1 / Pylinac-like uniformity algorithms.
// Masks in exported results use 1 = excluded, 0 = included, matching canvasRenderer.

const NEMA_TARGET_PIXEL_MM = 6.4
const NEMA_PIXEL_TOL = 0.30
const NEMA_MIN_COUNTS_CENTER = 10000
const NEMA_KERNEL = [1, 2, 1, 2, 4, 2, 1, 2, 1]
const SYMBIA_INTEVO_FOV_MM = [386.0, 532.0] // [row_mm, col_mm]

export const SYMBIA_INTEVO_SPECS = {
  IUufov: 3.7,
  IUcfov: 2.9,
  DUufov: 2.7,
  DUcfov: 2.5
}

function isFiniteNumber(value) {
  return Number.isFinite(value)
}

function emptyErrorResult(method, error) {
  return {
    method,
    label: method,
    available: false,
    error: error instanceof Error ? error.message : String(error),
    IUufov: Number.NaN,
    IUcfov: Number.NaN,
    DUvertUfov: Number.NaN,
    DUhorizUfov: Number.NaN,
    DUvertCfov: Number.NaN,
    DUhorizCfov: Number.NaN,
    rows: 0,
    cols: 0,
    data: new Float64Array(0),
    ufovData: new Float64Array(0),
    cfovData: new Float64Array(0),
    ufovMask: new Uint8Array(0),
    cfovMask: new Uint8Array(0),
    metadata: {}
  }
}

function bboxFromMask(mask, rows, cols, validValue = 1) {
  let minR = rows
  let maxR = -1
  let minC = cols
  let maxC = -1
  let count = 0

  for (let r = 0; r < rows; r++) {
    const rowOffset = r * cols
    for (let c = 0; c < cols; c++) {
      if (mask[rowOffset + c] === validValue) {
        count++
        if (r < minR) minR = r
        if (r > maxR) maxR = r
        if (c < minC) minC = c
        if (c > maxC) maxC = c
      }
    }
  }

  if (count === 0) {
    throw new Error('Mascara vacia')
  }

  return { minR, maxR, minC, maxC, count }
}

function clipBBox(bbox, rows, cols) {
  const minR = Math.max(0, Math.min(rows - 1, Math.trunc(bbox.minR)))
  const maxR = Math.max(0, Math.min(rows - 1, Math.trunc(bbox.maxR)))
  const minC = Math.max(0, Math.min(cols - 1, Math.trunc(bbox.minC)))
  const maxC = Math.max(0, Math.min(cols - 1, Math.trunc(bbox.maxC)))

  if (maxR < minR || maxC < minC) {
    throw new Error(`Bounding box invalido: ${JSON.stringify(bbox)}`)
  }

  return { minR, maxR, minC, maxC }
}

function makeRectAnalysisMask(rows, cols, bbox) {
  const clipped = clipBBox(bbox, rows, cols)
  const mask = new Uint8Array(rows * cols)

  for (let r = clipped.minR; r <= clipped.maxR; r++) {
    const rowOffset = r * cols
    for (let c = clipped.minC; c <= clipped.maxC; c++) {
      mask[rowOffset + c] = 1
    }
  }

  return mask
}

function analysisToExcludedMask(analysisMask) {
  const out = new Uint8Array(analysisMask.length)
  for (let i = 0; i < analysisMask.length; i++) {
    out[i] = analysisMask[i] ? 0 : 1
  }
  return out
}

function cfovBoundsFromBBox(bbox) {
  const fULr = bbox.minR - 0.5
  const fULc = bbox.minC - 0.5
  const fLRr = bbox.maxR + 0.5
  const fLRc = bbox.maxC + 0.5
  const fCr = (fULr + fLRr) / 2
  const fCc = (fULc + fLRc) / 2

  return {
    minR: Math.ceil(0.25 * fCr + 0.75 * fULr - 0.5),
    minC: Math.ceil(0.25 * fCc + 0.75 * fULc - 0.5),
    maxR: Math.floor(0.25 * fCr + 0.75 * fLRr - 0.5),
    maxC: Math.floor(0.25 * fCc + 0.75 * fLRc - 0.5)
  }
}

function meanWhere(data, mask) {
  let sum = 0
  let count = 0

  for (let i = 0; i < data.length; i++) {
    if (!mask || mask[i]) {
      sum += data[i]
      count++
    }
  }

  if (count === 0) {
    throw new Error('No hay pixeles validos para calcular la media')
  }

  return sum / count
}

function finiteMinMax(data, excludedMask) {
  let mn = Infinity
  let mx = -Infinity
  let count = 0

  for (let i = 0; i < data.length; i++) {
    if (!excludedMask || !excludedMask[i]) {
      const value = data[i]
      if (!Number.isFinite(value)) continue
      if (value < mn) mn = value
      if (value > mx) mx = value
      count++
    }
  }

  return { mn, mx, count }
}

function integralUniformity(data, excludedMask) {
  const { mn, mx, count } = finiteMinMax(data, excludedMask)
  if (count === 0 || !isFiniteNumber(mn) || !isFiniteNumber(mx) || mn + mx <= 0) {
    return Number.NaN
  }
  return 100 * (mx - mn) / (mx + mn)
}

function differentialUniformity(data, excludedMask, rows, cols, windowSize = 5) {
  let maxVert = Number.NaN
  let maxHoriz = Number.NaN
  const vertPos = [null, null]
  const horizPos = [null, null]

  if (rows >= windowSize) {
    let best = -Infinity
    for (let r = 0; r <= rows - windowSize; r++) {
      for (let c = 0; c < cols; c++) {
        let bad = false
        let mn = Infinity
        let mx = -Infinity
        for (let dr = 0; dr < windowSize; dr++) {
          const idx = (r + dr) * cols + c
          if (excludedMask[idx]) {
            bad = true
            break
          }
          const value = data[idx]
          if (value < mn) mn = value
          if (value > mx) mx = value
        }
        if (!bad && mx + mn > 0) {
          const du = 100 * (mx - mn) / (mx + mn)
          if (du > best) {
            best = du
            vertPos[0] = r + Math.floor(windowSize / 2)
            vertPos[1] = c
          }
        }
      }
    }
    if (best > -Infinity) maxVert = best
  }

  if (cols >= windowSize) {
    let best = -Infinity
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols - windowSize; c++) {
        let bad = false
        let mn = Infinity
        let mx = -Infinity
        for (let dc = 0; dc < windowSize; dc++) {
          const idx = r * cols + c + dc
          if (excludedMask[idx]) {
            bad = true
            break
          }
          const value = data[idx]
          if (value < mn) mn = value
          if (value > mx) mx = value
        }
        if (!bad && mx + mn > 0) {
          const du = 100 * (mx - mn) / (mx + mn)
          if (du > best) {
            best = du
            horizPos[0] = r
            horizPos[1] = c + Math.floor(windowSize / 2)
          }
        }
      }
    }
    if (best > -Infinity) maxHoriz = best
  }

  return { maxVert, maxHoriz, vertPos, horizPos }
}

function safeBlockReduce(data, rows, cols, blockRows, blockCols) {
  const bR = Math.max(1, Math.trunc(blockRows))
  const bC = Math.max(1, Math.trunc(blockCols))

  if (bR === 1 && bC === 1) {
    return {
      data: new Float64Array(data),
      rows,
      cols,
      cropInfo: {
        originalShape: [rows, cols],
        croppedShape: [rows, cols],
        cropStart: [0, 0]
      }
    }
  }

  if (bR > rows || bC > cols) {
    throw new Error(`Bloque de resampleo mayor que la imagen: ${bR}x${bC}`)
  }

  const croppedRows = Math.floor(rows / bR) * bR
  const croppedCols = Math.floor(cols / bC) * bC
  const startR = Math.floor((rows - croppedRows) / 2)
  const startC = Math.floor((cols - croppedCols) / 2)
  const outRows = croppedRows / bR
  const outCols = croppedCols / bC
  const out = new Float64Array(outRows * outCols)

  for (let r = 0; r < outRows; r++) {
    for (let c = 0; c < outCols; c++) {
      let sum = 0
      for (let br = 0; br < bR; br++) {
        const srcR = startR + r * bR + br
        const srcOffset = srcR * cols + startC + c * bC
        for (let bc = 0; bc < bC; bc++) {
          sum += data[srcOffset + bc]
        }
      }
      out[r * outCols + c] = sum
    }
  }

  return {
    data: out,
    rows: outRows,
    cols: outCols,
    cropInfo: {
      originalShape: [rows, cols],
      croppedShape: [croppedRows, croppedCols],
      cropStart: [startR, startC]
    }
  }
}

function computeBlockSize(pixelSpacingMm, targetMm = NEMA_TARGET_PIXEL_MM) {
  if (!pixelSpacingMm || pixelSpacingMm.length < 2) return null
  return [
    Math.max(1, Math.round(targetMm / pixelSpacingMm[0])),
    Math.max(1, Math.round(targetMm / pixelSpacingMm[1]))
  ]
}

function validatePixelSize(pixelSpacingMm, blockSize, targetMm = NEMA_TARGET_PIXEL_MM) {
  if (!pixelSpacingMm || !blockSize) return null

  const finalPixel = [
    pixelSpacingMm[0] * blockSize[0],
    pixelSpacingMm[1] * blockSize[1]
  ]
  const lo = targetMm * (1 - NEMA_PIXEL_TOL)
  const hi = targetMm * (1 + NEMA_PIXEL_TOL)

  return {
    finalPixel,
    insideTolerance: finalPixel.every((value) => value >= lo && value <= hi),
    tolerance: [lo, hi]
  }
}

function centeredBBoxFromFovMm(rows, cols, pixelSizeMm, ufovSizeMm) {
  const ufovRows = Math.min(rows, Math.max(1, Math.round(ufovSizeMm[0] / pixelSizeMm[0])))
  const ufovCols = Math.min(cols, Math.max(1, Math.round(ufovSizeMm[1] / pixelSizeMm[1])))
  const minR = Math.floor((rows - ufovRows) / 2)
  const minC = Math.floor((cols - ufovCols) / 2)

  return {
    minR,
    minC,
    maxR: minR + ufovRows - 1,
    maxC: minC + ufovCols - 1
  }
}

function nemaSmoothMasked(data, rows, cols, analysisMask) {
  const out = new Float64Array(rows * cols)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let num = 0
      let den = 0
      let k = 0
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr
        for (let dc = -1; dc <= 1; dc++, k++) {
          const cc = c + dc
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue
          const idx = rr * cols + cc
          if (!analysisMask[idx]) continue
          const weight = NEMA_KERNEL[k]
          num += data[idx] * weight
          den += weight
        }
      }
      out[r * cols + c] = den > 0 ? num / den : 0
    }
  }

  return out
}

function convolveNemaKernel(data, rows, cols) {
  const out = new Float64Array(rows * cols)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0
      let k = 0
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr
        for (let dc = -1; dc <= 1; dc++, k++) {
          const cc = c + dc
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue
          sum += data[rr * cols + cc] * NEMA_KERNEL[k]
        }
      }
      out[r * cols + c] = sum / 16
    }
  }

  return out
}

function dilate4(mask, rows, cols) {
  const out = new Uint8Array(mask)

  for (let r = 0; r < rows; r++) {
    const rowOffset = r * cols
    for (let c = 0; c < cols; c++) {
      const idx = rowOffset + c
      if (!mask[idx]) continue
      if (r > 0) out[(r - 1) * cols + c] = 1
      if (r < rows - 1) out[(r + 1) * cols + c] = 1
      if (c > 0) out[idx - 1] = 1
      if (c < cols - 1) out[idx + 1] = 1
    }
  }

  return out
}

function removeBorderPixels(data, rows, cols, currentUfovMask) {
  const bbox = bboxFromMask(currentUfovMask, rows, cols, 1)
  const cfovBBox = clipBBox(cfovBoundsFromBBox(bbox), rows, cols)
  const cfovRect = makeRectAnalysisMask(rows, cols, cfovBBox)
  const cfovMask = new Uint8Array(rows * cols)

  for (let i = 0; i < cfovMask.length; i++) {
    cfovMask[i] = cfovRect[i] && currentUfovMask[i] ? 1 : 0
  }

  const cfovMean = meanWhere(data, cfovMask)
  const threshold = 0.75 * cfovMean
  const zeroByRule = new Uint8Array(rows * cols)

  for (let c = bbox.minC; c <= bbox.maxC; c++) {
    const topIdx = bbox.minR * cols + c
    const bottomIdx = bbox.maxR * cols + c
    if (currentUfovMask[topIdx] && data[topIdx] < threshold) zeroByRule[topIdx] = 1
    if (currentUfovMask[bottomIdx] && data[bottomIdx] < threshold) zeroByRule[bottomIdx] = 1
  }

  for (let r = bbox.minR; r <= bbox.maxR; r++) {
    const leftIdx = r * cols + bbox.minC
    const rightIdx = r * cols + bbox.maxC
    if (currentUfovMask[leftIdx] && data[leftIdx] < threshold) zeroByRule[leftIdx] = 1
    if (currentUfovMask[rightIdx] && data[rightIdx] < threshold) zeroByRule[rightIdx] = 1
  }

  let hasRemoval = false
  for (let i = 0; i < zeroByRule.length; i++) {
    if (zeroByRule[i]) {
      hasRemoval = true
      break
    }
  }

  if (!hasRemoval) {
    return { removed: false, mask: currentUfovMask, count: 0 }
  }

  const expanded = dilate4(zeroByRule, rows, cols)
  const next = new Uint8Array(currentUfovMask.length)
  let count = 0

  for (let i = 0; i < currentUfovMask.length; i++) {
    const remove = expanded[i] && currentUfovMask[i]
    if (remove) count++
    next[i] = currentUfovMask[i] && !remove ? 1 : 0
  }

  return { removed: true, mask: next, count }
}

function preprocessNema(data, rows, cols, options = {}) {
  let ufovGeom
  let initialBBox
  let ufovSource = 'auto_isoline'

  if (options.ufovBBox) {
    initialBBox = clipBBox(options.ufovBBox, rows, cols)
    ufovGeom = makeRectAnalysisMask(rows, cols, initialBBox)
    ufovSource = options.ufovSource || 'ufov_bbox'
  } else if (options.ufovSizeMm && options.pixelSizeMm) {
    initialBBox = centeredBBoxFromFovMm(rows, cols, options.pixelSizeMm, options.ufovSizeMm)
    initialBBox = clipBBox(initialBBox, rows, cols)
    ufovGeom = makeRectAnalysisMask(rows, cols, initialBBox)
    ufovSource = options.ufovSource || 'ufov_size_mm_centered'
  } else {
    initialBBox = estimateUfovBBoxFromIsoline(data, rows, cols, options.autoFraction ?? 0.5)
    ufovGeom = makeRectAnalysisMask(rows, cols, initialBBox)
    ufovSource = `auto_isoline_${(options.autoFraction ?? 0.5).toFixed(2)}`
  }

  let currentMask = ufovGeom
  let totalRemoved = 0
  let iteration = 0
  const maxIterations = 1000
  const initialUfovCount = ufovGeom.reduce((sum, v) => sum + v, 0)
  let maxErosionReached = false

  while (iteration < maxIterations) {
    iteration++
    const removal = removeBorderPixels(data, rows, cols, currentMask)
    currentMask = removal.mask
    totalRemoved += removal.count
    if (totalRemoved > 0.2 * initialUfovCount) { maxErosionReached = true; break }
    if (!removal.removed) break
  }

  const finalBBox = bboxFromMask(currentMask, rows, cols, 1)
  const cfovBBox = clipBBox(cfovBoundsFromBBox(finalBBox), rows, cols)
  const cfovRect = makeRectAnalysisMask(rows, cols, cfovBBox)
  const cfovMask = new Uint8Array(rows * cols)

  for (let i = 0; i < cfovMask.length; i++) {
    cfovMask[i] = cfovRect[i] && currentMask[i] ? 1 : 0
  }

  bboxFromMask(cfovMask, rows, cols, 1)

  const ufovData = nemaSmoothMasked(data, rows, cols, currentMask)
  const cfovData = nemaSmoothMasked(data, rows, cols, cfovMask)

  return {
    ufovData,
    cfovData,
    ufovMask: analysisToExcludedMask(currentMask),
    cfovMask: analysisToExcludedMask(cfovMask),
    ufovBBox: finalBBox,
    cfovBBox,
    metadata: {
      method: 'nema_geometric',
      ufovSource,
      ufovBBoxInitial: initialBBox,
      ufovBBoxFinal: finalBBox,
      cfovBBoxFinal: cfovBBox,
      nIterationsBorderRemoval: iteration,
      nRemovedTotal: totalRemoved,
      nUfovPixelsFinal: finalBBox.count,
      nCfovPixelsFinal: cfovMask.reduce((sum, value) => sum + value, 0),
      reachedMaxIterations: iteration >= maxIterations,
      maxErosionReached
    }
  }
}

function buildResult(method, label, rows, cols, data, ufovData, cfovData, ufovMask, cfovMask, metadata) {
  const duUfov = differentialUniformity(ufovData, ufovMask, rows, cols)
  const duCfov = differentialUniformity(cfovData, cfovMask, rows, cols)

  return {
    method,
    label,
    available: true,
    IUufov: integralUniformity(ufovData, ufovMask),
    IUcfov: integralUniformity(cfovData, cfovMask),
    DUvertUfov: duUfov.maxVert,
    DUhorizUfov: duUfov.maxHoriz,
    DUvertCfov: duCfov.maxVert,
    DUhorizCfov: duCfov.maxHoriz,
    vertPosU: duUfov.vertPos,
    horizPosU: duUfov.horizPos,
    vertPosC: duCfov.vertPos,
    horizPosC: duCfov.horizPos,
    data,
    ufovData,
    cfovData,
    ufovMask,
    cfovMask,
    rows,
    cols,
    metadata
  }
}

function makeThresholdMask(data, threshold) {
  const mask = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    mask[i] = data[i] > threshold ? 1 : 0
  }
  return mask
}

function largestComponent(mask, rows, cols) {
  const labels = new Int32Array(mask.length)
  const stack = new Int32Array(mask.length)
  const counts = [0]
  let label = 0
  let bestLabel = 0
  let bestCount = 0
  const bboxes = [null]

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue

    label++
    let sp = 0
    let count = 0
    let minR = rows
    let maxR = -1
    let minC = cols
    let maxC = -1
    stack[sp++] = start
    labels[start] = label

    while (sp > 0) {
      const idx = stack[--sp]
      const r = Math.floor(idx / cols)
      const c = idx - r * cols
      count++
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (c < minC) minC = c
      if (c > maxC) maxC = c

      if (r > 0) {
        const n = idx - cols
        if (mask[n] && !labels[n]) {
          labels[n] = label
          stack[sp++] = n
        }
      }
      if (r < rows - 1) {
        const n = idx + cols
        if (mask[n] && !labels[n]) {
          labels[n] = label
          stack[sp++] = n
        }
      }
      if (c > 0) {
        const n = idx - 1
        if (mask[n] && !labels[n]) {
          labels[n] = label
          stack[sp++] = n
        }
      }
      if (c < cols - 1) {
        const n = idx + 1
        if (mask[n] && !labels[n]) {
          labels[n] = label
          stack[sp++] = n
        }
      }
    }

    counts[label] = count
    bboxes[label] = { minR, maxR, minC, maxC, count }
    if (count > bestCount) {
      bestCount = count
      bestLabel = label
    }
  }

  if (!bestLabel) {
    throw new Error('No se encontro ningun campo util')
  }

  const out = new Uint8Array(mask.length)
  for (let i = 0; i < labels.length; i++) {
    out[i] = labels[i] === bestLabel ? 1 : 0
  }

  return { mask: out, bbox: bboxes[bestLabel], count: bestCount }
}

function estimateUfovBBoxFromIsoline(data, rows, cols, fraction = 0.5) {
  const globalMean = meanWhere(data, null)
  const preMask = makeThresholdMask(data, globalMean - Number.EPSILON)
  const preBBox = bboxFromMask(preMask, rows, cols, 1)
  const preCfov = clipBBox(cfovBoundsFromBBox(preBBox), rows, cols)
  const preCfovMask = makeRectAnalysisMask(rows, cols, preCfov)
  const cfovMean = meanWhere(data, preCfovMask)
  const validMask = makeThresholdMask(data, fraction * cfovMean)

  return largestComponent(validMask, rows, cols).bbox
}

function removeSmallObjects(mask, rows, cols, minSize = 2) {
  const labels = new Int32Array(mask.length)
  const stack = new Int32Array(mask.length)
  const componentIndices = []
  let label = 0

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue
    label++
    let sp = 0
    let count = 0
    componentIndices.length = 0
    stack[sp++] = start
    labels[start] = label

    while (sp > 0) {
      const idx = stack[--sp]
      componentIndices[count++] = idx
      const r = Math.floor(idx / cols)
      const c = idx - r * cols

      const neighbours = [
        r > 0 ? idx - cols : -1,
        r < rows - 1 ? idx + cols : -1,
        c > 0 ? idx - 1 : -1,
        c < cols - 1 ? idx + 1 : -1
      ]

      for (const n of neighbours) {
        if (n >= 0 && mask[n] && !labels[n]) {
          labels[n] = label
          stack[sp++] = n
        }
      }
    }

    if (count < minSize) {
      for (let i = 0; i < count; i++) mask[componentIndices[i]] = 0
    }
  }

  return mask
}

function fillSmallHoles(mask, rows, cols, areaThreshold = 2) {
  const inv = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1

  const labels = new Int32Array(mask.length)
  const stack = new Int32Array(mask.length)
  const componentIndices = []
  let label = 0

  for (let start = 0; start < inv.length; start++) {
    if (!inv[start] || labels[start]) continue
    label++
    let sp = 0
    let count = 0
    let touchesBorder = false
    componentIndices.length = 0
    stack[sp++] = start
    labels[start] = label

    while (sp > 0) {
      const idx = stack[--sp]
      componentIndices[count++] = idx
      const r = Math.floor(idx / cols)
      const c = idx - r * cols
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) touchesBorder = true

      const neighbours = [
        r > 0 ? idx - cols : -1,
        r < rows - 1 ? idx + cols : -1,
        c > 0 ? idx - 1 : -1,
        c < cols - 1 ? idx + 1 : -1
      ]

      for (const n of neighbours) {
        if (n >= 0 && inv[n] && !labels[n]) {
          labels[n] = label
          stack[sp++] = n
        }
      }
    }

    if (!touchesBorder && count <= areaThreshold) {
      for (let i = 0; i < count; i++) mask[componentIndices[i]] = 1
    }
  }

  return mask
}

function diskOffsets(radius) {
  const offsets = []
  const r = Math.ceil(radius)
  const rr = radius * radius

  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      if (dr * dr + dc * dc <= rr) offsets.push([dr, dc])
    }
  }

  return offsets
}

function isotropicErosion(mask, rows, cols, radius) {
  if (radius <= 0) return new Uint8Array(mask)

  const offsets = diskOffsets(radius)
  const out = new Uint8Array(mask.length)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      if (!mask[idx]) continue

      let keep = true
      for (const [dr, dc] of offsets) {
        const rr = r + dr
        const cc = c + dc
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols || !mask[rr * cols + cc]) {
          keep = false
          break
        }
      }
      out[idx] = keep ? 1 : 0
    }
  }

  return out
}

function getFovPylinacLike(data, rows, cols, size) {
  const binary = makeThresholdMask(data, 0)
  const largest = largestComponent(binary, rows, cols)
  const roiRows = largest.bbox.maxR - largest.bbox.minR + 1
  const roiCols = largest.bbox.maxC - largest.bbox.minC + 1
  const longestDim = Math.max(roiRows, roiCols)
  const erosion = Math.round((1 - size) * longestDim)
  const radius = erosion / 2
  const eroded = isotropicErosion(largest.mask, rows, cols, radius)
  const bbox = bboxFromMask(eroded, rows, cols, 1)
  const fovData = new Float64Array(data.length)

  for (let i = 0; i < data.length; i++) {
    fovData[i] = eroded[i] ? data[i] : 0
  }

  return {
    data: fovData,
    mask: analysisToExcludedMask(eroded),
    bbox,
    metadata: {
      sizeRatio: size,
      largestComponentBBox: largest.bbox,
      largestComponentShape: [roiRows, roiCols],
      longestDimPx: longestDim,
      erosionPx: erosion,
      erosionRadiusPx: radius,
      nPixels: bbox.count
    }
  }
}

function determinePylinacBinning(pixelSpacingMm, rows, cols, fallbackTargetSize) {
  if (pixelSpacingMm && pixelSpacingMm.length >= 2) {
    let pix = Math.min(pixelSpacingMm[0], pixelSpacingMm[1])
    let binning = 1
    while (pix < 4.48) {
      pix *= 2
      binning *= 2
    }
    return binning
  }

  if (fallbackTargetSize && fallbackTargetSize > 0) {
    return Math.max(1, Math.floor(Math.min(rows, cols) / fallbackTargetSize))
  }

  return Math.max(1, Math.floor(Math.min(rows, cols) / 128))
}

export function detectActiveCrop(data, rows, cols, options = {}) {
  const thresholdRatio = options.thresholdRatio ?? 0.10
  const marginRatio = options.marginRatio ?? 0.02
  const minAreaRatio = options.minAreaRatio ?? 0.05
  const maxCoverageForCrop = options.maxCoverageForCrop ?? 0.92
  let maxValue = -Infinity

  for (let i = 0; i < data.length; i++) {
    if (data[i] > maxValue) maxValue = data[i]
  }

  if (!Number.isFinite(maxValue) || maxValue <= 0) return null

  const mask = makeThresholdMask(data, thresholdRatio * maxValue)
  let component
  try {
    component = largestComponent(mask, rows, cols)
  } catch {
    return null
  }

  const areaRatio = component.count / (rows * cols)
  if (areaRatio < minAreaRatio) return null

  const height = component.bbox.maxR - component.bbox.minR + 1
  const width = component.bbox.maxC - component.bbox.minC + 1
  const rowCoverage = height / rows
  const colCoverage = width / cols

  if (rowCoverage >= maxCoverageForCrop && colCoverage >= maxCoverageForCrop) {
    return null
  }

  const margin = Math.max(2, Math.round(Math.max(height, width) * marginRatio))
  return clipBBox({
    minR: component.bbox.minR - margin,
    maxR: component.bbox.maxR + margin,
    minC: component.bbox.minC - margin,
    maxC: component.bbox.maxC + margin
  }, rows, cols)
}

export function cropData(data, rows, cols, bbox) {
  const clipped = clipBBox(bbox, rows, cols)
  const outRows = clipped.maxR - clipped.minR + 1
  const outCols = clipped.maxC - clipped.minC + 1
  const out = new Float64Array(outRows * outCols)

  for (let r = 0; r < outRows; r++) {
    const srcOffset = (clipped.minR + r) * cols + clipped.minC
    const dstOffset = r * outCols
    for (let c = 0; c < outCols; c++) {
      out[dstOffset + c] = data[srcOffset + c]
    }
  }

  return { data: out, rows: outRows, cols: outCols, bbox: clipped }
}

export function calculateNemaGeometric(rawData, rows, cols, options = {}) {
  const targetSize = options.targetSize
  let blockSize = [1, 1]

  if (targetSize && targetSize > 0) {
    blockSize = [
      Math.max(1, Math.floor(rows / targetSize)),
      Math.max(1, Math.floor(cols / targetSize))
    ]
  } else if (targetSize !== 0 && options.pixelSpacingMm) {
    blockSize = computeBlockSize(options.pixelSpacingMm, options.targetPixelMm ?? NEMA_TARGET_PIXEL_MM) ?? [1, 1]
  }

  const reduced = safeBlockReduce(rawData, rows, cols, blockSize[0], blockSize[1])
  const pixelValidation = validatePixelSize(
    options.pixelSpacingMm,
    blockSize,
    options.targetPixelMm ?? NEMA_TARGET_PIXEL_MM
  )
  const pixelSizeMm = pixelValidation?.finalPixel ?? null
  const centerCount = reduced.data[Math.floor(reduced.rows / 2) * reduced.cols + Math.floor(reduced.cols / 2)]
  const ufovSizeMm = options.ufovSizeMm || (pixelSizeMm ? SYMBIA_INTEVO_FOV_MM : null)

  let prep
  try {
    prep = preprocessNema(reduced.data, reduced.rows, reduced.cols, {
      ufovSizeMm: options.autoUfovFromIsoline ? null : ufovSizeMm,
      pixelSizeMm: options.autoUfovFromIsoline ? null : pixelSizeMm,
      autoFraction: options.autoFraction ?? 0.5,
      ufovSource: options.ufovSizeMm ? 'dicom_fov_mm_centered' : 'symbia_fov_mm_centered'
    })
  } catch (err) {
    prep = preprocessNema(reduced.data, reduced.rows, reduced.cols, {
      autoFraction: options.autoFraction ?? 0.5
    })
    prep.metadata.fallbackReason = err.message
  }

  const metadata = {
    ...prep.metadata,
    inputShape: [rows, cols],
    resampledShape: [reduced.rows, reduced.cols],
    blockSize,
    cropInfo: reduced.cropInfo,
    pixelSpacingOriginalMm: options.pixelSpacingMm || null,
    pixelSpacingResampledMm: pixelSizeMm,
    pixelTolerance: pixelValidation,
    centerCountResampled: centerCount,
    centerCountWarning: centerCount < NEMA_MIN_COUNTS_CENTER
  }

  return buildResult(
    'nema_geometric',
    'NEMA geometrico',
    reduced.rows,
    reduced.cols,
    reduced.data,
    prep.ufovData,
    prep.cfovData,
    prep.ufovMask,
    prep.cfovMask,
    metadata
  )
}

export function calculatePylinacLike(rawData, rows, cols, options = {}) {
  const binSize = determinePylinacBinning(options.pixelSpacingMm, rows, cols, options.targetSize)
  const reduced = safeBlockReduce(rawData, rows, cols, binSize, binSize)
  const smoothed = convolveNemaKernel(reduced.data, reduced.rows, reduced.cols)
  const total = reduced.rows * reduced.cols

  for (let c = 0; c < reduced.cols; c++) {
    smoothed[c] = 0
    smoothed[(reduced.rows - 1) * reduced.cols + c] = 0
  }
  for (let r = 0; r < reduced.rows; r++) {
    smoothed[r * reduced.cols] = 0
    smoothed[r * reduced.cols + reduced.cols - 1] = 0
  }

  let maxValue = 0
  for (let i = 0; i < total; i++) {
    if (smoothed[i] > maxValue) maxValue = smoothed[i]
  }

  if (maxValue <= 0) {
    throw new Error('No hay pixeles significativos en la imagen')
  }

  let meaningfulSum = 0
  let meaningfulCount = 0
  for (let i = 0; i < total; i++) {
    if (smoothed[i] > 0.10 * maxValue) {
      meaningfulSum += smoothed[i]
      meaningfulCount++
    }
  }

  if (meaningfulCount === 0) {
    throw new Error('No hay pixeles significativos >10% del maximo')
  }

  const thresholdRatio = options.threshold ?? 0.75
  const thresholdValue = (meaningfulSum / meaningfulCount) * thresholdRatio
  const thresholded = new Float64Array(smoothed)
  let binary = new Uint8Array(total)

  for (let i = 0; i < total; i++) {
    if (thresholded[i] < thresholdValue) thresholded[i] = 0
    binary[i] = thresholded[i] > 0 ? 1 : 0
  }

  binary = removeSmallObjects(binary, reduced.rows, reduced.cols, 2)
  binary = fillSmallHoles(binary, reduced.rows, reduced.cols, 2)
  for (let i = 0; i < total; i++) {
    if (!binary[i]) thresholded[i] = 0
  }

  const ufovRatio = options.ufovRatio ?? 0.95
  const cfovRatio = options.cfovRatio ?? 0.75
  const ufov = getFovPylinacLike(thresholded, reduced.rows, reduced.cols, ufovRatio)
  const cfov = getFovPylinacLike(thresholded, reduced.rows, reduced.cols, ufovRatio * cfovRatio)

  const metadata = {
    method: 'pylinac_like',
    inputShape: [rows, cols],
    resampledShape: [reduced.rows, reduced.cols],
    binSize,
    cropInfo: reduced.cropInfo,
    thresholdRatio,
    thresholdValue,
    ufovRatio,
    cfovRatio,
    effectiveCfovRatioTotal: ufovRatio * cfovRatio,
    ufovMeta: ufov.metadata,
    cfovMeta: cfov.metadata
  }

  return buildResult(
    'pylinac_like',
    'Pylinac/IAEA',
    reduced.rows,
    reduced.cols,
    thresholded,
    ufov.data,
    cfov.data,
    ufov.mask,
    cfov.mask,
    metadata
  )
}

export function calculateNEMAComparison(rawData, rows, cols, options = {}) {
  let inputData = rawData
  let inputRows = rows
  let inputCols = cols
  let activeCrop = null

  if (options.cropActive !== false) {
    activeCrop = detectActiveCrop(rawData, rows, cols)
    if (activeCrop) {
      const cropped = cropData(rawData, rows, cols, activeCrop)
      inputData = cropped.data
      inputRows = cropped.rows
      inputCols = cropped.cols
    }
  }

  const parsedTargetSize = options.targetSize === 'auto' || options.targetSize == null
    ? null
    : Number(options.targetSize)
  const commonOptions = {
    ...options,
    targetSize: Number.isFinite(parsedTargetSize) ? parsedTargetSize : null
  }

  let geometric
  let pylinac

  try {
    geometric = calculateNemaGeometric(inputData, inputRows, inputCols, commonOptions)
  } catch (err) {
    geometric = emptyErrorResult('nema_geometric', err)
  }

  try {
    pylinac = calculatePylinacLike(inputData, inputRows, inputCols, commonOptions)
  } catch (err) {
    pylinac = emptyErrorResult('pylinac_like', err)
  }

  return {
    input: {
      data: inputData,
      rows: inputRows,
      cols: inputCols,
      originalRows: rows,
      originalCols: cols,
      activeCrop
    },
    geometric,
    pylinac
  }
}

export function calculateNEMA(rawData, rows, cols, targetSize) {
  return calculateNEMAComparison(rawData, rows, cols, { targetSize }).geometric
}
