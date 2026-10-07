import { createServer } from 'vite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"></head><body><div id="root"></div><pre id="shielding-test-result">RUNNING</pre><script type="module" src="/scripts/shielding-browser-checks.jsx"></script></body></html>'
export async function startHarness() {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'shielding-test-harness', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/__shielding_test__')) return next()
      try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__shielding_test__', html)) } catch (e) { next(e) }
    })
  } }] })
  await server.listen()
  return server
}
const server = await startHarness()
if (process.argv.includes('--serve')) {
  console.log(`Shielding preview: http://127.0.0.1:${server.httpServer.address().port}/__shielding_test__?preview=1`)
} else {
  try {
    const profile = await mkdtemp(join(tmpdir(), 'shielding-browser-'))
    const chrome = process.env.SHIELDING_CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome')
    const { stdout } = await promisify(execFile)(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--window-size=1440,1000', '--virtual-time-budget=60000', '--dump-dom', `http://127.0.0.1:${server.httpServer.address().port}/__shielding_test__`], { timeout: 90000, maxBuffer: 4 * 1024 * 1024 })
    const result = stdout.match(/<pre id="shielding-test-result"[^>]*>([\s\S]*?)<\/pre>/)?.[1]
    if (!result?.startsWith('PASS')) throw new Error(result || stdout.slice(-5000))
    console.log(result)
    // Browser profiles are retained in the OS temp directory for diagnostics.
  } finally { await server.close() }
}
