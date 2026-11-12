import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, session, shell, systemPreferences } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseBackup, summarize } from '../shared/backup'
import { localDate } from '../shared/dates'
import { join } from 'node:path'
import { Kraken, type ClosedOrder, type PairInfo } from './kraken'
import {
  addLog, addPlan, clearCredentials, exportAll, importAll, getLog, markAlarmFired, deleteDraft, deleteTemplate, getDrafts, markDraftReleased, saveDraft, getNotified, getPlans, getSettings, getTemplates, loadCredentials, newUserref, saveCredentials, saveSettings, saveTemplate, setNotified, updatePlan, type Settings,
} from './store'
import type { DraftDto, LogEntry, PlanStatusDto, SaveKeyResult, SendRequest, SendResult, TemplateDto } from '../shared/ipc'
import { alarmHit, checkKeyFormat, priceGuard } from '../shared/safety'
import { planStatus, type OrderSnapshot } from '../shared/plan-status'

let pairCache: PairInfo[] | null = null
let mainWindow: BrowserWindow | null = null
// Eine gemeinsame Verbindung, damit alle privaten Anfragen nacheinander laufen
// (Kraken lehnt Zeitstempel ab, die nicht in steigender Reihenfolge ankommen)
let shared: Kraken | null = null
const client = () => (shared ??= new Kraken(loadCredentials()))
// Neuer Schlüssel kann ein anderes Konto sein: dann auch die geladenen geschlossenen Orders verwerfen
const resetClient = () => {
  shared = null
  closedCache.orders.clear()
  closedCache.coveredFrom = Infinity
  closedCache.fetchedAt = 0
  statusCache = null
}

function createWindow(): void {
  const win = (mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'Fehu Orders',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  }))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // Das Fenster zeigt nur die App selbst. Jeder Versuch, woandershin zu navigieren, wird blockiert.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOwnUrl(url) && !url.startsWith('blob:')) e.preventDefault()
  })
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
  // Links öffnen im Browser, nicht in der App
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Gehört eine Adresse zur App selbst (gebaute Datei oder Entwicklungs-Server)? */
function isOwnUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) return url.startsWith(new URL(dev).origin)
  return url.startsWith('file://')
}

