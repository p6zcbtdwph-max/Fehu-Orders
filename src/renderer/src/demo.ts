// Demo-Modus: dieselbe Schnittstelle wie die echte App, aber nur mit Beispieldaten im Speicher.
// Hier gibt es keinen Netzwerkzugriff, es kann also keine echte Order entstehen.
import type { Api, OpenOrderDto, PairDto, PlanDto, PlanStatusDto, SendResult, SettingsDto, TemplateDto } from '@shared/ipc'

const P = (id: string, name: string, base: string, priceDecimals: number, orderMin: number, price: number) =>
  ({ pair: { id, name, base, quote: 'ZEUR', priceDecimals, volumeDecimals: 8, orderMin, costMin: 0.5 } as PairDto, price })

// Beispielkurse, bewusst runde Werte. Sie sagen nichts über den echten Markt.
const MARKET = [
  P('XXBTZEUR', 'BTC/EUR', 'XXBT', 1, 0.00005, 80000),
  P('XETHZEUR', 'ETH/EUR', 'XETH', 2, 0.002, 3000),
  P('SOLEUR', 'SOL/EUR', 'SOL', 2, 0.02, 150),
  P('XXRPZEUR', 'XRP/EUR', 'XXRP', 5, 2, 2),
  P('ADAEUR', 'ADA/EUR', 'ADA', 6, 5, 0.6),
  P('DOTEUR', 'DOT/EUR', 'DOT', 4, 0.5, 5),
  P('LINKEUR', 'LINK/EUR', 'LINK', 5, 0.2, 15),
  P('XDGEUR', 'DOGE/EUR', 'XXDG', 7, 20, 0.15),
  P('XLTCZEUR', 'LTC/EUR', 'XLTC', 2, 0.05, 80),
  P('AVAXEUR', 'AVAX/EUR', 'AVAX', 2, 0.1, 25),
]
const priceOf = (pairId: string) => MARKET.find((m) => m.pair.id === pairId)?.price ?? 1
const pairOf = (pairId: string) => MARKET.find((m) => m.pair.id === pairId)?.pair
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

