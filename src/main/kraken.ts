// Kraken-Anbindung (Spot, REST). Läuft nur im Hauptprozess, der Schlüssel
// verlässt ihn nie. Doku: https://docs.kraken.com/api/
import { createHash, createHmac } from 'node:crypto'
import type { LadderLevel, PairRules, Side } from '../shared/ladder'

export const KRAKEN_URL = 'https://api.kraken.com'
/** Kraken nimmt 2 bis 15 Orders pro Batch */
export const BATCH_MAX = 15

export interface Credentials {
  key: string
  secret: string
}

export interface PairInfo extends PairRules {
  /** Interner Name, z. B. XXBTZEUR */
  id: string
  /** Anzeigename, z. B. BTC/EUR */
  name: string
  base: string
  quote: string
}

export interface SentOrder {
  index: number
  price: number
  volume: number
  txid?: string
  error?: string
}

export interface ClosedOrder {
  txid: string
  status: string
  side: Side
  volume: number
  filled: number
  cost: number
  fee: number
  /** Durchschnittlicher Ausführungspreis */
  price: number
  userref: number
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ json(): Promise<any> }>

export class KrakenError extends Error {}

/** Signatur nach Kraken-Vorgabe: HMAC-SHA512(Pfad + SHA256(Nonce + Daten)) mit dem Base64-dekodierten Geheimnis */
export function sign(path: string, nonce: string, body: string, secret: string): string {
  const hash = createHash('sha256').update(nonce + body).digest()
  return createHmac('sha512', Buffer.from(secret, 'base64'))
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest('base64')
}

