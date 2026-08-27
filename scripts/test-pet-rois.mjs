// Assertions for the background ROI placement in src/utils/petNemaAnalysis.js.
//
// NEMA NU 2-2018 7.4.1 puts twelve 37 mm ROIs on the slice centred on the
// spheres, as close to the edge of the phantom as possible but never closer
// than 15 mm to it, and repeats them on four more planes to reach the 60 ROIs
// that every background concentration is averaged over. Two things about that
// are silent when they go wrong, which is why they are pinned here.
//
// The first is the placement itself. The previous version chose one ROI per
// fixed angular sector, in isolation, asking for 29.6 mm between centres and
// accepting whatever it found when that failed - so two nearly coincident ROIs
// could be reported as twelve independent measurements, and the background
// variability N_j computed from them was not the variability of the image. It
// also relaxed the clearance to the spheres down to zero through a ladder of
// [15, 10, 6, 3, 0], which lets a background ROI sit on hot activity: the
// background concentration then rises, the contrast Q_H falls, and the report
// still prints a perfectly plausible number.
//
// The second is that the same twelve coordinates must be used on all five
// planes. Nothing throws if they drift; the 60 samples simply stop being 60
// samples of the same twelve positions.
import assert from 'node:assert/strict'
import {
  analyzePetNema,
  describeBackgroundRois,
  distanceTransform,
  generateBackgroundRois,
  PET_NEMA_DEFAULTS
} from '../src/utils/petNemaAnalysis.js'

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

// ---- Synthetic IEC body phantom --------------------------------------------
// Cross-section 300 x 230 mm, six spheres on a 114.4 mm diameter ring, 50 mm
// lung insert at the centre. The matrix is deliberately generous (600 mm across
// 200 pixels) so the spheres stay below the 99th percentile of the slice, the
// way they do in a real acquisition.
const ROWS = 200
const COLS = 200
const PIXEL_MM = 3
const DZ_MM = 5
const SLICES = 60
const CENTRAL_SLICE = 30
const SPHERE_RING_RADIUS_MM = 57.2
const SPHERE_DIAMETERS = [10, 13, 17, 22, 28, 37]
const SEMI_AXIS_X_MM = 150
const SEMI_AXIS_Y_MM = 115
const LUNG_DIAMETER_MM = 50
const BACKGROUND = 5300
const CENTRE_X_MM = COLS * PIXEL_MM / 2
const CENTRE_Y_MM = ROWS * PIXEL_MM / 2

// Tolerances. Positions are quantised to the pixel grid, so a clearance can
// legitimately land a fraction of a pixel below the nominal margin; 1e-6 mm is
// pure floating point slack, and PIXEL_MM is what a single-pixel step costs.
const EPSILON_MM = 1e-6

function insidePhantom(xMm, yMm) {
  const dx = (xMm - CENTRE_X_MM) / SEMI_AXIS_X_MM
  const dy = (yMm - CENTRE_Y_MM) / SEMI_AXIS_Y_MM
  return dx * dx + dy * dy <= 1
}

function sphereCentres() {
  return SPHERE_DIAMETERS.map((diameterMm, index) => {
    const angle = (90 + index * 60) * Math.PI / 180
    return {
      diameterMm,
      xMm: CENTRE_X_MM + SPHERE_RING_RADIUS_MM * Math.cos(angle),
      yMm: CENTRE_Y_MM + SPHERE_RING_RADIUS_MM * Math.sin(angle)
    }
  })
}

function phantomMask() {
  const mask = new Uint8Array(ROWS * COLS)
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (insidePhantom((x + 0.5) * PIXEL_MM, (y + 0.5) * PIXEL_MM)) mask[y * COLS + x] = 1
    }
  }
  return mask
}

// The spheres as analyzePetNema reports them: centres in pixel units.
function detectedSpheres() {
  return sphereCentres().map((sphere) => ({
    diameterMm: sphere.diameterMm,
    centerX: sphere.xMm / PIXEL_MM,
    centerY: sphere.yMm / PIXEL_MM
  }))
}

