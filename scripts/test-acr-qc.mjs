import assert from "node:assert/strict";
import dcmjs from "dcmjs";
import {
  loadDicomFile,
  parseDataSet,
  testPIU,
  testGhosting,
  buildExcelExportRows,
} from "../src/lib/acr-qc.js";
import {
  canonicalizeAcrImage,
  validateAcrStack,
  validateAcrBatch,
  scoreAcrProtocol,
  summarizeAcrResults,
  thicknessVerdict,
  positionVerdict,
  visualAcrResults,
} from "../src/utils/acrQcValidation.js";
import {
  measureAcrPiu,
  measureAcrGhosting,
  proposedNotchMask,
} from "../src/utils/acrQcRois.js";

let checks = 0;
async function test(name, fn) {
  await fn();
  checks++;
  console.log(`ok ${name}`);
}
const near = (a, b, tol = 1e-6) =>
  assert(Math.abs(a - b) <= tol, `${a} != ${b}`);
function phantom(
  signal = () => 1000,
  spacing = [250 / 256, 250 / 256],
  center = [128, 128],
) {
  const rows = 256,
    cols = 256,
    data = new Float32Array(rows * cols);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const dx = (x - center[0]) * spacing[1],
        dy = (y - center[1]) * spacing[0],
        r = Math.hypot(dx, dy);
      data[y * cols + x] = r <= 82.5 ? signal(dx, dy, r) : 0;
    }
  return {
    rows,
    cols,
    data,
    pixelSpacing: spacing,
    imagePosition: [0, 0, 0],
    imageOrientation: [1, 0, 0, 0, 1, 0],
    modality: "MR",
    studyInstanceUID: "1.2.3",
    seriesInstanceUID: "1.2.3.1",
    sopInstanceUID: "1.2.3.1.1",
    sliceThickness: 5,
    repetitionTime: 500,
    echoTime: 20,
  };
}
const geom = { cx: 128, cy: 128, xMin: 44, xMax: 212, yMin: 44, yMax: 212 };
const stack = () =>
  Array.from({ length: 11 }, (_, i) => ({
    ...phantom(),
    imagePosition: [0, 0, i * 10],
    sopInstanceUID: `1.2.3.1.${i + 1}`,
  }));

await test("Uniform image: PIU 100 and physical ROI 160 cm²", () => {
  const r = measureAcrPiu(phantom(), geom);
  near(r.piu, 100);
  near(r.areaCm2, 160, 0.2);
  near(r.smallAreaCm2, 1, 0.06);
});
await test("Peripheral signal loss cannot pass (original module produced 100%)", () => {
  const img = phantom((x, y, r) => (r < 62 ? 1000 : 600));
  const r = testPIU(img, 1.5);
  assert.equal(r.pass, false);
  near(r.exportData.piuPct, 78.01932367149759, 1);
});
await test("Internal low signal cannot be discarded as a bubble (original: 100%)", () => {
  const img = phantom((x, y) =>
    Math.hypot(x - 25, y) < 12
      ? 100 + 100 * (Math.hypot(x - 25, y) / 12) ** 2
      : 1000,
  );
  const r = testPIU(img, 1.5);
  assert.equal(r.pass, false);
  near(r.exportData.piuPct, 19.938007635459087, 1);
  assert.equal(r.exportData.excludedPixels, 0);
});
await test("Unequal pixel sizes preserve physical area and uniform PIU", () => {
  const r = measureAcrPiu(
    phantom(() => 1000, [1, 1.2]),
    geom,
  );
  near(r.piu, 100);
  near(r.areaCm2, 160, 0.3);
  near(r.smallAreaCm2, 1, 0.06);
});
await test("Only anterior exterior-connected notch pixels can be proposed", () => {
  const img = phantom(),
    mask = new Uint8Array(256 * 256).fill(1);
  mask[70 * 256 + 128] = 0;
  mask[128 * 256 + 128] = 0;
  mask[128 * 256 + 180] = 0;
  const n = proposedNotchMask(img, geom, mask);
  assert.equal(n[70 * 256 + 128], 1);
  assert.equal(n[128 * 256 + 128], 0);
  assert.equal(n[128 * 256 + 180], 0);
});
await test("Ghosting includes low signal in the large ROI mean", () => {
  const img = phantom((x, y) => (Math.hypot(x, y) < 15 ? 0 : 1000));
  const r = measureAcrGhosting(img, geom);
  assert(r.large.mean < 970 && r.large.mean > 900);
  for (const v of Object.values(r.measurements)) near(v.areaCm2, 10);
});
await test("Off-centre ghosting background ROIs keep 10 cm²", () => {
  const img = phantom(() => 1000, [250 / 256, 250 / 256], [148, 128]);
  const r = measureAcrGhosting(img, { ...geom, cx: 148, xMin: 64, xMax: 232 });
  for (const v of Object.values(r.measurements)) near(v.areaCm2, 10);
});
await test("Ghosting 3.0% boundary passes", () => {
  const img = phantom();
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++)
      if (y < 38 || y > 218) img.data[y * 256 + x] = 30;
  const r = testGhosting(img);
  near(r.exportData.psgPct, 3);
  assert.equal(r.pass, true);
});
await test("No room and padding cannot silently produce a ghosting measurement", () => {
  assert.throws(
    () => measureAcrGhosting(phantom(), { ...geom, xMin: 1 }),
    /espacio/,
  );
  const img = phantom();
  img.paddingMask = new Uint8Array(256 * 256);
  img.paddingMask[128 * 256 + 128] = 1;
  assert.throws(() => measureAcrPiu(img, geom), /padding/);
});
await test("Eleven unique, regularly spaced slices are accepted", () =>
  assert.equal(validateAcrStack(stack()), true));
