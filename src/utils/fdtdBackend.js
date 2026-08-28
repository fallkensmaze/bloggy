import { FdtdSimulationFallback } from './fdtdFallback'
import { FdtdSimulation3dFallback } from './fdtdCartesian3dFallback'

let backendPromise

export function loadFdtdBackend() {
  if (!backendPromise) backendPromise = loadBackend()
  return backendPromise
}

async function loadBackend() {
  try {
    const base = import.meta.env.BASE_URL || '/'
    const moduleUrl = `${base}wasm/fdtd_wasm.js?v=4`
    const wasm = await import(/* @vite-ignore */ moduleUrl)
    await wasm.default()
    if (typeof wasm.FdtdSimulation3d !== 'function') throw new Error('El módulo Wasm no incluye el solver cartesiano 3D.')
    return {
      Simulation: wasm.FdtdSimulation,
      Simulation3d: wasm.FdtdSimulation3d,
      label: 'Rust · WebAssembly',
      isWasm: true
    }
  } catch (error) {
    console.warn('El módulo FDTD WebAssembly no está disponible; se usa el núcleo JavaScript.', error)
    return {
      Simulation: FdtdSimulationFallback,
      Simulation3d: FdtdSimulation3dFallback,
      label: 'JavaScript · compatibilidad',
      isWasm: false
    }
  }
}
