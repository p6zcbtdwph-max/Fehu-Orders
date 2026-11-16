import { describe, expect, it } from 'vitest'
import { groupOpenOrders } from './order-groups'

const o = (txid: string, pair: string, side: 'buy' | 'sell', price: number, volume: number, filled = 0, userref = 0) => ({ txid, pair, side, price, volume, filled, userref })

describe('Offene Orders je Paar zusammenfassen', () => {
  it('fasst gleiche Paare und Richtungen zusammen, Kauf und Verkauf bleiben getrennt', () => {
    const g = groupOpenOrders([o('A', 'XBTEUR', 'buy', 70000, 0.001), o('B', 'XBTEUR', 'buy', 66000, 0.002), o('C', 'XBTEUR', 'sell', 90000, 0.001), o('D', 'ETHEUR', 'buy', 2000, 0.1)])
    expect(g.map((x) => [x.key, x.orders.length])).toEqual([['XBTEUR|buy', 2], ['ETHEUR|buy', 1], ['XBTEUR|sell', 1]])
  })
  it('rechnet Summe, Ø Preis nach Menge und Gegenwert der offenen Menge', () => {
    const [g] = groupOpenOrders([o('A', 'XBTEUR', 'buy', 70000, 0.001), o('B', 'XBTEUR', 'buy', 66000, 0.003, 0.001)])
    expect(g.open).toBeCloseTo(0.003)
    expect(g.filled).toBeCloseTo(0.001)
    expect(g.openValue).toBeCloseTo(70 + 132)
    expect(g.averagePrice).toBeCloseTo(202 / 0.003)
    expect([g.highPrice, g.lowPrice]).toEqual([70000, 66000])
    expect(g.orders.map((x) => x.txid)).toEqual(['A', 'B'])
  })
  it('zählt die Pläne der App, Orders ohne Plan-Nummer nicht', () => {
    const [g] = groupOpenOrders([o('A', 'X', 'buy', 1, 1, 0, 7), o('B', 'X', 'buy', 2, 1, 0, 7), o('C', 'X', 'buy', 3, 1, 0, 9), o('D', 'X', 'buy', 4, 1)])
    expect(g.plans).toEqual([7, 9])
  })
  it('leere Liste ergibt keine Gruppen', () => {
    expect(groupOpenOrders([])).toEqual([])
  })
})
