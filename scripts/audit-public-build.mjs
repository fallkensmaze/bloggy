import { execFileSync } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const rootDir = process.cwd()
const distDir = path.join(rootDir, 'dist')
const failures = []

const normalize = (filePath) => filePath.replaceAll('\\', '/')

const trackedChecks = [
  [/(^|\/)\.claude\//, 'local Claude settings'],
  [/(^|\/)\.vscode\//, 'local editor settings'],
  [/(^|\/)firestore\.rules$/i, 'production Firestore rules'],
  [/(^|\/)\.env(?:\.|$)/i, 'environment file'],
  [/(^|\/)borrar\//i, 'scratch file'],
  [/(^|\/)NEMA\//, 'legacy local module'],
  [/\.(?:dcm|dicom|ima|xlsx?|pem|key|p12|pfx)$/i, 'clinical export or private key'],
  [/(?:firebase-adminsdk|service-account).*\.json$/i, 'service account file'],
]

const distChecks = [
  [/(^|\/)\.git(\/|$)/i, 'Git metadata'],
  [/(^|\/)firestore\.rules$/i, 'Firestore rules'],
  [/(^|\/)\.env(?:\.|$)/i, 'environment file'],
  [/\.(?:dcm|dicom|ima|xlsx?|pem|key|p12|pfx|map)$/i, 'non-public artifact'],
  [/(?:firebase-adminsdk|service-account).*\.json$/i, 'service account file'],
]

const secretChecks = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/"private_key"\s*:/, 'service account private key'],
  [/"client_secret"\s*:/, 'OAuth client secret'],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'API secret'],
]

function findFailure(filePath, checks) {
  const normalized = normalize(filePath)
  return checks.find(([pattern]) => pattern.test(normalized))
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath))
    } else {
      files.push(fullPath)
    }
  }

  return files
}

const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)

for (const filePath of trackedFiles) {
  const normalizedPath = normalize(filePath)
  const match = findFailure(filePath, trackedChecks)
  if (match) {
    failures.push(`tracked: ${normalizedPath} (${match[1]})`)
  }

  if (normalizedPath === 'scripts/audit-public-build.mjs') continue

  const absolutePath = path.join(rootDir, filePath)
  const fileStats = await stat(absolutePath)
  if (fileStats.size > 5 * 1024 * 1024) continue

  const content = await readFile(absolutePath, 'utf8')
  for (const [pattern, label] of secretChecks) {
    if (pattern.test(content)) {
      failures.push(`tracked: ${normalizedPath} contains ${label}`)
    }
  }
}

let distFiles = []
try {
  distFiles = await walk(distDir)
} catch {
  failures.push('dist/: build output is missing')
}

for (const requiredPath of ['index.html', 'assets', 'Informe-Tanques-Terminal.html']) {
  try {
    await stat(path.join(distDir, requiredPath))
  } catch {
    failures.push(`dist/: missing required artifact ${requiredPath}`)
  }
}

for (const absolutePath of distFiles) {
  const relativePath = normalize(path.relative(distDir, absolutePath))
  const match = findFailure(relativePath, distChecks)
  if (match) {
    failures.push(`dist: ${relativePath} (${match[1]})`)
  }

  const fileStats = await stat(absolutePath)
  if (fileStats.size > 5 * 1024 * 1024) continue

  const content = await readFile(absolutePath, 'utf8')
  for (const [pattern, label] of secretChecks) {
    if (pattern.test(content)) {
      failures.push(`dist: ${relativePath} contains ${label}`)
    }
  }
}

if (failures.length > 0) {
  console.error('Public artifact audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Public artifact audit passed: ${trackedFiles.length} tracked files and ${distFiles.length} dist files checked.`)
