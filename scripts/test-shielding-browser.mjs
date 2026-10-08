import { createServer } from 'vite'
import { runBrowserHarness } from './browser-harness.mjs'

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
    const chrome = process.env.SHIELDING_CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome')
    const result = await runBrowserHarness({ chrome,
      url: `http://127.0.0.1:${server.httpServer.address().port}/__shielding_test__`,
      resultId: 'shielding-test-result', width: 1440 })
    console.log(result)
  } finally { await server.close() }
}
