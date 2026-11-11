import { describe, expect, it } from 'vitest'
import { Kraken, plain, sign } from './kraken'
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
    const r = reply(url, body)
    return { status: 200, text: async () => (typeof r === 'string' ? r : JSON.stringify(r)) }
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

describe('Verbindung', () => {
  it('schickt gleichzeitige private Anfragen nacheinander mit steigendem Zeitstempel', async () => {
    let active = 0
    let maxActive = 0
    const nonces: number[] = []
    const http = async (_url: string, init?: any) => {
      active++
      maxActive = Math.max(maxActive, active)
      nonces.push(Number(new URLSearchParams(init.body).get('nonce')))
      await new Promise((r) => setTimeout(r, 5))
      active--
      return { status: 200, text: async () => JSON.stringify({ error: [], result: {} }) }
    }
    const k = new Kraken({ key: 'k', secret: 'cw==' }, http, async () => {})
    await Promise.all([k.balances(), k.openOrders(), k.available(), k.balances()])
    expect(maxActive).toBe(1)
    expect(nonces).toEqual([...nonces].sort((a, b) => a - b))
    expect(new Set(nonces).size).toBe(4)
  })

  it('meldet Wartungsseiten (HTML) verständlich', async () => {
    const http = async () => ({ status: 503, text: async () => '<html>maintenance</html>' })
    await expect(new Kraken(null, http).lastPrice('XXBTZEUR')).rejects.toThrow(/Wartung \(Fehler 503\)/)
  })

  it('meldet fehlendes Netz verständlich', async () => {
    const http = async () => { throw new TypeError('fetch failed') }
    await expect(new Kraken(null, http).lastPrice('XXBTZEUR')).rejects.toThrow(/Keine Verbindung zu Kraken/)
  })

  it('wiederholt reine Abfragen, wenn Kraken bremst', async () => {
    let n = 0
    const pauses: number[] = []
    const { http, calls } = fakeHttp(() => (++n < 3 ? { error: ['EAPI:Rate limit exceeded'] } : { error: [], result: { ZEUR: '5' } }))
    const k = new Kraken({ key: 'k', secret: 'cw==' }, http, async (ms) => { pauses.push(ms) })
    expect(await k.balances()).toEqual({ ZEUR: 5 })
    expect(calls).toHaveLength(3)
    expect(pauses).toEqual([3000, 6000])
  })

  it('wiederholt Orders nie automatisch', async () => {
    const { http, calls } = fakeHttp(() => ({ error: ['EAPI:Rate limit exceeded'] }))
    const k = new Kraken({ key: 'k', secret: 'cw==' }, http, async () => {})
    const res = await k.placeLadder('XXBTZEUR', 'buy', levels(3), { validate: false, userref: 1 })
    expect(calls).toHaveLength(1)
    expect(res.every((r) => r.error && !r.txid)).toBe(true)
  })
})

describe('Verbindungsabbruch beim Senden', () => {
  it('sucht danach die angelegten Orders über userref, Preis und Menge', async () => {
    const http = async (url: string, init?: any) => {
      if (url.endsWith('AddOrderBatch')) throw new TypeError('socket hang up')
      const r = url.endsWith('OpenOrders')
        ? { open: { TX1: { descr: { pair: 'XBTEUR', type: 'buy', price: '100' }, vol: '0.1', vol_exec: '0', userref: 9 } } }
        : { closed: { TX2: { status: 'closed', descr: { type: 'buy', price: '99' }, vol: '0.1', vol_exec: '0.1', cost: '9.9', fee: '0', price: '99', userref: 9 } } }
      expect(init.body).toContain('userref=9')
      return { status: 200, text: async () => JSON.stringify({ error: [], result: r }) }
    }
    const k = new Kraken({ key: 'k', secret: 'cw==' }, http, async () => {})
    const res = await k.placeLadder('XXBTZEUR', 'buy', levels(3), { validate: false, userref: 9 })
    expect(res.map((r) => r.txid)).toEqual(['TX1', 'TX2', undefined])
    expect(res[2].error).toMatch(/nicht angelegt/)
    expect(res.some((r) => r.uncertain)).toBe(false)
  })

  it('markiert Orders als unklar, wenn auch das Nachsehen scheitert', async () => {
    const http = async () => { throw new TypeError('fetch failed') }
    const k = new Kraken({ key: 'k', secret: 'cw==' }, http, async () => {})
    const res = await k.placeLadder('XXBTZEUR', 'buy', levels(17), { validate: false, userref: 9 })
    expect(res.slice(0, 15).every((r) => r.uncertain)).toBe(true)
    expect(res[16].error).toMatch(/Nicht gesendet/)
    expect(res[16].uncertain).toBeUndefined()
  })

  it('setzt beim echten Senden eine Frist (deadline), beim Probelauf nicht', async () => {
    const { http, calls } = fakeHttp((_u, b) => ({ error: [], result: { orders: b.orders.map(() => ({ txid: 'T' })) } }))
    const k = new Kraken({ key: 'k', secret: 'cw==' }, http, async () => {})
    await k.placeLadder('XXBTZEUR', 'buy', levels(2), { validate: false, userref: 1 })
    await k.placeLadder('XXBTZEUR', 'buy', levels(2), { validate: true, userref: 1 })
    expect(Date.parse(calls[0].body.deadline)).toBeGreaterThan(Date.now())
    expect(calls[1].body.deadline).toBeUndefined()
  })
})

