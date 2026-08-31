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

export function resolveRoi(image, roi = {}) {
  const width = Math.max(1, Math.min(image.width, Math.round(Number(roi.widthPx) || 35)))
  const height = Math.max(1, Math.min(image.height, Math.round(Number(roi.heightPx) || width)))
  const centerX = Math.min(1, Math.max(0, Number(roi.centerX ?? 0.5)))
  const centerY = Math.min(1, Math.max(0, Number(roi.centerY ?? 0.5)))
  const x = Math.max(0, Math.min(image.width - width, Math.round(centerX * (image.width - 1) - width / 2)))
  const y = Math.max(0, Math.min(image.height - height, Math.round(centerY * (image.height - 1) - height / 2)))
  return { x, y, width, height, centerX, centerY }
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
  const baseline = averageImages(baselineImages)
  const exposed = averageImages(exposedImages)
  assertSameImageGeometry([baseline, exposed], 'imágenes pre/post')
  const baseRoi = extractRoiRgb(baseline, roi)
  const exposedRoi = extractRoiRgb(exposed, roi)
  const netOd = new Float64Array(baseRoi.data.length)

  for (let index = 0; index < netOd.length; index++) {
    const i0 = Math.max(1, baseRoi.data[index])
    const value = Math.max(1, exposedRoi.data[index])
    netOd[index] = Math.log10(i0 / value)
  }

  return {
    roi: baseRoi.roi,
    baseline: rgbStats(baseRoi.data),
    exposed: rgbStats(exposedRoi.data),
    netOd: rgbStats(netOd)
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
