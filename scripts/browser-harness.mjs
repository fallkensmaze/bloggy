import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

// Poll the test result with real time. Chrome's virtual-time dump-dom can run
// timers to exhaustion while FileReader, workers or Vite imports still await IO.
export async function runBrowserHarness({ chrome = 'google-chrome', url, resultId, width = 1200, height = 1000, timeout = 90000 }) {
  const profile = await mkdtemp(join(tmpdir(), 'browser-harness-'))
  let child, socket, stderr = '', nextId = 0
  const pending = new Map()
  const deadline = Date.now() + timeout
  try {
    child = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
    let launchError
    child.on('error', error => { launchError = error })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000) })
    while (!/DevTools listening on (ws:\/\/\S+)/.test(stderr)) {
      if (launchError) throw launchError
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Chrome did not start: ${stderr}`)
      await pause(50)
    }
    const endpoint = new URL(stderr.match(/DevTools listening on (ws:\/\/\S+)/)[1])
    const targets = await (await fetch(`http://${endpoint.host}/json/list`)).json()
    const page = targets.find(target => target.type === 'page')
    if (!page) throw new Error('Chrome did not expose a page target')
    socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result)
    })
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const bounded = promise => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser harness deadline exceeded')), Math.max(1, deadline - Date.now()))
      promise.then(resolve, reject).finally(() => clearTimeout(timer))
    })
    await bounded(command('Page.navigate', { url }))
    let result = ''
    while (Date.now() < deadline) {
      const response = await bounded(command('Runtime.evaluate', {
        expression: `document.getElementById(${JSON.stringify(resultId)})?.textContent ?? ''`, returnByValue: true,
      }))
      result = response.result?.value || ''
      if (result.startsWith('PASS')) return result
      if (result.startsWith('FAIL')) throw new Error(result)
      if (child.exitCode !== null) throw new Error(`Chrome exited: ${stderr}`)
      await pause(100)
    }
    throw new Error(`Browser checks timed out: ${result}`)
  } finally {
    socket?.close()
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill('SIGKILL')
      await exited
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3 })
  }
}
