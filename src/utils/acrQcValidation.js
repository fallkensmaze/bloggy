// ACR Large/Medium Phantom Guidance 10/2022; acquisition instructions 02/2026.
// Validation tolerances below handle coordinate/metadata rounding, not ACR limits.
export const ACR_METHOD_VERSION = "medium-2026.09.25";
const finitePositive = (x) => Number.isFinite(x) && x > 0;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

export function validateAcrImage(img) {
  if (
    !Number.isInteger(img.rows) ||
    !Number.isInteger(img.cols) ||
    img.rows < 2 ||
    img.cols < 2 ||
    img.data.length !== img.rows * img.cols
  )
    throw new Error("Matriz o longitud de PixelData inválida.");
  if (img.pixelSpacing?.length !== 2 || !img.pixelSpacing.every(finitePositive))
    throw new Error("PixelSpacing ausente o inválido.");
  if (
    img.imagePosition?.length !== 3 ||
    !img.imagePosition.every(Number.isFinite)
  )
    throw new Error("ImagePositionPatient ausente o inválido.");
  const iop = img.imageOrientation;
  if (iop?.length !== 6 || !iop.every(Number.isFinite))
    throw new Error("ImageOrientationPatient ausente o inválido.");
  const u = iop.slice(0, 3),
    v = iop.slice(3);
  if (
    Math.abs(dot(u, u) - 1) > 0.001 ||
    Math.abs(dot(v, v) - 1) > 0.001 ||
    Math.abs(dot(u, v)) > 0.001
  )
    throw new Error("Orientación DICOM no ortonormal.");
  if (!img.studyInstanceUID || !img.seriesInstanceUID || !img.sopInstanceUID)
    throw new Error("Faltan identificadores Study/Series/SOP Instance UID.");
  if (img.modality !== "MR") throw new Error("Solo se admiten imágenes MR.");
  if (!Array.from(img.data).every(Number.isFinite))
    throw new Error("La imagen contiene valores no finitos.");
}

// Reindex only (no interpolation): left/right and anterior/posterior must not
// change the position of the notch or ramp search windows in image space.
export function canonicalizeAcrImage(img) {
  const iop = img.imageOrientation,
    u = iop.slice(0, 3),
    v = iop.slice(3);
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const axis = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
  if (axis === 1) return img; // coronal localizers are not analyzed
  const targetU = axis === 2 ? [1, 0, 0] : [0, 1, 0];
  const targetV = axis === 2 ? [0, 1, 0] : [0, 0, -1];
  const a = dot(targetU, u),
    b = dot(targetU, v),
    c = dot(targetV, u),
    d = dot(targetV, v);
  if (![a, b, c, d].every((x) => Math.abs(x - Math.round(x)) < 0.001))
    throw new Error(
      "Cortes oblicuos no soportados: exporta los planos ortogonales del protocolo ACR.",
    );
  const A = Math.round(a),
    B = Math.round(b),
    C = Math.round(c),
    D = Math.round(d);
  const cols = A ? img.cols : img.rows,
    rows = C ? img.cols : img.rows;
  const x0 = A < 0 || C < 0 ? img.cols - 1 : 0,
    y0 = B < 0 || D < 0 ? img.rows - 1 : 0;
  const data = new Float32Array(rows * cols),
    paddingMask = new Uint8Array(rows * cols);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = (y0 + B * x + D * y) * img.cols + x0 + A * x + C * y;
      data[y * cols + x] = img.data[i];
      paddingMask[y * cols + x] = img.paddingMask?.[i] || 0;
    }
  return {
    ...img,
    rows,
    cols,
    data,
    paddingMask,
    pixelSpacing: [
      C ? img.pixelSpacing[1] : img.pixelSpacing[0],
      A ? img.pixelSpacing[1] : img.pixelSpacing[0],
    ],
    imagePosition: img.imagePosition.map(
      (p, i) =>
        p + x0 * img.pixelSpacing[1] * u[i] + y0 * img.pixelSpacing[0] * v[i],
    ),
    imageOrientation: [...targetU, ...targetV],
  };
}

