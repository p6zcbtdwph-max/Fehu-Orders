import type { Api } from '../shared/ipc'

declare global {
  interface Window {
    api: Api
    /** Nur in Electron vorhanden, im Browser (Tests, Vorschau) fehlt es */
    fehuDisplay?: { setZoom(factor: number): void }
  }
}
