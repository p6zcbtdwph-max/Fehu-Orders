// Der ganze Weg bis zur Börse: Planer → letzte Prüfung → Adapter → Anfrage. Die Börsen sind hier strenge
// Attrappen, die Preise und Mengen genau so prüfen wie die echten (Nachkommastellen, Preisschritt,
// gültige Ziffern, Mindestmenge, Mindestbetrag) und jede falsche Order ablehnen. Es geht nichts ins Netz.
import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { Kraken } from './kraken'
import { Bitvavo } from './bitvavo'
import { Coinbase } from './coinbase'
import type { PairInfo } from './exchange'
import { buildLadder, prepareForSend, type LadderInput, type LadderLevel, type Side } from '../shared/ladder'
import { setLang } from '../shared/i18n'

setLang('de')

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Dezimaltext exakt als ganze Zahl in 10^-20-Einheiten */
const units = (text: string): bigint => {
  const [i, f = ''] = text.split('.')
  return BigInt(i + f.padEnd(20, '0'))
}

/** So streng wie eine echte Börse: liefert den Ablehnungsgrund oder null */
function strictCheck(price: string, volume: string, rules: PairInfo): string | null {
  if (typeof price !== 'string' || !/^\d+(\.\d+)?$/.test(price)) return `price format ${price}`
  if (typeof volume !== 'string' || !/^\d+(\.\d+)?$/.test(volume)) return `volume format ${volume}`
  const pd = price.split('.')[1]?.length ?? 0
  const vd = volume.split('.')[1]?.length ?? 0
  if (pd > rules.priceDecimals) return `price can only be specified up to ${rules.priceDecimals} decimals (${price})`
  if (vd > rules.volumeDecimals) return `volume decimals (${volume})`
  if (rules.tickSize && units(price) % units(rules.tickSize.toFixed(15)) !== 0n) return `tick size (${price})`
  if (rules.priceSignificant && price.replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length > rules.priceSignificant) return `too many significant digits (${price})`
  if (Number(volume) < rules.orderMin) return `order minimum (${volume})`
  // Mindestbetrag exakt in Dezimalarithmetik
  const cost = units(price) * units(volume)
  if (cost < units(String(rules.costMin)) * 10n ** 20n) return `cost minimum (${price} × ${volume})`
  return null
}

const PAIRS: Record<'kraken' | 'bitvavo' | 'coinbase', PairInfo[]> = {
  kraken: [
    { id: 'XXBTZEUR', name: 'BTC/EUR', base: 'XXBT', quote: 'ZEUR', priceDecimals: 1, volumeDecimals: 8, orderMin: 0.00005, costMin: 0.5, tickSize: 0.1 },
    { id: 'XETHZEUR', name: 'ETH/EUR', base: 'XETH', quote: 'ZEUR', priceDecimals: 2, volumeDecimals: 8, orderMin: 0.002, costMin: 0.5, tickSize: 0.01 },
    { id: 'XXRPZEUR', name: 'XRP/EUR', base: 'XXRP', quote: 'ZEUR', priceDecimals: 5, volumeDecimals: 8, orderMin: 2, costMin: 0.5, tickSize: 0.00001 },
  ],
  bitvavo: [
    { id: 'BTC-EUR', name: 'BTC/EUR', base: 'BTC', quote: 'EUR', priceDecimals: 0, volumeDecimals: 8, orderMin: 0.00001, costMin: 5, tickSize: 1 },
    { id: 'ETH-EUR', name: 'ETH/EUR', base: 'ETH', quote: 'EUR', priceDecimals: 2, volumeDecimals: 4, orderMin: 0.0001, costMin: 5, tickSize: 0.01 },
    { id: 'OLD-EUR', name: 'OLD/EUR', base: 'OLD', quote: 'EUR', priceDecimals: 8, volumeDecimals: 8, orderMin: 0.0001, costMin: 5, priceSignificant: 5 },
  ],
  coinbase: [
    { id: 'BTC-EUR', name: 'BTC/EUR', base: 'BTC', quote: 'EUR', priceDecimals: 2, volumeDecimals: 8, orderMin: 0.00000001, costMin: 1, tickSize: 0.01 },
    { id: 'DOGE-EUR', name: 'DOGE/EUR', base: 'DOGE', quote: 'EUR', priceDecimals: 5, volumeDecimals: 1, orderMin: 1, costMin: 1, tickSize: 0.00001 },
  ],
}

