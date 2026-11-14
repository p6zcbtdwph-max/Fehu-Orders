import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', async () => (await import('./test-electron')).electronMock)
import { call } from './test-electron'
import * as store from './store'

// Attrappe für Kraken und Bitvavo: merkt sich, welche Börse was bekam
const hits: string[] = []
const bitvavoPrice = 50000
vi.stubGlobal('fetch', async (url: string, init: any) => {
  const method = init?.method ?? 'GET'
  if (url.startsWith('https://api.kraken.com')) {
    const ep = url.split('/').pop()!.split('?')[0]
    hits.push(`kraken:${ep}`)
    const result = ep === 'CancelAll' ? { count: 2 } : ep === 'OpenOrders' ? { open: {} } : ep === 'Ticker' ? { XXBTZEUR: { c: ['50000'] } } : {}
    return { status: 200, text: async () => JSON.stringify({ error: [], result }) }
  }
  const path = url.replace('https://api.bitvavo.com/v2', '').split('?')[0]
  hits.push(`bitvavo:${method} ${path}`)
  let body: any = {}
  if (path === '/balance') body = [{ symbol: 'EUR', available: '1000', inOrder: '0' }]
  if (path === '/order' && method === 'DELETE') return { status: 404, text: async () => JSON.stringify({ errorCode: 240, error: 'No order found' }) }
  if (path === '/order' && method === 'POST') body = { orderId: `o-${hits.length}`, status: 'new' }
  if (path === '/orders' && method === 'DELETE') body = [{ orderId: 'x' }, { orderId: 'y' }, { orderId: 'z' }]
  if (path === '/ticker/price') body = { market: 'BTC-EUR', price: String(bitvavoPrice) }
  if (path === '/markets') body = [{ market: 'BTC-EUR', status: 'trading', base: 'BTC', quote: 'EUR', minOrderInBaseAsset: '0.00001', minOrderInQuoteAsset: '5', quantityDecimals: 8, tickSize: '1' }]
  if (path === '/ordersOpen') body = []
  return { status: 200, text: async () => JSON.stringify(body) }
})
await import('./index')

const bvKey = { key: 'a'.repeat(64), secret: 'b'.repeat(128) }
const lv = (n: number, price: number, volume: number) => Array.from({ length: n }, (_, i) => ({ index: i, price: price - i, volume, cost: (price - i) * volume, share: 1 / n }))
const send = (levels: any[], validate = false) => call('send', { pairId: 'BTC-EUR', pairName: 'BTC/EUR', side: 'buy', input: {} as any, levels, validate, postOnly: true })

describe('Mehrere Börsen', () => {
  it('Bitvavo-Schlüssel wird erst gespeichert, wenn „keine Auszahlung“ bestätigt ist', async () => {
    await call('settings:save', { exchange: 'bitvavo', language: 'de' })
    const r1 = await call('key:save', bvKey.key, bvKey.secret)
    expect(r1.value.saved).toBe(false)
    expect(store.loadCredentials('bitvavo')).toBeNull()
    const r2 = await call('key:save', bvKey.key, bvKey.secret, { noWithdrawConfirmed: true })
    expect(r2.value.saved).toBe(true)
    expect(store.loadCredentials('bitvavo')).toEqual(bvKey)
    // Der Kraken-Schlüssel bleibt davon unberührt
    expect(store.loadCredentials('kraken')).toBeNull()
    const st = await call('key:status')
    expect(st.value).toMatchObject({ exchange: 'bitvavo', hasKey: true, keys: { kraken: false, bitvavo: true, coinbase: false } })
  })

  it('erster echter Test auf einer neuen Börse: höchstens 50 €, auch bei höherer Obergrenze', async () => {
    await call('settings:save', { maxPlanEur: 500 })
    const big = await send(lv(2, 49000, 0.001)) // rund 98 €
    expect(big.ok).toBe(false)
    expect(big.error).toMatch(/erste Test dort mit höchstens 50 €/)
    expect(hits.some((h) => h === 'bitvavo:POST /order')).toBe(false)
    const small = await send(lv(2, 49000, 0.0004)) // rund 39 €
    expect(small.ok).toBe(true)
    expect(small.value.orders.every((o: any) => o.txid?.startsWith('BTC-EUR|'))).toBe(true)
    const plan = store.getPlans()[0]
    expect(plan.exchange).toBe('bitvavo')
    // Danach gilt die eigene Obergrenze
    const later = await send(lv(2, 49000, 0.001))
    expect(later.ok).toBe(true)
  })

  it('Probelauf auf Bitvavo prüft nur in der App und legt nichts an', async () => {
    hits.length = 0
    const r = await send(lv(2, 49000, 0.0004), true)
    expect(r.ok).toBe(true)
    expect(r.value.orders.every((o: any) => !o.error)).toBe(true)
    expect(hits.some((h) => h.startsWith('bitvavo:POST'))).toBe(false)
  })

  it('Pläne und Entwürfe zeigen nur die gewählte Börse', async () => {
    expect((await call('plans')).value.every((p: any) => p.exchange === 'bitvavo')).toBe(true)
    await call('settings:save', { exchange: 'kraken' })
    expect((await call('plans')).value).toHaveLength(0)
    await call('draft:save', { id: 'd1', name: 'x', scenario: '', createdAt: '', updatedAt: '', pairId: 'XXBTZEUR', pairName: 'BTC/EUR', side: 'buy', input: {} as any, postOnly: true, status: 'draft' })
    expect(store.getDrafts()[0].exchange).toBe('kraken')
    await call('settings:save', { exchange: 'bitvavo' })
    expect((await call('drafts')).value).toHaveLength(0)
  })

  it('ein Kraken-Entwurf lässt sich nicht auf Bitvavo freigeben', async () => {
    const r = await call('send', { pairId: 'XXBTZEUR', pairName: 'BTC/EUR', side: 'buy', input: {} as any, levels: lv(1, 49000, 0.0004), validate: false, postOnly: true, draftId: 'd1' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/gehört zu Kraken/)
  })

  it('Notbremse storniert auf allen verbundenen Börsen', async () => {
    store.saveCredentials({ key: 'k', secret: Buffer.from('s').toString('base64') }, 'kraken')
    hits.length = 0
    const r = await call('orders:cancelAll')
    expect(r.ok).toBe(true)
    expect(r.value).toBe(5) // 2 bei Kraken + 3 bei Bitvavo
    expect(hits).toContain('kraken:CancelAll')
    expect(hits).toContain('bitvavo:DELETE /orders')
  })
})
