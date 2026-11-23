import { describe, expect, it } from 'vitest'
import { buildPortfolio, cleanCashPots, cleanTargets, draftValue, shares, targetGaps, targetSum, toEur, type PortfolioSource } from './portfolio'
import type { DraftDto, PlanDto } from './ipc'

const input = { side: 'buy' as const, priceStart: 60000, priceEnd: 50000, steps: 4, total: 400, spacing: 'linear' as const, curve: 'flat' as const, ratio: 1 }
const lv = (index: number, price: number, cost: number, zone?: number) => ({ index, price, volume: cost / price, cost, share: 0.25, ...(zone !== undefined ? { zone } : {}) })

function btcPlan(over: Partial<PlanDto> = {}): PlanDto {
  return {
    exchange: 'kraken', userref: 1, createdAt: '2026-11-01T00:00:00Z', pairId: 'XXBTZEUR', pairName: 'BTC/EUR', side: 'buy', input,
    sent: 4, failed: 0, totalCost: 400, levels: [lv(0, 60000, 100), lv(1, 56000, 100), lv(2, 53000, 100), lv(3, 50000, 100)], sentIndices: [0, 1, 2, 3], ...over,
  }
}

const source = (over: Partial<PortfolioSource> = {}): PortfolioSource => ({
  exchange: 'kraken', hasKey: true, plans: [], drafts: [], status: [], openOrders: [], eurTotal: 1000, eurFree: 800, prices: {}, ...over,
})

