// Zugriff auf Kraken: echt über den Hauptprozess oder im Demo-Modus über Beispieldaten
import type { Api } from '@shared/ipc'
import { createDemoApi } from './demo'

const DEMO_KEY = 'fehu-orders-demo'

function readFlag(): boolean {
  try { return localStorage.getItem(DEMO_KEY) === '1' } catch { return false }
}

let demo = readFlag()
let demoApi: Api | null = null

export function api(): Api {
  if (!demo) return window.api
  demoApi ??= createDemoApi()
  return demoApi
}

export const isDemo = () => demo

export function setDemo(on: boolean): void {
  demo = on
  demoApi = null // jede Demo startet frisch
  try { on ? localStorage.setItem(DEMO_KEY, '1') : localStorage.removeItem(DEMO_KEY) } catch { /* egal */ }
}
