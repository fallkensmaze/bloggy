// NEMA NU-1 / Pylinac-like uniformity algorithms.
// Masks in exported results use 1 = excluded, 0 = included, matching canvasRenderer.

const NEMA_TARGET_PIXEL_MM = 6.4
const NEMA_PIXEL_TOL = 0.30
const NEMA_MIN_COUNTS_CENTER = 10000
const NEMA_METHOD_VERSION = 'nema-nu1-2007/2026.09'
const PIXEL_SQUARE_TOL = 0.005 // redondeo DICOM, no es una tolerancia NEMA
const NEMA_KERNEL = [1, 2, 1, 2, 4, 2, 1, 2, 1]
// Acceptance limits are a property of the equipment, not of NEMA. NU 1-2007
// defines how to measure IU and DU; what counts as passing comes from the
// manufacturer specification of a particular camera. So a profile is only
// applied when the file says it belongs to that camera, or when the user picks
// it on purpose, and the report always names the profile and its provenance.
//
// The matcher deliberately does not look at ManufacturerModelName: the Symbia
// Intevo in this department writes "Encore2" there, and the only place the
// model appears is inside SoftwareVersions ("syngo CT VC50>Symbia Intevo 6").
export const LIMIT_PROFILES = [
  {
    id: 'symbia_intevo',
    label: 'Siemens Symbia Intevo / Intevo Bold',
    source: 'Especificaciones del fabricante recogidas en el servicio',
    version: 'interna',
    fovMm: [386.0, 532.0],
    specs: {
      IUufov: 3.7,
      IUcfov: 2.9,
      DUufov: 2.7,
      DUcfov: 2.5
    },
    match(info) {
      const haystack = [
        info?.manufacturer,
        info?.modelName,
        ...(Array.isArray(info?.softwareVersions) ? info.softwareVersions : [info?.softwareVersions])
      ].filter(Boolean).join(' ').toUpperCase()

      return haystack.includes('SIEMENS') && haystack.includes('INTEVO')
    }
  }
]

export const NO_LIMIT_PROFILE = {
  id: 'none',
  label: 'Sin perfil de limites',
  source: 'Solo valores NEMA, sin comparacion con especificaciones',
  version: '-',
  fovMm: null,
  specs: null,
  match: () => false
}

export function getLimitProfile(id) {
  return LIMIT_PROFILES.find((profile) => profile.id === id) || NO_LIMIT_PROFILE
}

