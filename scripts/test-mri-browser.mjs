import { createServer } from 'vite'
import { runBrowserHarness } from './browser-harness.mjs'

const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><pre id="mri-result">RUNNING</pre><script type="module" src="/scripts/mri-browser-checks.js"></script></body></html>'
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'mri-test-harness', configureServer(vite) {
  vite.middlewares.use(async (req, res, next) => {
    if (req.url !== '/__mri_test__') return next()
    try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__mri_test__', html)) }
    catch (e) { next(e) }
  })
} }] })
try {
  await server.listen()
  const port = server.httpServer.address().port
  await runBrowserHarness({ chrome: process.env.MRI_CHROME || 'google-chrome',
    url: `http://127.0.0.1:${port}/__mri_test__`, resultId: 'mri-result' })
  console.log('MRI browser: XML parsing and React demo/upload/filter/comparison/reset checks passed.')
} finally {
  await server.close()
}
