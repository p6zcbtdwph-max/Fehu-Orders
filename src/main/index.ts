import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { Kraken, type PairInfo } from './kraken'
import { addPlan, clearCredentials, getPlans, getSettings, loadCredentials, newUserref, saveCredentials, saveSettings } from './store'
import type { SendRequest, SendResult } from '../shared/ipc'

let pairCache: PairInfo[] | null = null
const client = () => new Kraken(loadCredentials())

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'Fehu Orders',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false },
  })
  // Links öffnen im Browser, nicht in der App
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function handle(channel: string, fn: (...args: any[]) => any): void {
  // Fehler als einfache Meldung weitergeben, ohne Stacktrace oder Schlüssel
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}

handle('key:status', () => ({ hasKey: loadCredentials() !== null, encryption: safeStorage.isEncryptionAvailable() }))
handle('key:save', async (key: string, secret: string) => {
  const creds = { key: key.trim(), secret: secret.trim() }
  // erst prüfen, dann speichern
  await new Kraken(creds).balances()
  saveCredentials(creds)
})
handle('key:clear', () => clearCredentials())
handle('pairs', async () => (pairCache ??= await client().pairs()))
handle('price', (pairId: string) => client().lastPrice(pairId))
handle('balances', () => client().balances())
handle('orders:open', () => client().openOrders())
handle('plans', () => getPlans())
handle('settings', () => getSettings())
handle('settings:save', (s: { maxPlanEur: number }) => saveSettings({ maxPlanEur: Math.max(1, Number(s.maxPlanEur) || 1) }))
handle('plan:cancel', (userref: number) => client().cancelPlan(userref))
handle('order:cancel', (txid: string) => client().cancelOrder(txid))

handle('send', async (req: SendRequest): Promise<SendResult> => {
  const levels = req.levels.filter((l) => !l.problem)
  if (!levels.length) throw new Error('Keine gültigen Stufen.')
  // Zweite Sicherung im Hauptprozess: Obergrenze pro Plan
  const total = levels.reduce((a, l) => a + l.price * l.volume, 0)
  const { maxPlanEur } = getSettings()
  if (total > maxPlanEur) throw new Error(`Der Plan hat einen Gegenwert von ${total.toFixed(2)} €. Deine Obergrenze ist ${maxPlanEur} €. Du kannst sie in den Einstellungen ändern.`)
  const userref = newUserref()
  const orders = await client().placeLadder(req.pairId, req.side, levels, { validate: req.validate, userref, postOnly: req.postOnly })
  if (!req.validate) {
    const sent = orders.filter((o) => o.txid).length
    if (sent > 0)
      addPlan({ userref, createdAt: new Date().toISOString(), pairId: req.pairId, pairName: req.pairName, side: req.side, input: req.input, sent, failed: orders.length - sent, totalCost: total })
  }
  return { userref, validate: req.validate, orders }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
