import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, safeStorage, session, shell, systemPreferences } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseBackup, summarize } from '../shared/backup'
import { localDate } from '../shared/dates'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Kraken } from './kraken'
import { Bitvavo } from './bitvavo'
import { Coinbase } from './coinbase'
import type { ClosedOrder, Credentials, Exchange, PairInfo } from './exchange'
import { EXCHANGE_IDS, exchangeMeta, exchangeName, exchangeOf, isExchangeId, sendLimit, type ExchangeId } from '../shared/exchanges'
import {
  addLog, addPlan, clearAllCredentials, moveTradeKeyToMemory, tradeKeyInMemory, loadHomeIps, saveHomeIps, systemLocale, clearCredentials, exportAll, importAll, getLog, markAlarmFired, deleteDraft, deleteTemplate, getDrafts, getFillBook, saveFillBook, markDraftReleased, saveDraft, getNotified, getPlans, getSettings, getTemplates, hasRealPlan, loadCredentials, newUserref, saveCredentials, saveSettings, saveTemplate, setNotified, updatePlan, type PlanRecord, type Settings,
} from './store'
import type { ClearAllResult, DraftDto, KeyStatusDto, LogEntry, PlanStatusDto, SaveKeyResult, SendRequest, SendResult, TemplateDto } from '../shared/ipc'
import { cleanManualLots, dateToSec, type LotEvent } from '../shared/holding-period'
import { checksPass, isKeyRole, isTradeKeyMode, needTradeKeyText, readChecks, roleName, type KeyRole } from '../shared/key-roles'
import { alarmHit, assetLabel, checkKeyFormat, normalizeCoinbase, priceGuard } from '../shared/safety'
import { planStatus, zoneProgress, type OrderSnapshot } from '../shared/plan-status'
import { hasZones, heldZones, isHeld, MAX_MIN_ORDER_EUR, MAX_STEPS, prepareForSend, type LadderLevel, type Side } from '../shared/ladder'
import { langFromLocale, setLang, tr } from '../shared/i18n'
import { moneyText, toInputText, type NumberFormat } from '../shared/number-format'
import { splitSend } from '../shared/send-split'
import { ipKind, ipProblem, maskIp, MAX_IPS, type HomeIpView } from '../shared/ip'
import { cleanCashPots, cleanManual, cleanTargets, normalizeHoldings, type PortfolioSource, type WholeSource } from '../shared/portfolio'

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
/** Zahlen in Meldungen im gewählten Zahlenformat, wie in der Oberfläche */
const numberFormat = (): NumberFormat => getSettings().numberFormat ?? (getSettings().language === 'en' ? 'en' : 'de')
const money = (n: number): string => moneyText(n, numberFormat())
// Je Börse und Schlüssel eine gemeinsame Verbindung, damit alle privaten Anfragen nacheinander laufen
// (Kraken lehnt Zeitstempel ab, die nicht in steigender Reihenfolge ankommen). Zwei verschiedene Schlüssel
// haben bei der Börse getrennte Zähler, deshalb dürfen Lese- und Handels-Verbindung nebeneinander laufen.
const clients = new Map<string, Exchange>()
const connection = (ex: ExchangeId, role: KeyRole): Exchange => {
  const id = `${ex}:${role}`
  let c = clients.get(id)
  if (!c) clients.set(id, (c = createExchange(ex, loadCredentials(ex, role))))
  return c
}
const hasRole = (ex: ExchangeId, role: KeyRole): boolean => loadCredentials(ex, role) !== null
/**
 * Verbindung zum Lesen (Guthaben, Orders, Ausführungen, Kurse): mit dem Nur-Lese-Schlüssel, wenn einer da ist,
 * sonst mit dem Handels-Schlüssel. Ohne Schlüssel gehen nur öffentliche Abfragen.
 */
const clientFor = (ex: ExchangeId): Exchange => connection(ex, hasRole(ex, 'read') ? 'read' : 'trade')
/** Verbindung zum Orders-Anlegen. Nur mit Handels-Schlüssel, sonst wird nichts gesendet. */
const traderFor = (ex: ExchangeId): Exchange => {
  if (!hasRole(ex, 'trade')) throw new Error(needTradeKeyText(exchangeName(ex)))
  return connection(ex, 'trade')
}
/**
 * Verbindung zum Stornieren: Handels-Schlüssel, wenn da. Sonst der Nur-Lese-Schlüssel, der bei Kraken
 * das Recht „Cancel & Close Orders“ haben darf (Stornieren kostet nie Geld).
 */
const cancellerFor = (ex: ExchangeId): Exchange => (hasRole(ex, 'trade') ? connection(ex, 'trade') : clientFor(ex))
/** Hinweis, wenn Stornieren ohne Handels-Schlüssel scheitert */
const cancelHint = (ex: ExchangeId, e: unknown): Error => {
  const msg = (e as Error)?.message ?? String(e)
  if (hasRole(ex, 'trade')) return e instanceof Error ? e : new Error(msg)
  return new Error(`${msg} ${tr(`Für ${exchangeName(ex)} ist nur ein Nur-Lese-Schlüssel da. Füge den Handels-Schlüssel ein oder storniere direkt auf der Webseite von ${exchangeName(ex)}.`, `Only a read-only key is saved for ${exchangeName(ex)}. Paste the trading key or cancel directly on the ${exchangeName(ex)} website.`)}`)
}
const client = () => clientFor(activeEx())
/** Für den Dollar-Kurs, ohne Schlüssel */
const publicKraken = new Kraken(null)
/** Regeln der Paare, eine Stunde zwischengespeichert, damit geänderte Preisschritte der Börse ankommen */
const PAIR_CACHE_MS = 60 * 60_000
const pairCache = new Map<ExchangeId, { at: number; pairs: PairInfo[] }>()
async function pairsFor(ex: ExchangeId, maxAgeMs = PAIR_CACHE_MS): Promise<PairInfo[]> {
  const c = pairCache.get(ex)
  if (c && Date.now() - c.at < maxAgeMs) return c.pairs
  try {
    const pairs = await clientFor(ex).pairs()
    pairCache.set(ex, { at: Date.now(), pairs })
    return pairs
  } catch (e) {
    // Börse gerade nicht erreichbar: für die Anzeige die letzten bekannten Regeln, sonst den Fehler
    if (c) return c.pairs
    throw e
  }
}
/** Vor dem Senden: Regeln höchstens 10 Minuten alt */
const SEND_RULES_MAX_AGE_MS = 10 * 60_000
// Neuer Schlüssel kann ein anderes Konto sein: dann auch die geladenen geschlossenen Orders verwerfen
/**
 * Neuer oder gelöschter Schlüssel: Verbindung neu aufbauen und beim nächsten Mal alles bei der Börse neu abfragen
 * (könnte ein anderes Konto sein). Die schon bekannten Ausführungen im Buch bleiben, sie gehören zu deinen Plänen.
 */
