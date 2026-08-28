import { FdtdSimulationFallback } from './fdtdFallback'

let backendPromise

export function loadFdtdBackend() {
  if (!backendPromise) backendPromise = loadBackend()
  return backendPromise
}

async function loadBackend() {
  try {
    const base = import.meta.env.BASE_URL || '/'
    const moduleUrl = `${base}wasm/fdtd_wasm.js?v=3`
    const wasm = await import(/* @vite-ignore */ moduleUrl)
    await wasm.default()
    return {
      Simulation: wasm.FdtdSimulation,
      label: 'Rust · WebAssembly',
      isWasm: true
    }
  } catch (error) {
    console.warn('El módulo FDTD WebAssembly no está disponible; se usa el núcleo JavaScript.', error)
    return {
      Simulation: FdtdSimulationFallback,
      label: 'JavaScript · compatibilidad',
      isWasm: false
    }
  }
}
