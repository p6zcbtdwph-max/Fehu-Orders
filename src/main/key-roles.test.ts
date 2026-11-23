// Zwei Schlüssel je Börse: Nur-Lese-Schlüssel für alles Anzeigen, Handels-Schlüssel nur zum Senden,
// und der Notfall-Knopf, der alle Schlüssel aus der App löscht. Kraken ist hier eine Attrappe,
// die je nach Schlüssel (API-Key im Kopf der Anfrage) Rechte gewährt oder verweigert.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('electron', async () => (await import('./test-electron')).electronMock)
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { call, dir } from './test-electron'
import * as store from './store'

const READ = { key: 'R'.repeat(56), secret: Buffer.alloc(64, 1).toString('base64') }
const TRADE = { key: 'T'.repeat(56), secret: Buffer.alloc(64, 2).toString('base64') }
/** Schlüssel, der alles darf, auch handeln (falsch als Nur-Lese-Schlüssel) */
const BOTH = { key: 'B'.repeat(56), secret: Buffer.alloc(64, 3).toString('base64') }
/** Schlüssel mit Auszahlungsrecht */
const WITHDRAW = { key: 'W'.repeat(56), secret: Buffer.alloc(64, 4).toString('base64') }

/** Welcher Schlüssel welche Anfrage geschickt hat, z. B. "R:Balance" */
const hits: string[] = []
const RIGHTS: Record<string, Set<string>> = {
  R: new Set(['Balance', 'BalanceEx', 'OpenOrders', 'ClosedOrders', 'CancelOrder', 'CancelAll']),
  T: new Set(['Balance', 'BalanceEx', 'OpenOrders', 'ClosedOrders', 'AddOrder', 'AddOrderBatch', 'CancelOrder', 'CancelAll']),
  B: new Set(['Balance', 'BalanceEx', 'OpenOrders', 'ClosedOrders', 'AddOrder', 'AddOrderBatch', 'CancelOrder', 'CancelAll']),
  W: new Set(['Balance', 'BalanceEx', 'OpenOrders', 'ClosedOrders', 'AddOrder', 'AddOrderBatch', 'CancelOrder', 'CancelAll', 'WithdrawMethods']),
}
const ok = (result: unknown) => ({ status: 200, text: async () => JSON.stringify({ error: [], result }) })
vi.stubGlobal('fetch', async (url: string, init: any) => {
  const ep = url.split('/').pop()!.split('?')[0]
  if (url.includes('/public/')) {
    if (ep === 'AssetPairs') return ok({ XXBTZEUR: { status: 'online', wsname: 'XBT/EUR', base: 'XXBT', quote: 'ZEUR', pair_decimals: 1, lot_decimals: 8, ordermin: '0.00005', costmin: '0.5', tick_size: '0.1' } })
    if (ep === 'Ticker') return ok({ XXBTZEUR: { c: ['50000'] } })
    return ok({})
  }
  const who = String(init?.headers?.['API-Key'] ?? '?')[0]
  hits.push(`${who}:${ep}`)
  if (!RIGHTS[who]?.has(ep)) return { status: 200, text: async () => JSON.stringify({ error: ['EGeneral:Permission denied'] }) }
  if (ep === 'AddOrder') return ok({ descr: {} })
  if (ep === 'AddOrderBatch') {
    const n = new URLSearchParams(init.body).getAll('orders').length || 2
    return ok({ orders: Array.from({ length: n }, (_, i) => ({ txid: `TX-${hits.length}-${i}` })) })
  }
  if (ep === 'CancelOrder') return { status: 200, text: async () => JSON.stringify({ error: ['EOrder:Unknown order'] }) }
  if (ep === 'CancelAll') return ok({ count: 3 })
  if (ep === 'OpenOrders') return ok({ open: {} })
  if (ep === 'ClosedOrders') return ok({ closed: {}, count: 0 })
  if (ep === 'Balance') return ok({ ZEUR: '1000' })
  if (ep === 'BalanceEx') return ok({ ZEUR: { balance: '1000', hold_trade: '0' } })
  return ok({})
})
await import('./index')

