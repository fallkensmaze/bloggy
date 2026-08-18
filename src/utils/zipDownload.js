// ZIP "STORE" (sin compresión) implementado a mano para no añadir dependencias.
// Los DICOM de un estudio RT apenas comprimen, así que STORE es suficiente y
// minimiza el uso de memoria. Devuelve un Blob listo para descargar.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(u8) {
  let c = 0xffffffff
  for (let i = 0; i < u8.length; i++) {
    c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function strToU8(str) {
  return new TextEncoder().encode(str)
}

const DOS_DATE = (() => {
  // Fecha/hora fija en el ZIP (no relevante; el contenido DICOM ya está fechado).
  const d = new Date(2020, 0, 1)
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >>> 1)) >>> 0
  const date = ((((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f)) >>> 0
  return { time, date }
})()

function toU8(data) {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new Error('Tipo de dato no soportado para ZIP')
}

/**
 * @param {Array<{name:string, data:ArrayBuffer|Uint8Array}>} entries
 * @returns {Blob}
 */
export function makeZip(entries) {
  const files = entries.map((e) => ({ name: e.name, data: toU8(e.data) }))
  if (files.length > 0xffff) {
    throw new Error('ZIP64 no soportado: demasiados archivos para un ZIP clásico (>65535).')
  }

  // Calcular tamaños y offsets.
  const locals = []
  let offset = 0
  const nameBytes = []
  let totalLocalSize = 0

  for (const f of files) {
    if (f.data.length > 0xffffffff) {
      throw new Error(`ZIP64 no soportado: ${f.name} supera 4 GiB.`)
    }
    const nb = strToU8(f.name)
    nameBytes.push(nb)
    const localSize = 30 + nb.length + f.data.length
    locals.push({ offset })
    offset += localSize
    totalLocalSize += localSize
  }

  // Central directory size.
  let centralDirSize = 0
  for (const nb of nameBytes) centralDirSize += 46 + nb.length

  const totalSize = totalLocalSize + centralDirSize + 22
  if (totalSize > 0xffffffff) {
    throw new Error('ZIP64 no soportado: el estudio supera 4 GiB. Divide el estudio o usa una herramienta local.')
  }
  const out = new Uint8Array(totalSize)
  const dv = new DataView(out.buffer)

  let p = 0
  // Local headers + data.
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const nb = nameBytes[i]
    const crc = crc32(f.data)
    dv.setUint32(p, 0x04034b50, true); p += 4
    dv.setUint16(p, 20, true); p += 2          // version needed
    dv.setUint16(p, 0x0800, true); p += 2      // flags: UTF-8 file names
    dv.setUint16(p, 0, true); p += 2           // compression: store
    dv.setUint16(p, DOS_DATE.time, true); p += 2
    dv.setUint16(p, DOS_DATE.date, true); p += 2
    dv.setUint32(p, crc, true); p += 4
    dv.setUint32(p, f.data.length, true); p += 4  // compressed size
    dv.setUint32(p, f.data.length, true); p += 4  // uncompressed size
    dv.setUint16(p, nb.length, true); p += 2
    dv.setUint16(p, 0, true); p += 2           // extra
    out.set(nb, p); p += nb.length
    out.set(f.data, p); p += f.data.length
  }

  // Central directory.
  const centralStart = p
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const nb = nameBytes[i]
    const crc = crc32(f.data)
    dv.setUint32(p, 0x02014b50, true); p += 4
    dv.setUint16(p, 20, true); p += 2          // version made by
    dv.setUint16(p, 20, true); p += 2          // version needed
    dv.setUint16(p, 0x0800, true); p += 2      // flags: UTF-8 file names
    dv.setUint16(p, 0, true); p += 2           // compression
    dv.setUint16(p, DOS_DATE.time, true); p += 2
    dv.setUint16(p, DOS_DATE.date, true); p += 2
    dv.setUint32(p, crc, true); p += 4
    dv.setUint32(p, f.data.length, true); p += 4
    dv.setUint32(p, f.data.length, true); p += 4
    dv.setUint16(p, nb.length, true); p += 2
    dv.setUint16(p, 0, true); p += 2           // extra
    dv.setUint16(p, 0, true); p += 2           // comment
    dv.setUint16(p, 0, true); p += 2           // disk number start
    dv.setUint16(p, 0, true); p += 2           // internal attrs
    dv.setUint32(p, 0, true); p += 4           // external attrs
    dv.setUint32(p, locals[i].offset, true); p += 4
    out.set(nb, p); p += nb.length
  }
  const centralSize = p - centralStart

  // End of central directory.
  dv.setUint32(p, 0x06054b50, true); p += 4
  dv.setUint16(p, 0, true); p += 2            // disk
  dv.setUint16(p, 0, true); p += 2            // disk with central
  dv.setUint16(p, files.length, true); p += 2
  dv.setUint16(p, files.length, true); p += 2
  dv.setUint32(p, centralSize, true); p += 4
  dv.setUint32(p, centralStart, true); p += 4
  dv.setUint16(p, 0, true); p += 2            // comment

  return new Blob([out], { type: 'application/zip' })
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
