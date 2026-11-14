// Lokale Ablage im App-Ordner (~/Library/Application Support/Fehu Orders).
// Der API-Schlüssel wird mit Electron safeStorage verschlüsselt. Den Generalschlüssel
// dafür verwaltet der macOS-Schlüsselbund, genau wie beim Lifemanager.
import { app, safeStorage } from 'electron'
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Credentials } from './exchange'
import { exchangeOf, isExchangeId, type ExchangeId } from '../shared/exchanges'
import type { LadderInput, LadderLevel, Side } from '../shared/ladder'
import type { DraftDto, LogEntry } from '../shared/ipc'
import { makeBackup, type BackupData } from '../shared/backup'
import { tr, type Lang } from '../shared/i18n'

const file = (name: string) => join(app.getPath('userData'), name)

/** Je Börse eine eigene verschlüsselte Datei. Kraken behält den alten Namen, damit vorhandene Schlüssel bleiben. */
const keyFile = (ex: ExchangeId) => file(ex === 'kraken' ? 'kraken-key.bin' : `${ex}-key.bin`)

export function saveCredentials(c: Credentials, ex: ExchangeId = 'kraken'): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error(tr('Der Schlüsselbund ist nicht verfügbar. Der Schlüssel wird nicht unverschlüsselt gespeichert.', 'The macOS keychain is not available. The key is never stored unencrypted.'))
  const f = keyFile(ex)
  writeFileSync(`${f}.tmp`, safeStorage.encryptString(JSON.stringify(c)), { mode: 0o600 })
  renameSync(`${f}.tmp`, f)
}

export function loadCredentials(ex: ExchangeId = 'kraken'): Credentials | null {
  const f = keyFile(ex)
  if (!existsSync(f)) return null
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(f)))
  } catch {
    return null
  }
}

export function clearCredentials(ex: ExchangeId = 'kraken'): void {
  const f = keyFile(ex)
  if (existsSync(f)) unlinkSync(f)
}

export interface Settings {
  /** Obergrenze pro Plan in EUR, schützt vor Tippfehlern */
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
}

export const DEFAULT_SETTINGS: Settings = { maxPlanEur: 50, watchlist: ['BTC/EUR', 'ETH/EUR'], currency: 'EUR', numberFormat: 'de', exchange: 'kraken' }

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
  return s
}

export function getSettings(): Settings {
  return cleanSettings(readJson<Record<string, unknown>>('settings.json', {}))
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
  return safety
}
