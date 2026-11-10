import { describe, expect, it } from 'vitest'
import { createDemoApi } from './demo'
import { buildLadder } from '../../shared/ladder'

describe('Demo-Modus', () => {
  it('legt Pläne nur im Speicher an, Rest senden und Stornieren funktionieren', async () => {
    const api = createDemoApi()
    const pair = (await api.pairs()).find((p) => p.name === 'SOL/EUR')!
    const input = { side: 'buy' as const, priceStart: 145, priceEnd: 120, steps: 5, total: 100, spacing: 'linear' as const, curve: 'flat' as const, ratio: 3 }
    const { levels } = buildLadder(input, pair)
    const probe = await api.send({ pairId: pair.id, pairName: pair.name, side: 'buy', input, levels, validate: true, postOnly: true })
    expect(probe.orders).toHaveLength(5)
    expect((await api.plans()).length).toBe(1) // nur der Beispielplan
    const r = await api.send({ pairId: pair.id, pairName: pair.name, side: 'buy', input, levels, validate: false, postOnly: true, sendCount: 2 })
    expect(r.orders.every((o) => o.txid?.startsWith('DEMO-'))).toBe(true)
    expect((await api.openOrders()).filter((o) => o.userref === r.userref)).toHaveLength(2)
    await api.sendRest(r.userref, false)
    expect((await api.openOrders()).filter((o) => o.userref === r.userref)).toHaveLength(5)
    expect(await api.cancelPlan(r.userref)).toBe(5)
    await expect(api.saveKey('a', 'b')).rejects.toThrow(/Demo/)
  })

  it('Kursverlauf endet beim Beispielkurs', async () => {
    const api = createDemoApi()
    const c = await api.ohlc('XXBTZEUR', 240)
    expect(c).toHaveLength(720)
    expect(c[719][1]).toBeCloseTo(80000, 0)
  })
})