function handle(channel: string, fn: (...args: any[]) => any): void {
  // Fehler als einfache Meldung weitergeben, ohne Stacktrace oder Schlüssel
  ipcMain.handle(channel, async (e, ...args) => {
    // Nur das eigene App-Fenster darf Befehle schicken
    if (!e.senderFrame || !isOwnUrl(e.senderFrame.url)) return { ok: false, error: 'Nicht erlaubt.' }
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}

handle('key:status', () => ({ hasKey: loadCredentials() !== null, encryption: safeStorage.isEncryptionAvailable(), touchId: touchIdAvailable() }))
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
  addLog({ action: 'key-save', success: saved, message: saved ? 'Schlüssel gespeichert' : `Nicht gespeichert: ${checks.filter((c) => !c.ok).map((c) => c.label).join(', ')}` })
  return { saved, checks }
})
handle('key:verify', () => client().checkPermissions())
handle('key:clear', () => {
  clearCredentials()
  resetClient()
  addLog({ action: 'key-clear', success: true, message: 'Schlüssel gelöscht' })
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
  if (s.numberFormat === 'de' || s.numberFormat === 'en') patch.numberFormat = s.numberFormat
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
/** Führt eine Aktion aus und schreibt Erfolg oder Fehler ins Protokoll */
async function logged<T>(base: Omit<LogEntry, 'at' | 'success'>, fn: () => Promise<T>, done?: (r: T) => Partial<LogEntry>): Promise<T> {
  try {
    const r = await fn()
    addLog({ ...base, success: true, ...(done?.(r) ?? {}) })
    return r
  } catch (e) {
    addLog({ ...base, success: false, message: (e as Error).message })
    throw e
  }
}

handle('plan:cancel', (userref: number) => {
  const plan = getPlans().find((p) => p.userref === userref)
  return logged({ action: 'cancel-plan', userref, pair: plan?.pairName, side: plan?.side }, () => client().cancelPlan(userref), (n) => ({ count: n, message: `${n} Orders storniert` }))
})
handle('order:cancel', (txid: string) => logged({ action: 'cancel-order', message: txid }, () => client().cancelOrder(txid)))
handle('orders:cancelAll', () => logged({ action: 'cancel-all' }, () => client().cancelAll(), (n) => ({ count: n, message: `Notbremse: ${n} Orders storniert` })))
handle('system:status', () => client().systemStatus())
handle('log', () => getLog())

// Datensicherung: alles außer dem Schlüssel in eine Datei
handle('backup:export', async () => {
  const name = `fehu-orders-sicherung-${localDate()}.json`
  const r = await dialog.showSaveDialog({ title: 'Fehu Orders sichern', defaultPath: join(app.getPath('documents'), name), filters: [{ name: 'Fehu-Orders-Sicherung', extensions: ['json'] }] })
  if (r.canceled || !r.filePath) return null
  const data = exportAll()
  writeFileSync(r.filePath, JSON.stringify(data, null, 2))
  return { path: r.filePath, ...summarize(data) }
})
// Schritt 1: Datei wählen und prüfen (noch nichts ändern)
let pendingRestore: ReturnType<typeof parseBackup> | null = null
handle('backup:pick', async () => {
  const r = await dialog.showOpenDialog({ title: 'Sicherung wiederherstellen', properties: ['openFile'], filters: [{ name: 'Fehu-Orders-Sicherung', extensions: ['json'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  pendingRestore = parseBackup(readFileSync(r.filePaths[0], 'utf8'))
  return summarize(pendingRestore)
})
// Schritt 2: nach Bestätigung einspielen
handle('backup:restore', () => {
  if (!pendingRestore) throw new Error('Bitte zuerst eine Sicherung auswählen.')
  const safety = importAll(pendingRestore)
  pendingRestore = null
  statusCache = null
  addLog({ action: 'restore', success: true, message: 'Sicherung wiederhergestellt' })
  return safety
})

handle('ohlc', (pairId: string, interval: number) => client().ohlc(pairId, interval))
handle('fees', (pairId: string) => client().fees(pairId))
handle('available', () => client().available())
handle('templates', () => getTemplates())
handle('template:save', (t: TemplateDto) => saveTemplate(t))
handle('template:delete', (id: string) => deleteTemplate(id))
handle('plans:status', () => computeStatuses())
handle('drafts', () => getDrafts())
// Beim Speichern wird ein ausgelöster Kursalarm wieder scharf
handle('draft:save', (d: DraftDto) => saveDraft({ ...d, alarmFiredAt: undefined }))
handle('draft:delete', (id: string) => deleteDraft(id))

/**
 * Pläne, deren Status abgefragt wird: alle der letzten 90 Tage, dazu ältere, die laut Kraken noch offene Orders haben.
 * Keine feste Höchstzahl mehr: geschlossene Orders kommen für alle Pläne aus einer gemeinsamen, zwischengespeicherten Abfrage.
 */
function activePlans(openRefs: Set<number> = lastOpenRefs) {
  const since = Date.now() - 90 * 86_400_000
  return getPlans().filter((p) => Date.parse(p.createdAt) >= since || openRefs.has(p.userref))
}
/** userrefs mit offenen Orders aus der letzten Abfrage (für activePlans ohne neue Anfrage) */
let lastOpenRefs = new Set<number>()

let statusCache: { at: number; value: PlanStatusDto[]; executed: Map<number, string[]> } | null = null

/**
 * Geschlossene Orders, einmal vollständig geladen und danach nur noch ergänzt.
 * Geschlossene Orders ändern sich nicht mehr, deshalb reicht beim nächsten Mal alles seit der letzten Abfrage.
 * So fehlen auch bei vielen hundert stornierten Orders keine Ausführungen älterer Pläne.
 */
const closedCache: { orders: Map<string, ClosedOrder>; coveredFrom: number; fetchedAt: number } = { orders: new Map(), coveredFrom: Infinity, fetchedAt: 0 }

async function closedOrdersFrom(k: Kraken, from: number): Promise<ClosedOrder[]> {
  const now = Date.now() / 1000
  // Lücke vorne (neuer, älterer Plan) → ab dort komplett laden, sonst nur das Neue (mit 2 Minuten Überlappung)
  const start = from < closedCache.coveredFrom ? from : closedCache.fetchedAt - 120
  const fresh = await k.closedOrdersSince(start, 100)
  for (const o of fresh) closedCache.orders.set(o.txid, o)
  closedCache.coveredFrom = Math.min(closedCache.coveredFrom, start)
  closedCache.fetchedAt = now
  return [...closedCache.orders.values()]
}

async function computeStatuses(): Promise<PlanStatusDto[]> {
  if (statusCache && Date.now() - statusCache.at < 20_000) return statusCache.value
  const k = client()
  const open = getPlans().length ? await k.openOrders() : []
  lastOpenRefs = new Set(open.map((o) => o.userref))
  const plans = activePlans(lastOpenRefs)
  // eine Abfrage für alle Pläne statt einer pro Plan (Krakens Anfrage-Grenze)
  const since = plans.length ? Math.min(...plans.map((p) => Date.parse(p.createdAt))) / 1000 - 60 : 0
  const allClosed = plans.length ? await closedOrdersFrom(k, since) : []
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
  if (!loadCredentials() || !getPlans().length) return
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

/**
 * Dritte Sicherung: Kurs unmittelbar vor dem Senden frisch holen. Liegen Stufen auf der
 * falschen Seite (Kauf über, Verkauf unter dem Kurs), wird nichts gesendet.
 */
async function freshPriceGuard(pairId: string, side: 'buy' | 'sell', levels: { price: number }[], base: Omit<LogEntry, 'at' | 'success'>): Promise<void> {
  let last: number
  try {
    last = await client().lastPrice(pairId)
  } catch (e) {
    const msg = `Der aktuelle Kurs konnte nicht geprüft werden, deshalb wurde nichts gesendet. ${(e as Error).message}`
    addLog({ ...base, success: false, message: msg })
    throw new Error(msg)
  }
  const msg = priceGuard(side, levels.map((l) => l.price), last, (n) => `${n} €`)
  if (msg) {
    addLog({ ...base, success: false, message: msg })
    throw new Error(msg)
  }
}

function logResult(base: Omit<LogEntry, 'at' | 'success'>, orders: SendResult['orders']): void {
  const ok = orders.filter((o) => o.txid || (base.action === 'validate' && !o.error)).length
  const failed = orders.filter((o) => o.error).length
  const firstError = orders.find((o) => o.error)?.error
  addLog({ ...base, ok, failed, success: failed === 0, message: firstError ?? (base.action === 'validate' ? 'Probelauf ohne Fehler' : `${ok} Orders angelegt`) })
}

/** Hat dieser Mac Touch ID (und ist ein Finger eingerichtet)? */
function touchIdAvailable(): boolean {
  try {
    return process.platform === 'darwin' && systemPreferences.canPromptTouchID()
  } catch {
    return false
  }
}

/**
 * Zweite Ebene vor jedem echten Senden: Touch ID.
 * Das Bestätigungsfenster schützt vor Versehen, Touch ID davor, dass jemand anderes an deinem offenen Mac klickt.
 * Ohne Touch ID (älterer Mac, kein Finger eingerichtet) bleibt es beim Bestätigungsfenster.
 */
async function confirmWithTouchId(reason: string, base: Omit<LogEntry, 'at' | 'success'>): Promise<void> {
  if (!touchIdAvailable()) return
  try {
    await systemPreferences.promptTouchID(reason)
  } catch {
    const msg = 'Touch ID wurde abgebrochen oder nicht erkannt. Es wurde nichts gesendet.'
    addLog({ ...base, success: false, message: msg })
    throw new Error(msg)
  }
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
  const base = { action: req.validate ? 'validate' : 'send', pair: req.pairName, side: req.side, count: levels.length, amount: total }
  if (!req.validate) await confirmWithTouchId(`${levels.length} echte Orders über ${total.toFixed(2)} € an Kraken senden`, base)
  await freshPriceGuard(req.pairId, req.side, levels, base)
  const userref = newUserref()
  let orders: SendResult['orders']
  try {
    orders = await client().placeLadder(req.pairId, req.side, levels, { validate: req.validate, userref, postOnly: req.postOnly })
  } catch (e) {
    addLog({ ...base, success: false, message: (e as Error).message })
    throw e
  }
  logResult({ ...base, userref: req.validate ? undefined : userref }, orders)
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
  const base = { action: validate ? 'validate' : 'rest', pair: plan.pairName, side: plan.side, count: rest.length, amount: total, userref }
  if (!validate) await confirmWithTouchId(`${rest.length} weitere echte Orders über ${total.toFixed(2)} € an Kraken senden`, base)
  await freshPriceGuard(plan.pairId, plan.side, rest, base)
  let orders: SendResult['orders']
  try {
    orders = await client().placeLadder(plan.pairId, plan.side, rest, { validate, userref, postOnly: plan.postOnly ?? true })
  } catch (e) {
    addLog({ ...base, success: false, message: (e as Error).message })
    throw e
  }
  logResult(base, orders)
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

/** Kursalarm: meldet einmal, wenn der Kurs die erste Stufe eines Entwurfs erreicht. Sendet nichts. */
async function pollAlarms(): Promise<void> {
  const armed = getDrafts().filter((d) => d.status === 'draft' && d.alarm && !d.alarmFiredAt)
  if (!armed.length) return
  let prices: Record<string, number>
  try {
    prices = await client().lastPrices([...new Set(armed.map((d) => d.pairId))])
  } catch {
    return // nächste Minute neu
  }
  const hit = armed.filter((d) => alarmHit(d.side, d.input.priceStart, prices[d.pairId]))
  if (!hit.length) return
  markAlarmFired(hit.map((d) => d.id))
  for (const d of hit) {
    addLog({ action: 'alarm', pair: d.pairName, side: d.side, success: true, message: `Kursalarm „${d.name}“: Kurs ${prices[d.pairId]} hat die erste Stufe ${d.input.priceStart} erreicht` })
    if (!Notification.isSupported()) continue
    const n = new Notification({
      title: `Kursalarm${d.scenario ? `: ${d.scenario}` : ''}`,
      body: `${d.pairName} steht bei ${prices[d.pairId]} € und hat die erste Stufe von „${d.name}“ erreicht. Freigeben kannst du ihn unter Entwürfe.`,
    })
    n.on('click', () => {
      if (!mainWindow) createWindow()
      mainWindow?.show()
      mainWindow?.focus()
      mainWindow?.webContents.send('open-page', 'drafts')
    })
    n.show()
  }
}

app.whenReady().then(() => {
  // Das Fenster braucht keine Kamera, kein Mikrofon, keinen Standort usw.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  createWindow()
  setTimeout(pollFills, 10_000)
  setInterval(pollFills, 60_000)
  setTimeout(pollAlarms, 15_000)
  setInterval(pollAlarms, 60_000)
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
