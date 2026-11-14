// Coinbase-Anbindung (Advanced Trade, REST v3). Läuft nur im Hauptprozess, der Schlüssel verlässt ihn nie.
// Doku: https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api
// Anmeldung per JWT (ES256), für jede Anfrage neu signiert und 2 Minuten gültig.
// Probelauf über /orders/preview, Rechte über /key_permissions (inklusive „darf auszahlen?“).
import { createPrivateKey, randomBytes, sign as cryptoSign } from 'node:crypto'
import type { LadderLevel, Side } from '../shared/ladder'
import type { KeyCheck } from '../shared/ipc'
import { tr } from '../shared/i18n'
import {
  ExchangeError, decimalsOf, localCheck, networkError, noKey, plain, refFromClientId, skippedText, sleep, uncertainText, unreadable,
  type ClosedOrder, type Credentials, type Exchange, type FetchLike, type OpenOrder, type PairInfo, type PlaceOptions, type SentOrder,
} from './exchange'

export const COINBASE_HOST = 'api.coinbase.com'
const BASE = `https://${COINBASE_HOST}`
const API = '/api/v3/brokerage'
const TIMEOUT_MS = 15_000
const ORDER_TIMEOUT_MS = 30_000
const GRANULARITY: Record<number, string> = { 60: 'ONE_HOUR', 240: 'FOUR_HOUR', 1440: 'ONE_DAY' }

/** JWT nach Coinbase-Vorgabe. uri = Methode, Leerzeichen, Host und Pfad ohne Abfrage. */
export function coinbaseJwt(keyName: string, pem: string, method: string, path: string, nowMs = Date.now(), nonce = randomBytes(16).toString('hex')): string {
  const t = Math.floor(nowMs / 1000)
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${b64({ alg: 'ES256', kid: keyName, nonce, typ: 'JWT' })}.${b64({ sub: keyName, iss: 'cdp', nbf: t, exp: t + 120, uri: `${method} ${COINBASE_HOST}${path}` })}`
  let key
  try {
    key = createPrivateKey(pem)
  } catch {
    throw new ExchangeError(tr('Der private Schlüssel lässt sich nicht lesen. Er beginnt mit „-----BEGIN EC PRIVATE KEY-----“ und muss vollständig sein.', 'The private key cannot be read. It starts with “-----BEGIN EC PRIVATE KEY-----” and must be complete.'))
  }
  const sig = cryptoSign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${data}.${sig}`
}

/** Übersetzt Coinbases Ablehnungsgründe (z. B. INSUFFICIENT_FUND, PREVIEW_INVALID_BASE_SIZE_TOO_SMALL) */
export function explainCoinbase(reason: string): string {
  const r = String(reason ?? '').toUpperCase()
  if (r.includes('INSUFFICIENT_FUND')) return tr('Nicht genug Guthaben.', 'Insufficient funds.')
  if (r.includes('POST_ONLY')) return tr('Post-only: Diese Order wäre sofort ausgeführt worden und wurde deshalb abgelehnt.', 'Post-only: this order would have filled immediately and was rejected.')
  if (r.includes('TOO_SMALL') || r.includes('BELOW_MIN')) return tr('Eine Order ist kleiner als die Mindestmenge oder der Mindestbetrag.', 'An order is below the minimum volume or cost.')
  if (r.includes('TOO_LARGE')) return tr('Eine Order ist größer als erlaubt.', 'An order is larger than allowed.')
  if (r.includes('PRICE_PRECISION') || r.includes('LIMIT_PRICE')) return tr('Ein Preis passt nicht zu den erlaubten Preisschritten dieses Paars.', 'A price does not match the allowed price steps of this pair.')
  if (r.includes('SIZE_PRECISION')) return tr('Eine Menge hat zu viele Nachkommastellen.', 'A volume has too many decimal places.')
  if (r.includes('DISABLED') || r.includes('CANCEL_ONLY') || r.includes('LIMIT_ONLY')) return tr('Der Markt ist gerade eingeschränkt.', 'The market is currently restricted.')
  if (r.includes('INVALID_PRODUCT') || r.includes('UNKNOWN_PRODUCT')) return tr('Dieses Handelspaar kennt Coinbase nicht.', 'Coinbase does not know this trading pair.')
  if (r.includes('UNKNOWN_CANCEL_ORDER') || r.includes('NOT_FOUND')) return tr('Diese Order gibt es bei Coinbase nicht (mehr).', 'This order does not exist (any more) at Coinbase.')
  if (r.includes('FULLY_FILLED')) return tr('Die Order ist schon vollständig ausgeführt.', 'The order is already completely filled.')
  if (r.includes('PERMISSION') || r.includes('NOT_ALLOWED')) return tr('Dem API-Schlüssel fehlt eine Berechtigung (View oder Trade).', 'The API key is missing a permission (View or Trade).')
  return `Coinbase: ${reason || tr('unbekannter Fehler', 'unknown error')}`
}

