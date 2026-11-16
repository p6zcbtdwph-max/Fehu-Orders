import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', async () => (await import('./test-electron')).electronMock)
import { call } from './test-electron'
import * as store from './store'

// Kraken-Attrappe: keine offenen Orders, geschlossene seitenweise wie bei Kraken (neueste zuerst)
let closed: Record<string, any> = {}
let closedCalls = 0
vi.stubGlobal('fetch', async (url: string, init: any) => {
  const ep = url.split('/').pop()!.split('?')[0]
  let result: any = {}
  if (ep === 'OpenOrders') result = { open: {} }
  if (ep === 'ClosedOrders') {
    closedCalls++
    const p = new URLSearchParams(init.body)
    const ofs = Number(p.get('ofs') ?? 0)
    const all = Object.entries(closed)
    result = { closed: Object.fromEntries(all.slice(ofs, ofs + 50)), count: all.length }
  }
  return { status: 200, text: async () => JSON.stringify({ error: [], result }) }
})
await import('./index')

const fill = (userref: number) => ({ status: 'closed', vol: '0.001', vol_exec: '0.001', cost: '60', fee: '0.1', price: '60000', descr: { type: 'buy', price: '60000' }, userref })

describe('Status der Pläne', () => {
  it('liefert Status für alle Pläne der letzten 90 Tage, auch mehr als 20', async () => {
    store.saveCredentials({ key: 'k', secret: 's' })
    const now = Date.now()
    for (let i = 1; i <= 25; i++) store.addPlan({ userref: i, createdAt: new Date(now - (26 - i) * 3600_000).toISOString(), pairId: 'XXBTZEUR', pairName: 'BTC/EUR', side: 'buy', input: {} as any, sent: 1, failed: 0, totalCost: 10 })
    closed = { 'OFILL-1': fill(1) }
    const r = await call('plans:status')
    expect(r.value).toHaveLength(25)
    expect(r.value.find((s: any) => s.userref === 1).filled).toBe(1)
  })
  it('findet Ausführungen auch hinter mehr als 500 stornierten Orders', { timeout: 120_000 }, async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 30_000) // Zwischenspeicher (20 s) umgehen
    const all: Record<string, any> = {}
    for (let i = 0; i < 520; i++) all[`OCANC-${i}`] = { status: 'canceled', vol: '0.001', vol_exec: '0', cost: '0', fee: '0', price: '0', descr: { type: 'buy', price: '50000' }, userref: 25 }
    all['OFILL-20'] = fill(20)
    all['OFILL-1'] = fill(1)
    closed = all
    // Neuer Schlüssel = alles neu laden (vollständig, nicht nur 10 Seiten)
    await call('key:clear')
    store.saveCredentials({ key: 'k', secret: 's' })
    // Die Pausen zwischen den Seiten (6 s) im Schnelldurchlauf
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    let r: any
    const p = call('plans:status').then((x: any) => (r = x))
    while (!r) await vi.advanceTimersByTimeAsync(6000)
    await p
    vi.useRealTimers()
    expect(r.ok).toBe(true)
    expect(r.value.find((s: any) => s.userref === 20).filled).toBe(1)
  })
  it('lädt danach nur noch neue geschlossene Orders', { timeout: 30_000 }, async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 600_000)
    closedCalls = 0
    closed = { 'OFILL-NEU': fill(3) }
    const r = await call('plans:status')
    vi.useRealTimers()
    expect(closedCalls).toBe(1)
    expect(r.value.find((s: any) => s.userref === 3).filled).toBe(1)
    expect(r.value.find((s: any) => s.userref === 20).filled).toBe(1) // aus dem Zwischenspeicher
  })
  it('hält Ausführungen mit Zeitpunkt im Ausführungsbuch fest, fremde Orders nicht', () => {
    const book = store.getFillBook('kraken')
    expect(book.orders.some((o) => o.txid === 'OFILL-NEU' && o.userref === 3)).toBe(true)
    expect(book.orders.some((o) => o.txid === 'OFILL-1')).toBe(true)
    expect(Number.isFinite(book.fetchedAt) && book.fetchedAt > 0).toBe(true)
  })
  it('zeigt Pläne älter als 90 Tage weiter an, wenn das Buch ihre Ausführungen kennt', { timeout: 30_000 }, async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 1_200_000)
    store.addPlan({ userref: 900, createdAt: new Date(Date.now() - 200 * 86_400_000).toISOString(), pairId: 'XXBTZEUR', pairName: 'BTC/EUR', side: 'buy', input: {} as any, sent: 1, failed: 0, totalCost: 60 })
    closed = { 'OALT-1': { ...fill(900), closetm: 1_700_000_000 }, 'OFREMD-1': { ...fill(0), userref: 0 } }
    await call('key:clear')
    store.saveCredentials({ key: 'k', secret: 's' })
    vi.setSystemTime(Date.now() + 30_000)
    await call('plans:status')
    vi.setSystemTime(Date.now() + 30_000)
    const r = await call('plans:status')
    vi.useRealTimers()
    const old = r.value.find((s: any) => s.userref === 900)
    expect(old?.filled).toBe(1)
    expect(old?.lastFillAt).toBe(1_700_000_000)
    expect(store.getFillBook('kraken').orders.some((o) => o.txid === 'OFREMD-1')).toBe(false)
  })
})
