// Files never leave the tab. The limits below are UI/resource limits, not physical data.
const MAX_FILE_BYTES = 20 * 1024 * 1024
export function checkPlanFile(file) {
  if (!file || file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('Elige un archivo de hasta 20 MB que no esté vacío.')
  const ext = file.name.split('.').pop().toLowerCase()
  const formats = { pdf: ['application/pdf', 'pdf'], png: ['image/png', 'image'], jpg: ['image/jpeg', 'image'], jpeg: ['image/jpeg', 'image'] }
  const format = formats[ext]
  if (!format || (file.type && file.type !== format[0] && file.type !== 'application/octet-stream')) throw new Error('Abre un plano PDF, PNG o JPEG.')
  return format[1]
}
export function boundedRasterSize(width, height) {
  if (![width, height].every(v => Number.isFinite(v) && v > 0)) throw new Error('El plano no tiene dimensiones válidas.')
  const scale = Math.min(1, 4096 / width, 4096 / height, Math.sqrt(12000000 / (width * height)))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
export function imageHeaderSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) return { width: view.getUint32(16), height: view.getUint32(20) }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i++] !== 0xff) break
      while (bytes[i] === 0xff) i++
      const marker = bytes[i++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      const length = view.getUint16(i)
      if (length < 2 || i + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: view.getUint16(i + 5), height: view.getUint16(i + 3) }
      i += length
    }
  }
  throw new Error('La imagen no es un PNG o JPEG válido.')
}
async function canvasImage(canvas) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('No se pudo preparar el plano.')
  return { url: URL.createObjectURL(blob), pixelWidth: canvas.width, pixelHeight: canvas.height }
}
export async function loadPlanImage(file) {
  checkPlanFile(file)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const size = imageHeaderSize(bytes)
  if (size.width > 16384 || size.height > 16384 || size.width * size.height > 24000000) throw new Error('La imagen supera 24 megapíxeles. Reduce su resolución antes de abrirla.')
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const bounded = boundedRasterSize(image.width, image.height)
    const canvas = document.createElement('canvas')
    Object.assign(canvas, bounded)
    canvas.getContext('2d').drawImage(image, 0, 0, bounded.width, bounded.height)
    return await canvasImage(canvas)
  } finally { image.close() }
}
export async function openPlanPdf(file, { signal } = {}) {
  checkPlanFile(file)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('El archivo no contiene un PDF válido.')
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  if (signal?.aborted) throw new DOMException('Importación cancelada.', 'AbortError')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, stopAtErrors: true, useSystemFonts: true, maxImageSize: 24000000, canvasMaxAreaInBytes: 48000000 })
  let destruction
  const destroy = () => { signal?.removeEventListener('abort', abort); return destruction ??= task.destroy() }
  const abort = () => { destroy().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const pdf = await task.promise
    // PDF.js 6 owns destruction on the loading task, not on PDFDocumentProxy.
    return { numPages: pdf.numPages, getPage: number => pdf.getPage(number), destroy }
  } catch (e) { await destroy(); throw new Error(e.name === 'PasswordException' ? 'El PDF está protegido. Abre una copia sin contraseña.' : 'No se pudo leer el PDF.') }
}
export async function renderPlanPdf(pdf, pageNumber) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) throw new Error('Selecciona una página del PDF.')
  const page = await pdf.getPage(pageNumber)
  const original = page.getViewport({ scale: 2 })
  const bounded = boundedRasterSize(original.width, original.height)
  const viewport = page.getViewport({ scale: 2 * bounded.width / original.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  page.cleanup()
  return canvasImage(canvas)
}
export async function rotatePlanImage(background) {
  const image = new Image()
  image.src = background.url
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalHeight; canvas.height = image.naturalWidth
  const ctx = canvas.getContext('2d')
  ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(image, 0, 0)
  return canvasImage(canvas)
}