export function validateAcrStack(images) {
  if (images.length !== 11)
    throw new Error("Se requieren once cortes axiales.");
  const ref = images[0],
    positions = new Set(),
    sops = new Set();
  for (const img of images) {
    validateAcrImage(img);
    for (const key of [
      "studyInstanceUID",
      "seriesInstanceUID",
      "frameOfReferenceUID",
      "deviceSerialNumber",
      "stationName",
      "manufacturer",
      "modelName",
    ]) {
      if ((img[key] || "") !== (ref[key] || ""))
        throw new Error(`La serie mezcla ${key}.`);
    }
    if (sops.has(img.sopInstanceUID))
      throw new Error("SOP Instance UID duplicado.");
    sops.add(img.sopInstanceUID);
    if (
      img.rows !== ref.rows ||
      img.cols !== ref.cols ||
      img.pixelSpacing.some(
        (v, i) => Math.abs(v - ref.pixelSpacing[i]) > 1e-4,
      ) ||
      img.imageOrientation.some(
        (v, i) => Math.abs(v - ref.imageOrientation[i]) > 1e-4,
      )
    )
      throw new Error("Geometría inconsistente entre cortes.");
    if (
      Math.abs(img.imageOrientation[2]) > 0.001 ||
      Math.abs(img.imageOrientation[5]) > 0.001
    )
      throw new Error("La serie no es axial ortogonal.");
    if (
      Math.abs(img.imagePosition[0] - ref.imagePosition[0]) > 0.1 ||
      Math.abs(img.imagePosition[1] - ref.imagePosition[1]) > 0.1
    )
      throw new Error("Los cortes no comparten origen en el plano.");
    const z = img.imagePosition[2];
    if ([...positions].some((p) => Math.abs(p - z) < 0.1))
      throw new Error("Posiciones de corte duplicadas.");
    positions.add(z);
    for (const key of [
      "repetitionTime",
      "echoTime",
      "sliceThickness",
      "numberOfAverages",
      "echoTrainLength",
      "flipAngle",
      "magneticFieldStrength",
    ]) {
      if (
        Number.isFinite(img[key]) !== Number.isFinite(ref[key]) ||
        (Number.isFinite(img[key]) && Math.abs(img[key] - ref[key]) > 0.01)
      )
        throw new Error(`Parámetro ${key} inconsistente entre cortes.`);
    }
  }
  const z = [...positions].sort((a, b) => a - b);
  if (z.slice(1).some((v, i) => Math.abs(v - z[i] - 10) > 0.2))
    throw new Error(
      "La separación real entre cortes debe ser 10 mm (5 mm + 5 mm de intervalo).",
    );
  return true;
}

export function validateAcrBatch(images) {
  const ref = images[0],
    sops = new Set();
  if (!ref) throw new Error("No hay imágenes.");
  for (const img of images) {
    if (sops.has(img.sopInstanceUID))
      throw new Error("Hay archivos DICOM duplicados en la selección.");
    sops.add(img.sopInstanceUID);
    for (const key of [
      "studyInstanceUID",
      "frameOfReferenceUID",
      "deviceSerialNumber",
      "stationName",
      "manufacturer",
      "modelName",
    ]) {
      if ((img[key] || "") !== (ref[key] || ""))
        throw new Error(
          `La selección mezcla ${key}. Carga un solo estudio y equipo.`,
        );
    }
  }
}

export function scoreAcrProtocol(group) {
  const deviations = [],
    unknown = [];
  const check = (v, target, tol, label) => {
    if (!finitePositive(v)) unknown.push(label);
    else if (Math.abs(v - target) > tol) deviations.push(`${label}: ${v}`);
  };
  check(group.rows, 256, 0, "filas");
  check(group.cols, 256, 0, "columnas");
  const acq = group.acquisitionMatrix?.filter((v) => v > 0) || [];
  if (acq.length !== 2) unknown.push("matriz de adquisición");
  else if (acq.some((v) => v !== 256))
    deviations.push(`matriz de adquisición: ${acq.join("×")}`);
  check(group.fovX, 250, 1, "FOV X");
  check(group.fovY, 250, 1, "FOV Y");
  check(group.sliceThickness, 5, 0.1, "espesor");
  check(group.numberOfAverages, 1, 0.01, "NEX");
  check(group.echoTrainLength, 1, 0, "ETL");
  if (!group.scanningSequence) unknown.push("secuencia");
  else if (!group.scanningSequence.split("\\").includes("SE"))
    deviations.push("no es spin echo");
  if (!finitePositive(group.tr) || !finitePositive(group.te))
    unknown.push("TR/TE");
  else if (
    !(
      (Math.abs(group.tr - 500) <= 5 && Math.abs(group.te - 20) <= 1) ||
      (Math.abs(group.tr - 2000) <= 20 && Math.abs(group.te - 80) <= 1)
    )
  )
    deviations.push("TR/TE fuera del protocolo ACR");
  if (group.stackError) deviations.push(group.stackError);
  if (!group.stackValidated) unknown.push("posiciones de corte");
  return {
    invalid: deviations.length > 0,
    penalty: deviations.length * 400 + unknown.length * 100,
    deviations: [...deviations, ...unknown.map((x) => `${x} sin verificar`)],
    unknown,
    conformant: deviations.length === 0 && unknown.length === 0,
  };
}

