import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { Bitvavo, OPERATOR_ID, signBitvavo } from './bitvavo'
import { refFromClientId } from './exchange'
import type { LadderLevel } from '../shared/ladder'

const levels = (n: number): LadderLevel[] => Array.from({ length: n }, (_, i) => ({ index: i, price: 100 - i, volume: 0.1, cost: 10, share: 1 / n }))

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
const creds = { key: 'k'.repeat(64), secret: 's'.repeat(128) }
const noPause = async () => {}

describe('Bitvavo Signatur', () => {
  it('signiert Zeitstempel + Methode + /v2-Pfad mit Abfrage + Inhalt', () => {
    const expected = createHmac('sha256', 'geheim').update('1700000000000GET/v2/order?market=BTC-EUR').digest('hex')
    expect(signBitvavo('1700000000000', 'GET', '/order?market=BTC-EUR', '', 'geheim')).toBe(expected)
  })
  it('schickt die Kopfzeilen mit', async () => {
    const { http, calls } = fakeHttp(() => ({ body: [] }))
    await new Bitvavo(creds, http, noPause, () => 1700000000000).balances()
    expect(calls[0].headers['Bitvavo-Access-Key']).toBe(creds.key)
    expect(calls[0].headers['Bitvavo-Access-Timestamp']).toBe('1700000000000')
    expect(calls[0].headers['Bitvavo-Access-Signature']).toBe(signBitvavo('1700000000000', 'GET', '/balance', '', creds.secret))
  })
})

describe('Bitvavo Paare', () => {
  it('nimmt nur handelbare EUR-Märkte und liest Preisschritt und Nachkommastellen', async () => {
    const { http } = fakeHttp(() => ({
      body: [
        { market: 'BTC-EUR', status: 'trading', base: 'BTC', quote: 'EUR', minOrderInBaseAsset: '0.0001', minOrderInQuoteAsset: '5', quantityDecimals: 8, tickSize: '1', orderTypes: ['market', 'limit'] },
        { market: 'ETH-EUR', status: 'halted', base: 'ETH', quote: 'EUR', tickSize: '0.01' },
        { market: 'BTC-USDC', status: 'trading', base: 'BTC', quote: 'USDC', tickSize: '0.01' },
        { market: 'ADA-EUR', status: 'trading', base: 'ADA', quote: 'EUR', minOrderInBaseAsset: '1', minOrderInQuoteAsset: '5', quantityDecimals: 2, tickSize: '0.00001' },
      ],
    }))
    const p = await new Bitvavo(null, http).pairs()
    expect(p.map((x) => x.id)).toEqual(['ADA-EUR', 'BTC-EUR'])
    expect(p[1]).toMatchObject({ name: 'BTC/EUR', base: 'BTC', quote: 'EUR', priceDecimals: 0, tickSize: 1, volumeDecimals: 8, orderMin: 0.0001, costMin: 5 })
    expect(p[0]).toMatchObject({ priceDecimals: 5, volumeDecimals: 2 })
  })
})

