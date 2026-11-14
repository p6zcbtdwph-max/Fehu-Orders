import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, verify } from 'node:crypto'
import { Coinbase, coinbaseJwt } from './coinbase'
import type { LadderLevel } from '../shared/ladder'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const pem = privateKey.export({ type: 'sec1', format: 'pem' }).toString()
const creds = { key: 'organizations/org-1/apiKeys/key-1', secret: pem }
const levels = (n: number): LadderLevel[] => Array.from({ length: n }, (_, i) => ({ index: i, price: 100 - i, volume: 0.1, cost: 10, share: 1 / n }))
const noPause = async () => {}

type Reply = { status?: number; body: unknown } | 'network'
function fakeHttp(reply: (method: string, url: string, body: any) => Reply) {
  const calls: { method: string; url: string; body: any; headers: any }[] = []
  const http = async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ method: init?.method ?? 'GET', url, body, headers: init?.headers })
    const r = reply(init?.method ?? 'GET', url, body)
    if (r === 'network') throw new TypeError('fetch failed')
    return { status: r.status ?? 200, text: async () => JSON.stringify(r.body) }
  }
  return { http, calls }
}
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString())

describe('Coinbase JWT', () => {
  it('hat die verlangten Felder und eine gültige ES256-Signatur', () => {
    const jwt = coinbaseJwt(creds.key, pem, 'GET', '/api/v3/brokerage/accounts', 1_700_000_000_000, 'abc')
    const [h, p, s] = jwt.split('.')
    expect(decode(h)).toEqual({ alg: 'ES256', kid: creds.key, nonce: 'abc', typ: 'JWT' })
    expect(decode(p)).toEqual({ sub: creds.key, iss: 'cdp', nbf: 1_700_000_000, exp: 1_700_000_120, uri: 'GET api.coinbase.com/api/v3/brokerage/accounts' })
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true)
  })
  it('meldet einen unlesbaren privaten Schlüssel verständlich', () => {
    expect(() => coinbaseJwt(creds.key, 'kaputt', 'GET', '/x')).toThrow(/BEGIN EC PRIVATE KEY/)
  })
  it('signiert jede private Anfrage ohne Abfrage-Teil im uri', async () => {
    const { http, calls } = fakeHttp(() => ({ body: { accounts: [], has_next: false } }))
    await new Coinbase(creds, http).balances()
    const jwt = calls[0].headers.Authorization.replace('Bearer ', '')
    expect(decode(jwt.split('.')[1]).uri).toBe('GET api.coinbase.com/api/v3/brokerage/accounts')
    expect(calls[0].url).toContain('limit=250')
  })
})

describe('Coinbase Paare und Kurse', () => {
  it('nimmt nur handelbare EUR-Spot-Paare, ohne Schlüssel', async () => {
    const { http, calls } = fakeHttp(() => ({
      body: {
        products: [
          { product_id: 'BTC-EUR', base_currency_id: 'BTC', quote_currency_id: 'EUR', base_display_symbol: 'BTC', quote_display_symbol: 'EUR', status: 'online', price_increment: '0.01', base_increment: '0.00000001', base_min_size: '0.00000001', quote_min_size: '1', product_type: 'SPOT' },
          { product_id: 'ETH-EUR', base_currency_id: 'ETH', quote_currency_id: 'EUR', status: 'online', trading_disabled: true, price_increment: '0.01', base_increment: '0.0001' },
          { product_id: 'BTC-USD', base_currency_id: 'BTC', quote_currency_id: 'USD', status: 'online', price_increment: '0.01', base_increment: '0.00000001' },
        ],
      },
    }))
    const p = await new Coinbase(null, http).pairs()
    expect(calls[0].headers.Authorization).toBeUndefined()
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ id: 'BTC-EUR', name: 'BTC/EUR', base: 'BTC', quote: 'EUR', priceDecimals: 2, tickSize: 0.01, volumeDecimals: 8, costMin: 1 })
  })
  it('holt mehrere Kurse mit einer Anfrage', async () => {
    const { http, calls } = fakeHttp(() => ({ body: { products: [{ product_id: 'BTC-EUR', price: '80000' }, { product_id: 'ETH-EUR', price: '3000' }] } }))
    expect(await new Coinbase(null, http).lastPrices(['BTC-EUR', 'ETH-EUR'])).toEqual({ 'BTC-EUR': 80000, 'ETH-EUR': 3000 })
    expect(calls[0].url).toContain('product_ids=BTC-EUR&product_ids=ETH-EUR')
  })
})

