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
    expect((await api.plans()).length).toBe(2) // nur die Beispielpläne
    const r = await api.send({ pairId: pair.id, pairName: pair.name, side: 'buy', input, levels, validate: false, postOnly: true, sendCount: 2 })
    expect(r.orders.every((o) => o.txid?.startsWith('DEMO-'))).toBe(true)
    expect((await api.openOrders()).filter((o) => o.userref === r.userref)).toHaveLength(2)
    await api.sendRest(r.userref, false)
    expect((await api.openOrders()).filter((o) => o.userref === r.userref)).toHaveLength(5)
    expect(await api.cancelPlan(r.userref)).toBe(5)
    await expect(api.saveKey('a', 'b')).rejects.toThrow(/Demo/)
  })

  it('Beispielplan mit Zonen: Zone 3 ist entschärft, die Bedingung erfüllt, scharf schalten sendet sie', async () => {
    const api = createDemoApi()
    const plan = (await api.plans()).find((p) => p.input.zones)!
    const st = (await api.planStatus()).find((s) => s.userref === plan.userref)!
    expect(st.zones![1].filledShare).toBeGreaterThan(0.5)
    expect(plan.input.zones![2].armed).toBe(false)
    const before = (await api.openOrders()).filter((o) => o.userref === plan.userref).length
    await api.armZone(plan.userref, 2, false)
    expect((await api.openOrders()).filter((o) => o.userref === plan.userref)).toHaveLength(before + 3)
    expect((await api.plans()).find((p) => p.userref === plan.userref)!.input.zones![2].armed).toBe(true)
    await expect(api.armZone(plan.userref, 2, false)).rejects.toThrow(/schon scharf/)
  })

  it('Kursverlauf endet beim Beispielkurs', async () => {
    const api = createDemoApi()
    const c = await api.ohlc('XXBTZEUR', 240)
    expect(c).toHaveLength(720)
    expect(c[719][1]).toBeCloseTo(80000, 0)
  })
})

describe('Entwürfe im Demo-Modus', () => {
  it('Freigabe sendet den Entwurf und markiert ihn als freigegeben', async () => {
    const api = createDemoApi()
    const d = (await api.drafts()).find((x) => x.status === 'draft')!
    const pair = (await api.pairs()).find((p) => p.id === d.pairId)!
    const { levels } = buildLadder(d.input, pair)
    const r = await api.send({ pairId: pair.id, pairName: pair.name, side: d.side, input: d.input, levels, validate: false, postOnly: d.postOnly, draftId: d.id })
    const after = (await api.drafts()).find((x) => x.id === d.id)!
    expect(after.status).toBe('released')
    expect(after.userref).toBe(r.userref)
    expect(await api.prices([d.pairId])).toEqual({ [d.pairId]: 80000 })
  })
})
