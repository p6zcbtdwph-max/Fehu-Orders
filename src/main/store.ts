// Lokale Ablage im App-Ordner (~/Library/Application Support/Fehu Orders).
// Der API-Schlüssel wird mit Electron safeStorage verschlüsselt. Den Generalschlüssel
// dafür verwaltet der macOS-Schlüsselbund, genau wie beim Lifemanager.
import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Credentials } from './kraken'
import type { LadderInput, Side } from '../shared/ladder'

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
}

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
}

function readJson<T>(name: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(readFileSync(file(name), 'utf8')) }
  } catch {
    return fallback
  }
}

export function getSettings(): Settings {
  return readJson('settings.json', { maxPlanEur: 500 })
}

export function saveSettings(s: Settings): void {
  writeFileSync(file('settings.json'), JSON.stringify(s, null, 2))
}

export function getPlans(): PlanRecord[] {
  return readJson<{ plans: PlanRecord[] }>('plans.json', { plans: [] }).plans
}

export function addPlan(p: PlanRecord): void {
  writeFileSync(file('plans.json'), JSON.stringify({ plans: [p, ...getPlans()].slice(0, 200) }, null, 2))
}

/** Plan-Kennung für Krakens userref (positive 32-Bit-Zahl), aus der Zeit abgeleitet */
export function newUserref(): number {
  return Math.floor(Date.now() / 1000) % 2_000_000_000
}
