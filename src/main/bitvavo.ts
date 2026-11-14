// Bitvavo-Anbindung (Spot, REST v2). Läuft nur im Hauptprozess, der Schlüssel verlässt ihn nie.
// Doku: https://docs.bitvavo.com/docs/rest-overview
// Besonderheiten gegenüber Kraken: kein Probelauf bei der Börse (die App prüft selbst), keine Paket-Orders,
// jede Order braucht eine operatorId, und die Plan-Nummer steckt in der eigenen Order-Kennung (clientOrderId).
import { createHmac } from 'node:crypto'
import type { LadderLevel, Side } from '../shared/ladder'
import type { KeyCheck } from '../shared/ipc'
import { tr } from '../shared/i18n'
import {
  ExchangeError, priceOut, volumeOut, decimalsOf, localCheck, networkError, noKey, notPlacedText, refFromClientId, refUuid, skippedText, sleep, uncertainText, unreadable,
  type ClosedOrder, type Credentials, type Exchange, type FetchLike, type OpenOrder, type PairInfo, type PlaceOptions, type SentOrder,
} from './exchange'

export const BITVAVO_URL = 'https://api.bitvavo.com/v2'
const TIMEOUT_MS = 15_000
const ORDER_TIMEOUT_MS = 30_000
/** Bitvavo verlangt bei Orders und Stornos eine Kennung für „wer hat das ausgelöst“. Für diese App immer dieselbe. */
export const OPERATOR_ID = 7001
/** Absichtlich ungültige Order-Kennung für die Rechte-Prüfung */
const CHECK_ORDER_ID = '00000000-0000-4000-8000-000000000000'

/** Signatur nach Bitvavo-Vorgabe: HMAC-SHA256 (hex) über Zeitstempel + Methode + /v2-Pfad mit Abfrage + Inhalt */
export function signBitvavo(timestamp: string, method: string, pathWithQuery: string, body: string, secret: string): string {
  return createHmac('sha256', secret).update(timestamp + method + '/v2' + pathWithQuery + body).digest('hex')
}

/** Übersetzt Bitvavos Fehlernummern in verständliche Sätze */
export function explainBitvavo(code: number, message = ''): string {
  switch (code) {
    case 105: return tr('Zu viele Anfragen. Bitvavo bremst kurz, bitte in einer Minute noch einmal versuchen.', 'Too many requests. Bitvavo is slowing things down, please try again in a minute.')
    case 107: case 108: case 109: return tr('Bitvavo ist gerade überlastet oder in Wartung. Bitte später noch einmal versuchen.', 'Bitvavo is overloaded or under maintenance right now. Please try again later.')
    case 216: return tr('Nicht genug Guthaben.', 'Insufficient funds.')
    case 217: return tr('Eine Order liegt unter dem Mindestbetrag.', 'An order is below the minimum cost.')
    case 219: return tr('Der Markt ist gerade eingeschränkt.', 'The market is currently restricted.')
    case 220: return tr('Diese Order-Kennung gibt es schon. Bitte noch einmal senden.', 'This order ID already exists. Please send again.')
    case 240: return tr('Diese Order gibt es bei Bitvavo nicht (mehr).', 'This order does not exist (any more) at Bitvavo.')
    case 301: case 305: return tr('Der API-Schlüssel ist ungültig oder nicht aktiv. Prüfe, ob du ihn vollständig kopiert hast.', 'The API key is invalid or not active. Check that you copied it completely.')
    case 306: return tr('Der API-Schlüssel ist noch nicht bestätigt. Klicke auf den Link in der E-Mail von Bitvavo.', 'The API key has not been confirmed yet. Click the link in the e-mail from Bitvavo.')
    case 302: case 303: case 304: return tr('Bitvavo hat den Zeitstempel abgelehnt. Geht die Uhr deines Macs richtig?', 'Bitvavo rejected the timestamp. Is your Mac’s clock correct?')
    case 307: return tr('Dieser Schlüssel ist bei Bitvavo auf eine andere IP-Adresse beschränkt. Vielleicht hat sich deine IP-Adresse geändert.', 'This key is restricted to another IP address at Bitvavo. Your IP address may have changed.')
    case 308: case 309: return tr('Der geheime Schlüssel passt nicht zum API-Schlüssel. Prüfe, ob beide vollständig und nicht vertauscht sind.', 'The secret does not match the API key. Check that both are complete and not swapped.')
    case 310: return tr('Dem API-Schlüssel fehlt das Recht zu handeln (Trade).', 'The API key is missing the trade permission.')
    case 311: return tr('Dem API-Schlüssel fehlt das Recht, das Konto anzusehen (View).', 'The API key is missing the view permission.')
    case 312: return tr('Dem API-Schlüssel fehlt das Recht auszuzahlen (gut so).', 'The API key cannot withdraw (that is good).')
    default:
      if (code >= 200 && code < 300) return tr(`Bitvavo lehnt eine Angabe ab (${message || code}).`, `Bitvavo rejects a value (${message || code}).`)
      return `Bitvavo: ${message || tr('unbekannter Fehler', 'unknown error')} (${code})`
  }
}

