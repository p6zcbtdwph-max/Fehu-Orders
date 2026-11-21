// Entschärfte Preiszonen: werden beim Senden zurückgehalten und später scharf geschaltet (alles mit Attrappen)
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', async () => (await import('./test-electron')).electronMock)
import { call } from './test-electron'
import * as store from './store'

const posted: any[] = []
const filledIds = new Set<string>()
vi.stubGlobal('fetch', async (url: string, init: any) => {
  const method = init?.method ?? 'GET'
  const path = url.replace('https://api.bitvavo.com/v2', '').split('?')[0]
  let body: any = {}
  if (path === '/balance') body = [{ symbol: 'EUR', available: '100000', inOrder: '0' }]
  if (path === '/order' && method === 'DELETE') return { status: 404, text: async () => JSON.stringify({ errorCode: 240, error: 'No order found' }) }
  if (path === '/order' && method === 'POST') {
    posted.push(JSON.parse(init.body))
    body = { orderId: `o-${posted.length}`, status: 'new' }
  }
  if (path === '/ticker/price') body = { market: 'BTC-EUR', price: '50000' }
  if (path === '/markets') body = [{ market: 'BTC-EUR', status: 'trading', base: 'BTC', quote: 'EUR', minOrderInBaseAsset: '0.00001', minOrderInQuoteAsset: '5', quantityDecimals: 8, tickSize: '1' }]
  // Offene Orders: alle angelegten außer denen, die der Test als „schon ausgeführt“ markiert
  if (path === '/ordersOpen') body = posted.map((o, i) => ({ market: 'BTC-EUR', orderId: `o-${i + 1}`, side: o.side, price: o.price, amount: o.amount, clientOrderId: o.clientOrderId })).filter((_, i) => !filledIds.has(`o-${i + 1}`))
  return { status: 200, text: async () => JSON.stringify(body) }
})
await import('./index')


const zoned = {
  side: 'buy', priceStart: 49000, priceEnd: 40980, steps: 6, total: 120, spacing: 'linear', curve: 'flat', ratio: 1,
  zones: [
    { priceStart: 49000, priceEnd: 48980, steps: 3, share: 50 },
    { priceStart: 41000, priceEnd: 40980, steps: 3, share: 50, armed: false, trigger: { zone: 0, percent: 50 } },
  ],
}
const levels = [
  ...[49000, 48990, 48980].map((price, i) => ({ index: i, price, volume: 0.0003, cost: price * 0.0003, share: 1 / 6, zone: 0 })),
  ...[41000, 40990, 40980].map((price, i) => ({ index: 3 + i, price, volume: 0.0003, cost: price * 0.0003, share: 1 / 6, zone: 1 })),
]

describe('Entschärfte Zonen', () => {
  it('Vorbereitung: Bitvavo-Schlüssel', async () => {
    await call('settings:save', { exchange: 'bitvavo', language: 'de', maxPlanEur: 1000 })
    expect((await call('key:save', 'a'.repeat(64), 'b'.repeat(128), { noWithdrawConfirmed: true })).value.saved).toBe(true)
  })

  it('beim Senden geht nur die scharfe Zone raus, die entschärfte bleibt im Plan', async () => {
    posted.length = 0
    const r = await call('send', { pairId: 'BTC-EUR', pairName: 'BTC/EUR', side: 'buy', input: zoned, levels, validate: false, postOnly: true })
    expect(r.ok).toBe(true)
    expect(posted.map((o) => o.price)).toEqual(['49000', '48990', '48980'])
    const plan = store.getPlans()[0]
    expect(plan.levels).toHaveLength(6)
    expect(plan.sentIndices).toEqual([0, 1, 2])
  })

  it('„Rest senden“ schickt die entschärfte Zone nicht mit', async () => {
    const ref = store.getPlans()[0].userref
    const r = await call('plan:rest', ref, false)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/schon gesendet|keine gültigen|Keine gültigen/i)
  })

  it('alle Zonen entschärft: nichts wird gesendet', async () => {
    posted.length = 0
    const allHeld = { ...zoned, zones: zoned.zones.map((z) => ({ ...z, armed: false })) }
    const r = await call('send', { pairId: 'BTC-EUR', pairName: 'BTC/EUR', side: 'buy', input: allHeld, levels, validate: false, postOnly: true })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Alle Zonen sind pausiert/)
    expect(posted).toHaveLength(0)
  })

  it('Zone aktivieren: Test ändert nichts, echtes Senden schickt die Zone mit derselben Plan-Nummer', async () => {
    const ref = store.getPlans()[0].userref
    posted.length = 0
    const probe = await call('plan:zone', ref, 1, true)
    expect(probe.ok).toBe(true)
    expect(store.getPlans()[0].input.zones![1].armed).toBe(false)
    posted.length = 0
    const r = await call('plan:zone', ref, 1, false)
    expect(r.ok).toBe(true)
    expect(r.value.userref).toBe(ref)
    expect(posted.map((o) => o.price)).toEqual(['41000', '40990', '40980'])
    const plan = store.getPlans()[0]
    expect(plan.input.zones![1].armed).toBe(true)
    expect(plan.sentIndices).toEqual([0, 1, 2, 3, 4, 5])
    // ein zweites Mal geht nicht
    expect((await call('plan:zone', ref, 1, false)).ok).toBe(false)
  })

  it('bearbeitete Zone: neue Stufen ersetzen die alten, bekommen neue Nummern und gehen geprüft raus', async () => {
    posted.length = 0
    await call('send', { pairId: 'BTC-EUR', pairName: 'BTC/EUR', side: 'buy', input: zoned, levels, validate: false, postOnly: true })
    const ref = store.getPlans()[0].userref
    posted.length = 0
    // zu kleine Stufe: nichts geht raus
    const bad = await call('plan:zone', ref, 1, false, [{ index: 0, price: 42000, volume: 0.00001, cost: 0.42, share: 1 }])
    expect(bad.ok).toBe(false)
    expect(posted).toHaveLength(0)
    const r = await call('plan:zone', ref, 1, false, [
      { index: 0, price: 42000.4, volume: 0.0005, cost: 21, share: 0.5 },
      { index: 1, price: 41500, volume: 0.0005, cost: 20.75, share: 0.5 },
    ])
    expect(r.ok).toBe(true)
    expect(posted.map((o) => o.price)).toEqual(['42000', '41500'])
    const plan = store.getPlans()[0]
    expect(plan.levels!.map((l) => l.index)).toEqual([0, 1, 2, 6, 7])
    expect(plan.levels!.filter((l) => l.zone === 1).map((l) => l.price)).toEqual([42000, 41500])
    expect(plan.input.zones![1]).toMatchObject({ armed: true, priceStart: 42000, priceEnd: 41500, steps: 2 })
  })

  it('Zone über der Obergrenze: nichts wird gesendet', async () => {
    await call('settings:save', { maxPlanEur: 50 })
    posted.length = 0
    await call('send', { pairId: 'BTC-EUR', pairName: 'BTC/EUR', side: 'buy', input: { ...zoned, zones: [zoned.zones[0], { ...zoned.zones[1] }] }, levels: [levels[0], ...levels.slice(3)], validate: false, postOnly: true })
    const ref = store.getPlans()[0].userref
    posted.length = 0
    const r = await call('plan:zone', ref, 1, false, [{ index: 0, price: 41000, volume: 0.002, cost: 82, share: 1 }])
    expect(r.ok).toBe(false)
    expect(posted).toHaveLength(0)
  })
})
