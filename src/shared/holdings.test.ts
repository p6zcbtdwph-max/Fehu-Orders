// Bestand beim Verkaufen: nur Coins, die man besitzt, mit freiem, gesperrtem und Earn-Bestand
import { describe, it, expect } from 'vitest'
import { holdingsFor, sellablePairs, shareOfHolding, type HoldingPair } from './holdings'

const p = (id: string, name: string, base: string, quote: string, orderMin = 0.0001): HoldingPair => ({ id, name, base, quote, orderMin, costMin: 0.5, volumeDecimals: 8 })
const pairs = [
  p('XXBTZEUR', 'BTC/EUR', 'XXBT', 'ZEUR', 0.00005),
  p('XXBTZUSD', 'BTC/USD', 'XXBT', 'ZUSD', 0.00005),
  p('SOLUSD', 'SOL/USD', 'SOL', 'ZUSD', 0.02),
  p('SOLEUR', 'SOL/EUR', 'SOL', 'ZEUR', 0.02),
  p('XETHZEUR', 'ETH/EUR', 'XETH', 'ZEUR', 0.002),
  p('ADAEUR', 'ADA/EUR', 'ADA', 'ZEUR', 5),
  p('DOTEUR', 'DOT/EUR', 'DOT', 'ZEUR', 0.5),
]

describe('holdingsFor', () => {
  const available = { ZEUR: 500, XXBT: 0.03, SOL: 10.5, XETH: 0, ADA: 0.4 }
  const balances = { ZEUR: 600, XXBT: 0.03, SOL: 12.5, XETH: 0.1, ADA: 0.4, 'DOT.S': 20, 'SOL.F': 1.5 }
  const prices = { XXBTZEUR: 80000, SOLEUR: 150, XETHZEUR: 3000, ADAEUR: 0.5, DOTEUR: 6 }
  const h = holdingsFor(pairs, available, balances, prices, 10)
  const by = Object.fromEntries(h.map((x) => [x.coin, x]))

  it('nur Coins mit Bestand, je Coin eine Zeile mit dem Euro-Paar', () => {
    expect(h.map((x) => x.coin).sort()).toEqual(['ADA', 'BTC', 'DOT', 'ETH', 'SOL'])
    expect(by.BTC.pair.name).toBe('BTC/EUR')
    expect(by.SOL.pair.name).toBe('SOL/EUR')
    expect(h.some((x) => x.coin === 'EUR')).toBe(false)
  })

  it('frei, gesperrt und Earn getrennt', () => {
    expect(by.SOL.available).toBe(10.5)
    expect(by.SOL.locked).toBeCloseTo(2, 9)
    expect(by.SOL.earn).toBe(1.5)
    expect(by.ETH.available).toBe(0)
    expect(by.ETH.locked).toBeCloseTo(0.1, 9)
    expect(by.DOT.earn).toBe(20)
  })

  it('Wert und Sortierung nach Wert', () => {
    expect(by.BTC.value).toBeCloseTo(2400, 6)
    expect(by.SOL.value).toBeCloseTo(1575, 6)
    expect(h[0].coin).toBe('BTC')
  })

  it('Staub, nur gesperrt oder nur Earn ist nicht verkaufbar', () => {
    expect(by.ADA.dust).toBe(true)
    expect(by.ETH.dust).toBe(true)
    expect(by.DOT.dust).toBe(true)
    expect(by.BTC.dust).toBe(false)
    expect(sellablePairs(pairs, h).map((x) => x.name)).toEqual(['BTC/EUR', 'BTC/USD', 'SOL/USD', 'SOL/EUR'])
  })

  it('ohne Kurs: Wert fehlt, Staub nur nach Mindestmenge', () => {
    const r = holdingsFor(pairs, { SOL: 0.01 }, {}, {})
    expect(r[0].value).toBeUndefined()
    expect(r[0].dust).toBe(true)
    expect(holdingsFor(pairs, { SOL: 1 }, {}, {})[0].dust).toBe(false)
  })
})

describe('shareOfHolding', () => {
  it('Prozent vom freien Bestand, abgerundet', () => {
    expect(shareOfHolding(10.5, 0.5, 0, 8)).toBe(5.25)
    expect(shareOfHolding(10, 0.3, 0, 8)).toBe(3)
    expect(shareOfHolding(1, 1 / 3, 0, 3)).toBe(0.333)
  })
  it('„mindestens behalten“ wird zuerst abgezogen', () => {
    expect(shareOfHolding(12.5, 1, 2, 8)).toBe(10.5)
    expect(shareOfHolding(12.5, 0.5, 2.5, 8)).toBe(5)
    expect(shareOfHolding(1, 1, 5, 8)).toBe(0)
  })
  it('nie mehr als vorhanden', () => {
    for (const free of [0.1, 0.7, 1.23456789, 3.3, 1e-8]) for (const f of [0.25, 0.5, 0.75, 1]) expect(shareOfHolding(free, f, 0, 8)).toBeLessThanOrEqual(free * f + 1e-15)
  })
})