const lv = (n: number, price: number, volume: number) => Array.from({ length: n }, (_, i) => ({ index: i, price: price - i, volume, cost: (price - i) * volume, share: 1 / n }))
const send = (validate = false) => call('send', { pairId: 'XXBTZEUR', pairName: 'BTC/EUR', side: 'buy', input: {} as any, levels: lv(2, 49000, 0.0004), validate, postOnly: true })
const save = (c: { key: string; secret: string }, role?: 'read' | 'trade') => call('key:save', c.key, c.secret, { exchange: 'kraken', ...(role ? { role } : {}) })

beforeEach(async () => {
  hits.length = 0
})

describe('Nur-Lese-Schlüssel und Handels-Schlüssel', () => {
  it('ein Nur-Lese-Schlüssel wird gespeichert, wenn er ansehen und stornieren, aber nicht handeln darf', async () => {
    await call('settings:save', { exchange: 'kraken', language: 'de' })
    const r = await save(READ, 'read')
    expect(r.value.saved).toBe(true)
    expect(r.value.checks.find((c: any) => c.id === 'no-trade')).toMatchObject({ ok: true, required: true })
    expect(r.value.checks.find((c: any) => c.id === 'cancel')).toMatchObject({ ok: true, required: false })
    expect(store.loadCredentials('kraken', 'read')).toEqual(READ)
    expect(store.loadCredentials('kraken', 'trade')).toBeNull()
    expect(existsSync(join(dir, 'kraken-read-key.bin'))).toBe(true)
    const st = (await call('key:status')).value
    expect(st.roles.kraken).toEqual({ read: true, trade: false, tradeTemporary: false })
    expect(st.keys.kraken).toBe(true)
  })

  it('ein Schlüssel mit Handelsrecht wird nicht als Nur-Lese-Schlüssel gespeichert', async () => {
    const r = await save(BOTH, 'read')
    expect(r.value.saved).toBe(false)
    expect(r.value.checks.find((c: any) => c.id === 'no-trade')).toMatchObject({ ok: false })
    expect(store.loadCredentials('kraken', 'read')).toEqual(READ)
  })

  it('ein Schlüssel mit Auszahlungsrecht wird nie gespeichert, egal als was', async () => {
    expect((await save(WITHDRAW, 'read')).value.saved).toBe(false)
    expect((await save(WITHDRAW, 'trade')).value.saved).toBe(false)
    expect(store.loadCredentials('kraken', 'trade')).toBeNull()
  })

  it('Anzeigen läuft über den Nur-Lese-Schlüssel', async () => {
    const r = await call('balances')
    expect(r.ok).toBe(true)
    expect(hits).toEqual(['R:Balance'])
  })

  it('ohne Handels-Schlüssel wird nichts gesendet, auch nicht getestet (Kraken testet mit Handelsrecht)', async () => {
    const r = await send()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/kein Handels-Schlüssel/)
    const t = await send(true)
    expect(t.ok).toBe(false)
    expect(hits.some((h) => h.includes('AddOrder'))).toBe(false)
  })

  it('die Notbremse geht bei Kraken auch nur mit dem Nur-Lese-Schlüssel (Recht zum Stornieren)', async () => {
    const r = await call('orders:cancelAll')
    expect(r.ok).toBe(true)
    expect(hits).toEqual(['R:CancelAll'])
  })

  it('derselbe Schlüssel kann nicht beides sein', async () => {
    const r = await save(READ, 'trade')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/derselbe Schlüssel/)
  })

  it('mit Handels-Schlüssel: Senden über den Handels-Schlüssel, Anzeigen weiter über den Nur-Lese-Schlüssel', async () => {
    expect((await save(TRADE, 'trade')).value.saved).toBe(true)
    hits.length = 0
    const r = await send()
    expect(r.ok).toBe(true)
    expect(hits.filter((h) => h.includes('AddOrder'))).toEqual(['T:AddOrderBatch'])
    // Nachkontrolle (offene Orders) ist Lesen
    expect(hits).toContain('R:OpenOrders')
    expect(hits.some((h) => h.startsWith('T:') && !h.includes('AddOrder'))).toBe(false)
  })

  it('ohne Rolle (ältere Aufrufe) ist der Handels-Schlüssel gemeint, die alte Datei bleibt gültig', async () => {
    expect(existsSync(join(dir, 'kraken-key.bin'))).toBe(true)
    expect(store.loadCredentials('kraken')).toEqual(TRADE)
  })
})

