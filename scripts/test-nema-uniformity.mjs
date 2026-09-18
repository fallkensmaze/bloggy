// Regression suite for the intrinsic uniformity chain: src/utils/dicomParser.js,
// src/utils/nemaAlgorithms.js and src/utils/nemaAcquisition.js.
//
// Everything here is built in memory and asserted on the numbers that come out,
// so npm run audit:public stays happy and no clinical file is needed.
//
// Why it exists: every failure this pins is silent. A uniformity number is
// always produced - nothing throws, the masks render, the badge turns green or
// red - so the only way to tell a correct IU from a plausible one is to compute
// a case whose answer is known in advance.
//
// The expected values are derived here from the rules of NEMA NU 1-2007 2.4 and
// written out beside each case, not copied from another implementation.
import assert from 'node:assert/strict'
import dcmjs from 'dcmjs'
import { parseDICOM } from '../src/utils/dicomParser.js'
import {
  calculateNemaGeometric,
  describeResolution,
  detectLimitProfile
} from '../src/utils/nemaAlgorithms.js'
import { STATES, createAcquisitionDeclaration, evaluateAcquisition } from '../src/utils/nemaAcquisition.js'
import { normalizeStoredPixel } from '../src/utils/dicomPixels.js'

const { DicomDict, DicomMetaDictionary } = dcmjs.data
const nameMap = DicomMetaDictionary.nameMap

const T = (name) => {
  if (!nameMap[name]) throw new Error(`dcmjs no conoce la keyword ${name}`)
  return nameMap[name].tag.replace(/[(),]/g, '')
}

const failures = []
const passed = []
let currentSection = ''

function section(name) {
  currentSection = name
  console.log(`\n${name}`)
}

