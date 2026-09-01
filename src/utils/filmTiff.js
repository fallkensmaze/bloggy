import { decode } from 'tiff'

const RGB_PHOTOMETRIC = 2
const UNSIGNED_INTEGER = 1

function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : [value]
}

function dpiValue(value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  if (unit === 3) return n * 2.54
  if (unit === 2) return n
  return null
}

function orientRgb(data, width, height, orientation) {
  if (!orientation || orientation === 1) return { data, width, height }
  if (![3, 6, 8].includes(orientation)) {
    throw new Error(`Orientación TIFF ${orientation} no soportada. Guarda la imagen con orientación 1, 3, 6 u 8.`)
  }

  const rotatedWidth = orientation === 6 || orientation === 8 ? height : width
  const rotatedHeight = orientation === 6 || orientation === 8 ? width : height
  const output = new Uint16Array(data.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let targetX
      let targetY
      if (orientation === 3) {
        targetX = width - 1 - x
        targetY = height - 1 - y
      } else if (orientation === 6) {
        targetX = height - 1 - y
        targetY = x
      } else {
        targetX = y
        targetY = width - 1 - x
      }
      const source = (y * width + x) * 3
      const target = (targetY * rotatedWidth + targetX) * 3
      output[target] = data[source]
      output[target + 1] = data[source + 1]
      output[target + 2] = data[source + 2]
    }
  }

  return { data: output, width: rotatedWidth, height: rotatedHeight }
}