await test("Repeated files or repeated locations are rejected", () => {
  const a = stack();
  a[10] = { ...a[0] };
  assert.throws(() => validateAcrStack(a), /duplicado/);
  a[10] = { ...a[0], sopInstanceUID: "new" };
  assert.throws(() => validateAcrStack(a), /duplicadas/);
  assert.throws(() => validateAcrBatch([a[0], a[0]]), /duplicados/);
});
await test("Real slice spacing and study identity are checked", () => {
  const a = stack();
  a[5].imagePosition[2] += 2;
  assert.throws(() => validateAcrStack(a), /separación/);
  a[5].studyInstanceUID = "other";
  assert.throws(() => validateAcrBatch(a), /studyInstanceUID/);
});
await test("Protocol does not approve absent tags or a 128×256 matrix", () => {
  assert.equal(scoreAcrProtocol({}).conformant, false);
  assert.equal(
    scoreAcrProtocol({ rows: 128, cols: 256, tr: 9999, te: 1 }).conformant,
    false,
  );
  const g = {
    rows: 256,
    cols: 256,
    tr: 500,
    te: 20,
    acquisitionMatrix: [256, 0, 0, 256],
    fovX: 250,
    fovY: 250,
    sliceThickness: 5,
    numberOfAverages: 1,
    echoTrainLength: 1,
    scanningSequence: "SE",
    stackValidated: true,
  };
  assert.equal(scoreAcrProtocol(g).conformant, true);
  assert.equal(scoreAcrProtocol({ ...g, rows: 128 }).conformant, false);
});
await test("An incomplete assessment never yields global pass", () => {
  for (const r of [
    [],
    [{ pass: true, skipped: true }],
    [{ pass: true }, { pass: null }],
    [{ pass: true }, { pass: false, error: true }],
  ])
    assert.equal(summarizeAcrResults(r).overallPass, false);
  assert.equal(
    summarizeAcrResults([{ pass: true }, { pass: false, complementary: true }])
      .overallPass,
    true,
  );
});
await test("ACR recommended and acceptable limits are distinct", () => {
  assert.deepEqual(thicknessVerdict(5.8), { pass: true, warn: true });
  assert.equal(thicknessVerdict(6).pass, true);
  assert.equal(thicknessVerdict(6.01).pass, false);
  assert.deepEqual(positionVerdict(6), { pass: true, warn: true });
  assert.equal(positionVerdict(7).pass, true);
  assert.equal(positionVerdict(7.01).pass, false);
  assert.equal(positionVerdict(4.5, true).warn, true);
  assert.equal(positionVerdict(4.5, false).warn, false);
});
await test("Visual tests stay pending until entered; field-specific LCD thresholds", () => {
  assert(visualAcrResults().every((r) => r.pass === null));
  const review = {
    resolutionH: "1",
    resolutionV: "1",
    lcd8: "7",
    lcd9: "7",
    lcd10: "7",
    lcd11: "7",
    artifacts: "pass",
    measurements: "pass",
  };
  assert.equal(visualAcrResults(review, 1.5, "T1")[1].pass, false);
  assert.equal(visualAcrResults(review, 1.5, "T2")[1].pass, true);
  assert.equal(visualAcrResults({ ...review, lcd8: "" })[1].pass, null);
  assert.equal(visualAcrResults({ ...review, lcd8: "2.5" })[1].pass, null);
});
await test("Image flips/transposes preserve spatial coordinates and padding", () => {
  const img = {
    ...phantom(),
    rows: 2,
    cols: 3,
    data: Float32Array.of(1, 2, 3, 4, 5, 6),
    paddingMask: Uint8Array.of(1, 0, 0, 0, 0, 0),
    pixelSpacing: [2, 3],
    imageOrientation: [-1, 0, 0, 0, -1, 0],
  };
  const r = canonicalizeAcrImage(img);
  assert.deepEqual([...r.data], [6, 5, 4, 3, 2, 1]);
  assert.equal(r.paddingMask[5], 1);
  assert.deepEqual(r.imagePosition, [-6, -2, 0]);
  const t = canonicalizeAcrImage({
    ...img,
    imageOrientation: [0, 1, 0, 1, 0, 0],
  });
  assert.deepEqual([...t.data], [1, 4, 2, 5, 3, 6]);
  assert.deepEqual(t.pixelSpacing, [3, 2]);
});

