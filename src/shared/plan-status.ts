// Fortschritt eines Plans aus den offenen und geschlossenen Orders bei Kraken.
// Rein, ohne Netz, damit es testbar ist.

export interface OrderSnapshot {
  txid: string
  /** open, closed, canceled, expired */
  status: string
  volume: number
  filled: number
  /** Gegenwert des ausgeführten Teils (Kraken liefert ihn nur bei geschlossenen Orders, sonst 0) */
  cost: number
  fee: number
  price: number
}

export interface PlanStatus {
  open: number
  /** Komplett ausgeführte Orders */
  filled: number
  /** Teilweise ausgeführt (offen oder storniert mit Teilausführung) */
  partial: number
  canceled: number
  filledVolume: number
  filledCost: number
  fees: number
  /** Durchschnittspreis der Ausführungen */
  averagePrice: number
  /** txids, die vollständig oder teilweise ausgeführt sind */
  executedTxids: string[]
}

export function planStatus(orders: OrderSnapshot[]): PlanStatus {
  const s: PlanStatus = { open: 0, filled: 0, partial: 0, canceled: 0, filledVolume: 0, filledCost: 0, fees: 0, averagePrice: 0, executedTxids: [] }
  for (const o of orders) {
    const done = o.filled > 0 && o.filled >= o.volume - 1e-12
    if (o.status === 'open' || o.status === 'pending') s.open++
    else if (o.status === 'canceled' || o.status === 'expired') s.canceled++
    if (done && o.status === 'closed') s.filled++
    else if (o.filled > 0) s.partial++
    if (o.filled > 0) {
      s.filledVolume += o.filled
      // offene Teilausführungen haben noch keinen cost-Wert, dann über den Limitpreis schätzen
      s.filledCost += o.cost > 0 ? o.cost : o.filled * o.price
      s.fees += o.fee
      s.executedTxids.push(o.txid)
    }
  }
  s.averagePrice = s.filledVolume > 0 ? s.filledCost / s.filledVolume : 0
  return s
}

/** Vorschlag für eine Gewinnstaffel über dem Kaufpreis */
export function profitLadderSuggestion(averagePrice: number, volume: number): { priceStart: number; priceEnd: number; total: number } {
  return { priceStart: averagePrice * 1.1, priceEnd: averagePrice * 1.5, total: volume }
}
