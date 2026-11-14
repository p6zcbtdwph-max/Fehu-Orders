import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, session, shell, systemPreferences } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseBackup, summarize } from '../shared/backup'
import { localDate } from '../shared/dates'
import { join } from 'node:path'
import { Kraken } from './kraken'
import { Bitvavo } from './bitvavo'
import { Coinbase } from './coinbase'
import type { ClosedOrder, Credentials, Exchange, PairInfo } from './exchange'
import { EXCHANGE_IDS, exchangeName, exchangeOf, isExchangeId, sendLimit, type ExchangeId } from '../shared/exchanges'
import {
  addLog, addPlan, systemLocale, clearCredentials, exportAll, importAll, getLog, markAlarmFired, deleteDraft, deleteTemplate, getDrafts, markDraftReleased, saveDraft, getNotified, getPlans, getSettings, getTemplates, hasRealPlan, loadCredentials, newUserref, saveCredentials, saveSettings, saveTemplate, setNotified, updatePlan, type Settings,
} from './store'
import type { DraftDto, LogEntry, PlanStatusDto, SaveKeyResult, SendRequest, SendResult, TemplateDto } from '../shared/ipc'
import { alarmHit, checkKeyFormat, normalizeCoinbase, priceGuard } from '../shared/safety'
import { planStatus, type OrderSnapshot } from '../shared/plan-status'
import { conformLevels } from '../shared/ladder'
import { langFromLocale, setLang, tr } from '../shared/i18n'

/** Sprache aus den Einstellungen, sonst die Systemsprache des Macs */
const applyLanguage = () => setLang(getSettings().language ?? langFromLocale(systemLocale()))

let mainWindow: BrowserWindow | null = null

/** Neue Verbindung zu einer Börse */
export function createExchange(ex: ExchangeId, creds: Credentials | null): Exchange {
  if (ex === 'bitvavo') return new Bitvavo(creds)
  if (ex === 'coinbase') return new Coinbase(creds)
  return new Kraken(creds)
}

/** Börse, mit der die App gerade arbeitet (Einstellungen) */
const activeEx = (): ExchangeId => getSettings().exchange
// Je Börse eine gemeinsame Verbindung, damit alle privaten Anfragen nacheinander laufen
// (Kraken lehnt Zeitstempel ab, die nicht in steigender Reihenfolge ankommen)
const clients = new Map<ExchangeId, Exchange>()
const clientFor = (ex: ExchangeId): Exchange => {
  let c = clients.get(ex)
  if (!c) clients.set(ex, (c = createExchange(ex, loadCredentials(ex))))
  return c
}
const client = () => clientFor(activeEx())
/** Für den Dollar-Kurs, ohne Schlüssel */
const publicKraken = new Kraken(null)
const pairCache = new Map<ExchangeId, PairInfo[]>()
async function pairsFor(ex: ExchangeId): Promise<PairInfo[]> {
  let p = pairCache.get(ex)
  if (!p) pairCache.set(ex, (p = await clientFor(ex).pairs()))
  return p
}
// Neuer Schlüssel kann ein anderes Konto sein: dann auch die geladenen geschlossenen Orders verwerfen
const resetClient = (ex: ExchangeId) => {
  clients.delete(ex)
  closedCaches.delete(ex)
  statusCache.delete(ex)
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
    if (!e.senderFrame || !isOwnUrl(e.senderFrame.url)) return { ok: false, error: tr('Nicht erlaubt.', 'Not allowed.') }
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}

/** Börsen, für die ein Schlüssel hinterlegt ist */
const connected = (): ExchangeId[] => EXCHANGE_IDS.filter((ex) => loadCredentials(ex) !== null)

