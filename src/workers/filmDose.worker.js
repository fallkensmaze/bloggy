import { analyzeFilmImage } from '../utils/filmAnalysis.js'

self.onmessage = (event) => {
  if (event.data?.type !== 'analyze') return
  try {
    const result = analyzeFilmImage({
      ...event.data.payload,
      onProgress: (fraction) => self.postMessage({ type: 'progress', fraction })
    })
    const transfer = [
      result.dose.buffer,
      result.sigma.buffer,
      result.delta.buffer,
      result.outOfRange.buffer,
      result.saturated.buffer,
      result.invalid.buffer,
      result.lateralOutOfRange.buffer
    ]
    self.postMessage({ type: 'result', result }, transfer)
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) })
  }
}