function buildVolume(sphereToBackgroundRatio, sliceScales) {
  const spheres = sphereCentres()
  const volume = []

  for (let slice = 0; slice < SLICES; slice++) {
    const image = new Float32Array(ROWS * COLS)
    const offset = slice - CENTRAL_SLICE
    const zMm = offset * DZ_MM
    const scale = sliceScales?.[offset] ?? 1

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const xMm = (x + 0.5) * PIXEL_MM
        const yMm = (y + 0.5) * PIXEL_MM
        if (!insidePhantom(xMm, yMm)) continue

        const lungDistance = Math.hypot(xMm - CENTRE_X_MM, yMm - CENTRE_Y_MM)
        if (lungDistance <= LUNG_DIAMETER_MM / 2) {
          image[y * COLS + x] = BACKGROUND * 0.05
          continue
        }

        let value = BACKGROUND * scale
        for (const sphere of spheres) {
          const radius = sphere.diameterMm / 2
          const distance = Math.hypot(xMm - sphere.xMm, yMm - sphere.yMm, zMm)
          if (distance <= radius) {
            value = BACKGROUND * sphereToBackgroundRatio
            break
          }
        }
        image[y * COLS + x] = value
      }
    }

    volume.push(image)
  }

  return {
    volume,
    rows: ROWS,
    cols: COLS,
    dz: DZ_MM,
    pixelSpacing: [PIXEL_MM, PIXEL_MM],
    units: 'BQML'
  }
}

// The placement this replaced: one ROI per angular sector, chosen in isolation,
// asking for 0.8 x 37 mm between centres and taking the least bad option when
// that could not be met.
function legacyPlacement(distanceToEdgePx, spheres, options) {
  const radius = 37 / 2
  const candidates = []

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const depthMm = distanceToEdgePx[y * COLS + x] * PIXEL_MM
      if (depthMm < radius + options.edgeMarginMm) continue

      const xMm = (x + 0.5) * PIXEL_MM
      const yMm = (y + 0.5) * PIXEL_MM
      if (Math.hypot(xMm - CENTRE_X_MM, yMm - CENTRE_Y_MM) < LUNG_DIAMETER_MM / 2 + radius) continue

      let sphereGapMm = Infinity
      for (const sphere of spheres) {
        const gap = Math.hypot(xMm - sphere.centerX * PIXEL_MM, yMm - sphere.centerY * PIXEL_MM)
          - radius - sphere.diameterMm / 2
        sphereGapMm = Math.min(sphereGapMm, gap)
      }

      let angleDegrees = Math.atan2(yMm - CENTRE_Y_MM, xMm - CENTRE_X_MM) * 180 / Math.PI
      if (angleDegrees < 0) angleDegrees += 360
      candidates.push({ xMm, yMm, depthMm, sphereGapMm, angleDegrees })
    }
  }

  const selected = []
  const desiredSeparation = 37 * 0.8
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

function minimumSeparation(rois) {
  let minimum = Infinity
  for (let a = 0; a < rois.length; a++) {
    for (let b = a + 1; b < rois.length; b++) {
      minimum = Math.min(minimum, Math.hypot(rois[a].xMm - rois[b].xMm, rois[a].yMm - rois[b].yMm))
    }
  }
  return minimum
}

// ---- Placement --------------------------------------------------------------
const options = { ...PET_NEMA_DEFAULTS }
const mask = phantomMask()
const distanceToEdgePx = distanceTransform(mask, ROWS, COLS)
const spheres = detectedSpheres()
const phantomCentre = { xMm: CENTRE_X_MM, yMm: CENTRE_Y_MM }

const placementArgs = [
  distanceToEdgePx, ROWS, COLS, PIXEL_MM, PIXEL_MM, phantomCentre, spheres, options
]
const rois = generateBackgroundRois(...placementArgs)
const measured = describeBackgroundRois(rois, ...placementArgs)