describe('Portfolio', () => {
  it('fasst mehrere BTC-Pläne auf zwei Börsen in einer Zeile zusammen, mit Einstand inkl. Gebühren', () => {
    const k = source({
      plans: [btcPlan()],
      status: [{ userref: 1, open: 2, filled: 2, partial: 0, canceled: 0, filledVolume: 0.004, filledCost: 236, fees: 0.6, averagePrice: 59000 }],
      openOrders: [
        { txid: 'a', pair: 'XBTEUR', side: 'buy', price: 53000, volume: 100 / 53000, filled: 0, cost: 0, fee: 0, userref: 1 },
        { txid: 'b', pair: 'XBTEUR', side: 'buy', price: 50000, volume: 100 / 50000, filled: 0, cost: 0, fee: 0, userref: 1 },
      ],
      prices: { XXBTZEUR: 65000 },
    })
    const b = source({
      exchange: 'bitvavo', eurTotal: 500, eurFree: 500,
      plans: [btcPlan({ exchange: 'bitvavo', userref: 7, pairId: 'BTC-EUR', levels: [lv(0, 58000, 58)], sentIndices: [0] })],
      status: [{ userref: 7, open: 0, filled: 1, partial: 0, canceled: 0, filledVolume: 0.001, filledCost: 58, fees: 0.15, averagePrice: 58000 }],
    })
    const p = buildPortfolio([k, b], [], { includeDrafts: true, usdRate: 1.08 })
    expect(p.rows).toHaveLength(1)
    const r = p.rows[0]
    expect(r.coin).toBe('BTC')
    expect(r.exchanges).toEqual(['kraken', 'bitvavo'])
    expect(r.plans).toBe(2)
    expect(r.heldVolume).toBeCloseTo(0.005)
    expect(r.invested).toBeCloseTo(236.6 + 58.15)
    expect(r.avgPrice).toBeCloseTo((236.6 + 58.15) / 0.005)
    expect(r.value).toBeCloseTo(0.005 * 65000)
    expect(r.openCount).toBe(2)
    expect(r.openEur).toBeCloseTo(200)
    expect(r.soll).toBeCloseTo(200)
    expect(r.progress).toBeCloseTo(294.75 / 494.75)
    expect(p.cashExchange).toBe(1500)
  })

  it('zählt pausierte Zonen und nicht gesendete Stufen als Soll, Entwürfe nur auf Wunsch', () => {
    const plan = btcPlan({
      input: { ...input, zones: [{ priceStart: 60000, priceEnd: 56000, steps: 2, share: 50 }, { priceStart: 53000, priceEnd: 50000, steps: 2, share: 50, armed: false }] },
      levels: [lv(0, 60000, 100, 0), lv(1, 56000, 100, 0), lv(2, 53000, 100, 1), lv(3, 50000, 100, 1)], sentIndices: [0, 1],
    })
    const draft: DraftDto = { id: 'd', name: 'Crash', scenario: '', createdAt: '', updatedAt: '', pairId: 'XETHZEUR', pairName: 'ETH/EUR', side: 'buy', input: { ...input, total: 300 }, postOnly: true, status: 'draft' }
    const src = source({ plans: [plan], drafts: [draft], status: [{ userref: 1, open: 2, filled: 0, partial: 0, canceled: 0, filledVolume: 0, filledCost: 0, fees: 0, averagePrice: 0 }] })
    const withDrafts = buildPortfolio([src], [], { includeDrafts: true, usdRate: null })
    const btc = withDrafts.rows.find((r) => r.coin === 'BTC')!
    expect(btc.laterEur).toBe(200)
    expect(btc.heldZoneCount).toBe(1)
    expect(withDrafts.rows.find((r) => r.coin === 'ETH')!.soll).toBe(300)
    const without = buildPortfolio([src], [], { includeDrafts: false, usdRate: null })
    expect(without.rows.find((r) => r.coin === 'ETH')!.soll).toBe(0)
    expect(without.soll).toBe(200)
  })

  it('Verkäufe senken Bestand und Einstand, nicht den Ø Kaufpreis', () => {
    const buy = btcPlan()
    const sell = btcPlan({ userref: 2, side: 'sell', levels: [], sentIndices: [] })
    const p = buildPortfolio([source({
      plans: [buy, sell], prices: { XXBTZEUR: 50000 },
      status: [
        { userref: 1, open: 0, filled: 4, partial: 0, canceled: 0, filledVolume: 0.008, filledCost: 400, fees: 0, averagePrice: 50000 },
        { userref: 2, open: 0, filled: 1, partial: 0, canceled: 0, filledVolume: 0.002, filledCost: 120, fees: 0, averagePrice: 60000 },
      ],
    })], [], { includeDrafts: true, usdRate: null })
    const r = p.rows[0]
    expect(r.avgPrice).toBe(50000)
    expect(r.heldVolume).toBeCloseTo(0.006)
    expect(r.invested).toBeCloseTo(300)
    expect(r.pnl).toBeCloseTo(0)
    expect(r.soldOutside).toBe(false)
  })

  it('Deckung: Reserve zählt nicht, Fehlbetrag wird genannt', () => {
    const plan = btcPlan({ sentIndices: [] })
    const src = source({ plans: [plan], eurTotal: 100, eurFree: 100, status: [{ userref: 1, open: 0, filled: 0, partial: 0, canceled: 0, filledVolume: 0, filledCost: 0, fees: 0, averagePrice: 0 }] })
    const p = buildPortfolio([src], [{ id: 'a', name: 'Tagesgeld', amount: 150 }, { id: 'b', name: 'Notgroschen', amount: 5000, reserve: true }], { includeDrafts: true, usdRate: null })
    expect(p.buyNeed).toBe(400)
    expect(p.buyCash).toBe(250)
    expect(p.shortfall).toBe(150)
    expect(p.cash).toBe(5250)
    expect(p.unsentBuy).toBe(400)
  })

  it('Torte: gleiche Summe heute und nach allen Plänen, Euro wandern vom Cash zum Coin', () => {
    const src = source({
      plans: [btcPlan()], prices: { XXBTZEUR: 60000 }, eurTotal: 1000,
      status: [{ userref: 1, open: 0, filled: 2, partial: 0, canceled: 0, filledVolume: 0.002, filledCost: 120, fees: 0, averagePrice: 60000 }],
      openOrders: [{ txid: 'a', pair: 'XBTEUR', side: 'buy', price: 50000, volume: 0.004, filled: 0, cost: 0, fee: 0, userref: 1 }],
    })
    const p = buildPortfolio([src], [], { includeDrafts: true, usdRate: null })
    const total = (xs: { value: number }[]) => xs.reduce((a, x) => a + x.value, 0)
    expect(total(p.ist)).toBeCloseTo(total(p.after))
    expect(p.after.find((s) => s.key === 'BTC')!.value).toBeCloseTo(120 + 200)
    expect(p.after.find((s) => s.key === 'cash')!.value).toBeCloseTo(800)
    expect(Object.values(shares(p.after)).reduce((a, b) => a + b, 0)).toBeCloseTo(100)
  })

  it('ohne Schlüssel: Stand unbekannt, Cash der Börse fehlt', () => {
    const p = buildPortfolio([source({ hasKey: false, eurTotal: null, eurFree: null, plans: [btcPlan()] })], [], { includeDrafts: true, usdRate: null })
    expect(p.rows[0].unknown).toBe(true)
    expect(p.cashUnknown).toEqual(['kraken'])
  })
})