describe('Wie lange der Handels-Schlüssel bleibt', () => {
  it('„Bis die App schließt“: vorhandener Handels-Schlüssel verschwindet von der Festplatte und bleibt nur im Arbeitsspeicher', async () => {
    await call('settings:save', { tradeKeyMode: 'session' })
    expect(existsSync(join(dir, 'kraken-key.bin'))).toBe(false)
    expect(store.loadCredentials('kraken', 'trade')).toEqual(TRADE)
    expect((await call('key:status')).value.roles.kraken).toEqual({ read: true, trade: true, tradeTemporary: true })
    // Ein neu eingefügter Handels-Schlüssel kommt ebenfalls nicht auf die Festplatte
    await call('key:clear', 'kraken', 'trade')
    expect((await save(TRADE, 'trade')).value.saved).toBe(true)
    expect(existsSync(join(dir, 'kraken-key.bin'))).toBe(false)
    expect(store.tradeKeyInMemory('kraken')).toBe(true)
  })

  it('„Nur für eine Sendung“: nach dem echten Senden ist der Handels-Schlüssel weg, der Nur-Lese-Schlüssel bleibt', async () => {
    await call('settings:save', { tradeKeyMode: 'once' })
    // Testen lässt den Schlüssel da
    const t = await send(true)
    expect(t.ok).toBe(true)
    expect(t.value.tradeKeyForgotten).toBeUndefined()
    expect(store.loadCredentials('kraken', 'trade')).toEqual(TRADE)
    const r = await send()
    expect(r.ok).toBe(true)
    expect(r.value.tradeKeyForgotten).toBe(true)
    expect(store.loadCredentials('kraken', 'trade')).toBeNull()
    expect(store.loadCredentials('kraken', 'read')).toEqual(READ)
    const again = await send()
    expect(again.ok).toBe(false)
    expect(store.getLog().some((l) => /nach dem Senden vergessen/.test(l.message ?? ''))).toBe(true)
  })

  it('unbekannter Modus wird ignoriert', async () => {
    await call('settings:save', { tradeKeyMode: 'forever' })
    expect(store.getSettings().tradeKeyMode).toBe('once')
  })
})

describe('Notfall: alle Schlüssel löschen', () => {
  it('löscht alle Schlüssel aller Börsen (Dateien und Arbeitsspeicher) und sagt, welche es waren', async () => {
    await call('settings:save', { tradeKeyMode: 'session' })
    expect((await save(TRADE, 'trade')).value.saved).toBe(true)
    store.saveCredentials({ key: 'a'.repeat(64), secret: 'b'.repeat(128) }, 'bitvavo', 'trade')
    const r = await call('key:clearAll')
    expect(r.ok).toBe(true)
    expect(r.value.deleted).toEqual([{ exchange: 'kraken', roles: ['read', 'trade'] }, { exchange: 'bitvavo', roles: ['trade'] }])
    expect(r.value.cancelled).toBeUndefined()
    for (const ex of ['kraken', 'bitvavo', 'coinbase'] as const) {
      expect(store.loadCredentials(ex, 'read')).toBeNull()
      expect(store.loadCredentials(ex, 'trade')).toBeNull()
    }
    for (const f of ['kraken-key.bin', 'kraken-read-key.bin', 'bitvavo-key.bin']) expect(existsSync(join(dir, f))).toBe(false)
    expect((await call('key:status')).value.keys).toEqual({ kraken: false, bitvavo: false, coinbase: false })
    expect(store.getLog()[0]?.action).toBe('key-clear-all')
    // Danach geht nichts Privates mehr raus
    hits.length = 0
    expect((await call('balances')).ok).toBe(false)
    expect(hits).toEqual([])
  })

  it('mit „vorher Notbremse“ wird erst storniert, dann gelöscht', async () => {
    store.saveCredentials(READ, 'kraken', 'read')
    hits.length = 0
    const r = await call('key:clearAll', { cancelOrders: true })
    expect(r.value.cancelled).toBe(3)
    expect(hits).toEqual(['R:CancelAll'])
    expect(store.loadCredentials('kraken', 'read')).toBeNull()
  })

  it('ohne Schlüssel passiert nichts Schlimmes', async () => {
    const r = await call('key:clearAll', { cancelOrders: true })
    expect(r.ok).toBe(true)
    expect(r.value.deleted).toEqual([])
  })
})
