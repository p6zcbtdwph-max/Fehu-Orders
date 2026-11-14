// Kraken-Anbindung (Spot, REST). Läuft nur im Hauptprozess, der Schlüssel
// verlässt ihn nie. Doku: https://docs.kraken.com/api/
import { tr } from '../shared/i18n'
import { createHash, createHmac } from 'node:crypto'
import type { LadderLevel, Side } from '../shared/ladder'
import type { KeyCheck } from '../shared/ipc'
import { ExchangeError, plain, same, sleep, type ClosedOrder, type Credentials, type Exchange, type FetchLike, type HttpInit, type OpenOrder, type PairInfo, type PlaceOptions, type SentOrder } from './exchange'

export const KRAKEN_URL = 'https://api.kraken.com'
/** Kraken nimmt 2 bis 15 Orders pro Batch */
export const BATCH_MAX = 15
/** Zeitlimit für Abfragen */
export const TIMEOUT_MS = 15_000
/** Zeitlimit beim Anlegen von Orders. Gleichzeitig die Frist (deadline), nach der Kraken die Orders nicht mehr anlegt. */
export const ORDER_TIMEOUT_MS = 30_000

/** Abfragen, die nichts verändern. Nur diese werden nach einer Bremse von Kraken automatisch wiederholt. */
const READ_ONLY = new Set(['Balance', 'BalanceEx', 'OpenOrders', 'ClosedOrders', 'TradeVolume', 'QueryOrders'])

export type { Credentials, PairInfo, SentOrder, ClosedOrder, OpenOrder } from './exchange'
/** Fehler von Kraken, siehe ExchangeError */
export class KrakenError extends ExchangeError {}

/** Signatur nach Kraken-Vorgabe: HMAC-SHA512(Pfad + SHA256(Nonce + Daten)) mit dem Base64-dekodierten Geheimnis */
export function sign(path: string, nonce: string, body: string, secret: string): string {
  const hash = createHash('sha256').update(nonce + body).digest()
  return createHmac('sha512', Buffer.from(secret, 'base64'))
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest('base64')
}

/** Übersetzt Krakens Fehlercodes in verständliche Sätze */
export function explainError(code: string): string {
  if (code.includes('Invalid key')) return tr('Der API-Schlüssel ist ungültig. Prüfe, ob du ihn vollständig kopiert hast.', 'The API key is invalid. Check that you copied it completely.')
  if (code.includes('Invalid signature')) return tr('Der private Schlüssel passt nicht zum API-Schlüssel. Prüfe, ob beide vollständig und nicht vertauscht sind.', 'The private key does not match the API key. Check that both are complete and not swapped.')
  if (code.includes('Permission denied')) return tr('Dem API-Schlüssel fehlt eine Berechtigung. Unter „Schlüssel“ siehst du, welche Häkchen nötig sind. Hast du bei Kraken eine IP-Beschränkung eingerichtet, hat sich vielleicht deine IP-Adresse geändert.', 'The API key is missing a permission. Under “Key” you can see which boxes need to be ticked. If you set up an IP restriction at Kraken, your IP address may have changed.')
  if (code.includes('Insufficient funds')) return tr('Nicht genug Guthaben.', 'Insufficient funds.')
  if (code.includes('Invalid nonce')) return tr('Zeitstempel abgelehnt. Bitte noch einmal versuchen.', 'Timestamp (nonce) rejected. Please try again.')
  if (code.includes('Temporary lockout')) return tr('Kraken hat den Schlüssel nach zu vielen Fehlversuchen kurz gesperrt. Bitte etwa 15 Minuten warten.', 'Kraken temporarily locked the key after too many failed attempts. Please wait about 15 minutes.')
  if (code.includes('Rate limit') || code.includes('Too many requests')) return tr('Zu viele Anfragen. Kraken bremst kurz, bitte in einer Minute noch einmal versuchen.', 'Too many requests. Kraken is slowing things down, please try again in a minute.')
  if (code.includes('Orders limit exceeded')) return tr('Zu viele offene Orders für dein Konto (die Grenze hängt von der Verifizierungsstufe ab).', 'Too many open orders for your account (the limit depends on your verification level).')
  if (code.includes('Order minimum not met')) return tr('Eine Order ist kleiner als die Mindestmenge.', 'An order is below the minimum volume.')
  if (code.includes('Cost minimum not met')) return tr('Eine Order liegt unter dem Mindestbetrag.', 'An order is below the minimum cost.')
  if (code.includes('Tick size')) return tr('Ein Preis passt nicht zu den erlaubten Preisschritten dieses Paars.', 'A price does not match the allowed price steps (tick size) of this pair.')
  if (code.includes('Unknown asset pair')) return tr('Dieses Handelspaar kennt Kraken nicht.', 'Kraken does not know this trading pair.')
  if (code.includes('Unknown order')) return tr('Diese Order gibt es bei Kraken nicht (mehr).', 'This order does not exist (any more) at Kraken.')
  if (code.includes('Market in cancel_only') || code.includes('Market in post_only') || code.includes('Market in limit_only')) return tr('Der Markt ist gerade eingeschränkt.', 'The market is currently restricted.')
  if (code.includes('Unavailable') || code.includes('Busy') || code.includes('Internal error')) return tr('Kraken ist gerade überlastet oder in Wartung. Bitte später noch einmal versuchen.', 'Kraken is overloaded or under maintenance right now. Please try again later.')
  if (code.includes('Deadline')) return tr('Kraken hat die Orders nicht rechtzeitig angenommen. Geht die Uhr deines Macs richtig?', 'Kraken did not accept the orders in time. Is your Mac’s clock correct?')
  if (code.includes('Invalid arguments')) return tr(`Kraken lehnt eine Angabe ab (${code.split(':').slice(2).join(':') || 'unbekannt'}).`, `Kraken rejects a value (${code.split(':').slice(2).join(':') || 'unknown'}).`)
  return code
}