describe('Hilfen', () => {
  it('rechnet Dollar in Euro um, andere Kurswährungen nicht', () => {
    expect(toEur(108, 'USD', 1.08)).toBeCloseTo(100)
    expect(toEur(100, 'EUR', null)).toBe(100)
    expect(toEur(1, 'BTC', 1.08)).toBeNull()
  })
  it('Entwurf in Stück: Menge mal Mitte des Preisbereichs', () => {
    const d = { input: { ...input, side: 'sell', unit: 'base', total: 2, priceStart: 100, priceEnd: 200 } } as DraftDto
    expect(draftValue(d)).toBe(300)
  })
  it('übernimmt nur gültige Cash-Töpfe', () => {
    expect(cleanCashPots([{ id: 'a', name: ' Tagesgeld ', amount: 10 }, { id: 'b', name: 'x', amount: -1 }, 'kaputt', { id: 'c', name: 'R', amount: 5, reserve: true }]))
      .toEqual([{ id: 'a', name: 'Tagesgeld', amount: 10 }, { id: 'c', name: 'R', amount: 5, reserve: true }])
    expect(cleanCashPots(null)).toEqual([])
  })
})

describe('Zielaufteilung', () => {
  const slices = [
    { key: 'BTC', label: 'BTC', value: 600 },
    { key: 'ETH', label: 'ETH', value: 100 },
    { key: 'cash', label: 'Cash', value: 300 },
    { key: 'reserve', label: 'Reserve', value: 5000 },
  ]
  it('rechnet Abweichung in Punkten und Euro, ohne Reserve, größte zuerst', () => {
    const g = targetGaps(slices, { BTC: 40, ETH: 20, cash: 30, SOL: 10 })
    expect(g.map((x) => x.key)).toEqual(['BTC', 'ETH', 'SOL', 'cash'])
    const btc = g[0]
    expect(btc.share).toBeCloseTo(60)
    expect(btc.points).toBeCloseTo(20)
    expect(btc.eur).toBeCloseTo(-200)
    expect(g.find((x) => x.key === 'ETH')!.eur).toBeCloseTo(100)
    expect(g.find((x) => x.key === 'SOL')!.share).toBe(0)
  })
  it('übernimmt nur gültige Ziele', () => {
    expect(cleanTargets({ btc: 40, cash: 30, 'x y': 5, ETH: 0, SOL: 120, ADA: '10' })).toEqual({ BTC: 40, cash: 30, ADA: 10 })
    expect(cleanTargets([1])).toEqual({})
    expect(targetSum({ BTC: 40, cash: 30 })).toBe(70)
  })
})
