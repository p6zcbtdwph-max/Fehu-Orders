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
  /** Limitpreis (bei geschlossenen Orders ist price der Ausführungspreis). Für die Zuordnung zu Stufen und Zonen. */
  limitPrice?: number
  /** Zeitpunkt der letzten Ausführung (Unix-Sekunden), aus dem Ausführungsbuch */
  closedAt?: number
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
  /** Erste und letzte Ausführung (Unix-Sekunden), soweit die Börse sie nennt. Wichtig z. B. für die Haltefrist. */
  firstFillAt?: number
  lastFillAt?: number
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
      if (o.closedAt && o.status !== 'open') {
        s.firstFillAt = Math.min(s.firstFillAt ?? Infinity, o.closedAt)
        s.lastFillAt = Math.max(s.lastFillAt ?? 0, o.closedAt)
      }
    }
  }
  s.averagePrice = s.filledVolume > 0 ? s.filledCost / s.filledVolume : 0
  return s
}

/** Vorschlag für eine Gewinnstaffel über dem Kaufpreis */
export function profitLadderSuggestion(averagePrice: number, volume: number): { priceStart: number; priceEnd: number; total: number } {
  return { priceStart: averagePrice * 1.1, priceEnd: averagePrice * 1.5, total: volume }
}

/** Fortschritt einer Preiszone: wie viel der gesendeten Menge schon ausgeführt ist */
export interface ZoneProgress {
  zone: number
  /** Stufen der Zone insgesamt / davon gesendet */
  levels: number
  sent: number
  /** Gesendete Menge (Basiswährung) und davon ausgeführt */
  sentVolume: number
  filledVolume: number
  /** filledVolume / sentVolume (0–1), 0 wenn nichts gesendet */
  filledShare: number
}

/**
 * Ordnet die Orders eines Plans über ihren Limitpreis den Stufen und damit den Zonen zu
 * (die Börsen kennen keine Zonen, die Zonen überschneiden sich aber nicht). Ohne Zonen: leer.
 */
export function zoneProgress(levels: { index: number; price: number; volume: number; zone?: number }[], sentIndices: number[], orders: Pick<OrderSnapshot, 'price' | 'limitPrice' | 'filled'>[]): ZoneProgress[] {
  const zoned = levels.filter((l) => l.zone !== undefined)
  if (!zoned.length) return []
  const count = Math.max(...zoned.map((l) => l.zone as number)) + 1
  const sent = new Set(sentIndices)
  const out: ZoneProgress[] = Array.from({ length: count }, (_, zone) => ({ zone, levels: 0, sent: 0, sentVolume: 0, filledVolume: 0, filledShare: 0 }))
  for (const l of zoned) {
    const z = out[l.zone as number]
    z.levels++
    if (sent.has(l.index)) { z.sent++; z.sentVolume += l.volume }
  }
  const sentLevels = zoned.filter((l) => sent.has(l.index))
  for (const o of orders) {
    if (!(o.filled > 0) || !sentLevels.length) continue
    const p = o.limitPrice && o.limitPrice > 0 ? o.limitPrice : o.price
    let best = sentLevels[0]
    for (const l of sentLevels) if (Math.abs(l.price - p) < Math.abs(best.price - p)) best = l
    out[best.zone as number].filledVolume += o.filled
  }
  for (const z of out) z.filledShare = z.sentVolume > 0 ? Math.min(1, z.filledVolume / z.sentVolume) : 0
  return out
}

/** Ist die Bedingung einer entschärften Zone erfüllt? (Zone trigger.zone zu mindestens trigger.percent % ausgeführt) */
export function triggerMet(progress: ZoneProgress[] | undefined, trigger: { zone: number; percent: number }): boolean {
  const z = progress?.find((x) => x.zone === trigger.zone)
  return !!z && z.sentVolume > 0 && z.filledShare * 100 + 1e-9 >= trigger.percent
}