const START: Record<string, number> = { 'BTC/EUR': 76543.2, 'ETH/EUR': 2345.67, 'XRP/EUR': 0.52345, 'OLD/EUR': 123.456, 'DOGE/EUR': 0.12345 }

/** Viele zufällige Pläne je Paar, inklusive Schwerpunkt-Regler an den Rändern */
function plans(pair: PairInfo, seed: number, n: number): { side: Side; levels: LadderLevel[] }[] {
  const r = rng(seed)
  const out: { side: Side; levels: LadderLevel[] }[] = []
  const centers = [undefined, 0, 0.05, 0.5, 0.95, 1]
  while (out.length < n) {
    const side: Side = r() < 0.5 ? 'buy' : 'sell'
    const start = START[pair.name] * (0.8 + r() * 0.4)
    const end = side === 'buy' ? start * (1 - 0.02 - r() * 0.4) : start * (1 + 0.02 + r() * 0.4)
    const steps = 2 + Math.floor(r() * 40)
    const input: LadderInput = {
      side, priceStart: start, priceEnd: end, steps, total: side === 'buy' ? 300 + r() * 5000 : (300 + r() * 5000) / start,
      spacing: r() < 0.5 ? 'linear' : 'geometric', curve: (['flat', 'linear', 'log', 'exp', 'fib'] as const)[Math.floor(r() * 5)], ratio: 0.3 + r() * 4,
      orderCenter: centers[Math.floor(r() * centers.length)], volumeCenter: centers[Math.floor(r() * centers.length)],
    }
    const l = buildLadder(input, pair)
    if (!l.valid) continue
    // wie in der App: letzte Prüfung vor dem Senden
    const prep = prepareForSend(l.levels, pair, side)
    expect(prep.error).toBeUndefined()
    out.push({ side, levels: prep.levels })
  }
  return out
}

/** Alte Entwürfe mit Gleitkomma-Resten (wie am 14.11. bei Kraken) */
const noisy = (levels: LadderLevel[]): LadderLevel[] => levels.map((l) => ({ ...l, price: l.price * (1 + 3e-16), volume: l.volume * (1 - 3e-16) }))

