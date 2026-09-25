import { createServer } from 'vite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><pre id="mri-result">RUNNING</pre><script type="module" src="/scripts/mri-browser-checks.js"></script></body></html>'
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'mri-test-harness', configureServer(vite) {
  vite.middlewares.use(async (req, res, next) => {
    if (req.url !== '/__mri_test__') return next()
    try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__mri_test__', html)) }
    catch (e) { next(e) }
  })
} }] })
let profile
try {
  await server.listen()
  profile = await mkdtemp(join(tmpdir(), 'mri-chrome-'))
  const port = server.httpServer.address().port
  const { stdout } = await promisify(execFile)(process.env.MRI_CHROME || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--window-size=1200,1000', '--virtual-time-budget=15000', '--dump-dom', `http://127.0.0.1:${port}/__mri_test__`,
  ], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
  if (!/id="mri-result"[^>]*>PASS/.test(stdout)) {
    console.error(stdout)
    throw new Error('MRI browser checks failed or did not complete. See mri-result above.')
  }
  console.log('MRI browser: XML parsing and React demo/upload/filter/comparison/reset checks passed.')
} finally {
  await server.close()
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3 })
}
