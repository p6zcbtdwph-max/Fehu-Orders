// Haltefrist: Der Hauptprozess liefert Ausführungen mit Datum aus dem Ausführungsbuch plus selbst eingetragene Käufe.
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', async () => (await import('./test-electron')).electronMock)
import { call } from './test-electron'
import * as store from './store'
vi.stubGlobal('fetch', async () => ({ status: 200, text: async () => JSON.stringify({ error: [], result: {} }) }))
await import('./index')

const order = (txid: string, userref: number, side: 'buy' | 'sell', filled: number, closedAt?: number) =>
  ({ txid, status: 'closed', side, volume: filled, filled, cost: 0, fee: 0, price: 0, limitPrice: 0, userref, ...(closedAt ? { closedAt } : {}) })

describe('Haltefrist: bekannte Käufe und Verkäufe', () => {
  it('nimmt nur Ausführungen der eigenen Pläne mit Datum, dazu eingetragene Käufe der aktiven Börse', async () => {
    await call('settings:save', { exchange: 'kraken', language: 'de' })
    const base = { exchange: 'kraken' as const, createdAt: '2025-01-01T00:00:00Z', pairId: 'XXBTZEUR', input: {} as any, sent: 1, failed: 0, totalCost: 0 }
    store.addPlan({ ...base, userref: 11, pairName: 'BTC/EUR', side: 'buy' })
    store.addPlan({ ...base, userref: 12, pairName: 'ETH/EUR', pairId: 'XETHZEUR', side: 'sell' })
    store.saveFillBook('kraken', { orders: [order('A', 11, 'buy', 0.01, 1735732800), order('B', 12, 'sell', 0.2, 1740000000), order('C', 11, 'buy', 0.5), order('D', 99, 'buy', 1, 1740000000), order('E', 11, 'buy', 0, 1740000000)], coveredFrom: 0, fetchedAt: 0, pairs: [] })
    const saved = await call('settings:save', { manualLots: [
      { id: 'm1', exchange: 'kraken', coin: 'sol', volume: 3, date: '2024-04-01' },
      { id: 'm2', exchange: 'bitvavo', coin: 'BTC', volume: 1, date: '2024-04-01' },
      { id: 'm3', exchange: 'kraken', coin: 'BTC', volume: 1, date: 'kaputt' },
    ] })
    expect(saved.value.manualLots.map((l: any) => l.id)).toEqual(['m1', 'm2'])
    const r = await call('tax:events')
    expect(r.ok).toBe(true)
    expect(r.value).toEqual([
      { coin: 'BTC', side: 'buy', volume: 0.01, at: 1735732800, source: 'app' },
      { coin: 'ETH', side: 'sell', volume: 0.2, at: 1740000000, source: 'app' },
      { coin: 'SOL', side: 'buy', volume: 3, at: expect.any(Number), source: 'manual' },
    ])
  })
})
