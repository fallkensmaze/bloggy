import { analyzeTomoUniformity } from './tomoUniformity.js'

self.onmessage = ({ data }) => {
  try {
    const result = analyzeTomoUniformity(data.series, data.config, progress => self.postMessage({ type: 'progress', progress }))
    self.postMessage({ type: 'result', result })
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message })
  }
}