section('Colocacion de las 12 ROIs de fondo')
check('se colocan exactamente 12 ROIs', rois.length === 12, `${rois.length}`)
check(
  'ninguna ROI queda a menos de 15 mm del borde del maniqui',
  measured.minimumEdgeClearanceMm >= options.edgeMarginMm - EPSILON_MM,
  `holgura minima ${measured.minimumEdgeClearanceMm.toFixed(2)} mm`
)
check(
  'ninguna ROI solapa una esfera',
  measured.minimumSphereClearanceMm >= -EPSILON_MM,
  `holgura minima a esferas ${measured.minimumSphereClearanceMm.toFixed(2)} mm`
)
check(
  'ninguna ROI solapa el inserto pulmonar',
  measured.rois.every((roi) => roi.lungGapMm >= -EPSILON_MM),
  `holgura minima al pulmon ${Math.min(...measured.rois.map((roi) => roi.lungGapMm)).toFixed(2)} mm`
)
check('la validacion no encuentra incumplimientos', measured.violations.length === 0,
  measured.violations.join(' | '))

// As close to the edge as the standard asks: no ROI should be sitting deeper
// than it needs to. A margin of one pixel over the 15 mm covers the quantisation
// of the candidate grid.
const deepest = Math.max(...measured.rois.map((roi) => roi.edgeClearanceMm))
check(
  'las ROIs se pegan al borde en vez de repartirse por el interior',
  deepest <= options.edgeMarginMm + PIXEL_MM,
  `holgura maxima ${deepest.toFixed(2)} mm frente a ${options.edgeMarginMm} mm nominales`
)

section('Determinismo')
const repeated = generateBackgroundRois(...placementArgs)
check(
  'dos ejecuciones dan exactamente las mismas coordenadas',
  repeated.every((roi, index) => roi.xMm === rois[index].xMm && roi.yMm === rois[index].yMm)
)

section('Separacion frente al algoritmo anterior')
const legacy = legacyPlacement(distanceToEdgePx, spheres, options)
const legacySeparation = minimumSeparation(legacy)
const newSeparation = measured.minimumCenterSeparationMm
check(
  'la separacion minima entre centros no empeora',
  newSeparation >= legacySeparation - EPSILON_MM,
  `nueva ${newSeparation.toFixed(2)} mm frente a anterior ${legacySeparation.toFixed(2)} mm`
)
check(
  'el solapamiento lineal maximo queda cuantificado',
  Number.isFinite(measured.maximumLinearOverlapMm) && measured.maximumLinearOverlapMm >= 0,
  `${measured.maximumLinearOverlapMm.toFixed(2)} mm en ${measured.overlappingPairCount} parejas`
)

const legacyMinSphereGap = Math.min(...legacy.map((roi) => roi.sphereGapMm))
check(
  'el algoritmo anterior si permitia acercarse mas a las esferas',
  legacyMinSphereGap <= measured.minimumSphereClearanceMm + EPSILON_MM,
  `anterior ${legacyMinSphereGap.toFixed(2)} mm frente a nueva ${measured.minimumSphereClearanceMm.toFixed(2)} mm`
)

section('Modo manual')
const shifted = rois.map((roi) => ({ xMm: roi.xMm, yMm: roi.yMm }))
shifted[0] = { xMm: CENTRE_X_MM, yMm: CENTRE_Y_MM }
const manualBad = describeBackgroundRois(shifted, ...placementArgs)
check(
  'una ROI arrastrada sobre el inserto pulmonar se marca como incumplimiento',
  manualBad.violations.length > 0,
  manualBad.violations[0]
)
check(
  'la ROI infractora se identifica individualmente',
  manualBad.rois[0].violatesLung || manualBad.rois[0].violatesEdge,
  `holgura al pulmon ${manualBad.rois[0].lungGapMm.toFixed(1)} mm`
)

const manualGood = describeBackgroundRois(shifted.map((roi, index) => (
  index === 0 ? { xMm: rois[0].xMm, yMm: rois[0].yMm } : roi
)), ...placementArgs)
check('devolver la ROI a su sitio limpia el incumplimiento', manualGood.violations.length === 0)

// ---- End to end -------------------------------------------------------------
// Each of the four off-centre background planes carries a slightly different
// uniform background. If the same twelve coordinates are used on all five, the
// mean of the 60 samples is exactly the mean of the five plane values, because
// every ROI sits on uniform background. A drift in the coordinates would break
// that equality without throwing anything.
const sliceScales = { '-4': 1.02, '-2': 1.01, 0: 1, 2: 0.99, 4: 0.98 }
const series = buildVolume(4, sliceScales)
const analysis = analyzePetNema(series, {
  sphereActivity: 4,
  backgroundActivity: 1,
  centralSliceIndex: CENTRAL_SLICE
})

