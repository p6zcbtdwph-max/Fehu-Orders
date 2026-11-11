import { app, BrowserWindow, ipcMain, Notification, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { Kraken, type PairInfo } from './kraken'
import {
  addPlan, clearCredentials, deleteDraft, deleteTemplate, getDrafts, markDraftReleased, saveDraft, getNotified, getPlans, getSettings, getTemplates, loadCredentials, newUserref, saveCredentials, saveSettings, saveTemplate, setNotified, updatePlan, type Settings,
} from './store'
import type { DraftDto, PlanStatusDto, SaveKeyResult, SendRequest, SendResult, TemplateDto } from '../shared/ipc'
import { checkKeyFormat } from '../shared/safety'
import { planStatus, type OrderSnapshot } from '../shared/plan-status'

let pairCache: PairInfo[] | null = null
let mainWindow: BrowserWindow | null = null
// Eine gemeinsame Verbindung, damit alle privaten Anfragen nacheinander laufen
// (Kraken lehnt Zeitstempel ab, die nicht in steigender Reihenfolge ankommen)
let shared: Kraken | null = null
const client = () => (shared ??= new Kraken(loadCredentials()))
const resetClient = () => { shared = null }

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
handle('key:save', async (key: string, secret: string): Promise<SaveKeyResult> => {
  const creds = { key: String(key).trim(), secret: String(secret).trim() }
  const format = checkKeyFormat(creds.key, creds.secret)
  if (format.length) throw new Error(format.join(' '))
  // erst alle Rechte prüfen, dann speichern. Ein Schlüssel mit Auszahlungsrecht wird nicht gespeichert.
  const checks = await new Kraken(creds).checkPermissions()
  const saved = checks.every((c) => c.ok)
  if (saved) {
    saveCredentials(creds)
    resetClient()
  }
  return { saved, checks }
})
handle('key:verify', () => client().checkPermissions())
handle('key:clear', () => {
  clearCredentials()
  resetClient()
})
handle('pairs', async () => (pairCache ??= await client().pairs()))
handle('price', (pairId: string) => client().lastPrice(pairId))
handle('prices', (pairIds: string[]) => client().lastPrices(pairIds.filter((x) => typeof x === 'string').slice(0, 50)))
handle('balances', () => client().balances())
handle('orders:open', () => client().openOrders())
handle('plans', () => getPlans())
handle('settings', () => getSettings())
handle('settings:save', (s: Partial<Settings>) => {
  const patch: Partial<Settings> = {}
  if (s.maxPlanEur !== undefined) patch.maxPlanEur = Math.max(1, Number(s.maxPlanEur) || 1)
  if (Array.isArray(s.watchlist)) patch.watchlist = s.watchlist.filter((x) => typeof x === 'string').slice(0, 50)
  if (s.currency === 'EUR' || s.currency === 'USD') patch.currency = s.currency
  return saveSettings(patch)
})
// Wechselkurs für die Dollar-Anzeige (1 EUR = x USD), eine Minute zwischengespeichert
let usdCache: { at: number; rate: number } | null = null
handle('usdRate', async () => {
  if (usdCache && Date.now() - usdCache.at < 60_000) return usdCache.rate
  const rate = await client().lastPrice('EURUSD')
  usdCache = { at: Date.now(), rate }
  return rate
})
handle('plan:cancel', (userref: number) => client().cancelPlan(userref))
handle('order:cancel', (txid: string) => client().cancelOrder(txid))

handle('ohlc', (pairId: string, interval: number) => client().ohlc(pairId, interval))
handle('fees', (pairId: string) => client().fees(pairId))
handle('available', () => client().available())
handle('templates', () => getTemplates())
handle('template:save', (t: TemplateDto) => saveTemplate(t))
handle('template:delete', (id: string) => deleteTemplate(id))
handle('plans:status', () => computeStatuses())
handle('drafts', () => getDrafts())
handle('draft:save', (d: DraftDto) => saveDraft(d))
handle('draft:delete', (id: string) => deleteDraft(id))

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
  // eine Abfrage für alle Pläne statt einer pro Plan (Krakens Anfrage-Grenze)
  const since = plans.length ? Math.min(...plans.map((p) => Date.parse(p.createdAt))) / 1000 - 60 : 0
  const allClosed = plans.length ? await k.closedOrdersSince(since) : []
  const value: PlanStatusDto[] = []
  const executed = new Map<number, string[]>()
  for (const p of plans) {
    const closed = allClosed.filter((o) => o.userref === p.userref)
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

/** Zweite Sicherung im Hauptprozess: Obergrenze pro Sendung */
function checkLimit(levels: { price: number; volume: number }[]): number {
  const total = levels.reduce((a, l) => a + l.price * l.volume, 0)
  const { maxPlanEur } = getSettings()
  if (total > maxPlanEur) throw new Error(`Diese Sendung hat einen Gegenwert von ${total.toFixed(2)} €. Deine Obergrenze ist ${maxPlanEur} €. Du kannst sie in den Einstellungen ändern.`)
  return total
}

handle('send', async (req: SendRequest): Promise<SendResult> => {
  const valid = req.levels.filter((l) => !l.problem)
  if (!valid.length) throw new Error('Keine gültigen Stufen.')
  const count = req.sendCount ? Math.max(1, Math.min(valid.length, Math.floor(req.sendCount))) : valid.length
  const levels = valid.slice(0, count)
  const total = checkLimit(levels)
  const userref = newUserref()
  const orders = await client().placeLadder(req.pairId, req.side, levels, { validate: req.validate, userref, postOnly: req.postOnly })
  if (!req.validate) {
    const ok = orders.filter((o) => o.txid)
    // Unklare Orders (Verbindung abgebrochen) gelten als gesendet, damit „Rest senden“ sie nicht doppelt schickt
    const maybe = orders.filter((o) => o.uncertain)
    if (ok.length + maybe.length > 0) {
      addPlan({
        userref, createdAt: new Date().toISOString(), pairId: req.pairId, pairName: req.pairName, side: req.side, input: req.input,
        sent: ok.length, failed: orders.length - ok.length, totalCost: total, levels: valid, sentIndices: [...ok, ...maybe].map((o) => o.index), postOnly: req.postOnly,
      })
      if (req.draftId) markDraftReleased(req.draftId, userref)
    }
  }
  return { userref, validate: req.validate, orders }
})

/** Restliche Stufen eines Plans nachschicken (gleiche userref, damit „Plan stornieren“ alles erfasst) */
handle('plan:rest', async (userref: number, validate: boolean): Promise<SendResult> => {
  const plan = getPlans().find((p) => p.userref === userref)
  if (!plan?.levels) throw new Error('Für diesen Plan sind keine Stufen gespeichert.')
  const sent = new Set(plan.sentIndices ?? [])
  const rest = plan.levels.filter((l) => !sent.has(l.index))
  if (!rest.length) throw new Error('Alle Stufen dieses Plans sind schon gesendet.')
  const total = checkLimit(rest)
  const orders = await client().placeLadder(plan.pairId, plan.side, rest, { validate, userref, postOnly: plan.postOnly ?? true })
  if (!validate) {
    const ok = orders.filter((o) => o.txid)
    const maybe = orders.filter((o) => o.uncertain)
    updatePlan(userref, (p) => ({
      ...p, sent: p.sent + ok.length, failed: p.failed + orders.length - ok.length, totalCost: p.totalCost + (ok.length ? total : 0),
      sentIndices: [...(p.sentIndices ?? []), ...ok.map((o) => o.index), ...maybe.map((o) => o.index)],
    }))
  }
  return { userref, validate, orders }
})

app.whenReady().then(() => {
  createWindow()
  setTimeout(pollFills, 10_000)
  setInterval(pollFills, 60_000)
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
