import { describe, expect, it } from 'vitest'
import { Kraken, sign } from './kraken'
import type { LadderLevel } from '../shared/ladder'

describe('sign', () => {
  // Beispiel aus der Kraken-Doku (Authentifizierung)
  it('stimmt mit dem offiziellen Beispiel überein', () => {
    const secret = 'kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg=='
    const body = 'nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25'
    expect(sign('/0/private/AddOrder', '1616492376594', body, secret)).toBe(
      '4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==',
    )
  })
})

const levels = (n: number): LadderLevel[] => Array.from({ length: n }, (_, i) => ({ index: i, price: 100 - i, volume: 0.1, cost: 10, share: 1 / n }))

function fakeHttp(reply: (url: string, body: any) => any) {
  const calls: { url: string; body: any; headers: any }[] = []
  const http = async (url: string, init?: any) => {
    const body = init?.body?.startsWith('{') ? JSON.parse(init.body) : init?.body
    calls.push({ url, body, headers: init?.headers })
    return { json: async () => reply(url, body) }
  }
  return { http, calls }
}

describe('placeLadder', () => {
  it('teilt 32 Stufen in Pakete zu 15, 15 und 2 und setzt validate und userref', async () => {
    const { http, calls } = fakeHttp((_u, b) => ({ error: [], result: { orders: b.orders.map((_: any, i: number) => ({ txid: `T${i}` })) } }))
    const k = new Kraken({ key: 'k', secret: Buffer.from('s').toString('base64') }, http, async () => {})
    const res = await k.placeLadder('XXBTZEUR', 'buy', levels(32), { validate: true, userref: 42 })
    expect(calls.map((c) => c.body.orders.length)).toEqual([15, 15, 2])
    expect(calls[0].body.validate).toBe(true)
    expect(calls[0].body.orders[0]).toMatchObject({ ordertype: 'limit', type: 'buy', price: '100', volume: '0.1', userref: 42 })
    expect(calls[0].headers['API-Sign']).toBeTruthy()
    expect(res).toHaveLength(32)
    expect(res.every((r) => r.txid && !r.error)).toBe(true)
  })

  it('bricht nach einem abgelehnten Paket ab und meldet den Rest', async () => {
    const { http, calls } = fakeHttp(() => ({ error: ['EOrder:Insufficient funds'] }))
    const k = new Kraken({ key: 'k', secret: 'cw==' }, http, async () => {})
    const res = await k.placeLadder('XXBTZEUR', 'buy', levels(20), { validate: false, userref: 1 })
    expect(calls).toHaveLength(1)
    expect(res).toHaveLength(20)
    expect(res[0].error).toBe('Nicht genug Guthaben.')
    expect(res[19].error).toMatch(/Nicht gesendet/)
  })

  it('schickt eine einzelne Order über AddOrder', async () => {
    const { http, calls } = fakeHttp(() => ({ error: [], result: { txid: ['ABC'] } }))
    const k = new Kraken({ key: 'k', secret: 'cw==' }, http, async () => {})
    const res = await k.placeLadder('XXBTZEUR', 'sell', levels(1), { validate: false, userref: 1 })
    expect(calls[0].url).toMatch(/AddOrder$/)
    expect(res[0].txid).toBe('ABC')
  })

  it('ohne Schlüssel gibt es eine klare Meldung', async () => {
    const k = new Kraken(null)
    await expect(k.balances()).rejects.toThrow('Kein API-Schlüssel')
  })
})

describe('neue Abfragen', () => {
  it('ohlc liefert Zeit und Schlusskurs', async () => {
    const { http } = fakeHttp(() => ({ error: [], result: { XXBTZEUR: [[1700000000, '1', '2', '0.5', '1.5', '1.2', '10', 5]], last: 1 } }))
    expect(await new Kraken(null, http).ohlc('XXBTZEUR', 1440)).toEqual([[1700000000, 1.5]])
  })
  it('available zieht gebundenes Guthaben ab', async () => {
    const { http } = fakeHttp(() => ({ error: [], result: { ZEUR: { balance: '100.5', hold_trade: '40.5' } } }))
    expect(await new Kraken({ key: 'k', secret: 'cw==' }, http).available()).toEqual({ ZEUR: 60 })
  })
  it('fees liest Maker und Taker', async () => {
    const { http, calls } = fakeHttp(() => ({ error: [], result: { fees: { XXBTZEUR: { fee: '0.40' } }, fees_maker: { XXBTZEUR: { fee: '0.25' } } } }))
    expect(await new Kraken({ key: 'k', secret: 'cw==' }, http).fees('XXBTZEUR')).toEqual({ maker: 0.25, taker: 0.4 })
    expect(calls[0].body).toContain('pair=XXBTZEUR')
  })
  it('closedOrders filtert nach userref und liest den Ausführungspreis', async () => {
    const { http, calls } = fakeHttp(() => ({ error: [], result: { closed: { T1: { status: 'closed', vol: '1', vol_exec: '1', cost: '90', fee: '0.2', price: '90', userref: 7, descr: { type: 'buy', price: '90' } } } } }))
    const r = await new Kraken({ key: 'k', secret: 'cw==' }, http).closedOrders(7)
    expect(calls[0].body).toContain('userref=7')
    expect(r[0]).toMatchObject({ txid: 'T1', status: 'closed', filled: 1, cost: 90, price: 90, userref: 7 })
  })
})
