import { strict as assert } from 'node:assert'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rolldown } from 'rolldown'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = await mkdtemp(join(tmpdir(), 'tg43-tests-'))
const entry = join(buildDir, 'test-entry.ts')
const bundle = join(buildDir, 'test-bundle.mjs')

const testSource = `
import { strict as assert } from 'node:assert'
import {
  calculateDoseFromSource,
  getGeometryFunction,
  getSetupFractionMultiplier,
  interpolateAnisotropy,
  interpolateRadialDose
} from '${repoRoot}/src/lib/brachy/tg43.ts'
import { parseBrachyDataset } from '${repoRoot}/src/lib/brachy/rtplanParser.ts'
import {
  SOURCE_MODEL,
  anisotropyAnglesDeg,
  anisotropyMatrix,
  anisotropyRadii
} from '${repoRoot}/src/lib/brachy/sourceData.ts'

const close = (actual: number, expected: number, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    \`expected \${expected}, received \${actual}\`)
}

assert.equal(SOURCE_MODEL.id, 'GMPir HDR (2012)')
close(SOURCE_MODEL.doseRateConstant, 1.1165)
close(SOURCE_MODEL.activeLength, 0.35)
close(SOURCE_MODEL.activeDiameter, 0.06)
close(SOURCE_MODEL.capsuleLength, 0.452)
close(SOURCE_MODEL.capsuleDiameter, 0.09)
close(SOURCE_MODEL.capsuleInnerDiameter, 0.07)
assert.equal(SOURCE_MODEL.capsuleMaterial, 'Acero inoxidable AISI 316L')
assert.equal(SOURCE_MODEL.cableMaterial, 'Acero inoxidable AISI 304')
assert.equal(anisotropyRadii.length, 17)
assert.equal(anisotropyAnglesDeg.length, 39)
assert.ok(anisotropyMatrix.every(row => row.length === anisotropyRadii.length))
close(interpolateRadialDose(0.2), 0.998053)
close(interpolateRadialDose(10), 0.935132)
close(interpolateAnisotropy(0.2, Math.PI), 0.41671)
close(interpolateAnisotropy(10, Math.PI), 0.6328)
close(interpolateAnisotropy(3, Math.PI / 2), 1.0)

const source = {
  x: 0, y: 0, z: 0,
  orientation: [0, 0, 1] as [number, number, number],
  dwellTime: 100,
  Sk: 4070,
  doseRateConstant: SOURCE_MODEL.doseRateConstant,
  L: SOURCE_MODEL.activeLength,
  tHalf: SOURCE_MODEL.halfLife
}
close(getGeometryFunction(source, { x: 1, y: 0, z: 0 }), 1, 1e-12)
const transverseDose = calculateDoseFromSource(source, { x: 1, y: 0, z: 0 })
assert.ok(transverseDose > 0)
const distalDose = calculateDoseFromSource(source, { x: 0, y: 0, z: 1 })
const cableDose = calculateDoseFromSource(source, { x: 0, y: 0, z: -1 })
assert.ok(distalDose > cableDose, 'la anisotropía debe distinguir extremo distal y cable')

const unitRateSource = { ...source, Sk: 1, dwellTime: 3600 }
close(calculateDoseFromSource(unitRateSource, { x: 1, y: 0, z: 0 }), 1.1165, 1e-9)
close(calculateDoseFromSource(unitRateSource, { x: 0.5, y: 0, z: 0 }), 4.324258, 1e-6)

const dataset = {
  PatientName: 'TEST',
  RTPlanLabel: 'HDR-1',
  RTPlanDate: '20260827',
  SourceSequence: [{
    SourceIsotopeName: 'Ir-192',
    ReferenceAirKermaRate: '4070',
    RadionuclideHalfLife: String(73.83 * 86400),
    SourceStrengthReferenceDate: '20260827'
  }],
  DoseReferenceSequence: [{
    DoseReferenceNumber: '1',
    DoseReferenceDescription: 'Punto A',
    DoseReferencePointCoordinates: [10, 0, 0],
    TargetPrescriptionDose: '21'
  }],
  FractionGroupSequence: [{
    FractionGroupNumber: '1',
    NumberOfFractionsPlanned: '3',
    NumberOfBrachyApplicationSetups: '1',
    ReferencedBrachyApplicationSetupSequence: [{
      ReferencedBrachyApplicationSetupNumber: '1',
      BrachyApplicationSetupDoseSpecificationPoint: [10, 0, 0],
      BrachyApplicationSetupDose: '7'
    }]
  }],
  ApplicationSetupSequence: [{
    ApplicationSetupNumber: '1',
    ApplicationSetupName: 'Aplicador',
    ChannelSequence: [{
      ChannelNumber: '1',
      ChannelLength: '1000',
      ChannelTotalTime: '30',
      FinalCumulativeTimeWeight: '100',
      SourceMovementType: 'STEPWISE',
      BrachyControlPointSequence: [
        { ControlPointIndex: '0', CumulativeTimeWeight: '0', ControlPointRelativePosition: '0', ControlPoint3DPosition: [0, 0, 0] },
        { ControlPointIndex: '1', CumulativeTimeWeight: '20', ControlPointRelativePosition: '0', ControlPoint3DPosition: [0, 0, 0] },
        { ControlPointIndex: '2', CumulativeTimeWeight: '20', ControlPointRelativePosition: '5', ControlPoint3DPosition: [0, 0, 5] },
        { ControlPointIndex: '3', CumulativeTimeWeight: '100', ControlPointRelativePosition: '5', ControlPoint3DPosition: [0, 0, 5] }
      ]
    }]
  }]
}

const plan = parseBrachyDataset(dataset)
assert.equal(plan.channels.length, 1)
assert.equal(plan.channels[0].dwells.length, 2)
close(plan.channels[0].dwells[0].dwellTime, 6)
close(plan.channels[0].dwells[1].dwellTime, 24)
close(plan.channels[0].dwells.reduce((sum, dwell) => sum + dwell.dwellTime, 0), 30)
assert.equal(plan.numberOfFractions, 3)
assert.equal(getSetupFractionMultiplier(plan, 1), 3)
const referencePoint = plan.doseReferencePoints.find(point => point.name === 'Punto A')!
close(referencePoint.prescribedDosePerFraction!, 7)
close(referencePoint.prescribedDoseTotal!, 21)
assert.ok(plan.doseReferencePoints.some(point => point.prescriptionSource?.includes('Brachy Application Setup Dose')))

console.log('TG-43 tests passed: source table, geometry, dwell timing and fractionation.')
`

try {
  await writeFile(entry, testSource)
  const build = await rolldown({
    input: entry,
    external: ['node:assert']
  })
  await build.write({ file: bundle, format: 'esm' })
  await import(pathToFileURL(bundle).href)
} finally {
  await rm(buildDir, { recursive: true, force: true })
}

assert.ok(true)
