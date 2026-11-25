import { describe, expect, it } from 'vitest'
import { DAY, type Candle } from './history'
import { FIB_FLOOR, WEEK, floorZone, lastSwing, retraceOf, retracePrice, toWeekly } from './fib'

const now = 1_795_600_000 // 25.11.2026
const wk = (weeksAgo: number, low: number, high: number, close = (low + high) / 2): Candle => ({ t: now - weeksAgo * WEEK, low, high, close })

// Grob der BTC-Verlauf in Euro (Kraken-Wochenkerzen): Tief Nov. 2022, Hoch Okt. 2025, heute rund 54.000 €
const btc: Candle[] = [
  wk(260, 2775, 5000), // Dez. 2018: liegt mehr als 3 Jahre vor dem Hoch, zählt nicht
  wk(210, 15105, 16346), // Nov. 2022
  wk(150, 25000, 30000),
  wk(60, 100730, 107420), // Okt. 2025
  wk(30, 70000, 80000),
  wk(1, 50344, 58970, 54237),
]

describe('Fibonacci-Bodenzone', () => {
  it('rechnet Rückgang und Preis hin und zurück', () => {
    const s = { low: 100, high: 200 }
    expect(retracePrice(s, 0.5)).toBe(150)
    expect(retraceOf(s, 150)).toBe(0.5)
    expect(FIB_FLOOR).toEqual([0.786, 0.887])
  })

  it('findet den letzten großen Anstieg: Hoch der letzten 3 Jahre, Tief in den 3 Jahren davor', () => {
    const s = lastSwing(btc, now)!
    expect(s.high).toBe(107420)
    expect(s.low).toBe(15105)
  })

  it('BTC heute: Zone 34.860 € bis 25.537 €, Kurs noch darüber', () => {
    const z = floorZone(btc, now, 54237)!
    expect(z.upper).toBeCloseTo(107420 - 0.786 * (107420 - 15105), 6)
    expect(Math.round(z.upper)).toBe(34860)
    expect(Math.round(z.lower)).toBe(25537)
    expect(z.position).toBe('above')
    expect(z.deepest).toBe(50344)
    expect(z.deepestRatio).toBeCloseTo(0.618, 3)
  })

  it('meldet in und unter der Zone', () => {
    expect(floorZone(btc, now, 30000)!.position).toBe('inside')
    expect(floorZone(btc, now, 20000)!.position).toBe('below')
  })

  it('ohne Anstieg oder ohne Kerzen gibt es keine Zone', () => {
    expect(floorZone([], now)).toBeNull()
    // Kurs fällt nur: das Hoch ist die erste Kerze, davor gibt es kein Tief
    expect(floorZone([wk(10, 90, 100), wk(5, 50, 60)], now)).toBeNull()
  })

  it('fasst Tageskerzen zu Wochen ab Montag zusammen', () => {
    const monday = Date.UTC(2026, 10, 23) / 1000 // Mo 23.11.2026
    const days: Candle[] = [-1, 0, 1, 6, 7].map((d, i) => ({ t: monday + d * DAY, close: 10 + i, low: 5 + i, high: 20 + i }))
    const w = toWeekly(days)
    expect(w.map((x) => x.t)).toEqual([monday - WEEK, monday, monday + WEEK])
    expect(w[1]).toEqual({ t: monday, close: 13, low: 6, high: 23 })
  })
})