describe('Bitvavo Orders', () => {
  it('legt Stufen einzeln an, mit operatorId, postOnly und der Plan-Nummer in clientOrderId', async () => {
    let n = 0
    const { http, calls } = fakeHttp(() => ({ body: { orderId: `id-${n++}`, status: 'new' } }))
    const res = await new Bitvavo(creds, http, noPause).placeLadder('BTC-EUR', 'buy', levels(3), { validate: false, userref: 123456, postOnly: true })
    expect(calls).toHaveLength(3)
    expect(calls[0].body).toMatchObject({ market: 'BTC-EUR', side: 'buy', orderType: 'limit', amount: '0.1', price: '100', postOnly: true, operatorId: OPERATOR_ID })
    expect(refFromClientId(calls[2].body.clientOrderId)).toBe(123456)
    expect(calls[0].body.clientOrderId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(res.map((r) => r.txid)).toEqual(['BTC-EUR|id-0', 'BTC-EUR|id-1', 'BTC-EUR|id-2'])
  })

  it('meldet abgelehnte Orders verständlich und macht mit den übrigen weiter', async () => {
    let n = 0
    const { http } = fakeHttp(() => (n++ === 1 ? { status: 400, body: { errorCode: 216, error: 'Insufficient balance' } } : { body: { orderId: `id-${n}` } }))
    const res = await new Bitvavo(creds, http, noPause).placeLadder('BTC-EUR', 'buy', levels(3), { validate: false, userref: 1 })
    expect(res[1].error).toBe('Nicht genug Guthaben.')
    expect(res[0].txid).toBeTruthy()
    expect(res[2].txid).toBeTruthy()
  })

  it('erkennt eine sofort stornierte Post-only-Order', async () => {
    const { http } = fakeHttp(() => ({ body: { orderId: 'x', status: 'canceled', restatementReason: 'cancelPostOnly' } }))
    const res = await new Bitvavo(creds, http, noPause).placeLadder('BTC-EUR', 'buy', levels(1), { validate: false, userref: 1, postOnly: true })
    expect(res[0].txid).toBeUndefined()
    expect(res[0].error).toMatch(/Post-only/)
  })

  it('klärt nach einem Verbindungsabbruch über die eigene Kennung, ob die Order angelegt wurde, und bricht dann ab', async () => {
    const { http, calls } = fakeHttp((m, url) => {
      if (m === 'POST') return 'network'
      if (url.includes('/order?')) return { body: { orderId: 'gefunden' } }
      return { body: {} }
    })
    const res = await new Bitvavo(creds, http, noPause).placeLadder('BTC-EUR', 'buy', levels(3), { validate: false, userref: 7 })
    expect(res[0].txid).toBe('BTC-EUR|gefunden')
    expect(res[1].error).toMatch(/Nicht gesendet/)
    expect(res[2].error).toMatch(/Nicht gesendet/)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    expect(calls[1].url).toContain('clientOrderId=')
  })

  it('meldet „nicht angelegt“, wenn Bitvavo die Kennung nicht kennt, und „unklar“, wenn die Nachfrage scheitert', async () => {
    const a = fakeHttp((m) => (m === 'POST' ? 'network' : { status: 404, body: { errorCode: 240, error: 'No order found' } }))
    const r1 = await new Bitvavo(creds, a.http, noPause).placeLadder('BTC-EUR', 'buy', levels(1), { validate: false, userref: 7 })
    expect(r1[0].uncertain).toBeUndefined()
    expect(r1[0].error).toMatch(/nicht angelegt/)
    const b = fakeHttp(() => 'network')
    const r2 = await new Bitvavo(creds, b.http, noPause).placeLadder('BTC-EUR', 'buy', levels(1), { validate: false, userref: 7 })
    expect(r2[0].uncertain).toBe(true)
  })

  it('Probelauf ohne Börse: prüft Regeln und das freie Guthaben für alle Stufen zusammen, sendet nichts', async () => {
    const { http, calls } = fakeHttp(() => ({ body: [{ symbol: 'EUR', available: '25', inOrder: '0' }] }))
    const rules = { id: 'BTC-EUR', name: 'BTC/EUR', base: 'BTC', quote: 'EUR', priceDecimals: 0, volumeDecimals: 8, orderMin: 0.0001, costMin: 5, tickSize: 1 }
    const res = await new Bitvavo(creds, http, noPause).placeLadder('BTC-EUR', 'buy', levels(3), { validate: true, userref: 1, rules })
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
    // 3 Stufen à rund 10 € = 29,70 € > 25 € frei
    expect(res.every((r) => r.error?.includes('freies Guthaben'))).toBe(true)
    const ok = await new Bitvavo(creds, fakeHttp(() => ({ body: [{ symbol: 'EUR', available: '500' }] })).http).placeLadder('BTC-EUR', 'buy', levels(3), { validate: true, userref: 1, rules })
    expect(ok.every((r) => !r.error)).toBe(true)
  })

  it('offene Orders tragen die Plan-Nummer, stornieren braucht Markt und operatorId', async () => {
    const uuid = '0001e240-fe70-4000-8abc-0123456789ab' // userref 123456
    const { http, calls } = fakeHttp((m) => (m === 'GET'
      ? { body: [{ orderId: 'o1', market: 'BTC-EUR', side: 'buy', price: '50000', amount: '0.001', filledAmount: '0', filledAmountQuote: '0', feePaid: '0', clientOrderId: uuid }, { orderId: 'o2', market: 'ETH-EUR', side: 'buy', price: '2000', amount: '0.01' }] }
      : { body: { orderId: 'o1' } }))
    const b = new Bitvavo(creds, http, noPause)
    const open = await b.openOrders()
    expect(open[0]).toMatchObject({ txid: 'BTC-EUR|o1', userref: 123456, price: 50000, volume: 0.001 })
    expect(open[1].userref).toBe(0)
    expect(await b.cancelPlan(123456)).toBe(1)
    const del = calls.find((c) => c.method === 'DELETE')!
    expect(del.url).toContain('market=BTC-EUR')
    expect(del.url).toContain('orderId=o1')
    expect(del.url).toContain(`operatorId=${OPERATOR_ID}`)
  })

  it('geschlossene Orders je Markt, nur abgeschlossene, mit Durchschnittspreis', async () => {
    const { http, calls } = fakeHttp(() => ({
      body: [
        { orderId: 'a', market: 'BTC-EUR', status: 'filled', side: 'buy', amount: '0.002', price: '50000', filledAmount: '0.002', filledAmountQuote: '99', feePaid: '0.2', clientOrderId: '00000005-fe70-4001-8000-000000000000', created: 1 },
        { orderId: 'b', market: 'BTC-EUR', status: 'new', side: 'buy', amount: '0.002', price: '49000', created: 2 },
        { orderId: 'c', market: 'BTC-EUR', status: 'canceled', side: 'buy', amount: '0.002', price: '48000', filledAmount: '0', filledAmountQuote: '0', created: 3 },
      ],
    }))
    const r = await new Bitvavo(creds, http).closedOrdersSince(1000, 10, ['BTC-EUR', 'BTC-EUR'])
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('start=1000000')
    expect(r.map((o) => o.status)).toEqual(['closed', 'canceled'])
    expect(r[0]).toMatchObject({ userref: 5, price: 49500, filled: 0.002, cost: 99 })
  })
})

describe('Bitvavo Rechte', () => {
  const reply = (opts: { view?: boolean; trade?: boolean }) => (m: string): Reply => {
    if (m === 'GET') return opts.view === false ? { status: 403, body: { errorCode: 311, error: 'no view' } } : { body: [] }
    return opts.trade === false ? { status: 403, body: { errorCode: 310, error: 'no trade' } } : { status: 404, body: { errorCode: 240, error: 'No order found' } }
  }
  it('alles grün nur mit Ansehen, Handeln und bestätigtem „keine Auszahlung“', async () => {
    const c = await new Bitvavo(creds, fakeHttp(reply({})).http).checkPermissions({ noWithdrawConfirmed: true })
    expect(c.map((x) => [x.id, x.ok])).toEqual([['view', true], ['trade', true], ['withdraw', true]])
  })
  it('ohne Bestätigung wird nicht gespeichert, fehlendes Handelsrecht wird erkannt', async () => {
    const c = await new Bitvavo(creds, fakeHttp(reply({ trade: false })).http).checkPermissions()
    expect(c.find((x) => x.id === 'trade')!.ok).toBe(false)
    expect(c.find((x) => x.id === 'withdraw')!.ok).toBe(false)
  })
  it('falscher Schlüssel bricht mit klarer Meldung ab', async () => {
    const { http } = fakeHttp(() => ({ status: 403, body: { errorCode: 309, error: 'Invalid signature' } }))
    await expect(new Bitvavo(creds, http).checkPermissions()).rejects.toThrow(/geheime Schlüssel passt nicht/)
  })
  it('die Prüfung legt nie eine Order an', async () => {
    const { http, calls } = fakeHttp(reply({}))
    await new Bitvavo(creds, http).checkPermissions({ noWithdrawConfirmed: true })
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})
