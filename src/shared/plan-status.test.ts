import { describe, expect, it } from 'vitest'
import { planStatus, profitLadderSuggestion, type OrderSnapshot } from './plan-status'

const o = (p: Partial<OrderSnapshot>): OrderSnapshot => ({ txid: 'T', status: 'open', volume: 1, filled: 0, cost: 0, fee: 0, price: 100, ...p })

describe('planStatus', () => {
  it('zählt offen, ausgeführt, teilweise und storniert', () => {
    const s = planStatus([
      o({ txid: 'a' }),
      o({ txid: 'b', status: 'closed', filled: 1, cost: 90, fee: 0.2, price: 90 }),
      o({ txid: 'c', status: 'open', filled: 0.5, price: 80 }),
      o({ txid: 'd', status: 'canceled' }),
    ])
    expect(s).toMatchObject({ open: 2, filled: 1, partial: 1, canceled: 1, filledVolume: 1.5, filledCost: 130 })
    expect(s.averagePrice).toBeCloseTo(130 / 1.5)
    expect(s.executedTxids).toEqual(['b', 'c'])
  })
  it('ohne Ausführung ist der Durchschnitt 0', () => expect(planStatus([o({})]).averagePrice).toBe(0))
})

describe('profitLadderSuggestion', () => {
  it('schlägt 10 bis 50 % über dem Kaufpreis vor', () => {
    const p = profitLadderSuggestion(100, 2)
    expect(p.priceStart).toBeCloseTo(110)
    expect(p.priceEnd).toBeCloseTo(150)
    expect(p.total).toBe(2)
  })
})