export function summarizeAcrResults(results) {
  let passCount = 0,
    warnCount = 0,
    failCount = 0,
    errorCount = 0,
    pendingCount = 0;
  for (const r of results) {
    if (r.section || r.complementary) continue;
    if (r.error) {
      errorCount++;
      continue;
    }
    if (r.skipped || r.pending || r.pass == null) {
      pendingCount++;
      continue;
    }
    if (r.pass) passCount++;
    else failCount++;
    if (r.warn) warnCount++;
  }
  const overallPass =
    passCount > 0 && !failCount && !errorCount && !pendingCount;
  const status = failCount
    ? "No conforme"
    : overallPass
      ? warnCount
        ? "Conforme con avisos"
        : "Conforme"
      : "No evaluable / incompleto";
  return {
    passCount,
    warnCount,
    failCount,
    errorCount,
    pendingCount,
    overallPass,
    status,
  };
}

export function thicknessVerdict(value) {
  if (!Number.isFinite(value)) return { pass: null, pending: true };
  const delta = Math.abs(value - 5);
  return {
    pass: delta <= 1 + 1e-9,
    warn: delta > 0.7 + 1e-9 && delta <= 1 + 1e-9,
  };
}
export function positionVerdict(diff, slice11 = false) {
  if (!Number.isFinite(diff)) return { pass: null, pending: true };
  const a = Math.abs(diff);
  return {
    pass: a <= 7 + 1e-9,
    warn: a <= 7 + 1e-9 && (a > 5 || (slice11 && a > 4)),
  };
}

export function visualAcrResults(review = {}, field = 1.5, series = "T1") {
  const number = (v) => (v !== "" && v != null ? Number(v) : NaN);
  const h = number(review.resolutionH),
    v = number(review.resolutionV);
  const counts = Array.from({ length: 4 }, (_, i) =>
    number(review[`lcd${i + 8}`]),
  );
  const lcdKnown = counts.every(
    (x) => Number.isInteger(x) && x >= 0 && x <= 10,
  );
  const total = counts.reduce((a, b) => a + b, 0),
    limit = field < 1.5 ? 7 : field < 3 ? (series === "T1" ? 30 : 25) : 37;
  return [
    {
      name: "Resolución espacial — lectura visual",
      exportKey: "resolution_visual",
      pass:
        review.resolutionH === "unresolved" ||
        review.resolutionV === "unresolved"
          ? false
          : Number.isFinite(h) && Number.isFinite(v)
            ? h <= 1 && v <= 1
            : null,
      exportData: { horizontalMm: h, verticalMm: v },
      metrics: {
        Horizontal:
          review.resolutionH === "unresolved"
            ? "No resuelve 1,1 mm"
            : Number.isFinite(h)
              ? `${h} mm`
              : "Pendiente",
        Vertical:
          review.resolutionV === "unresolved"
            ? "No resuelve 1,1 mm"
            : Number.isFinite(v)
              ? `${v} mm`
              : "Pendiente",
      },
    },
    {
      name: "Bajo contraste — cortes 8 a 11",
      exportKey: "lcd_visual",
      pass: lcdKnown ? total >= limit : null,
      exportData: { counts, total: lcdKnown ? total : null, limit },
      metrics: {
        Radios: lcdKnown ? `${counts.join(" + ")} = ${total}` : "Pendiente",
        Límite: `≥ ${limit}`,
      },
    },
    {
      name: "Artefactos — revisión visual",
      exportKey: "artifacts_visual",
      pass:
        review.artifacts === "pass"
          ? true
          : review.artifacts === "fail"
            ? false
            : null,
    },
    {
      name: "Comprobación de cortes, ROIs y medidas",
      exportKey: "measurement_review",
      pass:
        review.measurements === "pass"
          ? true
          : review.measurements === "fail"
            ? false
            : null,
      message:
        "Comprobar numeración CHIN→HEAD, muesca, bordes y perfiles; contrastar las medidas automáticas con la imagen.",
    },
  ];
}
