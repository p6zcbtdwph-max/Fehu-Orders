// Fibonacci-Bodenzone als Orientierung im Kursbild: Nach einem großen Anstieg (Tief → Hoch) bilden
// Kryptowährungen laut Elliott-Wellen-Lesart ihren Boden oft zwischen 78,60 % und 88,70 % Rückgang
// des Anstiegs. Reine Rechnung ohne Netz, damit sie testbar ist.
// Wichtig: Das ist ein Blick zurück, keine Vorhersage. Die App legt dafür nie selbst Orders an.
import { DAY, type Candle } from './history'

/** Die beiden Rückgangs-Stufen der Bodenzone (Anteil des Anstiegs) */
export const FIB_FLOOR = [0.786, 0.887] as const

export const WEEK = 7 * DAY
/** So weit schaut die App zurück: das Hoch der letzten 3 Jahre, das Tief in den 3 Jahren davor */
export const SWING_YEARS = 3

/** Fasst Kerzen (z. B. Tageskerzen) zu Wochenkerzen zusammen. Wochen beginnen am Montag (UTC). */
export function toWeekly(candles: Candle[]): Candle[] {
  const out: Candle[] = []
  // 1.1.1970 war ein Donnerstag: +3 Tage verschiebt den Wochenbeginn auf Montag
  const weekOf = (t: number) => Math.floor((t + 3 * DAY) / WEEK) * WEEK - 3 * DAY
  for (const c of [...candles].sort((a, b) => a.t - b.t)) {
    const t = weekOf(c.t)
    const w = out[out.length - 1]
    if (w && w.t === t) {
      w.close = c.close
      w.low = Math.min(w.low, c.low)
      w.high = Math.max(w.high, c.high)
    } else out.push({ t, close: c.close, low: c.low, high: c.high })
  }
  return out
}

export interface Swing {
  /** Tief vor dem Anstieg und wann (Sekunden) */
  low: number
  lowAt: number
  /** Hoch am Ende des Anstiegs */
  high: number
  highAt: number
}

/**
 * Der letzte große Anstieg: das höchste Hoch der letzten `years` Jahre und das tiefste Tief
 * in den `years` Jahren davor. null, wenn es dafür zu wenig Kerzen gibt oder der Kurs nicht gestiegen ist.
 */
export function lastSwing(candles: Candle[], now: number, years = SWING_YEARS): Swing | null {
  const span = years * 365 * DAY
  let hi: Candle | null = null
  for (const c of candles) if (c.t >= now - span && (!hi || c.high > hi.high)) hi = c
  if (!hi) return null
  let lo: Candle | null = null
  for (const c of candles) if (c.t < hi.t && c.t >= hi.t - span && (!lo || c.low < lo.low)) lo = c
  if (!lo || !(lo.low > 0) || lo.low >= hi.high) return null
  return { low: lo.low, lowAt: lo.t, high: hi.high, highAt: hi.t }
}

/** Preis nach einem Rückgang um `ratio` (0–1) des Anstiegs */
export const retracePrice = (s: Pick<Swing, 'low' | 'high'>, ratio: number): number => s.high - ratio * (s.high - s.low)

/** Wie viel des Anstiegs ein Preis schon zurückgegeben hat (0 = am Hoch, 1 = am Tief) */
export const retraceOf = (s: Pick<Swing, 'low' | 'high'>, price: number): number => (s.high - price) / (s.high - s.low)

export interface FloorZone extends Swing {
  /** Obere Linie (78,60 %) und untere Linie (88,70 %) */
  upper: number
  lower: number
  /** Tiefster Kurs seit dem Hoch und wie tief das in Prozent des Anstiegs war */
  deepest: number
  deepestAt: number
  deepestRatio: number
  /** Wo der Kurs heute steht: über, in oder unter der Zone */
  position: 'above' | 'inside' | 'below'
}

/** Bodenzone für den letzten großen Anstieg. `last` ist der aktuelle Kurs (sonst der letzte Schlusskurs). */
export function floorZone(candles: Candle[], now: number, last?: number | null, years = SWING_YEARS): FloorZone | null {
  const s = lastSwing(candles, now, years)
  if (!s) return null
  return zoneFor(s, candles, last)
}

/** Bodenzone für einen selbst gewählten Anstieg (Tief und Hoch von Hand) */
export function zoneFor(s: Swing, candles: Candle[], last?: number | null): FloorZone {
  const upper = retracePrice(s, FIB_FLOOR[0])
  const lower = retracePrice(s, FIB_FLOOR[1])
  let deepest = s.high
  let deepestAt = s.highAt
  for (const c of candles) if (c.t > s.highAt && c.low < deepest) { deepest = c.low; deepestAt = c.t }
  const now = last && last > 0 ? last : candles[candles.length - 1]?.close ?? s.high
  const position = now > upper ? 'above' : now < lower ? 'below' : 'inside'
  return { ...s, upper, lower, deepest, deepestAt, deepestRatio: retraceOf(s, deepest), position }
}