section('Persistencia en los cinco cortes')
check('se usan cinco planos de fondo', analysis.backgroundSlices.length === 5,
  analysis.backgroundSlices.map((slice) => slice.index).join(', '))
check('se conservan 12 posiciones de fondo', analysis.backgroundRois.length === 12)

const expectedBackground = BACKGROUND * (1.02 + 1.01 + 1 + 0.99 + 0.98) / 5
const sphere10 = analysis.spheres.find((sphere) => sphere.diameterMm === 10)
check(
  'la media de las 60 ROIs es la media de los cinco planos',
  Math.abs(sphere10.backgroundConcentration - expectedBackground) < 1,
  `${sphere10.backgroundConcentration.toFixed(1)} frente a ${expectedBackground.toFixed(1)}`
)

section('Metricas informadas')
const metrics = analysis.backgroundRoiMetrics
check('se informa la separacion minima entre centros', Number.isFinite(metrics.minimumCenterSeparationMm),
  `${metrics.minimumCenterSeparationMm.toFixed(1)} mm`)
check('se informa el solapamiento lineal maximo', Number.isFinite(metrics.maximumLinearOverlapMm),
  `${metrics.maximumLinearOverlapMm.toFixed(1)} mm`)
check('se informa el numero de parejas solapadas', Number.isInteger(metrics.overlappingPairCount),
  `${metrics.overlappingPairCount}`)
check('se informa la holgura minima al borde', metrics.minimumEdgeClearanceMm >= options.edgeMarginMm - EPSILON_MM,
  `${metrics.minimumEdgeClearanceMm.toFixed(1)} mm`)
check('se informa la holgura minima a las esferas', Number.isFinite(metrics.minimumSphereClearanceMm),
  `${metrics.minimumSphereClearanceMm.toFixed(1)} mm`)
check('la colocacion se marca como automatica', metrics.manual === false)

// ---- 8:1 and 4:1 ------------------------------------------------------------
// Both acquisitions are done in this department. 4:1 is the one NU 2-2018
// prescribes; 8:1 is an additional local acquisition, not an operator error,
// and the contrast normalisation has to keep working for it.
section('Protocolos 4:1 y 8:1')
const series8 = buildVolume(8, sliceScales)
const analysis8 = analyzePetNema(series8, {
  sphereActivity: 8,
  backgroundActivity: 1,
  centralSliceIndex: CENTRAL_SLICE
})

check('la relacion real 4:1 se deriva de las concentraciones', Math.abs(analysis.activityRatio - 4) < 1e-9,
  `${analysis.activityRatio}`)
check('la relacion real 8:1 se deriva de las concentraciones', Math.abs(analysis8.activityRatio - 8) < 1e-9,
  `${analysis8.activityRatio}`)
check('8:1 no produce ningun error ni aviso de protocolo',
  !analysis8.warnings.some((warning) => warning.toLowerCase().includes('protocolo')))

const contrast4 = analysis.spheres.find((sphere) => sphere.diameterMm === 37).contrastPercent
const contrast8 = analysis8.spheres.find((sphere) => sphere.diameterMm === 37).contrastPercent
check(
  'el contraste de la esfera de 37 mm es comparable en 4:1 y 8:1',
  Math.abs(contrast4 - contrast8) < 5,
  `4:1 ${contrast4.toFixed(1)} % frente a 8:1 ${contrast8.toFixed(1)} %`
)
check('las 12 posiciones de fondo son las mismas en ambos protocolos',
  analysis8.backgroundRois.every((roi, index) => (
    roi.xMm === analysis.backgroundRois[index].xMm && roi.yMm === analysis.backgroundRois[index].yMm
  )))

// ---- Result -----------------------------------------------------------------
console.log('')
if (failures.length) {
  console.error(`PET ROI assertions FAILED: ${failures.length} of ${failures.length + passed.length}`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
assert.equal(failures.length, 0)
console.log(`PET ROI assertions passed: ${passed.length} checks.`)