export function decodeRgb16Tiff(buffer, name = 'imagen TIFF') {
  let pages
  try {
    pages = decode(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
  } catch (error) {
    throw new Error(`${name}: no se pudo decodificar el TIFF (${error.message}).`)
  }
  if (!pages?.length) throw new Error(`${name}: el TIFF no contiene ninguna imagen.`)
  if (pages.length !== 1) throw new Error(`${name}: se esperaba un TIFF de una sola página y contiene ${pages.length}.`)

  const ifd = pages[0]
  const bits = asArray(ifd.get('BitsPerSample'))
  const samples = Number(ifd.samplesPerPixel)
  const sampleFormats = asArray(ifd.get('SampleFormat') || UNSIGNED_INTEGER)
  const orientation = Number(ifd.orientation || 1)

  if (Number(ifd.type) !== RGB_PHOTOMETRIC) {
    throw new Error(`${name}: PhotometricInterpretation=${ifd.type}; se requiere RGB.`)
  }
  if (samples !== 3) throw new Error(`${name}: tiene ${samples} muestras por píxel; se requieren R, G y B.`)
  if (bits.length !== 3 || bits.some((value) => Number(value) !== 16)) {
    throw new Error(`${name}: BitsPerSample=${bits.join(',')}; se requieren 16 bits por canal (48 bits RGB).`)
  }
  if (sampleFormats.some((value) => Number(value) !== UNSIGNED_INTEGER)) {
    throw new Error(`${name}: SampleFormat no es entero sin signo.`)
  }
  if (Number(ifd.planarConfiguration) !== 1) {
    throw new Error(`${name}: PlanarConfiguration=${ifd.planarConfiguration}; solo se admite RGB entrelazado.`)
  }
  if (!(ifd.data instanceof Uint16Array)) {
    throw new Error(`${name}: el decodificador no devolvió datos Uint16.`)
  }
  if (ifd.data.length !== ifd.width * ifd.height * 3) {
    throw new Error(`${name}: tamaño de datos incoherente con ${ifd.width}×${ifd.height}×3.`)
  }

  const oriented = orientRgb(ifd.data, ifd.width, ifd.height, orientation)
  let xDpi = dpiValue(ifd.xResolution, ifd.resolutionUnit)
  let yDpi = dpiValue(ifd.yResolution, ifd.resolutionUnit)
  if (orientation === 6 || orientation === 8) [xDpi, yDpi] = [yDpi, xDpi]

  return {
    ...oriented,
    name,
    bitsPerSample: 16,
    samplesPerPixel: 3,
    compression: Number(ifd.compression),
    sourceOrientation: orientation,
    xDpi,
    yDpi,
    pixelSpacingMm: [yDpi ? 25.4 / yDpi : null, xDpi ? 25.4 / xDpi : null]
  }
}

export async function readRgb16TiffFile(file) {
  if (!file) throw new Error('No se ha seleccionado ningún TIFF.')
  return decodeRgb16Tiff(await file.arrayBuffer(), file.name)
}

export async function readRgb16TiffFiles(files) {
  const list = Array.from(files || [])
  if (!list.length) throw new Error('Selecciona al menos un TIFF.')
  return Promise.all(list.map(readRgb16TiffFile))
}

export function assertSameImageGeometry(images, label = 'escaneos') {
  if (!images?.length) throw new Error(`No hay ${label}.`)
  const first = images[0]
  for (const image of images.slice(1)) {
    if (image.width !== first.width || image.height !== first.height) {
      throw new Error(`${image.name}: dimensiones ${image.width}×${image.height}; se esperaban ${first.width}×${first.height}.`)
    }
    const firstSpacing = first.pixelSpacingMm
    const spacing = image.pixelSpacingMm
    if (firstSpacing?.every(Number.isFinite) && spacing?.every(Number.isFinite) &&
        firstSpacing.some((value, axis) => Math.abs(value - spacing[axis]) > 1e-6)) {
      throw new Error(`${image.name}: el espaciado de píxel no coincide con el resto de ${label}.`)
    }
  }
  return { width: first.width, height: first.height }
}

export function resolveRoi(image, roi = null) {
  if (!roi || roi.enabled === false || roi.mode === 'full-image' || !Object.keys(roi).length) {
    return { x: 0, y: 0, width: image.width, height: image.height, fullImage: true }
  }

  if (roi.mode === 'relative') {
    const relativeX = Math.min(1, Math.max(0, Number(roi.x) || 0))
    const relativeY = Math.min(1, Math.max(0, Number(roi.y) || 0))
    const requestedWidth = Number.isFinite(Number(roi.width)) ? Number(roi.width) : 0.5
    const requestedHeight = Number.isFinite(Number(roi.height)) ? Number(roi.height) : 0.5
    const relativeWidth = Math.min(1 - relativeX, Math.max(0, requestedWidth))
    const relativeHeight = Math.min(1 - relativeY, Math.max(0, requestedHeight))
    const x = Math.min(image.width - 1, Math.floor(relativeX * image.width))
    const y = Math.min(image.height - 1, Math.floor(relativeY * image.height))
    const right = Math.max(x + 1, Math.min(image.width, Math.ceil((relativeX + relativeWidth) * image.width)))
    const bottom = Math.max(y + 1, Math.min(image.height, Math.ceil((relativeY + relativeHeight) * image.height)))
    return { x, y, width: right - x, height: bottom - y, fullImage: false }
  }

  if (roi.mode === 'pixels' || ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(roi[key])))) {
    const x = Math.max(0, Math.min(image.width - 1, Math.round(Number(roi.x))))
    const y = Math.max(0, Math.min(image.height - 1, Math.round(Number(roi.y))))
    const width = Math.max(1, Math.min(image.width - x, Math.round(Number(roi.width))))
    const height = Math.max(1, Math.min(image.height - y, Math.round(Number(roi.height))))
    return { x, y, width, height, fullImage: false }
  }

  // Compatibilidad con calibraciones creadas antes del selector visual.
  const width = Math.max(1, Math.min(image.width, Math.round(Number(roi.widthPx) || 35)))
  const height = Math.max(1, Math.min(image.height, Math.round(Number(roi.heightPx) || width)))
  const centerX = Math.min(1, Math.max(0, Number(roi.centerX ?? 0.5)))
  const centerY = Math.min(1, Math.max(0, Number(roi.centerY ?? 0.5)))
  const x = Math.max(0, Math.min(image.width - width, Math.round(centerX * (image.width - 1) - width / 2)))
  const y = Math.max(0, Math.min(image.height - height, Math.round(centerY * (image.height - 1) - height / 2)))
  return { x, y, width, height, centerX, centerY, fullImage: false }
}