handle('key:status', () => {
  const ex = activeEx()
  const keys = Object.fromEntries(EXCHANGE_IDS.map((id) => [id, loadCredentials(id) !== null])) as Record<ExchangeId, boolean>
  return { hasKey: keys[ex], encryption: safeStorage.isEncryptionAvailable(), touchId: touchIdAvailable(), exchange: ex, keys }
})
handle('key:save', async (key: string, secret: string, opts?: { noWithdrawConfirmed?: boolean }): Promise<SaveKeyResult> => {
  const ex = activeEx()
  const creds = ex === 'coinbase' ? normalizeCoinbase(String(key), String(secret)) : { key: String(key).trim(), secret: String(secret).trim() }
  const format = checkKeyFormat(creds.key, creds.secret, ex)
  if (format.length) throw new Error(format.join(' '))
  // erst alle Rechte prüfen, dann speichern. Ein Schlüssel mit Auszahlungsrecht wird nicht gespeichert.
  const checks = await createExchange(ex, creds).checkPermissions({ noWithdrawConfirmed: opts?.noWithdrawConfirmed === true })
  const saved = checks.every((c) => c.ok)
  if (saved) {
    saveCredentials(creds, ex)
    resetClient(ex)
  }
  addLog({ action: 'key-save', success: saved, message: `${exchangeName(ex)}: ${saved ? tr('Schlüssel gespeichert', 'Key saved') : `${tr('Nicht gespeichert', 'Not saved')}: ${checks.filter((c) => !c.ok).map((c) => c.label).join(', ')}`}` })
  return { saved, checks }
})
// Ein gespeicherter Schlüssel wurde beim Speichern schon ohne Auszahlungsrecht bestätigt
handle('key:verify', () => client().checkPermissions({ noWithdrawConfirmed: true }))
handle('key:clear', () => {
  const ex = activeEx()
  clearCredentials(ex)
  resetClient(ex)
  addLog({ action: 'key-clear', success: true, message: `${exchangeName(ex)}: ${tr('Schlüssel gelöscht', 'Key deleted')}` })
})
handle('pairs', () => pairsFor(activeEx()))
handle('price', (pairId: string) => client().lastPrice(pairId))
handle('prices', (pairIds: string[]) => client().lastPrices(pairIds.filter((x) => typeof x === 'string').slice(0, 50)))
handle('balances', () => client().balances())
handle('orders:open', () => client().openOrders())
// Pläne und Entwürfe der aktiven Börse (ältere ohne Börse gehören zu Kraken)
handle('plans', () => getPlans().filter((p) => exchangeOf(p) === activeEx()))
handle('settings', () => ({ ...getSettings(), language: getSettings().language ?? langFromLocale(systemLocale()) }))
handle('settings:save', (s: Partial<Settings>) => {
  const patch: Partial<Settings> = {}
  if (s.maxPlanEur !== undefined) patch.maxPlanEur = Math.max(1, Number(s.maxPlanEur) || 1)
  if (Array.isArray(s.watchlist)) patch.watchlist = s.watchlist.filter((x) => typeof x === 'string').slice(0, 50)
  if (s.currency === 'EUR' || s.currency === 'USD') patch.currency = s.currency
  if (s.numberFormat === 'de' || s.numberFormat === 'en') patch.numberFormat = s.numberFormat
  if (s.language === 'de' || s.language === 'en') patch.language = s.language
  if (isExchangeId(s.exchange)) patch.exchange = s.exchange
  const saved = saveSettings(patch)
  applyLanguage()
  return saved
})
// Wechselkurs für die Dollar-Anzeige (1 EUR = x USD), eine Minute zwischengespeichert
let usdCache: { at: number; rate: number } | null = null
handle('usdRate', async () => {
  if (usdCache && Date.now() - usdCache.at < 60_000) return usdCache.rate
  const rate = await publicKraken.lastPrice('EURUSD')
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
  // Ein Plan wird immer bei der Börse storniert, auf der er angelegt wurde
  return logged({ action: 'cancel-plan', userref, pair: plan?.pairName, side: plan?.side }, () => clientFor(exchangeOf(plan)).cancelPlan(userref), (n) => ({ count: n, message: tr(`${n} Orders storniert`, `${n} orders cancelled`) }))
})
handle('order:cancel', (txid: string) => logged({ action: 'cancel-order', message: txid }, () => client().cancelOrder(txid)))
/**
 * Notbremse: storniert alle offenen Orders auf ALLEN Börsen mit hinterlegtem Schlüssel, nicht nur auf der gerade gewählten.
 * Schlägt eine Börse fehl, laufen die anderen trotzdem, und der Fehler wird gemeldet.
 */
