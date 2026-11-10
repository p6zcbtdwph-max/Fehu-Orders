import { app, BrowserWindow, ipcMain, Notification, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { Kraken, type PairInfo } from './kraken'
import {
  addPlan, clearCredentials, deleteTemplate, getNotified, getPlans, getSettings, getTemplates, loadCredentials, newUserref, saveCredentials, saveSettings, saveTemplate, setNotified,
} from './store'
import type { PlanStatusDto, SendRequest, SendResult, TemplateDto } from '../shared/ipc'
import { planStatus, type OrderSnapshot } from '../shared/plan-status'

let pairCache: PairInfo[] | null = null
let mainWindow: BrowserWindow | null = null
const client = () => new Kraken(loadCredentials())

function createWindow(): void {
  const win = (mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'Fehu Orders',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false },
  }))
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

handle('ohlc', (pairId: string, interval: number) => client().ohlc(pairId, interval))
handle('fees', (pairId: string) => client().fees(pairId))
handle('available', () => client().available())
handle('templates', () => getTemplates())
handle('template:save', (t: TemplateDto) => saveTemplate(t))
handle('template:delete', (id: string) => deleteTemplate(id))
handle('plans:status', () => computeStatuses())

/** Pläne, deren Status abgefragt wird: die letzten 90 Tage, höchstens 20 */
function activePlans() {
  const since = Date.now() - 90 * 86_400_000
  return getPlans().filter((p) => Date.parse(p.createdAt) >= since).slice(0, 20)
}

let statusCache: { at: number; value: PlanStatusDto[]; executed: Map<number, string[]> } | null = null

async function computeStatuses(): Promise<PlanStatusDto[]> {
  if (statusCache && Date.now() - statusCache.at < 20_000) return statusCache.value
  const k = client()
  const plans = activePlans()
  const open = plans.length ? await k.openOrders() : []
  const value: PlanStatusDto[] = []
  const executed = new Map<number, string[]>()
  for (const p of plans) {
    const closed = await k.closedOrders(p.userref)
    const snaps: OrderSnapshot[] = [
      ...open.filter((o) => o.userref === p.userref).map((o) => ({ txid: o.txid, status: 'open', volume: o.volume, filled: o.filled, cost: o.cost, fee: o.fee, price: o.price })),
      ...closed.map((o) => ({ txid: o.txid, status: o.status, volume: o.volume, filled: o.filled, cost: o.cost, fee: o.fee, price: o.price })),
    ]
    const st = planStatus(snaps)
    executed.set(p.userref, st.executedTxids)
    const { executedTxids: _, ...rest } = st
    value.push({ userref: p.userref, ...rest })
  }
  statusCache = { at: Date.now(), value, executed }
  return value
}

/** Prüft jede Minute, ob Orders ausgeführt wurden, und meldet neue per Mitteilung */
async function pollFills(): Promise<void> {
  if (!loadCredentials() || !activePlans().length) return
  try {
    statusCache = null
    await computeStatuses()
  } catch {
    return // Netz oder Kraken gerade nicht erreichbar, nächste Minute neu
  }
  const cache = statusCache as { executed: Map<number, string[]> } | null
  const known = getNotified()
  const firstRun = known.length === 0
  const fresh: { pair: string; side: string; count: number }[] = []
  for (const p of activePlans()) {
    const txids = cache?.executed.get(p.userref) ?? []
    const neu = txids.filter((t) => !known.includes(t))
    if (neu.length) fresh.push({ pair: p.pairName, side: p.side === 'buy' ? 'Kauf' : 'Verkauf', count: neu.length })
    known.push(...neu)
  }
  setNotified(known.length ? known : ['-'])
  if (firstRun || !fresh.length) return
  for (const f of fresh) {
    if (Notification.isSupported()) new Notification({ title: 'Fehu Orders', body: `${f.count} ${f.count === 1 ? 'Order' : 'Orders'} ausgeführt: ${f.pair} ${f.side}` }).show()
  }
  mainWindow?.webContents.send('fills')
}

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
  setTimeout(pollFills, 10_000)
  setInterval(pollFills, 60_000)
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