const isRateCode = (c: string) => c.includes('Rate limit') || c.includes('Too many requests')
const isBusyCode = (c: string) => c.includes('EService:Unavailable') || c.includes('EService:Busy')

export { plain }


export class Kraken implements Exchange {
  readonly id = 'kraken' as const
  private lastNonce = 0
  /** Private Anfragen laufen nacheinander, damit die Zeitstempel in der richtigen Reihenfolge ankommen */
  private queue: Promise<unknown> = Promise.resolve()

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

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Eine Anfrage mit Zeitlimit. Wandelt Netz- und Wartungsfehler in verständliche Meldungen um. */
  private async request(url: string, init: HttpInit, timeoutMs: number): Promise<any> {
    let res: Awaited<ReturnType<FetchLike>>
    let text: string
    try {
      res = await this.http(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      text = await res.text()
    } catch (e) {
      const name = (e as Error)?.name
      if (name === 'TimeoutError' || name === 'AbortError') throw new KrakenError(tr(`Kraken hat nicht innerhalb von ${Math.round(timeoutMs / 1000)} Sekunden geantwortet.`, `Kraken did not answer within ${Math.round(timeoutMs / 1000)} seconds.`), 'network')
      throw new KrakenError(tr('Keine Verbindung zu Kraken. Prüfe deine Internetverbindung.', 'No connection to Kraken. Check your internet connection.'), 'network')
    }
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      const status = res.status ?? 0
      throw new KrakenError(
        status >= 500 || status === 0
          ? tr(`Kraken ist gerade nicht erreichbar oder in Wartung (Fehler ${status || 'unbekannt'}). Bitte später noch einmal versuchen.`, `Kraken is unreachable or under maintenance right now (error ${status || 'unknown'}). Please try again later.`)
          : tr(`Kraken hat unerwartet geantwortet (Fehler ${status}).`, `Kraken sent an unexpected answer (error ${status}).`),
        'network',
      )
    }
    return this.unwrap(data)
  }

  private unwrap(data: any): any {
    const codes: string[] = Array.isArray(data?.error) ? data.error : []
    if (codes.length) throw new KrakenError(codes.map(explainError).join(' '), codes.some(isRateCode) ? 'rate' : 'api', codes)
    return data?.result
  }

  async publicGet(endpoint: string, params: Record<string, string> = {}): Promise<any> {
    const qs = new URLSearchParams(params).toString()
    return this.request(`${KRAKEN_URL}/0/public/${endpoint}${qs ? `?${qs}` : ''}`, {}, TIMEOUT_MS)
  }

