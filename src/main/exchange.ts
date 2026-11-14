// Gemeinsame Schnittstelle aller Börsen. Der Rest der App spricht nur mit dieser Schnittstelle,
// welche Börse dahinter steckt, entscheidet create() anhand der Einstellungen.
// Läuft nur im Hauptprozess, Schlüssel verlassen ihn nie.
import type { LadderLevel, PairRules, Side } from '../shared/ladder'
import type { KeyCheck } from '../shared/ipc'
import type { ExchangeId } from '../shared/exchanges'
import { tr } from '../shared/i18n'

export interface Credentials {
  key: string
  secret: string
}

export interface PairInfo extends PairRules {
  /** Kennung bei der Börse, z. B. XXBTZEUR (Kraken) oder BTC-EUR */
  id: string
  /** Anzeigename, z. B. BTC/EUR */
  name: string
  /** So heißen Basis- und Kurswährung im Guthaben dieser Börse */
  base: string
  quote: string
}

export interface SentOrder {
  index: number
  price: number
  volume: number
  txid?: string
  error?: string
  /** Verbindung brach ab und es ließ sich nicht klären, ob die Börse die Order angelegt hat */
  uncertain?: boolean
}

export interface ClosedOrder {
  txid: string
  /** closed (ausgeführt), canceled, expired */
  status: string
  side: Side
  volume: number
  filled: number
  cost: number
  fee: number
  /** Durchschnittlicher Ausführungspreis */
  price: number
  /** Limitpreis der Order */
  limitPrice: number
  userref: number
}