function check(label, ok, detail = '') {
  if (ok) {
    passed.push(label)
    console.log(`  ok   ${label}${detail ? ` (${detail})` : ''}`)
  } else {
    failures.push(`${currentSection} :: ${label}${detail ? ` -> ${detail}` : ''}`)
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`)
  }
}

// Tolerances. 1e-6 % is floating point slack on a percentage; 1e-4 % is the
// slack allowed where the expected value is written as a rounded decimal.
const EXACT = 1e-6
const ROUNDED = 1e-4

const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol

// ---- Image helpers ----------------------------------------------------------
const NM_CLASS = '1.2.840.10008.5.1.4.1.1.20'
let sopCounter = 0
const nextSop = () => `1.2.826.0.1.3680043.9.6.${++sopCounter}`

function uniformField(rows, cols, value) {
  const data = new Float64Array(rows * cols)
  data.fill(value)
  return data
}

function fillBorder(data, rows, cols, thickness, value) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const onBorder = r < thickness || r >= rows - thickness
        || c < thickness || c >= cols - thickness
      if (onBorder) data[r * cols + c] = value
    }
  }
  return data
}

// A 100 x 100 analysis matrix with 6.4 mm pixels: the geometric UFOV then
// covers the whole matrix, so the border rule and the CFOV can be reasoned
// about without the resampling getting in the way.
const GRID = 100
const PIXEL_MM = 6.4
const FULL_FOV_MM = [GRID * PIXEL_MM, GRID * PIXEL_MM]

function analyse(data, overrides = {}) {
  return calculateNemaGeometric(data, GRID, GRID, {
    targetSize: 0,
    pixelSpacingMm: [PIXEL_MM, PIXEL_MM],
    ufovSizeMm: FULL_FOV_MM,
    ...overrides
  })
}

// ---- Case 1: uniform field --------------------------------------------------
// Nothing is below 75 % of the CFOV mean, nothing is zero, so nothing is
// removed and the smoothing of a constant is that constant: max equals min.
section('Caso 1: campo uniforme')
const uniform = analyse(uniformField(GRID, GRID, 10000))
check('IU UFOV = 0', near(uniform.IUufov, 0, EXACT), `${uniform.IUufov}`)
check('IU CFOV = 0', near(uniform.IUcfov, 0, EXACT), `${uniform.IUcfov}`)
check('DU UFOV = 0', near(Math.max(uniform.DUvertUfov, uniform.DUhorizUfov), 0, EXACT))
check('DU CFOV = 0', near(Math.max(uniform.DUvertCfov, uniform.DUhorizCfov), 0, EXACT))
check('no se elimina ningun pixel', uniform.metadata.nRemovedTotal === 0,
  `${uniform.metadata.nRemovedTotal}`)
check('el CFOV incluye simetricamente los pixeles con 50 % de area',
  uniform.metadata.cfovBBoxFinal.minR === 12 && uniform.metadata.cfovBBoxFinal.maxR === 87,
  `filas ${uniform.metadata.cfovBBoxFinal.minR}-${uniform.metadata.cfovBBoxFinal.maxR}`)
// Physical edges: [-0.5,99.5], central 75 %: [12,87]. Rows/columns 12 and
// 87 each have half coverage. Their four intersections have only 25 %.
check('las cuatro esquinas con 25 % quedan fuera del CFOV',
  [[12, 12], [12, 87], [87, 12], [87, 87]].every(([r, c]) => uniform.cfovMask[r * GRID + c] === 1))
check('el CFOV tiene 76 x 76 menos cuatro pixeles', uniform.metadata.nCfovPixelsValid === 5772)

// ---- Case 2: four-pixel low border ------------------------------------------
// Interior 10 000, the four outer rows and columns at 50.
//
// One pass, and only one: the 75 % rule marks the outermost ring (396 pixels of
// the 100 x 100 perimeter), the neighbour rule takes the ring behind it (388),
// and it stops there. Rings three and four keep their 50 counts and stay in the
// analysis, which is the whole point - they are the defect being measured.
//
// A pixel in ring three is surrounded by ring three and ring four, all at 50,
// so it smooths to 50. The interior smooths to 10 000. Therefore
//   IU = 100 x (10000 - 50) / (10000 + 50) = 99.004975 %
// The iterative version this replaced kept eating ring after ring until the
// defect was gone and reported a healthy detector.
section('Caso 2: borde bajo de cuatro pixeles')
const border4 = analyse(fillBorder(uniformField(GRID, GRID, 10000), GRID, GRID, 4, 50))
check('la eliminacion por umbral toca solo el anillo exterior',
  border4.metadata.nRemovedByThreshold === 396, `${border4.metadata.nRemovedByThreshold}`)
check('la regla de vecindad toca solo el anillo siguiente',
  border4.metadata.nRemovedByNeighbour === 388, `${border4.metadata.nRemovedByNeighbour}`)
check('el defecto sigue dentro del UFOV', border4.IUufov > 0, `${border4.IUufov}`)
check('IU UFOV = 99,004975 %', near(border4.IUufov, 99.004975, ROUNDED), `${border4.IUufov}`)
check('el CFOV no ve el borde y queda uniforme', near(border4.IUcfov, 0, EXACT), `${border4.IUcfov}`)

// ---- Case 3: interior zero --------------------------------------------------
// A dead pixel is excluded together with its four direct neighbours, once. What
// is left is uniform, so IU and DU are zero: the zero neither survives to make
// IU 100 % nor drags a neighbourhood down through the smoothing.
section('Caso 3: cero interior')
const withHole = uniformField(GRID, GRID, 10000)
withHole[50 * GRID + 50] = 0
const hole = analyse(withHole)
check('se excluye el pixel a cero', hole.metadata.nRemovedZeroOrContaminated === 1,
  `${hole.metadata.nRemovedZeroOrContaminated}`)
check('se excluyen sus cuatro vecinos', hole.metadata.nRemovedByNeighbour === 4,
  `${hole.metadata.nRemovedByNeighbour}`)
check('IU UFOV = 0 en el campo restante', near(hole.IUufov, 0, EXACT), `${hole.IUufov}`)
check('IU CFOV = 0 en el campo restante', near(hole.IUcfov, 0, EXACT), `${hole.IUcfov}`)
check('DU UFOV = 0 en el campo restante',
  near(Math.max(hole.DUvertUfov, hole.DUhorizUfov), 0, EXACT))

// ---- Case 4: defect on the border of the original CFOV ----------------------
// One low peripheral ring triggers the edge rule, so the valid mask shrinks to
// rows 2..97. Deriving the CFOV from that eroded box would give rows 13..85;
// deriving it from the geometric UFOV gives rows 12..87 (excluding corners).
//
// The defect sits at row 12, exactly on that boundary. Its value is 5000, and
// smoothing puts 4/16 of the pixel on itself and 12/16 on neighbours at 10 000:
//   min = (4 x 5000 + 12 x 10000) / 16 = 8750
//   IU  = 100 x (10000 - 8750) / (10000 + 8750) = 6.666667 %
// With the old, shrunken CFOV the defect would fall outside and only its
// neighbour at row 13 would register, giving 3.2 % - a defect quietly halved.
section('Caso 4: defecto en el limite del CFOV original')
const cfovEdge = fillBorder(uniformField(GRID, GRID, 10000), GRID, GRID, 1, 50)
cfovEdge[12 * GRID + 50] = 5000
const edgeDefect = analyse(cfovEdge)
check('el CFOV no encoge con el borde eliminado',
  edgeDefect.metadata.cfovBBoxFinal.minR === 12 && edgeDefect.metadata.cfovBBoxFinal.maxR === 87,
  `filas ${edgeDefect.metadata.cfovBBoxFinal.minR}-${edgeDefect.metadata.cfovBBoxFinal.maxR}`)
check('el UFOV valido si se reduce a las filas 2-97',
  edgeDefect.metadata.ufovBBoxFinal.minR === 2 && edgeDefect.metadata.ufovBBoxFinal.maxR === 97,
  `filas ${edgeDefect.metadata.ufovBBoxFinal.minR}-${edgeDefect.metadata.ufovBBoxFinal.maxR}`)
check('el defecto sigue contando en el CFOV', edgeDefect.IUcfov > 0, `${edgeDefect.IUcfov}`)
check('IU CFOV = 6,666667 %', near(edgeDefect.IUcfov, 6.666667, ROUNDED), `${edgeDefect.IUcfov}`)

section('Simetria y fraccion de area fisica')
const reflected = fillBorder(uniformField(GRID, GRID, 10000), GRID, GRID, 1, 50)
reflected[87 * GRID + 50] = 5000
const reflectedResult = analyse(reflected)
check('reflejar el defecto conserva IU CFOV', near(reflectedResult.IUcfov, 6.666667, ROUNDED))
check('reflejar el defecto conserva DU en ambas direcciones',
  near(reflectedResult.DUvertCfov, edgeDefect.DUvertCfov, EXACT)
  && near(reflectedResult.DUhorizCfov, edgeDefect.DUhorizCfov, EXACT))
const areaResult = calculateNemaGeometric(uniformField(10, 10, 10000), 10, 10, {
  targetSize: 0, pixelSpacingMm: [6.4, 6.4], ufovSizeMm: [7.2 * 6.4, 7.2 * 6.4]
})
// UFOV edges 0.9..8.1: rows 1 and 8 have 60 % coverage. At their
// intersections coverage is 0.6*0.6=0.36, so precisely four corners are out.
check('UFOV fraccionario incluye 8 x 8 menos cuatro esquinas', areaResult.metadata.nUfovPixelsValid === 60)
check('UFOV conserva las dimensiones fisicas sin redondearlas antes del CFOV',
  near(areaResult.metadata.cfovBoundsPx.minR, 1.8, EXACT)
  && near(areaResult.metadata.cfovBoundsPx.maxR, 7.2, EXACT))
// CFOV side coverage is 70 %, corner coverage 49 %: 6*6 - 4 = 32.
check('CFOV excluye las esquinas con 49 % de area', areaResult.metadata.nCfovPixelsValid === 32)

const oddCrop = calculateNemaGeometric(uniformField(21, 21, 3000), 21, 21, {
  targetSize: 10, pixelSpacingMm: [3.2, 3.2], ufovSizeMm: [51.2, 51.2]
})
check('un recorte impar conserva el centro fisico original',
  near((oddCrop.metadata.ufovBoundsPx.minR + oddCrop.metadata.ufovBoundsPx.maxR) / 2, 4.75, EXACT))

// ---- Case 11: blocks contaminated at the edge of the active field -----------
// The case that matters most in practice, and the one no rule catches unless
// the zero-count exclusion survives the summation.
//
// 130 x 130 raw pixels, active rows 3..126, summed in 13 x 13 blocks into a
// 10 x 10 analysis matrix. The outer analysis rows straddle the edge of the
// active area: ten active raw rows out of thirteen, so 13 000 counts against
// the 16 900 of a full block - 76.9 % of the CFOV mean. NEMA's 75 % edge
// threshold lets that through by less than two points. The kernel then mixes
// that outer row with the full row behind it - eight of the twelve valid
// weights are its own 13 000 counts and four are the 16 900 of its neighbour,
// so it smooths to 14 300 - and the analysis reports
//   IU = 100 x (16900 - 14300) / (16900 + 14300) = 8.333333 %
// on a perfectly uniform detector. The artefact is where the block grid fell,
// not a property of the camera.
//
// Flagging blocks touching exterior zero padding removes them and their neighbours,
// and what remains is uniform.
section('Caso 11: bloques contaminados en el borde del campo activo')
const RAW = 130
const BLOCK = 13
const rawField = new Float64Array(RAW * RAW)
for (let r = 3; r <= 126; r++) {
  for (let c = 0; c < RAW; c++) rawField[r * RAW + c] = 100
}
const blocked = calculateNemaGeometric(rawField, RAW, RAW, {
  targetSize: RAW / BLOCK,
  pixelSpacingMm: [0.6, 0.6],
  ufovSizeMm: [10 * BLOCK * 0.6, 10 * BLOCK * 0.6]
})
check('el umbral del 75 % no llega a quitar los bloques a caballo del borde',
  blocked.metadata.nRemovedByThreshold === 0, `${blocked.metadata.nRemovedByThreshold}`)
check('se detectan los 20 bloques contaminados',
  blocked.metadata.nRemovedZeroOrContaminated === 20,
  `${blocked.metadata.nRemovedZeroOrContaminated}`)
check('la vecindad retira las 20 posiciones contiguas',
  blocked.metadata.nRemovedByNeighbour === 20, `${blocked.metadata.nRemovedByNeighbour}`)
check('IU UFOV = 0 una vez excluidos', near(blocked.IUufov, 0, EXACT), `${blocked.IUufov}`)
check('los ceros de este caso son exclusivamente exteriores',
  blocked.metadata.nExteriorPaddingInUfov === 20 && blocked.metadata.nInteriorZeroInUfov === 0)

section('Ceros aislados dentro de un bloque con cuentas')
for (const rawZero of [0, 1]) {
  const coldBlock = uniformField(128, 128, 2500)
  coldBlock[40 * 128 + 40] = rawZero
  coldBlock[40 * 128 + 41] = 100
  coldBlock[41 * 128 + 40] = 100
  coldBlock[41 * 128 + 41] = 100
  const cold = calculateNemaGeometric(coldBlock, 128, 128, {
    pixelSpacingMm: [3.2, 3.2], ufovSizeMm: [409.6, 409.6]
  })
  // A 2x2 raw block sums to 300 or 301. It contributes 4/16 to its
  // smoothed centre, with 12/16 contributed by neighbours at 10 000.
  const minimum = (4 * (300 + rawZero) + 12 * 10000) / 16
  const expected = 100 * (10000 - minimum) / (10000 + minimum)
  check(`cero interior ${rawZero}: no se elimina el bloque frio`, cold.metadata.nRemovedTotal === 0)
  check(`cero interior ${rawZero}: IU conserva el defecto`, near(cold.IUcfov, expected, EXACT))
}

// Sin la propagacion, esos mismos numeros dan el artefacto: se reproduce
// entregando la matriz ya sumada, donde ningun pixel vale cero.
const preSummed = new Float64Array(10 * 10)
for (let r = 0; r < 10; r++) {
  for (let c = 0; c < 10; c++) {
    preSummed[r * 10 + c] = (r === 0 || r === 9) ? 13000 : 16900
  }
}
const contaminated = calculateNemaGeometric(preSummed, 10, 10, {
  targetSize: 0,
  pixelSpacingMm: [7.8, 7.8],
  ufovSizeMm: [78, 78]
})
check('sin propagar la exclusion el artefacto vale 8,333333 %',
  near(contaminated.IUufov, 8.333333, ROUNDED), `${contaminated.IUufov}`)

// ---- Case 5: non-square pixel ----------------------------------------------
// 5 and 8 mm both sit inside the 4.48-8.32 mm band, so a check that only looks
// at the range would pass this. NEMA wants square pixels.
section('Caso 5: pixel no cuadrado')
const nonSquare = calculateNemaGeometric(uniformField(GRID, GRID, 10000), GRID, GRID, {
  targetSize: 0,
  pixelSpacingMm: [5, 8],
  ufovSizeMm: [GRID * 5, GRID * 8]
})
check('ambas dimensiones caen dentro del intervalo NEMA',
  nonSquare.metadata.pixelTolerance.insideTolerance === true)
check('el pixel se declara no cuadrado', nonSquare.metadata.pixelTolerance.square === false,
  nonSquare.metadata.pixelTolerance.finalPixel.join(' x '))

const nonSquareState = evaluateAcquisition({
  parsed: { modality: 'NM', pixelSpacing: [5, 8], transferSyntaxUID: '1.2.840.10008.1.2.1', correctedImage: [] },
  frame: { fovShape: 'RECTANGLE', detectorKnown: true, detectorNumber: 1, collimatorType: 'NONE', totalCounts: 1e6 },
  result: nonSquare,
  profile: detectLimitProfile({ manufacturer: 'SIEMENS NM', softwareVersions: ['Symbia Intevo 6'] }),
  declaration: {}
})
check('el estado global es No evaluable', nonSquareState.state === STATES.NO_EVALUABLE,
  nonSquareState.state)

// ---- Case 6: what a resampling option really produces -----------------------
// 512 x 512 at 1.04 mm. floor(512 / 78) is 6, so the option labelled "78" gives
// an 85 x 85 matrix with 6.24 mm pixels. Neither 78 x 78 nor 7.8 mm.
section('Caso 6: resolucion real')
const bigField = uniformField(512, 512, 100)
const at78 = describeResolution(bigField, 512, 512, [1.04, 1.04], '78')
check('el bloque es 6 x 6', at78.blockSize.join('x') === '6x6', at78.blockSize.join('x'))
check('la matriz resultante es 85 x 85', at78.matrix.join('x') === '85x85', at78.matrix.join('x'))
check('el pixel efectivo es 6,24 mm', near(at78.pixelTolerance.finalPixel[0], 6.24, ROUNDED),
  `${at78.pixelTolerance.finalPixel[0]}`)
check('sigue dentro del intervalo NEMA', at78.pixelTolerance.insideTolerance === true)

const noSpacing = describeResolution(bigField, 512, 512, null, '78')
check('sin PixelSpacing no se puede evaluar el tamano', noSpacing.pixelTolerance === null)

// ---- DICOM cases ------------------------------------------------------------
function metaFor(sopInstance, transferSyntax = '1.2.840.10008.1.2.1') {
  return {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1]).buffer] },
    '00020002': { vr: 'UI', Value: [NM_CLASS] },
    '00020003': { vr: 'UI', Value: [sopInstance] },
    '00020010': { vr: 'UI', Value: [transferSyntax] },
    '00020012': { vr: 'UI', Value: ['1.2.826.0.1.3680043.9.6'] },
    '00020013': { vr: 'SH', Value: ['NMTEST'] }
  }
}

function detectorItem(fovDimensions, collimator = 'NONE') {
  return {
    [T('FieldOfViewShape')]: { vr: 'CS', Value: ['RECTANGLE'] },
    [T('FieldOfViewDimensions')]: { vr: 'US', Value: fovDimensions },
    [T('CollimatorType')]: { vr: 'CS', Value: [collimator] },
    [T('ZoomFactor')]: { vr: 'DS', Value: ['1', '1'] }
  }
}

function windowItem(name, lower, upper) {
  return {
    [T('EnergyWindowName')]: { vr: 'SH', Value: [name] },
    [T('EnergyWindowRangeSequence')]: {
      vr: 'SQ',
      Value: [{
        [T('EnergyWindowLowerLimit')]: { vr: 'DS', Value: [String(lower)] },
        [T('EnergyWindowUpperLimit')]: { vr: 'DS', Value: [String(upper)] }
      }]
    }
  }
}

function buildNmFile({
  rows,
  cols,
  samples,
  detectors,
  windows,
  detectorVector,
  windowVector,
  frames = 1,
  pixelSpacing = ['2', '2'],
  bitsAllocated = 16,
  bitsStored = 16,
  highBit = 15,
  pixelRepresentation = 0,
  transferSyntax = '1.2.840.10008.1.2.1'
}) {
  const sop = nextSop()
  const dict = {
    [T('SOPClassUID')]: { vr: 'UI', Value: [NM_CLASS] },
    [T('SOPInstanceUID')]: { vr: 'UI', Value: [sop] },
    [T('StudyInstanceUID')]: { vr: 'UI', Value: ['1.2.826.0.1.3680043.9.6.0'] },
    [T('SeriesInstanceUID')]: { vr: 'UI', Value: ['1.2.826.0.1.3680043.9.6.1'] },
    [T('Modality')]: { vr: 'CS', Value: ['NM'] },
    [T('Manufacturer')]: { vr: 'LO', Value: ['SIEMENS NM'] },
    [T('ManufacturerModelName')]: { vr: 'LO', Value: ['Encore2'] },
    [T('SoftwareVersions')]: { vr: 'LO', Value: ['syngo CT VC50>Symbia Intevo 6>VB22A'] },
    [T('Rows')]: { vr: 'US', Value: [rows] },
    [T('Columns')]: { vr: 'US', Value: [cols] },
    [T('NumberOfFrames')]: { vr: 'IS', Value: [String(frames)] },
    [T('PixelSpacing')]: { vr: 'DS', Value: pixelSpacing },
    [T('BitsAllocated')]: { vr: 'US', Value: [bitsAllocated] },
    [T('BitsStored')]: { vr: 'US', Value: [bitsStored] },
    [T('HighBit')]: { vr: 'US', Value: [highBit] },
    [T('PixelRepresentation')]: { vr: 'US', Value: [pixelRepresentation] },
    [T('SamplesPerPixel')]: { vr: 'US', Value: [1] },
    [T('PhotometricInterpretation')]: { vr: 'CS', Value: ['MONOCHROME2'] },
    [T('ActualFrameDuration')]: { vr: 'IS', Value: ['600000'] },
    '7FE00010': { vr: 'OW', Value: [samples.buffer] }
  }

  if (detectors) {
    dict[T('DetectorInformationSequence')] = { vr: 'SQ', Value: detectors }
    dict[T('NumberOfDetectors')] = { vr: 'US', Value: [detectors.length] }
  }
  if (windows) {
    dict[T('EnergyWindowInformationSequence')] = { vr: 'SQ', Value: windows }
    dict[T('NumberOfEnergyWindows')] = { vr: 'US', Value: [windows.length] }
  }
  if (detectorVector) dict[T('DetectorVector')] = { vr: 'US', Value: detectorVector }
  if (windowVector) dict[T('EnergyWindowVector')] = { vr: 'US', Value: windowVector }

  const dicomDict = new DicomDict(metaFor(sop, transferSyntax))
  dicomDict.dict = dict
  return dicomDict.write()
}

// An active rectangle centred in the matrix, in raw pixels.
function activeRectangle(rows, cols, activeRows, activeCols, value = 100) {
  const samples = new Uint16Array(rows * cols)
  const r0 = Math.floor((rows - activeRows) / 2)
  const c0 = Math.floor((cols - activeCols) / 2)
  for (let r = r0; r < r0 + activeRows; r++) {
    for (let c = c0; c < c0 + activeCols; c++) samples[r * cols + c] = value
  }
  return samples
}

// ---- Case 7: order of FieldOfViewDimensions ---------------------------------
// The flood covers 193 rows and 266 columns of 2 mm, so the active field is
// 386 x 532 mm. Stored in the standard order it must be read as stored; stored
// the other way round only the swapped reading matches the image, and that is a
// vendor deviation to report, not to assume.
section('Caso 7: orden de FieldOfViewDimensions')
const FOV_ROWS = 200
const FOV_COLS = 280
const fovSamples = activeRectangle(FOV_ROWS, FOV_COLS, 193, 266)

const standardOrder = parseDICOM(buildNmFile({
  rows: FOV_ROWS,
  cols: FOV_COLS,
  samples: fovSamples,
  detectors: [detectorItem([386, 532])],
  windows: [windowItem('99m Technetium', 126, 154)],
  detectorVector: [1],
  windowVector: [1]
}))
check('el orden estandar se respeta', standardOrder.fov.order === 'standard', standardOrder.fov.order)
check('se interpreta como filas 386 mm y columnas 532 mm',
  standardOrder.ufovSizeMm[0] === 386 && standardOrder.ufovSizeMm[1] === 532,
  standardOrder.ufovSizeMm.join(' x '))
check('no se emite advertencia de desviacion', !standardOrder.fov.warning)

const swappedOrder = parseDICOM(buildNmFile({
  rows: FOV_ROWS,
  cols: FOV_COLS,
  samples: fovSamples,
  detectors: [detectorItem([532, 386])],
  windows: [windowItem('99m Technetium', 126, 154)],
  detectorVector: [1],
  windowVector: [1]
}))
check('solo el orden invertido concuerda con la geometria',
  swappedOrder.fov.order === 'swapped', swappedOrder.fov.order)
check('se usan filas 386 mm y columnas 532 mm',
  swappedOrder.ufovSizeMm[0] === 386 && swappedOrder.ufovSizeMm[1] === 532,
  swappedOrder.ufovSizeMm.join(' x '))
check('se emite la advertencia de desviacion del fabricante',
  Boolean(swappedOrder.fov.warning), swappedOrder.fov.warning?.slice(0, 60))
check('la decision se toma midiendo el campo activo',
  swappedOrder.fov.decidedBy === 'campo_activo', swappedOrder.fov.decidedBy)
check('el orden se puede forzar a mano', parseDICOM(buildNmFile({
  rows: FOV_ROWS,
  cols: FOV_COLS,
  samples: fovSamples,
  detectors: [detectorItem([532, 386])],
  windows: [windowItem('99m Technetium', 126, 154)],
  detectorVector: [1],
  windowVector: [1]
}), { fovOrder: 'standard' }).ufovSizeMm.join(' x ') === '532 x 386')

// ---- Case 8: stored pixels --------------------------------------------------
// BitsStored below BitsAllocated leaves padding bits above HighBit. Reading the
// allocated word whole returns whatever the modality left there.
section('Caso 8: pixeles almacenados')
check('sin signo, 12 de 16 bits, se enmascara', normalizeStoredPixel(0xF123, 12, 11, 0) === 0x123,
  `${normalizeStoredPixel(0xF123, 12, 11, 0)}`)
check('con signo, 12 de 16 bits, se extiende el signo',
  normalizeStoredPixel(0x0FFF, 12, 11, 1) === -1, `${normalizeStoredPixel(0x0FFF, 12, 11, 1)}`)
check('16 de 16 bits sin signo no cambia nada', normalizeStoredPixel(60000, 16, 15, 0) === 60000)

const masked = parseDICOM(buildNmFile({
  rows: 2,
  cols: 2,
  samples: Uint16Array.from([0xF123, 0xF000, 0xFFFF, 0xF001]),
  detectors: [detectorItem([20, 20])],
  windows: [windowItem('Tc', 126, 154)],
  detectorVector: [1],
  windowVector: [1],
  bitsStored: 12,
  highBit: 11
}))
check('el lector aplica la mascara a los pixeles',
  Array.from(masked.frames[0]).join(',') === '291,0,4095,1',
  Array.from(masked.frames[0]).join(','))

const signed = parseDICOM(buildNmFile({
  rows: 2,
  cols: 2,
  samples: Uint16Array.from([0x0FFF, 0x0001, 0x0800, 0x07FF]),
  detectors: [detectorItem([20, 20])],
  windows: [windowItem('Tc', 126, 154)],
  detectorVector: [1],
  windowVector: [1],
  bitsStored: 12,
  highBit: 11,
  pixelRepresentation: 1
}))
check('el lector extiende el signo', Array.from(signed.frames[0]).join(',') === '-1,1,-2048,2047',
  Array.from(signed.frames[0]).join(','))

// ---- Case 9: compressed transfer syntax -------------------------------------
// dcmjs hands back the encapsulated fragments; reading them as native pixels
// produces noise that still computes a uniformity.
section('Caso 9: transfer syntax comprimida')
let compressionError = ''
try {
  parseDICOM(buildNmFile({
    rows: 2,
    cols: 2,
    samples: Uint16Array.from([1, 2, 3, 4]),
    detectors: [detectorItem([20, 20])],
    windows: [windowItem('Tc', 126, 154)],
    detectorVector: [1],
    windowVector: [1],
    transferSyntax: '1.2.840.10008.1.2.4.90'
  }))
} catch (error) {
  compressionError = error.message
}
check('se rechaza explicitamente', compressionError.includes('comprimida'), compressionError)
check('el mensaje nombra el UID', compressionError.includes('1.2.840.10008.1.2.4.90'))

// ---- Case 10: multiframe ----------------------------------------------------
// Two detectors and two energy windows. Taking element zero of the sequence for
// every frame, as the reader used to, labels the second head with the geometry
// and the window of the first.
section('Caso 10: multiframe con dos detectores y dos ventanas')
const dual = parseDICOM(buildNmFile({
  rows: 4,
  cols: 4,
  samples: Uint16Array.from(Array(32).fill(0).map((_, index) => (index < 16 ? 100 : 200))),
  frames: 2,
  detectors: [detectorItem([386, 532], 'NONE'), detectorItem([300, 400], 'LEHR')],
  windows: [windowItem('99m Technetium', 126, 154), windowItem('Ventana dispersion', 100, 120)],
  detectorVector: [1, 2],
  windowVector: [1, 2]
}))
check('se leen dos frames', dual.numFrames === 2, `${dual.numFrames}`)
check('el frame 1 es el detector 1', dual.frameInfo[0].detectorNumber === 1)
check('el frame 2 es el detector 2', dual.frameInfo[1].detectorNumber === 2)
check('cada frame lleva su ventana',
  dual.frameInfo[0].energyWindowName === '99m Technetium'
  && dual.frameInfo[1].energyWindowName === 'Ventana dispersion',
  `${dual.frameInfo[0].energyWindowName} / ${dual.frameInfo[1].energyWindowName}`)
check('cada frame lleva el colimador de su detector',
  dual.frameInfo[0].collimatorType === 'NONE' && dual.frameInfo[1].collimatorType === 'LEHR',
  `${dual.frameInfo[0].collimatorType} / ${dual.frameInfo[1].collimatorType}`)
check('cada frame lleva las dimensiones de su detector',
  dual.frameInfo[0].fovDimensionsRaw.join(',') === '386,532'
  && dual.frameInfo[1].fovDimensionsRaw.join(',') === '300,400',
  `${dual.frameInfo[0].fovDimensionsRaw} / ${dual.frameInfo[1].fovDimensionsRaw}`)
check('no se inventan frames con los bytes sobrantes', dual.frames.length === dual.declaredFrames)

// ---- Limit profiles ---------------------------------------------------------
// The Symbia in this department writes "Encore2" as the model name and only
// mentions Symbia Intevo inside SoftwareVersions, so a matcher that trusts
// ManufacturerModelName leaves its own camera without limits.
section('Perfiles de limites')
check('el perfil Symbia se reconoce por Manufacturer y SoftwareVersions',
  detectLimitProfile(dual).id === 'symbia_intevo', detectLimitProfile(dual).id)
check('otro equipo no hereda los limites Siemens',
  detectLimitProfile({ manufacturer: 'GE MEDICAL SYSTEMS', modelName: 'Discovery', softwareVersions: [] }).id === 'none')
check('sin perfil no hay veredicto de conformidad',
  evaluateAcquisition({
    parsed: { modality: 'NM', pixelSpacing: [6.4, 6.4], transferSyntaxUID: '1.2.840.10008.1.2.1', correctedImage: [] },
    frame: { fovShape: 'RECTANGLE', detectorKnown: true, detectorNumber: 1, collimatorType: 'NONE', totalCounts: 1e6, ufovSizeMm: [640, 640] },
    result: uniform,
    profile: detectLimitProfile({ manufacturer: 'GE MEDICAL SYSTEMS' }),
    declaration: {}
  }).state === STATES.NO_EVALUABLE)

// ---- Acquisition states -----------------------------------------------------
section('Estados de la adquisicion')
const symbia = detectLimitProfile({ manufacturer: 'SIEMENS NM', softwareVersions: ['Symbia Intevo 6'] })
const baseParsed = {
  modality: 'NM',
  pixelSpacing: [6.4, 6.4],
  transferSyntaxUID: '1.2.840.10008.1.2.1',
  correctedImage: ['UNIF'],
  actualFrameDurationMs: 600000,
  radionuclide: 'Tc-99m'
}
const baseFrame = {
  fovShape: 'RECTANGLE',
  detectorKnown: true,
  detectorNumber: 1,
  energyWindowName: 'Tc',
  energyWindowLowerLimit: 126,
  energyWindowUpperLimit: 154,
  collimatorType: 'NONE',
  totalCounts: 6e6,
  ufovSizeMm: [640, 640]
}
const verifiedDeclaration = { sourceDistanceCm: '400', energyWindowConfirmed: 'si' }

const unverified = evaluateAcquisition({
  parsed: baseParsed, frame: baseFrame, result: uniform, profile: symbia, declaration: {}
})
check('sin declarar la distancia, conforme numericamente pero no verificada',
  unverified.state === STATES.NO_VERIFICADA, unverified.state)

const verified = evaluateAcquisition({
  parsed: { ...baseParsed, actualFrameDurationMs: 600000 },
  frame: { ...baseFrame, totalCounts: 6e6 },
  result: uniform,
  profile: symbia,
  declaration: verifiedDeclaration
})
check('con la distancia declarada y todo en orden, Conforme',
  verified.state === STATES.CONFORME, `${verified.state}: ${verified.reason}`)

const tooFast = evaluateAcquisition({
  parsed: { ...baseParsed, actualFrameDurationMs: 1000 },
  frame: { ...baseFrame, totalCounts: 60000 },
  result: uniform,
  profile: symbia,
  declaration: verifiedDeclaration
})
check('una tasa de 60 000 cps invalida la medida',
  tooFast.state === STATES.NO_EVALUABLE, `${tooFast.state}: ${tooFast.reason}`)

const withCollimator = evaluateAcquisition({
  parsed: baseParsed,
  frame: { ...baseFrame, collimatorType: 'LEHR' },
  result: uniform,
  profile: symbia,
  declaration: verifiedDeclaration
})
check('un colimador montado invalida la uniformidad intrinseca',
  withCollimator.state === STATES.NO_EVALUABLE, withCollimator.state)

const tooClose = evaluateAcquisition({
  parsed: baseParsed,
  frame: baseFrame,
  result: uniform,
  profile: symbia,
  declaration: { sourceDistanceCm: 100 }
})
check('menos de 5 veces el UFOV mayor invalida la medida',
  tooClose.state === STATES.NO_EVALUABLE, tooClose.reason)

const lowCounts = evaluateAcquisition({
  parsed: baseParsed,
  frame: baseFrame,
  result: { ...uniform, metadata: { ...uniform.metadata, centerCountResampled: 8584, maxCountCfov: 8916 } },
  profile: symbia,
  declaration: verifiedDeclaration
})
check('menos de 10 000 cuentas en el pixel central invalida la medida',
  lowCounts.state === STATES.NO_EVALUABLE, lowCounts.reason)

const outOfLimits = evaluateAcquisition({
  parsed: baseParsed,
  frame: baseFrame,
  result: { ...uniform, IUufov: 4.01, IUcfov: 3.28 },
  profile: symbia,
  declaration: verifiedDeclaration
})
check('fuera de los limites del perfil, No conforme',
  outOfLimits.state === STATES.NO_CONFORME, `${outOfLimits.state}: ${outOfLimits.reason}`)
check('se nombran los parametros fuera de limite',
  outOfLimits.exceeded.map((row) => row.label).join(', ') === 'IU UFOV, IU CFOV',
  outOfLimits.exceeded.map((row) => row.label).join(', '))

const evaluate = (overrides = {}) => evaluateAcquisition({
  parsed: baseParsed, frame: baseFrame, result: uniform, profile: symbia,
  declaration: verifiedDeclaration, ...overrides
})
const checkById = (evaluation, id) => evaluation.checks.find((item) => item.id === id)

section('Campos vacios y valores fisicamente invalidos')
for (const blank of ['', ' ', '\t']) {
  const blankRate = evaluate({ parsed: { ...baseParsed, actualFrameDurationMs: NaN },
    declaration: { ...verifiedDeclaration, countRateCps: blank } })
  check('tasa vacia no equivale a 0 cps', checkById(blankRate, 'count_rate').status === 'unknown')
  check('sin tasa fiable no hay Conforme', blankRate.state === STATES.NO_VERIFICADA)
  const blankDistance = evaluate({ declaration: { ...verifiedDeclaration, sourceDistanceCm: blank } })
  check('distancia vacia no equivale a 0 cm', checkById(blankDistance, 'source_distance').status === 'unknown')
  const confirmedDistance = evaluate({ declaration: { ...verifiedDeclaration,
    sourceDistanceCm: blank, distanceConfirmed: true } })
  check('la casilla permite confirmar la distancia sin inventar un valor', confirmedDistance.state === STATES.CONFORME)
}
for (const value of ['0', '-1', '20001']) {
  const badRate = evaluate({ parsed: { ...baseParsed, actualFrameDurationMs: NaN },
    declaration: { ...verifiedDeclaration, countRateCps: value } })
  check(`tasa invalida ${value} no se acepta`, badRate.state === STATES.NO_EVALUABLE)
}
const decimalRate = evaluate({ parsed: { ...baseParsed, actualFrameDurationMs: NaN },
  declaration: { ...verifiedDeclaration, countRateCps: '12000,5' } })
check('se acepta la coma decimal de una tasa positiva valida', decimalRate.state === STATES.CONFORME)
check('una distancia numerica cero no se sobreescribe con la casilla',
  evaluate({ declaration: { ...verifiedDeclaration, sourceDistanceCm: '0', distanceConfirmed: true } }).state === STATES.NO_EVALUABLE)
check('UNKN no significa colimador montado ni retirado',
  checkById(evaluate({ frame: { ...baseFrame, collimatorType: 'UNKN' } }), 'collimator').status === 'unknown')
check('UNKN permite confirmar explicitamente el colimador retirado',
  evaluate({ frame: { ...baseFrame, collimatorType: 'UNKN' },
    declaration: { ...verifiedDeclaration, collimatorRemoved: 'si' } }).state === STATES.CONFORME)

section('Ventana energetica y protocolo')
const absentWindow = { ...baseFrame, energyWindowName: '', energyWindowLowerLimit: NaN, energyWindowUpperLimit: NaN }
check('detector conocido con ventana ausente no verifica la adquisicion',
  evaluate({ frame: absentWindow }).state === STATES.NO_VERIFICADA)
check('un nombre de ventana sin limites no basta',
  evaluate({ frame: { ...absentWindow, energyWindowName: 'Tc' } }).state === STATES.NO_VERIFICADA)
check('un rango DICOM valido requiere confirmacion del protocolo',
  evaluate({ declaration: { ...verifiedDeclaration, energyWindowConfirmed: '' } }).state === STATES.NO_VERIFICADA)
check('un rango DICOM invertido no se puede sobreescribir a mano',
  evaluate({ frame: { ...baseFrame, energyWindowLowerLimit: 154, energyWindowUpperLimit: 126 },
    declaration: { ...verifiedDeclaration, energyWindowLowerKev: '126', energyWindowUpperKev: '154' } }).state === STATES.NO_EVALUABLE)
check('un rango DICOM parcial sigue sin verificar',
  evaluate({ frame: { ...baseFrame, energyWindowUpperLimit: NaN },
    declaration: { ...verifiedDeclaration, energyWindowUpperKev: '154' } }).state === STATES.NO_VERIFICADA)
check('ventana manual completa y confirmada permite evaluar',
  evaluate({ frame: absentWindow, declaration: { ...verifiedDeclaration,
    energyWindowLowerKev: '126,0', energyWindowUpperKev: '154,0' } }).state === STATES.CONFORME)
check('ventana manual vacia permanece desconocida',
  evaluate({ frame: absentWindow, declaration: { ...verifiedDeclaration,
    energyWindowLowerKev: '', energyWindowUpperKev: '' } }).state === STATES.NO_VERIFICADA)
check('ventana declarada ajena al protocolo invalida la medida',
  evaluate({ declaration: { ...verifiedDeclaration, energyWindowConfirmed: 'no' } }).state === STATES.NO_EVALUABLE)

section('Resultados incompletos y campos no verificados')
for (const name of ['IUufov', 'IUcfov', 'DUvertUfov', 'DUhorizUfov', 'DUvertCfov', 'DUhorizCfov']) {
  const invalidMetric = evaluate({ result: { ...uniform, [name]: NaN } })
  check(`${name} no calculable impide Conforme`, invalidMetric.state === STATES.NO_EVALUABLE)
  check(`${name} no calculable no se declara numericamente dentro de limites`, !invalidMetric.numericallyWithinLimits)
}
const sparseData = new Float64Array(GRID * GRID)
for (let r = 49; r <= 51; r++) for (let c = 49; c <= 51; c++) sparseData[r * GRID + c] = 10000
const sparseResult = analyse(sparseData)
check('el caso degenerado conserva solo un pixel', sparseResult.metadata.nUfovPixelsValid === 1)
check('sin cinco pixeles no se inventa una DU cero', Number.isNaN(sparseResult.DUvertUfov))
check('el caso degenerado real no puede ser Conforme', evaluate({ result: sparseResult }).state === STATES.NO_EVALUABLE)
const interiorZeroData = uniformField(GRID, GRID, 10000)
interiorZeroData[40 * GRID + 40] = 0
const interiorZeroResult = analyse(interiorZeroData)
check('el cero interior completo sigue documentado aunque se excluya', interiorZeroResult.metadata.nInteriorZeroInUfov === 1)
check('no se certifica el campo restante tras eliminar un pixel interior muerto',
  evaluate({ result: interiorZeroResult }).state === STATES.NO_EVALUABLE)
const edgeZeroData = uniformField(GRID, GRID, 10000)
for (let r = 0; r < 8; r++) edgeZeroData[r * GRID + 40] = 0
const edgeZeroResult = analyse(edgeZeroData)
check('un defecto a cero conectado al exterior se detecta dentro del UFOV',
  edgeZeroResult.metadata.nPaddingIntrusionInUfov === 7)
check('excluir un defecto conectado al exterior no permite Conforme',
  evaluate({ result: edgeZeroResult }).state === STATES.NO_EVALUABLE)
const autoField = calculateNemaGeometric(uniformField(GRID, GRID, 10000), GRID, GRID,
  { targetSize: 0, pixelSpacingMm: [6.4, 6.4] })
check('un campo constante admite la estimacion automatica', autoField.available && autoField.metadata.ufovFromImage)
check('UFOV inferido exige verificar la geometria antes de Conforme', evaluate({ result: autoField }).state === STATES.NO_VERIFICADA)
const truncatedField = analyse(uniformField(GRID, GRID, 10000), { ufovSizeMm: [700, 700] })
check('un UFOV fisico que no cabe en la imagen no pasa como campo completo',
  evaluate({ result: truncatedField }).state === STATES.NO_EVALUABLE)
const invalidProfile = { ...symbia, specs: { ...symbia.specs, DUcfov: NaN } }
check('limites incompletos impiden Conforme', evaluate({ profile: invalidProfile }).state === STATES.NO_EVALUABLE)
const invalidCounts = uniformField(GRID, GRID, 10000)
invalidCounts[0] = -1
assert.throws(() => analyse(invalidCounts), /no negativas/)
invalidCounts[0] = NaN
assert.throws(() => analyse(invalidCounts), /finitas/)

section('Declaracion independiente de cada archivo')
const oldDeclaration = createAcquisitionDeclaration()
oldDeclaration.energyWindowConfirmed = 'si'
oldDeclaration.distanceConfirmed = true
oldDeclaration.countRateCps = '10000'
const newDeclaration = createAcquisitionDeclaration()
check('una nueva adquisicion no hereda confirmaciones ni tasa de cuentas',
  newDeclaration.energyWindowConfirmed === '' && !newDeclaration.distanceConfirmed && newDeclaration.countRateCps === '')

// ---- Result -----------------------------------------------------------------
console.log('')
if (failures.length) {
  console.error(`NEMA uniformity assertions FAILED: ${failures.length} of ${failures.length + passed.length}`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
assert.equal(failures.length, 0)
console.log(`NEMA uniformity assertions passed: ${passed.length} checks.`)