const FATAL = new Set([301, 302, 303, 304, 305, 306, 307, 308, 309])

/** Interne Order-Kennung der App: Markt und Bitvavo-Kennung, weil Bitvavo zum Stornieren beides braucht */
const txidOf = (market: string, orderId: string) => `${market}|${orderId}`
const splitTxid = (txid: string) => {
  const [market, orderId] = String(txid).split('|')
  if (!market || !orderId) throw new ExchangeError(tr('Unbekannte Order-Kennung.', 'Unknown order ID.'))
  return { market, orderId }
}

const CLOSED: Record<string, string> = { filled: 'closed', canceled: 'canceled', expired: 'expired', rejected: 'canceled' }
const INTERVALS: Record<number, string> = { 60: '1h', 240: '4h', 1440: '1d' }

export class Bitvavo implements Exchange {
  readonly id = 'bitvavo' as const
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private creds: Credentials | null,
    private http: FetchLike = fetch as unknown as FetchLike,
    private pause: (ms: number) => Promise<unknown> = sleep,
    private now: () => number = Date.now,
  ) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async request(method: string, path: string, query: Record<string, string | number> = {}, body?: unknown, auth = false, timeoutMs = TIMEOUT_MS): Promise<any> {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
    const pathQ = path + (qs ? `?${qs}` : '')
    const text = body === undefined ? '' : JSON.stringify(body)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth) {
      const creds = this.creds
      if (!creds) throw noKey()
      const ts = String(this.now())
      headers['Bitvavo-Access-Key'] = creds.key
      headers['Bitvavo-Access-Timestamp'] = ts
      headers['Bitvavo-Access-Signature'] = signBitvavo(ts, method, pathQ, text, creds.secret)
      headers['Bitvavo-Access-Window'] = '10000'
    }
    let res: Awaited<ReturnType<FetchLike>>
    let raw: string
    try {
      res = await this.http(BITVAVO_URL + pathQ, { method, headers, ...(text ? { body: text } : {}), signal: AbortSignal.timeout(timeoutMs) })
      raw = await res.text()
    } catch (e) {
      throw networkError('Bitvavo', e, timeoutMs)
    }
    let data: any
    try {
      data = JSON.parse(raw)
    } catch {
      throw unreadable('Bitvavo', res.status ?? 0)
    }
    if (data && typeof data === 'object' && !Array.isArray(data) && data.errorCode !== undefined) {
      const code = Number(data.errorCode)
      throw new ExchangeError(explainBitvavo(code, String(data.error ?? '')), code === 105 || res.status === 429 ? 'rate' : 'api', [String(code)])
    }
    if ((res.status ?? 200) >= 500) throw unreadable('Bitvavo', res.status ?? 0)
    return data
  }

  private priv(method: string, path: string, query: Record<string, string | number> = {}, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<any> {
    return this.serial(() => this.request(method, path, query, body, true, timeoutMs))
  }

  async pairs(quote = 'EUR'): Promise<PairInfo[]> {
    const markets: any[] = await this.request('GET', '/markets')
    return markets
      .filter((m) => m.quote === quote && m.status === 'trading' && (!Array.isArray(m.orderTypes) || m.orderTypes.includes('limit')))
      .map((m) => {
        const tick = Number(m.tickSize)
        return {
          id: String(m.market),
          name: `${m.base}/${m.quote}`,
          base: String(m.base),
          quote: String(m.quote),
          priceDecimals: tick > 0 ? decimalsOf(m.tickSize) : 2,
          volumeDecimals: Number.isFinite(Number(m.quantityDecimals)) ? Number(m.quantityDecimals) : 8,
          orderMin: Number(m.minOrderInBaseAsset ?? 0),
          costMin: Number(m.minOrderInQuoteAsset ?? 0),
          ...(tick > 0 ? { tickSize: tick } : {}),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Bitvavo hat keinen eigenen Wartungs-Status. Antwortet der Server, gilt „online“. */
  async systemStatus(): Promise<string> {
    await this.request('GET', '/time')
    return 'online'
  }

  async lastPrice(pairId: string): Promise<number> {
    const r = await this.request('GET', '/ticker/price', { market: pairId })
    const p = Number(r?.price)
    if (!(p > 0)) throw new ExchangeError(tr('Bitvavo hat keinen Kurs geliefert.', 'Bitvavo returned no price.'))
    return p
  }

  async lastPrices(pairIds: string[]): Promise<Record<string, number>> {
    if (!pairIds.length) return {}
    const all: any[] = await this.request('GET', '/ticker/price')
    const want = new Set(pairIds)
    const out: Record<string, number> = {}
    for (const t of all) if (want.has(t.market) && Number(t.price) > 0) out[t.market] = Number(t.price)
    return out
  }

  async balances(): Promise<Record<string, number>> {
    const r: any[] = await this.priv('GET', '/balance')
    return Object.fromEntries(r.map((b) => [b.symbol, Number(b.available) + Number(b.inOrder ?? 0)]).filter(([, v]) => (v as number) > 0))
  }

  async available(): Promise<Record<string, number>> {
    const r: any[] = await this.priv('GET', '/balance')
    return Object.fromEntries(r.map((b) => [b.symbol, Number(b.available)]))
  }

  async openOrders(): Promise<OpenOrder[]> {
    const r: any[] = await this.priv('GET', '/ordersOpen')
    return r.map((o) => ({
      txid: txidOf(o.market, o.orderId),
      pair: String(o.market),
      side: o.side,
      price: Number(o.price),
      volume: Number(o.amount),
      filled: Number(o.filledAmount ?? 0),
      cost: Number(o.filledAmountQuote ?? 0),
      fee: Number(o.feePaid ?? 0),
      userref: refFromClientId(o.clientOrderId),
    }))
  }

  /**
   * Legt die Stufen einzeln an (Bitvavo kennt keine Paket-Orders). Probelauf: Bitvavo hat keinen,
   * deshalb prüft die App selbst Mindestmengen, Preisschritte und ob das freie Guthaben reicht.
   */
  async placeLadder(pairId: string, side: Side, levels: LadderLevel[], opts: PlaceOptions): Promise<SentOrder[]> {
    if (opts.validate) {
      const rules = opts.rules ?? (await this.pairs()).find((p) => p.id === pairId)
      const free = await this.available()
      const out = localCheck(levels, side, rules, free)
      opts.onProgress?.(out.length)
      return out
    }
    const out: SentOrder[] = []
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i]
      const base = { index: l.index, price: l.price, volume: l.volume }
      const clientOrderId = refUuid(opts.userref, l.index)
      try {
        const r = await this.priv('POST', '/order', {}, {
          market: pairId, side, orderType: 'limit', amount: volumeOut(l.volume, opts.rules), price: priceOut(l.price, opts.rules),
          postOnly: !!opts.postOnly, clientOrderId, operatorId: OPERATOR_ID,
        }, ORDER_TIMEOUT_MS)
        if (r?.status === 'canceled' && r?.restatementReason === 'cancelPostOnly') {
          out.push({ ...base, error: tr('Post-only: Bitvavo hat die Order sofort storniert, weil sie direkt ausgeführt worden wäre.', 'Post-only: Bitvavo cancelled the order at once because it would have filled immediately.') })
        } else out.push({ ...base, txid: txidOf(pairId, r.orderId) })
      } catch (e) {
        const err = e as ExchangeError
        if (err.kind === 'network') {
          // Antwort verloren: nachsehen, ob Bitvavo die Order mit unserer Kennung kennt
          const found = await this.findByClientId(pairId, clientOrderId)
          if (found === undefined) out.push({ ...base, uncertain: true, error: uncertainText(err.message) })
          else if (found) out.push({ ...base, txid: found })
          else out.push({ ...base, error: notPlacedText(err.message) })
        } else out.push({ ...base, error: err.message })
        // Bei Netzfehler, Bremse oder ungültigem Schlüssel nicht weitermachen, sonst ein halber Plan ohne Rückmeldung
        if (err.kind !== 'api' || err.codes.some((c) => FATAL.has(Number(c)) || c === '310')) {
          levels.slice(i + 1).forEach((x) => out.push({ index: x.index, price: x.price, volume: x.volume, error: skippedText() }))
          opts.onProgress?.(out.length)
          return out
        }
      }
      opts.onProgress?.(out.length)
    }
    return out
  }

  /** txid, wenn Bitvavo die Order kennt; null, wenn sicher nicht; undefined, wenn unklar */
  private async findByClientId(market: string, clientOrderId: string): Promise<string | null | undefined> {
    try {
      await this.pause(3000)
      const o = await this.priv('GET', '/order', { market, clientOrderId })
      return o?.orderId ? txidOf(market, o.orderId) : undefined
    } catch (e) {
      return (e as ExchangeError).codes?.includes('240') ? null : undefined
    }
  }

  /** Bitvavo liefert geschlossene Orders nur je Markt, deshalb eine Abfrage pro Paar der Pläne */
  async closedOrdersSince(start: number, maxPages = 10, pairIds: string[] = []): Promise<ClosedOrder[]> {
    const found = new Map<string, ClosedOrder>()
    for (const market of [...new Set(pairIds)]) {
      let end: number | undefined
      for (let page = 0; page < maxPages; page++) {
        const r: any[] = await this.priv('GET', '/orders', { market, start: Math.floor(start * 1000), limit: 1000, ...(end ? { end } : {}) })
        for (const o of r) {
          const status = CLOSED[o.status]
          if (!status) continue
          const filled = Number(o.filledAmount ?? 0)
          const cost = Number(o.filledAmountQuote ?? 0)
          found.set(txidOf(market, o.orderId), {
            txid: txidOf(market, o.orderId), status, side: o.side, volume: Number(o.amount), filled, cost,
            fee: Number(o.feePaid ?? 0), price: filled > 0 ? cost / filled : Number(o.price), limitPrice: Number(o.price), userref: refFromClientId(o.clientOrderId),
          })
        }
        if (r.length < 1000) break
        // Neueste zuerst: die nächste Seite endet bei der ältesten Order dieser Seite
        end = Math.min(...r.map((o) => Number(o.created)))
      }
    }
    return [...found.values()]
  }

  async cancelPlan(userref: number): Promise<number> {
    const mine = (await this.openOrders()).filter((o) => o.userref === userref)
    let n = 0
    for (const o of mine) {
      await this.cancelOrder(o.txid)
      n++
    }
    return n
  }

  async cancelOrder(txid: string): Promise<void> {
    const { market, orderId } = splitTxid(txid)
    await this.priv('DELETE', '/order', { market, orderId, operatorId: OPERATOR_ID })
  }

  async cancelAll(): Promise<number> {
    const r = await this.priv('DELETE', '/orders', { operatorId: OPERATOR_ID })
    return Array.isArray(r) ? r.length : 0
  }

  async ohlc(pairId: string, interval: number): Promise<[number, number][]> {
    const r: any[] = await this.request('GET', `/${encodeURIComponent(pairId)}/candles`, { interval: INTERVALS[interval] ?? '1h', limit: 300 })
    return r.map((c) => [Math.floor(Number(c[0]) / 1000), Number(c[4])] as [number, number]).sort((a, b) => a[0] - b[0])
  }

  async fees(_pairId: string): Promise<{ maker: number; taker: number }> {
    const r = await this.priv('GET', '/account')
    const taker = Number(r?.fees?.taker ?? 0.0025) * 100
    const maker = Number(r?.fees?.maker ?? r?.fees?.taker ?? 0.0015) * 100
    return { maker, taker }
  }

  /**
   * Prüft die Rechte, ohne etwas anzulegen: Ansehen über das Guthaben, Handeln über das Stornieren einer
   * absichtlich nicht vorhandenen Order. Ob der Schlüssel auszahlen darf, verrät Bitvavo nicht,
   * das bestätigt der Nutzer selbst.
   */
  async checkPermissions(opts: { noWithdrawConfirmed?: boolean } = {}): Promise<KeyCheck[]> {
    const fatal = (e: unknown) => {
      const k = e as ExchangeError
      return k.kind !== 'api' || !!k.codes?.some((c) => FATAL.has(Number(c)))
    }
    const checks: KeyCheck[] = []
    try {
      await this.priv('GET', '/balance')
      checks.push({ id: 'view', label: tr('Ansehen (Guthaben und Orders)', 'View (balances and orders)'), exchangeLabel: 'View', required: true, ok: true })
    } catch (e) {
      if (fatal(e)) throw e
      checks.push({ id: 'view', label: tr('Ansehen (Guthaben und Orders)', 'View (balances and orders)'), exchangeLabel: 'View', required: true, ok: false, detail: (e as Error).message })
    }
    try {
      await this.priv('DELETE', '/order', { market: 'BTC-EUR', orderId: CHECK_ORDER_ID, operatorId: OPERATOR_ID })
      checks.push({ id: 'trade', label: tr('Handeln (Orders anlegen und stornieren)', 'Trade (place and cancel orders)'), exchangeLabel: 'Trade', required: true, ok: true })
    } catch (e) {
      if (fatal(e)) throw e
      const denied = (e as ExchangeError).codes?.includes('310')
      // „Order nicht gefunden“ heißt: das Recht ist da, nur die Test-Order gab es absichtlich nicht
      checks.push({ id: 'trade', label: tr('Handeln (Orders anlegen und stornieren)', 'Trade (place and cancel orders)'), exchangeLabel: 'Trade', required: true, ok: !denied })
    }
    const ok = !!opts.noWithdrawConfirmed
    checks.push({
      id: 'withdraw', label: tr('Keine Auszahlungen', 'No withdrawals'), exchangeLabel: 'Withdraw', required: true, ok,
      detail: ok
        ? tr('Von dir bestätigt. Bitvavo lässt das nicht automatisch prüfen, kontrolliere es ab und zu in den API-Einstellungen.', 'Confirmed by you. Bitvavo does not let apps check this, so look at your API settings now and then.')
        : tr('Bitte bestätige unten, dass „Withdraw“ bei diesem Schlüssel aus ist.', 'Please confirm below that “Withdraw” is off for this key.'),
    })
    return checks
  }
}
