// Portfolio: alle Pläne je Coin zusammengefasst, mit Ist (schon gekauft), Soll (noch geplant) und Cash.
// Rein, ohne Netz, damit es testbar ist.
import type { DraftDto, OpenOrderDto, PlanDto, PlanStatusDto } from './ipc'
import { amountUnit, heldZones, isHeld, planAmount } from './ladder'
import type { ExchangeId } from './exchanges'
import { exchangeOf } from './exchanges'

/** Was die App je Börse für das Portfolio lädt */
export interface PortfolioSource {
  exchange: ExchangeId
  hasKey: boolean
  plans: PlanDto[]
  drafts: DraftDto[]
  status: PlanStatusDto[]
  openOrders: OpenOrderDto[]
  /** Euro bei der Börse gesamt (frei + in Orders gebunden). null = unbekannt (kein Schlüssel, Fehler) */
  eurTotal: number | null
  /** Davon frei, nicht in Orders gebunden */
  eurFree: number | null
  /** Letzter Kurs je Paar-Id der Pläne und Entwürfe */
  prices: Record<string, number>
  /** Fehler beim Laden dieser Börse (die anderen werden trotzdem gezeigt) */
  error?: string
}

/** Eigener Cash-Topf, z. B. Tagesgeld. reserve = Notgroschen, zählt nicht für Käufe. */
export interface CashPot {
  id: string
  name: string
  amount: number
  reserve?: boolean
}

export const MAX_CASH_POTS = 20
export const MAX_CASH_AMOUNT = 1e12

/** Nur gültige Töpfe übernehmen (aus Einstellungen oder einer Sicherung) */
export function cleanCashPots(raw: unknown): CashPot[] {
  if (!Array.isArray(raw)) return []
  const out: CashPot[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const amount = Number(r.amount)
    if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !Number.isFinite(amount) || amount < 0 || amount > MAX_CASH_AMOUNT) continue
    out.push({ id: r.id.slice(0, 64), name: r.name.trim().slice(0, 60), amount, ...(r.reserve === true ? { reserve: true } : {}) })
    if (out.length >= MAX_CASH_POTS) break
  }
  return out
}

export interface CoinRow {
  /** Coin-Name, z. B. BTC */
  coin: string
  /** Börsen, auf denen es Pläne oder Entwürfe zu diesem Coin gibt */
  exchanges: ExchangeId[]
  /** Anzahl gesendeter Pläne und offener Entwürfe */
  plans: number
  drafts: number
  /** Gekaufte minus verkaufte Menge aus deinen Plänen */
  heldVolume: number
  /** Ist: Einstand der gehaltenen Menge in EUR, inklusive Gebühren */
  invested: number
  /** Gebühren aller Ausführungen in EUR */
  fees: number
  /** Ø Kaufpreis je Stück inklusive Gebühren, null ohne Käufe */
  avgPrice: number | null
  /** Kurs je Stück in EUR, null ohne Kurs */
  price: number | null
  /** Wert heute der gehaltenen Menge, null ohne Kurs */
  value: number | null
  /** Plus/Minus gegenüber dem Einstand */
  pnl: number | null
  pnlPct: number | null
  /** Anzahl offener Orders */
  openCount: number
  /** Euro, die in offenen Orders noch ausgegeben (Kauf, positiv) bzw. eingenommen (Verkauf, negativ) werden */
  openEur: number
  /** Noch nicht gesendete Stufen und pausierte Zonen */
  laterEur: number
  /** Anzahl pausierter Zonen mit Stufen */
  heldZoneCount: number
  /** Offene Entwürfe */
  draftEur: number
  /** Soll: was noch geplant ist (Kauf positiv, Verkauf negativ), mit Entwürfen, wenn eingeschaltet */
  soll: number
  /** Anteil des Kauf-Plans, der schon gekauft ist (0–1), null ohne Kaufpläne */
  progress: number | null
  /** Mindestens ein Plan ohne Stand von der Börse (kein Schlüssel oder Fehler) */
  unknown: boolean
  /** Es wurde mehr verkauft als über die App gekauft (Bestand von außerhalb) */
  soldOutside: boolean
}

