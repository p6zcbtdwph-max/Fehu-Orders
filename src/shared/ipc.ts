// Gemeinsame Typen für Fenster und Hauptprozess
import type { OhlcRow } from './history'
import type { ZoneProgress } from './plan-status'
import type { LadderInput, LadderLevel, Side } from './ladder'
import type { BackupSummary } from './backup'
import type { LotEvent, ManualLot } from './holding-period'
import type { KeyRole, KeyRoles, TradeKeyMode } from './key-roles'
import type { ExchangeId } from './exchanges'
import type { HomeIpView } from './ip'
import type { CashPot, ManualHolding, PortfolioSource, PortfolioTargets } from './portfolio'

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
  /** Börse, für die Paar und Regeln geladen wurden. Weicht sie von der gewählten ab, sendet die App nichts. */
  exchange?: ExchangeId
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
  /** Mindest-Orderwert je Order in EUR (Standard 10 €) */
  minOrderEur: number
  /** Portfolio: eigene Cash-Töpfe */
  cashPots?: CashPot[]
  /** Portfolio: Entwürfe im Soll mitzählen (Standard ja) */
  portfolioDrafts?: boolean
  /** Portfolio: Wunsch-Aufteilung in Prozent je Coin und 'cash' */
  portfolioTargets?: PortfolioTargets
  /** Wie lange der Handels-Schlüssel bleibt (Standard: dauerhaft) */
  tradeKeyMode?: TradeKeyMode
  /** Haltefrist: selbst eingetragene ältere Käufe */
  manualLots?: ManualLot[]
  /** Portfolio: eigene Einträge (Wallet, Broker) */
  manualHoldings?: ManualHolding[]
}

export interface SendResult {
  userref: number
  validate: boolean
  orders: { index: number; price: number; volume: number; txid?: string; error?: string; uncertain?: boolean }[]
  /**
   * Nachkontrolle direkt nach dem echten Senden: wie viele der angelegten Orders die Börse in den offenen Orders zeigt.
   * Fehlt, wenn die Abfrage nicht klappte (dann bleibt nur die Antwort der Börse beim Anlegen).
   */
  check?: { found: number; placed: number }
  /** Einstellung „Nur für eine Sendung“: Die App hat den Handels-Schlüssel nach dem Senden vergessen */
  tradeKeyForgotten?: boolean
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
  /** Zeitpunkt, an dem der Plan in der App storniert wurde. Danach gibt es keine Reststufen oder Zonen mehr zu senden. */
  cancelledAt?: string
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

export interface KeyStatusDto {
  hasKey: boolean
  encryption: boolean
  touchId: boolean
  exchange: ExchangeId
  keys: Record<ExchangeId, boolean>
  roles: Record<ExchangeId, KeyRoles>
  tradeKeyMode: TradeKeyMode
}

export interface ClearAllResult {
  /** Welche Schlüssel gelöscht wurden */
  deleted: { exchange: ExchangeId; roles: KeyRole[] }[]
  /** Notbremse vorher: Anzahl stornierter Orders, oder Fehlermeldung */
  cancelled?: number
  cancelError?: string
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
  /** send, validate, rest, cancel-plan, cancel-order, cancel-all, key-save, key-clear, ip-save, ip-delete, alarm, restore */
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
  /** Erste und letzte Ausführung (Unix-Sekunden) aus dem Ausführungsbuch */
  firstFillAt?: number
  lastFillAt?: number
  /** Nur bei Plänen mit Preiszonen: Fortschritt je Zone */
  zones?: ZoneProgress[]
}

export interface Api {
  /** touchId: Mac kann Touch ID abfragen, dann ist es vor jedem echten Senden Pflicht */
  /** hasKey gilt für die aktive Börse, keys zeigt alle Börsen */
  /** keys: Börse hat irgendeinen Schlüssel. roles: welcher genau (Nur-Lese, Handel). */
  keyStatus(): Promise<KeyStatusDto>
  /** Für die aktive Börse. noWithdrawConfirmed: Nutzer bestätigt, dass Auszahlungen aus sind (Bitvavo) */
  /** exchange: für welche Börse (Standard: die aktive). role: Nur-Lese- oder Handels-Schlüssel (Standard: Handel) */
  saveKey(key: string, secret: string, opts?: { noWithdrawConfirmed?: boolean; exchange?: ExchangeId; role?: KeyRole }): Promise<SaveKeyResult>
  /** Rechte des gespeicherten Schlüssels erneut prüfen */
  verifyKey(exchange?: ExchangeId, role?: KeyRole): Promise<KeyCheck[]>
  clearKey(exchange?: ExchangeId, role?: KeyRole): Promise<void>
  /**
   * Notfall-Knopf: alle Schlüssel aller Börsen sofort aus der App löschen. Bei den Börsen bleiben sie gültig,
   * bis man sie dort widerruft. cancelOrders: vorher noch die Notbremse ziehen.
   */
  clearAllKeys(opts?: { cancelOrders?: boolean }): Promise<ClearAllResult>
  /** Haltefrist: bekannte Käufe und Verkäufe der aktiven Börse (über die App ausgeführt und selbst eingetragen) */
  lotEvents(): Promise<LotEvent[]>
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
  /**
   * Eine entschärfte Zone eines gesendeten Plans aktivieren: ihre Stufen gehen jetzt raus (gleiche Plan-Nummer).
   * levels: geänderte Stufen der Zone (nach „Bearbeiten“), sonst die beim Planen berechneten.
   */
  armZone(userref: number, zone: number, validate: boolean, levels?: LadderLevel[]): Promise<SendResult>
  /** Kerzen: [Zeit in s, Schlusskurs, Tief, Hoch] */
  ohlc(pairId: string, interval: number): Promise<OhlcRow[]>
  fees(pairId: string): Promise<{ maker: number; taker: number }>
  available(): Promise<Record<string, number>>
  templates(): Promise<TemplateDto[]>
  saveTemplate(t: TemplateDto): Promise<void>
  deleteTemplate(id: string): Promise<void>
  planStatus(): Promise<PlanStatusDto[]>
  /** Portfolio: Pläne, Entwürfe, Stand, offene Orders, Euro und Kurse aller Börsen mit Plänen oder Schlüssel */
  portfolio(): Promise<PortfolioSource[]>
  drafts(): Promise<DraftDto[]>
  saveDraft(d: DraftDto): Promise<void>
  deleteDraft(id: string): Promise<void>
  /** Gespeicherte eigene IP-Adressen, nur verdeckt */
  homeIps(): Promise<HomeIpView[]>
  /** Klartext einer Adresse (Nummer in der Liste) */
  revealHomeIp(index: number): Promise<string>
  /** Adresse in die Zwischenablage kopieren, ohne sie anzuzeigen */
  copyHomeIp(index: number): Promise<void>
  addHomeIp(ip: string, label?: string): Promise<HomeIpView[]>
  deleteHomeIp(index: number): Promise<HomeIpView[]>
  onFills(cb: () => void): () => void
  /** Hauptprozess bittet, eine Seite zu öffnen (z. B. nach Klick auf einen Kursalarm) */
  onOpenPage(cb: (page: string) => void): () => void
}
