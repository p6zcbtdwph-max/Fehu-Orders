// Lokale Ablage im App-Ordner (~/Library/Application Support/Fehu Orders).
// Der API-Schlüssel wird mit Electron safeStorage verschlüsselt. Den Generalschlüssel
// dafür verwaltet der macOS-Schlüsselbund, genau wie beim Lifemanager.
import { app, safeStorage } from 'electron'
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { ClosedOrder, Credentials } from './exchange'
import { EXCHANGE_IDS, exchangeOf, isExchangeId, type ExchangeId } from '../shared/exchanges'
import { cleanManualLots, type ManualLot } from '../shared/holding-period'
import { isTradeKeyMode, KEY_ROLES, type KeyRole, type TradeKeyMode } from '../shared/key-roles'
import { DEFAULT_MIN_ORDER_EUR, MAX_MIN_ORDER_EUR, type LadderInput, type LadderLevel, type Side } from '../shared/ladder'
import type { DraftDto, LogEntry } from '../shared/ipc'
import { makeBackup, type BackupData } from '../shared/backup'
import { cleanIps, type HomeIp } from '../shared/ip'
import { langFromLocale, tr, type Lang } from '../shared/i18n'
import { cleanCashPots, cleanManual, cleanTargets, type CashPot, type ManualHolding, type PortfolioTargets } from '../shared/portfolio'

const file = (name: string) => join(app.getPath('userData'), name)

/**
 * Je Börse und Rolle eine eigene verschlüsselte Datei. Der Handels-Schlüssel behält den alten Namen
 * (Kraken: kraken-key.bin), damit schon gespeicherte Schlüssel bleiben. Sie hatten immer Handelsrechte.
 */
const keyFile = (ex: ExchangeId, role: KeyRole = 'trade') =>
  role === 'read' ? file(`${ex}-read-key.bin`) : file(ex === 'kraken' ? 'kraken-key.bin' : `${ex}-key.bin`)

/** Handels-Schlüssel, die nur im Arbeitsspeicher liegen (nie auf der Festplatte), je Börse */
const memoryKeys = new Map<ExchangeId, Credentials>()

/**
 * Speichert einen Schlüssel. memoryOnly: nur im Arbeitsspeicher bis die App schließt (nur Handels-Schlüssel).
 * Dabei wird ein älterer Handels-Schlüssel auf der Festplatte gelöscht, damit keiner zurückbleibt.
 */
export function saveCredentials(c: Credentials, ex: ExchangeId = 'kraken', role: KeyRole = 'trade', opts: { memoryOnly?: boolean } = {}): void {
  if (role === 'trade' && opts.memoryOnly) {
    memoryKeys.set(ex, { key: c.key, secret: c.secret })
    const f = keyFile(ex, 'trade')
    if (existsSync(f)) unlinkSync(f)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error(tr('Der Schlüsselbund ist nicht verfügbar. Der Schlüssel wird nicht unverschlüsselt gespeichert.', 'The macOS keychain is not available. The key is never stored unencrypted.'))
  const f = keyFile(ex, role)
  writeFileSync(`${f}.tmp`, safeStorage.encryptString(JSON.stringify(c)), { mode: 0o600 })
  renameSync(`${f}.tmp`, f)
  if (role === 'trade') memoryKeys.delete(ex)
}

export function loadCredentials(ex: ExchangeId = 'kraken', role: KeyRole = 'trade'): Credentials | null {
  if (role === 'trade' && memoryKeys.has(ex)) return memoryKeys.get(ex) ?? null
  const f = keyFile(ex, role)
  if (!existsSync(f)) return null
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(f)))
  } catch {
    return null
  }
}

/** Liegt der Handels-Schlüssel nur im Arbeitsspeicher? */
export const tradeKeyInMemory = (ex: ExchangeId): boolean => memoryKeys.has(ex)

/** Handels-Schlüssel von der Festplatte in den Arbeitsspeicher holen und die Datei löschen (Modus ohne Festplatte) */
export function moveTradeKeyToMemory(ex: ExchangeId): boolean {
  if (memoryKeys.has(ex)) return false
  const c = loadCredentials(ex, 'trade')
  if (!c) return false
  saveCredentials(c, ex, 'trade', { memoryOnly: true })
  return true
}