export interface PortfolioSlice {
  key: string
  label: string
  value: number
}

export interface Portfolio {
  rows: CoinRow[]
  /** Summen über alle Coins */
  invested: number
  value: number
  pnl: number
  /** Soll gesamt (Kauf minus Verkauf) */
  soll: number
  /** Davon in offenen Orders */
  sollOpen: number
  /** Davon pausiert, noch nicht gesendet oder Entwurf */
  sollLater: number
  /** Euro bei den Börsen gesamt, frei und in Orders */
  cashExchange: number
  cashExchangeFree: number
  /** Eigene Töpfe ohne Reserve und Reserve */
  cashPots: number
  cashReserve: number
  /** Cash gesamt (Börsen + Töpfe + Reserve) */
  cash: number
  /** Euro, die Kaufpläne noch brauchen */
  buyNeed: number
  /** Euro, die dafür zur Verfügung stehen (Cash ohne Reserve, plus Erlöse aus geplanten Verkäufen) */
  buyCash: number
  /** Fehlbetrag, 0 = gedeckt */
  shortfall: number
  /** Noch nicht gesendete Käufe (nicht in Orders gebunden) und freie Euro bei den Börsen, für den Hinweis „Geld zur Börse überweisen“ */
  unsentBuy: number
  /** Börsen ohne bekannten Euro-Bestand */
  cashUnknown: ExchangeId[]
  /** Torte heute und nach allen Plänen */
  ist: PortfolioSlice[]
  after: PortfolioSlice[]
}

const USD_QUOTES = ['USD', 'ZUSD', 'USDC', 'USDT']
const coinOf = (pairName: string) => pairName.split('/')[0] || pairName
const quoteOf = (pairName: string) => pairName.split('/')[1] ?? 'EUR'

/**
 * Rechnet einen Betrag in der Kurswährung des Paars in Euro um.
 * usdRate: 1 EUR = x USD. Andere Kurswährungen (z. B. BTC) lassen sich nicht umrechnen, dann null.
 */
export function toEur(amount: number, quote: string, usdRate: number | null): number | null {
  const q = quote.toUpperCase()
  if (q === 'EUR' || q === 'ZEUR') return amount
  if (USD_QUOTES.includes(q)) return usdRate && usdRate > 0 ? amount / usdRate : null
  return null
}

/** Noch nicht gesendete Stufen eines Plans: zurückgehaltene Reste und pausierte Zonen */
export function unsentLevels(p: PlanDto) {
  const sent = new Set(p.sentIndices ?? [])
  const held = heldZones(p.input)
  const all = (p.levels ?? []).filter((l) => !sent.has(l.index) && !l.problem)
  return { all, heldZones: [...held].filter((z) => all.some((l) => isHeld(l, new Set([z])))).length }
}