  async privatePost(endpoint: string, params: Record<string, unknown> = {}, json = false): Promise<any> {
    const creds = this.creds
    if (!creds) throw new KrakenError(tr('Kein API-Schlüssel hinterlegt.', 'No API key saved.'))
    const path = `/0/private/${endpoint}`
    const isOrder = endpoint === 'AddOrder' || endpoint === 'AddOrderBatch'
    const once = () => {
      const nonce = this.nonce()
      const body = json
        ? JSON.stringify({ nonce: Number(nonce), ...params })
        : new URLSearchParams({ nonce, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) }).toString()
      return this.request(KRAKEN_URL + path, {
        method: 'POST',
        headers: {
          'API-Key': creds.key,
          'API-Sign': sign(path, nonce, body, creds.secret),
          'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded; charset=utf-8',
        },
        body,
      }, isOrder ? ORDER_TIMEOUT_MS : TIMEOUT_MS)
    }
    return this.serial(async () => {
      // Reine Abfragen bei Bremse oder Überlastung bis zu zweimal mit Pause wiederholen
      for (let attempt = 0; ; attempt++) {
        try {
          return await once()
        } catch (e) {
          const k = e as KrakenError
          const retry = READ_ONLY.has(endpoint) && attempt < 2 && (k.kind === 'rate' || k.codes?.some(isBusyCode))
          if (!retry) throw e
          await this.pause(3000 * (attempt + 1))
        }
      }
    })
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
        ...(Number(p.tick_size) > 0 ? { tickSize: Number(p.tick_size) } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Krakens Systemstatus: online, maintenance, cancel_only, reduce_only oder post_only */
  async systemStatus(): Promise<string> {
    const r = await this.publicGet('SystemStatus')
    return String(r?.status ?? 'unknown')
  }

  async lastPrice(pairId: string): Promise<number> {
    const result = await this.publicGet('Ticker', { pair: pairId })
    const first = Object.values<any>(result)[0]
    return Number(first.c[0])
  }

  /** Letzte Kurse mehrerer Paare mit einer Anfrage */
  async lastPrices(pairIds: string[]): Promise<Record<string, number>> {
    if (!pairIds.length) return {}
    const result = await this.publicGet('Ticker', { pair: pairIds.join(',') })
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries<any>(result)) out[k] = Number(v.c[0])
    // Kraken antwortet mit dem internen Namen, der meist gleich ist. Sonst über die Reihenfolge zuordnen.
    const vals = Object.values<any>(result)
    pairIds.forEach((id, i) => {
      if (out[id] === undefined && vals[i]) out[id] = Number(vals[i].c[0])
    })
    return out
  }

  async balances(): Promise<Record<string, number>> {
    const result = await this.privatePost('Balance')
    return Object.fromEntries(Object.entries<string>(result).map(([k, v]) => [k, Number(v)]).filter(([, v]) => (v as number) > 0))
  }