/** Löscht einen Schlüssel (Datei und Arbeitsspeicher). Gibt zurück, ob einer da war. */
export function clearCredentials(ex: ExchangeId = 'kraken', role: KeyRole = 'trade'): boolean {
  let had = false
  if (role === 'trade' && memoryKeys.delete(ex)) had = true
  for (const f of [keyFile(ex, role), `${keyFile(ex, role)}.tmp`]) {
    if (existsSync(f)) {
      unlinkSync(f)
      had = true
    }
  }
  return had
}

/** Notfall-Knopf: alle Schlüssel aller Börsen löschen. Gibt zurück, welche da waren. */
export function clearAllCredentials(): { exchange: ExchangeId; roles: KeyRole[] }[] {
  const out: { exchange: ExchangeId; roles: KeyRole[] }[] = []
  for (const ex of EXCHANGE_IDS) {
    const roles = KEY_ROLES.filter((role) => clearCredentials(ex, role))
    if (roles.length) out.push({ exchange: ex, roles })
  }
  return out
}

/** Eigene IP-Adressen (für die IP-Sperre der Schlüssel), verschlüsselt wie die Schlüssel. Kommen nicht in die Datensicherung. */
const ipFile = () => file('home-ip.bin')

export function saveHomeIps(ips: HomeIp[]): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error(tr('Der Schlüsselbund ist nicht verfügbar. Die IP-Adresse wird nicht unverschlüsselt gespeichert.', 'The macOS keychain is not available. The IP address is never stored unencrypted.'))
  const f = ipFile()
  if (!ips.length) {
    if (existsSync(f)) unlinkSync(f)
    return
  }
  writeFileSync(`${f}.tmp`, safeStorage.encryptString(JSON.stringify(cleanIps(ips))), { mode: 0o600 })
  renameSync(`${f}.tmp`, f)
}

export function loadHomeIps(): HomeIp[] {
  const f = ipFile()
  if (!existsSync(f)) return []
  try {
    return cleanIps(JSON.parse(safeStorage.decryptString(readFileSync(f))))
  } catch {
    return []
  }
}

export interface Settings {
  /** Obergrenze pro Sendung in EUR, schützt vor Tippfehlern */
  maxPlanEur: number
  /** Handelspaare (Anzeigename wie BTC/EUR), die oben als Schnellauswahl stehen */
  watchlist: string[]
  /** Anzeigewährung. Orders laufen immer in der Kurswährung des Paars (EUR). */
  currency: 'EUR' | 'USD'
  /** Zahlenformat für Eingaben und Anzeige: de = 1.234,56, en = 1,234.56 */
  numberFormat: 'de' | 'en'
  /** Sprache der App. Fehlt sie, gilt die Systemsprache des Macs. */
  language?: Lang
  /** Börse, mit der die App gerade arbeitet */
  exchange: ExchangeId
  /** Mindest-Orderwert in EUR: keine einzelne Order liegt darunter (zu kleine Stufen hebt der Planer an) */
  minOrderEur: number
  /** Portfolio: eigene Cash-Töpfe (Tagesgeld, Girokonto …) */
  cashPots: CashPot[]
  /** Portfolio: offene Entwürfe im Soll mitzählen */
  portfolioDrafts: boolean
  /** Portfolio: Wunsch-Aufteilung in Prozent je Coin und 'cash' */
  portfolioTargets: PortfolioTargets
  /** Wie lange der Handels-Schlüssel bleibt: dauerhaft, bis die App schließt, oder nur für eine Sendung */
  tradeKeyMode: TradeKeyMode
  /** Portfolio: eigene Einträge für Orte ohne Schnittstelle (Wallet, Broker) */
  manualHoldings: ManualHolding[]
  /** Haltefrist: selbst eingetragene ältere Käufe (vor der App oder außerhalb gekauft) */
  manualLots: ManualLot[]
}

export const DEFAULT_SETTINGS: Settings = { tradeKeyMode: 'keep', minOrderEur: DEFAULT_MIN_ORDER_EUR, maxPlanEur: 50, watchlist: ['BTC/EUR', 'ETH/EUR'], currency: 'EUR', numberFormat: 'de', exchange: 'kraken', cashPots: [], portfolioDrafts: true, portfolioTargets: {}, manualHoldings: [], manualLots: [] }

