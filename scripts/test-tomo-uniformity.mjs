import assert from 'node:assert/strict'
import dcmjs from 'dcmjs'
import { analyzeTomoUniformity, diameterRange, measureSphere, sphereFits, sphereKernel, tomoResultsCsv } from '../src/utils/tomoUniformity.js'
import { loadTomoDicomSeries } from '../src/utils/tomoDicom.js'

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`)
function phantom(fn = () => 100) {
  return { cols: 13, rows: 15, pixelSpacing: [3, 2], dz: 4, units: 'u.a.', volume:
    Array.from({ length: 11 }, (_, z) => Float32Array.from({ length: 13 * 15 }, (_, i) => fn(i % 13, Math.floor(i / 13), z))) }
}
const cylinder = { cx: 6, cy: 7, radiusMm: 12, firstSlice: 0, lastSlice: 10, radialMarginMm: 2, axialMarginMm: 2 }
const config = { cylinder, diametersMm: [4, 8, 12], stride: 1, centerMode: 'per-diameter' }
const flat = phantom(), uniform = analyzeTomoUniformity(flat, config)
for (const r of uniform.results) {
  assert.ok(r.valid); near(r.minimum.mean, 100); near(r.maximum.mean, 100); near(r.uniformityPercent, 0)
}

// Independent brute-force oracle: integrate a sphere using physical X/Y/Z
// distances, with no kernel, prefix sum, sphereFits or production bounds code.
function brute(series, diameter) {
  const means = [], r = diameter / 2
  let minCenter, maxCenter, minimum = Infinity, maximum = -Infinity
  for (let z = 0; z < 11; z++) for (let y = 0; y < 15; y++) for (let x = 0; x < 13; x++) {
    if (Math.sqrt(((x - 6) * 2) ** 2 + ((y - 7) * 3) ** 2) + r > 10 || z * 4 - r < 0 || z * 4 + r > 40) continue
    let sum = 0, count = 0
    for (let k = 0; k < 11; k++) for (let j = 0; j < 15; j++) for (let i = 0; i < 13; i++) {
      if (((i - x) * 2) ** 2 + ((j - y) * 3) ** 2 + ((k - z) * 4) ** 2 <= r * r) { sum += series.volume[k][j * 13 + i]; count++ }
    }
    const mean = sum / count; means.push(mean)
    if (mean < minimum) { minimum = mean; minCenter = [x, y, z] }
    if (mean > maximum) { maximum = mean; maxCenter = [x, y, z] }
  }
  return { minimum, maximum, minCenter, maxCenter, count: means.length }
}
const varied = phantom((x, y, z) => 100 + x * x + 2 * y - z * z)
const measured = analyzeTomoUniformity(varied, config)
for (const row of measured.results) {
  const truth = brute(varied, row.diameterMm)
  near(row.minimum.mean, truth.minimum); near(row.maximum.mean, truth.maximum)
  assert.deepEqual(row.minimum.center, truth.minCenter); assert.deepEqual(row.maximum.center, truth.maxCenter)
  assert.equal(row.centerCount, truth.count)
  near(measureSphere(varied, cylinder, truth.minCenter, row.diameterMm).mean, truth.minimum)
}
// Radius 4 mm on a [2,3,4] mm grid: 5 on the central X row, 3 on each
// Y-adjacent row, and 1 on each Z-adjacent slice = 13 voxel centres, including neighbours
// in the other slices. A planar ROI or isotropic-index sphere cannot pass.
assert.equal(sphereKernel(8, [2, 3, 4]).voxelCount, 13)
const axialDefect = phantom((x, y, z) => x === 6 && y === 7 && z === 4 ? 0 : 100)
near(measureSphere(axialDefect, cylinder, [6, 7, 5], 8).mean, 1200 / 13)
assert.ok(analyzeTomoUniformity(axialDefect, config).results[1].minimum.mean < 100)
// Both the radial wall and the two physical end faces must be respected.
assert.equal(sphereFits(flat, cylinder, [10, 7, 5], 4), true)
assert.equal(sphereFits(flat, cylinder, [10, 7, 5], 8), false)
assert.equal(sphereFits(flat, cylinder, [6, 7, 0], 4), false)
assert.equal(sphereFits(flat, cylinder, [6, 7, 10], 4), false)
assert.throws(() => measureSphere(flat, cylinder, [6, 7, 0], 4), /no cabe/)
const common = analyzeTomoUniformity(flat, { ...config, centerMode: 'common' })
assert.equal(new Set(common.results.map(r => r.centerCount)).size, 1)
assert.ok(uniform.results[0].centerCount > uniform.results[2].centerCount)
const reduced = analyzeTomoUniformity(varied, { ...config, stride: 2 })
for (const [i, r] of reduced.results.entries()) {
  assert.ok(r.centerCount < measured.results[i].centerCount)
  assert.ok(r.minimum.mean >= measured.results[i].minimum.mean - 1e-9)
  assert.ok(r.maximum.mean <= measured.results[i].maximum.mean + 1e-9)
}
const interiorZero = phantom((x, y, z) => Math.abs(x - 6) <= 1 && Math.abs(y - 7) <= 1 && Math.abs(z - 5) <= 1 ? 0 : 100)
near(analyzeTomoUniformity(interiorZero, config).results[0].minimum.mean, 0)
const negative = phantom((x, y, z) => Math.abs(x - 6) <= 1 && y === 7 && z === 5 ? -100 : 100)
const negativeResult = analyzeTomoUniformity(negative, config)
assert.ok(negativeResult.results[0].minimum.mean < 0); assert.equal(negativeResult.results[0].uniformityPercent, null)
const invalid = phantom(); invalid.volume[0][0] = NaN
assert.throws(() => analyzeTomoUniformity(invalid, config), /no finitos/)
assert.throws(() => analyzeTomoUniformity(flat, { ...config, cylinder: { ...cylinder, cx: 0 } }), /se sale/)
assert.throws(() => analyzeTomoUniformity(flat, { ...config, diametersMm: [200] }), /Ningún/)
const tooLarge = analyzeTomoUniformity(flat, { ...config, diametersMm: [4, 200] })
assert.equal(tooLarge.results[1].valid, false)
assert.deepEqual(diameterRange(10, 31, 10), [10, 20, 30])
assert.throws(() => diameterRange(10, 60, 0), /rango/)
assert.throws(() => diameterRange(1, 100, 1), /40 diámetros/)
assert.equal(tomoResultsCsv(uniform).split('\n').length, 4)
console.log('Tomo 3D: analytic constant volume, anisotropic brute-force extrema, Z defect, zero/negative preservation, margins and centre domains passed.')

// Real DICOM bytes through the public loader. No scanner fixtures or PHI.
const { DicomDict, DicomMetaDictionary } = dcmjs.data
let serial = 0
function dicom(extra = {}, values = [10, 20, 30]) {
  const sop = `1.2.826.0.1.3680043.10.543.${++serial}`
  const ds = {
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.20', SOPInstanceUID: sop, StudyInstanceUID: '1.2.3.4', SeriesInstanceUID: '1.2.3.4.5',
    Modality: 'NM', ImageType: ['DERIVED', 'PRIMARY', 'RECON TOMO', 'EMISSION'],
    Rows: 3, Columns: 3, SamplesPerPixel: 1, PhotometricInterpretation: 'MONOCHROME2',
    BitsAllocated: 16, BitsStored: 12, HighBit: 11, PixelRepresentation: 0,
    NumberOfFrames: values.length, PixelSpacing: [3, 2], SpacingBetweenSlices: 4,
    SliceVector: values.map((_, i) => i + 1), NumberOfSlices: values.length,
    DetectorInformationSequence: [{ ImageOrientationPatient: [1, 0, 0, 0, 1, 0], ImagePositionPatient: [0, 0, 100] }],
    RescaleSlope: 2, RescaleIntercept: 3, ...extra,
  }
  for (const k of Object.keys(ds)) if (ds[k] == null) delete ds[k]
  const pixels = new Uint16Array(values.length * 9); values.forEach((v, i) => pixels.fill(v, i * 9, (i + 1) * 9))
  const dict = new DicomDict({
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1]).buffer] },
    '00020002': { vr: 'UI', Value: [ds.SOPClassUID] }, '00020003': { vr: 'UI', Value: [sop] },
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] }, '00020012': { vr: 'UI', Value: ['1.2.3.99'] },
  })
  dict.dict = DicomMetaDictionary.denaturalizeDataset(ds)
  dict.dict['7FE00010'] = { vr: 'OW', Value: [pixels.buffer] }
  const buffer = dict.write()
  return { name: 'synthetic.dcm', size: buffer.byteLength, arrayBuffer: async () => buffer }
}
const loaded = await loadTomoDicomSeries([dicom()])
assert.deepEqual(loaded.pixelSpacing, [3, 2]); near(loaded.dz, 4)
assert.deepEqual(loaded.volume.map(f => f[0]), [23, 43, 63])
const reversed = await loadTomoDicomSeries([dicom({ SpacingBetweenSlices: -4 })])
assert.deepEqual(reversed.volume.map(f => f[0]), [63, 43, 23])
const vector = await loadTomoDicomSeries([dicom({ SliceVector: [3, 1, 2] })])
assert.deepEqual(vector.volume.map(f => f[0]), [43, 63, 23])
const groups = [0, 1, 2].map(i => ({
  PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 4 * i] }],
  PixelValueTransformationSequence: [{ RescaleSlope: i + 1, RescaleIntercept: -2 }],
}))
const perFrame = await loadTomoDicomSeries([dicom({ PerFrameFunctionalGroupsSequence: groups })])
assert.deepEqual(perFrame.volume.map(f => f[0]), [8, 38, 88])
assert.equal(perFrame.info.calibration[2].source, 'per-frame')
const signed = await loadTomoDicomSeries([dicom({ PixelRepresentation: 1, RescaleSlope: 1, RescaleIntercept: 0 }, [4095, 10, 20])])
assert.equal(signed.volume[0][0], -1)
const single = z => dicom({ NumberOfFrames: 1, NumberOfSlices: null, SliceVector: null,
  ImageOrientationPatient: [1, 0, 0, 0, 1, 0], ImagePositionPatient: [0, 0, z], DetectorInformationSequence: null }, [z])
const stack = await loadTomoDicomSeries([single(8), single(0), single(4)])
assert.deepEqual(stack.volume.map(f => f[0]), [3, 11, 19]); near(stack.dz, 4)
await assert.rejects(() => loadTomoDicomSeries([single(0), single(4), single(9)]), /espaciado irregular/)
await assert.rejects(() => loadTomoDicomSeries([single(0), single(4), single(4)]), /duplicados/)
await assert.rejects(() => loadTomoDicomSeries([single(0), single(8), single(16)]), /no concuerdan/)
const same = dicom(); await assert.rejects(() => loadTomoDicomSeries([same, same]), /duplicada/)
await assert.rejects(() => loadTomoDicomSeries([dicom(), dicom({ SeriesInstanceUID: '1.2.3.6' })]), /mezcla series/)
await assert.rejects(() => loadTomoDicomSeries([dicom({ ImageType: ['ORIGINAL', 'PRIMARY', 'TOMO', 'EMISSION'] })]), /reconstruido/)
await assert.rejects(() => loadTomoDicomSeries([dicom({ ImageType: ['DERIVED', 'PRIMARY', 'RECON GATED TOMO'] })]), /gated/)
await assert.rejects(() => loadTomoDicomSeries([dicom({ SpacingBetweenSlices: null, SliceThickness: 4 })]), /SliceThickness/)
await assert.rejects(() => loadTomoDicomSeries([dicom({ SliceVector: [1, 2, 2] })]), /repetidos/)
await assert.rejects(() => loadTomoDicomSeries([dicom({ SliceVector: [1, 2, 4] })]), /huecos/)
await assert.rejects(() => loadTomoDicomSeries([dicom({ NumberOfFrames: 4, NumberOfSlices: 4 })]), /incompleto/)
await assert.rejects(() => loadTomoDicomSeries([dicom({ NumberOfFrames: 2, NumberOfSlices: 2 })]), /sobrantes/)
await assert.rejects(() => loadTomoDicomSeries([dicom({ EnergyWindowVector: [1, 2, 1] })]), /mezcla/)
await assert.rejects(() => loadTomoDicomSeries([dicom({ RescaleSlope: 0 })]), /Rescale/)
const skewed = groups.map((g, i) => ({ ...g, PlanePositionSequence: [{ ImagePositionPatient: [i, 0, 4 * i] }] }))
await assert.rejects(() => loadTomoDicomSeries([dicom({ PerFrameFunctionalGroupsSequence: skewed })]), /desplazamiento lateral/)
console.log('Tomo DICOM: NM multiframe and spatial slice stacks, signed pixels, per-frame calibration, negative slice spacing, ordering and rejection checks passed.')
