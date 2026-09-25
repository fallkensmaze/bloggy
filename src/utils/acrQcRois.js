// Physical ROIs; signal values never determine which internal defects are kept.
export function diskOffsets(radiusMm, spacing) {
  const [sy, sx] = spacing,
    out = [];
  for (let y = -Math.ceil(radiusMm / sy); y <= Math.ceil(radiusMm / sy); y++)
    for (let x = -Math.ceil(radiusMm / sx); x <= Math.ceil(radiusMm / sx); x++)
      if ((x * sx) ** 2 + (y * sy) ** 2 <= radiusMm ** 2) out.push([x, y]);
  return out;
}

export function centralAcrRoi(img, geom) {
  const [sy, sx] = img.pixelSpacing,
    R = Math.sqrt(16000 / Math.PI),
    indices = [];
  if (
    geom.cx * sx < R ||
    (img.cols - 1 - geom.cx) * sx < R ||
    geom.cy * sy < R ||
    (img.rows - 1 - geom.cy) * sy < R
  )
    throw new Error("La ROI de 160 cm² no cabe en el campo de imagen.");
  let sum = 0;
  for (let y = 0; y < img.rows; y++)
    for (let x = 0; x < img.cols; x++) {
      if (((x - geom.cx) * sx) ** 2 + ((y - geom.cy) * sy) ** 2 > R * R)
        continue;
      const i = y * img.cols + x;
      if (!Number.isFinite(img.data[i]) || img.paddingMask?.[i])
        throw new Error(
          "La ROI grande contiene datos ausentes o padding DICOM.",
        );
      sum += img.data[i];
      indices.push(i);
    }
  const mean = sum / indices.length;
  if (!(mean > 0)) throw new Error("No hay señal positiva en la ROI grande.");
  return {
    radiusMm: R,
    mean,
    indices,
    areaCm2: (indices.length * sx * sy) / 100,
  };
}

export function measureAcrPiu(img, geom, notchMask = null) {
  const large = centralAcrRoi(img, geom),
    [sy, sx] = img.pixelSpacing,
    r = Math.sqrt(100 / Math.PI);
  const offsets = diskOffsets(r, img.pixelSpacing),
    allowed = (large.radiusMm - r) ** 2;
  let min = Infinity,
    max = -Infinity,
    minLoc = null,
    maxLoc = null;
  for (let y = 0; y < img.rows; y++)
    for (let x = 0; x < img.cols; x++) {
      if (((x - geom.cx) * sx) ** 2 + ((y - geom.cy) * sy) ** 2 > allowed)
        continue;
      let sum = 0,
        valid = true;
      for (const [dx, dy] of offsets) {
        const i = (y + dy) * img.cols + x + dx;
        if (notchMask?.[i]) {
          valid = false;
          break;
        }
        sum += img.data[i];
      }
      if (!valid) continue;
      const m = sum / offsets.length;
      if (m < min) {
        min = m;
        minLoc = [x, y];
      }
      if (m > max) {
        max = m;
        maxLoc = [x, y];
      }
    }
  if (!minLoc || !maxLoc || min < 0 || !(max + min > 0))
    throw new Error("No se pueden obtener ROIs de uniformidad válidas.");
  const excluded = large.indices.reduce(
    (n, i) => n + (notchMask?.[i] ? 1 : 0),
    0,
  );
  return {
    ...large,
    piu: 100 * (1 - (max - min) / (max + min)),
    min,
    max,
    minLoc,
    maxLoc,
    smallRadiusMm: r,
    smallAreaCm2: (offsets.length * sx * sy) / 100,
    excluded,
  };
}

// Proposed notch only: exterior-connected background in the anterior midline.
// Interior holes and lateral/peripheral low signal are never excluded. The
// 20 mm half-width / anterior 40 mm guard is a tool heuristic, not an ACR limit;
// users must review this overlay before the assessment can be complete.
export function proposedNotchMask(img, geom, filledPhantomMask) {
  const out = new Uint8Array(img.rows * img.cols),
    [sy, sx] = img.pixelSpacing;
  for (let y = 0; y < img.rows; y++)
    for (let x = 0; x < img.cols; x++) {
      const dx = (x - geom.cx) * sx,
        dy = (y - geom.cy) * sy;
      if (
        Math.abs(dx) <= 20 &&
        dy <= -40 &&
        !filledPhantomMask[y * img.cols + x]
      )
        out[y * img.cols + x] = 1;
    }
  return out;
}

// Exact rectangle/pixel area weights avoid a biased area after rounding or
// changing aspect ratio to fit an off-centre phantom.
export function meanPhysicalRect(img, r) {
  let sum = 0,
    weight = 0;
  if (r.x < 0 || r.y < 0 || r.x + r.w > img.cols || r.y + r.h > img.rows)
    throw new Error("ROI de fondo fuera de la imagen.");
  for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++)
    for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
      const w =
        Math.max(0, Math.min(x + 1, r.x + r.w) - Math.max(x, r.x)) *
        Math.max(0, Math.min(y + 1, r.y + r.h) - Math.max(y, r.y));
      if (!w) continue;
      const i = y * img.cols + x;
      if (img.paddingMask?.[i] || !Number.isFinite(img.data[i]))
        throw new Error("ROI de fondo sobre padding o datos ausentes.");
      sum += w * img.data[i];
      weight += w;
    }
  if (!weight) throw new Error("ROI de fondo vacía.");
  return {
    mean: sum / weight,
    areaCm2: (weight * img.pixelSpacing[0] * img.pixelSpacing[1]) / 100,
  };
}

export function measureAcrGhosting(img, geom) {
  const large = centralAcrRoi(img, geom),
    [sy, sx] = img.pixelSpacing,
    marginMm = 3;
  const W = img.cols * sx,
    H = img.rows * sy;
  const L = geom.xMin * sx,
    R = (geom.xMax + 1) * sx,
    T = geom.yMin * sy,
    B = (geom.yMax + 1) * sy;
  const rectangle = (horizontal, start, end, center, span) => {
    const avail = end - start - 2 * marginMm;
    if (avail <= 0)
      throw new Error("No hay espacio para las ROIs de ghosting.");
    const short = Math.min(Math.sqrt(1000 / 4), avail),
      long = 1000 / short;
    if (long > span - 2 * marginMm)
      throw new Error("No cabe una ROI de fondo de 10 cm².");
    const along = Math.max(
      marginMm,
      Math.min(center - long / 2, span - marginMm - long),
    );
    const across = (start + end - short) / 2;
    return horizontal
      ? { x: along / sx, y: across / sy, w: long / sx, h: short / sy }
      : { x: across / sx, y: along / sy, w: short / sx, h: long / sy };
  };
  const rois = {
    top: rectangle(true, 0, T, geom.cx * sx, W),
    bottom: rectangle(true, B, H, geom.cx * sx, W),
    left: rectangle(false, 0, L, geom.cy * sy, H),
    right: rectangle(false, R, W, geom.cy * sy, H),
  };
  const measurements = Object.fromEntries(
    Object.entries(rois).map(([k, r]) => [k, meanPhysicalRect(img, r)]),
  );
  const m = measurements;
  const psg =
    100 *
    Math.abs(
      (m.top.mean + m.bottom.mean - m.left.mean - m.right.mean) /
        (2 * large.mean),
    );
  return { large, rois, measurements, psg };
}
