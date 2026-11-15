import { describe, expect, it } from 'vitest'
import { DAY, reach, toCandles, unreached, windowStats } from './history'

const now = 1_800_000_000
// 100 Tageskerzen, Schlusskurs fällt von 199 auf 100, Tief 5 % darunter, Hoch 5 % darüber
const rows = Array.from({ length: 100 }, (_, i) => {
  const c = 199 - i
  return [now - (99 - i) * DAY, c, c * 0.95, c * 1.05] as [number, number, number, number]
})
const candles = toCandles(rows)

describe('Kursverlauf', () => {
  it('liest Kerzen und nimmt den Schlusskurs, wenn Tief und Hoch fehlen', () => {
    expect(toCandles([[1, 10], [0, 5, 4, 6]])).toEqual([{ t: 0, close: 5, low: 4, high: 6 }, { t: 1, close: 10, low: 10, high: 10 }])
    expect(toCandles([[1, 0], [2, NaN]])).toEqual([])
  })
  it('Tief und Hoch eines Zeitraums', () => {
    const w = windowStats(candles, 30, now)!
    expect(w.low).toBeCloseTo(95)
    expect(w.lowAt).toBe(now)
    expect(w.high).toBeCloseTo(130 * 1.05)
    expect(w.covered).toBe(30)
  })
  it('meldet, wenn weniger Tage vorhanden sind als gewünscht', () => {
    expect(windowStats(candles, 365, now)!.covered).toBe(99)
    expect(windowStats([], 30, now)).toBeNull()
  })
  it('zählt die Tage, an denen eine Kaufstufe erreicht wurde', () => {
    // Tief liegt bei c·0,95: bei 114 oder darunter für c ≤ 120, also die letzten 21 Tage
    const r = reach(candles, 'buy', 114, 90, now)
    expect(r.hits).toBe(21)
    expect(r.lastAt).toBe(now)
    expect(reach(candles, 'buy', 50, 90, now)).toEqual({ hits: 0, of: 91 })
  })
  it('Verkauf zählt den Höchstkurs', () => {
    expect(reach(candles, 'sell', 400, 90, now).hits).toBe(0)
    expect(reach(candles, 'sell', 100, 30, now).hits).toBe(31)
  })
  it('fasst nie erreichte Stufen zusammen', () => {
    expect(unreached([{ price: 120, cost: 10 }, { price: 80, cost: 30 }, { price: 70, cost: 20 }], candles, 'buy', 90, now)).toEqual({ count: 2, cost: 50 })
  })
})