// Returns the profile whose match() recognises the equipment, or the empty
// profile. Never guesses: an unrecognised camera reports NEMA numbers with no
// conformity verdict attached.
export function detectLimitProfile(info) {
  return LIMIT_PROFILES.find((profile) => profile.match(info)) || NO_LIMIT_PROFILE
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

// Bounds are continuous pixel-edge coordinates; integer coordinates are pixel
// centres. At least HALF THE AREA must lie inside, including at corners.
// Rounding each dimension independently both shifts even-sized fields and
// admits corner pixels with only 25 % coverage.
function makeRectAreaMask(rows, cols, bounds) {
  const mask = new Uint8Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    const height = Math.max(0, Math.min(r + 0.5, bounds.maxR) - Math.max(r - 0.5, bounds.minR))
    if (height === 0) continue
    for (let c = 0; c < cols; c++) {
      const width = Math.max(0, Math.min(c + 0.5, bounds.maxC) - Math.max(c - 0.5, bounds.minC))
      if (height * width >= 0.5 - 1e-12) mask[r * cols + c] = 1
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

function boundsFromBBox(bbox) {
  return {
    minR: bbox.minR - 0.5, maxR: bbox.maxR + 0.5,
    minC: bbox.minC - 0.5, maxC: bbox.maxC + 0.5
  }
}

function centralBounds(bounds, fraction = 0.75) {
  const midR = (bounds.minR + bounds.maxR) / 2
  const midC = (bounds.minC + bounds.maxC) / 2
  return {
    minR: midR + fraction * (bounds.minR - midR),
    maxR: midR + fraction * (bounds.maxR - midR),
    minC: midC + fraction * (bounds.minC - midC),
    maxC: midC + fraction * (bounds.maxC - midC)
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
  let nVert = 0
  let nHoriz = 0

  if (rows >= windowSize) {
    let best = -Infinity
    for (let r = 0; r <= rows - windowSize; r++) {
      for (let c = 0; c < cols; c++) {
        let bad = false
        let mn = Infinity
        let mx = -Infinity
        for (let dr = 0; dr < windowSize; dr++) {
          const idx = (r + dr) * cols + c
          if (excludedMask[idx] || !Number.isFinite(data[idx])) {
            bad = true
            break
          }
          const value = data[idx]
          if (value < mn) mn = value
          if (value > mx) mx = value
        }
        if (!bad && mx + mn > 0) {
          nVert++
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
          if (excludedMask[idx] || !Number.isFinite(data[idx])) {
            bad = true
            break
          }
          const value = data[idx]
          if (value < mn) mn = value
          if (value > mx) mx = value
        }
        if (!bad && mx + mn > 0) {
          nHoriz++
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

  return { maxVert, maxHoriz, vertPos, horizPos, nVert, nHoriz }
}

// Only zero-valued background connected to the matrix edge is padding. A raw
// zero inside the flood may be a cold defect or ordinary counting statistics;
// it must not discard an otherwise nonzero summed pixel and its neighbours.
function exteriorZeroMask(data, rows, cols) {
  const exterior = new Uint8Array(data.length)
  const queue = new Int32Array(data.length)
  let head = 0
  let tail = 0
  const add = (i) => {
    if (data[i] !== 0 || exterior[i]) return
    exterior[i] = 1
    queue[tail++] = i
  }
  for (let c = 0; c < cols; c++) { add(c); add((rows - 1) * cols + c) }
  for (let r = 0; r < rows; r++) { add(r * cols); add(r * cols + cols - 1) }
  while (head < tail) {
    const i = queue[head++]
    const r = Math.floor(i / cols)
    const c = i % cols
    if (r > 0) add(i - cols)
    if (r + 1 < rows) add(i + cols)
    if (c > 0) add(i - 1)
    if (c + 1 < cols) add(i + 1)
  }
  return exterior
}

// Sum full blocks, retaining the protection against partially filled edge
// blocks (e.g. ten active rows out of thirteen). Propagating exterior padding
// through binning is an explicitly documented implementation extension.
// Entirely zero interior analysis pixels still follow the single-pass zero
// rule, but are reported separately and prevent a conformity verdict.
function safeBlockReduce(data, rows, cols, blockRows, blockCols) {
  const bR = Math.max(1, Math.trunc(blockRows))
  const bC = Math.max(1, Math.trunc(blockCols))

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
  const zeroContaminated = new Uint8Array(outRows * outCols)
  const exterior = exteriorZeroMask(data, rows, cols)
  const exteriorPadding = new Uint8Array(outRows * outCols)
  const interiorZero = new Uint8Array(outRows * outCols)

  for (let r = 0; r < outRows; r++) {
    for (let c = 0; c < outCols; c++) {
      let sum = 0
      let contaminated = 0
      for (let br = 0; br < bR; br++) {
        const srcR = startR + r * bR + br
        const srcOffset = srcR * cols + startC + c * bC
        for (let bc = 0; bc < bC; bc++) {
          const value = data[srcOffset + bc]
          sum += value
          if (exterior[srcOffset + bc]) contaminated = 1
        }
      }
      out[r * outCols + c] = sum
      const i = r * outCols + c
      exteriorPadding[i] = contaminated
      interiorZero[i] = sum === 0 && !contaminated ? 1 : 0
      zeroContaminated[i] = contaminated || sum === 0 ? 1 : 0
    }
  }

  return {
    data: out,
    rows: outRows,
    cols: outCols,
    zeroContaminated,
    exteriorPadding,
    interiorZero,
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
  const largest = Math.max(finalPixel[0], finalPixel[1])

  return {
    finalPixel,
    insideTolerance: finalPixel.every((value) => value >= lo && value <= hi),
    square: Math.abs(finalPixel[0] - finalPixel[1]) <= PIXEL_SQUARE_TOL * largest,
    tolerance: [lo, hi]
  }
}

function centeredBoundsFromFovMm(rows, cols, pixelSizeMm, ufovSizeMm, centerPx) {
  if (ufovSizeMm.length !== 2 || !ufovSizeMm.every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error('Dimensiones fisicas del UFOV invalidas')
  }
  const [midR, midC] = centerPx || [(rows - 1) / 2, (cols - 1) / 2]
  const halfRows = ufovSizeMm[0] / pixelSizeMm[0] / 2
  const halfCols = ufovSizeMm[1] / pixelSizeMm[1] / 2
  return {
    minR: midR - halfRows, maxR: midR + halfRows,
    minC: midC - halfCols, maxC: midC + halfCols
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

// NEMA NU 1-2007 2.4: one pass, not a loop.
//
//   1. mean counts per pixel over the geometric CFOV, on unsmoothed data
//   2. in the outer rows and columns of the UFOV, zero every pixel below 75 %
//      of that mean
//   3. zero every pixel having at least one of its four direct neighbours at
//      zero counts
//   4. exclude the pixels that already held zero counts
//
// This used to iterate until nothing more could be removed, capped at 20 % of
// the UFOV. Iterating eats the real defect at the detector edge one ring at a
// time and quietly improves the very uniformity it is meant to measure.
//
// invalidMask marks zero analysis pixels and blocks touching exterior padding.
// Treating a contaminated block as a zero pixel is a deliberate reading of the
// standard, not a quotation of it, so the neighbour rule applies around it too.
function applyNemaEdgeRule(data, rows, cols, ufovGeomMask, cfovRect, invalidMask) {
  const bbox = bboxFromMask(ufovGeomMask, rows, cols, 1)
  const cfovSeed = new Uint8Array(rows * cols)

  for (let i = 0; i < cfovSeed.length; i++) {
    cfovSeed[i] = cfovRect[i] && ufovGeomMask[i] && !invalidMask[i] ? 1 : 0
  }

  const cfovMean = meanWhere(data, cfovSeed)
  const threshold = 0.75 * cfovMean
  const seed = new Uint8Array(rows * cols)
  let nThreshold = 0

  for (let c = bbox.minC; c <= bbox.maxC; c++) {
    const topIdx = bbox.minR * cols + c
    const bottomIdx = bbox.maxR * cols + c
    if (ufovGeomMask[topIdx] && data[topIdx] < threshold && !seed[topIdx]) {
      seed[topIdx] = 1
      nThreshold++
    }
    if (ufovGeomMask[bottomIdx] && data[bottomIdx] < threshold && !seed[bottomIdx]) {
      seed[bottomIdx] = 1
      nThreshold++
    }
  }

  for (let r = bbox.minR; r <= bbox.maxR; r++) {
    const leftIdx = r * cols + bbox.minC
    const rightIdx = r * cols + bbox.maxC
    if (ufovGeomMask[leftIdx] && data[leftIdx] < threshold && !seed[leftIdx]) {
      seed[leftIdx] = 1
      nThreshold++
    }
    if (ufovGeomMask[rightIdx] && data[rightIdx] < threshold && !seed[rightIdx]) {
      seed[rightIdx] = 1
      nThreshold++
    }
  }

  let nInvalid = 0
  for (let i = 0; i < seed.length; i++) {
    if (!ufovGeomMask[i] || !invalidMask[i]) continue
    if (!seed[i]) nInvalid++
    seed[i] = 1
  }

  const expanded = dilate4(seed, rows, cols)
  const mask = new Uint8Array(rows * cols)
  let nNeighbour = 0

  for (let i = 0; i < mask.length; i++) {
    const removed = Boolean(expanded[i] && ufovGeomMask[i])
    if (removed && !seed[i]) nNeighbour++
    mask[i] = ufovGeomMask[i] && !removed ? 1 : 0
  }

  return {
    mask,
    cfovMean,
    threshold,
    nRemovedByThreshold: nThreshold,
    nRemovedZeroOrContaminated: nInvalid,
    nRemovedByNeighbour: nNeighbour,
    nRemovedTotal: nThreshold + nInvalid + nNeighbour
  }
}

function preprocessNema(data, rows, cols, options = {}) {
  let ufovBounds
  let ufovSource = 'auto_isoline'

  if (options.ufovBBox) {
    ufovBounds = boundsFromBBox(clipBBox(options.ufovBBox, rows, cols))
    ufovSource = options.ufovSource || 'ufov_bbox'
  } else if (options.ufovSizeMm && options.pixelSizeMm) {
    ufovBounds = centeredBoundsFromFovMm(rows, cols, options.pixelSizeMm, options.ufovSizeMm, options.centerPx)
    ufovSource = options.ufovSource || 'ufov_size_mm_centered'
  } else {
    ufovBounds = boundsFromBBox(estimateUfovBBoxFromIsoline(data, rows, cols, options.autoFraction ?? 0.5))
    ufovSource = `auto_isoline_${(options.autoFraction ?? 0.5).toFixed(2)}`
  }

  const ufovGeom = makeRectAreaMask(rows, cols, ufovBounds)
  const initialBBox = bboxFromMask(ufovGeom, rows, cols)
  const cfovBounds = centralBounds(ufovBounds)
  const cfovRect = makeRectAreaMask(rows, cols, cfovBounds)
  const cfovBBox = bboxFromMask(cfovRect, rows, cols)
  const invalidMask = options.invalidMask || new Uint8Array(rows * cols)
  const edge = applyNemaEdgeRule(data, rows, cols, ufovGeom, cfovRect, invalidMask)
  const validMask = edge.mask

  // The CFOV is 75 % of the linear dimensions of the geometric UFOV. Deriving
  // it from the eroded bounding box, as this used to, let a defective edge
  // shrink and shift the central field until a defect sitting on its border
  // fell outside the analysis altogether.
  const cfovMask = new Uint8Array(rows * cols)

  for (let i = 0; i < cfovMask.length; i++) {
    cfovMask[i] = cfovRect[i] && validMask[i] ? 1 : 0
  }

  const finalBBox = bboxFromMask(validMask, rows, cols, 1)
  bboxFromMask(cfovMask, rows, cols, 1)

  // Smoothed once, over the UFOV. The CFOV is interior to the UFOV, so every
  // kernel weight a CFOV pixel needs is already available here; smoothing a
  // second time against the CFOV mask, as this used to, starved the pixels on
  // the CFOV border of neighbours that were perfectly valid.
  const smoothed = nemaSmoothMasked(data, rows, cols, validMask)

  let nZeroContaminated = 0
  let nExteriorPadding = 0
  let nInteriorZero = 0
  let nPaddingIntrusion = 0
  for (let i = 0; i < invalidMask.length; i++) {
    if (invalidMask[i] && ufovGeom[i]) nZeroContaminated++
    if (options.exteriorPadding?.[i] && ufovGeom[i]) nExteriorPadding++
    if (options.interiorZero?.[i] && ufovGeom[i]) nInteriorZero++
    // A zero region connected to the exterior can also be a real edge defect.
    // If it reaches a geometrically interior analysis pixel, do not certify
    // the remaining field as uniform just because that region was excluded.
    const r = Math.floor(i / cols)
    const c = i % cols
    if (options.exteriorPadding?.[i] && ufovGeom[i] && r > 0 && r + 1 < rows
        && c > 0 && c + 1 < cols && ufovGeom[i - cols] && ufovGeom[i + cols]
        && ufovGeom[i - 1] && ufovGeom[i + 1]) nPaddingIntrusion++
  }

  return {
    ufovData: smoothed,
    cfovData: smoothed,
    ufovMask: analysisToExcludedMask(validMask),
    cfovMask: analysisToExcludedMask(cfovMask),
    ufovBBox: finalBBox,
    cfovBBox,
    metadata: {
      method: 'nema_geometric',
      methodVersion: NEMA_METHOD_VERSION,
      ufovSource,
      ufovBoundsPx: ufovBounds,
      cfovBoundsPx: cfovBounds,
      fieldInclusion: 'pixel_area_ge_50_percent',
      ufovTruncated: ufovBounds.minR < -0.5 - 1e-9 || ufovBounds.minC < -0.5 - 1e-9
        || ufovBounds.maxR > rows - 0.5 + 1e-9 || ufovBounds.maxC > cols - 0.5 + 1e-9,
      ufovBBoxInitial: initialBBox,
      ufovBBoxFinal: finalBBox,
      cfovBBoxFinal: cfovBBox,
      cfovMeanRaw: edge.cfovMean,
      edgeThreshold: edge.threshold,
      nRemovedByThreshold: edge.nRemovedByThreshold,
      nRemovedZeroOrContaminated: edge.nRemovedZeroOrContaminated,
      nRemovedByNeighbour: edge.nRemovedByNeighbour,
      nRemovedTotal: edge.nRemovedTotal,
      nZeroContaminatedInUfov: nZeroContaminated,
      nExteriorPaddingInUfov: nExteriorPadding,
      nInteriorZeroInUfov: nInteriorZero,
      nPaddingIntrusionInUfov: nPaddingIntrusion,
      zeroPolicy: 'Exterior conectado al borde: excluir bloques y vecinos; ceros interiores parciales: conservar cuentas; pixel de analisis interior a cero: excluir y no evaluar conformidad.',
      nUfovPixelsValid: validMask.reduce((sum, value) => sum + value, 0),
      nCfovPixelsValid: cfovMask.reduce((sum, value) => sum + value, 0)
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
    metadata: {
      ...metadata,
      validDuWindows: {
        ufovVertical: duUfov.nVert, ufovHorizontal: duUfov.nHoriz,
        cfovVertical: duCfov.nVert, cfovHorizontal: duCfov.nHoriz
      }
    }
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
  const preMask = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) preMask[i] = data[i] >= globalMean ? 1 : 0
  const preBBox = bboxFromMask(preMask, rows, cols, 1)
  const preCfovMask = makeRectAreaMask(rows, cols, centralBounds(boundsFromBBox(preBBox)))
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
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0
      || rawData.length !== rows * cols) {
    throw new Error('Dimensiones o longitud de la imagen invalidas')
  }
  for (const value of rawData) {
    if (!Number.isFinite(value) || value < 0) throw new Error('El flood debe contener cuentas finitas y no negativas')
  }
  if (options.pixelSpacingMm && (options.pixelSpacingMm.length !== 2
      || !options.pixelSpacingMm.every((v) => Number.isFinite(v) && v > 0))) {
    throw new Error('PixelSpacing debe contener dos distancias positivas y finitas')
  }
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
    blockSize
  )
  const pixelSizeMm = pixelValidation?.finalPixel ?? null
  const centerCount = reduced.data[Math.floor(reduced.rows / 2) * reduced.cols + Math.floor(reduced.cols / 2)]
  // Preserve the original image centre even when an odd crop removes one more
  // raw row/column from the far side. Do not recenter the physical detector on
  // the rounded output matrix.
  const centerPx = [
    (rows / 2 - reduced.cropInfo.cropStart[0]) / blockSize[0] - 0.5,
    (cols / 2 - reduced.cropInfo.cropStart[1]) / blockSize[1] - 0.5
  ]

  // No vendor geometry is assumed any more. This used to fall back to the
  // Symbia field of view whenever the pixel size was known, so any camera whose
  // DICOM lacked FieldOfViewDimensions was silently analysed over a 386 x 532 mm
  // rectangle that belonged to a different detector. Without a declared field
  // the UFOV is found from the image itself and the caller is told so.
  const vendorFovMm = options.vendorFovMm || null
  const ufovSizeMm = options.ufovSizeMm || vendorFovMm
  const ufovSource = options.ufovSizeMm
    ? 'dicom_fov_mm_centered'
    : (vendorFovMm ? 'vendor_profile_fov_mm_centered' : null)

  let prep
  try {
    prep = preprocessNema(reduced.data, reduced.rows, reduced.cols, {
      ufovSizeMm: options.autoUfovFromIsoline ? null : ufovSizeMm,
      pixelSizeMm: options.autoUfovFromIsoline ? null : pixelSizeMm,
      autoFraction: options.autoFraction ?? 0.5,
      invalidMask: reduced.zeroContaminated,
      exteriorPadding: reduced.exteriorPadding,
      interiorZero: reduced.interiorZero,
      centerPx,
      ufovSource
    })
  } catch (err) {
    prep = preprocessNema(reduced.data, reduced.rows, reduced.cols, {
      autoFraction: options.autoFraction ?? 0.5,
      invalidMask: reduced.zeroContaminated,
      exteriorPadding: reduced.exteriorPadding,
      interiorZero: reduced.interiorZero
    })
    prep.metadata.fallbackReason = err.message
  }

  // NEMA asks for at least 10 000 counts in a pixel of the analysis matrix, and
  // is read both ways in the field: the central pixel, or the busiest one. Both
  // are reported so the reader can apply either criterion without re-running.
  let maxCountCfov = 0
  for (let i = 0; i < reduced.data.length; i++) {
    if (!prep.cfovMask[i] && reduced.data[i] > maxCountCfov) maxCountCfov = reduced.data[i]
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
    maxCountCfov,
    minCountsRequired: NEMA_MIN_COUNTS_CENTER,
    centerCountWarning: centerCount < NEMA_MIN_COUNTS_CENTER,
    maxCountWarning: maxCountCfov < NEMA_MIN_COUNTS_CENTER,
    ufovSizeMm: ufovSizeMm || null,
    ufovFromImage: prep.metadata.ufovSource.startsWith('auto_isoline')
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
    'Aproximacion Pylinac',
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

// Measures the extent of the active detector area in the image itself, in
// pixels. It exists so the reader can decide empirically how a vendor ordered
// FieldOfViewDimensions instead of hardcoding a guess: the stored geometry is
// checked against what the flood actually covers.
export function measureActiveField(data, rows, cols) {
  let sum = 0
  let count = 0
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0) {
      sum += data[i]
      count++
    }
  }
  if (!count) return null

  const mask = makeThresholdMask(data, 0.5 * (sum / count))
  let component
  try {
    component = largestComponent(mask, rows, cols)
  } catch {
    return null
  }

  const { minR, maxR, minC, maxC } = component.bbox
  return {
    bbox: component.bbox,
    rowsPx: maxR - minR + 1,
    colsPx: maxC - minC + 1,
    pixelCount: component.count
  }
}

// What a resampling option actually produces on this image.
//
// The selector used to promise "78 x 78 px (7.8 mm)", which is only true for a
// 1024 matrix with 0.6 mm pixels. The block size is derived from the matrix, so
// the resulting matrix and the physical pixel depend on the file: this reports
// the real numbers, including the counts the central pixel would end up with,
// so an option that cannot reach the NEMA minimum can be labelled as such
// before it is used.
export function describeResolution(rawData, rows, cols, pixelSpacingMm, targetSize) {
  const parsedTarget = targetSize === 'auto' || targetSize == null ? null : Number(targetSize)
  const size = Number.isFinite(parsedTarget) ? parsedTarget : null
  let blockSize = [1, 1]

  if (size && size > 0) {
    blockSize = [Math.max(1, Math.floor(rows / size)), Math.max(1, Math.floor(cols / size))]
  } else if (size !== 0 && pixelSpacingMm) {
    blockSize = computeBlockSize(pixelSpacingMm) ?? [1, 1]
  }

  const [bR, bC] = blockSize
  const outRows = Math.floor(rows / bR)
  const outCols = Math.floor(cols / bC)
  const startR = Math.floor((rows - outRows * bR) / 2)
  const startC = Math.floor((cols - outCols * bC) / 2)
  const centerRow = Math.floor(outRows / 2)
  const centerCol = Math.floor(outCols / 2)
  let centerCounts = 0

  for (let br = 0; br < bR; br++) {
    const srcOffset = (startR + centerRow * bR + br) * cols + startC + centerCol * bC
    for (let bc = 0; bc < bC; bc++) centerCounts += rawData[srcOffset + bc]
  }

  return {
    blockSize,
    matrix: [outRows, outCols],
    pixelTolerance: validatePixelSize(pixelSpacingMm, blockSize),
    centerCounts,
    enoughCounts: centerCounts >= NEMA_MIN_COUNTS_CENTER,
    minCountsRequired: NEMA_MIN_COUNTS_CENTER
  }
}