export function averageImages(images) {
  const { width, height } = assertSameImageGeometry(images)
  const output = new Float32Array(width * height * 3)
  for (const image of images) {
    const input = image.data
    for (let index = 0; index < output.length; index++) output[index] += input[index] / images.length
  }
  return {
    width,
    height,
    data: output,
    xDpi: images[0].xDpi,
    yDpi: images[0].yDpi,
    pixelSpacingMm: images[0].pixelSpacingMm
  }
}

export function extractRoiRgb(image, roi) {
  const area = resolveRoi(image, roi)
  const output = new Float64Array(area.width * area.height * 3)
  let target = 0
  for (let row = 0; row < area.height; row++) {
    const start = ((area.y + row) * image.width + area.x) * 3
    for (let index = 0; index < area.width * 3; index++) output[target++] = image.data[start + index]
  }
  return { data: output, roi: area }
}

export function rgbStats(interleaved) {
  const count = Math.floor(interleaved.length / 3)
  if (!count) throw new Error('La ROI no contiene píxeles.')
  const mean = [0, 0, 0]
  for (let index = 0; index < interleaved.length; index += 3) {
    mean[0] += interleaved[index]
    mean[1] += interleaved[index + 1]
    mean[2] += interleaved[index + 2]
  }
  for (let channel = 0; channel < 3; channel++) mean[channel] /= count

  const covariance = Array.from({ length: 3 }, () => [0, 0, 0])
  for (let index = 0; index < interleaved.length; index += 3) {
    const residual = [
      interleaved[index] - mean[0],
      interleaved[index + 1] - mean[1],
      interleaved[index + 2] - mean[2]
    ]
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) covariance[row][column] += residual[row] * residual[column]
    }
  }
  const divisor = Math.max(1, count - 1)
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) covariance[row][column] /= divisor
  }
  return { mean, covariance, std: covariance.map((row, index) => Math.sqrt(Math.max(0, row[index]))), count }
}

export function pairedNetOdRoi(baselineImages, exposedImages, roi) {
  assertSameImageGeometry(baselineImages, 'escaneos pre')
  assertSameImageGeometry(exposedImages, 'escaneos post')
  assertSameImageGeometry([baselineImages[0], exposedImages[0]], 'imágenes pre/post')
  const area = resolveRoi(baselineImages[0], roi)
  const accumulators = Array.from({ length: 3 }, () => ({
    count: 0,
    mean: [0, 0, 0],
    sumProducts: Array.from({ length: 3 }, () => [0, 0, 0])
  }))
  const addSample = (accumulator, value0, value1, value2) => {
    accumulator.count++
    const delta0 = value0 - accumulator.mean[0]
    const delta1 = value1 - accumulator.mean[1]
    const delta2 = value2 - accumulator.mean[2]
    accumulator.mean[0] += delta0 / accumulator.count
    accumulator.mean[1] += delta1 / accumulator.count
    accumulator.mean[2] += delta2 / accumulator.count
    const adjusted0 = value0 - accumulator.mean[0]
    const adjusted1 = value1 - accumulator.mean[1]
    const adjusted2 = value2 - accumulator.mean[2]
    accumulator.sumProducts[0][0] += delta0 * adjusted0
    accumulator.sumProducts[0][1] += delta0 * adjusted1
    accumulator.sumProducts[0][2] += delta0 * adjusted2
    accumulator.sumProducts[1][0] += delta1 * adjusted0
    accumulator.sumProducts[1][1] += delta1 * adjusted1
    accumulator.sumProducts[1][2] += delta1 * adjusted2
    accumulator.sumProducts[2][0] += delta2 * adjusted0
    accumulator.sumProducts[2][1] += delta2 * adjusted1
    accumulator.sumProducts[2][2] += delta2 * adjusted2
  }
  const finish = (accumulator) => {
    const divisor = Math.max(1, accumulator.count - 1)
    const covariance = accumulator.sumProducts.map((row) => row.map((value) => value / divisor))
    return {
      mean: accumulator.mean,
      covariance,
      std: covariance.map((row, index) => Math.sqrt(Math.max(0, row[index]))),
      count: accumulator.count
    }
  }

  for (let row = 0; row < area.height; row++) {
    for (let column = 0; column < area.width; column++) {
      const index = ((area.y + row) * baselineImages[0].width + area.x + column) * 3
      let baseline0 = 0
      let baseline1 = 0
      let baseline2 = 0
      let exposed0 = 0
      let exposed1 = 0
      let exposed2 = 0
      for (const image of baselineImages) {
        baseline0 += image.data[index] / baselineImages.length
        baseline1 += image.data[index + 1] / baselineImages.length
        baseline2 += image.data[index + 2] / baselineImages.length
      }
      for (const image of exposedImages) {
        exposed0 += image.data[index] / exposedImages.length
        exposed1 += image.data[index + 1] / exposedImages.length
        exposed2 += image.data[index + 2] / exposedImages.length
      }
      addSample(accumulators[0], baseline0, baseline1, baseline2)
      addSample(accumulators[1], exposed0, exposed1, exposed2)
      addSample(
        accumulators[2],
        Math.log10(Math.max(1, baseline0) / Math.max(1, exposed0)),
        Math.log10(Math.max(1, baseline1) / Math.max(1, exposed1)),
        Math.log10(Math.max(1, baseline2) / Math.max(1, exposed2))
      )
    }
  }

  return {
    roi: area,
    baseline: finish(accumulators[0]),
    exposed: finish(accumulators[1]),
    netOd: finish(accumulators[2])
  }
}

