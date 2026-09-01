import dcmjs from 'dcmjs'
import { decodeRgb16Tiff, pairedNetOdRoi, resolveRoi, rgbStats } from '../src/utils/filmTiff.js'
import {
  buildFilmCalibration,
  calibrationNetOd,
  invertCalibrationNetOd
} from '../src/utils/filmCalibration.js'
import { analyzeFilmImage } from '../src/utils/filmAnalysis.js'
import { parseFilmCalibration, serializeFilmCalibration } from '../src/utils/filmStorage.js'
import { createFilmRtDose, RT_DOSE_STORAGE_UID } from '../src/utils/rtDoseWriter.js'

const { DicomDict, DicomMessage } = dcmjs.data
const failures = []

function check(label, condition, detail = '') {
  if (condition) console.log(`  ok   ${label}${detail ? ` (${detail})` : ''}`)
  else {
    failures.push(`${label}${detail ? ` -> ${detail}` : ''}`)
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`)
  }
}

function near(actual, expected, tolerance) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
}

function makeRgb16Tiff(width, height, values) {
  const entries = 10
  const ifdOffset = 8
  const afterIfd = ifdOffset + 2 + entries * 12 + 4
  const bitsOffset = afterIfd
  const sampleFormatOffset = bitsOffset + 6
  const pixelOffset = sampleFormatOffset + 6
  const pixelBytes = width * height * 3 * 2
  const buffer = new ArrayBuffer(pixelOffset + pixelBytes)
  const view = new DataView(buffer)
  view.setUint8(0, 0x49); view.setUint8(1, 0x49)
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, entries, true)
  let cursor = ifdOffset + 2
  const entry = (tag, type, count, value) => {
    view.setUint16(cursor, tag, true)
    view.setUint16(cursor + 2, type, true)
    view.setUint32(cursor + 4, count, true)
    if (type === 3 && count === 1) view.setUint16(cursor + 8, value, true)
    else view.setUint32(cursor + 8, value, true)
    cursor += 12
  }
  entry(256, 4, 1, width)
  entry(257, 4, 1, height)
  entry(258, 3, 3, bitsOffset)
  entry(259, 3, 1, 1)
  entry(262, 3, 1, 2)
  entry(273, 4, 1, pixelOffset)
  entry(277, 3, 1, 3)
  entry(278, 4, 1, height)
  entry(279, 4, 1, pixelBytes)
  entry(284, 3, 1, 1)
  view.setUint32(cursor, 0, true)
  for (let channel = 0; channel < 3; channel++) {
    view.setUint16(bitsOffset + channel * 2, 16, true)
    view.setUint16(sampleFormatOffset + channel * 2, 1, true)
  }
  // SampleFormat is optional; the six bytes remain as harmless padding.
  for (let index = 0; index < values.length; index++) view.setUint16(pixelOffset + index * 2, values[index], true)
  return buffer
}

function covariance(value = 1e-6) {
  return [[value, value * 0.15, value * 0.08], [value * 0.15, value * 1.2, value * 0.12], [value * 0.08, value * 0.12, value * 1.5]]
}

function makeCalibration() {
  const truth = [
    { a: 100, b: 0.16, c: 100 },
    { a: 140, b: 0.31, c: 140 },
    { a: 200, b: 0.52, c: 200 }
  ]
  const points = [0.5, 1, 2, 3, 4, 5, 6, 7].map((doseGy, index) => ({
    id: `point-${index}`,
    doseGy,
    summary: {
      roi: { x: 0, y: 0, width: 10, height: 10 },
      baseline: { mean: [50000, 50000, 50000], count: 100 },
      exposed: { mean: truth.map((params) => 50000 / (10 ** calibrationNetOd(doseGy, params))), count: 100 },
      netOd: {
        mean: truth.map((params) => calibrationNetOd(doseGy, params)),
        covariance: covariance(),
        count: 100
      }
    }
  }))
  return { calibration: buildFilmCalibration({ name: 'Sintética', points, roi: null }), truth }
}

console.log('\nTIFF RGB de 16 bits')
{
  const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]
  const image = decodeRgb16Tiff(makeRgb16Tiff(2, 2, values), 'synthetic.tif')
  check('decodifica dimensiones', image.width === 2 && image.height === 2)
  check('conserva Uint16 RGB', image.data instanceof Uint16Array && image.data.length === 12)
  check('conserva los valores', image.data.every((value, index) => value === values[index]))
}

console.log('\nROI de calibración')
{
  const geometry = { width: 100, height: 80 }
  const full = resolveRoi(geometry, null)
  check('sin ROI selecciona la imagen completa', full.x === 0 && full.y === 0 && full.width === 100 && full.height === 80 && full.fullImage)

  const relative = resolveRoi(geometry, { mode: 'relative', x: 0.2, y: 0.25, width: 0.5, height: 0.5 })
  check('convierte la ROI relativa a píxeles', relative.x === 20 && relative.y === 20 && relative.width === 50 && relative.height === 40 && !relative.fullImage)

  const legacy = resolveRoi(geometry, { centerX: 0.5, centerY: 0.5, widthPx: 35, heightPx: 25 })
  check('mantiene compatibilidad con la ROI anterior', legacy.width === 35 && legacy.height === 25 && !legacy.fullImage)

  const baselineData = new Float32Array(4 * 2 * 3).fill(1000)
  const exposedData = new Float32Array(4 * 2 * 3).fill(500)
  const baseline = [{ width: 4, height: 2, data: baselineData, name: 'pre.tif' }]
  const exposed = [{ width: 4, height: 2, data: exposedData, name: 'post.tif' }]
  const fullSummary = pairedNetOdRoi(baseline, exposed, null)
  const roiSummary = pairedNetOdRoi(baseline, exposed, { mode: 'relative', x: 0.5, y: 0, width: 0.5, height: 1 })
  check('el cálculo completo usa todos los píxeles', fullSummary.netOd.count === 8 && fullSummary.roi.fullImage)
  check('el cálculo con ROI usa solo la zona elegida', roiSummary.netOd.count === 4 && roiSummary.roi.x === 2 && !roiSummary.roi.fullImage)
  check('ambos modos conservan netOD píxel a píxel', near(fullSummary.netOd.mean[0], Math.log10(2), 1e-12) && near(roiSummary.netOd.mean[0], Math.log10(2), 1e-12))

  const variedBaseline = new Float32Array([
    1000, 1500, 2000, 1200, 1600, 2200,
    1400, 1800, 2400, 1700, 2100, 2700
  ])
  const variedExposed = new Float32Array([
    800, 1000, 1200, 900, 1100, 1300,
    950, 1200, 1500, 1000, 1300, 1600
  ])
  const expectedNetOd = new Float64Array(variedBaseline.length)
  for (let index = 0; index < expectedNetOd.length; index++) expectedNetOd[index] = Math.log10(variedBaseline[index] / variedExposed[index])
  const expectedStats = rgbStats(expectedNetOd)
  const variedSummary = pairedNetOdRoi(
    [{ width: 2, height: 2, data: variedBaseline, name: 'pre-varied.tif' }],
    [{ width: 2, height: 2, data: variedExposed, name: 'post-varied.tif' }],
    null
  )
  check('la acumulación incremental conserva medias', variedSummary.netOd.mean.every((value, channel) => near(value, expectedStats.mean[channel], 1e-12)))
  check('la acumulación incremental conserva covarianzas', variedSummary.netOd.covariance.every((row, r) => row.every((value, c) => near(value, expectedStats.covariance[r][c], 1e-12))))
}

console.log('\nCalibración racional RGB')
const { calibration, truth } = makeCalibration()
{
  check('las tres curvas son monótonas', calibration.fits.every((fit) => fit.monotonic))
  check('R² alto en los tres canales', calibration.fits.every((fit) => fit.r2 > 0.9999), calibration.fits.map((fit) => fit.r2.toFixed(6)).join(', '))
  for (let channel = 0; channel < 3; channel++) {
    const y = calibrationNetOd(3.5, truth[channel])
    const recovered = invertCalibrationNetOd(y, calibration.fits[channel].params, calibration.doseRangeGy)
    check(`inversión canal ${channel}`, near(recovered, 3.5, 0.03), String(recovered))
  }
  const restored = parseFilmCalibration(serializeFilmCalibration(calibration))
  check('exportación/importación conserva identidad y zona completa', restored.id === calibration.id && restored.roi === null)
}

console.log('\nReconstrucción multicanal')
{
  const doseTruth = 3.2
  const perturbation = 0.012
  const reference = 50000
  const data = new Float32Array(4 * 3)
  for (let pixel = 0; pixel < 4; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      const y = calibrationNetOd(doseTruth, calibration.fits[channel].params) + perturbation
      data[pixel * 3 + channel] = reference / (10 ** y)
    }
  }
  const result = analyzeFilmImage({
    measurement: { width: 2, height: 2, data, pixelSpacingMm: [0.1, 0.1] },
    calibration,
    method: 'multichannel'
  })
  check('recupera la dosis', near(result.statistics.meanGy, doseTruth, 0.03), String(result.statistics.meanGy))
  check('recupera la perturbación común', near(result.delta[0], perturbation, 0.002), String(result.delta[0]))
  check('no marca píxeles inválidos', result.invalid.every((value) => value === 0))
}

function makeReferenceCt() {
  const sop = '2.25.1001'
  const meta = {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1]).buffer] },
    '00020002': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.2'] },
    '00020003': { vr: 'UI', Value: [sop] },
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] },
    '00020012': { vr: 'UI', Value: ['2.25.1000'] },
    '00020013': { vr: 'SH', Value: ['TEST'] }
  }
  const dict = {
    '00080016': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.2'] },
    '00080018': { vr: 'UI', Value: [sop] },
    '00080020': { vr: 'DA', Value: ['20260831'] },
    '00080030': { vr: 'TM', Value: ['120000'] },
    '00080060': { vr: 'CS', Value: ['CT'] },
    '00100010': { vr: 'PN', Value: [{ Alphabetic: 'TEST^FILM' }] },
    '00100020': { vr: 'LO', Value: ['FILM001'] },
    '00100030': { vr: 'DA', Value: [] },
    '00100040': { vr: 'CS', Value: [] },
    '0020000D': { vr: 'UI', Value: ['2.25.1002'] },
    '0020000E': { vr: 'UI', Value: ['2.25.1003'] },
    '00200010': { vr: 'SH', Value: ['FILM'] },
    '00200032': { vr: 'DS', Value: ['1', '2', '3'] },
    '00200037': { vr: 'DS', Value: ['1', '0', '0', '0', '1', '0'] },
    '00200052': { vr: 'UI', Value: ['2.25.1004'] },
    '00280030': { vr: 'DS', Value: ['1', '1'] }
  }
  const dd = new DicomDict(meta)
  dd.dict = dict
  return dd.write()
}

function makeReferencePlan() {
  const sop = '2.25.1005'
  const sopClass = '1.2.840.10008.5.1.4.1.1.481.5'
  const meta = {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1]).buffer] },
    '00020002': { vr: 'UI', Value: [sopClass] },
    '00020003': { vr: 'UI', Value: [sop] },
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] },
    '00020012': { vr: 'UI', Value: ['2.25.1000'] },
    '00020013': { vr: 'SH', Value: ['TEST'] }
  }
  const dict = {
    '00080016': { vr: 'UI', Value: [sopClass] },
    '00080018': { vr: 'UI', Value: [sop] },
    '00080060': { vr: 'CS', Value: ['RTPLAN'] },
    '0020000D': { vr: 'UI', Value: ['2.25.1002'] },
    '0020000E': { vr: 'UI', Value: ['2.25.1006'] },
    '00200052': { vr: 'UI', Value: ['2.25.1004'] }
  }
  const dd = new DicomDict(meta)
  dd.dict = dict
  return dd.write()
}

console.log('\nDICOM RT Dose')
{
  let missingPlanRejected = false
  try {
    createFilmRtDose({
      dose: new Float32Array([0, 1, 2, 3]),
      width: 2,
      height: 2,
      pixelSpacingMm: [0.2, 0.2],
      referenceBuffer: makeReferenceCt(),
      calibrationName: 'Sintética',
      method: 'multichannel'
    })
  } catch (error) {
    missingPlanRejected = /RT Plan/.test(error.message)
  }
  check('rechaza PLAN sin referencia a RT Plan', missingPlanRejected)

  const result = createFilmRtDose({
    dose: new Float32Array([0, 1, 2, 3]),
    width: 2,
    height: 2,
    pixelSpacingMm: [0.2, 0.2],
    referenceBuffer: makeReferenceCt(),
    planReferenceBuffer: makeReferencePlan(),
    calibrationName: 'Sintética',
    method: 'multichannel'
  })
  const parsed = DicomMessage.readFile(result.buffer)
  check('SOP Class RT Dose', parsed.dict['00080016'].Value[0] === RT_DOSE_STORAGE_UID)
  check('matriz 32 bits unsigned', parsed.dict['00280100'].Value[0] === 32 && parsed.dict['00280103'].Value[0] === 0)
  check('unidades Gy', parsed.dict['30040002'].Value[0] === 'GY')
  check('conserva Frame of Reference', parsed.dict['00200052'].Value[0] === '2.25.1004')
  check('referencia el RT Plan', parsed.dict['300C0002'].Value[0]['00081155'].Value[0] === '2.25.1005')
  check('incluye Slice Thickness tipo 2', Boolean(parsed.dict['00180050']))
  check('usa el espaciado de película', parsed.dict['00280030'].Value.map(Number).every((value) => near(value, 0.2, 1e-9)))
  check('cuantización limitada', result.doseGridScaling < 1e-8, String(result.doseGridScaling))
}

if (failures.length) {
  console.error(`\n${failures.length} fallo(s):\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('\nTodas las pruebas de dosimetría de película han pasado.')