/** Übersetzt Krakens Fehlercodes in verständliche Sätze */
export function explainError(code: string): string {
  if (code.includes('Invalid key')) return 'Der API-Schlüssel ist ungültig.'
  if (code.includes('Invalid signature')) return 'Das API-Geheimnis passt nicht zum Schlüssel.'
  if (code.includes('Permission denied')) return 'Dem API-Schlüssel fehlt eine Berechtigung (Abfragen, Orders erstellen, Orders stornieren).'
  if (code.includes('Insufficient funds')) return 'Nicht genug Guthaben.'
  if (code.includes('Invalid nonce')) return 'Zeitstempel abgelehnt. Bitte noch einmal versuchen.'
  if (code.includes('Rate limit') || code.includes('Too many requests')) return 'Zu viele Anfragen. Kraken bremst kurz, bitte gleich noch einmal versuchen.'
  if (code.includes('Orders limit exceeded')) return 'Zu viele offene Orders für dein Konto (Grenze hängt von der Verifizierungsstufe ab).'
  if (code.includes('Order minimum not met')) return 'Eine Order ist kleiner als die Mindestmenge.'
  if (code.includes('Unknown asset pair')) return 'Dieses Handelspaar kennt Kraken nicht.'
  if (code.includes('Market in cancel_only') || code.includes('Market in post_only')) return 'Der Markt ist gerade eingeschränkt.'
  return code
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Kraken {
  private lastNonce = 0

  constructor(
    private creds: Credentials | null,
    private http: FetchLike = fetch as unknown as FetchLike,
    private pause: (ms: number) => Promise<unknown> = sleep,
  ) {}

  private nonce(): string {
    // streng steigend, auch bei mehreren Anfragen in derselben Millisekunde
    const n = Math.max(Date.now() * 1000, this.lastNonce + 1)
    this.lastNonce = n
    return String(n)
  }

  private unwrap(data: any): any {
    if (data?.error?.length) throw new KrakenError(data.error.map(explainError).join(' '))
    return data.result
  }

  async publicGet(endpoint: string, params: Record<string, string> = {}): Promise<any> {
    const qs = new URLSearchParams(params).toString()
    const res = await this.http(`${KRAKEN_URL}/0/public/${endpoint}${qs ? `?${qs}` : ''}`)
    return this.unwrap(await res.json())
  }

  async privatePost(endpoint: string, params: Record<string, unknown> = {}, json = false): Promise<any> {
    if (!this.creds) throw new KrakenError('Kein API-Schlüssel hinterlegt.')
    const path = `/0/private/${endpoint}`
    const nonce = this.nonce()
    const body = json
      ? JSON.stringify({ nonce: Number(nonce), ...params })
      : new URLSearchParams({ nonce, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) }).toString()
    const res = await this.http(KRAKEN_URL + path, {
      method: 'POST',
      headers: {
        'API-Key': this.creds.key,
        'API-Sign': sign(path, nonce, body, this.creds.secret),
        'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body,
    })
    return this.unwrap(await res.json())
  }

  /** Alle EUR-Paare mit ihren Regeln (Nachkommastellen, Mindestmengen) */
  async pairs(quote = 'EUR'): Promise<PairInfo[]> {
    const result = await this.publicGet('AssetPairs')
    return Object.entries<any>(result)
      .filter(([, p]) => p.status === 'online' && p.wsname?.endsWith(`/${quote}`))
      .map(([id, p]) => ({
        id,
        name: p.wsname.replace('XBT', 'BTC').replace('XDG', 'DOGE'),
        base: p.base,
        quote: p.quote,
        priceDecimals: p.pair_decimals,
        volumeDecimals: p.lot_decimals,
        orderMin: Number(p.ordermin),
        costMin: Number(p.costmin ?? 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async lastPrice(pairId: string): Promise<number> {
    const result = await this.publicGet('Ticker', { pair: pairId })
    const first = Object.values<any>(result)[0]
    return Number(first.c[0])
  }

  async balances(): Promise<Record<string, number>> {
    const result = await this.privatePost('Balance')
    return Object.fromEntries(Object.entries<string>(result).map(([k, v]) => [k, Number(v)]).filter(([, v]) => (v as number) > 0))
  }

  async openOrders(userref?: number): Promise<{ txid: string; pair: string; side: Side; price: number; volume: number; filled: number; cost: number; fee: number; userref: number }[]> {
    const result = await this.privatePost('OpenOrders', userref !== undefined ? { userref } : {})
    return Object.entries<any>(result.open ?? {}).map(([txid, o]) => ({
      txid,
      pair: o.descr.pair,
      side: o.descr.type,
      price: Number(o.descr.price),
      volume: Number(o.vol),
      filled: Number(o.vol_exec),
      cost: Number(o.cost ?? 0),
      fee: Number(o.fee ?? 0),
      userref: o.userref ?? 0,
    }))
  }

  /**
   * Sendet die Stufen in Paketen zu höchstens 15 Orders. Mit validate=true prüft
   * Kraken alles, legt aber nichts an (Probelauf). userref markiert alle Orders
   * eines Plans, damit sie gemeinsam storniert werden können.
   */
  async placeLadder(pairId: string, side: Side, levels: LadderLevel[], opts: { validate: boolean; userref: number; postOnly?: boolean; onProgress?: (done: number) => void }): Promise<SentOrder[]> {
    const out: SentOrder[] = []
    const fmt = (n: number, d: number) => n.toFixed(d)
    const decimals = (n: number) => (String(n).split('.')[1] ?? '').length
    for (let i = 0; i < levels.length; i += BATCH_MAX) {
      const chunk = levels.slice(i, i + BATCH_MAX)
      const orders = chunk.map((l) => ({
        ordertype: 'limit',
        type: side,
        price: fmt(l.price, decimals(l.price)),
        volume: fmt(l.volume, Math.max(decimals(l.volume), 1)),
        userref: opts.userref,
        ...(opts.postOnly ? { oflags: 'post' } : {}),
      }))
      try {
        if (orders.length === 1) {
          // Batch braucht mindestens 2 Orders, eine einzelne geht über AddOrder
          const r = await this.privatePost('AddOrder', { pair: pairId, ...orders[0], ...(opts.validate ? { validate: true } : {}) })
          out.push({ index: chunk[0].index, price: chunk[0].price, volume: chunk[0].volume, txid: r.txid?.[0] })
        } else {
          const r = await this.privatePost('AddOrderBatch', { pair: pairId, orders, validate: opts.validate }, true)
          chunk.forEach((l, j) => {
            const o = r.orders?.[j] ?? {}
            out.push({ index: l.index, price: l.price, volume: l.volume, txid: o.txid, error: o.error ? explainError(o.error) : undefined })
          })
        }
      } catch (e) {
        // Wird ein Paket abgelehnt, gilt das für alle Orders darin. Danach abbrechen,
        // damit nicht ein halber Plan ohne Rückmeldung weiterläuft.
        chunk.forEach((l) => out.push({ index: l.index, price: l.price, volume: l.volume, error: (e as Error).message }))
        levels.slice(i + BATCH_MAX).forEach((l) => out.push({ index: l.index, price: l.price, volume: l.volume, error: 'Nicht gesendet, weil ein vorheriges Paket fehlschlug.' }))
        opts.onProgress?.(out.length)
        return out
      }
      opts.onProgress?.(out.length)
      // Kraken drosselt Order-Anfragen pro Paar, daher kurze Pause zwischen Paketen
      if (i + BATCH_MAX < levels.length) await this.pause(1000)
    }
    return out
  }

  /** Kerzen für den Kurs-Chart: interval in Minuten (60, 240, 1440). Liefert [Zeit in s, Schlusskurs]. */
  async ohlc(pairId: string, interval: number): Promise<[number, number][]> {
    const result = await this.publicGet('OHLC', { pair: pairId, interval: String(interval) })
    const key = Object.keys(result).find((k) => k !== 'last')
    return (key ? result[key] : []).map((c: any[]) => [Number(c[0]), Number(c[4])])
  }

  /** Gebühren in Prozent für dieses Paar (Maker = Limit im Orderbuch, Taker = sofort ausgeführt) */
  async fees(pairId: string): Promise<{ maker: number; taker: number }> {
    const r = await this.privatePost('TradeVolume', { pair: pairId })
    const taker = Number(Object.values<any>(r.fees ?? {})[0]?.fee ?? 0.4)
    const maker = Number(Object.values<any>(r.fees_maker ?? {})[0]?.fee ?? taker)
    return { maker, taker }
  }

  /** Verfügbares Guthaben je Asset (Bestand minus das, was in offenen Orders gebunden ist) */
  async available(): Promise<Record<string, number>> {
    const r = await this.privatePost('BalanceEx')
    return Object.fromEntries(Object.entries<any>(r).map(([k, v]) => [k, Number(v.balance) + Number(v.credit ?? 0) - Number(v.credit_used ?? 0) - Number(v.hold_trade ?? 0)]))
  }

  /** Geschlossene Orders eines Plans (ausgeführt, storniert oder abgelaufen) */
  async closedOrders(userref: number): Promise<ClosedOrder[]> {
    const r = await this.privatePost('ClosedOrders', { userref })
    return Object.entries<any>(r.closed ?? {}).map(([txid, o]) => ({
      txid,
      status: o.status,
      side: o.descr.type,
      volume: Number(o.vol),
      filled: Number(o.vol_exec),
      cost: Number(o.cost),
      fee: Number(o.fee),
      price: Number(o.price) || Number(o.descr.price),
      userref: o.userref ?? 0,
    }))
  }

  /** Storniert alle offenen Orders eines Plans (Kraken akzeptiert userref statt txid) */
  async cancelPlan(userref: number): Promise<number> {
    const r = await this.privatePost('CancelOrder', { txid: userref })
    return Number(r.count ?? 0)
  }

  async cancelOrder(txid: string): Promise<void> {
    await this.privatePost('CancelOrder', { txid })
  }
}
