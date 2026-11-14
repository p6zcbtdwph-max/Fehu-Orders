import { describe, it, expect } from 'vitest'
import { sendSummary } from './components/SendSuccess'

const o = (i: number, extra: Record<string, unknown> = {}) => ({ index: i, price: 100 - i, volume: 0.5, txid: `T${i}`, ...extra })

describe('Rückmeldung nach dem Senden', () => {
  it('alles angelegt und nachgeprüft', () => {
    const s = sendSummary({ userref: 1, validate: false, orders: [o(0), o(1), o(2)], check: { found: 3, placed: 3 } })
    expect(s).toMatchObject({ state: 'ok', placed: 3, total: 3, checkOk: true, from: 100, to: 98 })
    expect(s.cost).toBeCloseTo(50 + 49.5 + 49)
  })

  it('teilweise: eine abgelehnt, eine unklar', () => {
    const s = sendSummary({ userref: 1, validate: false, orders: [o(0), o(1, { txid: undefined, error: 'Nicht genug Guthaben.' }), o(2, { txid: undefined, uncertain: true, error: 'x' })] })
    expect(s).toMatchObject({ state: 'partial', placed: 1, uncertain: 1, checkOk: false })
    expect(s.failed.map((f) => f.error)).toEqual(['Nicht genug Guthaben.'])
  })

  it('nichts angelegt', () => {
    expect(sendSummary({ userref: 1, validate: false, orders: [o(0, { txid: undefined, error: 'x' })] }).state).toBe('none')
  })

  it('angelegt, aber nicht alle in den offenen Orders gefunden', () => {
    const s = sendSummary({ userref: 1, validate: false, orders: [o(0), o(1)], check: { found: 1, placed: 2 } })
    expect(s).toMatchObject({ state: 'ok', checkOk: false })
  })
})
