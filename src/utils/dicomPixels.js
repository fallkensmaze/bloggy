// Shared DICOM stored-pixel decoding.
//
// This module owns the three things that make a stored value become the number
// the modality meant to write: which transfer syntaxes we can read at all, how
// BitsStored/HighBit carve the real value out of the allocated word, and how a
// signed value is sign-extended.
//
// It was extracted from petNemaDicom.js, where it had already been validated by
// scripts/test-pet-nema.mjs, because src/utils/dicomParser.js (the NM gamma
// camera reader) did none of it: it never rejected a compressed transfer
// syntax, so encapsulated JPEG fragments were happily interpreted as native
// pixels and produced a plausible-looking uniformity out of noise, and it read
// BitsStored/HighBit into its result without ever applying them.

export const NATIVE_TRANSFER_SYNTAXES = new Set([
  '',
  '1.2.840.10008.1.2',
  '1.2.840.10008.1.2.1',
  '1.2.840.10008.1.2.1.99',
  '1.2.840.10008.1.2.2'
])

const EXPLICIT_VR_BIG_ENDIAN = '1.2.840.10008.1.2.2'

export function isNativeTransferSyntax(uid) {
  return NATIVE_TRANSFER_SYNTAXES.has(uid || '')
}

export function isLittleEndian(uid) {
  return uid !== EXPLICIT_VR_BIG_ENDIAN
}

export function assertNativeTransferSyntax(uid) {
  if (!isNativeTransferSyntax(uid)) {
    throw new Error(
      `Transfer Syntax comprimida o encapsulada no soportada: ${uid}. `
      + 'Exporta la serie sin comprimir (Explicit VR Little Endian).'
    )
  }
}

export function readUnsignedPixel(view, byteOffset, bitsAllocated, littleEndian) {
  if (bitsAllocated === 8) return view.getUint8(byteOffset)
  if (bitsAllocated === 16) return view.getUint16(byteOffset, littleEndian)
  if (bitsAllocated === 32) return view.getUint32(byteOffset, littleEndian)
  throw new Error(`Bits Allocated=${bitsAllocated} no soportado.`)
}

// Drops the padding bits above HighBit, keeps BitsStored bits, and sign-extends
// when PixelRepresentation is 1 (two's complement).
export function normalizeStoredPixel(rawValue, bitsStored, highBit, pixelRepresentation) {
  const shift = Math.max(0, highBit - bitsStored + 1)
  const range = 2 ** bitsStored
  let value = Math.floor(rawValue / 2 ** shift) % range
  if (pixelRepresentation === 1 && value >= range / 2) value -= range
  return value
}

export function getPixelDataBytes(pixelDataElement, arrayBuffer) {
  if (!pixelDataElement) {
    throw new Error('No se encontraron datos de pixel (tag 7FE0,0010).')
  }

  const value = pixelDataElement.Value || pixelDataElement.value
  const first = Array.isArray(value) ? value[0] : value

  if (first instanceof ArrayBuffer) return new Uint8Array(first)
  if (ArrayBuffer.isView(first)) {
    return new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
  }
  if (typeof first === 'string') {
    const binary = atob(first)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
  }

  if (
    pixelDataElement.dataOffset == null
    || pixelDataElement.length == null
    || pixelDataElement.length <= 0
  ) {
    throw new Error('Pixel Data sin offset o encapsulado no soportado.')
  }
  return new Uint8Array(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length)
}

// How many frames the byte count can actually back, and whether the surplus is
// only the single padding byte DICOM allows to keep an element even-length.
//
// The NM reader used to take Math.max(declared, available), so a file whose
// Pixel Data carried trailing bytes grew extra frames that the header never
// declared. Frames are never invented here: what is not declared is not read.
export function resolveFrameCount(declaredFrames, byteLength, bytesPerFrame) {
  if (!(bytesPerFrame > 0)) throw new Error('Geometria de pixel invalida.')

  const declared = Math.max(1, Math.trunc(declaredFrames) || 1)
  const available = Math.floor(byteLength / bytesPerFrame)

  if (available < declared) {
    throw new Error(
      `Pixel Data incompleto: ${byteLength} bytes para ${declared} frames de `
      + `${bytesPerFrame} bytes (solo alcanzan ${available}).`
    )
  }

  const surplus = byteLength - declared * bytesPerFrame
  return { frameCount: declared, available, surplus, paddingOnly: surplus <= 1 }
}

// Reads (0002,0010) from whichever shape dcmjs hands back.
//
// Both readers used to look only at dicomData.meta.dict, but this build of
// dcmjs returns the file meta group as the dict itself, so the lookup resolved
// to undefined on every real file and the transfer syntax silently came back
// empty. An empty UID is treated as native, so a compressed study would have
// been decoded as raw pixels with nothing to stop it. Both shapes are handled
// here, once.
export function readTransferSyntaxUid(dicomData) {
  const meta = dicomData?.meta
  if (!meta) return ''

  const element = meta['00020010'] || meta.dict?.['00020010']
  const value = element?.Value ?? element?.value
  const uid = Array.isArray(value) ? value[0] : value

  return typeof uid === 'string' ? uid.trim().replace(/\0+$/, '') : ''
}