export function createDemoApi(): Api {
  let settings: SettingsDto = { maxPlanEur: 5000, watchlist: ['BTC/EUR', 'ETH/EUR', 'SOL/EUR'], currency: 'EUR' }
  const balances: Record<string, number> = { ZEUR: 2500, XXBT: 0.02, XETH: 0.5, SOL: 4 }
  let templates: TemplateDto[] = [
    { id: 'demo-1', name: 'Dip-Kauf 10 Stufen', pairName: 'BTC/EUR', postOnly: true,
      input: { side: 'buy', priceStart: 78000, priceEnd: 64000, steps: 10, total: 300, spacing: 'linear', curve: 'linear', ratio: 3 } },
  ]
  let orders: OpenOrderDto[] = []
  const plans: PlanDto[] = []
  const fills = new Map<number, PlanStatusDto>()
  let nextRef = 900001
  let nextTx = 1

  function place(plan: PlanDto, indices: number[]): SendResult['orders'] {
    return indices.map((i) => {
      const l = plan.levels![i]
      const txid = `DEMO-${String(nextTx++).padStart(5, '0')}`
      orders.push({ txid, pair: plan.pairName.replace('/', ''), side: plan.side, price: l.price, volume: l.volume, filled: 0, cost: 0, fee: 0, userref: plan.userref })
      return { index: l.index, price: l.price, volume: l.volume, txid }
    })
  }

  // Ein Beispielplan, bei dem schon 3 von 6 Stufen ausgeführt sind (für Status und Gewinnstaffel)
  {
    const levels = [78000, 75000, 72000, 69000, 66000, 63000].map((price, index) => ({ index, price, volume: round(50 / price, 8), cost: 50, share: 1 / 6 }))
    const plan: PlanDto = { userref: nextRef++, createdAt: new Date(Date.now() - 6 * 86400_000).toISOString(), pairId: 'XXBTZEUR', pairName: 'BTC/EUR', side: 'buy',
      input: { side: 'buy', priceStart: 78000, priceEnd: 63000, steps: 6, total: 300, spacing: 'linear', curve: 'flat', ratio: 3 },
      sent: 6, failed: 0, totalCost: 300, levels, sentIndices: [0, 1, 2, 3, 4, 5], postOnly: true }
    plans.push(plan)
    place(plan, [3, 4, 5])
    const done = levels.slice(0, 3)
    const vol = done.reduce((a, l) => a + l.volume, 0)
    fills.set(plan.userref, { userref: plan.userref, open: 3, filled: 3, partial: 0, canceled: 0, filledVolume: vol, filledCost: 150, fees: 0.38, averagePrice: 150 / vol })
  }

  const wait = <T,>(v: T, ms = 150) => new Promise<T>((r) => setTimeout(() => r(v), ms))

  return {
    keyStatus: () => wait({ hasKey: true, encryption: true }, 0),
    saveKey: async () => { throw new Error('Im Demo-Modus brauchst du keinen Schlüssel. Beende zuerst die Demo.') },
    clearKey: async () => {},
    pairs: () => wait(MARKET.map((m) => m.pair)),
    price: (pairId) => wait(round(priceOf(pairId) * (1 + (Math.random() - 0.5) * 0.004), pairOf(pairId)?.priceDecimals ?? 2)),
    balances: () => wait({ ...balances }),
    openOrders: () => wait(orders.map((o) => ({ ...o }))),
    async send(req) {
      const valid = req.levels.filter((l) => !l.problem)
      const chosen = valid.slice(0, req.sendCount ?? valid.length)
      if (req.validate) return wait({ userref: 0, validate: true, orders: chosen.map((l) => ({ index: l.index, price: l.price, volume: l.volume })) }, 400)
      const plan: PlanDto = { userref: nextRef++, createdAt: new Date().toISOString(), pairId: req.pairId, pairName: req.pairName, side: req.side, input: req.input,
        sent: chosen.length, failed: 0, totalCost: chosen.reduce((a, l) => a + l.cost, 0), levels: req.levels, sentIndices: chosen.map((l) => l.index), postOnly: req.postOnly }
      plans.unshift(plan)
      const placed = place(plan, plan.sentIndices!.map((i) => req.levels.findIndex((l) => l.index === i)))
      return wait({ userref: plan.userref, validate: false, orders: placed }, 500)
    },
    async sendRest(userref, validate) {
      const plan = plans.find((p) => p.userref === userref)
      if (!plan?.levels) throw new Error('Plan nicht gefunden')
      const rest = plan.levels.filter((l) => !l.problem && !plan.sentIndices?.includes(l.index))
      if (validate) return wait({ userref, validate: true, orders: rest.map((l) => ({ index: l.index, price: l.price, volume: l.volume })) }, 400)
      const placed = place(plan, rest.map((l) => plan.levels!.indexOf(l)))
      plan.sentIndices = [...(plan.sentIndices ?? []), ...rest.map((l) => l.index)]
      plan.sent += rest.length
      return wait({ userref, validate: false, orders: placed }, 500)
    },
    async cancelPlan(userref) {
      const n = orders.filter((o) => o.userref === userref).length
      orders = orders.filter((o) => o.userref !== userref)
      return wait(n)
    },
    async cancelOrder(txid) {
      orders = orders.filter((o) => o.txid !== txid)
      await wait(null)
    },
    plans: () => wait(plans.map((p) => ({ ...p }))),
    settings: () => wait({ ...settings }, 0),
    async saveSettings(s) { settings = { ...settings, ...s }; return { ...settings } },
    usdRate: () => wait(1.08),
    async ohlc(pairId, interval) {
      // Erfundener Kursverlauf, der genau beim Beispielkurs endet
      const off = pairId.length * 37
      const wave = (x: number) => 1 + 0.08 * Math.sin(x / 60) + 0.03 * Math.sin(x / 11) + 0.01 * Math.sin(x / 3)
      const scale = priceOf(pairId) / wave(719 + off)
      const now = Math.floor(Date.now() / 1000)
      return wait(Array.from({ length: 720 }, (_, i) => [now - (719 - i) * interval * 60, round(scale * wave(i + off), 6)] as [number, number]))
    },
    fees: () => wait({ maker: 0.25, taker: 0.4 }),
    async available() {
      const out = { ...balances }
      for (const o of orders) {
        const p = MARKET.find((m) => m.pair.name.replace('/', '') === o.pair)?.pair
        if (!p) continue
        if (o.side === 'buy') out.ZEUR -= o.price * o.volume
        else out[p.base] = (out[p.base] ?? 0) - o.volume
      }
      return wait(out)
    },
    templates: () => wait([...templates]),
    async saveTemplate(t) { templates = [...templates.filter((x) => x.id !== t.id), t] },
    async deleteTemplate(id) { templates = templates.filter((t) => t.id !== id) },
    async planStatus() {
      return wait(plans.map((p) => {
        const open = orders.filter((o) => o.userref === p.userref).length
        const f = fills.get(p.userref)
        return f ? { ...f, open } : { userref: p.userref, open, filled: 0, partial: 0, canceled: p.sent - open, filledVolume: 0, filledCost: 0, fees: 0, averagePrice: 0 }
      }))
    },
    onFills: () => () => {},
  }
}