export interface PlanRecord {
  /** Fehlt bei Plänen aus der Zeit, als es nur Kraken gab */
  exchange?: ExchangeId
  userref: number
  createdAt: string
  pairId: string
  pairName: string
  side: Side
  input: LadderInput
  sent: number
  failed: number
  totalCost: number
  /** Alle gültigen Stufen des Plans, auch die noch nicht gesendeten */
  levels?: LadderLevel[]
  /** Indizes der Stufen, die schon an Kraken gingen */
  sentIndices?: number[]
  postOnly?: boolean
}

/**
 * Schreibt sicher: erst in eine Hilfsdatei, dann umbenennen. Geht der Mac mitten im Schreiben aus,
 * bleibt die alte Datei vollständig. Der vorige Stand liegt zusätzlich als .bak daneben.
 */
export function writeJson(name: string, data: unknown, pretty = true): void {
  const f = file(name)
  const tmp = `${f}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, pretty ? 2 : undefined))
  if (existsSync(f)) {
    try {
      JSON.parse(readFileSync(f, 'utf8'))
      copyFileSync(f, `${f}.bak`) // nur einen lesbaren Stand als Reserve behalten
    } catch { /* kaputte Datei nicht als Reserve übernehmen */ }
  }
  renameSync(tmp, f)
}

function parseFile<T>(path: string, fallback: T): T {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('kein Objekt')
  return { ...fallback, ...raw }
}

/**
 * Liest eine Datei. Fehlt sie, gilt der Startwert. Ist sie kaputt, wird sie nicht still als leer behandelt
 * (das nächste Speichern würde sonst alles überschreiben): Sie wird als .defekt-… beiseitegelegt
 * und der letzte gute Stand (.bak) wird genommen.
 */
function readJson<T>(name: string, fallback: T): T {
  const f = file(name)
  if (!existsSync(f)) return fallback
  try {
    return parseFile(f, fallback)
  } catch {
    try { renameSync(f, `${f}.defekt-${new Date().toISOString().replace(/[:.]/g, '-')}`) } catch { /* egal */ }
    if (existsSync(`${f}.bak`)) {
      try {
        const restored = parseFile(`${f}.bak`, fallback)
        copyFileSync(`${f}.bak`, f)
        return restored
      } catch { /* auch die Reserve ist kaputt */ }
    }
    return fallback
  }
}

/** Nur gültige Einstellungen übernehmen (z. B. aus einer von Hand geänderten Sicherung), sonst den Standard */
export function cleanSettings(raw: Record<string, unknown>): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS }
  const max = Number(raw.maxPlanEur)
  if (Number.isFinite(max) && max >= 1) s.maxPlanEur = max
  if (Array.isArray(raw.watchlist)) s.watchlist = raw.watchlist.filter((x): x is string => typeof x === 'string').slice(0, 50)
  if (raw.currency === 'EUR' || raw.currency === 'USD') s.currency = raw.currency
  if (raw.numberFormat === 'de' || raw.numberFormat === 'en') s.numberFormat = raw.numberFormat
  if (raw.language === 'de' || raw.language === 'en') s.language = raw.language
  if (isExchangeId(raw.exchange)) s.exchange = raw.exchange
  s.cashPots = cleanCashPots(raw.cashPots)
  s.portfolioTargets = cleanTargets(raw.portfolioTargets)
  s.manualHoldings = cleanManual(raw.manualHoldings)
  if (typeof raw.portfolioDrafts === 'boolean') s.portfolioDrafts = raw.portfolioDrafts
  if (isTradeKeyMode(raw.tradeKeyMode)) s.tradeKeyMode = raw.tradeKeyMode
  s.manualLots = cleanManualLots(raw.manualLots)
  const min = Number(raw.minOrderEur)
  if (raw.minOrderEur !== undefined && raw.minOrderEur !== null && Number.isFinite(min) && min >= 1 && min <= MAX_MIN_ORDER_EUR) s.minOrderEur = min
  return s
}

export function getSettings(): Settings {
  const raw = readJson<Record<string, unknown>>('settings.json', {})
  const s = cleanSettings(raw)
  // Neue Nutzer ohne gespeichertes Zahlenformat: passend zur Systemsprache (englisches System → 1,234.56)
  if (raw.numberFormat === undefined && raw.language === undefined) s.numberFormat = langFromLocale(systemLocale())
  return s
}

/** Systemsprache des Macs (in Tests ohne Electron leer) */
export function systemLocale(): string | undefined {
  try { return app.getLocale?.() } catch { return undefined }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const s = { ...getSettings(), ...patch }
  writeJson('settings.json', s)
  return s
}

export function getPlans(): PlanRecord[] {
  return readJson<{ plans: PlanRecord[] }>('plans.json', { plans: [] }).plans
}

export function addPlan(p: PlanRecord): void {
  // Keine Obergrenze: ein gelöschter Plan ließe sich nicht mehr stornieren oder weitersenden
  writeJson('plans.json', { plans: [p, ...getPlans()] })
}

export function updatePlan(userref: number, change: (p: PlanRecord) => PlanRecord): void {
  writeJson('plans.json', { plans: getPlans().map((p) => (p.userref === userref ? change(p) : p)) })
}

/** Wurde auf dieser Börse schon einmal ein Plan echt angelegt? Bis dahin gilt die 50-Euro-Grenze für den ersten Test. */
export function hasRealPlan(ex: ExchangeId): boolean {
  return getPlans().some((p) => exchangeOf(p) === ex && p.sent > 0)
}

/** Plan-Kennung für Krakens userref (positive 32-Bit-Zahl), aus der Zeit abgeleitet */
export function newUserref(): number {
  const used = new Set(getPlans().map((p) => p.userref))
  let r = Math.floor(Date.now() / 1000) % 2_000_000_000
  // zwei Sendungen in derselben Sekunde (z. B. auf zwei Börsen) bekommen trotzdem verschiedene Nummern
  while (used.has(r)) r++
  return r
}

export interface Template {
  id: string
  name: string
  pairName: string
  input: LadderInput
  postOnly: boolean
}

export function getTemplates(): Template[] {
  return readJson<{ templates: Template[] }>('templates.json', { templates: [] }).templates
}

export function saveTemplate(t: Template): void {
  const rest = getTemplates().filter((x) => x.id !== t.id && x.name !== t.name)
  writeJson('templates.json', { templates: [t, ...rest] })
}

export function deleteTemplate(id: string): void {
  writeJson('templates.json', { templates: getTemplates().filter((x) => x.id !== id) })
}

/** txids, über deren Ausführung schon benachrichtigt wurde */
export function getNotified(): string[] {
  return readJson<{ txids: string[] }>('notified.json', { txids: [] }).txids
}

export function setNotified(txids: string[]): void {
  writeJson('notified.json', { txids: txids.slice(-5000) }, false)
}

/** Entwürfe: Order-Gruppen, die erst nach Freigabe an Kraken gehen */
/**
 * Ausführungsbuch je Börse: alle geschlossenen Orders der eigenen Pläne mit Zeitpunkt, dauerhaft gespeichert.
 * So bleiben Ausführungen nach einem Neustart erhalten (kein Neuladen ab Plan-Beginn) und auch dann,
 * wenn die Börse alte Orders nicht mehr liefert. Grundlage für Einstand, Haltefrist und Gegenorder.
 * coveredFrom/fetchedAt (Unix-Sekunden): Zeitraum, der bei der Börse schon vollständig abgefragt wurde.
 */
export interface FillBook {
  orders: ClosedOrder[]
  coveredFrom: number
  fetchedAt: number
  /** Paare, die schon abgefragt wurden (für Börsen, die je Paar abfragen) */
  pairs: string[]
}

const emptyBook = (): FillBook => ({ orders: [], coveredFrom: Infinity, fetchedAt: 0, pairs: [] })

function cleanBook(raw: any): FillBook {
  if (!raw || typeof raw !== 'object') return emptyBook()
  const orders = (Array.isArray(raw.orders) ? raw.orders : []).filter((o: any) => typeof o?.txid === 'string' && typeof o?.userref === 'number' && Number.isFinite(Number(o?.filled)))
  // JSON kennt kein Infinity: fehlt coveredFrom, gilt noch nichts als abgefragt
  const coveredFrom = Number.isFinite(raw.coveredFrom) ? raw.coveredFrom : Infinity
  return { orders, coveredFrom, fetchedAt: Number.isFinite(raw.fetchedAt) ? raw.fetchedAt : 0, pairs: (Array.isArray(raw.pairs) ? raw.pairs : []).filter((x: unknown) => typeof x === 'string') }
}

export function getFillBooks(): Partial<Record<ExchangeId, FillBook>> {
  const raw = readJson<{ books?: Record<string, unknown> }>('fills.json', {}).books ?? {}
  const out: Partial<Record<ExchangeId, FillBook>> = {}
  for (const [ex, b] of Object.entries(raw)) if (isExchangeId(ex)) out[ex] = cleanBook(b)
  return out
}

export function getFillBook(ex: ExchangeId): FillBook {
  return getFillBooks()[ex] ?? emptyBook()
}

export function saveFillBook(ex: ExchangeId, book: FillBook): void {
  const books = getFillBooks()
  books[ex] = book
  writeJson('fills.json', { books: Object.fromEntries(Object.entries(books).map(([k, b]) => [k, { ...b, coveredFrom: Number.isFinite(b.coveredFrom) ? b.coveredFrom : null }])) }, false)
}

export function getDrafts(): DraftDto[] {
  return readJson<{ drafts: DraftDto[] }>('drafts.json', { drafts: [] }).drafts
}

function writeDrafts(drafts: DraftDto[]): void {
  // Offene Entwürfe werden nie automatisch gelöscht, von den freigegebenen bleiben die neuesten 300
  let released = 0
  writeJson('drafts.json', { drafts: drafts.filter((d) => d.status !== 'released' || ++released <= 300) })
}

export function saveDraft(d: DraftDto): void {
  const all = getDrafts()
  const i = all.findIndex((x) => x.id === d.id)
  if (i >= 0) all[i] = d
  else all.unshift(d)
  writeDrafts(all)
}

export function deleteDraft(id: string): void {
  writeDrafts(getDrafts().filter((x) => x.id !== id))
}

export function markDraftReleased(id: string, userref: number): void {
  writeDrafts(getDrafts().map((d) => (d.id === id ? { ...d, status: 'released', releasedAt: new Date().toISOString(), userref } : d)))
}

/** Entwürfe mit Kursalarm aktualisieren, ohne andere Felder anzufassen */
export function markAlarmFired(ids: string[]): void {
  const at = new Date().toISOString()
  writeDrafts(getDrafts().map((d) => (ids.includes(d.id) ? { ...d, alarmFiredAt: at } : d)))
}

/** Protokoll: die letzten 2000 Aktionen, neueste zuerst. Nie mit Schlüsseln. */
export function getLog(): LogEntry[] {
  return readJson<{ entries: LogEntry[] }>('log.json', { entries: [] }).entries
}

export function addLog(e: Omit<LogEntry, 'at'>): void {
  const entry: LogEntry = { at: new Date().toISOString(), ...e }
  writeJson('log.json', { entries: [entry, ...getLog()].slice(0, 2000) }, false)
}

/** Alles außer dem Schlüssel für die Datensicherung */
export function exportAll(): BackupData {
  return makeBackup({
    settings: getSettings() as unknown as Record<string, unknown>,
    plans: getPlans(),
    drafts: getDrafts(),
    templates: getTemplates(),
    log: getLog(),
    notified: getNotified(),
    fills: Object.entries(getFillBooks()).map(([exchange, b]) => ({ exchange, orders: b.orders })),
  })
}

/** Ersetzt Pläne, Entwürfe, Vorlagen, Einstellungen und Protokoll. Vorher wird der alte Stand im App-Ordner gesichert. */
export function importAll(d: BackupData): string {
  const safety = file(`vor-wiederherstellung-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(safety, JSON.stringify(exportAll(), null, 2))
  writeJson('settings.json', cleanSettings(d.settings))
  writeJson('plans.json', { plans: d.plans })
  writeJson('drafts.json', { drafts: d.drafts })
  writeJson('templates.json', { templates: d.templates })
  writeJson('log.json', { entries: d.log }, false)
  writeJson('notified.json', { txids: d.notified.length ? d.notified : ['-'] }, false)
  // Ältere Sicherungen haben kein Ausführungsbuch: dann bleibt das vorhandene, es lässt sich bei der Börse neu abfragen
  if (d.fills.length) {
    const books: Record<string, unknown> = {}
    for (const f of d.fills as { exchange: unknown; orders: unknown }[]) if (isExchangeId(f.exchange)) books[f.exchange] = { orders: f.orders, coveredFrom: null, fetchedAt: 0, pairs: [] }
    writeJson('fills.json', { books }, false)
  }
  return safety
}
