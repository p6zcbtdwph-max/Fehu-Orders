// Bestand für den Verkauf: welche Coins man besitzt, wie viel davon frei ist, gesperrt (in offenen Orders) oder in Earn.
// Rein, ohne Netz, damit es testbar ist.
import { assetLabel } from './safety'
import { effectiveMinCost, type PairRules } from './ladder'

export interface HoldingPair extends Pick<PairRules, 'orderMin' | 'costMin' | 'volumeDecimals'> {
  id: string
  name: string
  base: string
  quote: string
}

export interface Holding<P extends HoldingPair = HoldingPair> {
  /** Coin-Name wie in der Paar-Anzeige, z. B. SOL */
  coin: string
  /** Asset-Code der Börse, z. B. XXBT bei Kraken */
  base: string
  /** Paar, über das verkauft wird (Euro-Paar bevorzugt) */
  pair: P
  /** Frei verkaufbar */
  available: number
  /** In offenen Orders gesperrt */
  locked: number
  /** In Earn / Staking (nicht sofort verkaufbar) */
  earn: number
  /** Gegenwert des freien Bestands in der Kurswährung des Paars, falls ein Kurs bekannt ist */
  value?: number
  /** Freier Bestand ist zu klein für eine einzige Order (Staub) */
  dust: boolean
}

/** Bevorzugte Kurswährung beim Verkaufen */
const PREFERRED_QUOTES = ['EUR', 'USD', 'USDC', 'USDT']

const coinOf = (p: HoldingPair) => p.name.split('/')[0]
const quoteRank = (p: HoldingPair) => {
  const q = p.name.split('/')[1] ?? ''
  const i = PREFERRED_QUOTES.indexOf(q)
  return i < 0 ? PREFERRED_QUOTES.length : i
}

/**
 * Baut die Bestandsliste: je Coin eine Zeile mit dem bevorzugten Paar (Euro zuerst).
 * available: freies Guthaben je Asset-Code, balances: Gesamtguthaben (frei + gesperrt, bei Kraken auch Earn-Codes wie SOL.S).
 * prices: letzter Kurs je Paar-Id. minCost: eigener Mindest-Orderwert, darunter gilt der Bestand als Staub.
 * Sortiert nach Wert (größter zuerst), Coins ohne Kurs am Ende.
 */
export function holdingsFor<P extends HoldingPair>(pairs: P[], available: Record<string, number>, balances: Record<string, number> = {}, prices: Record<string, number> = {}, minCost = 0): Holding<P>[] {
  const byBase = new Map<string, P>()
  for (const p of pairs) {
    const cur = byBase.get(p.base)
    if (!cur || quoteRank(p) < quoteRank(cur)) byBase.set(p.base, p)
  }
  // Earn-Bestände (nur Kraken hat dafür eigene Codes mit Punkt, z. B. SOL.S, XBT.M)
  const earnByCoin: Record<string, number> = {}
  for (const [code, v] of Object.entries(balances)) {
    const l = assetLabel(code)
    if (l.earn && v > 0) earnByCoin[l.name] = (earnByCoin[l.name] ?? 0) + v
  }
  const out: Holding<P>[] = []
  for (const [base, pair] of byBase) {
    const free = Math.max(0, available[base] ?? 0)
    const total = balances[base]
    const locked = total !== undefined && total > free ? total - free : 0
    const coin = coinOf(pair)
    const earn = earnByCoin[assetLabel(base).name] ?? earnByCoin[coin] ?? 0
    if (!(free > 0) && !(locked > 0) && !(earn > 0)) continue
    const price = prices[pair.id]
    const value = price > 0 ? free * price : undefined
    const min = price > 0 ? effectiveMinCost(minCost, price, pair).effective : 0
    const dust = !(free > 0) || free < pair.orderMin || (price > 0 && free * price < min * (1 - 1e-9))
    out.push({ coin, base, pair, available: free, locked, earn, value, dust })
  }
  return out.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.coin.localeCompare(b.coin))
}

/** Paare, die sich verkaufen lassen: es gibt freien Bestand vom Coin, der kein Staub ist */
export function sellablePairs<P extends HoldingPair>(pairs: P[], holdings: Holding<P>[]): P[] {
  const bases = new Set(holdings.filter((h) => !h.dust).map((h) => h.base))
  return pairs.filter((p) => bases.has(p.base))
}

/**
 * Menge zum Verkaufen aus einem Anteil am freien Bestand, nachdem ein Rest behalten wird.
 * Abgerundet auf die erlaubten Nachkommastellen, damit nie mehr verkauft wird, als da ist.
 */
export function shareOfHolding(free: number, fraction: number, keep: number, volumeDecimals: number): number {
  const usable = Math.max(0, free - Math.max(0, keep || 0))
  const raw = usable * Math.min(1, Math.max(0, fraction))
  const d = Math.max(0, Math.min(12, Math.floor(volumeDecimals)))
  const f = Math.pow(10, d)
  // kleine Toleranz gegen Gleitkomma-Reste (0.3 * 10 = 2.9999999999999996)
  return Math.floor(raw * f * (1 + 1e-12) + 1e-9) / f
}