const resetClient = (ex: ExchangeId) => {
  clients.delete(`${ex}:read`)
  clients.delete(`${ex}:trade`)
  closedCaches.delete(ex)
  statusCache.delete(ex)
  const book = getFillBook(ex)
  if (book.orders.length || book.fetchedAt) saveFillBook(ex, { ...book, coveredFrom: Infinity, fetchedAt: 0, pairs: [] })
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

/** Ordner mit den gebauten Fenster-Dateien der App */
const RENDERER_DIR = resolve(__dirname, '../renderer')

/**
 * Gehört eine Adresse zur App selbst (gebaute Datei oder Entwicklungs-Server)?
 * Im fertigen Build zählt nur eine Datei aus dem eigenen Fenster-Ordner, nicht irgendeine Datei auf dem Mac.
 */
export function isOwnUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  try {
    if (dev) return new URL(url).origin === new URL(dev).origin
    const u = new URL(url)
    if (u.protocol !== 'file:') return false
    return resolve(fileURLToPath(u)).startsWith(RENDERER_DIR + sep)
  } catch {
    return false
  }
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

/** Börsen, für die irgendein Schlüssel hinterlegt ist (Nur-Lese oder Handel) */
const connected = (): ExchangeId[] => EXCHANGE_IDS.filter((ex) => hasRole(ex, 'read') || hasRole(ex, 'trade'))

handle('key:status', (): KeyStatusDto => {
  const ex = activeEx()
  const roles = Object.fromEntries(EXCHANGE_IDS.map((id) => [id, { read: hasRole(id, 'read'), trade: hasRole(id, 'trade'), tradeTemporary: tradeKeyInMemory(id) }])) as KeyStatusDto['roles']
  const keys = Object.fromEntries(EXCHANGE_IDS.map((id) => [id, roles[id].read || roles[id].trade])) as Record<ExchangeId, boolean>
  return { hasKey: keys[ex], encryption: safeStorage.isEncryptionAvailable(), touchId: touchIdAvailable(), exchange: ex, keys, roles, tradeKeyMode: getSettings().tradeKeyMode }
})
/** Der Schlüssel-Reiter verwaltet Schlüssel jeder Börse, auch wenn gerade eine andere benutzt wird */
const keyEx = (ex: unknown): ExchangeId => (isExchangeId(ex) ? ex : activeEx())
/** Ältere Aufrufe ohne Rolle meinen den Handels-Schlüssel (so war es vor der Trennung) */
const keyRole = (role: unknown): KeyRole => (isKeyRole(role) ? role : 'trade')
handle('key:save', async (key: string, secret: string, opts?: { noWithdrawConfirmed?: boolean; exchange?: ExchangeId; role?: KeyRole }): Promise<SaveKeyResult> => {
  const ex = keyEx(opts?.exchange)
  const role = keyRole(opts?.role)
  const creds = ex === 'coinbase' ? normalizeCoinbase(String(key), String(secret)) : { key: String(key).trim(), secret: String(secret).trim() }
  const format = checkKeyFormat(creds.key, creds.secret, ex)
  if (format.length) throw new Error(format.join(' '))
  const other = loadCredentials(ex, role === 'read' ? 'trade' : 'read')
  if (other && other.key === creds.key) throw new Error(role === 'read'
    ? tr('Das ist derselbe Schlüssel wie dein Handels-Schlüssel. Lege bei der Börse einen zweiten Schlüssel nur zum Ansehen an.', 'This is the same key as your trading key. Create a second, view-only key at the exchange.')
    : tr('Das ist derselbe Schlüssel wie dein Nur-Lese-Schlüssel. Für den Handels-Schlüssel brauchst du einen eigenen Schlüssel mit Handelsrecht.', 'This is the same key as your read-only key. The trading key needs its own key with trading permission.'))
  // erst alle Rechte prüfen, dann speichern. Ein Schlüssel mit Auszahlungsrecht wird nie gespeichert,
  // ein Nur-Lese-Schlüssel mit Handelsrecht auch nicht.
  const raw = await createExchange(ex, creds).checkPermissions({ noWithdrawConfirmed: opts?.noWithdrawConfirmed === true })
  const checks = role === 'read' ? readChecks(raw, ex) : raw
  const saved = checksPass(checks)
  const temporary = role === 'trade' && getSettings().tradeKeyMode !== 'keep'
  if (saved) {
    saveCredentials(creds, ex, role, { memoryOnly: temporary })
    resetClient(ex)
  }
  const what = `${exchangeName(ex)}, ${roleName(role)}`
  addLog({ action: 'key-save', success: saved, message: `${what}: ${saved ? (temporary ? tr('nur im Arbeitsspeicher abgelegt', 'kept in memory only') : tr('Schlüssel gespeichert', 'Key saved')) : `${tr('Nicht gespeichert', 'Not saved')}: ${checks.filter((c) => !c.ok && c.required).map((c) => c.label).join(', ')}`}` })
  return { saved, checks }
})
// Ein gespeicherter Schlüssel wurde beim Speichern schon ohne Auszahlungsrecht bestätigt
handle('key:verify', async (exArg?: ExchangeId, roleArg?: KeyRole) => {
  const ex = keyEx(exArg)
  const role = keyRole(roleArg)
  if (!hasRole(ex, role)) throw new Error(tr(`Für ${exchangeName(ex)} ist kein ${roleName(role)} da.`, `There is no ${roleName(role)} for ${exchangeName(ex)}.`))
  const raw = await connection(ex, role).checkPermissions({ noWithdrawConfirmed: true })
  return role === 'read' ? readChecks(raw, ex) : raw
})
handle('key:clear', (exArg?: ExchangeId, roleArg?: KeyRole) => {
  const ex = keyEx(exArg)
  const role = keyRole(roleArg)
  clearCredentials(ex, role)
  resetClient(ex)
  addLog({ action: 'key-clear', success: true, message: `${exchangeName(ex)}, ${roleName(role)}: ${tr('Schlüssel gelöscht', 'Key deleted')}` })
})
/**
 * Notfall-Knopf: alle Schlüssel aller Börsen sofort aus der App löschen (Dateien und Arbeitsspeicher).
 * Bei den Börsen selbst bleiben sie gültig, bis man sie dort widerruft. Das sagt die Oberfläche deutlich.
 * Mit cancelOrders wird vorher die Notbremse gezogen, solange die Schlüssel noch da sind.
 */
handle('key:clearAll', async (opts?: { cancelOrders?: boolean }): Promise<ClearAllResult> => {
  const out: ClearAllResult = { deleted: [] }
  if (opts?.cancelOrders === true && connected().length) {
    try {
      out.cancelled = await emergencyStop()
    } catch (e) {
      out.cancelError = (e as Error).message
    }
  }
  out.deleted = clearAllCredentials()
  for (const ex of EXCHANGE_IDS) resetClient(ex)
  const list = out.deleted.map((d) => `${exchangeName(d.exchange)} (${d.roles.map(roleName).join(', ')})`).join('; ')
  addLog({ action: 'key-clear-all', success: true, message: out.deleted.length ? tr(`Notfall: alle Schlüssel aus der App gelöscht: ${list}`, `Emergency: all keys deleted from the app: ${list}`) : tr('Notfall: Es waren keine Schlüssel gespeichert.', 'Emergency: no keys were saved.') })
  return out
})
// Eigene IP-Adressen für die IP-Sperre. Das Fenster bekommt sie nur verdeckt, den Klartext erst auf Klick.
const ipViews = (): HomeIpView[] => loadHomeIps().map((x) => ({ masked: maskIp(x.ip), label: x.label, kind: ipKind(x.ip) ?? 'IPv4' }))
const ipAt = (i: unknown) => {
  const list = loadHomeIps()
  const n = Number(i)
  if (!Number.isInteger(n) || n < 0 || n >= list.length) throw new Error(tr('Diese IP-Adresse gibt es nicht mehr.', 'This IP address no longer exists.'))
  return { list, n }
}
handle('ip:list', () => ipViews())
handle('ip:reveal', (i: number) => {
  const { list, n } = ipAt(i)
  return list[n].ip
})
handle('ip:copy', (i: number) => {
  const { list, n } = ipAt(i)
  clipboard.writeText(list[n].ip)
})
handle('ip:add', (ip: string, label?: string) => {
  const text = String(ip ?? '').trim()
  const problem = ipProblem(text)
  if (problem) throw new Error(problem)
  const list = loadHomeIps()
  if (list.some((x) => x.ip.toLowerCase() === text.toLowerCase())) throw new Error(tr('Diese IP-Adresse ist schon gespeichert.', 'This IP address is already saved.'))
  if (list.length >= MAX_IPS) throw new Error(tr(`Höchstens ${MAX_IPS} Adressen.`, `At most ${MAX_IPS} addresses.`))
  const name = typeof label === 'string' && label.trim() ? label.trim().slice(0, 40) : undefined
  saveHomeIps([...list, name ? { ip: text, label: name } : { ip: text }])
  // Die Adresse selbst kommt bewusst nicht ins Protokoll
  addLog({ action: 'ip-save', success: true, message: tr('IP-Adresse gespeichert', 'IP address saved') })
  return ipViews()
})
handle('ip:delete', (i: number) => {
  const { list, n } = ipAt(i)
  saveHomeIps(list.filter((_, k) => k !== n))
  addLog({ action: 'ip-delete', success: true, message: tr('IP-Adresse gelöscht', 'IP address deleted') })
  return ipViews()
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
  if (isTradeKeyMode(s.tradeKeyMode)) patch.tradeKeyMode = s.tradeKeyMode
  if (s.manualLots !== undefined) patch.manualLots = cleanManualLots(s.manualLots)
  if (s.cashPots !== undefined) patch.cashPots = cleanCashPots(s.cashPots)
  if (typeof s.portfolioDrafts === 'boolean') patch.portfolioDrafts = s.portfolioDrafts
  if (s.portfolioTargets !== undefined) patch.portfolioTargets = cleanTargets(s.portfolioTargets)
  if (s.manualHoldings !== undefined) patch.manualHoldings = cleanManual(s.manualHoldings)
  if (s.minOrderEur !== undefined) {
    const min = Number(s.minOrderEur)
    if (!Number.isFinite(min) || min < 1 || min > MAX_MIN_ORDER_EUR) throw new Error(tr(`Der Mindest-Orderwert muss zwischen 1 € und ${MAX_MIN_ORDER_EUR} € liegen.`, `The minimum order value must be between 1 € and ${MAX_MIN_ORDER_EUR} €.`))
    patch.minOrderEur = min
  }
  const saved = saveSettings(patch)
  // Ab jetzt keinen Handels-Schlüssel mehr auf der Festplatte: vorhandene in den Arbeitsspeicher holen und die Datei löschen
  if (patch.tradeKeyMode && patch.tradeKeyMode !== 'keep') {
    for (const ex of EXCHANGE_IDS) if (moveTradeKeyToMemory(ex)) addLog({ action: 'key-save', success: true, message: `${exchangeName(ex)}, ${roleName('trade')}: ${tr('von der Festplatte gelöscht, bleibt nur bis zum Schließen der App', 'removed from disk, kept only until the app closes')}` })
  }
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
  const ex = exchangeOf(plan)
  return logged({ action: 'cancel-plan', userref, pair: plan?.pairName, side: plan?.side }, async () => {
    const n = await cancellerFor(ex).cancelPlan(userref).catch((e) => { throw cancelHint(ex, e) })
    // Merken: Der Plan ist beendet. Reststufen und pausierte Zonen gehen danach nicht mehr raus.
    if (plan) updatePlan(userref, (p) => ({ ...p, cancelledAt: p.cancelledAt ?? new Date().toISOString() }))
    return n
  }, (n) => ({ count: n, message: tr(`${n} Orders storniert`, `${n} orders cancelled`) }))
})
handle('order:cancel', (txid: string) => logged({ action: 'cancel-order', message: txid }, () => cancellerFor(activeEx()).cancelOrder(txid).catch((e) => { throw cancelHint(activeEx(), e) })))
/**
 * Notbremse: storniert alle offenen Orders auf ALLEN Börsen mit hinterlegtem Schlüssel, nicht nur auf der gerade gewählten.
 * Schlägt eine Börse fehl, laufen die anderen trotzdem, und der Fehler wird gemeldet.
 */
async function emergencyStop(): Promise<number> {
  const targets = connected()
  if (!targets.length) throw new Error(tr('Kein API-Schlüssel hinterlegt.', 'No API key saved.'))
  const results = await Promise.allSettled(targets.map((ex) => cancellerFor(ex).cancelAll().catch((e) => { throw cancelHint(ex, e) })))
  const failed = results.map((r, i) => (r.status === 'rejected' ? `${exchangeName(targets[i])}: ${(r.reason as Error)?.message}` : '')).filter(Boolean)
  const n = results.reduce((a, r) => a + (r.status === 'fulfilled' ? r.value : 0), 0)
  if (failed.length) throw new Error(tr(`Notbremse: ${n} Orders storniert, aber nicht überall: ${failed.join(' ')}`, `Emergency stop: ${n} orders cancelled, but not everywhere: ${failed.join(' ')}`))
  return n
}
handle('orders:cancelAll', () => logged({ action: 'cancel-all' }, emergencyStop, (n) => ({ count: n, message: tr(`Notbremse: ${n} Orders storniert`, `Emergency stop: ${n} orders cancelled`) })))
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
/**
 * Portfolio: alle Börsen, auf denen es Pläne, Entwürfe oder einen Schlüssel gibt, nicht nur die gewählte.
 * Fällt eine Börse aus, kommen die anderen trotzdem, die ausgefallene meldet ihren Fehler.
 */
handle('portfolio', async (): Promise<PortfolioSource[]> => {
  const keys = connected()
  const allPlans = getPlans()
  const allDrafts = getDrafts().filter((d) => d.status === 'draft')
  // Eigene Einträge (Wallet, Broker) bekommen ihren Kurs von der gewählten Börse
  const manualCoins = [...new Set(getSettings().manualHoldings.map((m) => m.coin))]
  const active = activeEx()
  const exs = EXCHANGE_IDS.filter((ex) => keys.includes(ex) || allPlans.some((p) => exchangeOf(p) === ex) || allDrafts.some((d) => exchangeOf(d) === ex) || (ex === active && manualCoins.length > 0))
  return Promise.all(exs.map(async (ex): Promise<PortfolioSource> => {
    const plans = allPlans.filter((p) => exchangeOf(p) === ex)
    const drafts = allDrafts.filter((d) => exchangeOf(d) === ex)
    const hasKey = keys.includes(ex)
    const at = new Date().toISOString()
    const out: PortfolioSource = { exchange: ex, hasKey, plans, drafts, status: [], openOrders: [], eurTotal: null, eurFree: null, prices: {} }
    const whole: WholeSource = { exchange: ex, holdings: null, coinPrices: {}, eurTotal: null, at }
    const errors: string[] = []
    let bal: Record<string, number> | null = null
    if (hasKey) {
      try {
        const k = clientFor(ex)
        const [status, open, b, free] = await Promise.all([
          plans.length ? computeStatuses(ex) : Promise.resolve([]),
          plans.length ? k.openOrders() : Promise.resolve([]),
          k.balances(),
          k.available().catch(() => null),
        ])
        const refs = new Set(plans.map((p) => p.userref))
        bal = b
        out.status = status
        out.openOrders = open.filter((o) => refs.has(o.userref))
        out.eurTotal = b.ZEUR ?? b.EUR ?? 0
        out.eurFree = free ? free.ZEUR ?? free.EUR ?? 0 : null
        whole.eurTotal = out.eurTotal
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    // Kurse: Paare der Pläne und je gehaltenem Coin (und eigenem Eintrag) das Euro-Paar, alles in einer Abfrage
    const pairs = await pairsFor(ex).catch(() => [] as PairInfo[])
    if (bal) whole.holdings = normalizeHoldings(bal, pairs, ex === 'kraken' ? assetLabel : (c) => ({ name: c }))
    const coins = [...new Set([...(whole.holdings ?? []).map((h) => h.coin), ...(ex === active ? manualCoins : [])])]
    const eurPair = new Map(coins.map((c) => [c, pairs.find((p) => p.name === `${c}/EUR`)?.id]).filter((x): x is [string, string] => !!x[1]))
    const ids = [...new Set([...[...plans, ...drafts].map((x) => x.pairId), ...eurPair.values()])].slice(0, 100)
    if (ids.length) {
      try {
        const prices = await clientFor(ex).lastPrices(ids)
        out.prices = prices
        for (const [c, id] of eurPair) if (prices[id] > 0) whole.coinPrices[c] = prices[id]
      } catch (e) { errors.push((e as Error).message) }
    }
    out.whole = whole
    if (errors.length) out.error = `${exchangeName(ex)}: ${errors[0]}`
    return out
  }))
})
/**
 * Haltefrist: alle bekannten Ausführungen der aktiven Börse mit Datum (aus dem Ausführungsbuch) plus selbst eingetragene Käufe.
 * Orders ohne Ausführungsdatum fehlen hier absichtlich: Ein falsches, zu frühes Datum würde zu viel als steuerfrei zeigen.
 */
handle('tax:events', (): LotEvent[] => {
  const ex = activeEx()
  const coinOf = new Map(getPlans().filter((p) => exchangeOf(p) === ex).map((p) => [p.userref, p.pairName.split('/')[0]]))
  const fills: LotEvent[] = getFillBook(ex).orders.flatMap((o): LotEvent[] => {
    const coin = coinOf.get(o.userref)
    return coin && o.filled > 0 && o.closedAt ? [{ coin, side: o.side, volume: o.filled, at: o.closedAt, source: 'app' }] : []
  })
  const manual: LotEvent[] = getSettings().manualLots.filter((l) => l.exchange === ex).flatMap((l): LotEvent[] => {
    const at = dateToSec(l.date)
    return at === null ? [] : [{ coin: l.coin, side: 'buy', volume: l.volume, at, source: 'manual' }]
  })
  return [...fills, ...manual]
})
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
 * Der Stand liegt dauerhaft im Ausführungsbuch (fills.json), so muss nach einem Neustart nichts neu geladen werden.
 * pairs: für Börsen, die je Paar abfragen (Bitvavo). Kommt ein neues Paar dazu, wird es ab dem Anfang geladen.
 */
interface ClosedCache { orders: Map<string, ClosedOrder>; coveredFrom: number; fetchedAt: number; pairs: Set<string> }
const closedCaches = new Map<ExchangeId, ClosedCache>()

function bookFor(ex: ExchangeId): ClosedCache {
  let c = closedCaches.get(ex)
  if (!c) {
    const b = getFillBook(ex)
    c = { orders: new Map(b.orders.map((o) => [o.txid, o])), coveredFrom: b.coveredFrom, fetchedAt: b.fetchedAt, pairs: new Set(b.pairs) }
    closedCaches.set(ex, c)
  }
  return c
}

async function closedOrdersFrom(ex: ExchangeId, from: number, pairIds: string[]): Promise<ClosedOrder[]> {
  const c = bookFor(ex)
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
  // Ins Buch kommen nur Orders der eigenen Pläne, nicht was du anderswo an der Börse handelst
  const mine = new Set(getPlans().filter((p) => exchangeOf(p) === ex).map((p) => p.userref))
  for (const o of fresh) if (mine.has(o.userref)) c.orders.set(o.txid, o)
  c.coveredFrom = Math.min(c.coveredFrom, start, newPairs.length ? from : Infinity)
  c.fetchedAt = now
  newPairs.forEach((id) => c.pairs.add(id))
  saveFillBook(ex, { orders: [...c.orders.values()], coveredFrom: c.coveredFrom, fetchedAt: c.fetchedAt, pairs: [...c.pairs] })
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
  const active = activePlans(ex, refs)
  // eine Abfrage für alle Pläne statt einer pro Plan (Anfrage-Grenze der Börse)
  const since = active.length ? Math.min(...active.map((p) => Date.parse(p.createdAt))) / 1000 - 60 : 0
  const allClosed = active.length ? await closedOrdersFrom(ex, since, [...new Set(active.map((p) => p.pairId))]) : [...bookFor(ex).orders.values()]
  // Ältere Pläne zeigen ihren Stand weiter, wenn das Ausführungsbuch ihre Orders kennt
  const booked = new Set(allClosed.map((o) => o.userref))
  const activeRefs = new Set(active.map((p) => p.userref))
  const plans = mine.filter((p) => activeRefs.has(p.userref) || booked.has(p.userref))
  const value: PlanStatusDto[] = []
  const executed = new Map<number, string[]>()
  for (const p of plans) {
    const closed = allClosed.filter((o) => o.userref === p.userref)
    const snaps: OrderSnapshot[] = [
      ...open.filter((o) => o.userref === p.userref).map((o) => ({ txid: o.txid, status: 'open', volume: o.volume, filled: o.filled, cost: o.cost, fee: o.fee, price: o.price, limitPrice: o.price })),
      ...closed.map((o) => ({ txid: o.txid, status: o.status, volume: o.volume, filled: o.filled, cost: o.cost, fee: o.fee, price: o.price, limitPrice: o.limitPrice, closedAt: o.closedAt })),
    ]
    const st = planStatus(snaps)
    const zones = p.levels && hasZones(p.input) ? zoneProgress(p.levels, p.sentIndices ?? [], snaps) : []
    executed.set(p.userref, st.executedTxids)
    const { executedTxids: _, ...rest } = st
    value.push({ userref: p.userref, ...rest, ...(zones.length ? { zones } : {}) })
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
    const msg = `${tr('Den aktuellen Kurs zu prüfen hat nicht geklappt, deshalb wurde nichts gesendet.', 'The current price could not be checked, so nothing was sent.')} ${(e as Error).message}`
    addLog({ ...base, success: false, message: msg })
    throw new Error(msg)
  }
  const msg = priceGuard(side, levels.map((l) => l.price), last, (n) => `${toInputText(n, numberFormat(), true)} €`)
  if (msg) {
    addLog({ ...base, success: false, message: msg })
    throw new Error(msg)
  }
}

function logResult(base: Omit<LogEntry, 'at' | 'success'>, orders: SendResult['orders']): void {
  const ok = orders.filter((o) => o.txid || (base.action === 'validate' && !o.error)).length
  const failed = orders.filter((o) => o.error).length
  const firstError = orders.find((o) => o.error)?.error
  addLog({ ...base, ok, failed, success: failed === 0, message: firstError ?? (base.action === 'validate' ? tr('Test ohne Fehler', 'Test run without errors') : tr(`${ok} Orders angelegt`, `${ok} orders placed`)) })
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
  // Ungültige Zahl (NaN) zählt als „zu viel“: lieber nichts senden als ohne Obergrenze
  if (!Number.isFinite(total) || levels.some((l) => !(l.price > 0) || !(l.volume > 0))) throw new Error(tr('Eine Stufe hat einen ungültigen Preis oder eine ungültige Menge. Es wurde nichts gesendet.', 'A level has an invalid price or volume. Nothing was sent.'))
  if (!(total <= limit)) {
    if (first && limit < maxPlanEur) {
      throw new Error(tr(
        `Diese Sendung hat einen Gegenwert von ${money(total)}. Auf ${exchangeName(ex)} hast du noch keinen echten Plan angelegt. Zur Sicherheit geht der erste Test dort mit höchstens ${limit} €. Danach gilt deine Obergrenze von ${maxPlanEur} €.`,
        `This send is worth ${money(total)}. You have not placed a real plan on ${exchangeName(ex)} yet. For safety, the first test there is limited to ${limit} €. After that your limit of ${maxPlanEur} € applies.`,
      ))
    }
    throw new Error(tr(
      `Diese Sendung hat einen Gegenwert von ${money(total)}. Deine Obergrenze pro Sendung ist ${maxPlanEur} €. Zur Sicherheit steht sie anfangs auf 50 €, damit der erste echte Test klein bleibt. Ändern kannst du sie unter Einstellungen › Obergrenze pro Sendung.`,
      `This send is worth ${money(total)}. Your limit per send is ${maxPlanEur} €. For safety it starts at 50 € so your first real test stays small. You can change it under Settings › Limit per send.`,
    ))
  }
  return total
}

/**
 * Bringt Preise und Mengen vor dem Senden auf die Regeln des Paars (Nachkommastellen, Preisschritt) und prüft danach
 * Mindestmenge, Mindestbetrag und doppelte Preise. Passt etwas nicht, oder kennt die Börse das Paar nicht, wird nichts gesendet.
 */
function conformToRules<T extends { price: number; volume: number; index?: number }>(levels: T[], rules: PairInfo | undefined, side: 'buy' | 'sell', ex: ExchangeId, base: Omit<LogEntry, 'at' | 'success'>): T[] {
  const fail = (msg: string): never => {
    addLog({ ...base, success: false, message: msg })
    throw new Error(msg)
  }
  if (!rules) return fail(tr(`${exchangeName(ex)} kennt dieses Handelspaar gerade nicht (oder es ist nicht handelbar). Es wurde nichts gesendet.`, `${exchangeName(ex)} does not list this trading pair right now (or it cannot be traded). Nothing was sent.`))
  const r = prepareForSend(levels, rules, side, getSettings().minOrderEur)
  if (r.error) fail(`${rules.name}: ${r.error}`)
  return r.levels
}

/** Es läuft immer nur eine Sendung gleichzeitig (Doppelklick, zwei Fenster, Senden und „Rest senden“ zugleich) */
let sending = false
async function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  if (sending) throw new Error(tr('Es läuft gerade schon eine Sendung. Bitte warte, bis sie fertig ist.', 'A send is already running. Please wait until it has finished.'))
  sending = true
  try {
    return await fn()
  } finally {
    sending = false
  }
}

type LogBase = Omit<LogEntry, 'at' | 'success'>
type Orders = SendResult['orders']

/**
 * Ein Sendeauftrag. Senden, „Rest senden“ und „Zone aktivieren“ beschreiben nur, welche Stufen in Frage kommen
 * und wie das Ergebnis im Plan landet. Alle Sicherungen laufen in runSend, für alle drei gleich und in derselben Reihenfolge.
 */
interface SendJob<T extends LadderLevel> {
  ex: ExchangeId
  pairId: string
  pairName: string
  side: Side
  validate: boolean
  postOnly: boolean | undefined
  action: 'send' | 'rest' | 'zone'
  /** Plan-Nummer eines bestehenden Plans (Rest, Zone). Fehlt bei einem neuen Plan. */
  userref?: number
  candidates: T[]
  /** Aus den regelkonformen Stufen die wählen, die jetzt rausgehen (z. B. nur scharfe Zonen, nur die ersten N) */
  pick?: (valid: T[]) => T[]
  /** Fehlermeldung, wenn danach keine Stufe übrig bleibt */
  emptyText: string
  /** Text für die Touch-ID-Abfrage */
  touchText: (count: number, total: string) => string
  /** Nach dem echten Senden im Plan festhalten (wird immer aufgerufen, auch wenn keine Order angelegt wurde) */
  record: (r: { userref: number; valid: T[]; levels: T[]; orders: Orders }) => void
}

/**
 * Der eine Sendeweg. Reihenfolge der Sicherungen:
 * 1. Regeln der Börse (Nachkommastellen, Preisschritt, Mindestwerte, doppelte Preise)
 * 2. Obergrenze
 * 3. Touch ID (nur echtes Senden)
 * 4. frischer Kurs (keine Stufe auf der falschen Kursseite)
 * 5. Senden, Protokoll, im Plan festhalten, Nachkontrolle
 */
async function runSend<T extends LadderLevel>(job: SendJob<T>): Promise<SendResult> {
  const { ex, validate } = job
  // Gleich am Anfang, damit niemand erst Touch ID bestätigt und dann erfährt, dass der Schlüssel fehlt.
  // Testen geht bei Bitvavo auch mit dem Nur-Lese-Schlüssel (die App prüft selbst), bei Kraken und Coinbase prüft die Börse
  // mit einem Testauftrag, dafür braucht es das Handelsrecht.
  const trader = validate && !exchangeMeta(ex).serverValidate && !hasRole(ex, 'trade') ? clientFor(ex) : traderFor(ex)
  const rules = (await pairsFor(ex, SEND_RULES_MAX_AGE_MS)).find((p) => p.id === job.pairId)
  const base0: LogBase = { action: validate ? 'validate' : job.action, pair: job.pairName, side: job.side, count: 0, amount: 0, ...(job.userref ? { userref: job.userref } : {}) }
  const valid = conformToRules(job.candidates, rules, job.side, ex, base0)
  const levels = job.pick ? job.pick(valid) : valid
  if (!levels.length) throw new Error(job.emptyText)
  const total = checkLimit(levels, ex)
  const base: LogBase = { ...base0, count: levels.length, amount: total }
  if (!validate) await confirmWithTouchId(job.touchText(levels.length, money(total)), base)
  await freshPriceGuard(ex, job.pairId, job.side, levels, base)
  const userref = job.userref ?? newUserref()
  let orders: Orders
  try {
    orders = await trader.placeLadder(job.pairId, job.side, levels, { validate, userref, postOnly: job.postOnly, rules })
  } catch (e) {
    addLog({ ...base, success: false, message: (e as Error).message })
    throw e
  }
  logResult(validate || base.userref ? base : { ...base, userref }, orders)
  if (validate) return { userref, validate, orders }
  job.record({ userref, valid, levels, orders })
  const check = await checkPlaced(ex, orders)
  // Einstellung „Nur für eine Sendung“: Handels-Schlüssel jetzt vergessen. Der Nur-Lese-Schlüssel bleibt für die Anzeige.
  const forget = getSettings().tradeKeyMode === 'once' && hasRole(ex, 'trade') && sentPart(orders).any
  if (forget) {
    clearCredentials(ex, 'trade')
    resetClient(ex)
    addLog({ action: 'key-clear', success: true, message: `${exchangeName(ex)}, ${roleName('trade')}: ${tr('nach dem Senden vergessen', 'forgotten after sending')}` })
  }
  return { userref, validate, orders, ...(check ? { check } : {}), ...(forget ? { tradeKeyForgotten: true } : {}) }
}

/** Angelegte und unklare Orders. Unklare (Verbindung abgebrochen) gelten als gesendet, damit nichts doppelt rausgeht. */
function sentPart(orders: Orders): { placed: Orders; any: boolean } {
  const placed = orders.filter((o) => o.txid || o.uncertain)
  return { placed, any: placed.length > 0 }
}

/** Zählt eine weitere Sendung zu einem bestehenden Plan dazu */
function addSent(p: PlanRecord, orders: Orders): PlanRecord {
  const { placed } = sentPart(orders)
  const ok = orders.filter((o) => o.txid).length
  return { ...p, sent: p.sent + ok, failed: p.failed + orders.length - ok, totalCost: p.totalCost + costOf(placed), sentIndices: [...(p.sentIndices ?? []), ...placed.map((o) => o.index)] }
}

function planFor(userref: number): PlanRecord & { levels: LadderLevel[] } {
  const plan = getPlans().find((p) => p.userref === userref)
  if (!plan?.levels) throw new Error(tr('Für diesen Plan sind keine Stufen gespeichert.', 'No levels are stored for this plan.'))
  return plan as PlanRecord & { levels: LadderLevel[] }
}

handle('send', (req: SendRequest): Promise<SendResult> => oneAtATime(async () => {
  const ex = activeEx()
  // Wurde inzwischen oben links die Börse gewechselt, gehören Paar und Regeln zur anderen Börse
  if (req.exchange && req.exchange !== ex) throw new Error(tr(`Dieser Plan wurde für ${exchangeName(req.exchange)} berechnet, gewählt ist aber ${exchangeName(ex)}. Es wurde nichts gesendet.`, `This plan was calculated for ${exchangeName(req.exchange)}, but ${exchangeName(ex)} is selected. Nothing was sent.`))
  if (req.side !== 'buy' && req.side !== 'sell') throw new Error(tr('Unbekannte Richtung (Kauf oder Verkauf).', 'Unknown side (buy or sell).'))
  if (!Array.isArray(req.levels)) throw new Error(tr('Keine gültigen Stufen.', 'No valid levels.'))
  // Ein Entwurf gehört zu der Börse, auf der er geplant wurde (die Paar-Kennungen unterscheiden sich)
  const draft = req.draftId ? getDrafts().find((d) => d.id === req.draftId) : undefined
  if (draft && exchangeOf(draft) !== ex) throw new Error(tr(`Dieser Entwurf gehört zu ${exchangeName(exchangeOf(draft))}. Wechsle oben links auf ${exchangeName(exchangeOf(draft))}, um ihn zu senden.`, `This draft belongs to ${exchangeName(exchangeOf(draft))}. Switch to ${exchangeName(exchangeOf(draft))} at the top left to send it.`))
  return runSend({
    ex, pairId: req.pairId, pairName: req.pairName, side: req.side, validate: req.validate, postOnly: req.postOnly, action: 'send',
    candidates: req.levels.filter((l) => !l.problem),
    pick: (valid) => {
      if (!valid.length) throw new Error(tr('Keine gültigen Stufen.', 'No valid levels.'))
      // Entschärfte Preiszonen bleiben im Plan gespeichert, gehen aber jetzt nicht raus. Dieselbe Regel wie im Planer.
      const split = splitSend(valid, req.input ?? {}, req.sendCount)
      if (!split.armedLevels.length) throw new Error(tr('Alle Zonen sind pausiert. Aktiviere mindestens eine Zone, sonst wird nichts gesendet.', 'All zones are disarmed. Arm at least one zone, otherwise nothing is sent.'))
      return split.toSend
    },
    emptyText: tr('Keine gültigen Stufen.', 'No valid levels.'),
    touchText: (n, total) => tr(`${n} echte Orders über ${total} an ${exchangeName(ex)} senden`, `send ${n} real orders worth ${total} to ${exchangeName(ex)}`),
    record: ({ userref, valid, orders }) => {
      const { placed, any } = sentPart(orders)
      if (!any) return
      const ok = orders.filter((o) => o.txid).length
      addPlan({
        exchange: ex, userref, createdAt: new Date().toISOString(), pairId: req.pairId, pairName: req.pairName, side: req.side, input: req.input,
        sent: ok, failed: orders.length - ok, totalCost: costOf(placed), levels: valid, sentIndices: placed.map((o) => o.index), postOnly: req.postOnly,
      })
      if (req.draftId) markDraftReleased(req.draftId, userref)
    },
  })
}))

/** Restliche Stufen eines Plans nachschicken (gleiche userref, damit „Plan stornieren“ alles erfasst) */
handle('plan:rest', (userref: number, validate: boolean): Promise<SendResult> => oneAtATime(async () => {
  const plan = planFor(userref)
  if (plan.cancelledAt) throw new Error(tr('Dieser Plan wurde storniert. Lege für neue Orders einen neuen Plan an.', 'This plan was cancelled. Create a new plan for new orders.'))
  const sent = new Set(plan.sentIndices ?? [])
  // Entschärfte Zonen gehen nicht mit „Rest senden“ raus, die haben ihren eigenen Knopf
  const held = heldZones(plan.input)
  const ex = exchangeOf(plan)
  return runSend({
    ex, pairId: plan.pairId, pairName: plan.pairName, side: plan.side, validate, postOnly: plan.postOnly ?? true, action: 'rest', userref,
    candidates: plan.levels.filter((l) => !sent.has(l.index) && !isHeld(l, held)),
    emptyText: tr('Alle Stufen dieses Plans sind schon gesendet.', 'All levels of this plan have already been sent.'),
    touchText: (n, total) => tr(`${n} weitere echte Orders über ${total} an ${exchangeName(ex)} senden`, `send ${n} more real orders worth ${total} to ${exchangeName(ex)}`),
    record: ({ orders }) => updatePlan(userref, (p) => addSent(p, orders)),
  })
}))

/**
 * Eine entschärfte Zone aktivieren: ihre noch nicht gesendeten Stufen gehen jetzt mit derselben Plan-Nummer raus.
 * Mit `edited` ersetzt der Nutzer die Stufen der Zone vorher (anderer Preisbereich oder andere Stufenzahl).
 */
handle('plan:zone', (userref: number, zone: number, validate: boolean, edited?: LadderLevel[]): Promise<SendResult> => oneAtATime(async () => {
  const plan = planFor(userref)
  if (plan.cancelledAt) throw new Error(tr('Dieser Plan wurde storniert. Lege für neue Orders einen neuen Plan an.', 'This plan was cancelled. Create a new plan for new orders.'))
  const zones = plan.input.zones ?? []
  if (!Number.isInteger(zone) || !zones[zone]) throw new Error(tr('Diese Zone gibt es in dem Plan nicht.', 'This zone does not exist in the plan.'))
  if (zones[zone].armed !== false) throw new Error(tr(`Zone ${zone + 1} ist schon aktiv.`, `Zone ${zone + 1} is already armed.`))
  const sent = new Set(plan.sentIndices ?? [])
  let candidates: LadderLevel[] = plan.levels.filter((l) => l.zone === zone && !sent.has(l.index))
  if (edited !== undefined) {
    if (!Array.isArray(edited) || !edited.length || edited.length > MAX_STEPS) throw new Error(tr('Keine gültigen Stufen.', 'No valid levels.'))
    // neue Nummern hinter allen bisherigen Stufen, damit nichts mit schon gesendeten Stufen verwechselt wird
    const next = Math.max(-1, ...plan.levels.map((l) => l.index)) + 1
    candidates = edited.filter((l) => !l.problem).map((l, i) => ({ index: next + i, price: Number(l.price), volume: Number(l.volume), cost: Number(l.price) * Number(l.volume), share: Number(l.share) || 0, zone }))
  }
  const emptyText = tr(`Zone ${zone + 1} hat keine Stufen mehr zum Senden.`, `Zone ${zone + 1} has no levels left to send.`)
  if (!candidates.length) throw new Error(emptyText)
  const ex = exchangeOf(plan)
  return runSend({
    ex, pairId: plan.pairId, pairName: plan.pairName, side: plan.side, validate, postOnly: plan.postOnly ?? true, action: 'zone', userref,
    candidates, emptyText,
    touchText: (n, total) => tr(`Zone ${zone + 1} aktivieren: ${n} echte Orders über ${total} an ${exchangeName(ex)} senden`, `arm zone ${zone + 1}: send ${n} real orders worth ${total} to ${exchangeName(ex)}`),
    record: ({ levels, orders }) => {
      if (!sentPart(orders).any) return
      const replaced = edited !== undefined
      updatePlan(userref, (p) => {
        const keep = (p.levels ?? []).filter((l) => !(replaced && l.zone === zone && !(p.sentIndices ?? []).includes(l.index)))
        const zs = (p.input.zones ?? []).map((z, i) => (i === zone ? { ...z, armed: true, ...(replaced ? { priceStart: levels[0].price, priceEnd: levels[levels.length - 1].price, steps: levels.length } : {}) } : z))
        return addSent({ ...p, input: { ...p.input, zones: zs }, levels: replaced ? [...keep, ...levels] : p.levels }, orders)
      })
    },
  })
}))

/**
 * Nachkontrolle nach dem echten Senden: fragt die offenen Orders ab und zählt, wie viele der eben angelegten dort stehen.
 * Klappt die Abfrage nicht, gibt es keine Nachkontrolle (undefined), das Senden selbst ist davon nicht betroffen.
 */
async function checkPlaced(ex: ExchangeId, orders: SendResult['orders']): Promise<SendResult['check']> {
  const placed = orders.filter((o) => o.txid).map((o) => o.txid as string)
  if (!placed.length) return undefined
  try {
    // Kurz warten, damit die Börse die neuen Orders sicher in der Liste führt
    if (!process.env.VITEST) await new Promise((r) => setTimeout(r, 1500))
    const open = new Set((await clientFor(ex).openOrders()).map((o) => o.txid))
    return { found: placed.filter((t) => open.has(t)).length, placed: placed.length }
  } catch {
    return undefined
  }
}

/** Gegenwert der Orders, die wirklich angelegt wurden (oder vielleicht angelegt wurden) */
function costOf(orders: { price: number; volume: number }[]): number {
  return orders.reduce((a, o) => a + o.price * o.volume, 0)
}

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
  session.defaultSession.setPermissionCheckHandler(() => false)
  createWindow()
  setTimeout(pollFills, 10_000)
  setInterval(pollFills, 60_000)
  setTimeout(pollAlarms, 15_000)
  setInterval(pollAlarms, 60_000)
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