describe('plain', () => {
  it('schreibt sehr kleine Zahlen ohne Exponent', () => {
    expect(plain(5e-7)).toBe('0.0000005')
    expect(plain(0.30000000000000004)).toBe('0.3')
    expect(plain(100)).toBe('100')
  })
})

describe('closedOrdersSince', () => {
  it('holt alle Seiten', async () => {
    const page = (from: number, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`T${from + i}`, { status: 'closed', descr: { type: 'buy', price: '1' }, vol: '1', vol_exec: '1', cost: '1', fee: '0', price: '1', userref: 1 }]))
    const { http, calls } = fakeHttp((_u, b) => {
      const ofs = Number(new URLSearchParams(b).get('ofs'))
      return { error: [], result: { closed: page(ofs, ofs === 0 ? 50 : 20), count: 70 } }
    })
    const r = await new Kraken({ key: 'k', secret: 'cw==' }, http).closedOrdersSince(1700000000)
    expect(r).toHaveLength(70)
    expect(calls).toHaveLength(2)
    expect(calls[0].body).toContain('start=1700000000')
  })
})

describe('checkPermissions', () => {
  const reply = (denied: string[], withdrawAllowed = false) => (url: string) => {
    const ep = url.split('/').pop()!
    if (ep === 'WithdrawMethods') return withdrawAllowed ? { error: [], result: [] } : { error: ['EGeneral:Permission denied'] }
    if (denied.includes(ep)) return { error: ['EGeneral:Permission denied'] }
    if (ep === 'CancelOrder') return { error: ['EOrder:Unknown order'] }
    return { error: [], result: {} }
  }
  it('alles richtig eingestellt', async () => {
    const { http } = fakeHttp(reply([]))
    const r = await new Kraken({ key: 'k', secret: 'cw==' }, http).checkPermissions()
    expect(r.every((c) => c.ok)).toBe(true)
  })
  it('erkennt fehlendes Order-Recht und erlaubte Auszahlungen', async () => {
    const { http } = fakeHttp(reply(['AddOrder'], true))
    const r = await new Kraken({ key: 'k', secret: 'cw==' }, http).checkPermissions()
    expect(r.find((c) => c.id === 'create')?.ok).toBe(false)
    expect(r.find((c) => c.id === 'withdraw')?.ok).toBe(false)
    expect(r.find((c) => c.id === 'cancel')?.ok).toBe(true)
  })
  it('ein falscher Schlüssel bricht sofort ab', async () => {
    const { http, calls } = fakeHttp(() => ({ error: ['EAPI:Invalid key'] }))
    await expect(new Kraken({ key: 'k', secret: 'cw==' }, http).checkPermissions()).rejects.toThrow(/ungültig/)
    expect(calls).toHaveLength(1)
  })
})

describe('Runde 2', () => {
  it('liest den Preisschritt (tick_size) aus AssetPairs', async () => {
    const { http } = fakeHttp(() => ({ error: [], result: { XXBTZEUR: { status: 'online', wsname: 'XBT/EUR', base: 'XXBT', quote: 'ZEUR', pair_decimals: 1, lot_decimals: 8, ordermin: '0.00005', costmin: '0.5', tick_size: '0.5' } } }))
    const [p] = await new Kraken(null, http).pairs()
    expect(p).toMatchObject({ name: 'BTC/EUR', tickSize: 0.5, priceDecimals: 1 })
  })
  it('Notbremse ruft CancelAll und liefert die Anzahl', async () => {
    const { http, calls } = fakeHttp(() => ({ error: [], result: { count: 4 } }))
    expect(await new Kraken({ key: 'k', secret: 'cw==' }, http).cancelAll()).toBe(4)
    expect(calls[0].url).toMatch(/private\/CancelAll$/)
  })
  it('Systemstatus', async () => {
    const { http } = fakeHttp(() => ({ error: [], result: { status: 'maintenance', timestamp: 'x' } }))
    expect(await new Kraken(null, http).systemStatus()).toBe('maintenance')
  })
})
