import dicomParser from 'dicom-parser';

function setCopyExcelEnabled(enabled) {
  const btn = document.getElementById('copy-excel-btn');
  if (btn) btn.disabled = !enabled;
}

function setPdfEnabled(enabled) {
  const btn = document.getElementById('save-pdf-btn');
  if (btn) btn.disabled = !enabled;
}

function formatExcelDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';

  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatExcelNumber(value, decimals = 4) {
  if (!Number.isFinite(value)) return '';

  const rounded = Math.abs(value - Math.round(value)) < 1e-9
    ? String(Math.round(value))
    : value.toFixed(decimals).replace(/0+$/g, '').replace(/\.$/, '');

  return rounded.replace('.', ',');
}

function formatExcelCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatExcelNumber(value);
  if (typeof value === 'boolean') return value ? '1' : '0';

  return String(value)
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function extractFirstNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const match = String(value)
    .replace(/\u2212/g, '-')
    .match(/-?\d+(?:[.,]\d+)?/);

  if (!match) return null;

  const num = parseFloat(match[0].replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function resultNameMatches(result, parts) {
  const haystack = slugifyExportPart(result && result.name ? result.name : '');
  return parts.every((part) => haystack.includes(slugifyExportPart(part)));
}

function findSeriesResult(results, { exportKeys = [], namePartSets = [] } = {}) {
  for (const key of exportKeys) {
    const hit = results.find((res) => res.exportKey === key);
    if (hit) return hit;
  }

  for (const parts of namePartSets) {
    const hit = results.find((res) => resultNameMatches(res, parts));
    if (hit) return hit;
  }

  return null;
}

function getMetricRawValue(result, partSets) {
  if (!result || !result.metrics) return null;

  for (const parts of partSets) {
    const hit = Object.entries(result.metrics).find(([key]) => resultNameMatches({ name: key }, parts));
    if (hit) return hit[1];
  }

  return null;
}

function getMetricNumber(result, partSets) {
  const raw = getMetricRawValue(result, partSets);
  return extractFirstNumber(raw);
}

function getSeriesBucketsForExport(results, analysis) {
  const buckets = [];
  let current = null;

  for (const item of results) {
    if (item.section) {
      const label = String(item.title || '').split(' ')[0] || `serie_${buckets.length + 1}`;
      const group = label === 'T1'
        ? analysis.t1
        : label === 'T2'
          ? analysis.t2
          : null;

      current = {
        label,
        title: item.title || label,
        group,
        results: []
      };
      buckets.push(current);
      continue;
    }

    if (current) current.results.push(item);
  }

  return buckets;
}

function summarizeResultStates(results) {
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  let errorCount = 0;

  for (const res of results) {
    if (res.skipped) continue;

    if (res.error) {
      errorCount++;
      continue;
    }

    if (res.pass) passCount++;
    else failCount++;

    if (res.warn) warnCount++;
  }

  return {
    passCount,
    warnCount,
    failCount,
    errorCount,
    overallPass: failCount === 0 && errorCount === 0
  };
}

function buildExcelExportRows() {
  if (!state.results || !state.results.length) return [];

  const buckets = getSeriesBucketsForExport(state.results, state.analysis || {});
  if (!buckets.length) return [];

  const timestamp = formatExcelDateTime(state.lastRunAt || new Date());
  const fieldStrength = Number.isFinite(state.lastFieldStrength)
    ? state.lastFieldStrength
    : parseFloat(document.getElementById('field-strength').value);

  const allResults = buckets.flatMap((bucket) => bucket.results);
  const sagittal = findSeriesResult(allResults, {
    exportKeys: ['geometry_sagittal'],
    namePartSets: [['sagital'], ['geometry', 'sagittal']]
  });

  const header = [
    'fecha_hora',
    'campo_t',
    'serie',
    'serie_num',
    'descripcion',
    'series_uid',
    'acq_num',
    'tr_ms',
    'te_ms',
    'echo_num',
    'sag_long_mm',
    'sag_error_mm',
    'geom_s1_maxerr_mm',
    'geom_s5_maxerr_mm',
    'espesor_mm',
    'pos_s1_mm',
    'pos_s11_mm',
    'piu_pct',
    'ghosting_pct',
    'ellipse_major_mm',
    'ellipse_minor_mm',
    'ellipse_diff_mm',
    'pellet_maxerr_mm',
    'pellet_rms_mm',
    'pellet_detectados',
    'tests_pass',
    'tests_warn',
    'tests_fail',
    'tests_error',
    'pass_global'
  ];

  const rows = [header];

  for (const bucket of buckets) {
    const group = bucket.group || {};
    const tests = bucket.results;
    const summary = summarizeResultStates(tests);

    const geom1 = findSeriesResult(tests, {
      exportKeys: ['geometry_axial_slice_1'],
      namePartSets: [['geometr', 'axial', 'slice', '1']]
    });
    const geom5 = findSeriesResult(tests, {
      exportKeys: ['geometry_axial_slice_5'],
      namePartSets: [['geometr', 'axial', 'slice', '5']]
    });
    const thickness = findSeriesResult(tests, {
      exportKeys: ['slice_thickness_slice_1'],
      namePartSets: [['espesor']]
    });
    const pos1 = findSeriesResult(tests, {
      exportKeys: ['slice_position_slice_1'],
      namePartSets: [['posici', 'slice', '1']]
    });
    const pos11 = findSeriesResult(tests, {
      exportKeys: ['slice_position_slice_11'],
      namePartSets: [['posici', 'slice', '11']]
    });
    const piu = findSeriesResult(tests, {
      exportKeys: ['piu_slice_7'],
      namePartSets: [['piu'], ['uniformidad']]
    });
    const ghosting = findSeriesResult(tests, {
      exportKeys: ['ghosting_slice_7'],
      namePartSets: [['ghosting'], ['psg']]
    });
    const ellipse = findSeriesResult(tests, {
      namePartSets: [['elipt'], ['borde', 'slice', '5']]
    });
    const pellet = findSeriesResult(tests, {
      namePartSets: [['perdigones'], ['distorsi', 'matriz']]
    });

    rows.push([
      timestamp,
      fieldStrength,
      bucket.label,
      group.seriesNumber || '',
      group.seriesDescription || '',
      group.seriesInstanceUID || '',
      group.acquisitionNumber || '',
      Number.isFinite(group.tr) ? group.tr : '',
      Number.isFinite(group.te) ? group.te : '',
      Number.isFinite(group.echoNumber) ? group.echoNumber : '',
      sagittal && sagittal.exportData ? sagittal.exportData.lengthMm : getMetricNumber(sagittal, [['longitud']]),
      sagittal && sagittal.exportData ? sagittal.exportData.errorMm : getMetricNumber(sagittal, [['error']]),
      geom1 && geom1.exportData ? geom1.exportData.maxErrorMm : getMetricNumber(geom1, [['max']]),
      geom5 && geom5.exportData ? geom5.exportData.maxErrorMm : getMetricNumber(geom5, [['max']]),
      thickness && thickness.exportData ? thickness.exportData.sliceThicknessMm : getMetricNumber(thickness, [['espesor', 'medido']]),
      pos1 && pos1.exportData ? pos1.exportData.diffMm : getMetricNumber(pos1, [['diferencia']]),
      pos11 && pos11.exportData ? pos11.exportData.diffMm : getMetricNumber(pos11, [['diferencia']]),
      piu && piu.exportData ? piu.exportData.piuPct : getMetricNumber(piu, [['piu']]),
      ghosting && ghosting.exportData ? ghosting.exportData.psgPct : getMetricNumber(ghosting, [['psg']]),
      getMetricNumber(ellipse, [['eje', 'mayor']]),
      getMetricNumber(ellipse, [['eje', 'menor']]),
      getMetricNumber(ellipse, [['mayor', 'menor']]),
      pellet && pellet.exportData ? pellet.exportData.maxErrMm : getMetricNumber(pellet, [['error']]),
      pellet && pellet.exportData ? pellet.exportData.rmsErrMm : getMetricNumber(pellet, [['rms']]),
      pellet && pellet.exportData ? pellet.exportData.detectedCount : getMetricNumber(pellet, [['detectados']]),
      summary.passCount,
      summary.warnCount,
      summary.failCount,
      summary.errorCount,
      summary.overallPass ? 1 : 0
    ]);
  }

  return rows;
}

function buildExcelExportText() {
  const rows = buildExcelExportRows();
  if (!rows.length) return '';
  return rows.map((row) => row.map(formatExcelCell).join('\t')).join('\r\n');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (e) {
      // Fallback below for file:// contexts or restricted clipboard APIs.
    }
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.left = '-1000px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);

  const copied = document.execCommand('copy');
  document.body.removeChild(ta);

  if (!copied) {
    throw new Error('No se pudo copiar al portapapeles.');
  }
}

async function copyResultsForExcel() {
  const text = buildExcelExportText();
  if (!text) {
    log('âœ– No hay resultados disponibles para copiar a Excel.');
    return;
  }

  try {
    await copyTextToClipboard(text);
    const rowCount = Math.max(0, text.split(/\r?\n/).length - 1);
    log(`âœ” Copiado para Excel (${rowCount} fila(s) de datos + cabecera).`);
  } catch (e) {
    log(`âœ– Error al copiar para Excel: ${e.message}`);
  }
}

function buildPdfFileName(date = state.lastRunAt || new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'acr-qc-resultados';

  const pad = (n) => String(n).padStart(2, '0');
  return `acr-qc-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function updatePrintMeta() {
  const meta = document.getElementById('print-meta');
  if (!meta) return;

  const analysis = state.analysis || {};
  const runAt = formatExcelDateTime(state.lastRunAt || new Date());
  const fieldStrength = Number.isFinite(state.lastFieldStrength)
    ? `${formatExcelCell(state.lastFieldStrength)} T`
    : '';
  const lines = [
    `<strong>Fecha del informe:</strong> ${runAt || '-'}`,
    `<strong>Campo magnético:</strong> ${fieldStrength || '-'}`,
    `<strong>Serie T1:</strong> ${analysis.t1 ? describeAxialGroup(analysis.t1) : '-'}`,
    `<strong>Serie T2:</strong> ${analysis.t2 ? describeAxialGroup(analysis.t2) : '-'}`,
    `<strong>Localizador sagital:</strong> ${analysis.sagittal ? 'sí' : 'no'}`
  ];

  meta.innerHTML = lines.join('<br>');
}

function saveResultsAsPdf() {
  if (!state.results || !state.results.some((item) => !item.section)) {
    log('No hay resultados disponibles para guardar en PDF.');
    return;
  }

  updatePrintMeta();

  const previousTitle = document.title;
  const pdfTitle = buildPdfFileName();
  let restored = false;

  const restoreTitle = () => {
    if (restored) return;
    restored = true;
    document.title = previousTitle;
  };

  document.title = pdfTitle;
  window.addEventListener('afterprint', restoreTitle, { once: true });
  setTimeout(restoreTitle, 2000);

  log('Abriendo el diálogo de impresión para guardar el informe en PDF...');
  window.print();
}

/* =========================================================================
   ACR MRI QC — Maniquí Medium
   Análisis automático según ACR Large/Medium Phantom Test Guidance (10/2022)
   ========================================================================= */
// Estado global
const state = {
  images: [],          // Imágenes DICOM cargadas (parseadas)
  axial: [],           // Axiales ordenadas
  sagittal: null,      // Localizador sagital (opcional)
  results: [],
  lastRunAt: null,
  lastFieldStrength: null,
  analysis: {
    sagittal: null,
    t1: null,
    t2: null,
    axialGroups: []
  }
};

const log = (msg) => {
  const el = document.getElementById('log');
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
  console.log(msg);
};

/* =========================================================================
   1. CARGA DE DICOM
   ========================================================================= */

async function loadDicomFile(file) {
  const buffer = await file.arrayBuffer();
  const byteArray = new Uint8Array(buffer);
  let dataSet;
  try {
    dataSet = dicomParser.parseDicom(byteArray);
  } catch (e) {
    throw new Error(`No se ha podido parsear ${file.name}: ${e.message}`);
  }
  return parseDataSet(dataSet, file.name);
}

function parseDataSet(dataSet, filename) {
  const rows = dataSet.uint16('x00280010');
  const cols = dataSet.uint16('x00280011');
  const bitsAllocated = dataSet.uint16('x00280100') || 16;
  const pixelRepresentation = dataSet.uint16('x00280103') || 0;

  const pixelSpacingStr = dataSet.string('x00280030');
  const pixelSpacing = pixelSpacingStr
    ? pixelSpacingStr.split('\\').map(parseFloat)
    : [1, 1];

  const ippStr = dataSet.string('x00200032');
  const imagePosition = ippStr
    ? ippStr.split('\\').map(parseFloat)
    : [0, 0, 0];

  const iopStr = dataSet.string('x00200037');
  const imageOrientation = iopStr
    ? iopStr.split('\\').map(parseFloat)
    : [1, 0, 0, 0, 1, 0];

  const sliceThickness = parseFloat(dataSet.string('x00180050') || '0');
  const sliceLocation = parseFloat(dataSet.string('x00201041') || '0');
  const instanceNumber = parseInt(dataSet.string('x00200013') || '0', 10);

  const repetitionTime = parseFloat(dataSet.string('x00180080') || '0');
  const echoTime = parseFloat(dataSet.string('x00180081') || '0');
  const echoNumber = parseInt(dataSet.string('x00180086') || '0', 10) || 0;

  // Parámetros de adquisición usados para puntuar la conformidad con el protocolo ACR
  const acquisitionMatrix = [0, 1, 2, 3].map(i => dataSet.uint16('x00181310', i) || 0);
  const echoTrainLength = parseInt(dataSet.string('x00180091') || '0', 10) || 0;
  const numberOfAverages = parseFloat(dataSet.string('x00180083') || '0');
  const flipAngle = parseFloat(dataSet.string('x00181314') || '0');
  const reconstructionDiameter = parseFloat(dataSet.string('x00181100') || '0');
  const spacingBetweenSlices = parseFloat(dataSet.string('x00180088') || '0');
  const scanOptions = dataSet.string('x00180022') || '';

  const rescaleSlope = parseFloat(dataSet.string('x00281053') || '1');
  const rescaleIntercept = parseFloat(dataSet.string('x00281052') || '0');

  const seriesDescription = dataSet.string('x0008103e') || '';
  const seriesNumber = dataSet.string('x00200011') || '';
  const seriesInstanceUID = dataSet.string('x0020000e') || '';
  const acquisitionNumber = dataSet.string('x00200012') || '';
  const imageType = dataSet.string('x00080008') || '';

  const pixelDataElement = dataSet.elements.x7fe00010;
  if (!pixelDataElement) {
    throw new Error(`${filename}: no se ha encontrado PixelData`);
  }

  let raw;
  if (bitsAllocated === 16) {
    if (pixelRepresentation === 1) {
      raw = new Int16Array(
        dataSet.byteArray.buffer,
        dataSet.byteArray.byteOffset + pixelDataElement.dataOffset,
        pixelDataElement.length / 2
      );
    } else {
      raw = new Uint16Array(
        dataSet.byteArray.buffer,
        dataSet.byteArray.byteOffset + pixelDataElement.dataOffset,
        pixelDataElement.length / 2
      );
    }
  } else {
    raw = new Uint8Array(
      dataSet.byteArray.buffer,
      dataSet.byteArray.byteOffset + pixelDataElement.dataOffset,
      pixelDataElement.length
    );
  }

  const data = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    data[i] = raw[i] * rescaleSlope + rescaleIntercept;
  }

  return {
    filename,
    rows,
    cols,
    pixelSpacing,
    imagePosition,
    imageOrientation,
    sliceThickness,
    sliceLocation,
    instanceNumber,
    repetitionTime,
    echoTime,
    echoNumber,
    acquisitionMatrix,
    echoTrainLength,
    numberOfAverages,
    flipAngle,
    reconstructionDiameter,
    spacingBetweenSlices,
    scanOptions,
    seriesDescription,
    seriesNumber,
    seriesInstanceUID,
    acquisitionNumber,
    imageType,
    data
  };
}

/* =========================================================================
   2. CLASIFICACIÓN E IDENTIFICACIÓN DE CORTES
   ========================================================================= */
function getImagePlane(img) {
  const iop = img.imageOrientation;
  const rowVec = [iop[0], iop[1], iop[2]];
  const colVec = [iop[3], iop[4], iop[5]];
  const normal = [
    rowVec[1] * colVec[2] - rowVec[2] * colVec[1],
    rowVec[2] * colVec[0] - rowVec[0] * colVec[2],
    rowVec[0] * colVec[1] - rowVec[1] * colVec[0]
  ];
  const absN = normal.map(Math.abs);
  const maxIdx = absN.indexOf(Math.max(...absN));

  if (maxIdx === 2) return 'axial';
  if (maxIdx === 0) return 'sagittal';
  return 'other';
}

function sortAndOrientAxialStack(axial, label = '') {
  const out = [...axial].sort((a, b) => a.imagePosition[2] - b.imagePosition[2]);

  if (out.length >= 2) {
    const stdFirst = centralStdDev(out[0]);
    const stdLast = centralStdDev(out[out.length - 1]);
    if (stdFirst < stdLast) {
      out.reverse();
      log(`  → ${label || 'stack axial'} invertido (CHIN estaba al final): primera slice ahora es slice 1`);
    }
  }

  return out;
}

function formatTagValue(v) {
  if (!Number.isFinite(v) || v <= 0) return '?';
  return Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(1);
}

function slugifyExportPart(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function enrichResultForSeries(result, seriesLabel, group) {
  if (!result || result.section) return result;

  return {
    ...result,
    seriesLabel,
    seriesNumber: group && group.seriesNumber ? group.seriesNumber : '',
    seriesDescription: group && group.seriesDescription ? group.seriesDescription : '',
    seriesInstanceUID: group && group.seriesInstanceUID ? group.seriesInstanceUID : '',
    acquisitionNumber: group && group.acquisitionNumber ? group.acquisitionNumber : '',
    repetitionTime: group && Number.isFinite(group.tr) ? group.tr : 0,
    echoTime: group && Number.isFinite(group.te) ? group.te : 0,
    echoNumber: group && Number.isFinite(group.echoNumber) ? group.echoNumber : 0
  };
}

function pushSeriesResult(results, seriesLabel, group, result) {
  results.push(enrichResultForSeries(result, seriesLabel, group));
}

function buildAxialGroupKey(img) {
  const uid = img.seriesInstanceUID || '';
  const te = Number.isFinite(img.echoTime) ? img.echoTime.toFixed(3) : '0.000';
  const echo = img.echoNumber || 0;

  if (uid) return `${uid}|TE=${te}|EN=${echo}`;

  return [
    img.seriesNumber || '',
    img.seriesDescription || '',
    formatTagValue(img.repetitionTime),
    formatTagValue(img.echoTime),
    echo
  ].join('|');
}

/* Secuencia estándar del ACR Large/Medium Phantom Test Guidance:
   SE, FOV 25 cm, matriz 256×256, corte 5 mm, gap 5 mm (separación 10 mm),
   1 NEX, 11 cortes. Se usa para distinguir las series ACR de las clínicas,
   que muy a menudo llevan "T1"/"T2" en la descripción mientras que las ACR
   se llaman simplemente "Spin Echo". */
const ACR_SPEC = {
  matrix: 256,
  fovMm: 250,
  sliceThicknessMm: 5,
  sliceSpacingMm: 10,
  averages: 1,
  flipAngleDeg: 90,
  echoTrainLength: 1
};

/* Penalización por desviarse del protocolo ACR, en las mismas unidades que la
   distancia de TR/TE (ms). Devuelve también las desviaciones para poder
   explicarlas en el log y en el selector. */
function scoreAcrConformance(group) {
  const deviations = [];
  let penalty = 0;

  const add = (points, text) => {
    penalty += points;
    deviations.push(text);
  };

  const matrix = Math.max(group.rows || 0, group.cols || 0);
  if (matrix && matrix !== ACR_SPEC.matrix) {
    add(400, `matriz ${group.rows}×${group.cols}`);
  }

  if (group.echoTrainLength > ACR_SPEC.echoTrainLength) {
    add(400, `ETL ${group.echoTrainLength} (no es SE simple)`);
  }

  if (group.numberOfAverages > 0 && Math.abs(group.numberOfAverages - ACR_SPEC.averages) > 0.01) {
    add(200, `NEX ${formatTagValue(group.numberOfAverages)}`);
  }

  if (group.reconstructionDiameter > 0 && Math.abs(group.reconstructionDiameter - ACR_SPEC.fovMm) > 5) {
    add(150, `FOV ${formatTagValue(group.reconstructionDiameter)} mm`);
  }

  if (group.sliceThickness > 0 && Math.abs(group.sliceThickness - ACR_SPEC.sliceThicknessMm) > 0.2) {
    add(150, `espesor ${formatTagValue(group.sliceThickness)} mm`);
  }

  if (group.spacingBetweenSlices > 0 && Math.abs(group.spacingBetweenSlices - ACR_SPEC.sliceSpacingMm) > 0.5) {
    add(100, `separación ${formatTagValue(group.spacingBetweenSlices)} mm`);
  }

  if (group.flipAngle > 0 && Math.abs(group.flipAngle - ACR_SPEC.flipAngleDeg) > 1) {
    add(100, `flip ${formatTagValue(group.flipAngle)}°`);
  }

  return { penalty, deviations, conformant: penalty === 0 };
}

function hasUniformityFilter(group) {
  return /FILTERED/i.test(group.scanOptions || '');
}

function describeAxialGroup(group) {
  if (!group) return 'serie desconocida';

  const parts = [
    `serie ${group.seriesNumber || '?'}`,
    `TR=${formatTagValue(group.tr)}`,
    `TE=${formatTagValue(group.te)}`
  ];

  if (group.echoNumber) parts.push(`echo=${group.echoNumber}`);
  if (group.rows && group.cols) parts.push(`${group.rows}×${group.cols}`);
  if (group.seriesDescription) parts.push(group.seriesDescription);
  if (hasUniformityFilter(group)) parts.push('filtro unif.');

  const { conformant, deviations } = scoreAcrConformance(group);
  parts.push(conformant ? 'conforme ACR' : `NO ACR: ${deviations.join(', ')}`);

  return parts.join(' | ');
}

/* La descripción de la serie solo se usa como desempate menor: nunca debe poder
   imponerse sobre el TR/TE real ni sobre la conformidad geométrica con el ACR. */
function scoreDescriptionHint(group, wanted, opposite) {
  const desc = (group.seriesDescription || '').toLowerCase();
  let score = 0;

  if (desc.includes(wanted)) score -= 10;
  if (desc.includes(opposite)) score += 200;

  return score;
}

function scoreAxialGroupAsT1(group) {
  const tr = Number.isFinite(group.tr) && group.tr > 0 ? group.tr : 5000;
  const te = Number.isFinite(group.te) && group.te > 0 ? group.te : 5000;

  let score = Math.abs(tr - 500) + 4 * Math.abs(te - 20);

  score += scoreAcrConformance(group).penalty;
  score += scoreDescriptionHint(group, 't1', 't2');
  if (tr >= 1200) score += 5000;

  return score;
}

function scoreAxialGroupAsT2(group) {
  const tr = Number.isFinite(group.tr) && group.tr > 0 ? group.tr : 5000;
  const te = Number.isFinite(group.te) && group.te > 0 ? group.te : 5000;

  let score = Math.abs(tr - 2000) + 6 * Math.abs(te - 80);

  score += scoreAcrConformance(group).penalty;
  score += scoreDescriptionHint(group, 't2', 't1');
  if (te > 0 && te < 40) score += 1500;
  if (tr > 0 && tr < 1200) score += 5000;

  return score;
}

function detectAnalysisSeries(classified) {
  const validAxialGroups = classified.axialGroups.filter(g => g.count === 11);

  const t1Candidates = validAxialGroups
    .filter(g => scoreAxialGroupAsT1(g) < 5000)
    .sort((a, b) => scoreAxialGroupAsT1(a) - scoreAxialGroupAsT1(b));

  const t2Candidates = validAxialGroups
    .filter(g => scoreAxialGroupAsT2(g) < 5000)
    .sort((a, b) => scoreAxialGroupAsT2(a) - scoreAxialGroupAsT2(b));

  const t1 = t1Candidates.length ? t1Candidates[0] : null;

  let t2Pool = t2Candidates.filter(g => !t1 || g.key !== t1.key);
  if (!t2Pool.length && !t1) t2Pool = t2Candidates;
  const t2 = t2Pool.length ? t2Pool[0] : null;

  return {
    sagittal: classified.sagittal || null,
    axialGroups: classified.axialGroups,
    candidates: { t1: t1Candidates, t2: t2Candidates },
    t1,
    t2
  };
}

/* El localizador 3-plano trae varios cortes sagitales (p. ej. x = +45 … −45 mm).
   La prueba de geometría sagital del ACR se mide sobre el corte central, así que
   se elige el más próximo al isocentro en lugar del primero de la lista, que
   dependía del orden en que se soltaban los ficheros. */
function pickCentralSagittal(sagittal) {
  if (!sagittal.length) return null;

  return sagittal.reduce((best, img) =>
    Math.abs(img.imagePosition[0]) < Math.abs(best.imagePosition[0]) ? img : best
  );
}

function classifyImages(images) {
  const axial = [];
  const sagittal = [];
  const other = [];

  for (const img of images) {
    const plane = getImagePlane(img);
    if (plane === 'axial') axial.push(img);
    else if (plane === 'sagittal') sagittal.push(img);
    else other.push(img);
  }

  const grouped = new Map();

  for (const img of axial) {
    const key = buildAxialGroupKey(img);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(img);
  }

  const axialGroups = Array.from(grouped.entries()).map(([key, imgs], idx) => {
    const ordered = sortAndOrientAxialStack(imgs, `grupo axial ${idx + 1}`);
    const ref = ordered[0] || {};

    return {
      key,
      axial: ordered,
      count: ordered.length,
      tr: ref.repetitionTime || 0,
      te: ref.echoTime || 0,
      echoNumber: ref.echoNumber || 0,
      rows: ref.rows || 0,
      cols: ref.cols || 0,
      echoTrainLength: ref.echoTrainLength || 0,
      numberOfAverages: ref.numberOfAverages || 0,
      flipAngle: ref.flipAngle || 0,
      reconstructionDiameter: ref.reconstructionDiameter || 0,
      sliceThickness: ref.sliceThickness || 0,
      spacingBetweenSlices: ref.spacingBetweenSlices || 0,
      scanOptions: ref.scanOptions || '',
      seriesDescription: ref.seriesDescription || '',
      seriesNumber: ref.seriesNumber || '',
      seriesInstanceUID: ref.seriesInstanceUID || '',
      acquisitionNumber: ref.acquisitionNumber || ''
    };
  });

  axialGroups.sort((a, b) => {
    if (a.tr !== b.tr) return a.tr - b.tr;
    if (a.te !== b.te) return a.te - b.te;
    return (a.seriesNumber || '').localeCompare(b.seriesNumber || '');
  });

  return {
    axial: [...axial].sort((a, b) => a.imagePosition[2] - b.imagePosition[2]),
    sagittal: pickCentralSagittal(sagittal),
    sagittalCount: sagittal.length,
    other,
    axialGroups
  };
}


function centralStdDev(img) {
  const cx = img.cols / 2;
  const cy = img.rows / 2;
  const r = Math.min(img.rows, img.cols) * 0.3;
  const r2 = r * r;
  let sum = 0;
  let count = 0;

  for (let y = 0; y < img.rows; y++) {
    for (let x = 0; x < img.cols; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        sum += img.data[y * img.cols + x];
        count++;
      }
    }
  }

  const mean = sum / count;
  let varSum = 0;

  for (let y = 0; y < img.rows; y++) {
    for (let x = 0; x < img.cols; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const d = img.data[y * img.cols + x] - mean;
        varSum += d * d;
      }
    }
  }

  return Math.sqrt(varSum / count);
}

/* =========================================================================
   3. DETECCIÓN DEL MANIQUÍ
   ========================================================================= */

function otsuThreshold(data) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }

  const numBins = 256;
  const binWidth = (max - min) / numBins;
  if (binWidth === 0) return min;

  const hist = new Float64Array(numBins);
  for (let i = 0; i < data.length; i++) {
    let bin = Math.floor((data[i] - min) / binWidth);
    if (bin >= numBins) bin = numBins - 1;
    if (bin < 0) bin = 0;
    hist[bin]++;
  }

  const total = data.length;
  let sum = 0;
  for (let i = 0; i < numBins; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 0;

  for (let i = 0; i < numBins; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = i;
    }
  }

  return min + threshold * binWidth;
}

function fillHoles(mask, rows, cols) {
  const bg = new Uint8Array(rows * cols);
  const stack = [];

  const push = (x, y) => {
    const idx = y * cols + x;
    if (!mask[idx] && !bg[idx]) {
      bg[idx] = 1;
      stack.push(idx);
    }
  };

  for (let x = 0; x < cols; x++) {
    push(x, 0);
    push(x, rows - 1);
  }
  for (let y = 0; y < rows; y++) {
    push(0, y);
    push(cols - 1, y);
  }

  while (stack.length) {
    const idx = stack.pop();
    const x = idx % cols;
    const y = (idx - x) / cols;
    if (x > 0) push(x - 1, y);
    if (x < cols - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < rows - 1) push(x, y + 1);
  }

  const out = new Uint8Array(rows * cols);
  for (let i = 0; i < out.length; i++) out[i] = bg[i] ? 0 : 1;
  return out;
}

function brightPhantomMask(img) {
  const t = otsuThreshold(img.data);
  const mask = new Uint8Array(img.rows * img.cols);
  for (let i = 0; i < img.data.length; i++) {
    mask[i] = img.data[i] > t ? 1 : 0;
  }
  return largestComponent(mask, img.rows, img.cols);
}

function createPhantomMask(img) {
  const bright = brightPhantomMask(img);
  return fillHoles(bright, img.rows, img.cols);
}

function findAllComponents(mask, rows, cols) {
  const labels = new Int32Array(rows * cols);
  let nextLabel = 1;
  const parent = [0];

  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (!mask[idx]) continue;
      const left = x > 0 ? labels[idx - 1] : 0;
      const top = y > 0 ? labels[idx - cols] : 0;

      if (left && top) {
        labels[idx] = Math.min(left, top);
        if (left !== top) union(left, top);
      } else if (left) {
        labels[idx] = left;
      } else if (top) {
        labels[idx] = top;
      } else {
        labels[idx] = nextLabel;
        parent[nextLabel] = nextLabel;
        nextLabel++;
      }
    }
  }

  const compMap = {};
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (!labels[idx]) continue;
      const root = find(labels[idx]);
      if (!compMap[root]) compMap[root] = { size: 0, pixels: [] };
      compMap[root].size++;
      compMap[root].pixels.push([x, y]);
    }
  }

  return Object.values(compMap);
}

function largestComponent(mask, rows, cols) {
  const comps = findAllComponents(mask, rows, cols);
  if (!comps.length) return mask;
  let largest = comps[0];
  for (const c of comps) if (c.size > largest.size) largest = c;
  const out = new Uint8Array(rows * cols);
  for (const [x, y] of largest.pixels) out[y * cols + x] = 1;
  return out;
}

function phantomGeometry(mask, img) {
  let xMin = img.cols;
  let xMax = -1;
  let yMin = img.rows;
  let yMax = -1;
  let count = 0;

  for (let y = 0; y < img.rows; y++) {
    for (let x = 0; x < img.cols; x++) {
      if (mask[y * img.cols + x]) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
        count++;
      }
    }
  }

  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  const widthMm = (xMax - xMin + 1) * img.pixelSpacing[1];
  const heightMm = (yMax - yMin + 1) * img.pixelSpacing[0];
  const radiusMm = (widthMm + heightMm) / 4;
  return { cx, cy, xMin, xMax, yMin, yMax, widthMm, heightMm, radiusMm, pixelCount: count };
}

function waterMeanInside(img, mask) {
  const t = otsuThreshold(img.data);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && img.data[i] > t) {
      sum += img.data[i];
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/* =========================================================================
   4. UTILIDADES NUMÉRICAS
   ========================================================================= */

function bilinear(data, rows, cols, x, y) {
  if (x < 0 || x >= cols - 1 || y < 0 || y >= rows - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = data[y0 * cols + x0];
  const v01 = data[y0 * cols + x0 + 1];
  const v10 = data[(y0 + 1) * cols + x0];
  const v11 = data[(y0 + 1) * cols + x0 + 1];
  return v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) + v10 * (1 - fx) * fy + v11 * fx * fy;
}

function buildDiskOffsets(radiusPx) {
  const offsets = [];
  const r = Math.ceil(radiusPx);
  const r2 = radiusPx * radiusPx;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) offsets.push([dx, dy]);
    }
  }
  return offsets;
}

function meanInDisk(data, rows, cols, cx, cy, offsets) {
  let sum = 0;
  let count = 0;
  const cxR = Math.round(cx);
  const cyR = Math.round(cy);
  for (let i = 0; i < offsets.length; i++) {
    const x = cxR + offsets[i][0];
    const y = cyR + offsets[i][1];
    if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
    sum += data[y * cols + x];
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function orientedBoundingBox(pixels) {
  let sumX = 0;
  let sumY = 0;
  for (const p of pixels) {
    sumX += p[0];
    sumY += p[1];
  }
  const cx = sumX / pixels.length;
  const cy = sumY / pixels.length;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const p of pixels) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  cxx /= pixels.length;
  cyy /= pixels.length;
  cxy /= pixels.length;

  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const lambda1 = trace / 2 + disc;

  let angle;
  if (Math.abs(cxy) < 1e-10) {
    angle = cxx >= cyy ? 0 : Math.PI / 2;
  } else {
    angle = Math.atan2(lambda1 - cxx, cxy);
  }

  const u = [Math.cos(angle), Math.sin(angle)];
  const v = [-Math.sin(angle), Math.cos(angle)];

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;

  for (const p of pixels) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const uP = dx * u[0] + dy * u[1];
    const vP = dx * v[0] + dy * v[1];
    if (uP < uMin) uMin = uP;
    if (uP > uMax) uMax = uP;
    if (vP < vMin) vMin = vP;
    if (vP > vMax) vMax = vP;
  }

  return {
    cx,
    cy,
    angle,
    length: uMax - uMin,
    width: vMax - vMin,
    u,
    v,
    uMin,
    uMax,
    vMin,
    vMax
  };
}

function smooth1d(arr, window) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = -window; j <= window; j++) {
      const k = i + j;
      if (k >= 0 && k < arr.length) {
        s += arr[k];
        n++;
      }
    }
    out[i] = s / n;
  }
  return out;
}

function meanProfileXInRect(data, rows, cols, x0, x1, y0, y1) {
  const xa = Math.max(0, Math.min(cols - 1, Math.round(Math.min(x0, x1))));
  const xb = Math.max(0, Math.min(cols - 1, Math.round(Math.max(x0, x1))));
  const ya = Math.max(0, Math.min(rows - 1, Math.round(Math.min(y0, y1))));
  const yb = Math.max(0, Math.min(rows - 1, Math.round(Math.max(y0, y1))));

  const profile = [];
  const xs = [];

  for (let x = xa; x <= xb; x++) {
    let sum = 0;
    let n = 0;
    for (let y = ya; y <= yb; y++) {
      sum += data[y * cols + x];
      n++;
    }
    profile.push(n > 0 ? sum / n : 0);
    xs.push(x);
  }

  return { xs, profile, x0: xa, x1: xb, y0: ya, y1: yb };
}

function findFwhmBounds(profile, xs) {
  if (!profile.length || profile.length !== xs.length) return null;

  const smooth = smooth1d(profile, 2);

  let minV = Infinity;
  let maxV = -Infinity;
  let iMin = 0;
  let iMax = 0;

  for (let i = 0; i < smooth.length; i++) {
    const v = smooth[i];
    if (v < minV) {
      minV = v;
      iMin = i;
    }
    if (v > maxV) {
      maxV = v;
      iMax = i;
    }
  }

  const amp = maxV - minV;
  if (amp <= 1e-6) return null;

  const tryPeak = (useBrightPeak) => {
    const peakIndex = useBrightPeak ? iMax : iMin;
    const half = useBrightPeak
      ? (minV + amp / 2)
      : (maxV - amp / 2);

    let left = null;
    for (let i = peakIndex; i > 0; i--) {
      const v1 = smooth[i - 1];
      const v2 = smooth[i];

      const crosses = useBrightPeak
        ? ((v1 <= half && v2 >= half) || (v1 >= half && v2 <= half))
        : ((v1 >= half && v2 <= half) || (v1 <= half && v2 >= half));

      if (crosses) {
        const denom = (v2 - v1);
        const t = Math.abs(denom) < 1e-12 ? 0 : (half - v1) / denom;
        left = xs[i - 1] + t * (xs[i] - xs[i - 1]);
        break;
      }
    }

    let right = null;
    for (let i = peakIndex; i < smooth.length - 1; i++) {
      const v1 = smooth[i];
      const v2 = smooth[i + 1];

      const crosses = useBrightPeak
        ? ((v1 >= half && v2 <= half) || (v1 <= half && v2 >= half))
        : ((v1 <= half && v2 >= half) || (v1 >= half && v2 <= half));

      if (crosses) {
        const denom = (v2 - v1);
        const t = Math.abs(denom) < 1e-12 ? 0 : (half - v1) / denom;
        right = xs[i] + t * (xs[i + 1] - xs[i]);
        break;
      }
    }

    if (left === null || right === null || right <= left) return null;

    return {
      left,
      right,
      widthPx: right - left,
      half,
      min: minV,
      max: maxV,
      peakIndex,
      mode: useBrightPeak ? 'bright' : 'dark'
    };
  };

  const brightResult = tryPeak(true);
  const darkResult = tryPeak(false);

  if (brightResult && darkResult) {
    return brightResult.widthPx <= darkResult.widthPx ? brightResult : darkResult;
  }

  return brightResult || darkResult || null;
}

function findProfileWidthByThreshold(profile, xs, frac = 0.5) {
  if (!profile.length || profile.length !== xs.length) return null;

  const smooth = smooth1d(profile, 2);

  let minV = Infinity;
  let maxV = -Infinity;
  let iMin = 0;
  let iMax = 0;

  for (let i = 0; i < smooth.length; i++) {
    const v = smooth[i];
    if (v < minV) {
      minV = v;
      iMin = i;
    }
    if (v > maxV) {
      maxV = v;
      iMax = i;
    }
  }

  const amp = maxV - minV;
  if (amp <= 1e-6) return null;

  const candidates = [
    { peakIndex: iMax, thr: minV + frac * amp },
    { peakIndex: iMin, thr: maxV - frac * amp }
  ];

  let best = null;

  for (const c of candidates) {
    let left = null;
    for (let i = c.peakIndex; i > 0; i--) {
      const v1 = smooth[i - 1];
      const v2 = smooth[i];
      if ((v1 - c.thr) * (v2 - c.thr) <= 0) {
        const denom = v2 - v1;
        const t = Math.abs(denom) < 1e-12 ? 0 : (c.thr - v1) / denom;
        left = xs[i - 1] + t * (xs[i] - xs[i - 1]);
        break;
      }
    }

    let right = null;
    for (let i = c.peakIndex; i < smooth.length - 1; i++) {
      const v1 = smooth[i];
      const v2 = smooth[i + 1];
      if ((v1 - c.thr) * (v2 - c.thr) <= 0) {
        const denom = v2 - v1;
        const t = Math.abs(denom) < 1e-12 ? 0 : (c.thr - v1) / denom;
        right = xs[i] + t * (xs[i + 1] - xs[i]);
        break;
      }
    }

    if (left !== null && right !== null && right > left) {
      const out = {
        left,
        right,
        widthPx: right - left,
        thr: c.thr
      };
      if (!best || out.widthPx < best.widthPx) best = out;
    }
  }

  return best;
}

function findLocalMaxima(arr, minDistance) {
  const peaks = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] > arr[i - 1] && arr[i] >= arr[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistance) {
        peaks.push(i);
      } else if (arr[i] > arr[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i;
      }
    }
  }
  return peaks;
}

function findOuterEdgeByRadialGradient(img, cx, cy, angleRad, approxRadiusPx) {
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  const ps = (img.pixelSpacing[0] + img.pixelSpacing[1]) / 2;

  const rMin = Math.max(approxRadiusPx - 20 / ps, 1);
  const rMax = approxRadiusPx + 25 / ps;
  const step = 0.5;

  const radii = [];
  const values = [];

  for (let r = rMin; r <= rMax; r += step) {
    const x = cx + r * dx;
    const y = cy + r * dy;
    if (x < 1 || x >= img.cols - 2 || y < 1 || y >= img.rows - 2) break;
    radii.push(r);
    values.push(bilinear(img.data, img.rows, img.cols, x, y));
  }

  if (values.length < 7) return null;

  const smooth = smooth1d(values, 2);
  let bestIdx = -1;
  let bestGrad = Infinity;

  for (let i = 1; i < smooth.length - 1; i++) {
    const grad = smooth[i + 1] - smooth[i - 1];
    if (grad < bestGrad) {
      bestGrad = grad;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;

  const r = radii[bestIdx];
  return {
    r,
    x: cx + r * dx,
    y: cy + r * dy,
    grad: bestGrad
  };
}

function measureDiameterToOuterEdge(img, cx, cy, angleRad, halfMean) {
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  const maxR = Math.max(img.rows, img.cols);
  const step = 0.25;

  const lastCrossOutwards = (sign) => {
    let last = null;
    let prevVal = bilinear(img.data, img.rows, img.cols, cx, cy);
    for (let r = step; r <= maxR; r += step) {
      const x = cx + sign * r * dx;
      const y = cy + sign * r * dy;
      if (x < 0 || x >= img.cols - 1 || y < 0 || y >= img.rows - 1) break;
      const v = bilinear(img.data, img.rows, img.cols, x, y);
      if (prevVal >= halfMean && v < halfMean) {
        const t = (halfMean - prevVal) / (v - prevVal);
        last = r - step + t * step;
      }
      prevVal = v;
    }
    return last;
  };

  const rPos = lastCrossOutwards(+1);
  const rNeg = lastCrossOutwards(-1);
  if (rPos === null || rNeg === null) return null;
  return (rPos + rNeg) * img.pixelSpacing[0];
}

function sampleEllipsePoints(cx, cy, u, v, majorMm, minorMm, psX, psY, n = 120) {
  const pts = [];
  const aMm = majorMm / 2;
  const bMm = minorMm / 2;
  for (let i = 0; i <= n; i++) {
    const t = 2 * Math.PI * i / n;
    const du = aMm * Math.cos(t);
    const dv = bMm * Math.sin(t);
    const dxMm = du * u[0] + dv * v[0];
    const dyMm = du * u[1] + dv * v[1];
    pts.push({ x: cx + dxMm / psX, y: cy + dyMm / psY });
  }
  return pts;
}

function quantile(arr, q) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const i0 = Math.floor(pos);
  const i1 = Math.ceil(pos);
  if (i0 === i1) return s[i0];
  const t = pos - i0;
  return s[i0] * (1 - t) + s[i1] * t;
}

/* =========================================================================
   4b. AJUSTE ROBUSTO DE ELIPSE (Halir–Flusser) + UTILIDADES DE ÁLGEBRA
   -------------------------------------------------------------------------
   La burbuja de aire del fantoma se sitúa siempre en el vértice superior
   (a las 12). Corrompe los puntos de borde de ese sector y, con ellos, la
   medida del borde superior en geometría axial y el ajuste de la elipse.
   Solución: muestrear el borde en 360°, EXCLUIR una banda superior de
   ~3 cm (donde cae la burbuja), y ajustar una elipse por mínimos cuadrados
   algebraicos (válido con cobertura angular parcial), con rechazo iterativo
   de outliers. La elipse resultante se usa como referencia de borde.
   ========================================================================= */

function mat3mul(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j];
      C[i * 3 + j] = s;
    }
  }
  return C;
}

function mat3inv(M) {
  const a = M[0], b = M[1], c = M[2];
  const d = M[3], e = M[4], f = M[5];
  const g = M[6], h = M[7], i = M[8];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-300) return null;
  const id = 1 / det;
  return [
    A * id, (c * h - b * i) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, (c * d - a * f) * id,
    C * id, (b * g - a * h) * id, (a * e - b * d) * id
  ];
}

// Raíces reales de x^3 + b x^2 + c x + d = 0
function realCubicRoots(b, c, d) {
  const off = b / 3;
  const p = c - b * b / 3;
  const q = 2 * b * b * b / 27 - b * c / 3 + d;
  if (Math.abs(p) < 1e-14 && Math.abs(q) < 1e-14) return [-off];
  const disc = q * q / 4 + p * p * p / 27;
  if (disc > 1e-12) {
    const sq = Math.sqrt(disc);
    const u = Math.cbrt(-q / 2 + sq);
    const v = Math.cbrt(-q / 2 - sq);
    return [u + v - off];
  }
  if (disc < -1e-12) {
    const m = 2 * Math.sqrt(-p / 3);
    let A = (3 * q) / (p * m);
    A = Math.max(-1, Math.min(1, A));
    const phi = Math.acos(A);
    return [
      m * Math.cos(phi / 3) - off,
      m * Math.cos((phi - 2 * Math.PI) / 3) - off,
      m * Math.cos((phi - 4 * Math.PI) / 3) - off
    ];
  }
  const u = Math.cbrt(-q / 2);
  return [2 * u - off, -u - off];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// Vector del núcleo de (M - lambda I) para una matriz 3x3 general
function nullVec3(M, l) {
  const A = [M[0] - l, M[1], M[2], M[3], M[4] - l, M[5], M[6], M[7], M[8] - l];
  const r0 = [A[0], A[1], A[2]];
  const r1 = [A[3], A[4], A[5]];
  const r2 = [A[6], A[7], A[8]];
  const cand = [cross3(r0, r1), cross3(r0, r2), cross3(r1, r2)];
  let best = cand[0];
  let bn = Math.hypot(best[0], best[1], best[2]);
  for (let k = 1; k < cand.length; k++) {
    const n = Math.hypot(cand[k][0], cand[k][1], cand[k][2]);
    if (n > bn) { bn = n; best = cand[k]; }
  }
  if (bn < 1e-300) return [0, 0, 0];
  return [best[0] / bn, best[1] / bn, best[2] / bn];
}

function eig3(M) {
  const tr = M[0] + M[4] + M[8];
  const m2 = (M[4] * M[8] - M[5] * M[7]) +
             (M[0] * M[8] - M[2] * M[6]) +
             (M[0] * M[4] - M[1] * M[3]);
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) -
              M[1] * (M[3] * M[8] - M[5] * M[6]) +
              M[2] * (M[3] * M[7] - M[4] * M[6]);
  const lambdas = realCubicRoots(-tr, m2, -det);
  return lambdas.map(l => ({ lambda: l, vec: nullVec3(M, l) }));
}

// Ajuste directo de elipse por mínimos cuadrados (Halir & Flusser, 1998).
// pts: [{x, y}] en mm (o cualquier unidad coherente). Devuelve centro,
// semiejes (a >= b), orientación del eje mayor y vectores unitarios u, v.
function fitEllipseDirect(pts) {
  const n = pts.length;
  if (n < 6) return null;

  // Normalización para estabilidad numérica
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let scl = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    scl += dx * dx + dy * dy;
  }
  scl = Math.sqrt(scl / n) || 1;

  const S1 = new Array(9).fill(0);
  const S2 = new Array(9).fill(0);
  const S3 = new Array(9).fill(0);
  for (const p of pts) {
    const x = (p.x - mx) / scl;
    const y = (p.y - my) / scl;
    const d1 = [x * x, x * y, y * y];
    const d2 = [x, y, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        S1[i * 3 + j] += d1[i] * d1[j];
        S2[i * 3 + j] += d1[i] * d2[j];
        S3[i * 3 + j] += d2[i] * d2[j];
      }
    }
  }

  const S3inv = mat3inv(S3);
  if (!S3inv) return null;
  const S2t = [S2[0], S2[3], S2[6], S2[1], S2[4], S2[7], S2[2], S2[5], S2[8]];
  const T = mat3mul(S3inv.map(v => -v), S2t);
  const S2T = mat3mul(S2, T);
  const M = S1.map((v, i) => v + S2T[i]);

  // Premultiplicar por inv(C1), C1 = [[0,0,2],[0,-1,0],[2,0,0]]
  const M2 = [
    M[6] / 2, M[7] / 2, M[8] / 2,
    -M[3], -M[4], -M[5],
    M[0] / 2, M[1] / 2, M[2] / 2
  ];

  const eigs = eig3(M2);
  let a1 = null;
  for (const e of eigs) {
    const v = e.vec;
    if (4 * v[0] * v[2] - v[1] * v[1] > 0) { a1 = v; break; }
  }
  if (!a1) return null;

  const a2 = [
    T[0] * a1[0] + T[1] * a1[1] + T[2] * a1[2],
    T[3] * a1[0] + T[4] * a1[1] + T[5] * a1[2],
    T[6] * a1[0] + T[7] * a1[1] + T[8] * a1[2]
  ];

  const A = a1[0], B = a1[1], C = a1[2];
  const D = a2[0], E = a2[1], F = a2[2];

  const disc = B * B - 4 * A * C;
  if (Math.abs(disc) < 1e-300) return null;
  const x0 = (2 * C * D - B * E) / disc;
  const y0 = (2 * A * E - B * D) / disc;
  const F0 = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 + F;
  if (-F0 <= 0) return null;

  // Eigen de la forma cuadrática Q = [[A, B/2],[B/2, C]]
  const q11 = A, q12 = B / 2, q22 = C;
  const trq = q11 + q22;
  const dq = q11 * q22 - q12 * q12;
  const tmp = Math.sqrt(Math.max(0, trq * trq / 4 - dq));
  const l1 = trq / 2 + tmp; // mayor autovalor -> semieje menor
  const l2 = trq / 2 - tmp; // menor autovalor -> semieje mayor
  if (l1 <= 0 || l2 <= 0) return null;

  const axMinor = Math.sqrt(-F0 / l1);
  const axMajor = Math.sqrt(-F0 / l2);

  // Dirección del eje mayor = autovector de l2
  let ux, uy;
  if (Math.abs(q12) < 1e-12) {
    if (q11 <= q22) { ux = 1; uy = 0; } else { ux = 0; uy = 1; }
  } else {
    ux = q12; uy = l2 - q11;
  }
  const un = Math.hypot(ux, uy) || 1;
  ux /= un; uy /= un;

  return {
    cx: x0 * scl + mx,
    cy: y0 * scl + my,
    a: axMajor * scl,
    b: axMinor * scl,
    theta: Math.atan2(uy, ux),
    u: [ux, uy],
    v: [-uy, ux]
  };
}

// Radio (mm) de la elipse en el ángulo phi del marco local (medido desde u)
function ellipseRadiusAtAngle(a, b, phi) {
  return (a * b) / Math.hypot(b * Math.cos(phi), a * Math.sin(phi));
}

// Punto (px) donde el rayo desde el centro, en dirección (dirX, dirY) px,
// intersecta la elipse ajustada.
function ellipseEdgePoint(fit, dirX, dirY) {
  const a = fit.majorMm / 2;
  const b = fit.minorMm / 2;
  const au = dirX * fit.psX * fit.u[0] + dirY * fit.psY * fit.u[1];
  const av = dirX * fit.psX * fit.v[0] + dirY * fit.psY * fit.v[1];
  const denom = Math.sqrt((au / a) * (au / a) + (av / b) * (av / b));
  if (!(denom > 0)) return null;
  const r = 1 / denom; // px
  return { x: fit.cx + dirX * r, y: fit.cy + dirY * r };
}

// Ajuste robusto del borde del fantoma a una elipse, excluyendo la banda
// superior donde se aloja la burbuja de aire (siempre a las 12).
function fitPhantomEllipse(img, opts = {}) {
  const excludeTopChordMm = opts.excludeTopChordMm != null ? opts.excludeTopChordMm : 30;
  const nAngles = opts.nAngles || 144;

  const mask = createPhantomMask(img);
  const geom0 = phantomGeometry(mask, img);
  const psY = img.pixelSpacing[0];
  const psX = img.pixelSpacing[1];
  const ps = (psX + psY) / 2;
  const approxRadiusPx = ((geom0.widthMm / psX) + (geom0.heightMm / psY)) / 4;

  // Centro inicial robusto: izquierda/derecha (horizontal, limpio) + bbox.
  const left0 = findOuterEdgeByRadialGradient(img, geom0.cx, geom0.cy, Math.PI, approxRadiusPx);
  const right0 = findOuterEdgeByRadialGradient(img, geom0.cx, geom0.cy, 0, approxRadiusPx);
  const bottom0 = findOuterEdgeByRadialGradient(img, geom0.cx, geom0.cy, Math.PI / 2, approxRadiusPx);
  if (!left0 || !right0) return null;

  const cx0 = (left0.x + right0.x) / 2;
  const cy0 = bottom0 ? bottom0.y - approxRadiusPx : geom0.cy;
  const refinedRadiusPx = bottom0
    ? (left0.r + right0.r + bottom0.r) / 3
    : (left0.r + right0.r) / 2;

  // Banda superior a excluir: cuerda de excludeTopChordMm en el vértice.
  const radiusMm = refinedRadiusPx * ps;
  const halfChordFrac = Math.min(0.99, (excludeTopChordMm / 2) / radiusMm);
  const excludeHalfAngle = Math.asin(halfChordFrac);
  const upAngle = -Math.PI / 2; // "arriba" en coordenadas de imagen

  // Muestreo del borde en 360°, marcando el sector excluido.
  const sampled = [];
  for (let k = 0; k < nAngles; k++) {
    const a = 2 * Math.PI * k / nAngles;
    const p = findOuterEdgeByRadialGradient(img, cx0, cy0, a, refinedRadiusPx);
    if (!p) continue;
    const da = Math.abs(Math.atan2(Math.sin(a - upAngle), Math.cos(a - upAngle)));
    sampled.push({ x: p.x, y: p.y, angle: a, excluded: da < excludeHalfAngle });
  }

  let used = sampled.filter(p => !p.excluded);
  if (used.length < 20) return null;

  // Ajuste + rechazo iterativo de outliers (residuo radial robusto).
  let fit = null;
  for (let iter = 0; iter < 3; iter++) {
    const ptsMm = used.map(p => ({ x: (p.x - cx0) * psX, y: (p.y - cy0) * psY }));
    fit = fitEllipseDirect(ptsMm);
    if (!fit) return null;

    const absres = used.map(p => {
      const dx = (p.x - cx0) * psX - fit.cx;
      const dy = (p.y - cy0) * psY - fit.cy;
      const pu = dx * fit.u[0] + dy * fit.u[1];
      const pv = dx * fit.v[0] + dy * fit.v[1];
      const phi = Math.atan2(pv, pu);
      const er = ellipseRadiusAtAngle(fit.a, fit.b, phi);
      return Math.abs(Math.hypot(pu, pv) - er);
    });
    const mad = quantile(absres, 0.5) || 0;
    const thr = Math.max(1.2, 3 * mad);
    const next = used.filter((p, i) => absres[i] <= thr);
    if (next.length === used.length || next.length < 24) break;
    used = next;
  }
  if (!fit) return null;

  const usedSet = new Set(used);
  const cxPx = cx0 + fit.cx / psX;
  const cyPx = cy0 + fit.cy / psY;
  const majorMm = 2 * fit.a;
  const minorMm = 2 * fit.b;

  return {
    cx: cxPx,
    cy: cyPx,
    u: fit.u,
    v: fit.v,
    majorMm,
    minorMm,
    angleRad: fit.theta,
    eccentricity: Math.sqrt(Math.max(0, 1 - (minorMm * minorMm) / (majorMm * majorMm))),
    psX,
    psY,
    excludeHalfAngle,
    excludeTopChordMm,
    upAngle,
    nUsed: used.length,
    nTotal: sampled.length,
    ptsUsed: sampled.filter(p => usedSet.has(p)),
    ptsExcluded: sampled.filter(p => p.excluded),
    ptsOutlier: sampled.filter(p => !p.excluded && !usedSet.has(p))
  };
}

// ¿La dirección (px) cae dentro de la banda superior excluida (burbuja)?
function isInExcludedTopSector(fit, dirX, dirY) {
  const a = Math.atan2(dirY, dirX);
  const da = Math.abs(Math.atan2(Math.sin(a - fit.upAngle), Math.cos(a - fit.upAngle)));
  return da < fit.excludeHalfAngle;
}

/* =========================================================================
   5. TESTS
   ========================================================================= */

function testPIU(img, fieldStrength) {
  const mask = createPhantomMask(img);
  const bright = brightPhantomMask(img);
  const geom = phantomGeometry(mask, img);

  const largeAreaMm2 = 12000;
  const largeRadiusMm = Math.sqrt(largeAreaMm2 / Math.PI);
  const largeRadiusPx = largeRadiusMm / img.pixelSpacing[0];

  const smallAreaMm2 = 100;
  const smallRadiusMm = Math.sqrt(smallAreaMm2 / Math.PI);
  const smallRadiusPx = smallRadiusMm / img.pixelSpacing[0];

  const smallOffsets = buildDiskOffsets(smallRadiusPx);
  const allowedR2 = (largeRadiusPx - smallRadiusPx) * (largeRadiusPx - smallRadiusPx);
  const largeR2 = largeRadiusPx * largeRadiusPx;

  const diskFullyInBright = (cx, cy) => {
    for (const [dx, dy] of smallOffsets) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= img.cols || y < 0 || y >= img.rows) return false;
      if (!bright[y * img.cols + x]) return false;
    }
    return true;
  };

  let minMean = Infinity;
  let maxMean = -Infinity;
  let minLoc = null;
  let maxLoc = null;
  let largeSum = 0;
  let largeCount = 0;
  let excludedCount = 0;

  for (let y = 0; y < img.rows; y++) {
    for (let x = 0; x < img.cols; x++) {
      const dx = x - geom.cx;
      const dy = y - geom.cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > largeR2) continue;
      const idx = y * img.cols + x;

      if (!bright[idx]) {
        excludedCount++;
        continue;
      }

      largeSum += img.data[idx];
      largeCount++;

      if (d2 > allowedR2) continue;
      if (x % 2 !== 0 || y % 2 !== 0) continue;
      if (!diskFullyInBright(x, y)) continue;

      const m = meanInDisk(img.data, img.rows, img.cols, x, y, smallOffsets);
      if (m < minMean) {
        minMean = m;
        minLoc = [x, y];
      }
      if (m > maxMean) {
        maxMean = m;
        maxLoc = [x, y];
      }
    }
  }

  const piu = 100 * (1 - (maxMean - minMean) / (maxMean + minMean));
  const limit = fieldStrength >= 3 ? 85 : 90;
  const pass = piu >= limit;
  const exportData = {
    piuPct: piu,
    limitPct: limit,
    minSignal: minMean,
    maxSignal: maxMean,
    largeMean: largeSum / largeCount,
    excludedPixels: excludedCount
  };

  return {
    exportKey: 'piu_slice_7',
    name: 'Uniformidad de intensidad (PIU) — slice 7',
    pass,
    exportData,
    metrics: {
      'PIU': `${piu.toFixed(2)} %`,
      'Límite': `≥ ${limit} %`,
      'Señal mínima': minMean.toFixed(1),
      'Señal máxima': maxMean.toFixed(1),
      'Media ROI grande': (largeSum / largeCount).toFixed(1),
      'Píx. excluidos': `${excludedCount} (burbujas/tapón)`
    },
    overlay: (ctx) => {
      drawCircle(ctx, geom.cx, geom.cy, largeRadiusPx, '#3498db', 2);
      if (minLoc) drawCircle(ctx, minLoc[0], minLoc[1], smallRadiusPx, '#e74c3c', 1.5);
      if (maxLoc) drawCircle(ctx, maxLoc[0], maxLoc[1], smallRadiusPx, '#27ae60', 1.5);
    },
    img
  };
}

function testGhosting(img) {
  const mask = createPhantomMask(img);
  const bright = brightPhantomMask(img);
  const geom = phantomGeometry(mask, img);

  const largeAreaMm2 = 16000;
  const largeRadiusMm = Math.sqrt(largeAreaMm2 / Math.PI);
  const largeRadiusPx = largeRadiusMm / img.pixelSpacing[0];
  const largeR2 = largeRadiusPx * largeRadiusPx;

  let largeMean = 0;
  let largeCount = 0;
  for (let y = 0; y < img.rows; y++) {
    for (let x = 0; x < img.cols; x++) {
      const dx = x - geom.cx;
      const dy = y - geom.cy;
      const idx = y * img.cols + x;
      if (dx * dx + dy * dy <= largeR2 && bright[idx]) {
        largeMean += img.data[idx];
        largeCount++;
      }
    }
  }
  largeMean /= largeCount;

  const phantomRadiusPx = geom.radiusMm / img.pixelSpacing[0];
  const targetAreaPx = 1000 / (img.pixelSpacing[0] * img.pixelSpacing[1]);
  let shortPx = Math.sqrt(targetAreaPx / 4);
  let longPx = 4 * shortPx;
  const margin = 4;

  const phantomTop = geom.cy - phantomRadiusPx;
  const phantomBottom = geom.cy + phantomRadiusPx;
  const phantomLeft = geom.cx - phantomRadiusPx;
  const phantomRight = geom.cx + phantomRadiusPx;

  const fitDim = (avail) => Math.max(2, Math.min(shortPx, avail - 2 * margin));

  const topShort = fitDim(phantomTop);
  const botShort = fitDim(img.rows - phantomBottom);
  const lftShort = fitDim(phantomLeft);
  const rgtShort = fitDim(img.cols - phantomRight);

  const horizLong = Math.min(longPx, img.cols - 2 * margin);
  const vertLong = Math.min(longPx, img.rows - 2 * margin);

  const topRoi = {
    x: geom.cx - horizLong / 2,
    y: margin + (phantomTop - margin - topShort) / 2,
    w: horizLong,
    h: topShort
  };
  const botRoi = {
    x: geom.cx - horizLong / 2,
    y: phantomBottom + (img.rows - phantomBottom - margin - botShort) / 2,
    w: horizLong,
    h: botShort
  };
  const lftRoi = {
    x: margin + (phantomLeft - margin - lftShort) / 2,
    y: geom.cy - vertLong / 2,
    w: lftShort,
    h: vertLong
  };
  const rgtRoi = {
    x: phantomRight + (img.cols - phantomRight - margin - rgtShort) / 2,
    y: geom.cy - vertLong / 2,
    w: rgtShort,
    h: vertLong
  };

  const meanRect = (r) => {
    let s = 0;
    let n = 0;
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(img.cols, Math.ceil(r.x + r.w));
    const y1 = Math.min(img.rows, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        s += img.data[y * img.cols + x];
        n++;
      }
    }
    return n > 0 ? s / n : 0;
  };

  const top = meanRect(topRoi);
  const bottom = meanRect(botRoi);
  const left = meanRect(lftRoi);
  const right = meanRect(rgtRoi);

  const ghostingRatio = Math.abs(((top + bottom) - (left + right)) / (2 * largeMean));
  const psg = ghostingRatio * 100;
  const pass = psg < 3.0;
  const exportData = {
    psgPct: psg,
    limitPct: 3.0,
    largeMean,
    topMean: top,
    bottomMean: bottom,
    leftMean: left,
    rightMean: right
  };

  return {
    exportKey: 'ghosting_slice_7',
    name: 'Ghosting (PSG) — slice 7',
    pass,
    exportData,
    metrics: {
      'PSG': `${psg.toFixed(3)} %`,
      'Límite': '< 3.0 %',
      'Media ROI grande': largeMean.toFixed(1),
      'Top': top.toFixed(1),
      'Bottom': bottom.toFixed(1),
      'Left': left.toFixed(1),
      'Right': right.toFixed(1)
    },
    overlay: (ctx) => {
      drawCircle(ctx, geom.cx, geom.cy, largeRadiusPx, '#3498db', 2);
      drawRect(ctx, topRoi, '#f39c12', 1.5);
      drawRect(ctx, botRoi, '#f39c12', 1.5);
      drawRect(ctx, lftRoi, '#f39c12', 1.5);
      drawRect(ctx, rgtRoi, '#f39c12', 1.5);
    },
    img
  };
}
function testGeometryAxial(img, sliceLabel, expectedDiameterMm, tolerance, useCrosswiseDiameters) {
  const psY = img.pixelSpacing[0];
  const psX = img.pixelSpacing[1];

  // Referencia de borde: elipse robusta (excluye la banda superior con la
  // burbuja). El centro y el borde superior se toman de la elipse; el resto
  // de bordes se miden directamente por gradiente.
  const fit = fitPhantomEllipse(img);

  let cx, cy, refinedRadiusPx;
  if (fit) {
    cx = fit.cx;
    cy = fit.cy;
    refinedRadiusPx = ((fit.majorMm / psX) + (fit.minorMm / psY)) / 4;
  } else {
    // Fallback: método anterior por bordes cardinales.
    const mask = createPhantomMask(img);
    const geom0 = phantomGeometry(mask, img);
    const approxRadiusPx = ((geom0.widthMm / psX) + (geom0.heightMm / psY)) / 4;
    const left0 = findOuterEdgeByRadialGradient(img, geom0.cx, geom0.cy, Math.PI, approxRadiusPx);
    const right0 = findOuterEdgeByRadialGradient(img, geom0.cx, geom0.cy, 0, approxRadiusPx);
    const top0 = findOuterEdgeByRadialGradient(img, geom0.cx, geom0.cy, -Math.PI / 2, approxRadiusPx);
    const bottom0 = findOuterEdgeByRadialGradient(img, geom0.cx, geom0.cy, Math.PI / 2, approxRadiusPx);
    if (!left0 || !right0 || !top0 || !bottom0) {
      throw new Error('No se ha podido localizar el borde exterior del phantom.');
    }
    cx = (left0.x + right0.x) / 2;
    cy = (top0.y + bottom0.y) / 2;
    refinedRadiusPx = (left0.r + right0.r + top0.r + bottom0.r) / 4;
  }

  // Borde en una dirección dada: si cae en la banda superior excluida
  // (burbuja) se toma de la elipse; en caso contrario se mide por gradiente.
  const edgePointInDir = (angleRad, label) => {
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    if (fit && isInExcludedTopSector(fit, dx, dy)) {
      const e = ellipseEdgePoint(fit, dx, dy);
      if (!e) throw new Error(`No se ha podido proyectar el borde sobre la elipse en ${label}.`);
      return { x: e.x, y: e.y, fromEllipse: true };
    }
    let approx = refinedRadiusPx;
    if (fit) {
      const e = ellipseEdgePoint(fit, dx, dy);
      if (e) approx = Math.hypot(e.x - cx, e.y - cy);
    }
    const p = findOuterEdgeByRadialGradient(img, cx, cy, angleRad, approx);
    if (!p) throw new Error(`No se ha podido medir el borde exterior en ${label}.`);
    return { x: p.x, y: p.y, fromEllipse: false };
  };

  const angles = useCrosswiseDiameters ? [0, 45, 90, 135] : [0, 90];
  const labels = { 0: 'L-R', 45: 'diag /', 90: 'T-B', 135: 'diag \\\\' };

  const measurements = [];

  for (const angleDeg of angles) {
    const angleRad = angleDeg * Math.PI / 180;

    if (angleDeg === 0) {
      const pLeft = edgePointInDir(Math.PI, labels[angleDeg]);
      const pRight = edgePointInDir(0, labels[angleDeg]);
      const diameterMm = Math.abs(pRight.x - pLeft.x) * psX;
      measurements.push({
        angleDeg,
        label: labels[angleDeg],
        diameterMm,
        p1: { x: pLeft.x, y: cy, fromEllipse: pLeft.fromEllipse },
        p2: { x: pRight.x, y: cy, fromEllipse: pRight.fromEllipse }
      });
      continue;
    }

    if (angleDeg === 90) {
      const pTop = edgePointInDir(-Math.PI / 2, labels[angleDeg]);
      const pBottom = edgePointInDir(Math.PI / 2, labels[angleDeg]);
      const diameterMm = Math.abs(pBottom.y - pTop.y) * psY;
      measurements.push({
        angleDeg,
        label: labels[angleDeg],
        diameterMm,
        p1: { x: cx, y: pTop.y, fromEllipse: pTop.fromEllipse },
        p2: { x: cx, y: pBottom.y, fromEllipse: pBottom.fromEllipse }
      });
      continue;
    }

    const p1 = edgePointInDir(angleRad, labels[angleDeg]);
    const p2 = edgePointInDir(angleRad + Math.PI, labels[angleDeg]);
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const diameterPx = Math.sqrt(dx * dx + dy * dy);
    const diameterMm = diameterPx * (psY + psX) / 2;
    measurements.push({ angleDeg, label: labels[angleDeg], diameterMm, p1, p2 });
  }

  const errors = measurements.map(m => m.diameterMm - expectedDiameterMm);
  const maxError = Math.max(...errors.map(Math.abs));
  const pass = maxError <= tolerance;
  const exportKey = `geometry_axial_${slugifyExportPart(sliceLabel)}`;
  const diameterByAngle = Object.fromEntries(measurements.map((m) => [`deg_${m.angleDeg}`, m.diameterMm]));
  const exportData = {
    sliceLabel,
    expectedDiameterMm,
    toleranceMm: tolerance,
    maxErrorMm: maxError,
    centerXpx: cx,
    centerYpx: cy,
    diameterDeg0Mm: diameterByAngle.deg_0,
    diameterDeg45Mm: diameterByAngle.deg_45,
    diameterDeg90Mm: diameterByAngle.deg_90,
    diameterDeg135Mm: diameterByAngle.deg_135
  };

  const metrics = {};
  for (const m of measurements) {
    metrics[m.label] = `${m.diameterMm.toFixed(2)} mm  (Δ ${(m.diameterMm - expectedDiameterMm).toFixed(2)})`;
  }
  metrics['Esperado'] = `${expectedDiameterMm} mm ± ${tolerance}`;
  metrics['|Δ| máx'] = `${maxError.toFixed(2)} mm`;
  metrics['Centro'] = `(${cx.toFixed(1)}, ${cy.toFixed(1)}) px`;
  metrics['Borde superior'] = fit
    ? `elipse (banda ${fit.excludeTopChordMm} mm excluida)`
    : 'gradiente (sin elipse)';

  return {
    exportKey,
    name: `Geometría axial — ${sliceLabel}`,
    pass,
    exportData,
    metrics,
    overlay: (ctx) => {
      // Elipse de referencia (tenue) para ver de dónde sale el borde superior
      if (fit) {
        const ellipsePts = sampleEllipsePoints(fit.cx, fit.cy, fit.u, fit.v, fit.majorMm, fit.minorMm, psX, psY, 120);
        ctx.beginPath();
        for (let i = 0; i < ellipsePts.length; i++) {
          const p = ellipsePts[i];
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = 'rgba(52, 152, 219, 0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      for (const m of measurements) {
        drawLine(ctx, m.p1.x, m.p1.y, m.p2.x, m.p2.y, '#27ae60', 1.5);
        // Endpoints: cian si provienen de la elipse, rojo si medidos
        drawCross(ctx, m.p1.x, m.p1.y, 3, m.p1.fromEllipse ? '#1abc9c' : '#e74c3c');
        drawCross(ctx, m.p2.x, m.p2.y, 3, m.p2.fromEllipse ? '#1abc9c' : '#e74c3c');
      }
      drawCross(ctx, cx, cy, 5, '#f1c40f');
    },
    img
  };
}


function testGeometrySagittal(img, expectedLengthMm, tolerance) {
  const filledMask = createPhantomMask(img);
  const brightMask = brightPhantomMask(img);
  const geom = phantomGeometry(filledMask, img);

  function longestVerticalRun(mask, rows, cols, x) {
    let bestStart = -1;
    let bestEnd = -1;
    let runStart = -1;

    for (let y = 0; y < rows; y++) {
      const inside = mask[y * cols + x] === 1;

      if (inside) {
        if (runStart < 0) runStart = y;
      } else if (runStart >= 0) {
        const runEnd = y - 1;
        if (bestStart < 0 || (runEnd - runStart) > (bestEnd - bestStart)) {
          bestStart = runStart;
          bestEnd = runEnd;
        }
        runStart = -1;
      }
    }

    if (runStart >= 0) {
      const runEnd = rows - 1;
      if (bestStart < 0 || (runEnd - runStart) > (bestEnd - bestStart)) {
        bestStart = runStart;
        bestEnd = runEnd;
      }
    }

    if (bestStart < 0) return null;

    return {
      top: bestStart,
      bottom: bestEnd,
      spanPx: bestEnd - bestStart + 1
    };
  }

  const xStart = Math.max(0, Math.floor(geom.xMin + 2));
  const xEnd = Math.min(img.cols - 1, Math.ceil(geom.xMax - 2));

  const candidates = [];

  for (let x = xStart; x <= xEnd; x++) {
    const run = longestVerticalRun(brightMask, img.rows, img.cols, x);
    if (!run) continue;

    candidates.push({
      x,
      top: run.top,
      bottom: run.bottom,
      spanPx: run.spanPx,
      distToCenter: Math.abs(x - geom.cx)
    });
  }

  if (!candidates.length) {
    throw new Error('No se ha podido encontrar una columna sagital válida para medir la longitud.');
  }

  const maxSpan = Math.max(...candidates.map(c => c.spanPx));

  const bestBand = candidates.filter(c => c.spanPx >= maxSpan - 1);

  let sumX = 0;
  for (const c of bestBand) sumX += c.x;
  const xChosen = sumX / bestBand.length;

  let best = bestBand[0];
  for (const c of bestBand) {
    if (Math.abs(c.x - xChosen) < Math.abs(best.x - xChosen)) {
      best = c;
    }
  }

  const length = best.spanPx * img.pixelSpacing[0];
  const error = length - expectedLengthMm;
  const pass = Math.abs(error) <= tolerance;
  const exportData = {
    lengthMm: length,
    expectedLengthMm,
    toleranceMm: tolerance,
    errorMm: error,
    xChosenPx: best.x
  };

  return {
    exportKey: 'geometry_sagittal',
    name: 'Geometría sagital (longitud H-F)',
    pass,
    exportData,
    metrics: {
      'Longitud': `${length.toFixed(2)} mm`,
      'Esperado': `${expectedLengthMm} mm ± ${tolerance}`,
      'Error': `${error.toFixed(2)} mm`,
      'x elegida': `${best.x.toFixed(1)} px`
    },
    overlay: (ctx) => {
      const xDraw = Math.round(best.x) + 0.5;
      const yTop = Math.round(best.top) + 0.5;
      const yBottom = Math.round(best.bottom) + 0.5;
      const yMid = (yTop + yBottom) / 2;

      drawLine(ctx, xDraw, yTop, xDraw, yBottom, '#27ae60', 2);
      drawCross(ctx, xDraw, yMid, 5, '#f1c40f');
      drawCross(ctx, xDraw, yTop, 3, '#e74c3c');
      drawCross(ctx, xDraw, yBottom, 3, '#e74c3c');
    },
    img
  };
}




function testSliceThickness(img) {
  const mask = createPhantomMask(img);
  const geom = phantomGeometry(mask, img);
  const waterMean = waterMeanInside(img, mask);

  const psX = img.pixelSpacing[1];
  const psY = img.pixelSpacing[0];

  const xMin = Math.max(0, Math.floor(geom.xMin + 2));
  const xMax = Math.min(img.cols - 1, Math.ceil(geom.xMax - 2));
  const yMin = Math.max(0, Math.floor(geom.yMin + 2));
  const yMax = Math.min(img.rows - 1, Math.ceil(geom.yMax - 2));

  const phantomWidthPx = xMax - xMin + 1;
  const phantomHeightPx = yMax - yMin + 1;

  // 1) Buscar la banda oscura horizontal más larga del phantom
  // Se limita a la zona central vertical para evitar el inserto negro inferior.
  const searchY0 = Math.max(yMin, Math.round(geom.cy - 0.18 * phantomHeightPx));
  const searchY1 = Math.min(yMax, Math.round(geom.cy + 0.08 * phantomHeightPx));

  const darkThreshold = waterMean * 0.45;

  function longestDarkRunAtRow(y) {
    let bestStart = -1;
    let bestEnd = -1;
    let runStart = -1;

    for (let x = xMin; x <= xMax; x++) {
      const inside = mask[y * img.cols + x] === 1;
      const dark = inside && img.data[y * img.cols + x] < darkThreshold;

      if (dark) {
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        const runEnd = x - 1;
        if (bestStart < 0 || (runEnd - runStart) > (bestEnd - bestStart)) {
          bestStart = runStart;
          bestEnd = runEnd;
        }
        runStart = -1;
      }
    }

    if (runStart >= 0) {
      const runEnd = xMax;
      if (bestStart < 0 || (runEnd - runStart) > (bestEnd - bestStart)) {
        bestStart = runStart;
        bestEnd = runEnd;
      }
    }

    if (bestStart < 0) return null;

    return {
      x0: bestStart,
      x1: bestEnd,
      widthPx: bestEnd - bestStart + 1
    };
  }

  let bestRow = null;

  for (let y = searchY0; y <= searchY1; y++) {
    const run = longestDarkRunAtRow(y);
    if (!run) continue;

    const widthFrac = run.widthPx / phantomWidthPx;
    if (widthFrac < 0.55) continue;

    let meanDark = 0;
    let n = 0;
    for (let x = run.x0; x <= run.x1; x++) {
      meanDark += img.data[y * img.cols + x];
      n++;
    }
    meanDark /= Math.max(1, n);

    const score = run.widthPx - 0.25 * meanDark;

    if (!bestRow || score > bestRow.score) {
      bestRow = {
        y,
        x0: run.x0,
        x1: run.x1,
        widthPx: run.widthPx,
        score
      };
    }
  }

  if (!bestRow) {
    throw new Error('No se ha podido localizar la franja horizontal central del espesor de corte.');
  }

  // 2) Expandir verticalmente la banda alrededor de la mejor fila
  const minAcceptWidthPx = 0.50 * phantomWidthPx;

  let bandTopY = bestRow.y;
  while (bandTopY > yMin) {
    const run = longestDarkRunAtRow(bandTopY - 1);
    if (!run || run.widthPx < minAcceptWidthPx) break;
    bandTopY--;
  }

  let bandBotY = bestRow.y;
  while (bandBotY < yMax) {
    const run = longestDarkRunAtRow(bandBotY + 1);
    if (!run || run.widthPx < minAcceptWidthPx) break;
    bandBotY++;
  }

  const bandMidY = (bandTopY + bandBotY) / 2;
  const bandHeightPx = bandBotY - bandTopY + 1;

  if (bandHeightPx < Math.max(4, Math.round(2.5 / psY))) {
    throw new Error('La franja central detectada es demasiado estrecha.');
  }

  // Recalcular extremos horizontales de la banda con mediana robusta
  const x0s = [];
  const x1s = [];
  for (let y = bandTopY; y <= bandBotY; y++) {
    const run = longestDarkRunAtRow(y);
    if (run && run.widthPx >= minAcceptWidthPx) {
      x0s.push(run.x0);
      x1s.push(run.x1);
    }
  }

  const bandX0 = Math.round(quantile(x0s, 0.5));
  const bandX1 = Math.round(quantile(x1s, 0.5));

  // 3) Definir dos ROI dentro de la propia franja
  const innerMarginYPx = Math.max(1, Math.round(0.6 / psY));
  const innerMarginXPx = Math.max(1, Math.round(2.0 / psX));

  const usableTop = bandTopY + innerMarginYPx;
  const usableBot = bandBotY - innerMarginYPx;

  if (usableBot - usableTop < 3) {
    throw new Error('No hay altura suficiente dentro de la franja para colocar las dos ROI.');
  }

  const halfMid = (usableTop + usableBot) / 2;
  const rectHalfHeightPx = Math.max(1, Math.round(0.9 / psY));

  const topRect = {
    x0: bandX0 + innerMarginXPx,
    x1: bandX1 - innerMarginXPx,
    y0: Math.max(0, Math.round((usableTop + halfMid) / 2 - rectHalfHeightPx)),
    y1: Math.min(img.rows - 1, Math.round((usableTop + halfMid) / 2 + rectHalfHeightPx))
  };

  const botRect = {
    x0: bandX0 + innerMarginXPx,
    x1: bandX1 - innerMarginXPx,
    y0: Math.max(0, Math.round((halfMid + usableBot) / 2 - rectHalfHeightPx)),
    y1: Math.min(img.rows - 1, Math.round((halfMid + usableBot) / 2 + rectHalfHeightPx))
  };

  if (topRect.x1 <= topRect.x0 || botRect.x1 <= botRect.x0) {
    throw new Error('Las ROI del espesor de corte han quedado inválidas.');
  }

  const topRaw = meanProfileXInRect(
    img.data, img.rows, img.cols,
    topRect.x0, topRect.x1, topRect.y0, topRect.y1
  );
  const botRaw = meanProfileXInRect(
    img.data, img.rows, img.cols,
    botRect.x0, botRect.x1, botRect.y0, botRect.y1
  );

  const topProfile = smooth1d(topRaw.profile, 2);
  const botProfile = smooth1d(botRaw.profile, 2);

  let topWidth = findFwhmBounds(topProfile, topRaw.xs);
  let botWidth = findFwhmBounds(botProfile, botRaw.xs);

  if (!topWidth) topWidth = findProfileWidthByThreshold(topProfile, topRaw.xs, 0.5);
  if (!botWidth) botWidth = findProfileWidthByThreshold(botProfile, botRaw.xs, 0.5);

  if (!topWidth || !botWidth) {
    throw new Error('No se han podido medir las dos rampas dentro de la franja central.');
  }

  const topMm = topWidth.widthPx * psX;
  const botMm = botWidth.widthPx * psX;
  const sliceThicknessMm = 0.2 * (topMm * botMm) / (topMm + botMm);
  const roiDisplayPadPx = Math.max(2, Math.round(2.5 / psX));

  // La ROI real es ancha para estabilizar el perfil en X; en la imagen
  // mostramos una guía ceñida a la anchura medida para que la lectura sea clara.
  const topDisplayRect = {
    x0: Math.max(topRect.x0, Math.floor(topWidth.left - roiDisplayPadPx)),
    x1: Math.min(topRect.x1, Math.ceil(topWidth.right + roiDisplayPadPx)),
    y0: topRect.y0,
    y1: topRect.y1
  };

  const botDisplayRect = {
    x0: Math.max(botRect.x0, Math.floor(botWidth.left - roiDisplayPadPx)),
    x1: Math.min(botRect.x1, Math.ceil(botWidth.right + roiDisplayPadPx)),
    y0: botRect.y0,
    y1: botRect.y1
  };

  const expectedMm = img.sliceThickness > 0 ? img.sliceThickness : 5.0;
  const toleranceMm = 0.7;
  const failMm = 1.0;
  const errAbs = Math.abs(sliceThicknessMm - expectedMm);
  const pass = errAbs <= toleranceMm;
  const acceptable = errAbs <= failMm;
  const exportData = {
    sliceThicknessMm,
    expectedMm,
    toleranceMm,
    failMm,
    topMm,
    bottomMm: botMm,
    bandHeightMm: bandHeightPx * psY
  };

  return {
    exportKey: 'slice_thickness_slice_1',
    name: 'Espesor de corte — slice 1',
    pass,
    exportData,
    warn: !pass && acceptable,
    metrics: {
      'Espesor medido': `${sliceThicknessMm.toFixed(2)} mm`,
      'Esperado': `${expectedMm.toFixed(1)} mm ± ${toleranceMm.toFixed(1)}`,
      'Rampa superior': `${topMm.toFixed(2)} mm`,
      'Rampa inferior': `${botMm.toFixed(2)} mm`,
      'Franja central': `${(bandHeightPx * psY).toFixed(2)} mm`,
      'Método': 'Detección por banda horizontal más larga'
    },
    overlay: (ctx) => {
      drawRect(
        ctx,
        bandX0 + 0.5,
        bandTopY + 0.5,
        bandX1 - bandX0,
        bandBotY - bandTopY,
        'rgba(255,77,77,0.9)',
        1.25
      );

      drawBracketRect(
        ctx,
        topDisplayRect.x0 + 0.5,
        topDisplayRect.y0 + 0.5,
        topDisplayRect.x1 - topDisplayRect.x0,
        topDisplayRect.y1 - topDisplayRect.y0,
        '#00c8ff',
        1
      );

      drawBracketRect(
        ctx,
        botDisplayRect.x0 + 0.5,
        botDisplayRect.y0 + 0.5,
        botDisplayRect.x1 - botDisplayRect.x0,
        botDisplayRect.y1 - botDisplayRect.y0,
        '#00ff88',
        1
      );

      const yTop = Math.round((topRect.y0 + topRect.y1) / 2) - 1 + 0.5;
      const yBot = Math.round((botRect.y0 + botRect.y1) / 2) + 1 + 0.5;

      drawLine(ctx, topWidth.left, yTop, topWidth.right, yTop, '#00c8ff', 2);
      drawLine(ctx, botWidth.left, yBot, botWidth.right, yBot, '#00ff88', 2);

      drawCross(ctx, (bandX0 + bandX1) / 2, bandMidY, 5, '#f1c40f');
    },
    plot: (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);

      const all = [...topProfile, ...botProfile];
      const minV = Math.min(...all);
      const maxV = Math.max(...all);
      const pad = 28;

      const mapX = (i, n) => pad + (w - 2 * pad) * (i / Math.max(1, n - 1));
      const mapY = (v) => h - pad - (h - 2 * pad) * ((v - minV) / Math.max(1e-9, maxV - minV));

      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, h - pad);
      ctx.lineTo(w - pad, h - pad);
      ctx.moveTo(pad, pad);
      ctx.lineTo(pad, h - pad);
      ctx.stroke();

      ctx.strokeStyle = '#00c8ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < topProfile.length; i++) {
        const x = mapX(i, topProfile.length);
        const y = mapY(topProfile[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < botProfile.length; i++) {
        const x = mapX(i, botProfile.length);
        const y = mapY(botProfile[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    img
  };
}




function testSlicePosition_legacy(img, sliceLabel) {
  const mask = createPhantomMask(img);
  const geom = phantomGeometry(mask, img);
  const waterMean = waterMeanInside(img, mask);

  const psY = img.pixelSpacing[0];
  const psX = img.pixelSpacing[1];

  const searchW = Math.max(12, Math.round(18 / psX));
  const x0 = Math.max(0, Math.floor(geom.cx - searchW));
  const x1 = Math.min(img.cols - 1, Math.ceil(geom.cx + searchW));

  const isSlice11 = /\b11\b/.test(String(sliceLabel));
  const exportKey = `slice_position_${slugifyExportPart(sliceLabel)}`;

  function fitLineXofY(points) {
    const n = points.length;
    let sumY = 0;
    let sumX = 0;
    let sumYY = 0;
    let sumYX = 0;

    for (const p of points) {
      sumY += p.y;
      sumX += p.x;
      sumYY += p.y * p.y;
      sumYX += p.y * p.x;
    }

    const denom = n * sumYY - sumY * sumY;
    const a = Math.abs(denom) < 1e-12 ? 0 : (n * sumYX - sumY * sumX) / denom;
    const b = (sumX - a * sumY) / n;

    return { a, b };
  }

  function buildWindow(anchor) {
    if (anchor === 'bottom') {
      return {
        anchor,
        ySearch0: Math.max(0, Math.floor(geom.yMin + 4 / psY)),
        ySearch1: Math.min(img.rows - 1, Math.floor(geom.yMin + 32 / psY)),
        yBox0: Math.max(0, Math.floor(geom.yMin + 2 / psY)),
        yBox1: Math.min(img.rows - 1, Math.floor(geom.yMin + 42 / psY))
      };
    }

    return {
      anchor: 'top',
      ySearch0: Math.max(0, Math.floor(geom.yMin + 4 / psY)),
      ySearch1: Math.min(img.rows - 1, Math.floor(geom.yMin + 32 / psY)),
      yBox0: Math.max(0, Math.floor(geom.yMin + 2 / psY)),
      yBox1: Math.min(img.rows - 1, Math.floor(geom.yMin + 42 / psY))
    };
  }

  function longestDarkRunAtRow(y) {
    const row = [];
    for (let x = x0; x <= x1; x++) {
      row.push(img.data[y * img.cols + x]);
    }

    const smoothRow = smooth1d(row, Math.max(1, Math.round(1.0 / psX)));
    const darkThr = waterMean * 0.82;

    let best = null;
    let runStart = -1;

    for (let i = 0; i < smoothRow.length; i++) {
      const dark = smoothRow[i] < darkThr;

      if (dark) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        const runEnd = i - 1;
        const widthPx = runEnd - runStart + 1;

        if (!best || widthPx > best.widthPx) {
          best = {
            i0: runStart,
            i1: runEnd,
            widthPx
          };
        }
        runStart = -1;
      }
    }

    if (runStart >= 0) {
      const runEnd = smoothRow.length - 1;
      const widthPx = runEnd - runStart + 1;
      if (!best || widthPx > best.widthPx) {
        best = {
          i0: runStart,
          i1: runEnd,
          widthPx
        };
      }
    }

    if (!best) return null;

    const minWidthPx = Math.max(5, Math.round(5 / psX));
    const maxWidthPx = Math.max(minWidthPx + 2, Math.round(22 / psX));

    if (best.widthPx < minWidthPx || best.widthPx > maxWidthPx) return null;

    let darkMean = 0;
    for (let i = best.i0; i <= best.i1; i++) darkMean += smoothRow[i];
    darkMean /= Math.max(1, best.widthPx);

    return {
      xL: x0 + best.i0,
      xR: x0 + best.i1,
      widthPx: best.widthPx,
      darkMean
    };
  }

  function detectInsert(win) {
    const leftPts = [];
    const rightPts = [];
    let widthSum = 0;
    let darkSum = 0;
    let count = 0;

    for (let y = win.ySearch0; y <= win.ySearch1; y++) {
      if (y < 1 || y >= img.rows - 1) continue;

      const run = longestDarkRunAtRow(y);
      if (!run) continue;

      leftPts.push({ x: run.xL, y });
      rightPts.push({ x: run.xR, y });
      widthSum += run.widthPx;
      darkSum += run.darkMean;
      count++;
    }

    if (leftPts.length < 8 || rightPts.length < 8) return null;

    const leftWall = fitLineXofY(leftPts);
    const rightWall = fitLineXofY(rightPts);

    return {
      anchor: win.anchor,
      yBox0: win.yBox0,
      yBox1: win.yBox1,
      leftWall,
      rightWall,
      meanWidthPx: widthSum / count,
      meanDark: darkSum / count,
      score: darkSum / count
    };
  }

  const primary = detectInsert(buildWindow(isSlice11 ? 'bottom' : 'top'));
  const secondary = detectInsert(buildWindow(isSlice11 ? 'top' : 'bottom'));

  const insert = primary || secondary;

  if (!insert) {
    return {
      exportKey,
      name: `Posición de corte — ${sliceLabel}`,
      pass: false,
      error: true,
      message: 'No se pudo localizar el inserto de posición de corte.'
    };
  }

  const anchor = insert.anchor;
  const yStartBox = insert.yBox0;
  const yEndBox = insert.yBox1;

  let commonA = 0.5 * (insert.leftWall.a + insert.rightWall.a);
  const maxAbsSlope = 0.18;
  if (commonA > maxAbsSlope) commonA = maxAbsSlope;
  if (commonA < -maxAbsSlope) commonA = -maxAbsSlope;

  const yRef = 0.5 * (yStartBox + yEndBox);

  function xWallL(y) {
    return insert.leftWall.a * y + insert.leftWall.b;
  }

  function xWallR(y) {
    return insert.rightWall.a * y + insert.rightWall.b;
  }

  function xInsideAtFrac(y, frac) {
    const xl = xWallL(y);
    const xr = xWallR(y);
    return xl + frac * (xr - xl);
  }

  const fracL = 0.32;
  const fracR = 0.68;

  function sampleProfileAlongInsert(frac) {
    const profile = [];
    const nNorm = Math.hypot(1, commonA);
    const nx = 1 / nNorm;
    const ny = -commonA / nNorm;

    for (let y = yStartBox; y <= yEndBox; y++) {
      const xc = xInsideAtFrac(y, frac);

      let sum = 0;
      let n = 0;

      for (let t = -1; t <= 1; t++) {
        const xx = xc + t * nx;
        const yy = y + t * ny;

        if (xx < 1 || xx >= img.cols - 2 || yy < 1 || yy >= img.rows - 2) continue;

        sum += bilinear(img.data, img.rows, img.cols, xx, yy);
        n++;
      }

      profile.push(n > 0 ? sum / n : waterMean);
    }

    return smooth1d(profile, 1);
  }

  function findStrongEdge(profile, anchorMode) {
    if (!profile || profile.length < 5) return null;

    const n = profile.length;
    const i0 = anchorMode === 'top' ? Math.floor(0.35 * n) : 1;
    const i1 = anchorMode === 'top' ? n - 2 : Math.ceil(0.65 * n);

    let bestIdx = -1;
    let bestAbsGrad = -Infinity;

    for (let i = i0; i <= i1; i++) {
      const grad = profile[i + 1] - profile[i - 1];
      const absGrad = Math.abs(grad);

      if (absGrad > bestAbsGrad) {
        bestAbsGrad = absGrad;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) return null;
    if (bestAbsGrad < Math.max(1e-6, 0.03 * Math.abs(waterMean))) return null;

    const yCross = yStartBox + bestIdx;
    const xCross = xInsideAtFrac(yCross, anchorMode === 'top' ? fracL : fracL);

    return {
      idx: bestIdx,
      absGrad: bestAbsGrad,
      yCross
    };
  }

  const profL = sampleProfileAlongInsert(fracL);
  const profR = sampleProfileAlongInsert(fracR);

  const edgeL = findStrongEdge(profL, anchor);
  const edgeR = findStrongEdge(profR, anchor);

  if (!edgeL || !edgeR) {
    return {
      name: `Posición de corte — ${sliceLabel}`,
      pass: false,
      error: true,
      message: 'No se pudo detectar el borde útil dentro del inserto.'
    };
  }
  const stepMm = Math.hypot(psY, commonA * psX);
  const diffMm = (edgeR.idx - edgeL.idx) * stepMm;
  const absOff = Math.abs(diffMm);
  const pass = absOff <= 5.0;
  const warnLcd = absOff > 4.0;
  const exportData = {
    sliceLabel,
    anchor,
    leftYpx: edgeL.yCross,
    rightYpx: edgeR.yCross,
    diffMm,
    absDiffMm: absOff,
    angleDeg: Math.atan2(commonA * psX, psY) * 180 / Math.PI,
    passLimitMm: 5.0,
    lcdLimitMm: 4.0
  };

  const yAnchorLine = anchor === 'top' ? yStartBox : yEndBox;

  const xAnchorL = xInsideAtFrac(yAnchorLine, fracL);
  const xAnchorR = xInsideAtFrac(yAnchorLine, fracR);

  const xCrossL = xInsideAtFrac(edgeL.yCross, fracL);
  const xCrossR = xInsideAtFrac(edgeR.yCross, fracR);

  const nNorm = Math.hypot(1, commonA);
  const nx = 1 / nNorm;
  const ny = -commonA / nNorm;

  return {
    name: `Posición de corte — ${sliceLabel}`,
    pass,
    exportData,
    warn: pass && warnLcd,
    metrics: {
      'Anclaje': anchor === 'top' ? 'Superior' : 'Inferior',
      'Pos. línea izquierda': `y = ${edgeL.yCross.toFixed(1)} px`,
      'Pos. línea derecha': `y = ${edgeR.yCross.toFixed(1)} px`,
      'Diferencia (R−L)': `${diffMm.toFixed(2)} mm`,
      'Ángulo inserto': `${(Math.atan2(commonA * psX, psY) * 180 / Math.PI).toFixed(2)} °`,
      'Límite paso/falla': '|Δ| ≤ 5.0 mm (≤ 4.0 mm no afecta LCD)'
    },
    overlay: (ctx) => {
      drawLine(ctx, xWallL(yStartBox), yStartBox, xWallL(yEndBox), yEndBox, 'rgba(255,255,255,0.55)', 1);
      drawLine(ctx, xWallR(yStartBox), yStartBox, xWallR(yEndBox), yEndBox, 'rgba(255,255,255,0.55)', 1);

      drawLine(ctx, xAnchorL, yAnchorLine, xCrossL, edgeL.yCross, '#3498db', 2);
      drawLine(ctx, xAnchorR, yAnchorLine, xCrossR, edgeR.yCross, '#27ae60', 2);

      drawLine(ctx, xCrossL - 5 * nx, edgeL.yCross - 5 * ny, xCrossL + 5 * nx, edgeL.yCross + 5 * ny, '#e74c3c', 2);
      drawLine(ctx, xCrossR - 5 * nx, edgeR.yCross - 5 * ny, xCrossR + 5 * nx, edgeR.yCross + 5 * ny, '#e74c3c', 2);

      drawCross(ctx, 0.5 * (xCrossL + xCrossR), 0.5 * (edgeL.yCross + edgeR.yCross), 5, '#f1c40f');
    },
    plot: (pctx, pW, pH) => {
      drawProfilePlot(pctx, pW, pH, {
        title: `Perfiles en el inserto — |Δ| = ${absOff.toFixed(2)} mm`,
        xLabel: 'muestras a lo largo del inserto',
        series: [
          { data: profL, color: '#3498db', label: `Izq (${edgeL.yCross.toFixed(1)} px)` },
          { data: profR, color: '#27ae60', label: `Der (${edgeR.yCross.toFixed(1)} px)` }
        ],
        markers: [
          { x: edgeL.idx, color: '#3498db' },
          { x: edgeR.idx, color: '#27ae60' }
        ]
      });
    },
    img
  };
}




function testSlicePosition(img, sliceLabel) {
  const mask = createPhantomMask(img);
  const geom = phantomGeometry(mask, img);
  const waterMean = waterMeanInside(img, mask);

  const psY = img.pixelSpacing[0];
  const psX = img.pixelSpacing[1];

  const searchW = Math.max(12, Math.round(18 / psX));
  const x0 = Math.max(0, Math.floor(geom.cx - searchW));
  const x1 = Math.min(img.cols - 1, Math.ceil(geom.cx + searchW));

  const isSlice11 = /\b11\b/.test(String(sliceLabel));

  function median(values) {
    return quantile(values, 0.5);
  }

  function medianAbsDeviation(values, med = median(values)) {
    if (!values.length || med === null) return 0;
    return median(values.map((v) => Math.abs(v - med))) || 0;
  }

  function fitLineXofY(points) {
    if (!points || points.length < 2) return null;

    const n = points.length;
    let sumY = 0;
    let sumX = 0;
    let sumYY = 0;
    let sumYX = 0;

    for (const p of points) {
      sumY += p.y;
      sumX += p.x;
      sumYY += p.y * p.y;
      sumYX += p.y * p.x;
    }

    const denom = n * sumYY - sumY * sumY;
    const a = Math.abs(denom) < 1e-12 ? 0 : (n * sumYX - sumY * sumX) / denom;
    const b = (sumX - a * sumY) / n;

    return { a, b };
  }

  function theilSenSlope(points) {
    if (!points || points.length < 2) return null;

    const slopes = [];
    for (let i = 0; i < points.length - 1; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dy = points[j].y - points[i].y;
        if (Math.abs(dy) < 1e-6) continue;
        slopes.push((points[j].x - points[i].x) / dy);
      }
    }

    return slopes.length ? median(slopes) : 0;
  }

  function fitRobustTrack(points) {
    if (!points || points.length < 4) return null;

    let a = theilSenSlope(points);
    if (!Number.isFinite(a)) a = 0;

    let b = median(points.map((p) => p.x - a * p.y));
    let inliers = [...points];

    for (let iter = 0; iter < 2; iter++) {
      const residuals = points.map((p) => p.x - (a * p.y + b));
      const mad = medianAbsDeviation(residuals);
      const tol = Math.max(0.8, 3.0 * 1.4826 * mad);
      inliers = points.filter((p, idx) => Math.abs(residuals[idx]) <= tol);
      if (inliers.length < 3) break;

      const refined = fitLineXofY(inliers);
      if (!refined) break;

      a = refined.a;
      b = median(inliers.map((p) => p.x - a * p.y));
    }

    return { a, b, inliers };
  }

  function buildWindow(anchor) {
    if (anchor === 'bottom') {
      return {
        anchor,
        ySearch0: Math.max(0, Math.floor(geom.yMin + 4 / psY)),
        ySearch1: Math.min(img.rows - 1, Math.floor(geom.yMin + 32 / psY)),
        yBox0: Math.max(0, Math.floor(geom.yMin + 2 / psY)),
        yBox1: Math.min(img.rows - 1, Math.floor(geom.yMin + 42 / psY))
      };
    }

    return {
      anchor: 'top',
      ySearch0: Math.max(0, Math.floor(geom.yMin + 4 / psY)),
      ySearch1: Math.min(img.rows - 1, Math.floor(geom.yMin + 32 / psY)),
      yBox0: Math.max(0, Math.floor(geom.yMin + 2 / psY)),
      yBox1: Math.min(img.rows - 1, Math.floor(geom.yMin + 42 / psY))
    };
  }

  function longestDarkRunAtRow(y) {
    const row = [];
    for (let x = x0; x <= x1; x++) row.push(img.data[y * img.cols + x]);

    const smoothRow = smooth1d(row, Math.max(1, Math.round(1.0 / psX)));

    /* Umbral LOCAL de la propia fila, no global. Con el filtro de uniformidad
       desactivado el agua de la parte alta del maniquí puede quedar muy por
       debajo de la media global (PIU ~76 %), de modo que un umbral
       waterMean*0.82 marcaba como "oscura" la banda superior entera y el
       inserto nunca se localizaba. Cada fila lleva agua e inserto, así que su
       propio nivel de agua es la referencia correcta. */
    const rowWater = quantile(smoothRow, 0.85);
    const rowDark = quantile(smoothRow, 0.05);
    if (rowWater === null || rowDark === null) return null;

    // Fila sin agua utilizable (p. ej. tapada por la burbuja de aire).
    if (rowWater < 0.45 * waterMean) return null;

    // Fila sin contraste suficiente: no hay inserto que separar del agua.
    if (rowWater - rowDark < 0.25 * rowWater) return null;

    const darkThr = rowWater * 0.82;

    let best = null;
    let runStart = -1;

    for (let i = 0; i < smoothRow.length; i++) {
      const dark = smoothRow[i] < darkThr;

      if (dark) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        const runEnd = i - 1;
        const widthPx = runEnd - runStart + 1;
        if (!best || widthPx > best.widthPx) best = { i0: runStart, i1: runEnd, widthPx };
        runStart = -1;
      }
    }

    if (runStart >= 0) {
      const runEnd = smoothRow.length - 1;
      const widthPx = runEnd - runStart + 1;
      if (!best || widthPx > best.widthPx) best = { i0: runStart, i1: runEnd, widthPx };
    }

    if (!best) return null;

    const minWidthPx = Math.max(5, Math.round(5 / psX));
    const maxWidthPx = Math.max(minWidthPx + 2, Math.round(22 / psX));
    if (best.widthPx < minWidthPx || best.widthPx > maxWidthPx) return null;

    let darkMean = 0;
    for (let i = best.i0; i <= best.i1; i++) darkMean += smoothRow[i];
    darkMean /= Math.max(1, best.widthPx);

    return {
      xL: x0 + best.i0,
      xR: x0 + best.i1,
      widthPx: best.widthPx,
      darkMean
    };
  }

  function detectInsert(win) {
    const rows = [];
    let widthSum = 0;
    let darkSum = 0;

    for (let y = win.ySearch0; y <= win.ySearch1; y++) {
      if (y < 1 || y >= img.rows - 1) continue;

      const run = longestDarkRunAtRow(y);
      if (!run) continue;

      rows.push({
        y,
        xL: run.xL,
        xR: run.xR,
        xC: 0.5 * (run.xL + run.xR),
        widthPx: run.widthPx,
        darkMean: run.darkMean
      });
      widthSum += run.widthPx;
      darkSum += run.darkMean;
    }

    if (rows.length < 8) return null;

    const leftPts = rows.map((r) => ({ x: r.xL, y: r.y }));
    const rightPts = rows.map((r) => ({ x: r.xR, y: r.y }));
    const centerPts = rows.map((r) => ({ x: r.xC, y: r.y }));

    const leftWall0 = fitRobustTrack(leftPts);
    const rightWall0 = fitRobustTrack(rightPts);
    const centerLine0 = fitRobustTrack(centerPts);
    if (!leftWall0 || !rightWall0 || !centerLine0) return null;

    const slopeCandidates = [leftWall0.a, rightWall0.a, centerLine0.a].filter(Number.isFinite);
    if (!slopeCandidates.length) return null;

    let commonA = median(slopeCandidates);
    const maxAbsSlope = 0.14;
    if (commonA > maxAbsSlope) commonA = maxAbsSlope;
    if (commonA < -maxAbsSlope) commonA = -maxAbsSlope;

    const leftB = median(leftPts.map((p) => p.x - commonA * p.y));
    const rightB = median(rightPts.map((p) => p.x - commonA * p.y));
    const centerB = median(centerPts.map((p) => p.x - commonA * p.y));
    const widthResiduals = rows.map((r) => (r.xR - r.xL) - (rightB - leftB));

    return {
      anchor: win.anchor,
      yBox0: win.yBox0,
      yBox1: win.yBox1,
      leftWall: { a: commonA, b: leftB },
      rightWall: { a: commonA, b: rightB },
      centerLine: { a: commonA, b: centerB },
      commonA,
      count: rows.length,
      meanWidthPx: widthSum / rows.length,
      meanDark: darkSum / rows.length,
      widthMad: medianAbsDeviation(widthResiduals),
      score: rows.length * 6 + widthSum / rows.length - 0.08 * darkSum / rows.length
    };
  }

  function chooseInsert(primary, secondary) {
    if (isSlice11) {
      return primary || secondary;
    }

    if (primary && secondary) {
      const primaryScore = primary.score + 2.5;
      return primaryScore >= secondary.score ? primary : secondary;
    }
    return primary || secondary;
  }

  const primary = detectInsert(buildWindow(isSlice11 ? 'bottom' : 'top'));
  const secondary = detectInsert(buildWindow(isSlice11 ? 'top' : 'bottom'));
  const insert = chooseInsert(primary, secondary);

  if (!insert) {
    return {
      name: `Posición de corte — ${sliceLabel}`,
      pass: false,
      error: true,
      message: 'No se pudo localizar el inserto de posición de corte.'
    };
  }

  const anchor = insert.anchor;
  const yStartBox = insert.yBox0;
  const yEndBox = insert.yBox1;
  const commonA = insert.commonA;

  function xWallL(y) {
    return commonA * y + insert.leftWall.b;
  }

  function xWallR(y) {
    return commonA * y + insert.rightWall.b;
  }

  function xCenter(y) {
    return commonA * y + insert.centerLine.b;
  }

  function xInsideAtFrac(y, frac) {
    const xl = xWallL(y);
    const xr = xWallR(y);
    return xl + frac * (xr - xl);
  }

  const fracL = 0.32;
  const fracR = 0.68;

  function sampleProfileAlongInsert(frac) {
    const profile = [];
    const nNorm = Math.hypot(1, commonA);
    const nx = 1 / nNorm;
    const ny = -commonA / nNorm;

    for (let y = yStartBox; y <= yEndBox; y++) {
      const xc = xInsideAtFrac(y, frac);

      let sum = 0;
      let n = 0;

      for (let s = -1; s <= 1; s++) {
        const xs = xc + 0.6 * s * commonA;
        const ys = y + 0.6 * s;

        for (let t = -1.5; t <= 1.5; t += 1.5) {
          const xx = xs + t * nx;
          const yy = ys + t * ny;

          if (xx < 1 || xx >= img.cols - 2 || yy < 1 || yy >= img.rows - 2) continue;

          sum += bilinear(img.data, img.rows, img.cols, xx, yy);
          n++;
        }
      }

      profile.push(n > 0 ? sum / n : waterMean);
    }

    return smooth1d(profile, 2);
  }

  function findStrongEdge(profile, anchorMode) {
    if (!profile || profile.length < 5) return null;

    const n = profile.length;
    if (isSlice11 && anchorMode === 'bottom') {
      const i0 = Math.max(1, Math.floor(0.30 * n));
      const i1 = Math.min(n - 2, Math.ceil(0.72 * n));
      const band = profile.slice(i0, i1 + 1);
      const base = quantile(band, 0.15) ?? Math.min(...band);
      const peak = quantile(band, 0.92) ?? Math.max(...band);
      const riseLevel = base + 0.30 * (peak - base);
      let riseIdx = null;

      for (let i = i0 + 1; i <= i1; i++) {
        if (profile[i - 1] < riseLevel && profile[i] >= riseLevel) {
          riseIdx = i;
          break;
        }
      }

      const posGrads = [];
      for (let i = i0; i <= i1; i++) {
        const grad = profile[i + 1] - profile[i - 1];
        if (grad > 0) posGrads.push(grad);
      }

      const gradFloor = quantile(posGrads, 0.65) || 0;
      const gradMin = Math.max(Math.abs(waterMean) * 0.015, gradFloor);
      const candidates = [];

      for (let i = i0; i <= i1; i++) {
        const grad = profile[i + 1] - profile[i - 1];
        if (grad < gradMin) continue;
        if (profile[i] < riseLevel) continue;

        const rel = (i - i0) / Math.max(1, i1 - i0);
        const score = grad * (1.20 - 0.35 * rel);
        candidates.push({ idx: i, absGrad: Math.abs(grad), score });
      }

      if (!candidates.length) return null;

      const clusters = [];
      let current = [candidates[0]];
      for (let k = 1; k < candidates.length; k++) {
        if (candidates[k].idx - candidates[k - 1].idx <= 2) current.push(candidates[k]);
        else {
          clusters.push(current);
          current = [candidates[k]];
        }
      }
      clusters.push(current);

      const firstCluster = clusters[0];
      let best = firstCluster[0];
      for (const c of firstCluster) {
        if (c.score > best.score) best = c;
      }

      const clusterStart = firstCluster[0].idx;
      const clusterEnd = firstCluster[firstCluster.length - 1].idx;
      let selectedIdx = best.idx;

      if (riseIdx !== null && riseIdx <= clusterEnd + 1) {
        selectedIdx = Math.max(clusterStart, riseIdx);
      } else {
        selectedIdx = clusterStart;
      }

      return {
        idx: selectedIdx,
        absGrad: best.absGrad,
        yCross: yStartBox + selectedIdx,
        debug: {
          mode: 'slice11-rise',
          searchI0: i0,
          searchI1: i1,
          riseLevel,
          riseIdx,
          clusterStart,
          clusterEnd,
          bestIdx: best.idx,
          selectedIdx
        }
      };
    }

    const i0 = Math.floor(0.22 * n);
    const i1 = n - 2;
    const absGrads = [];

    for (let i = i0; i <= i1; i++) {
      absGrads.push(Math.abs(profile[i + 1] - profile[i - 1]));
    }

    const gradFloor = quantile(absGrads, 0.7) || 0;
    const gradMin = Math.max(Math.abs(waterMean) * 0.02, gradFloor);
    let best = null;

    for (let i = i0; i <= i1; i++) {
      const grad = profile[i + 1] - profile[i - 1];
      const absGrad = Math.abs(grad);
      if (absGrad < gradMin) continue;

      const rel = (i - i0) / Math.max(1, i1 - i0);
      const score = absGrad * (0.85 + 0.30 * rel);

      if (!best || score > best.score) best = { idx: i, absGrad, score };
    }

    if (!best) return null;

    return {
      idx: best.idx,
      absGrad: best.absGrad,
      yCross: yStartBox + best.idx,
      debug: null
    };
  }

  function estimateRampRange(profile, edge) {
    if (!profile || profile.length < 5 || !edge || !Number.isFinite(edge.idx)) return null;

    const n = profile.length;
    const edgeIdx = Math.max(2, Math.min(n - 3, Math.round(edge.idx)));
    const baseBand = profile.slice(0, edgeIdx);
    const peakBand = profile.slice(edgeIdx + 1);

    if (baseBand.length < 3 || peakBand.length < 3) return null;

    const base = quantile(baseBand, 0.18) ?? Math.min(...baseBand);
    const peak = quantile(peakBand, 0.82) ?? Math.max(...peakBand);

    return {
      base,
      peak,
      amp: peak - base
    };
  }

  function findLevelCrossing(profile, level, seedIdx, anchorMode) {
    if (!profile || profile.length < 5 || !Number.isFinite(level) || !Number.isFinite(seedIdx)) return null;

    const n = profile.length;
    const i0 = isSlice11 && anchorMode === 'bottom'
      ? Math.max(1, Math.floor(0.28 * n))
      : Math.max(1, Math.floor(0.18 * n));
    const i1 = isSlice11 && anchorMode === 'bottom'
      ? Math.min(n - 1, Math.ceil(0.80 * n))
      : n - 1;

    let best = null;

    for (let i = i0; i <= i1; i++) {
      const v1 = profile[i - 1];
      const v2 = profile[i];
      const dv = v2 - v1;

      if (Math.abs(dv) < 1e-6) continue;
      if ((v1 - level) * (v2 - level) > 0) continue;
      if (dv <= 0) continue;

      const t = (level - v1) / dv;
      const clampedT = Math.max(0, Math.min(1, t));
      const idx = (i - 1) + clampedT;
      const dist = Math.abs(idx - seedIdx);
      const absGrad = Math.abs(dv);

      if (
        !best ||
        dist < best.dist - 1e-6 ||
        (Math.abs(dist - best.dist) <= 1e-6 && absGrad > best.absGrad)
      ) {
        best = { idx, dist, absGrad, i0, i1 };
      }
    }

    if (!best) return null;

    return {
      idx: best.idx,
      absGrad: best.absGrad,
      yCross: yStartBox + best.idx,
      debug: {
        mode: 'shared-level',
        searchI0: best.i0,
        searchI1: best.i1,
        level
      }
    };
  }

  function findSharedLevelEdges(profileL, profileR, anchorMode, seedL, seedR) {
    const rangeL = estimateRampRange(profileL, seedL);
    const rangeR = estimateRampRange(profileR, seedR);
    if (!rangeL || !rangeR) return null;

    let low = Math.max(rangeL.base, rangeR.base);
    let high = Math.min(rangeL.peak, rangeR.peak);
    const minAmp = 0.08 * Math.max(Math.abs(rangeL.amp), Math.abs(rangeR.amp), 1);

    if (!Number.isFinite(low) || !Number.isFinite(high) || high - low < minAmp) {
      low = 0.5 * (rangeL.base + rangeR.base);
      high = 0.5 * (rangeL.peak + rangeR.peak);
    }

    if (!Number.isFinite(low) || !Number.isFinite(high) || high - low < minAmp) return null;

    const levelFrac = 0.5;
    const level = low + levelFrac * (high - low);
    const crossL = findLevelCrossing(profileL, level, seedL.idx, anchorMode);
    const crossR = findLevelCrossing(profileR, level, seedR.idx, anchorMode);

    if (!crossL || !crossR) return null;

    return {
      mode: 'shared-half-height',
      levelFrac,
      level,
      low,
      high,
      left: {
        idx: crossL.idx,
        absGrad: crossL.absGrad,
        yCross: crossL.yCross,
        debug: {
          ...crossL.debug,
          levelFrac,
          low,
          high,
          seedIdx: seedL.idx
        }
      },
      right: {
        idx: crossR.idx,
        absGrad: crossR.absGrad,
        yCross: crossR.yCross,
        debug: {
          ...crossR.debug,
          levelFrac,
          low,
          high,
          seedIdx: seedR.idx
        }
      }
    };
  }

  const profL = sampleProfileAlongInsert(fracL);
  const profR = sampleProfileAlongInsert(fracR);
  const seedL = findStrongEdge(profL, anchor);
  const seedR = findStrongEdge(profR, anchor);

  if (!seedL || !seedR) {
    return {
      exportKey,
      name: `Posición de corte — ${sliceLabel}`,
      pass: false,
      error: true,
      message: 'No se pudo detectar el borde útil dentro del inserto.'
    };
  }

  const sharedLevel = findSharedLevelEdges(profL, profR, anchor, seedL, seedR);
  const edgeL = sharedLevel ? sharedLevel.left : seedL;
  const edgeR = sharedLevel ? sharedLevel.right : seedR;
  const measurementMethod = sharedLevel
    ? 'Cruce interpolado al 50% del rango comun'
    : 'Gradiente maximo (respaldo)';

  const stepMm = Math.hypot(psY, commonA * psX);
  const diffMm = (edgeR.idx - edgeL.idx) * stepMm;
  const absOff = Math.abs(diffMm);
  const pass = absOff <= 5.0;
  const warnLcd = absOff > 4.0;
  const exportData = {
    sliceLabel,
    anchor,
    leftYpx: edgeL.yCross,
    rightYpx: edgeR.yCross,
    diffMm,
    absDiffMm: absOff,
    angleDeg: Math.atan2(commonA * psX, psY) * 180 / Math.PI,
    validRows: insert.count,
    widthMadPx: insert.widthMad,
    method: measurementMethod,
    passLimitMm: 5.0,
    lcdLimitMm: 4.0
  };

  const yAnchorLine = anchor === 'top' ? yStartBox : yEndBox;
  const xAnchorL = xInsideAtFrac(yAnchorLine, fracL);
  const xAnchorR = xInsideAtFrac(yAnchorLine, fracR);
  const xCrossL = xInsideAtFrac(edgeL.yCross, fracL);
  const xCrossR = xInsideAtFrac(edgeR.yCross, fracR);
  const guidePadPx = Math.max(2, Math.round(2 / psY));
  const yGuideFar = anchor === 'bottom'
    ? Math.max(0, yStartBox - guidePadPx)
    : Math.min(img.rows - 1, yEndBox + guidePadPx);
  const xGuideL = xInsideAtFrac(yGuideFar, fracL);
  const xGuideR = xInsideAtFrac(yGuideFar, fracR);
  const riseYLeft = seedL.debug && Number.isFinite(seedL.debug.riseIdx) ? yStartBox + seedL.debug.riseIdx : null;
  const riseYRight = seedR.debug && Number.isFinite(seedR.debug.riseIdx) ? yStartBox + seedR.debug.riseIdx : null;
  const riseXLeft = riseYLeft !== null ? xInsideAtFrac(riseYLeft, fracL) : null;
  const riseXRight = riseYRight !== null ? xInsideAtFrac(riseYRight, fracR) : null;

  const nNorm = Math.hypot(1, commonA);
  const nx = 1 / nNorm;
  const ny = -commonA / nNorm;
  const leftStart = xWallL(yStartBox);
  const leftEnd = xWallL(yEndBox);
  const rightStart = xWallR(yStartBox);
  const rightEnd = xWallR(yEndBox);
  const boxRect = {
    x: Math.min(leftStart, leftEnd) - 4,
    y: yStartBox,
    w: Math.max(rightStart, rightEnd) - Math.min(leftStart, leftEnd) + 8,
    h: yEndBox - yStartBox
  };
  const metrics = {
    'Anclaje': anchor === 'top' ? 'Superior' : 'Inferior',
    'Ventana usada': `${Math.round(yStartBox)}-${Math.round(yEndBox)} px`,
    'Pos. línea izquierda': `y = ${edgeL.yCross.toFixed(1)} px`,
    'Pos. línea derecha': `y = ${edgeR.yCross.toFixed(1)} px`,
    'Diferencia (R-L)': `${diffMm.toFixed(2)} mm`,
    'Metodo perfil': measurementMethod,
    'Ángulo inserto': `${(Math.atan2(commonA * psX, psY) * 180 / Math.PI).toFixed(2)} °`,
    'Filas válidas inserto': `${insert.count}`,
    'Consistencia ancho': `MAD ${insert.widthMad.toFixed(2)} px`,
    'Límite paso/falla': '|Δ| <= 5.0 mm (<= 4.0 mm no afecta LCD)'
  };

  if (sharedLevel) {
    metrics['Nivel comun'] = `${sharedLevel.level.toFixed(1)} u`;
    metrics['Rango comun'] = `${sharedLevel.low.toFixed(1)}-${sharedLevel.high.toFixed(1)} u`;
  }

  if (seedL.debug && seedR.debug && seedL.debug.mode === 'slice11-rise' && seedR.debug.mode === 'slice11-rise') {
    metrics['Ref. subida izq'] = seedL.debug.riseIdx !== null ? `i = ${seedL.debug.riseIdx}` : 'no encontrada';
    metrics['Ref. subida der'] = seedR.debug.riseIdx !== null ? `i = ${seedR.debug.riseIdx}` : 'no encontrada';
    metrics['Clúster izq'] = `${seedL.debug.clusterStart}-${seedL.debug.clusterEnd}`;
    metrics['Clúster der'] = `${seedR.debug.clusterStart}-${seedR.debug.clusterEnd}`;
  }

  return {
    name: `Posición de corte — ${sliceLabel}`,
    pass,
    warn: pass && warnLcd,
    metrics,
    overlay: (ctx) => {
      drawRect(ctx, boxRect, null, null, null, 'rgba(241,196,15,0.55)', 1);
      drawLine(ctx, leftStart, yStartBox, leftEnd, yEndBox, 'rgba(255,255,255,0.55)', 1);
      drawLine(ctx, rightStart, yStartBox, rightEnd, yEndBox, 'rgba(255,255,255,0.55)', 1);
      drawLine(ctx, xCenter(yStartBox), yStartBox, xCenter(yEndBox), yEndBox, 'rgba(52,152,219,0.45)', 1);

      if (riseXLeft !== null) {
        drawLine(ctx, riseXLeft - 4, riseYLeft, riseXLeft + 4, riseYLeft, '#f39c12', 2);
        drawCross(ctx, riseXLeft, riseYLeft, 2.5, '#f39c12', 1.5);
      }
      if (riseXRight !== null) {
        drawLine(ctx, riseXRight - 4, riseYRight, riseXRight + 4, riseYRight, '#f39c12', 2);
        drawCross(ctx, riseXRight, riseYRight, 2.5, '#f39c12', 1.5);
      }

      if (anchor === 'bottom') {
        drawLine(ctx, xAnchorL, yAnchorLine, xGuideL, yGuideFar, '#3498db', 2);
        drawLine(ctx, xAnchorR, yAnchorLine, xGuideR, yGuideFar, '#27ae60', 2);
      } else {
        drawLine(ctx, xAnchorL, yAnchorLine, xCrossL, edgeL.yCross, '#3498db', 2);
        drawLine(ctx, xAnchorR, yAnchorLine, xCrossR, edgeR.yCross, '#27ae60', 2);
      }

      drawLine(ctx, xCrossL - 5 * nx, edgeL.yCross - 5 * ny, xCrossL + 5 * nx, edgeL.yCross + 5 * ny, '#e74c3c', 2);
      drawLine(ctx, xCrossR - 5 * nx, edgeR.yCross - 5 * ny, xCrossR + 5 * nx, edgeR.yCross + 5 * ny, '#e74c3c', 2);

      drawLine(ctx, xWallL(yAnchorLine), yAnchorLine, xWallR(yAnchorLine), yAnchorLine, 'rgba(241,196,15,0.9)', 1.5);
      drawCross(ctx, 0.5 * (xCrossL + xCrossR), 0.5 * (edgeL.yCross + edgeR.yCross), 5, '#f1c40f');
    },
    plot: (pctx, pW, pH) => {
      drawProfilePlot(pctx, pW, pH, {
        title: `Perfiles en el inserto - |Δ| = ${absOff.toFixed(2)} mm`,
        xLabel: 'muestras a lo largo del inserto',
        series: [
          { data: profL, color: '#3498db', label: `Izq (${edgeL.yCross.toFixed(1)} px)` },
          { data: profR, color: '#27ae60', label: `Der (${edgeR.yCross.toFixed(1)} px)` }
        ],
        horizontalLines: sharedLevel ? [
          { y: sharedLevel.level, color: '#e74c3c', label: '50% comun' }
        ] : [],
        markers: [
          { x: edgeL.idx, color: '#3498db' },
          { x: edgeR.idx, color: '#27ae60' },
          ...(seedL.debug && seedL.debug.riseIdx !== null ? [{ x: seedL.debug.riseIdx, color: '#f39c12' }] : []),
          ...(seedR.debug && seedR.debug.riseIdx !== null ? [{ x: seedR.debug.riseIdx, color: '#e67e22' }] : [])
        ]
      });
    },
    img
  };
}

function testPhantomEllipseFit(img, sliceLabel = 'slice 5', expectedDiameterMm = 165, toleranceMm = 2) {
  const fit = fitPhantomEllipse(img);

  if (!fit) {
    return {
      name: `Ajuste elíptico del borde — ${sliceLabel}`,
      pass: false,
      error: true,
      message: 'No se ha podido ajustar la elipse del borde del phantom.'
    };
  }

  const psX = fit.psX;
  const psY = fit.psY;
  const cxFit = fit.cx;
  const cyFit = fit.cy;
  const u = fit.u;
  const v = fit.v;
  const majorMm = fit.majorMm;
  const minorMm = fit.minorMm;
  const angleRad = fit.angleRad;

  const majorErr = majorMm - expectedDiameterMm;
  const minorErr = minorMm - expectedDiameterMm;
  const maxAbsErr = Math.max(Math.abs(majorErr), Math.abs(minorErr));
  const axisDiffMm = majorMm - minorMm;
  const eccentricity = fit.eccentricity;
  const pass = maxAbsErr <= toleranceMm;
  const excludeDeg = (fit.excludeHalfAngle * 180 / Math.PI).toFixed(1);

  return {
    name: `Ajuste elíptico del borde — ${sliceLabel}`,
    pass,
    warn: pass && axisDiffMm >= 1.0,
    metrics: {
      'Eje mayor': `${majorMm.toFixed(2)} mm`,
      'Eje menor': `${minorMm.toFixed(2)} mm`,
      'Δ eje mayor': `${majorErr.toFixed(2)} mm`,
      'Δ eje menor': `${minorErr.toFixed(2)} mm`,
      'Mayor − menor': `${axisDiffMm.toFixed(2)} mm`,
      'Excentricidad': eccentricity.toFixed(4),
      'Ángulo': `${(angleRad * 180 / Math.PI).toFixed(2)} °`,
      'Puntos de borde': `${fit.nUsed} / ${fit.nTotal}`,
      'Banda superior excluida': `${fit.excludeTopChordMm} mm (±${excludeDeg}°)`,
      'Esperado': `${expectedDiameterMm} mm ± ${toleranceMm}`
    },
    overlay: (ctx) => {
      // Puntos excluidos (banda superior, burbuja) en gris
      for (const p of fit.ptsExcluded) {
        drawCircle(ctx, p.x, p.y, 1.2, '#7f8c8d', 1);
      }
      // Outliers rechazados en naranja
      for (const p of fit.ptsOutlier) {
        drawCircle(ctx, p.x, p.y, 1.4, '#e67e22', 1);
      }
      // Puntos usados en el ajuste en amarillo
      for (const p of fit.ptsUsed) {
        drawCircle(ctx, p.x, p.y, 1.2, '#f1c40f', 1);
      }
      const ellipsePts = sampleEllipsePoints(cxFit, cyFit, u, v, majorMm, minorMm, psX, psY, 120);
      ctx.beginPath();
      for (let i = 0; i < ellipsePts.length; i++) {
        const p = ellipsePts[i];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const aMm = majorMm / 2;
      const bMm = minorMm / 2;
      const xMaj1 = cxFit - aMm * u[0] / psX;
      const yMaj1 = cyFit - aMm * u[1] / psY;
      const xMaj2 = cxFit + aMm * u[0] / psX;
      const yMaj2 = cyFit + aMm * u[1] / psY;
      const xMin1 = cxFit - bMm * v[0] / psX;
      const yMin1 = cyFit - bMm * v[1] / psY;
      const xMin2 = cxFit + bMm * v[0] / psX;
      const yMin2 = cyFit + bMm * v[1] / psY;
      drawLine(ctx, xMaj1, yMaj1, xMaj2, yMaj2, '#2ecc71', 2);
      drawLine(ctx, xMin1, yMin1, xMin2, yMin2, '#e74c3c', 2);
      drawCross(ctx, cxFit, cyFit, 5, '#ffffff');
    },
    img
  };
}

function testPelletGridDistortion(img, sliceLabel = 'slice 5') {
  const mask = createPhantomMask(img);
  const geom = phantomGeometry(mask, img);

  const psY = img.pixelSpacing[0];
  const psX = img.pixelSpacing[1];
  const ps = (psX + psY) / 2;

  const pitchMm = 40.0;
  const tolMm = 1.0;

  const roiHalfW = Math.round(55 / psX);
  const roiHalfH = Math.round(55 / psY);
  const roiCx = geom.cx;
  const roiCy = geom.cy;

  const x0 = Math.max(0, Math.floor(roiCx - roiHalfW));
  const x1 = Math.min(img.cols - 1, Math.ceil(roiCx + roiHalfW));
  const y0 = Math.max(0, Math.floor(roiCy - roiHalfH));
  const y1 = Math.min(img.rows - 1, Math.ceil(roiCy + roiHalfH));

  const innerRpx = 2.5 / ps;
  const ringInRpx = 4.0 / ps;
  const ringOutRpx = 7.0 / ps;

  const innerOffsets = buildDiskOffsets(innerRpx);
  const outerOffsets = buildDiskOffsets(ringOutRpx);
  const ringOffsets = outerOffsets.filter(([dx, dy]) => {
    const r2 = dx * dx + dy * dy;
    return r2 >= ringInRpx * ringInRpx && r2 <= ringOutRpx * ringOutRpx;
  });

  const response = new Float32Array(img.rows * img.cols);
  const polarity = new Int8Array(img.rows * img.cols);

  function localContrastAt(x, y) {
    let sIn = 0;
    let nIn = 0;
    let sRing = 0;
    let nRing = 0;
    let ringInside = 0;

    for (const [dx, dy] of innerOffsets) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || xx >= img.cols || yy < 0 || yy >= img.rows) continue;
      sIn += img.data[yy * img.cols + xx];
      nIn++;
    }

    for (const [dx, dy] of ringOffsets) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || xx >= img.cols || yy < 0 || yy >= img.rows) continue;
      const idx = yy * img.cols + xx;
      sRing += img.data[idx];
      nRing++;
      if (mask[idx]) ringInside++;
    }

    if (nIn < 0.8 * innerOffsets.length) return null;
    if (nRing < 0.8 * ringOffsets.length) return null;
    if (ringInside < 0.7 * nRing) return null;

    const meanIn = sIn / nIn;
    const meanRing = sRing / nRing;
    return {
      score: Math.abs(meanIn - meanRing),
      pol: meanIn >= meanRing ? 1 : -1
    };
  }

  const responseVals = [];
  const margin = Math.ceil(ringOutRpx) + 2;

  for (let y = Math.max(y0 + margin, 1); y <= Math.min(y1 - margin, img.rows - 2); y++) {
    for (let x = Math.max(x0 + margin, 1); x <= Math.min(x1 - margin, img.cols - 2); x++) {
      const idx = y * img.cols + x;
      if (!mask[idx]) continue;
      const lc = localContrastAt(x, y);
      if (!lc) continue;
      response[idx] = lc.score;
      polarity[idx] = lc.pol;
      responseVals.push(lc.score);
    }
  }

  if (responseVals.length < 50) {
    return {
      name: `Distorsión por matriz de perdigones — ${sliceLabel}`,
      pass: false,
      error: true,
      message: 'No se ha podido construir un mapa de contraste local útil en la ROI central.'
    };
  }

  let meanResp = 0;
  for (const v of responseVals) meanResp += v;
  meanResp /= responseVals.length;

  let varResp = 0;
  for (const v of responseVals) {
    const d = v - meanResp;
    varResp += d * d;
  }
  const stdResp = Math.sqrt(varResp / responseVals.length);

  function collectRawPeaks(threshold) {
    const out = [];
    for (let y = Math.max(y0 + margin, 1); y <= Math.min(y1 - margin, img.rows - 2); y++) {
      for (let x = Math.max(x0 + margin, 1); x <= Math.min(x1 - margin, img.cols - 2); x++) {
        const idx = y * img.cols + x;
        const v = response[idx];
        if (v < threshold) continue;

        let isMax = true;
        for (let yy = y - 1; yy <= y + 1 && isMax; yy++) {
          for (let xx = x - 1; xx <= x + 1; xx++) {
            if (xx === x && yy === y) continue;
            if (response[yy * img.cols + xx] > v) {
              isMax = false;
              break;
            }
          }
        }

        if (isMax) {
          out.push({ x, y, score: v, pol: polarity[idx] });
        }
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  let rawPeaks = collectRawPeaks(meanResp + 1.25 * stdResp);
  if (rawPeaks.length < 9) rawPeaks = collectRawPeaks(meanResp + 0.75 * stdResp);
  if (rawPeaks.length < 9) rawPeaks = collectRawPeaks(meanResp + 0.35 * stdResp);

  const minSepPx = 8.0 / ps;
  const candidates = [];

  function refinePeak(px, py) {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sp = 0;
    for (let y = py - 2; y <= py + 2; y++) {
      if (y < 0 || y >= img.rows) continue;
      for (let x = px - 2; x <= px + 2; x++) {
        if (x < 0 || x >= img.cols) continue;
        const w = Math.max(response[y * img.cols + x], 0);
        if (w <= 0) continue;
        sw += w;
        sx += w * x;
        sy += w * y;
        sp += w * polarity[y * img.cols + x];
      }
    }
    return {
      cx: sw > 0 ? sx / sw : px,
      cy: sw > 0 ? sy / sw : py,
      score: response[py * img.cols + px],
      pol: sp >= 0 ? 1 : -1
    };
  }

  for (const p of rawPeaks) {
    let tooClose = false;
    for (const c of candidates) {
      const dx = p.x - c.cx;
      const dy = p.y - c.cy;
      if (Math.hypot(dx, dy) < minSepPx) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    candidates.push(refinePeak(p.x, p.y));
    if (candidates.length >= 24) break;
  }

  if (candidates.length < 7) {
    return {
      name: `Distorsión por matriz de perdigones — ${sliceLabel}`,
      pass: false,
      error: true,
      message: `No se han detectado suficientes picos candidatos (${candidates.length}).`
    };
  }

  const centerCandidates = [...candidates]
    .sort((a, b) => {
      const da = (a.cx - roiCx) * (a.cx - roiCx) + (a.cy - roiCy) * (a.cy - roiCy);
      const db = (b.cx - roiCx) * (b.cx - roiCx) + (b.cy - roiCy) * (b.cy - roiCy);
      return da - db;
    })
    .slice(0, Math.min(8, candidates.length));

  const nodeDefs = [
    { key: 'TL', i: -1, j: -1 },
    { key: 'TC', i: 0, j: -1 },
    { key: 'TR', i: 1, j: -1 },
    { key: 'CL', i: -1, j: 0 },
    { key: 'CC', i: 0, j: 0 },
    { key: 'CR', i: 1, j: 0 },
    { key: 'BL', i: -1, j: 1 },
    { key: 'BC', i: 0, j: 1 },
    { key: 'BR', i: 1, j: 1 }
  ];

  function normalizeVec(vx, vy) {
    const n = Math.hypot(vx, vy);
    if (n === 0) return null;
    return [vx / n, vy / n];
  }

  function fitHypothesis(center, ux, uy, vx, vy, orthoErrDeg, d1, d2) {
    const assigned = [];
    const used = new Set();
    const gateMm = 10.0;

    for (const node of nodeDefs) {
      const offXm = node.i * pitchMm * ux + node.j * pitchMm * vx;
      const offYm = node.i * pitchMm * uy + node.j * pitchMm * vy;
      const xIdeal = center.cx + offXm / psX;
      const yIdeal = center.cy + offYm / psY;

      if (node.key === 'CC') {
        assigned.push({
          ...node,
          c: center,
          xIdeal,
          yIdeal,
          observedX: center.cx,
          observedY: center.cy,
          dxMm: 0,
          dyMm: 0,
          distMm: 0
        });
        used.add(center);
        continue;
      }

      let best = null;
      for (const c of candidates) {
        if (used.has(c)) continue;
        const dxMm = (c.cx - xIdeal) * psX;
        const dyMm = (c.cy - yIdeal) * psY;
        const distMm = Math.hypot(dxMm, dyMm);
        if (!best || distMm < best.distMm) {
          best = {
            c,
            observedX: c.cx,
            observedY: c.cy,
            dxMm,
            dyMm,
            distMm,
            xIdeal,
            yIdeal
          };
        }
      }

      if (best && best.distMm <= gateMm) {
        assigned.push({ ...node, ...best });
        used.add(best.c);
      } else {
        assigned.push({
          ...node,
          c: null,
          xIdeal,
          yIdeal,
          observedX: null,
          observedY: null,
          dxMm: null,
          dyMm: null,
          distMm: null
        });
      }
    }

    const valid = assigned.filter(a => a.c);
    const validNonCenter = assigned.filter(a => a.c && a.key !== 'CC');
    const matched = valid.length;
    const missing = 9 - matched;
    if (validNonCenter.length === 0) return null;

    const maxErr = Math.max(...validNonCenter.map(a => a.distMm));
    const rmsErr = Math.sqrt(validNonCenter.reduce((s, a) => s + a.distMm * a.distMm, 0) / validNonCenter.length);

    const pitchPenalty = Math.abs(d1 - pitchMm) + Math.abs(d2 - pitchMm);
    const score = matched * 100 - missing * 60 - rmsErr * 12 - maxErr * 6 - orthoErrDeg * 2 - pitchPenalty;

    return {
      center,
      ux,
      uy,
      vx,
      vy,
      theta: Math.atan2(uy, ux),
      orthoErrDeg,
      assigned,
      matched,
      missing,
      maxErr,
      rmsErr,
      score
    };
  }

  let bestHyp = null;

  for (const center of centerCandidates) {
    const neigh = candidates
      .filter(c => c !== center)
      .map(c => {
        const dxMm = (c.cx - center.cx) * psX;
        const dyMm = (c.cy - center.cy) * psY;
        const dMm = Math.hypot(dxMm, dyMm);
        return { c, dxMm, dyMm, dMm };
      })
      .filter(v => v.dMm >= 25 && v.dMm <= 65)
      .sort((a, b) => Math.abs(a.dMm - pitchMm) - Math.abs(b.dMm - pitchMm))
      .slice(0, 12);

    for (let i = 0; i < neigh.length; i++) {
      for (let j = i + 1; j < neigh.length; j++) {
        const n1 = neigh[i];
        const n2 = neigh[j];

        const u0 = normalizeVec(n1.dxMm, n1.dyMm);
        const w0 = normalizeVec(n2.dxMm, n2.dyMm);
        if (!u0 || !w0) continue;

        const dot0 = u0[0] * w0[0] + u0[1] * w0[1];
        const angDeg = Math.acos(Math.min(1, Math.abs(dot0))) * 180 / Math.PI;
        const orthoErrDeg = Math.abs(90 - angDeg);

        if (orthoErrDeg > 20) continue;
        if (Math.abs(n1.dMm - pitchMm) > 18) continue;
        if (Math.abs(n2.dMm - pitchMm) > 18) continue;

        let ux = u0[0];
        let uy = u0[1];
        const proj = w0[0] * ux + w0[1] * uy;
        let vx = w0[0] - proj * ux;
        let vy = w0[1] - proj * uy;
        const vn = Math.hypot(vx, vy);
        if (vn < 0.25) continue;
        vx /= vn;
        vy /= vn;

        if (Math.abs(vx) > Math.abs(ux)) {
          const tux = ux;
          const tuy = uy;
          ux = vx;
          uy = vy;
          vx = tux;
          vy = tuy;
        }

        if (ux < 0) {
          ux = -ux;
          uy = -uy;
        }
        if (vy < 0) {
          vx = -vx;
          vy = -vy;
        }

        const hyp = fitHypothesis(center, ux, uy, vx, vy, orthoErrDeg, n1.dMm, n2.dMm);
        if (!hyp) continue;

        if (!bestHyp || hyp.score > bestHyp.score || (hyp.score === bestHyp.score && hyp.rmsErr < bestHyp.rmsErr)) {
          bestHyp = hyp;
        }
      }
    }
  }

  if (!bestHyp) {
    return {
      name: `Distorsión por matriz de perdigones — ${sliceLabel}`,
      pass: false,
      error: true,
      message: 'No se ha podido ajustar una rejilla 3×3 estable a los candidatos detectados.'
    };
  }

  if (bestHyp.matched < 8) {
    return {
      name: `Distorsión por matriz de perdigones — ${sliceLabel}`,
      pass: false,
      error: true,
      message: `La mejor hipótesis de rejilla solo ha asignado ${bestHyp.matched}/9 nodos.`
    };
  }

  const valid = bestHyp.assigned.filter(a => a.c && a.key !== 'CC');
  const card = valid.filter(a => ['TC', 'CL', 'CR', 'BC'].includes(a.key));
  const diag = valid.filter(a => ['TL', 'TR', 'BL', 'BR'].includes(a.key));

  const meanCard = card.length ? card.reduce((s, a) => s + a.distMm, 0) / card.length : 0;
  const meanDiag = diag.length ? diag.reduce((s, a) => s + a.distMm, 0) / diag.length : 0;

  let polSum = 0;
  for (const c of candidates.slice(0, Math.min(9, candidates.length))) polSum += c.pol;
  const modeUsed = polSum > 2 ? 'Brillante' : (polSum < -2 ? 'Oscuro' : 'Mixto');
  const pass = bestHyp.maxErr < tolMm;

  const labelMap = {
    TL: 'Esquina sup-izq',
    TC: 'Arriba',
    TR: 'Esquina sup-der',
    CL: 'Izquierda',
    CC: 'Centro',
    CR: 'Derecha',
    BL: 'Esquina inf-izq',
    BC: 'Abajo',
    BR: 'Esquina inf-der'
  };

  const metrics = {
    'Modo detectado': modeUsed,
    'Detectados': `${bestHyp.matched}/9`,
    'Error máx.': `${bestHyp.maxErr.toFixed(2)} mm`,
    'Error RMS': `${bestHyp.rmsErr.toFixed(2)} mm`,
    'Media cardinales': `${meanCard.toFixed(2)} mm`,
    'Media esquinas': `${meanDiag.toFixed(2)} mm`,
    'Tolerancia': '< 1.0 mm',
    'Rotación rejilla': `${(bestHyp.theta * 180 / Math.PI).toFixed(2)} °`
  };

  for (const a of bestHyp.assigned) {
    if (a.key === 'CC') continue;
    metrics[labelMap[a.key]] = a.distMm === null ? 'No detectado' : `${a.distMm.toFixed(2)} mm`;
  }

  return {
    name: `Distorsión por matriz de perdigones — ${sliceLabel}`,
    pass,
    warn: pass && bestHyp.maxErr >= 0.8,
    metrics,
    overlay: (ctx) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

      const byKey = Object.fromEntries(bestHyp.assigned.map(a => [a.key, a]));
      const link = (k1, k2) => {
        if (!byKey[k1] || !byKey[k2]) return;
        drawLine(ctx, byKey[k1].xIdeal, byKey[k1].yIdeal, byKey[k2].xIdeal, byKey[k2].yIdeal, 'rgba(231,76,60,0.55)', 1);
      };

      for (const a of bestHyp.assigned) {
        drawCircle(ctx, a.xIdeal, a.yIdeal, 3, '#e74c3c', 1.5);
      }

      link('TL', 'TC');
      link('TC', 'TR');
      link('CL', 'CC');
      link('CC', 'CR');
      link('BL', 'BC');
      link('BC', 'BR');
      link('TL', 'CL');
      link('CL', 'BL');
      link('TC', 'CC');
      link('CC', 'BC');
      link('TR', 'CR');
      link('CR', 'BR');

      for (const a of bestHyp.assigned) {
        if (!a.c) continue;
        drawCircle(ctx, a.observedX, a.observedY, 3.5, '#2ecc71', 1.8);
        drawLine(ctx, a.xIdeal, a.yIdeal, a.observedX, a.observedY, '#f1c40f', 1.5);
      }

      drawCross(ctx, bestHyp.center.cx, bestHyp.center.cy, 5, '#3498db');
    },
    img
  };
}

/* =========================================================================
   6. RENDER / UI
   ========================================================================= */

function drawLine(ctx, x1, y1, x2, y2, color = '#27ae60', lineWidth = 1.5) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawCircle(ctx, cx, cy, r, color = '#27ae60', lineWidth = 1.5) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawCross(ctx, cx, cy, halfSize = 4, color = '#f1c40f', lineWidth = 1.5) {
  drawLine(ctx, cx - halfSize, cy, cx + halfSize, cy, color, lineWidth);
  drawLine(ctx, cx, cy - halfSize, cx, cy + halfSize, color, lineWidth);
}

function drawRect(ctx, xOrRect, y, w, h, color = '#f39c12', lineWidth = 1.5) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  if (typeof xOrRect === 'object' && xOrRect !== null) {
    ctx.strokeRect(xOrRect.x, xOrRect.y, xOrRect.w, xOrRect.h);
  } else {
    ctx.strokeRect(xOrRect, y, w, h);
  }

  ctx.restore();
}

function drawBracketRect(ctx, xOrRect, y, w, h, color = '#f39c12', lineWidth = 1.5, capLength = 8) {
  let x = xOrRect;
  let yy = y;
  let ww = w;
  let hh = h;

  if (typeof xOrRect === 'object' && xOrRect !== null) {
    x = xOrRect.x;
    yy = xOrRect.y;
    ww = xOrRect.w;
    hh = xOrRect.h;
  }

  const x0 = x;
  const y0 = yy;
  const x1 = x + ww;
  const y1 = yy + hh;
  const cap = Math.max(4, Math.min(capLength, Math.abs(ww) / 4));

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  ctx.moveTo(x0, y0);
  ctx.lineTo(x0, y1);
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + cap, y0);
  ctx.moveTo(x0, y1);
  ctx.lineTo(x0 + cap, y1);

  ctx.moveTo(x1, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1 - cap, y0);
  ctx.lineTo(x1, y0);
  ctx.moveTo(x1 - cap, y1);
  ctx.lineTo(x1, y1);

  ctx.stroke();
  ctx.restore();
}
function renderSlice(canvas, img, overlayFn = null, scale = 1.0) {
  const w = Math.round(img.cols * scale);
  const h = Math.round(img.rows * scale);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext('2d');
  const im = ctx.createImageData(w, h);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < img.data.length; i++) {
    if (img.data[i] < min) min = img.data[i];
    if (img.data[i] > max) max = img.data[i];
  }
  const range = max > min ? max - min : 1;

  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const x = xx / scale;
      const y = yy / scale;
      const v = bilinear(img.data, img.rows, img.cols, x, y);
      const g = Math.max(0, Math.min(255, Math.round(255 * (v - min) / range)));
      const idx = (yy * w + xx) * 4;
      im.data[idx] = g;
      im.data[idx + 1] = g;
      im.data[idx + 2] = g;
      im.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(im, 0, 0);
  ctx.scale(scale, scale);
  if (overlayFn) overlayFn(ctx);
}

function drawProfilePlot(ctx, width, height, opts) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const margin = { left: 52, right: 18, top: 28, bottom: 38 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  let yMin = Infinity;
  let yMax = -Infinity;
  let nMax = 0;
  for (const s of opts.series) {
    for (const v of s.data) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
    if (s.data.length > nMax) nMax = s.data.length;
  }
  if (yMax <= yMin) yMax = yMin + 1;

  const xToPx = (i) => margin.left + (i / Math.max(1, nMax - 1)) * plotW;
  const yToPx = (v) => margin.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;
  ctx.strokeRect(margin.left, margin.top, plotW, plotH);

  ctx.fillStyle = '#2c3e50';
  ctx.font = '12px sans-serif';
  ctx.fillText(opts.title || '', margin.left, 16);
  ctx.fillText(opts.xLabel || '', margin.left + plotW / 2 - 40, height - 8);

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const frac = i / yTicks;
    const yVal = yMin + (1 - frac) * (yMax - yMin);
    const yPx = margin.top + frac * plotH;
    ctx.strokeStyle = '#eeeeee';
    ctx.beginPath();
    ctx.moveTo(margin.left, yPx);
    ctx.lineTo(margin.left + plotW, yPx);
    ctx.stroke();
    ctx.fillStyle = '#555';
    ctx.fillText(yVal.toFixed(0), 6, yPx + 4);
  }

  for (const s of opts.series) {
    ctx.strokeStyle = s.color || '#3498db';
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.data.forEach((v, i) => {
      const x = xToPx(i);
      const y = yToPx(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  if (opts.horizontalLines) {
    for (const h of opts.horizontalLines) {
      const y = yToPx(h.y);
      ctx.save();
      ctx.strokeStyle = h.color || '#555';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + plotW, y);
      ctx.stroke();
      ctx.restore();

      if (h.label) {
        ctx.fillStyle = h.color || '#555';
        ctx.fillText(h.label, margin.left + 6, y - 4);
      }
    }
  }

  if (opts.markers) {
    for (const m of opts.markers) {
      const x = xToPx(m.x);
      ctx.strokeStyle = m.color || '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + plotH);
      ctx.stroke();
    }
  }

  let lx = margin.left + 8;
  let ly = margin.top + 14;
  for (const s of opts.series) {
    ctx.strokeStyle = s.color || '#3498db';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lx, ly - 4);
    ctx.lineTo(lx + 18, ly - 4);
    ctx.stroke();
    ctx.fillStyle = '#2c3e50';
    ctx.fillText(s.label || '', lx + 24, ly);
    ly += 16;
  }
}

function renderResults(results) {
  const cont = document.getElementById('results');
  cont.innerHTML = '';
  document.getElementById('results-title').style.display = results.length ? 'block' : 'none';

  for (const res of results) {
    if (res.section) {
      const sec = document.createElement('div');
      sec.style.fontSize = '18px';
      sec.style.fontWeight = '700';
      sec.style.margin = '24px 0 8px';
      sec.style.paddingBottom = '6px';
      sec.style.borderBottom = '2px solid #ecf0f1';
      sec.textContent = res.title;
      cont.appendChild(sec);
      continue;
    }

    const div = document.createElement('div');
    let cls = 'test-result ';
    if (res.error) cls += 'error';
    else if (res.skipped) cls += 'warn';
    else if (res.warn && res.pass) cls += 'warn';
    else cls += res.pass ? 'pass' : 'fail';
    div.className = cls;

    const left = document.createElement('div');
    const badgeText = res.error
      ? 'ERROR'
      : res.skipped
        ? 'OMITIDO'
        : (res.pass ? (res.warn ? 'PASA (lím.)' : 'PASA') : 'FALLA');
    left.innerHTML = `<h3>${res.name} <span class="badge">${badgeText}</span></h3>`;

    if (res.message) {
      const p = document.createElement('p');
      p.textContent = res.message;
      left.appendChild(p);
    }

    if (res.metrics) {
      const table = document.createElement('table');
      for (const [k, v] of Object.entries(res.metrics)) {
        const tr = document.createElement('tr');
        const td1 = document.createElement('th');
        td1.textContent = k;
        const td2 = document.createElement('td');
        td2.textContent = v;
        td2.className = 'num';
        tr.appendChild(td1);
        tr.appendChild(td2);
        table.appendChild(tr);
      }
      left.appendChild(table);
    }

    const right = document.createElement('div');
    right.className = 'canvas-wrap';

    if (res.img) {
      const canvas = document.createElement('canvas');
      renderSlice(canvas, res.img, res.overlay, 1.5);
      right.appendChild(canvas);
      const caption = document.createElement('div');
      caption.textContent = `${res.img.filename}`;
      right.appendChild(caption);
    }

    if (res.plot) {
      const plotCanvas = document.createElement('canvas');
      plotCanvas.width = 420;
      plotCanvas.height = 220;
      plotCanvas.style.width = '420px';
      plotCanvas.style.height = '220px';
      plotCanvas.style.marginTop = '8px';
      plotCanvas.style.background = '#fff';
      plotCanvas.style.border = '1px solid #95a5a6';
      res.plot(plotCanvas.getContext('2d'), plotCanvas.width, plotCanvas.height);
      right.appendChild(plotCanvas);
    }

    div.appendChild(left);
    div.appendChild(right);
    cont.appendChild(div);
  }
}

/* Selector manual de series. La autodetección solo propone: el estudio ACR
   suele contener varios pares válidos (p. ej. con y sin filtro de uniformidad)
   y hay que poder analizarlos todos sin separar las imágenes en carpetas. */
function axialGroupOptionLabel(group) {
  const { conformant, deviations } = scoreAcrConformance(group);
  const parts = [
    `serie ${group.seriesNumber || '?'}`,
    `TR=${formatTagValue(group.tr)} TE=${formatTagValue(group.te)}`,
    `${group.rows}×${group.cols}`
  ];

  if (group.seriesDescription) parts.push(group.seriesDescription);
  if (hasUniformityFilter(group)) parts.push('filtro unif.');

  const mark = conformant ? '✔ ACR' : `✖ ${deviations.join(', ')}`;
  return `${parts.join(' | ')} — ${mark}`;
}

function resetSeriesSelectors() {
  const wrap = document.getElementById('series-controls');
  if (wrap) wrap.style.display = 'none';

  ['t1-select', 't2-select'].forEach((id) => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = '';
  });
}

function populateSeriesSelectors(analysis) {
  const wrap = document.getElementById('series-controls');
  if (!wrap) return;

  const candidates = (analysis && analysis.candidates) || { t1: [], t2: [] };
  const anyCandidate = candidates.t1.length || candidates.t2.length;
  wrap.style.display = anyCandidate ? 'flex' : 'none';
  if (!anyCandidate) return;

  const fill = (selectId, groups, selected) => {
    const sel = document.getElementById(selectId);
    if (!sel) return;

    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— no analizar —';
    sel.appendChild(none);

    groups.forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.key;
      opt.textContent = axialGroupOptionLabel(g);
      if (selected && g.key === selected.key) opt.selected = true;
      sel.appendChild(opt);
    });
  };

  fill('t1-select', candidates.t1, analysis.t1);
  fill('t2-select', candidates.t2, analysis.t2);
}

function onSeriesSelectionChange() {
  const analysis = state.analysis;
  if (!analysis || !analysis.candidates) return;

  const pick = (selectId, groups) => {
    const sel = document.getElementById(selectId);
    if (!sel) return null;
    return groups.find(g => g.key === sel.value) || null;
  };

  analysis.t1 = pick('t1-select', analysis.candidates.t1);
  analysis.t2 = pick('t2-select', analysis.candidates.t2);

  log(`\nSelección manual: T1 = ${analysis.t1 ? describeAxialGroup(analysis.t1) : 'ninguna'}`);
  log(`                  T2 = ${analysis.t2 ? describeAxialGroup(analysis.t2) : 'ninguna'}`);

  renderOverview(analysis);
  document.getElementById('run-btn').disabled = !analysis.t1 && !analysis.t2;
}

function renderOverview(analysis) {
  const title = document.getElementById('overview-title');
  const cont = document.getElementById('slice-overview');
  cont.innerHTML = '';

  if (!analysis || (!analysis.sagittal && !analysis.t1 && !analysis.t2)) {
    title.style.display = 'none';
    return;
  }

  title.style.display = 'block';

  const addHeader = (text) => {
    const h = document.createElement('div');
    h.className = 'mini';
    h.style.flexBasis = '100%';
    h.style.textAlign = 'left';
    h.style.fontWeight = '600';
    h.style.margin = '8px 0 2px';
    h.textContent = text;
    cont.appendChild(h);
  };

  const addMini = (img, label) => {
    const wrap = document.createElement('div');
    wrap.className = 'mini';
    const c = document.createElement('canvas');
    renderSlice(c, img, null, 0.45);
    wrap.appendChild(c);
    const d = document.createElement('div');
    d.textContent = label;
    wrap.appendChild(d);
    cont.appendChild(wrap);
  };

  if (analysis.sagittal) {
    addHeader('Sagital');
    addMini(analysis.sagittal, 'Localizador');
  }

  if (analysis.t1) {
    addHeader(`T1 — ${describeAxialGroup(analysis.t1)}`);
    analysis.t1.axial.forEach((img, i) => addMini(img, `T1-${i + 1}`));
  }

  if (analysis.t2) {
    addHeader(`T2 — ${describeAxialGroup(analysis.t2)}`);
    analysis.t2.axial.forEach((img, i) => addMini(img, `T2-${i + 1}`));
  }
}

/* =========================================================================
   7. FLUJO PRINCIPAL
   ========================================================================= */

async function handleFiles(fileList) {
  state.images = [];
  state.axial = [];
  state.sagittal = null;
  state.results = [];
  state.lastRunAt = null;
  state.lastFieldStrength = null;
  state.analysis = {
    sagittal: null,
    t1: null,
    t2: null,
    axialGroups: [],
    candidates: { t1: [], t2: [] }
  };
  resetSeriesSelectors();

  document.getElementById('results').innerHTML = '';
  document.getElementById('results-title').style.display = 'none';
  document.getElementById('slice-overview').innerHTML = '';
  document.getElementById('overview-title').style.display = 'none';
  document.getElementById('log').textContent = '';
  setCopyExcelEnabled(false);
  setPdfEnabled(false);

  const files = Array.from(fileList);
  if (!files.length) return;

  log(`Cargando ${files.length} archivo(s)...`);

  for (const f of files) {
    try {
      const img = await loadDicomFile(f);
      state.images.push(img);
      log(
        `✔ ${f.name}  (${img.rows}×${img.cols}, inst ${img.instanceNumber}, serie=${img.seriesNumber || '?'}, TR=${formatTagValue(img.repetitionTime)}, TE=${formatTagValue(img.echoTime)}, z=${img.imagePosition[2].toFixed(2)})`
      );
    } catch (e) {
      log(`✖ ${e.message}`);
    }
  }

  const classified = classifyImages(state.images);
  const analysis = detectAnalysisSeries(classified);

  state.axial = classified.axial;
  state.sagittal = classified.sagittal;
  state.analysis = analysis;

  log('\nClasificación:');
  log(`  Axiales totales: ${classified.axial.length}`);
  log(
    classified.sagittal
      ? `  Sagital: sí (${classified.sagittalCount} disponible(s), se usa el de x=${classified.sagittal.imagePosition[0].toFixed(1)} mm por ser el más central)`
      : '  Sagital: no'
  );

  if (classified.axialGroups.length) {
    classified.axialGroups.forEach((g, i) => {
      const { conformant, deviations } = scoreAcrConformance(g);
      log(
        `  Grupo axial ${i + 1}: n=${g.count}, serie=${g.seriesNumber || '?'}, TR=${formatTagValue(g.tr)}, TE=${formatTagValue(g.te)}, ${g.rows}×${g.cols}, echo=${g.echoNumber || '-'}${g.seriesDescription ? `, desc="${g.seriesDescription}"` : ''}${hasUniformityFilter(g) ? ', filtro unif.' : ''} → ${conformant ? 'conforme ACR' : `NO ACR (${deviations.join(', ')})`}`
      );
    });
  } else {
    log('  No se han encontrado grupos axiales.');
  }

  if (analysis.t1) {
    log(`  → T1 seleccionada: ${describeAxialGroup(analysis.t1)}`);
  } else {
    log('  → T1 no detectada.');
  }

  if (analysis.t2) {
    log(`  → T2 seleccionada: ${describeAxialGroup(analysis.t2)}`);
  } else {
    log('  → T2 no detectada.');
  }

  const extraT1 = Math.max(0, (analysis.candidates.t1.length || 0) - 1);
  const extraT2 = Math.max(0, (analysis.candidates.t2.length || 0) - 1);
  if (extraT1 || extraT2) {
    log(`  (hay ${extraT1} T1 y ${extraT2} T2 alternativas: cámbialas en los desplegables si quieres analizar otro par)`);
  }

  populateSeriesSelectors(analysis);
  renderOverview(analysis);
  document.getElementById('run-btn').disabled = !analysis.t1 && !analysis.t2;
}

function runTestsForSeries(seriesLabel, axial, sagittal, fieldStrength, includeSagittal = false) {
  const results = [];
  const prefix = `[${seriesLabel}]`;

  if (!axial || axial.length !== 11) {
    results.push({
      name: `Serie ${seriesLabel}`,
      pass: false,
      error: true,
      message: `La serie ${seriesLabel} no tiene 11 cortes axiales válidos.`
    });
    return results;
  }

  if (includeSagittal) {
    try {
      if (sagittal) {
        results.push(testGeometrySagittal(sagittal, 134, 2));
        log(`  ${prefix} ✓ Geometría sagital`);
      } else {
        results.push({
          name: 'Geometría sagital (longitud H-F)',
          pass: true,
          skipped: true,
          message: 'No se ha cargado localizador sagital. Esta prueba se omite.'
        });
        log(`  ${prefix} · Geometría sagital omitida`);
      }
    } catch (e) {
      results.push({
        name: 'Geometría sagital (longitud H-F)',
        pass: false,
        error: true,
        message: e.message
      });
    }
  }

  try {
    results.push(testGeometryAxial(axial[0], 'slice 1', 165, 2, false));
    log(`  ${prefix} ✓ Geometría axial slice 1`);
  } catch (e) {
    results.push({ name: 'Geometría axial — slice 1', pass: false, error: true, message: e.message });
  }

  try {
    results.push(testGeometryAxial(axial[4], 'slice 5', 165, 2, true));
    log(`  ${prefix} ✓ Geometría axial slice 5`);
  } catch (e) {
    results.push({ name: 'Geometría axial — slice 5', pass: false, error: true, message: e.message });
  }

  try {
    results.push(testPhantomEllipseFit(axial[4], 'slice 5', 165, 2));
    log(`  ${prefix} ✓ Ajuste elíptico del borde slice 5`);
  } catch (e) {
    results.push({ name: 'Ajuste elíptico del borde — slice 5', pass: false, error: true, message: e.message });
  }

  try {
    results.push(testPelletGridDistortion(axial[4], 'slice 5'));
    log(`  ${prefix} ✓ Distorsión por matriz de perdigones slice 5`);
  } catch (e) {
    results.push({ name: 'Distorsión por matriz de perdigones — slice 5', pass: false, error: true, message: e.message });
  }

  try {
    results.push(testSliceThickness(axial[0]));
    log(`  ${prefix} ✓ Espesor de corte`);
  } catch (e) {
    results.push({ name: 'Espesor de corte — slice 1', pass: false, error: true, message: e.message });
  }

  try {
    results.push(testSlicePosition(axial[0], 'slice 1'));
    log(`  ${prefix} ✓ Posición de corte slice 1`);
  } catch (e) {
    results.push({ name: 'Posición de corte — slice 1', pass: false, error: true, message: e.message });
  }

  try {
    results.push(testSlicePosition(axial[10], 'slice 11'));
    log(`  ${prefix} ✓ Posición de corte slice 11`);
  } catch (e) {
    results.push({ name: 'Posición de corte — slice 11', pass: false, error: true, message: e.message });
  }

  try {
    results.push(testPIU(axial[6], fieldStrength));
    log(`  ${prefix} ✓ PIU slice 7`);
  } catch (e) {
    results.push({ name: 'Uniformidad de intensidad (PIU) — slice 7', pass: false, error: true, message: e.message });
  }

  try {
    results.push(testGhosting(axial[6]));
    log(`  ${prefix} ✓ Ghosting slice 7`);
  } catch (e) {
    results.push({ name: 'Ghosting (PSG) — slice 7', pass: false, error: true, message: e.message });
  }

  return results;
}


function runTests() {
  const fieldStrength = parseFloat(document.getElementById('field-strength').value);
  const analysis = state.analysis;
  const results = [];
  const seriesToRun = [];
  setCopyExcelEnabled(false);
  setPdfEnabled(false);

  log('\nEjecutando tests ACR...');

  if (!analysis) {
    log('✖ No hay información de series analizadas.');
    return;
  }

  if (analysis.t1 && analysis.t1.axial && analysis.t1.axial.length === 11) {
    seriesToRun.push({ label: 'T1', group: analysis.t1 });
  }

  if (analysis.t2 && analysis.t2.axial && analysis.t2.axial.length === 11) {
    seriesToRun.push({ label: 'T2', group: analysis.t2 });
  }

  if (!seriesToRun.length) {
    log('✖ No se ha detectado ninguna serie T1/T2 válida con 11 cortes.');
    return;
  }

  seriesToRun.forEach((entry, idx) => {
    results.push({
      section: true,
      title: `${entry.label} — ${describeAxialGroup(entry.group)}`
    });

    results.push(
      ...runTestsForSeries(
        entry.label,
        entry.group.axial,
        analysis.sagittal,
        fieldStrength,
        idx === 0
      )
    );
  });

  state.lastRunAt = new Date();
  state.lastFieldStrength = fieldStrength;
  state.results = results;
  renderResults(results);
  setCopyExcelEnabled(results.some((item) => !item.section));
  setPdfEnabled(results.some((item) => !item.section));
  log('Tests completados.');
}


export function initAcrQc() {
  // Reset state on each mount
  state.images = [];
  state.axial = [];
  state.sagittal = null;
  state.results = [];
  state.lastRunAt = null;
  state.lastFieldStrength = null;
  state.analysis = { sagittal: null, t1: null, t2: null, axialGroups: [], candidates: { t1: [], t2: [] } };

  if (document.getElementById('log')) document.getElementById('log').textContent = '';
  if (document.getElementById('results')) document.getElementById('results').innerHTML = '';
  if (document.getElementById('slice-overview')) document.getElementById('slice-overview').innerHTML = '';
  if (document.getElementById('results-title')) document.getElementById('results-title').style.display = 'none';
  if (document.getElementById('overview-title')) document.getElementById('overview-title').style.display = 'none';
  resetSeriesSelectors();

/* =========================================================================
   8. EVENTOS UI
   ========================================================================= */

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const runBtn = document.getElementById('run-btn');
const copyExcelBtn = document.getElementById('copy-excel-btn');
const savePdfBtn = document.getElementById('save-pdf-btn');
const clearBtn = document.getElementById('clear-btn');

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

['dragenter', 'dragover'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
  });
});

dropZone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (dt.files && dt.files.length) handleFiles(dt.files);
});

['t1-select', 't2-select'].forEach((id) => {
  const sel = document.getElementById(id);
  if (sel) sel.addEventListener('change', onSeriesSelectionChange);
});

runBtn.addEventListener('click', runTests);
if (copyExcelBtn) {
  copyExcelBtn.addEventListener('click', () => {
    copyResultsForExcel();
  });
}
if (savePdfBtn) {
  savePdfBtn.addEventListener('click', () => {
    saveResultsAsPdf();
  });
}
clearBtn.addEventListener('click', () => {
  state.images = [];
  state.axial = [];
  state.sagittal = null;
  state.results = [];
  state.lastRunAt = null;
  state.lastFieldStrength = null;
  state.analysis = {
    sagittal: null,
    t1: null,
    t2: null,
    axialGroups: [],
    candidates: { t1: [], t2: [] }
  };
  resetSeriesSelectors();

  document.getElementById('results').innerHTML = '';
  document.getElementById('slice-overview').innerHTML = '';
  document.getElementById('log').textContent = '';
  document.getElementById('results-title').style.display = 'none';
  document.getElementById('overview-title').style.display = 'none';
  runBtn.disabled = true;
  setCopyExcelEnabled(false);
  setPdfEnabled(false);
  fileInput.value = '';
});

}
