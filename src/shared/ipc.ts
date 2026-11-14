// Gemeinsame Typen für Fenster und Hauptprozess
import type { LadderInput, LadderLevel, Side } from './ladder'
import type { BackupSummary } from './backup'
import type { ExchangeId } from './exchanges'

export interface PairDto {
  id: string
  name: string
  base: string
  quote: string
  priceDecimals: number
  volumeDecimals: number
  orderMin: number
  costMin: number
  tickSize?: number
}

export interface SendRequest {
  pairId: string
  pairName: string
  side: Side
  input: LadderInput
  levels: LadderLevel[]
  validate: boolean
  postOnly: boolean
  /** Nur die ersten N gültigen Stufen (nah am Kurs) senden, der Rest kann später folgen */
  sendCount?: number
  /** Wird ein Entwurf freigegeben, merkt sich die App dort die Plan-Nummer */
  draftId?: string
}

export interface SettingsDto {
  maxPlanEur: number
  watchlist: string[]
  currency: 'EUR' | 'USD'
  /** de = 1.234,56, en = 1,234.56 */
  numberFormat: 'de' | 'en'
  /** Börse, mit der die App gerade arbeitet */
  exchange: ExchangeId
  /** Sprache der App, fehlt sie, gilt die Systemsprache */
  language?: 'de' | 'en'
}

export interface SendResult {
  userref: number
  validate: boolean
  orders: { index: number; price: number; volume: number; txid?: string; error?: string; uncertain?: boolean }[]
}

export interface OpenOrderDto {
  txid: string
  pair: string
  side: Side
  price: number
  volume: number
  filled: number
  cost: number
  fee: number
  userref: number
}

export interface PlanDto {
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
  levels?: LadderLevel[]
  sentIndices?: number[]
  postOnly?: boolean
}

export interface TemplateDto {
  id: string
  name: string
  pairName: string
  input: LadderInput
  postOnly: boolean
}

/** Ergebnis der Rechte-Prüfung eines API-Schlüssels */
export interface KeyCheck {
  id: string
  /** Deutsche Beschreibung */
  label: string
  /** So heißt das Häkchen bei der Börse (Englisch, wie auf deren Seite) */
  exchangeLabel: string
  required: boolean
  ok: boolean
  detail?: string
}

export interface SaveKeyResult {
  saved: boolean
  checks: KeyCheck[]
}

/** Zwischengespeicherte Order-Gruppe, die erst nach Freigabe an die Börse geht */
export interface DraftDto {
  id: string
  /** Börse des Entwurfs. Fehlt bei älteren Entwürfen (dann Kraken). */
  exchange?: ExchangeId
  name: string
  /** Szenario zum Gruppieren, z. B. „Crash unter 60.000 €“ */
  scenario: string
  note?: string
  createdAt: string
  updatedAt: string
  pairId: string
  pairName: string
  side: Side
  input: LadderInput
  postOnly: boolean
  /** Nur die ersten N Stufen senden, der Rest kommt später über „Rest senden“ */
  sendCount?: number
  /** Kurs beim Speichern */
  priceAtSave?: number
  status: 'draft' | 'released'
  releasedAt?: string
  /** Plan-Nummer nach der Freigabe */
  userref?: number
  /** Mitteilung, wenn der Kurs die erste Stufe erreicht */
  alarm?: boolean
  /** Zeitpunkt, an dem der Kursalarm ausgelöst hat (danach erst nach erneutem Speichern wieder) */
  alarmFiredAt?: string
}

/** Ein Eintrag im Protokoll */
export interface LogEntry {
  at: string
  /** send, validate, rest, cancel-plan, cancel-order, cancel-all, key-save, key-clear, alarm, restore */
  action: string
  pair?: string
  side?: Side
  userref?: number
  /** Anzahl Orders bzw. stornierte Orders */
  count?: number
  ok?: number
  failed?: number
  /** Gegenwert in EUR */
  amount?: number
  /** true = erfolgreich, false = Fehler */
  success: boolean
  message?: string
}

export interface PlanStatusDto {
  userref: number
  open: number
  filled: number
  partial: number
  canceled: number
  filledVolume: number
  filledCost: number
  fees: number
  averagePrice: number
}

export interface Api {
  /** touchId: Mac kann Touch ID abfragen, dann ist es vor jedem echten Senden Pflicht */
  /** hasKey gilt für die aktive Börse, keys zeigt alle Börsen */
  keyStatus(): Promise<{ hasKey: boolean; encryption: boolean; touchId: boolean; exchange: ExchangeId; keys: Record<ExchangeId, boolean> }>
  /** Für die aktive Börse. noWithdrawConfirmed: Nutzer bestätigt, dass Auszahlungen aus sind (Bitvavo) */
  saveKey(key: string, secret: string, opts?: { noWithdrawConfirmed?: boolean }): Promise<SaveKeyResult>
  /** Rechte des gespeicherten Schlüssels erneut prüfen */
  verifyKey(): Promise<KeyCheck[]>
  clearKey(): Promise<void>
  pairs(): Promise<PairDto[]>
  price(pairId: string): Promise<number>
  /** Letzte Kurse mehrerer Paare auf einmal */
  prices(pairIds: string[]): Promise<Record<string, number>>
  balances(): Promise<Record<string, number>>
  openOrders(): Promise<OpenOrderDto[]>
  send(req: SendRequest): Promise<SendResult>
  cancelPlan(userref: number): Promise<number>
  cancelOrder(txid: string): Promise<void>
  /** Notbremse: alle offenen Orders auf allen verbundenen Börsen stornieren */
  cancelAll(): Promise<number>
  /** Systemstatus der aktiven Börse (online, maintenance, cancel_only …) */
  systemStatus(): Promise<string>
  log(): Promise<LogEntry[]>
  /** Sicherung speichern (Dialog). null = abgebrochen */
  backupExport(): Promise<(BackupSummary & { path: string }) | null>
  /** Sicherung auswählen und prüfen, ändert noch nichts. null = abgebrochen */
  backupPick(): Promise<BackupSummary | null>
  /** Ausgewählte Sicherung einspielen. Liefert den Pfad der automatischen Sicherung des alten Stands. */
  backupRestore(): Promise<string>
  plans(): Promise<PlanDto[]>
  settings(): Promise<SettingsDto>
  saveSettings(s: Partial<SettingsDto>): Promise<SettingsDto>
  usdRate(): Promise<number>
  sendRest(userref: number, validate: boolean): Promise<SendResult>
  ohlc(pairId: string, interval: number): Promise<[number, number][]>
  fees(pairId: string): Promise<{ maker: number; taker: number }>
  available(): Promise<Record<string, number>>
  templates(): Promise<TemplateDto[]>
  saveTemplate(t: TemplateDto): Promise<void>
  deleteTemplate(id: string): Promise<void>
  planStatus(): Promise<PlanStatusDto[]>
  drafts(): Promise<DraftDto[]>
  saveDraft(d: DraftDto): Promise<void>
  deleteDraft(id: string): Promise<void>
  onFills(cb: () => void): () => void
  /** Hauptprozess bittet, eine Seite zu öffnen (z. B. nach Klick auf einen Kursalarm) */
  onOpenPage(cb: (page: string) => void): () => void
}