/** Wert eines offenen Entwurfs in der Kurswährung: Geld direkt, Stück mal Mitte des Preisbereichs */
export function draftValue(d: DraftDto): number {
  const amount = planAmount(d.input)
  if (amountUnit(d.input) === 'quote') return amount
  const mid = (d.input.priceStart + d.input.priceEnd) / 2
  return amount * (mid > 0 ? mid : d.priceAtSave ?? 0)
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

interface Acc {
  coin: string
  exchanges: Set<ExchangeId>
  plans: number
  drafts: number
  buyVol: number
  buyCost: number
  sellVol: number
  fees: number
  price: number | null
  openCount: number
  openBuy: number
  openSell: number
  laterBuy: number
  laterSell: number
  heldZoneCount: number
  draftBuy: number
  draftSell: number
  unknown: boolean
}

/**
 * Fasst alle Börsen zu einem Portfolio zusammen.
 * Ist = Einstand der Menge, die deine Pläne gekauft (und nicht wieder verkauft) haben, Durchschnittsmethode inkl. Gebühren.
 * Soll = Euro in offenen Orders + noch nicht gesendete Stufen + pausierte Zonen (+ Entwürfe, wenn includeDrafts).
 * Euro in offenen Kauforders zählen im Cash (sie liegen ja noch bei der Börse) und werden in der Torte „nach allen Plänen“ zum Coin.
 */
export function buildPortfolio(sources: PortfolioSource[], pots: CashPot[], opts: { includeDrafts: boolean; usdRate: number | null }): Portfolio {
  const accs = new Map<string, Acc>()
  const acc = (coin: string): Acc => {
    let a = accs.get(coin)
    if (!a) accs.set(coin, (a = { coin, exchanges: new Set(), plans: 0, drafts: 0, buyVol: 0, buyCost: 0, sellVol: 0, fees: 0, price: null, openCount: 0, openBuy: 0, openSell: 0, laterBuy: 0, laterSell: 0, heldZoneCount: 0, draftBuy: 0, draftSell: 0, unknown: false }))
    return a
  }
  const eur = (v: number, pairName: string) => toEur(v, quoteOf(pairName), opts.usdRate) ?? 0
  const setPrice = (a: Acc, pairId: string, pairName: string, prices: Record<string, number>) => {
    const p = prices[pairId]
    if (!(p > 0) || a.price !== null) return
    const e = toEur(p, quoteOf(pairName), opts.usdRate)
    if (e !== null) a.price = e
  }

  for (const src of sources) {
    const status = new Map(src.status.map((s) => [s.userref, s]))
    for (const p of src.plans) {
      if (exchangeOf(p) !== src.exchange) continue
      const a = acc(coinOf(p.pairName))
      a.exchanges.add(src.exchange)
      a.plans++
      setPrice(a, p.pairId, p.pairName, src.prices)
      const st = status.get(p.userref)
      // Ohne Schlüssel oder bei einem Fehler kennt die App die Ausführungen nicht. Sehr alte, fertige Pläne ohne Stand zählen nicht als unbekannt.
      if (!st && (!src.hasKey || src.error)) a.unknown = true
      if (st && st.filledVolume > 0) {
        a.fees += eur(st.fees, p.pairName)
        if (p.side === 'buy') {
          a.buyVol += st.filledVolume
          a.buyCost += eur(st.filledCost + st.fees, p.pairName)
        } else a.sellVol += st.filledVolume
      }
      for (const o of src.openOrders) {
        if (o.userref !== p.userref) continue
        const rest = Math.max(0, o.volume - o.filled) * o.price
        a.openCount++
        if (o.side === 'buy') a.openBuy += eur(rest, p.pairName)
        else a.openSell += eur(rest, p.pairName)
      }
      const { all, heldZones: hz } = unsentLevels(p)
      const later = eur(sum(all.map((l) => l.cost)), p.pairName)
      if (p.side === 'buy') a.laterBuy += later
      else a.laterSell += later
      a.heldZoneCount += hz
    }
    for (const d of src.drafts) {
      if (d.status !== 'draft' || exchangeOf(d) !== src.exchange) continue
      const a = acc(coinOf(d.pairName))
      a.exchanges.add(src.exchange)
      a.drafts++
      setPrice(a, d.pairId, d.pairName, src.prices)
      const v = eur(draftValue(d), d.pairName)
      if (d.side === 'buy') a.draftBuy += v
      else a.draftSell += v
    }
  }

  const rows: CoinRow[] = [...accs.values()].map((a) => {
    const avgPrice = a.buyVol > 0 ? a.buyCost / a.buyVol : null
    const heldVolume = Math.max(0, a.buyVol - a.sellVol)
    const invested = avgPrice !== null ? heldVolume * avgPrice : 0
    const value = a.price !== null ? heldVolume * a.price : null
    const pnl = value !== null && invested > 0 ? value - invested : null
    const draftNet = opts.includeDrafts ? a.draftBuy - a.draftSell : 0
    const openEur = a.openBuy - a.openSell
    const laterEur = a.laterBuy - a.laterSell
    const soll = openEur + laterEur + draftNet
    const buyPlanned = a.openBuy + a.laterBuy + (opts.includeDrafts ? a.draftBuy : 0)
    const bought = a.buyCost
    return {
      coin: a.coin, exchanges: [...a.exchanges], plans: a.plans, drafts: a.drafts, heldVolume, invested, fees: a.fees, avgPrice, price: a.price, value, pnl,
      pnlPct: pnl !== null ? pnl / invested : null,
      openCount: a.openCount, openEur, laterEur, heldZoneCount: a.heldZoneCount, draftEur: a.draftBuy - a.draftSell, soll,
      progress: bought + buyPlanned > 0 ? bought / (bought + buyPlanned) : null,
      unknown: a.unknown, soldOutside: a.sellVol > a.buyVol + 1e-12,
    }
  }).sort((x, y) => (y.value ?? y.invested) + Math.max(0, y.soll) - ((x.value ?? x.invested) + Math.max(0, x.soll)) || x.coin.localeCompare(y.coin))

  const known = sources.filter((s) => s.eurTotal !== null)
  const cashExchange = sum(known.map((s) => s.eurTotal ?? 0))
  const cashExchangeFree = sum(known.map((s) => s.eurFree ?? s.eurTotal ?? 0))
  const cashPots = sum(pots.filter((p) => !p.reserve).map((p) => p.amount))
  const cashReserve = sum(pots.filter((p) => p.reserve).map((p) => p.amount))
  const cash = cashExchange + cashPots + cashReserve

  const buyNeed = sum([...accs.values()].map((a) => a.openBuy + a.laterBuy + (opts.includeDrafts ? a.draftBuy : 0)))
  const sellIn = sum([...accs.values()].map((a) => a.openSell + a.laterSell + (opts.includeDrafts ? a.draftSell : 0)))
  const buyCash = cashExchange + cashPots + sellIn
  const unsentBuy = sum([...accs.values()].map((a) => a.laterBuy + (opts.includeDrafts ? a.draftBuy : 0)))

  const soll = sum(rows.map((r) => r.soll))
  const sollOpen = sum(rows.map((r) => r.openEur))
  const coinNow = (r: CoinRow) => r.value ?? r.invested
  const ist: PortfolioSlice[] = [
    ...rows.filter((r) => coinNow(r) > 0).map((r) => ({ key: r.coin, label: r.coin, value: coinNow(r) })),
    ...(cashExchange + cashPots > 0 ? [{ key: 'cash', label: 'Cash', value: cashExchange + cashPots }] : []),
    ...(cashReserve > 0 ? [{ key: 'reserve', label: 'Reserve', value: cashReserve }] : []),
  ]
  // Nach allen Plänen: Coins wachsen um ihr Soll, Cash schrumpft entsprechend (nie unter 0)
  const afterCash = Math.max(0, cashExchange + cashPots - soll)
  const after: PortfolioSlice[] = [
    ...rows.map((r) => ({ key: r.coin, label: r.coin, value: Math.max(0, coinNow(r) + r.soll) })).filter((s) => s.value > 0),
    ...(afterCash > 0 ? [{ key: 'cash', label: 'Cash', value: afterCash }] : []),
    ...(cashReserve > 0 ? [{ key: 'reserve', label: 'Reserve', value: cashReserve }] : []),
  ]

  return {
    rows,
    invested: sum(rows.map((r) => r.invested)),
    value: sum(rows.map(coinNow)),
    pnl: sum(rows.map((r) => r.pnl ?? 0)),
    soll, sollOpen, sollLater: soll - sollOpen,
    cashExchange, cashExchangeFree, cashPots, cashReserve, cash,
    buyNeed, buyCash, shortfall: Math.max(0, buyNeed - buyCash), unsentBuy,
    cashUnknown: sources.filter((s) => s.eurTotal === null && (s.plans.length > 0 || s.drafts.length > 0)).map((s) => s.exchange),
    ist, after,
  }
}

/** Anteile in Prozent (0–100) einer Torte */
export function shares(slices: PortfolioSlice[]): Record<string, number> {
  const total = sum(slices.map((s) => s.value))
  return Object.fromEntries(slices.map((s) => [s.key, total > 0 ? (s.value / total) * 100 : 0]))
}
