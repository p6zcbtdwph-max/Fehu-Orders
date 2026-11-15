// Kursverlauf als Orientierung beim Planen: Tief- und Höchstkurse der letzten Wochen und
// wie oft der Kurs eine Stufe erreicht hat. Reine Rechnung ohne Netz, damit sie testbar ist.
// Wichtig: Das ist ein Blick zurück, keine Vorhersage und keine Empfehlung.
import type { Side } from './ladder'

/**
 * Eine Kerze, wie die Börsen-Anbindungen sie liefern: [Zeit in s, Schlusskurs, Tiefstkurs, Höchstkurs].
 * Tief und Hoch fehlen bei älteren Daten, dann gilt der Schlusskurs.
 */
export type OhlcRow = [number, number, number?, number?]

export interface Candle {
  t: number
  close: number
  low: number
  high: number
}

export const DAY = 86_400
/** Zeiträume, für die der Planer Tief- und Höchstkurse zeigt */
export const HISTORY_WINDOWS = [30, 90, 365] as const

export function toCandles(rows: OhlcRow[]): Candle[] {
  const out: Candle[] = []
  for (const r of rows) {
    const [t, close] = r
    if (!Number.isFinite(t) || !(close > 0)) continue
    const low = Number.isFinite(r[2]) && (r[2] as number) > 0 ? Math.min(r[2] as number, close) : close
    const high = Number.isFinite(r[3]) && (r[3] as number) > 0 ? Math.max(r[3] as number, close) : close
    out.push({ t, close, low, high })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** Kerzen der letzten `days` Tage (gemessen an `now`, Sekunden) */
export function lastDays(candles: Candle[], days: number, now: number): Candle[] {
  const since = now - days * DAY
  return candles.filter((c) => c.t >= since - 1)
}

export interface WindowStats {
  /** Gewünschter Zeitraum in Tagen */
  days: number
  /** Wie viele Tage die Börse wirklich geliefert hat (kann bei neuen Paaren oder Coinbase kürzer sein) */
  covered: number
  low: number
  lowAt: number
  high: number
  highAt: number
}

/** Tief und Hoch eines Zeitraums. null, wenn es dafür keine Kerzen gibt. */
export function windowStats(candles: Candle[], days: number, now: number): WindowStats | null {
  const cs = lastDays(candles, days, now)
  if (!cs.length) return null
  let lo = cs[0]
  let hi = cs[0]
  for (const c of cs) {
    if (c.low < lo.low) lo = c
    if (c.high > hi.high) hi = c
  }
  const covered = Math.min(days, Math.max(1, Math.round((now - cs[0].t) / DAY)))
  return { days, covered, low: lo.low, lowAt: lo.t, high: hi.high, highAt: hi.t }
}

export interface Reach {
  /** An wie vielen Tagen (Kerzen) der Kurs die Stufe erreicht hat */
  hits: number
  /** Anzahl Tage (Kerzen) im Zeitraum */
  of: number
  /** Letzter Tag, an dem die Stufe erreicht wurde (Sekunden), sonst undefined */
  lastAt?: number
}

/**
 * Wie oft der Kurs eine Stufe erreicht hat. Kauf: der Tiefstkurs eines Tages lag bei oder unter dem Preis.
 * Verkauf: der Höchstkurs lag bei oder über dem Preis. Erwartet Tageskerzen.
 */
export function reach(candles: Candle[], side: Side, price: number, days: number, now: number): Reach {
  const cs = lastDays(candles, days, now)
  let hits = 0
  let lastAt: number | undefined
  for (const c of cs) {
    if (side === 'buy' ? c.low <= price : c.high >= price) {
      hits++
      lastAt = c.t
    }
  }
  return { hits, of: cs.length, ...(lastAt !== undefined ? { lastAt } : {}) }
}

/** Zusammenfassung für die Stufen eines Plans: wie viele nie erreicht wurden und wie viel Geld darin steckt */
export function unreached(levels: { price: number; cost: number }[], candles: Candle[], side: Side, days: number, now: number): { count: number; cost: number } {
  let count = 0
  let cost = 0
  for (const l of levels) {
    if (reach(candles, side, l.price, days, now).hits === 0) {
      count++
      cost += l.cost
    }
  }
  return { count, cost }
}