export function imageRgbMean(image) {
  return rgbStats(image.data).mean
}

export function makeRgbPreview(image, { lower = 0, upper = 65535 } = {}) {
  const rgba = new Uint8ClampedArray(image.width * image.height * 4)
  const range = Math.max(1, upper - lower)
  for (let source = 0, target = 0; source < image.data.length; source += 3, target += 4) {
    rgba[target] = Math.max(0, Math.min(255, Math.round((image.data[source] - lower) / range * 255)))
    rgba[target + 1] = Math.max(0, Math.min(255, Math.round((image.data[source + 1] - lower) / range * 255)))
    rgba[target + 2] = Math.max(0, Math.min(255, Math.round((image.data[source + 2] - lower) / range * 255)))
    rgba[target + 3] = 255
  }
  return rgba
}

export function makeRgbPreviewImage(image, { maxDimension = 900, lowerPercentile = 0.01, upperPercentile = 0.99 } = {}) {
  const maximum = Math.max(image.width, image.height)
  const scale = Math.min(1, Math.max(1, Number(maxDimension) || 900) / maximum)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const histograms = Array.from({ length: 3 }, () => new Uint32Array(4096))
  const pixelCount = image.width * image.height
  const sampleStride = Math.max(1, Math.ceil(pixelCount / 250000))
  let samples = 0

  for (let pixel = 0; pixel < pixelCount; pixel += sampleStride) {
    const source = pixel * 3
    for (let channel = 0; channel < 3; channel++) histograms[channel][image.data[source + channel] >> 4]++
    samples++
  }

  const percentileBin = (histogram, percentile) => {
    const target = Math.max(0, Math.min(samples - 1, Math.floor(samples * percentile)))
    let cumulative = 0
    for (let bin = 0; bin < histogram.length; bin++) {
      cumulative += histogram[bin]
      if (cumulative > target) return bin
    }
    return histogram.length - 1
  }
  const lower = histograms.map((histogram) => percentileBin(histogram, lowerPercentile) * 16)
  const upper = histograms.map((histogram) => Math.max(1, percentileBin(histogram, upperPercentile) * 16 + 15))
  const rgba = new Uint8ClampedArray(width * height * 4)

  for (let targetY = 0; targetY < height; targetY++) {
    const sourceY = Math.min(image.height - 1, Math.floor(targetY * image.height / height))
    for (let targetX = 0; targetX < width; targetX++) {
      const sourceX = Math.min(image.width - 1, Math.floor(targetX * image.width / width))
      const source = (sourceY * image.width + sourceX) * 3
      const target = (targetY * width + targetX) * 4
      for (let channel = 0; channel < 3; channel++) {
        const range = Math.max(1, upper[channel] - lower[channel])
        rgba[target + channel] = Math.max(0, Math.min(255, Math.round((image.data[source + channel] - lower[channel]) / range * 255)))
      }
      rgba[target + 3] = 255
    }
  }

  return {
    width,
    height,
    rgba,
    sourceWidth: image.width,
    sourceHeight: image.height,
    window: { lower, upper }
  }
}