describe('Coinbase Orders', () => {
  it('legt Limit-Orders mit Plan-Nummer in client_order_id an', async () => {
    let n = 0
    const { http, calls } = fakeHttp(() => ({ body: { success: true, success_response: { order_id: `o${n++}` } } }))
    const res = await new Coinbase(creds, http, noPause).placeLadder('BTC-EUR', 'buy', levels(2), { validate: false, userref: 4242, postOnly: true })
    expect(calls[0].body).toMatchObject({ product_id: 'BTC-EUR', side: 'BUY', order_configuration: { limit_limit_gtc: { base_size: '0.1', limit_price: '100', post_only: true } } })
    expect(calls[0].body.client_order_id).toMatch(/^fehu-4242-0-/)
    expect(calls[1].body.client_order_id).toMatch(/^fehu-4242-1-/)
    expect(res.map((r) => r.txid)).toEqual(['o0', 'o1'])
  })
  it('übersetzt Ablehnungen', async () => {
    const { http } = fakeHttp(() => ({ body: { success: false, error_response: { error: 'INSUFFICIENT_FUND', new_order_failure_reason: 'INSUFFICIENT_FUND' } } }))
    const res = await new Coinbase(creds, http, noPause).placeLadder('BTC-EUR', 'buy', levels(2), { validate: false, userref: 1 })
    expect(res[0].error).toBe('Nicht genug Guthaben.')
  })
  it('wiederholt nach einem Verbindungsabbruch einmal mit derselben client_order_id (keine doppelte Order)', async () => {
    let n = 0
    const { http, calls } = fakeHttp(() => (n++ === 0 ? 'network' : { body: { success: true, success_response: { order_id: 'same' } } }))
    const res = await new Coinbase(creds, http, noPause).placeLadder('BTC-EUR', 'buy', levels(1), { validate: false, userref: 1 })
    expect(calls).toHaveLength(2)
    expect(calls[0].body.client_order_id).toBe(calls[1].body.client_order_id)
    expect(res[0].txid).toBe('same')
  })
  it('bleibt die Verbindung weg, gilt die Order als unklar und der Rest wird nicht gesendet', async () => {
    const { http } = fakeHttp(() => 'network')
    const res = await new Coinbase(creds, http, noPause).placeLadder('BTC-EUR', 'buy', levels(3), { validate: false, userref: 1 })
    expect(res[0].uncertain).toBe(true)
    expect(res[2].error).toMatch(/Nicht gesendet/)
  })
  it('Probelauf über die Vorschau von Coinbase, legt nichts an', async () => {
    const rules = { id: 'BTC-EUR', name: 'BTC/EUR', base: 'BTC', quote: 'EUR', priceDecimals: 2, volumeDecimals: 8, orderMin: 0, costMin: 1, tickSize: 0.01 }
    const { http, calls } = fakeHttp((_m, url) => {
      if (url.includes('/accounts')) return { body: { accounts: [{ currency: 'EUR', available_balance: { value: '1000' }, hold: { value: '0' } }], has_next: false } }
      if (url.includes('/orders/preview')) return { body: { errs: calls.filter((c) => c.url.includes('preview')).length === 2 ? ['PREVIEW_INVALID_LIMIT_PRICE_POST_ONLY'] : [] } }
      return { body: {} }
    })
    const res = await new Coinbase(creds, http, noPause).placeLadder('BTC-EUR', 'buy', levels(2), { validate: true, userref: 1, postOnly: true, rules })
    expect(calls.some((c) => c.url.endsWith('/orders'))).toBe(false)
    expect(res[0].error).toBeUndefined()
    expect(res[1].error).toMatch(/Post-only/)
  })
  it('storniert einen Plan über batch_cancel und liest offene Orders', async () => {
    const { http, calls } = fakeHttp((_m, url) => {
      if (url.includes('historical')) return { body: { orders: [
        { order_id: 'a', product_id: 'BTC-EUR', side: 'BUY', client_order_id: 'fehu-77-0-abc', order_configuration: { limit_limit_gtc: { base_size: '0.001', limit_price: '50000' } }, filled_size: '0', filled_value: '0', total_fees: '0' },
        { order_id: 'b', product_id: 'BTC-EUR', side: 'BUY', client_order_id: 'fremd', order_configuration: { limit_limit_gtc: { base_size: '0.001', limit_price: '49000' } } },
      ], has_next: false } }
      return { body: { results: [{ order_id: 'a', success: true }] } }
    })
    const c = new Coinbase(creds, http, noPause)
    const open = await c.openOrders()
    expect(open[0]).toMatchObject({ txid: 'a', side: 'buy', price: 50000, volume: 0.001, userref: 77 })
    expect(open[1].userref).toBe(0)
    expect(calls[0].url).toContain('order_status=OPEN')
    expect(await c.cancelPlan(77)).toBe(1)
    expect(calls.at(-1)!.body).toEqual({ order_ids: ['a'] })
  })
})

describe('Coinbase Rechte', () => {
  it('liest View, Trade und Transfer direkt bei Coinbase', async () => {
    const ok = await new Coinbase(creds, fakeHttp(() => ({ body: { can_view: true, can_trade: true, can_transfer: false } })).http).checkPermissions()
    expect(ok.every((c) => c.ok)).toBe(true)
    const bad = await new Coinbase(creds, fakeHttp(() => ({ body: { can_view: true, can_trade: true, can_transfer: true } })).http).checkPermissions()
    expect(bad.find((c) => c.id === 'withdraw')!.ok).toBe(false)
  })
  it('abgelehnter Schlüssel: klare Meldung', async () => {
    await expect(new Coinbase(creds, fakeHttp(() => ({ status: 401, body: {} })).http).checkPermissions()).rejects.toThrow(/ECDSA/)
  })
})
