// Files from a drop event, including whole folders. Must be called synchronously
// inside the drop handler: the DataTransfer is emptied once the event returns.

const isDicomName = name => /\.(dcm|dicom|ima)$/i.test(name) || !/\.[^./\\]+$/.test(name)

const readEntries = reader => new Promise((resolve, reject) => reader.readEntries(resolve, reject))
const entryFile = entry => new Promise((resolve, reject) => entry.file(resolve, reject))

async function walk(entry, out) {
  if (entry.isFile) { out.push(await entryFile(entry)); return }
  if (!entry.isDirectory) return
  const reader = entry.createReader()
  // readEntries returns at most ~100 items per call: repeat until it comes back empty.
  for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
    for (const child of batch) await walk(child, out)
  }
}

export function collectDroppedFiles(dataTransfer) {
  const entries = [...(dataTransfer.items || [])]
    .filter(item => item.kind === 'file')
    .map(item => item.webkitGetAsEntry?.())
  const plain = [...(dataTransfer.files || [])]
  const collect = entries.length && entries.every(Boolean)
    ? (async () => { const out = []; for (const entry of entries) await walk(entry, out); return out })()
    : Promise.resolve(plain)
  return collect.then(files => ({
    files: files.filter(file => isDicomName(file.name)),
    skipped: files.filter(file => !isDicomName(file.name)).length,
  }))
}