export interface OpenOrder {
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

export interface PlaceOptions {
  validate: boolean
  /** Plan-Nummer, mit der alle Orders eines Plans markiert werden */
  userref: number
  postOnly?: boolean
  onProgress?: (done: number) => void
  /** Regeln des Paars, für Börsen ohne eigenen Probelauf */
  rules?: PairInfo
}

export interface Exchange {
  readonly id: ExchangeId
  pairs(): Promise<PairInfo[]>
  /** online, maintenance, cancel_only, reduce_only, post_only */
  systemStatus(): Promise<string>
  lastPrice(pairId: string): Promise<number>
  lastPrices(pairIds: string[]): Promise<Record<string, number>>
  /** Bestand je Währung (wie im Guthaben der Börse benannt) */
  balances(): Promise<Record<string, number>>
  /** Frei verfügbar, also ohne das, was in offenen Orders gebunden ist */
  available(): Promise<Record<string, number>>
  openOrders(): Promise<OpenOrder[]>
  placeLadder(pairId: string, side: Side, levels: LadderLevel[], opts: PlaceOptions): Promise<SentOrder[]>
  /** Geschlossene Orders seit start (Unix-Sekunden). pairIds: Paare der Pläne (manche Börsen fragen je Paar ab). */
  closedOrdersSince(start: number, maxPages: number, pairIds: string[]): Promise<ClosedOrder[]>
  cancelPlan(userref: number): Promise<number>
  cancelOrder(txid: string): Promise<void>
  cancelAll(): Promise<number>
  ohlc(pairId: string, interval: number): Promise<[number, number][]>
  /** Gebühren in Prozent */
  fees(pairId: string): Promise<{ maker: number; taker: number }>
  /** noWithdrawConfirmed: Nutzer hat bestätigt, dass Auszahlungen aus sind (für Börsen, die das nicht verraten) */
  checkPermissions(opts?: { noWithdrawConfirmed?: boolean }): Promise<KeyCheck[]>
}

/**
 * kind: api = Börse hat geantwortet und abgelehnt, rate = Börse bremst,
 * network = keine oder keine lesbare Antwort (bei Orders unklar, ob angelegt)
 */
export class ExchangeError extends Error {
  constructor(message: string, public kind: 'api' | 'rate' | 'network' = 'api', public codes: string[] = []) {
    super(message)
  }
}

export interface HttpInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}
export type FetchLike = (url: string, init?: HttpInit) => Promise<{ status?: number; text(): Promise<string> }>

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Zahl ohne wissenschaftliche Schreibweise (5e-7 wird 0.0000005), ohne überflüssige Nullen */
export function plain(n: number): string {
  if (!Number.isFinite(n)) throw new ExchangeError(tr('Ungültige Zahl in einer Order.', 'Invalid number in an order.'))
  const s = n.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

/** Nachkommastellen eines Schritts wie "0.01" → 2, "1" → 0, "1e-8" → 8 */
export function decimalsOf(step: string | number): number {
  const n = Number(step)
  if (!(n > 0)) return 8
  const s = plain(n)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

/** Gleicher Preis nach dem Runden (Börsen liefern Preise als Text) */
export const same = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-9

/** Liegt ein Wert auf einem erlaubten Schritt (z. B. Preis auf tick size)? */
export function onStep(value: number, step: number | undefined): boolean {
  if (!step || !(step > 0)) return true
  const q = value / step
  return Math.abs(q - Math.round(q)) < 1e-6
}

/**
 * Prüft Orders ohne Börse (für Börsen ohne eigenen Probelauf): Mindestmenge, Mindestbetrag, Preisschritt,
 * Nachkommastellen und ob das freie Guthaben für alle Stufen zusammen reicht.
 */
export function localCheck(levels: LadderLevel[], side: Side, rules: PairInfo | undefined, free: Record<string, number> | null): SentOrder[] {
  const needQuote = levels.reduce((a, l) => a + l.price * l.volume, 0)
  const needBase = levels.reduce((a, l) => a + l.volume, 0)
  const have = free ? (side === 'buy' ? free[rules?.quote ?? ''] ?? 0 : free[rules?.base ?? ''] ?? 0) : null
  const short = have !== null && (side === 'buy' ? needQuote > have * 1.000001 : needBase > have * 1.000001)
  return levels.map((l) => {
    const base = { index: l.index, price: l.price, volume: l.volume }
    let error: string | undefined
    if (!rules) error = tr('Das Handelspaar ist gerade nicht handelbar.', 'This trading pair cannot be traded right now.')
    else if (l.volume < rules.orderMin) error = tr('Eine Order ist kleiner als die Mindestmenge.', 'An order is below the minimum volume.')
    else if (l.price * l.volume < rules.costMin) error = tr('Eine Order liegt unter dem Mindestbetrag.', 'An order is below the minimum cost.')
    else if (!onStep(l.price, rules.tickSize)) error = tr('Ein Preis passt nicht zu den erlaubten Preisschritten dieses Paars.', 'A price does not match the allowed price steps (tick size) of this pair.')
    else if (decimalsOf(l.volume) > rules.volumeDecimals) error = tr('Eine Menge hat zu viele Nachkommastellen.', 'A volume has too many decimal places.')
    else if (short) error = tr('Nicht genug freies Guthaben für alle Stufen zusammen.', 'Not enough free balance for all levels together.')
    return error ? { ...base, error } : base
  })
}

/** Netz- und Zeitfehler einheitlich übersetzen */
export function networkError(name: string, e: unknown, timeoutMs: number): ExchangeError {
  const n = (e as Error)?.name
  if (n === 'TimeoutError' || n === 'AbortError') return new ExchangeError(tr(`${name} hat nicht innerhalb von ${Math.round(timeoutMs / 1000)} Sekunden geantwortet.`, `${name} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`), 'network')
  return new ExchangeError(tr(`Keine Verbindung zu ${name}. Prüfe deine Internetverbindung.`, `No connection to ${name}. Check your internet connection.`), 'network')
}

export function unreadable(name: string, status: number): ExchangeError {
  return new ExchangeError(
    status >= 500 || status === 0
      ? tr(`${name} ist gerade nicht erreichbar oder in Wartung (Fehler ${status || 'unbekannt'}). Bitte später noch einmal versuchen.`, `${name} is unreachable or under maintenance right now (error ${status || 'unknown'}). Please try again later.`)
      : tr(`${name} hat unerwartet geantwortet (Fehler ${status}).`, `${name} sent an unexpected answer (error ${status}).`),
    'network',
  )
}

export const noKey = (): ExchangeError => new ExchangeError(tr('Kein API-Schlüssel hinterlegt.', 'No API key saved.'))

export const uncertainText = (msg: string): string => tr(`${msg} Unklar, ob diese Order angelegt wurde. Bitte unter „Offene Orders“ nachsehen.`, `${msg} Unclear whether this order was placed. Please check under “Open orders”.`)
export const notPlacedText = (msg: string): string => tr(`${msg} Diese Order wurde nicht angelegt.`, `${msg} This order was not placed.`)
export const skippedText = (): string => tr('Nicht gesendet, weil eine vorherige Order fehlschlug.', 'Not sent because a previous order failed.')

/**
 * Plan-Nummer in einer UUID verstecken (Bitvavo verlangt UUIDs als eigene Order-Kennung):
 * erste 8 Stellen = userref, dann die Kennung fe70, dann Stufe und Zufall.
 */
export function refUuid(userref: number, index: number, rand: () => number = Math.random): string {
  const hex = (n: number, len: number) => Math.floor(n).toString(16).padStart(len, '0').slice(-len)
  const r = (len: number) => Array.from({ length: len }, () => Math.floor(rand() * 16).toString(16)).join('')
  return `${hex(userref >>> 0, 8)}-fe70-4${hex(index, 3)}-8${r(3)}-${r(12)}`
}

/** Plan-Nummer aus einer refUuid oder einer Coinbase-Kennung fehu-<userref>-… lesen, sonst 0 */
export function refFromClientId(id: string | undefined | null): number {
  if (!id) return 0
  const u = /^([0-9a-f]{8})-fe70-/i.exec(id)
  if (u) return parseInt(u[1], 16)
  const c = /^fehu-(\d+)-/.exec(id)
  return c ? Number(c[1]) : 0
}