function dataset(values = {}, bytes = [0, 0, 0, 0, 0, 0, 0, 0]) {
  const tags = {
    x00020010: "1.2.840.10008.1.2.1",
    x00280010: 2,
    x00280011: 2,
    x00280100: 16,
    x00280101: 16,
    x00280102: 15,
    x00280103: 0,
    x00280002: 1,
    x00280004: "MONOCHROME2",
    x00280030: "1\\1",
    x00200032: "0\\0\\0",
    x00200037: "1\\0\\0\\0\\1\\0",
    x0020000d: "1.2.3",
    x0020000e: "1.2.3.1",
    x00080018: "1.2.3.1.1",
    x00080060: "MR",
    ...values,
  };
  return {
    string: (t) => tags[t],
    uint16: (t, i = 0) => (Array.isArray(tags[t]) ? tags[t][i] : tags[t]),
    int16: (t) => tags[t],
    elements: { x7fe00010: { dataOffset: 0, length: bytes.length } },
    byteArray: Uint8Array.from(bytes),
  };
}
await test("Signed 12-bit pixels are sign extended", () => {
  const r = parseDataSet(
    dataset(
      { x00280101: 12, x00280102: 11, x00280103: 1 },
      [255, 15, 0, 0, 0, 0, 0, 0],
    ),
    "signed",
  );
  assert.equal(r.data[0], -1);
});
await test("Big endian and rescale are applied in order", () => {
  const r = parseDataSet(
    dataset(
      { x00020010: "1.2.840.10008.1.2.2", x00281053: "2", x00281052: "-5" },
      [3, 232, 0, 0, 0, 0, 0, 0],
    ),
    "big",
  );
  assert.equal(r.data[0], 1995);
});
await test("Compressed, multiframe, truncated and uncalibrated images are rejected", () => {
  assert.throws(
    () =>
      parseDataSet(dataset({ x00020010: "1.2.840.10008.1.2.4.90" }), "jpeg"),
    /Transfer Syntax/,
  );
  assert.throws(
    () => parseDataSet(dataset({ x00280008: "2" }), "multi"),
    /multiframe/,
  );
  assert.throws(() => parseDataSet(dataset({}, [0, 0]), "short"), /incompleto/);
  assert.throws(
    () => parseDataSet(dataset({ x00280030: undefined }), "uncalibrated"),
    /PixelSpacing/,
  );
});
await test("Real native DICOM bytes go through loadDicomFile and shared pixel normalization", async () => {
  const meta = {
    "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] },
    "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.4"] },
    "00020003": { vr: "UI", Value: ["1.2.3.1.1"] },
  };
  const dict = {};
  const add = (tag, vr, value) =>
    (dict[tag] = { vr, Value: Array.isArray(value) ? value : [value] });
  for (const [tag, vr, value] of [
    ["00080016", "UI", "1.2.840.10008.5.1.4.1.1.4"],
    ["00080018", "UI", "1.2.3.1.1"],
    ["00080060", "CS", "MR"],
    ["0020000D", "UI", "1.2.3"],
    ["0020000E", "UI", "1.2.3.1"],
    ["00280010", "US", 2],
    ["00280011", "US", 2],
    ["00280002", "US", 1],
    ["00280004", "CS", "MONOCHROME2"],
    ["00280100", "US", 16],
    ["00280101", "US", 12],
    ["00280102", "US", 11],
    ["00280103", "US", 1],
    ["00280030", "DS", [1, 1]],
    ["00200032", "DS", [0, 0, 0]],
    ["00200037", "DS", [1, 0, 0, 0, 1, 0]],
  ])
    add(tag, vr, value);
  add("7FE00010", "OW", Uint16Array.of(4095, 100, 200, 300).buffer);
  const d = new dcmjs.data.DicomDict(meta);
  d.dict = dict;
  const bytes = d.write();
  const img = await loadDicomFile({
    name: "synthetic.dcm",
    arrayBuffer: async () => bytes,
  });
  assert.equal(img.data[0], -1);
  assert.equal(img.data[3], 300);
});
await test("Exports use the supplied run snapshot and include pending/global status", () => {
  const results = [
    { section: true, title: "T1 — original" },
    {
      name: "PIU",
      exportKey: "piu_slice_7",
      pass: true,
      exportData: { piuPct: 95 },
    },
    { name: "T2 pendiente", pass: null },
  ];
  const analysis = {
    t1: {
      seriesInstanceUID: "OLD",
      seriesNumber: "1",
      magneticFieldStrength: 2,
    },
  };
  const rows = buildExcelExportRows({
    results,
    analysis,
    fieldStrength: 1.5,
    runAt: new Date("2026-09-25T10:00:00Z"),
  });
  assert.equal(rows[1][rows[0].indexOf("series_uid")], "OLD");
  assert.equal(rows[1][rows[0].indexOf("pass_global")], 0);
  assert.equal(rows[1][rows[0].indexOf("piu_pct")], 95);
  assert.equal(rows[1][rows[0].indexOf("campo_t")], 2);
  assert.equal(rows[1][rows[0].indexOf("categoria_campo_t")], "1.5–<3");
});
console.log(`\n${checks} ACR regression checks passed.`);