handle('orders:cancelAll', () => logged({ action: 'cancel-all' }, async () => {
  const targets = connected()
  if (!targets.length) throw new Error(tr('Kein API-Schlüssel hinterlegt.', 'No API key saved.'))
  const results = await Promise.allSettled(targets.map((ex) => clientFor(ex).cancelAll()))
  const failed = results.map((r, i) => (r.status === 'rejected' ? `${exchangeName(targets[i])}: ${(r.reason as Error)?.message}` : '')).filter(Boolean)
  const n = results.reduce((a, r) => a + (r.status === 'fulfilled' ? r.value : 0), 0)
  if (failed.length) throw new Error(tr(`Notbremse: ${n} Orders storniert, aber nicht überall: ${failed.join(' ')}`, `Emergency stop: ${n} orders cancelled, but not everywhere: ${failed.join(' ')}`))
  return n
}, (n) => ({ count: n, message: tr(`Notbremse: ${n} Orders storniert`, `Emergency stop: ${n} orders cancelled`) })))
handle('system:status', () => client().systemStatus())
handle('log', () => getLog())

// Datensicherung: alles außer dem Schlüssel in eine Datei
handle('backup:export', async () => {
  const name = `${tr('fehu-orders-sicherung', 'fehu-orders-backup')}-${localDate()}.json`
  const r = await dialog.showSaveDialog({ title: tr('Fehu Orders sichern', 'Back up Fehu Orders'), defaultPath: join(app.getPath('documents'), name), filters: [{ name: tr('Fehu-Orders-Sicherung', 'Fehu Orders backup'), extensions: ['json'] }] })
  if (r.canceled || !r.filePath) return null
  const data = exportAll()
  writeFileSync(r.filePath, JSON.stringify(data, null, 2))
  return { path: r.filePath, ...summarize(data) }
})
// Schritt 1: Datei wählen und prüfen (noch nichts ändern)
let pendingRestore: ReturnType<typeof parseBackup> | null = null
handle('backup:pick', async () => {
  const r = await dialog.showOpenDialog({ title: tr('Sicherung wiederherstellen', 'Restore backup'), properties: ['openFile'], filters: [{ name: tr('Fehu-Orders-Sicherung', 'Fehu Orders backup'), extensions: ['json'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  pendingRestore = parseBackup(readFileSync(r.filePaths[0], 'utf8'))
  return summarize(pendingRestore)
})
// Schritt 2: nach Bestätigung einspielen
handle('backup:restore', () => {
  if (!pendingRestore) throw new Error(tr('Bitte zuerst eine Sicherung auswählen.', 'Please choose a backup first.'))
  const safety = importAll(pendingRestore)
  pendingRestore = null
  statusCache.clear()
  addLog({ action: 'restore', success: true, message: tr('Sicherung wiederhergestellt', 'Backup restored') })
  return safety
})

handle('ohlc', (pairId: string, interval: number) => client().ohlc(pairId, interval))
handle('fees', (pairId: string) => client().fees(pairId))
handle('available', () => client().available())
handle('templates', () => getTemplates())
handle('template:save', (t: TemplateDto) => saveTemplate(t))
handle('template:delete', (id: string) => deleteTemplate(id))
handle('plans:status', () => computeStatuses())
handle('drafts', () => getDrafts().filter((d) => exchangeOf(d) === activeEx()))
// Beim Speichern wird ein ausgelöster Kursalarm wieder scharf
handle('draft:save', (d: DraftDto) => saveDraft({ ...d, exchange: isExchangeId(d.exchange) ? d.exchange : activeEx(), alarmFiredAt: undefined }))
handle('draft:delete', (id: string) => deleteDraft(id))

/**
 * Pläne einer Börse, deren Status abgefragt wird: alle der letzten 90 Tage, dazu ältere, die laut Börse noch offene Orders haben.
 * Keine feste Höchstzahl: geschlossene Orders kommen für alle Pläne aus einer gemeinsamen, zwischengespeicherten Abfrage.
 */
function activePlans(ex: ExchangeId, openRefs: Set<number> = lastOpenRefs.get(ex) ?? new Set()) {
  const since = Date.now() - 90 * 86_400_000
  return getPlans().filter((p) => exchangeOf(p) === ex && (Date.parse(p.createdAt) >= since || openRefs.has(p.userref)))
}
/** userrefs mit offenen Orders aus der letzten Abfrage je Börse (für activePlans ohne neue Anfrage) */
const lastOpenRefs = new Map<ExchangeId, Set<number>>()

const statusCache = new Map<ExchangeId, { at: number; value: PlanStatusDto[]; executed: Map<number, string[]> }>()

/**
 * Geschlossene Orders je Börse, einmal vollständig geladen und danach nur noch ergänzt.
 * Geschlossene Orders ändern sich nicht mehr, deshalb reicht beim nächsten Mal alles seit der letzten Abfrage.
 * pairs: für Börsen, die je Paar abfragen (Bitvavo). Kommt ein neues Paar dazu, wird es ab dem Anfang geladen.
 */
interface ClosedCache { orders: Map<string, ClosedOrder>; coveredFrom: number; fetchedAt: number; pairs: Set<string> }
const closedCaches = new Map<ExchangeId, ClosedCache>()

async function closedOrdersFrom(ex: ExchangeId, from: number, pairIds: string[]): Promise<ClosedOrder[]> {
  let c = closedCaches.get(ex)
  if (!c) closedCaches.set(ex, (c = { orders: new Map(), coveredFrom: Infinity, fetchedAt: 0, pairs: new Set() }))
  const k = clientFor(ex)
  const now = Date.now() / 1000
  const newPairs = pairIds.filter((id) => !c.pairs.has(id))
  const oldPairs = pairIds.filter((id) => c.pairs.has(id))
  // Lücke vorne (neuer, älterer Plan) → ab dort komplett laden, sonst nur das Neue (mit 2 Minuten Überlappung)
  const start = from < c.coveredFrom ? from : c.fetchedAt - 120
  const fresh = [
    ...(newPairs.length ? await k.closedOrdersSince(from, 100, newPairs) : []),
    ...(oldPairs.length || !pairIds.length ? await k.closedOrdersSince(start, 100, oldPairs) : []),
  ]
  for (const o of fresh) c.orders.set(o.txid, o)
  c.coveredFrom = Math.min(c.coveredFrom, start, newPairs.length ? from : Infinity)
  c.fetchedAt = now
  newPairs.forEach((id) => c.pairs.add(id))
  return [...c.orders.values()]
}

async function computeStatuses(ex: ExchangeId = activeEx()): Promise<PlanStatusDto[]> {
  const cached = statusCache.get(ex)
  if (cached && Date.now() - cached.at < 20_000) return cached.value
  const k = clientFor(ex)
  const mine = getPlans().filter((p) => exchangeOf(p) === ex)
  const open = mine.length ? await k.openOrders() : []
  const refs = new Set(open.map((o) => o.userref))
  lastOpenRefs.set(ex, refs)
  const plans = activePlans(ex, refs)
  // eine Abfrage für alle Pläne statt einer pro Plan (Anfrage-Grenze der Börse)
  const since = plans.length ? Math.min(...plans.map((p) => Date.parse(p.createdAt))) / 1000 - 60 : 0
  const allClosed = plans.length ? await closedOrdersFrom(ex, since, [...new Set(plans.map((p) => p.pairId))]) : []
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
  statusCache.set(ex, { at: Date.now(), value, executed })
  return value
}

/** Prüft jede Minute auf allen verbundenen Börsen, ob Orders ausgeführt wurden, und meldet neue per Mitteilung */
async function pollFills(): Promise<void> {
  const known = getNotified()
  const firstRun = known.length === 0
  const fresh: { pair: string; side: string; count: number; ex: ExchangeId }[] = []
  let any = false
  for (const ex of connected()) {
    if (!getPlans().some((p) => exchangeOf(p) === ex)) continue
    try {
      statusCache.delete(ex)
      await computeStatuses(ex)
    } catch {
      continue // Netz oder Börse gerade nicht erreichbar, nächste Minute neu
    }
    any = true
    const cache = statusCache.get(ex)
    for (const p of activePlans(ex)) {
      const txids = cache?.executed.get(p.userref) ?? []
      const neu = txids.filter((t) => !known.includes(t))
      if (neu.length) fresh.push({ pair: p.pairName, side: p.side === 'buy' ? tr('Kauf', 'buy') : tr('Verkauf', 'sell'), count: neu.length, ex })
      known.push(...neu)
    }
  }
  if (!any) return
  setNotified(known.length ? known : ['-'])
  if (firstRun || !fresh.length) return
  for (const f of fresh) {
    if (Notification.isSupported()) new Notification({ title: `Fehu Orders · ${exchangeName(f.ex)}`, body: tr(`${f.count} ${f.count === 1 ? 'Order' : 'Orders'} ausgeführt: ${f.pair} ${f.side}`, `${f.count} ${f.count === 1 ? 'order' : 'orders'} filled: ${f.pair} ${f.side}`) }).show()
  }
  mainWindow?.webContents.send('fills')
}

/**
 * Dritte Sicherung: Kurs unmittelbar vor dem Senden frisch holen. Liegen Stufen auf der
 * falschen Seite (Kauf über, Verkauf unter dem Kurs), wird nichts gesendet.
 */
async function freshPriceGuard(ex: ExchangeId, pairId: string, side: 'buy' | 'sell', levels: { price: number }[], base: Omit<LogEntry, 'at' | 'success'>): Promise<void> {
  let last: number
  try {
    last = await clientFor(ex).lastPrice(pairId)
  } catch (e) {
    const msg = `${tr('Der aktuelle Kurs konnte nicht geprüft werden, deshalb wurde nichts gesendet.', 'The current price could not be checked, so nothing was sent.')} ${(e as Error).message}`
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
  addLog({ ...base, ok, failed, success: failed === 0, message: firstError ?? (base.action === 'validate' ? tr('Probelauf ohne Fehler', 'Test run without errors') : tr(`${ok} Orders angelegt`, `${ok} orders placed`)) })
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
    const msg = tr('Touch ID wurde abgebrochen oder nicht erkannt. Es wurde nichts gesendet.', 'Touch ID was cancelled or not recognised. Nothing was sent.')
    addLog({ ...base, success: false, message: msg })
    throw new Error(msg)
  }
}

/**
 * Zweite Sicherung im Hauptprozess: Obergrenze pro Sendung. Auf einer Börse, auf der noch nie ein Plan echt angelegt
 * wurde, gilt beim ersten Test höchstens 50 €, auch wenn die eigene Obergrenze höher steht.
 */
function checkLimit(levels: { price: number; volume: number }[], ex: ExchangeId): number {
  const total = levels.reduce((a, l) => a + l.price * l.volume, 0)
  const { maxPlanEur } = getSettings()
  const first = !hasRealPlan(ex)
  const limit = sendLimit(maxPlanEur, first)
  if (total > limit) {
    if (first && limit < maxPlanEur) {
      throw new Error(tr(
        `Diese Sendung hat einen Gegenwert von ${total.toFixed(2)} €. Auf ${exchangeName(ex)} hast du noch keinen echten Plan angelegt. Zur Sicherheit geht der erste Test dort mit höchstens ${limit} €. Danach gilt deine Obergrenze von ${maxPlanEur} €.`,
        `This send is worth ${total.toFixed(2)} €. You have not placed a real plan on ${exchangeName(ex)} yet. For safety, the first test there is limited to ${limit} €. After that your limit of ${maxPlanEur} € applies.`,
      ))
    }
    throw new Error(tr(
      `Diese Sendung hat einen Gegenwert von ${total.toFixed(2)} €. Deine Obergrenze pro Plan ist ${maxPlanEur} €. Zur Sicherheit steht sie anfangs auf 50 €, damit der erste echte Test klein bleibt. Ändern kannst du sie unter Einstellungen › Obergrenze pro Plan.`,
      `This send is worth ${total.toFixed(2)} €. Your limit per plan is ${maxPlanEur} €. For safety it starts at 50 € so your first real test stays small. You can change it under Settings › Limit per plan.`,
    ))
  }
  return total
}

/**
 * Bringt Preise und Mengen vor dem Senden auf die Regeln des Paars (Nachkommastellen, Preisschritt).
 * Lägen danach zwei Stufen auf demselben Preis, wird nichts gesendet.
 */
function conformToRules<T extends { price: number; volume: number }>(levels: T[], rules: PairInfo | undefined, side: 'buy' | 'sell', base: Omit<LogEntry, 'at' | 'success'>): T[] {
  if (!rules) return levels
  const r = conformLevels(levels, rules, side)
  if (r.duplicate) {
    const msg = tr(
      `Nach dem Runden auf die erlaubten Preisschritte von ${rules.name} lägen mehrere Stufen auf demselben Preis. Es wurde nichts gesendet. Bitte im Planer weniger Stufen oder einen größeren Preisbereich wählen.`,
      `After rounding to the allowed price steps of ${rules.name}, several levels would have the same price. Nothing was sent. Please choose fewer levels or a wider price range in the planner.`,
    )
    addLog({ ...base, success: false, message: msg })
    throw new Error(msg)
  }
  return r.levels
}

handle('send', async (req: SendRequest): Promise<SendResult> => {
  const ex = activeEx()
  const rules = (await pairsFor(ex)).find((p) => p.id === req.pairId)
  const valid = conformToRules(req.levels.filter((l) => !l.problem), rules, req.side, { action: req.validate ? 'validate' : 'send', pair: req.pairName, side: req.side, count: 0, amount: 0 })
  if (!valid.length) throw new Error(tr('Keine gültigen Stufen.', 'No valid levels.'))
  const count = req.sendCount ? Math.max(1, Math.min(valid.length, Math.floor(req.sendCount))) : valid.length
  const levels = valid.slice(0, count)
  // Ein Entwurf gehört zu der Börse, auf der er geplant wurde (die Paar-Kennungen unterscheiden sich)
  const draft = req.draftId ? getDrafts().find((d) => d.id === req.draftId) : undefined
  if (draft && exchangeOf(draft) !== ex) throw new Error(tr(`Dieser Entwurf gehört zu ${exchangeName(exchangeOf(draft))}. Wechsle links unten auf ${exchangeName(exchangeOf(draft))}, um ihn freizugeben.`, `This draft belongs to ${exchangeName(exchangeOf(draft))}. Switch to ${exchangeName(exchangeOf(draft))} at the bottom left to release it.`))
  const total = checkLimit(levels, ex)
  const base = { action: req.validate ? 'validate' : 'send', pair: req.pairName, side: req.side, count: levels.length, amount: total }
  if (!req.validate) await confirmWithTouchId(tr(`${levels.length} echte Orders über ${total.toFixed(2)} € an ${exchangeName(ex)} senden`, `send ${levels.length} real orders worth ${total.toFixed(2)} € to ${exchangeName(ex)}`), base)
  await freshPriceGuard(ex, req.pairId, req.side, levels, base)
  const userref = newUserref()
  let orders: SendResult['orders']
  try {
    orders = await clientFor(ex).placeLadder(req.pairId, req.side, levels, { validate: req.validate, userref, postOnly: req.postOnly, rules })
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
        exchange: ex, userref, createdAt: new Date().toISOString(), pairId: req.pairId, pairName: req.pairName, side: req.side, input: req.input,
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
  if (!plan?.levels) throw new Error(tr('Für diesen Plan sind keine Stufen gespeichert.', 'No levels are stored for this plan.'))
  const sent = new Set(plan.sentIndices ?? [])
  const ex = exchangeOf(plan)
  const rules = (await pairsFor(ex)).find((p) => p.id === plan.pairId)
  const rest = conformToRules(plan.levels.filter((l) => !sent.has(l.index)), rules, plan.side, { action: validate ? 'validate' : 'rest', pair: plan.pairName, side: plan.side, count: 0, amount: 0, userref })
  if (!rest.length) throw new Error(tr('Alle Stufen dieses Plans sind schon gesendet.', 'All levels of this plan have already been sent.'))
  const total = checkLimit(rest, ex)
  const base = { action: validate ? 'validate' : 'rest', pair: plan.pairName, side: plan.side, count: rest.length, amount: total, userref }
  if (!validate) await confirmWithTouchId(tr(`${rest.length} weitere echte Orders über ${total.toFixed(2)} € an ${exchangeName(ex)} senden`, `send ${rest.length} more real orders worth ${total.toFixed(2)} € to ${exchangeName(ex)}`), base)
  await freshPriceGuard(ex, plan.pairId, plan.side, rest, base)
  let orders: SendResult['orders']
  try {
    orders = await clientFor(ex).placeLadder(plan.pairId, plan.side, rest, { validate, userref, postOnly: plan.postOnly ?? true, rules })
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
  // Kurse je Börse (öffentlich, kein Schlüssel nötig). Paar-Kennungen sind je Börse verschieden.
  const prices: Record<string, number> = {}
  for (const ex of new Set(armed.map(exchangeOf))) {
    try {
      const got = await clientFor(ex).lastPrices([...new Set(armed.filter((d) => exchangeOf(d) === ex).map((d) => d.pairId))])
      for (const [id, v] of Object.entries(got)) prices[`${ex}:${id}`] = v
    } catch { /* nächste Minute neu */ }
  }
  const priceOf = (d: DraftDto) => prices[`${exchangeOf(d)}:${d.pairId}`]
  const hit = armed.filter((d) => alarmHit(d.side, d.input.priceStart, priceOf(d)))
  if (!hit.length) return
  markAlarmFired(hit.map((d) => d.id))
  for (const d of hit) {
    addLog({ action: 'alarm', pair: d.pairName, side: d.side, success: true, message: tr(`Kursalarm „${d.name}“: Kurs ${priceOf(d)} hat die erste Stufe ${d.input.priceStart} erreicht`, `Price alert “${d.name}”: price ${priceOf(d)} reached the first level ${d.input.priceStart}`) })
    if (!Notification.isSupported()) continue
    const n = new Notification({
      title: `${tr('Kursalarm', 'Price alert')}${d.scenario ? `: ${d.scenario}` : ''}`,
      body: tr(`${d.pairName} steht bei ${priceOf(d)} € und hat die erste Stufe von „${d.name}“ erreicht. Freigeben kannst du ihn unter Entwürfe.`, `${d.pairName} is at ${priceOf(d)} € and reached the first level of “${d.name}”. You can release it under Drafts.`),
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
  applyLanguage()
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