  async openOrders(userref?: number): Promise<OpenOrder[]> {
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
  async placeLadder(pairId: string, side: Side, levels: LadderLevel[], opts: PlaceOptions): Promise<SentOrder[]> {
    const out: SentOrder[] = []
    for (let i = 0; i < levels.length; i += BATCH_MAX) {
      const chunk = levels.slice(i, i + BATCH_MAX)
      const orders = chunk.map((l) => ({
        ordertype: 'limit',
        type: side,
        price: plain(l.price),
        volume: plain(l.volume),
        userref: opts.userref,
        ...(opts.postOnly ? { oflags: 'post' } : {}),
      }))
      // Frist: kommt die Anfrage später bei Kraken an, wird nichts mehr angelegt
      const deadline = opts.validate ? {} : { deadline: new Date(Date.now() + ORDER_TIMEOUT_MS).toISOString() }
      try {
        if (orders.length === 1) {
          // Batch braucht mindestens 2 Orders, eine einzelne geht über AddOrder
          const r = await this.privatePost('AddOrder', { pair: pairId, ...orders[0], ...deadline, ...(opts.validate ? { validate: true } : {}) })
          out.push({ index: chunk[0].index, price: chunk[0].price, volume: chunk[0].volume, txid: r.txid?.[0] })
        } else {
          const r = await this.privatePost('AddOrderBatch', { pair: pairId, orders, validate: opts.validate, ...deadline }, true)
          chunk.forEach((l, j) => {
            const o = r.orders?.[j] ?? {}
            out.push({ index: l.index, price: l.price, volume: l.volume, txid: o.txid, error: o.error ? explainError(o.error) : undefined })
          })
        }
      } catch (e) {
        const err = e as KrakenError
        if (err.kind === 'network' && !opts.validate) {
          // Antwort verloren: nachsehen, was Kraken wirklich angelegt hat
          const found = await this.findPlaced(opts.userref, chunk, new Set(out.map((o) => o.txid).filter(Boolean) as string[]))
          chunk.forEach((l) => {
            const base = { index: l.index, price: l.price, volume: l.volume }
            if (!found) out.push({ ...base, uncertain: true, error: tr(`${err.message} Unklar, ob diese Order angelegt wurde. Bitte unter „Offene Orders“ nachsehen.`, `${err.message} Unclear whether this order was placed. Please check under “Open orders”.`) })
            else if (found.has(l.index)) out.push({ ...base, txid: found.get(l.index) })
            else out.push({ ...base, error: tr(`${err.message} Diese Order wurde nicht angelegt.`, `${err.message} This order was not placed.`) })
          })
        } else {
          // Wird ein Paket abgelehnt, gilt das für alle Orders darin
          chunk.forEach((l) => out.push({ index: l.index, price: l.price, volume: l.volume, error: err.message }))
        }
        // Danach abbrechen, damit nicht ein halber Plan ohne Rückmeldung weiterläuft
        levels.slice(i + BATCH_MAX).forEach((l) => out.push({ index: l.index, price: l.price, volume: l.volume, error: tr('Nicht gesendet, weil ein vorheriges Paket fehlschlug.', 'Not sent because a previous batch failed.') }))
        opts.onProgress?.(out.length)
        return out
      }
      opts.onProgress?.(out.length)
      // Kraken drosselt Order-Anfragen pro Paar, daher kurze Pause zwischen Paketen
      if (i + BATCH_MAX < levels.length) await this.pause(1000)
    }
    return out
  }

  /** Sucht nach einem Verbindungsabbruch die Orders eines Pakets bei Kraken (über userref, Preis und Menge). null = nicht klärbar. */
  private async findPlaced(userref: number, chunk: LadderLevel[], known: Set<string>): Promise<Map<number, string> | null> {
    try {
      await this.pause(3000)
      const open = await this.openOrders(userref)
      const closed = await this.closedOrders(userref)
      const all = [
        ...open.map((o) => ({ txid: o.txid, price: o.price, volume: o.volume })),
        ...closed.map((o) => ({ txid: o.txid, price: o.limitPrice, volume: o.volume })),
      ].filter((o) => !known.has(o.txid))
      const found = new Map<number, string>()
      for (const l of chunk) {
        const hit = all.find((o) => same(o.price, l.price) && same(o.volume, l.volume))
        if (hit) {
          found.set(l.index, hit.txid)
          known.add(hit.txid)
          all.splice(all.indexOf(hit), 1)
        }
      }
      return found
    } catch {
      return null
    }
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

  private mapClosed(r: any): ClosedOrder[] {
    return Object.entries<any>(r.closed ?? {}).map(([txid, o]) => ({
      txid,
      status: o.status,
      side: o.descr.type,
      volume: Number(o.vol),
      filled: Number(o.vol_exec),
      cost: Number(o.cost),
      fee: Number(o.fee),
      price: Number(o.price) || Number(o.descr.price),
      limitPrice: Number(o.descr.price),
      userref: o.userref ?? 0,
    }))
  }

  /** Geschlossene Orders eines Plans (ausgeführt, storniert oder abgelaufen) */
  async closedOrders(userref: number): Promise<ClosedOrder[]> {
    return this.mapClosed(await this.privatePost('ClosedOrders', { userref }))
  }

  /**
   * Alle geschlossenen Orders seit einem Zeitpunkt (Unix-Sekunden), seitenweise zu je 50.
   * Eine Abfrage für alle Pläne statt einer pro Plan schont Krakens Anfrage-Grenze.
   */
  async closedOrdersSince(start: number, maxPages = 10, _pairIds: string[] = []): Promise<ClosedOrder[]> {
    const out: ClosedOrder[] = []
    for (let page = 0; page < maxPages; page++) {
      // Ab der 5. Seite kurz warten, damit Krakens Anfrage-Zähler (2 Punkte pro Seite) nicht überläuft
      if (page >= 4) await this.pause(6000)
      const r = await this.privatePost('ClosedOrders', { start: Math.floor(start), ofs: out.length })
      const batch = this.mapClosed(r)
      out.push(...batch)
      if (!batch.length || out.length >= Number(r.count ?? 0)) break
    }
    return out
  }

  /** Storniert alle offenen Orders eines Plans (Kraken akzeptiert userref statt txid) */
  async cancelPlan(userref: number): Promise<number> {
    const r = await this.privatePost('CancelOrder', { txid: userref })
    return Number(r.count ?? 0)
  }

  /** Notbremse: storniert ALLE offenen Orders des Kontos */
  async cancelAll(): Promise<number> {
    const r = await this.privatePost('CancelAll')
    return Number(r?.count ?? 0)
  }

  async cancelOrder(txid: string): Promise<void> {
    await this.privatePost('CancelOrder', { txid })
  }

  /**
   * Prüft, welche Rechte der Schlüssel hat. Alles nur lesend oder mit validate,
   * es wird nichts angelegt oder storniert. Ein falscher Schlüssel wirft sofort einen Fehler.
   */
  async checkPermissions(_opts?: { noWithdrawConfirmed?: boolean }): Promise<KeyCheck[]> {
    const denied = (e: unknown) => !!(e as KrakenError).codes?.some((c) => c.includes('Permission denied'))
    const fatal = (e: unknown) => {
      const k = e as KrakenError
      return k.kind === 'network' || k.kind === 'rate' || !!k.codes?.some((c) => /Invalid key|Invalid signature|Invalid nonce|Temporary lockout/.test(c))
    }
    async function probe(fn: () => Promise<unknown>, ignoreOther: boolean): Promise<{ ok: boolean; detail?: string }> {
      try {
        await fn()
        return { ok: true }
      } catch (e) {
        if (fatal(e)) throw e
        if (denied(e)) return { ok: false }
        // Andere Ablehnungen (z. B. „Order unbekannt“) heißen: das Recht ist da, nur der Testauftrag war absichtlich ungültig
        return ignoreOther ? { ok: true } : { ok: false, detail: (e as Error).message }
      }
    }
    const checks: KeyCheck[] = []
    const add = (id: string, label: string, exchangeLabel: string, r: { ok: boolean; detail?: string }) =>
      checks.push({ id, label, exchangeLabel, required: true, ok: r.ok, detail: r.detail })

    add('funds', tr('Guthaben abfragen', 'Query funds'), 'Query Funds', await probe(() => this.privatePost('Balance'), false))
    add('open', tr('Offene Orders abfragen', 'Query open orders'), 'Query Open Orders & Trades', await probe(() => this.privatePost('OpenOrders'), false))
    add('closed', tr('Geschlossene Orders abfragen', 'Query closed orders'), 'Query Closed Orders & Trades', await probe(() => this.privatePost('ClosedOrders'), false))
    add('create', tr('Orders erstellen', 'Create orders'), 'Create & Modify Orders',
      await probe(() => this.privatePost('AddOrder', { pair: 'XXBTZEUR', type: 'buy', ordertype: 'limit', price: '1', volume: '0.0001', validate: true }), true))
    add('cancel', tr('Orders stornieren', 'Cancel orders'), 'Cancel & Close Orders', await probe(() => this.privatePost('CancelOrder', { txid: 'OFEHU0-CHECK0-NOTREAL' }), true))

    // Auszahlungen dürfen NICHT erlaubt sein
    let withdraw: KeyCheck = { id: 'withdraw', label: tr('Keine Auszahlungen', 'No withdrawals'), exchangeLabel: 'Withdraw Funds', required: true, ok: true }
    try {
      await this.privatePost('WithdrawMethods')
      withdraw = { ...withdraw, ok: false, detail: tr('Dieser Schlüssel darf Geld abheben. Lege bitte einen neuen Schlüssel ohne „Withdraw Funds“ an.', 'This key can withdraw money. Please create a new key without “Withdraw Funds”.') }
    } catch (e) {
      if (fatal(e)) throw e
      if (!denied(e)) withdraw = { ...withdraw, detail: tr('Konnte nicht sicher geprüft werden. Kontrolliere bei Kraken, dass „Withdraw Funds“ aus ist.', 'Could not be checked reliably. Make sure “Withdraw Funds” is off at Kraken.') }
    }
    checks.push(withdraw)
    return checks
  }
}
