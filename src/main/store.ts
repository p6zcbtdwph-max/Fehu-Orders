// Lokale Ablage im App-Ordner (~/Library/Application Support/Fehu Orders).
// Der API-Schlüssel wird mit Electron safeStorage verschlüsselt. Den Generalschlüssel
// dafür verwaltet der macOS-Schlüsselbund, genau wie beim Lifemanager.
import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Credentials } from './kraken'
import type { LadderInput, LadderLevel, Side } from '../shared/ladder'
import type { DraftDto } from '../shared/ipc'

const file = (name: string) => join(app.getPath('userData'), name)

export function saveCredentials(c: Credentials): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Der Schlüsselbund ist nicht verfügbar. Der Schlüssel wird nicht unverschlüsselt gespeichert.')
  writeFileSync(file('kraken-key.bin'), safeStorage.encryptString(JSON.stringify(c)), { mode: 0o600 })
}

export function loadCredentials(): Credentials | null {
  const f = file('kraken-key.bin')
  if (!existsSync(f)) return null
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(f)))
  } catch {
    return null
  }
}

export function clearCredentials(): void {
  const f = file('kraken-key.bin')
  if (existsSync(f)) unlinkSync(f)
}

export interface Settings {
  /** Obergrenze pro Plan in EUR, schützt vor Tippfehlern */
  maxPlanEur: number
  /** Handelspaare (Anzeigename wie BTC/EUR), die oben als Schnellauswahl stehen */
  watchlist: string[]
  /** Anzeigewährung. Orders laufen immer in der Kurswährung des Paars (EUR). */
  currency: 'EUR' | 'USD'
}

export const DEFAULT_SETTINGS: Settings = { maxPlanEur: 500, watchlist: ['BTC/EUR', 'ETH/EUR'], currency: 'EUR' }

export interface PlanRecord {
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

function readJson<T>(name: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(readFileSync(file(name), 'utf8')) }
  } catch {
    return fallback
  }
}

export function getSettings(): Settings {
  return readJson('settings.json', DEFAULT_SETTINGS)
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const s = { ...getSettings(), ...patch }
  writeFileSync(file('settings.json'), JSON.stringify(s, null, 2))
  return s
}

export function getPlans(): PlanRecord[] {
  return readJson<{ plans: PlanRecord[] }>('plans.json', { plans: [] }).plans
}

export function addPlan(p: PlanRecord): void {
  writeFileSync(file('plans.json'), JSON.stringify({ plans: [p, ...getPlans()].slice(0, 200) }, null, 2))
}

export function updatePlan(userref: number, change: (p: PlanRecord) => PlanRecord): void {
  writeFileSync(file('plans.json'), JSON.stringify({ plans: getPlans().map((p) => (p.userref === userref ? change(p) : p)) }, null, 2))
}

/** Plan-Kennung für Krakens userref (positive 32-Bit-Zahl), aus der Zeit abgeleitet */
export function newUserref(): number {
  return Math.floor(Date.now() / 1000) % 2_000_000_000
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
  writeFileSync(file('templates.json'), JSON.stringify({ templates: [t, ...rest] }, null, 2))
}

export function deleteTemplate(id: string): void {
  writeFileSync(file('templates.json'), JSON.stringify({ templates: getTemplates().filter((x) => x.id !== id) }, null, 2))
}

/** txids, über deren Ausführung schon benachrichtigt wurde */
export function getNotified(): string[] {
  return readJson<{ txids: string[] }>('notified.json', { txids: [] }).txids
}

export function setNotified(txids: string[]): void {
  writeFileSync(file('notified.json'), JSON.stringify({ txids: txids.slice(-5000) }))
}

/** Entwürfe: Order-Gruppen, die erst nach Freigabe an Kraken gehen */
export function getDrafts(): DraftDto[] {
  return readJson<{ drafts: DraftDto[] }>('drafts.json', { drafts: [] }).drafts
}

function writeDrafts(drafts: DraftDto[]): void {
  writeFileSync(file('drafts.json'), JSON.stringify({ drafts: drafts.slice(0, 300) }, null, 2))
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