const STATUS: Record<string, string> = { FILLED: 'closed', CANCELLED: 'canceled', EXPIRED: 'expired' }
const limitCfg = (o: any) => o?.order_configuration?.limit_limit_gtc ?? o?.order_configuration?.limit_limit_gtd ?? {}

export class Coinbase implements Exchange {
  readonly id = 'coinbase' as const
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private creds: Credentials | null,
    private http: FetchLike = fetch as unknown as FetchLike,
    private pause: (ms: number) => Promise<unknown> = sleep,
  ) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async request(method: string, path: string, query: [string, string | number][] = [], body?: unknown, auth = false, timeoutMs = TIMEOUT_MS): Promise<any> {
    const qs = new URLSearchParams(query.map(([k, v]) => [k, String(v)])).toString()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth) {
      if (!this.creds) throw noKey()
      headers.Authorization = `Bearer ${coinbaseJwt(this.creds.key, this.creds.secret, method, path)}`
    }
    let res: Awaited<ReturnType<FetchLike>>
    let raw: string
    try {
      res = await this.http(BASE + path + (qs ? `?${qs}` : ''), { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) })
      raw = await res.text()
    } catch (e) {
      throw networkError('Coinbase', e, timeoutMs)
    }
    const status = res.status ?? 200
    if (status === 401) throw new ExchangeError(tr('Coinbase lehnt den Schlüssel ab. Prüfe Schlüssel-Name und privaten Schlüssel, und dass du beim Anlegen ECDSA gewählt hast. Geht die Uhr deines Macs richtig?', 'Coinbase rejects the key. Check key name and private key, and that you chose ECDSA when creating it. Is your Mac’s clock correct?'), 'api', ['401'])
    if (status === 429) throw new ExchangeError(tr('Zu viele Anfragen. Coinbase bremst kurz, bitte in einer Minute noch einmal versuchen.', 'Too many requests. Coinbase is slowing things down, please try again in a minute.'), 'rate', ['429'])
    let data: any
    try {
      data = raw ? JSON.parse(raw) : {}
    } catch {
      throw unreadable('Coinbase', status)
    }
    if (status === 403) throw new ExchangeError(tr('Dem API-Schlüssel fehlt eine Berechtigung (View oder Trade).', 'The API key is missing a permission (View or Trade).'), 'api', ['403'])
    if (status >= 500) throw unreadable('Coinbase', status)
    if (status >= 400) throw new ExchangeError(explainCoinbase(data?.error_details || data?.message || data?.error || String(status)), 'api', [String(data?.error ?? status)])
    return data
  }

  private priv(method: string, path: string, query: [string, string | number][] = [], body?: unknown, timeoutMs = TIMEOUT_MS): Promise<any> {
    return this.serial(() => this.request(method, path, query, body, true, timeoutMs))
  }

  async pairs(quote = 'EUR'): Promise<PairInfo[]> {
    const all: any[] = []
    for (let page = 0; page < 20; page++) {
      const r = await this.request('GET', `${API}/market/products`, [['product_type', 'SPOT'], ['limit', 500], ['offset', all.length]])
      const batch: any[] = r?.products ?? []
      all.push(...batch)
      if (batch.length < 500 || (r?.num_products && all.length >= Number(r.num_products))) break
    }
    return all
      .filter((p) => p.quote_currency_id === quote && p.status === 'online' && !p.trading_disabled && !p.is_disabled && !p.cancel_only && (!p.product_type || p.product_type === 'SPOT'))
      .map((p) => {
        const step = p.price_increment || p.quote_increment
        return {
          id: String(p.product_id),
          name: `${p.base_display_symbol || p.base_currency_id}/${p.quote_display_symbol || p.quote_currency_id}`,
          base: String(p.base_currency_id),
          quote: String(p.quote_currency_id),
          priceDecimals: decimalsOf(step),
          volumeDecimals: decimalsOf(p.base_increment),
          orderMin: Number(p.base_min_size ?? 0),
          costMin: Number(p.quote_min_size ?? 0),
          ...(Number(step) > 0 ? { tickSize: Number(step) } : {}),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async systemStatus(): Promise<string> {
    await this.request('GET', `${API}/time`)
    return 'online'
  }

  async lastPrice(pairId: string): Promise<number> {
    const p = (await this.lastPrices([pairId]))[pairId]
    if (!(p > 0)) throw new ExchangeError(tr('Coinbase hat keinen Kurs geliefert.', 'Coinbase returned no price.'))
    return p
  }

  async lastPrices(pairIds: string[]): Promise<Record<string, number>> {
    if (!pairIds.length) return {}
    const r = await this.request('GET', `${API}/market/products`, pairIds.map((id) => ['product_ids', id] as [string, string]))
    const out: Record<string, number> = {}
    for (const p of r?.products ?? []) if (Number(p.price) > 0) out[p.product_id] = Number(p.price)
    return out
  }

  private async accounts(): Promise<any[]> {
    const all: any[] = []
    let cursor = ''
    for (let page = 0; page < 20; page++) {
      const r = await this.priv('GET', `${API}/accounts`, [['limit', 250], ...(cursor ? [['cursor', cursor] as [string, string]] : [])])
      all.push(...(r?.accounts ?? []))
      if (!r?.has_next || !r?.cursor) break
      cursor = r.cursor
    }
    return all
  }

  async balances(): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const a of await this.accounts()) {
      const v = Number(a.available_balance?.value ?? 0) + Number(a.hold?.value ?? 0)
      if (v > 0) out[a.currency] = (out[a.currency] ?? 0) + v
    }
    return out
  }

  async available(): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const a of await this.accounts()) out[a.currency] = (out[a.currency] ?? 0) + Number(a.available_balance?.value ?? 0)
    return out
  }

  /** Orders seitenweise über die Order-Liste. status: OPEN oder die geschlossenen Zustände. */
  private async listOrders(statuses: string[], extra: [string, string | number][] = [], maxPages = 20): Promise<any[]> {
    const all: any[] = []
    let cursor = ''
    for (let page = 0; page < maxPages; page++) {
      const r = await this.priv('GET', `${API}/orders/historical/batch`, [
        ...statuses.map((s) => ['order_status', s] as [string, string]), ['limit', 250], ...extra, ...(cursor ? [['cursor', cursor] as [string, string]] : []),
      ])
      all.push(...(r?.orders ?? []))
      if (!r?.has_next || !r?.cursor) break
      cursor = r.cursor
    }
    return all
  }

  async openOrders(): Promise<OpenOrder[]> {
    return (await this.listOrders(['OPEN'])).map((o) => {
      const cfg = limitCfg(o)
      return {
        txid: String(o.order_id),
        pair: String(o.product_id),
        side: String(o.side).toLowerCase() as Side,
        price: Number(cfg.limit_price ?? 0),
        volume: Number(cfg.base_size ?? 0),
        filled: Number(o.filled_size ?? 0),
        cost: Number(o.filled_value ?? 0),
        fee: Number(o.total_fees ?? 0),
        userref: refFromClientId(o.client_order_id),
      }
    })
  }

  private config(l: LadderLevel, postOnly: boolean) {
    return { limit_limit_gtc: { base_size: plain(l.volume), limit_price: plain(l.price), post_only: postOnly } }
  }

  private async createOnce(body: unknown): Promise<any> {
    return this.priv('POST', `${API}/orders`, [], body, ORDER_TIMEOUT_MS)
  }

  /**
   * Legt die Stufen einzeln an. Jede Order trägt die Plan-Nummer in client_order_id (fehu-<userref>-<stufe>-…).
   * Coinbase legt bei gleicher client_order_id keine zweite Order an, deshalb darf nach einem Verbindungsabbruch
   * gefahrlos einmal wiederholt werden. Probelauf: Coinbase-Vorschau je Order plus Guthaben-Prüfung für alle zusammen.
   */
  async placeLadder(pairId: string, side: Side, levels: LadderLevel[], opts: PlaceOptions): Promise<SentOrder[]> {
    const SIDE = side === 'buy' ? 'BUY' : 'SELL'
    if (opts.validate) {
      const rules = opts.rules ?? (await this.pairs()).find((p) => p.id === pairId)
      const local = localCheck(levels, side, rules, await this.available())
      const out: SentOrder[] = []
      for (let i = 0; i < levels.length; i++) {
        if (local[i].error) {
          out.push(local[i])
          continue
        }
        const r = await this.priv('POST', `${API}/orders/preview`, [], { product_id: pairId, side: SIDE, order_configuration: this.config(levels[i], !!opts.postOnly) })
        const errs: string[] = r?.errs ?? []
        out.push(errs.length ? { ...local[i], error: explainCoinbase(errs[0]) } : local[i])
        opts.onProgress?.(out.length)
        if (i + 1 < levels.length) await this.pause(120)
      }
      return out
    }
    const out: SentOrder[] = []
    const salt = randomBytes(3).toString('hex')
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i]
      const base = { index: l.index, price: l.price, volume: l.volume }
      const body = { client_order_id: `fehu-${opts.userref}-${l.index}-${salt}`, product_id: pairId, side: SIDE, order_configuration: this.config(l, !!opts.postOnly) }
      let stop = false
      try {
        let r: any
        try {
          r = await this.createOnce(body)
        } catch (e) {
          if ((e as ExchangeError).kind !== 'network') throw e
          // Gleiche client_order_id: Coinbase liefert die schon angelegte Order zurück statt eine zweite anzulegen
          await this.pause(2000)
          r = await this.createOnce(body)
        }
        if (r?.success && r.success_response?.order_id) out.push({ ...base, txid: String(r.success_response.order_id) })
        else {
          const er = r?.error_response ?? {}
          out.push({ ...base, error: explainCoinbase(er.new_order_failure_reason || er.preview_failure_reason || er.error_details || er.message || r?.failure_reason || '') })
        }
      } catch (e) {
        const err = e as ExchangeError
        out.push(err.kind === 'network' ? { ...base, uncertain: true, error: uncertainText(err.message) } : { ...base, error: err.message })
        stop = err.kind !== 'api' || err.codes.includes('401') || err.codes.includes('403')
      }
      opts.onProgress?.(out.length)
      if (stop) {
        levels.slice(i + 1).forEach((x) => out.push({ index: x.index, price: x.price, volume: x.volume, error: skippedText() }))
        opts.onProgress?.(out.length)
        return out
      }
      if (i + 1 < levels.length) await this.pause(120)
    }
    return out
  }

  async closedOrdersSince(start: number, maxPages = 10, _pairIds: string[] = []): Promise<ClosedOrder[]> {
    const rows = await this.listOrders(Object.keys(STATUS), [['start_date', new Date(Math.floor(start) * 1000).toISOString()]], maxPages)
    return rows.map((o) => {
      const cfg = limitCfg(o)
      const filled = Number(o.filled_size ?? 0)
      return {
        txid: String(o.order_id), status: STATUS[o.status] ?? 'canceled', side: String(o.side).toLowerCase() as Side,
        volume: Number(cfg.base_size ?? filled), filled, cost: Number(o.filled_value ?? 0), fee: Number(o.total_fees ?? 0),
        price: Number(o.average_filled_price) || Number(cfg.limit_price ?? 0), limitPrice: Number(cfg.limit_price ?? 0), userref: refFromClientId(o.client_order_id),
      }
    })
  }

  /** Storniert in Paketen zu 100. Liefert die Zahl der angenommenen Stornos und den ersten Fehler. */
  private async cancelIds(ids: string[]): Promise<{ ok: number; error?: string }> {
    let ok = 0
    let error: string | undefined
    for (let i = 0; i < ids.length; i += 100) {
      const r = await this.priv('POST', `${API}/orders/batch_cancel`, [], { order_ids: ids.slice(i, i + 100) })
      for (const x of r?.results ?? []) {
        if (x.success) ok++
        else error ??= explainCoinbase(x.failure_reason)
      }
    }
    return { ok, error }
  }

  async cancelPlan(userref: number): Promise<number> {
    const ids = (await this.openOrders()).filter((o) => o.userref === userref).map((o) => o.txid)
    return ids.length ? (await this.cancelIds(ids)).ok : 0
  }

  async cancelOrder(txid: string): Promise<void> {
    const r = await this.cancelIds([txid])
    if (!r.ok) throw new ExchangeError(r.error ?? explainCoinbase('UNKNOWN_CANCEL_ORDER'))
  }

  async cancelAll(): Promise<number> {
    const ids = (await this.openOrders()).map((o) => o.txid)
    return ids.length ? (await this.cancelIds(ids)).ok : 0
  }

  async ohlc(pairId: string, interval: number): Promise<[number, number][]> {
    const end = Math.floor(Date.now() / 1000)
    const start = end - 300 * interval * 60
    const r = await this.request('GET', `${API}/market/products/${encodeURIComponent(pairId)}/candles`, [['start', start], ['end', end], ['granularity', GRANULARITY[interval] ?? 'ONE_HOUR'], ['limit', 300]])
    return (r?.candles ?? []).map((c: any) => [Number(c.start), Number(c.close)] as [number, number]).sort((a: [number, number], b: [number, number]) => a[0] - b[0])
  }

  async fees(_pairId: string): Promise<{ maker: number; taker: number }> {
    const r = await this.priv('GET', `${API}/transaction_summary`, [['product_type', 'SPOT']])
    const taker = Number(r?.fee_tier?.taker_fee_rate ?? 0.012) * 100
    const maker = Number(r?.fee_tier?.maker_fee_rate ?? r?.fee_tier?.taker_fee_rate ?? 0.006) * 100
    return { maker, taker }
  }

  /** Coinbase verrät die Rechte direkt: Ansehen, Handeln und ob der Schlüssel Geld bewegen darf (Transfer) */
  async checkPermissions(_opts?: { noWithdrawConfirmed?: boolean }): Promise<KeyCheck[]> {
    const r = await this.priv('GET', `${API}/key_permissions`)
    const transfer = !!r?.can_transfer
    return [
      { id: 'view', label: tr('Ansehen (Guthaben und Orders)', 'View (balances and orders)'), exchangeLabel: 'View', required: true, ok: !!r?.can_view },
      { id: 'trade', label: tr('Handeln (Orders anlegen und stornieren)', 'Trade (place and cancel orders)'), exchangeLabel: 'Trade', required: true, ok: !!r?.can_trade },
      {
        id: 'withdraw', label: tr('Keine Auszahlungen', 'No withdrawals'), exchangeLabel: 'Transfer', required: true, ok: !transfer,
        ...(transfer ? { detail: tr('Dieser Schlüssel darf Geld bewegen. Lege bitte einen neuen Schlüssel ohne „Transfer“ an.', 'This key can move money. Please create a new key without “Transfer”.') } : {}),
      },
    ]
  }
}
