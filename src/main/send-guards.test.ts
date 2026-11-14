// Sicherungen im Hauptprozess direkt vor dem Senden (alles mit Attrappen, nichts geht ins Netz)
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', async () => (await import('./test-electron')).electronMock)
import { call } from './test-electron'
import * as store from './store'

const posted: any[] = []
let orderDelay = 0
const filledIds = new Set<string>()
vi.stubGlobal('fetch', async (url: string, init: any) => {
  const method = init?.method ?? 'GET'
  const path = url.replace('https://api.bitvavo.com/v2', '').split('?')[0]
  let body: any = {}
  if (path === '/balance') body = [{ symbol: 'EUR', available: '100000', inOrder: '0' }]
  if (path === '/order' && method === 'DELETE') return { status: 404, text: async () => JSON.stringify({ errorCode: 240, error: 'No order found' }) }
  if (path === '/order' && method === 'POST') {
    posted.push(JSON.parse(init.body))
    if (orderDelay) await new Promise((r) => setTimeout(r, orderDelay))
    body = { orderId: `o-${posted.length}`, status: 'new' }
  }
  if (path === '/ticker/price') body = { market: 'BTC-EUR', price: '50000' }
  if (path === '/markets') body = [{ market: 'BTC-EUR', status: 'trading', base: 'BTC', quote: 'EUR', minOrderInBaseAsset: '0.00001', minOrderInQuoteAsset: '5', quantityDecimals: 8, tickSize: '1' }]
  // Offene Orders: alle angelegten außer denen, die der Test als „schon ausgeführt“ markiert
  if (path === '/ordersOpen') body = posted.map((o, i) => ({ market: 'BTC-EUR', orderId: `o-${i + 1}`, side: o.side, price: o.price, amount: o.amount, clientOrderId: o.clientOrderId })).filter((_, i) => !filledIds.has(`o-${i + 1}`))
  return { status: 200, text: async () => JSON.stringify(body) }
})
await import('./index')

const lv = (n: number, price: number, volume: number) => Array.from({ length: n }, (_, i) => ({ index: i, price: price - i * 10, volume, cost: (price - i * 10) * volume, share: 1 / n }))
const send = (levels: any[], extra: Record<string, unknown> = {}) => call('send', { pairId: 'BTC-EUR', pairName: 'BTC/EUR', side: 'buy', input: {} as any, levels, validate: false, postOnly: true, ...extra })

describe('Sicherungen vor dem Senden', () => {
  it('Vorbereitung: Bitvavo-Schlüssel', async () => {
    await call('settings:save', { exchange: 'bitvavo', language: 'de', maxPlanEur: 1000 })
    const r = await call('key:save', 'a'.repeat(64), 'b'.repeat(128), { noWithdrawConfirmed: true })
    expect(r.value.saved).toBe(true)
  })

  it('ungültige Zahlen umgehen die 50-€-Grenze nicht', async () => {
    posted.length = 0
    for (const bad of [lv(2, NaN, 0.001), lv(2, 49000, NaN), [...lv(1, 49000, 0.01), { index: 1, price: 48000, volume: -0.009, cost: 0, share: 0.5 }]]) {
      const r = await send(bad)
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/ungültig/)
    }
    expect(posted).toHaveLength(0)
  })

  it('unbekanntes Paar: nichts wird gesendet (früher ging es ohne Regeln raus)', async () => {
    const r = await send(lv(2, 49000, 0.0004), { pairId: 'XXBTZEUR' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/kennt dieses Handelspaar gerade nicht/)
    expect(posted).toHaveLength(0)
  })

  it('Plan für eine andere Börse berechnet: nichts wird gesendet', async () => {
    const r = await send(lv(2, 49000, 0.0004), { exchange: 'kraken' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/für Kraken berechnet/)
    expect(posted).toHaveLength(0)
  })

  it('Stufe unter dem Mindestbetrag nach dem Runden: der ganze Plan wird nicht gesendet', async () => {
    const r = await send([...lv(1, 49000, 0.0004), { index: 1, price: 48000, volume: 0.00001, cost: 0.48, share: 0.1 }])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Stufe 2: Gegenwert unter Mindestbetrag/)
    expect(posted).toHaveLength(0)
  })

  it('Preise mit Gleitkomma-Resten gehen sauber gerundet raus (48999.99999999999 ist 49000, Kauf rundet ab)', async () => {
    const r = await send([{ index: 0, price: 48999.99999999999, volume: 0.00040000000000000002, cost: 19.6, share: 0.5 }, { index: 1, price: 48500.7, volume: 0.0004, cost: 19.4, share: 0.5 }])
    expect(r.ok).toBe(true)
    expect(posted.map((o) => [o.price, o.amount])).toEqual([['49000', '0.0004'], ['48500', '0.0004']])
    // gespeichert wird der wirklich angelegte Gegenwert
    expect(store.getPlans()[0].totalCost).toBeCloseTo(49000 * 0.0004 + 48500 * 0.0004, 6)
  })

  it('Doppelklick: die zweite Sendung startet nicht, solange die erste läuft', async () => {
    posted.length = 0
    orderDelay = 30
    const [a, b] = await Promise.all([send(lv(2, 49000, 0.0004)), send(lv(2, 49000, 0.0004))])
    orderDelay = 0
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect([a, b].find((x) => !x.ok)!.error).toMatch(/läuft gerade schon eine Sendung/)
    expect(posted).toHaveLength(2)
    // danach geht es wieder
    expect((await send(lv(1, 49000, 0.0004))).ok).toBe(true)
  })

  it('„Rest senden“ schickt nur, was noch fehlt, und nichts doppelt', async () => {
    const r = await send(lv(3, 49000, 0.0004), { sendCount: 1 })
    expect(r.ok).toBe(true)
    const userref = r.value.userref
    expect(store.getPlans().find((p) => p.userref === userref)!.sentIndices).toEqual([0])
    posted.length = 0
    const rest = await call('plan:rest', userref, false)
    expect(rest.ok).toBe(true)
    expect(posted.map((o) => o.price)).toEqual(['48990', '48980'])
    const again = await call('plan:rest', userref, false)
    expect(again.ok).toBe(false)
    expect(again.error).toMatch(/schon gesendet/)
  })

  it('nach dem Senden prüft die App nach, ob alle Orders wirklich offen bei der Börse stehen', async () => {
    posted.length = 0
    const r = await send(lv(2, 49000, 0.0004))
    expect(r.ok).toBe(true)
    expect(r.value.check).toEqual({ found: 2, placed: 2 })
    // eine Order wurde sofort ausgeführt: sie fehlt in den offenen Orders
    posted.length = 0
    filledIds.add('o-2')
    const r2 = await send(lv(2, 49000, 0.0004))
    filledIds.clear()
    expect(r2.value.check).toEqual({ found: 1, placed: 2 })
  })

  it('beim Probelauf gibt es keine Nachkontrolle', async () => {
    const r = await call('send', { pairId: 'BTC-EUR', pairName: 'BTC/EUR', side: 'buy', input: {} as any, levels: lv(2, 49000, 0.0004), validate: true, postOnly: true })
    expect(r.ok).toBe(true)
    expect(r.value.check).toBeUndefined()
  })
})