describe('Strenge Börsen-Attrappen nehmen jede Order aus dem Planer an', () => {
  it('Kraken: 150 Pläne, alle Orders angenommen (Pakete und einzelne)', async () => {
    let rejected: string[] = []
    let current: PairInfo = PAIRS.kraken[0]
    const http = async (url: string, init?: any) => {
      const ep = url.split('/').pop()
      let result: any = {}
      if (ep === 'AddOrderBatch') {
        const b = JSON.parse(init.body)
        result = { orders: b.orders.map((o: any, i: number) => {
          const why = strictCheck(o.price, o.volume, current)
          if (why) rejected.push(why)
          return why ? { error: `EOrder:${why}` } : { txid: `T${i}` }
        }) }
      } else if (ep === 'AddOrder') {
        const p = new URLSearchParams(init.body)
        const why = strictCheck(p.get('price')!, p.get('volume')!, current)
        if (why) return { status: 200, text: async () => JSON.stringify({ error: [`EGeneral:Invalid arguments:${why}`] }) }
        result = { txid: ['T1'] }
      }
      return { status: 200, text: async () => JSON.stringify({ error: [], result }) }
    }
    const k = new Kraken({ key: 'k', secret: Buffer.from('s').toString('base64') }, http, async () => {})
    for (const pair of PAIRS.kraken) {
      current = pair
      for (const p of plans(pair, pair.id.length * 17, 50)) {
        for (const levels of [p.levels, prepareForSend(noisy(p.levels), pair, p.side).levels, p.levels.slice(0, 1)]) {
          rejected = []
          const res = await k.placeLadder(pair.id, p.side, levels, { validate: false, userref: 1, rules: pair })
          expect(rejected).toEqual([])
          expect(res.every((o) => o.txid && !o.error), JSON.stringify(res.find((o) => o.error))).toBe(true)
        }
      }
    }
  })

  it('Bitvavo: 150 Pläne, alle Orders angenommen (auch Märkte mit gültigen Ziffern statt tickSize)', async () => {
    let current: PairInfo = PAIRS.bitvavo[0]
    let n = 0
    const http = async (_url: string, init?: any) => {
      const b = init?.body ? JSON.parse(init.body) : {}
      const why = strictCheck(b.price, b.amount, current)
      if (why) return { status: 400, text: async () => JSON.stringify({ errorCode: 205, error: why }) }
      return { status: 200, text: async () => JSON.stringify({ orderId: `o${n++}`, status: 'new' }) }
    }
    const bv = new Bitvavo({ key: 'k'.repeat(64), secret: 's'.repeat(128) }, http, async () => {})
    for (const pair of PAIRS.bitvavo) {
      current = pair
      for (const p of plans(pair, pair.id.length * 23, 50)) {
        for (const levels of [p.levels, prepareForSend(noisy(p.levels), pair, p.side).levels]) {
          const res = await bv.placeLadder(pair.id, p.side, levels, { validate: false, userref: 1, rules: pair })
          expect(res.every((o) => o.txid && !o.error), JSON.stringify(res.find((o) => o.error))).toBe(true)
        }
      }
    }
  })

  it('Coinbase: 100 Pläne, alle Orders angenommen', async () => {
    const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'sec1', format: 'pem' }).toString()
    let current: PairInfo = PAIRS.coinbase[0]
    let n = 0
    const http = async (_url: string, init?: any) => {
      const b = init?.body ? JSON.parse(init.body) : {}
      const cfg = b.order_configuration?.limit_limit_gtc ?? {}
      const why = strictCheck(cfg.limit_price, cfg.base_size, current)
      const body = why ? { success: false, error_response: { error: 'INVALID_LIMIT_PRICE_PRECISION', message: why } } : { success: true, success_response: { order_id: `c${n++}` } }
      return { status: 200, text: async () => JSON.stringify(body) }
    }
    const cb = new Coinbase({ key: 'organizations/x/apiKeys/y', secret: pem }, http, async () => {})
    for (const pair of PAIRS.coinbase) {
      current = pair
      for (const p of plans(pair, pair.id.length * 29, 50)) {
        const res = await cb.placeLadder(pair.id, p.side, prepareForSend(noisy(p.levels), pair, p.side).levels, { validate: false, userref: 1, rules: pair })
        expect(res.every((o) => o.txid && !o.error), JSON.stringify(res.find((o) => o.error))).toBe(true)
      }
    }
  })

  it('der Probelauf ohne Börse (Bitvavo) findet einen Preis, der nicht auf die gültigen Ziffern passt', async () => {
    const old = PAIRS.bitvavo[2]
    const http = async (url: string) => ({ status: 200, text: async () => JSON.stringify(url.includes('/balance') ? [{ symbol: 'EUR', available: '100000' }] : {}) })
    const bv = new Bitvavo({ key: 'k'.repeat(64), secret: 's'.repeat(128) }, http, async () => {})
    const res = await bv.placeLadder(old.id, 'buy', [{ index: 0, price: 123.456, volume: 1, cost: 123.456, share: 1 }], { validate: true, userref: 1, rules: old })
    expect(res[0].error).toMatch(/Preisschritten/)
    const ok = await bv.placeLadder(old.id, 'buy', [{ index: 0, price: 123.45, volume: 1, cost: 123.45, share: 1 }], { validate: true, userref: 1, rules: old })
    expect(ok[0].error).toBeUndefined()
  })
})

describe('Bitvavo-Märkte ohne tickSize', () => {
  it('nutzt pricePrecision als gültige Ziffern', async () => {
    const http = async () => ({ status: 200, text: async () => JSON.stringify([{ market: 'OLD-EUR', status: 'trading', base: 'OLD', quote: 'EUR', pricePrecision: 5, minOrderInBaseAsset: '0.1', minOrderInQuoteAsset: '5', quantityDecimals: 8 }]) })
    const [p] = await new Bitvavo(null, http).pairs()
    expect(p).toMatchObject({ priceSignificant: 5, priceDecimals: 8 })
    expect(p.tickSize).toBeUndefined()
  })
})
