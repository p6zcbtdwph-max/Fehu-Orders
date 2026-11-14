// Demo-Modus: dieselbe Schnittstelle wie die echte App, aber nur mit Beispieldaten im Speicher.
// Hier gibt es keinen Netzwerkzugriff, es kann also keine echte Order entstehen.
import { tr } from '@shared/i18n'
import type { Api, DraftDto, KeyCheck, LogEntry, OpenOrderDto, PairDto, PlanDto, PlanStatusDto, SendResult, SettingsDto, TemplateDto } from '@shared/ipc'

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
  let settings: SettingsDto = { maxPlanEur: 5000, watchlist: ['BTC/EUR', 'ETH/EUR', 'SOL/EUR'], currency: 'EUR', numberFormat: 'de' }
  const balances: Record<string, number> = { ZEUR: 2500, XXBT: 0.02, XETH: 0.5, SOL: 4 }
  let templates: TemplateDto[] = [
    { id: 'demo-1', name: 'Dip-Kauf 10 Stufen', pairName: 'BTC/EUR', postOnly: true,
      input: { side: 'buy', priceStart: 78000, priceEnd: 64000, steps: 10, total: 300, spacing: 'linear', curve: 'linear', ratio: 3 } },
  ]
  let orders: OpenOrderDto[] = []
  const log: LogEntry[] = []
  const addLog = (e: Omit<LogEntry, 'at'>) => log.unshift({ at: new Date().toISOString(), ...e })
  const now = new Date().toISOString()
  let drafts: DraftDto[] = [
    { id: 'demo-d1', name: tr('BTC Crash-Kauf', 'BTC crash buy'), scenario: 'Crash', note: tr('Nur freigeben, wenn BTC deutlich fällt.', 'Only release if BTC falls sharply.'), createdAt: now, updatedAt: now,
      pairId: 'XXBTZEUR', pairName: 'BTC/EUR', side: 'buy', postOnly: true, priceAtSave: 80000, status: 'draft',
      input: { side: 'buy', priceStart: 70000, priceEnd: 55000, steps: 8, total: 400, spacing: 'geometric', curve: 'exp', ratio: 3 } },
    { id: 'demo-d2', name: tr('ETH Crash-Kauf', 'ETH crash buy'), scenario: 'Crash', createdAt: now, updatedAt: now,
      pairId: 'XETHZEUR', pairName: 'ETH/EUR', side: 'buy', postOnly: true, priceAtSave: 3000, status: 'draft',
      input: { side: 'buy', priceStart: 2600, priceEnd: 2000, steps: 6, total: 300, spacing: 'linear', curve: 'linear', ratio: 2 } },
    { id: 'demo-d3', name: tr('SOL Gewinne mitnehmen', 'SOL take profits'), scenario: tr('Bullrun', 'Bull run'), createdAt: now, updatedAt: now,
      pairId: 'SOLEUR', pairName: 'SOL/EUR', side: 'sell', postOnly: true, priceAtSave: 150, status: 'draft',
      input: { side: 'sell', priceStart: 180, priceEnd: 260, steps: 5, total: 3, spacing: 'linear', curve: 'flat', ratio: 1 } },
  ]
  const demoChecks = (): KeyCheck[] => [
    { id: 'funds', label: tr('Guthaben abfragen', 'Query funds'), krakenLabel: 'Query Funds', required: true, ok: true },
    { id: 'open', label: tr('Offene Orders abfragen', 'Query open orders'), krakenLabel: 'Query Open Orders & Trades', required: true, ok: true },
    { id: 'closed', label: tr('Geschlossene Orders abfragen', 'Query closed orders'), krakenLabel: 'Query Closed Orders & Trades', required: true, ok: true },
    { id: 'create', label: tr('Orders erstellen', 'Create orders'), krakenLabel: 'Create & Modify Orders', required: true, ok: true },
    { id: 'cancel', label: tr('Orders stornieren', 'Cancel orders'), krakenLabel: 'Cancel & Close Orders', required: true, ok: true },
    { id: 'withdraw', label: tr('Keine Auszahlungen', 'No withdrawals'), krakenLabel: 'Withdraw Funds', required: true, ok: true },
  ]
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
    keyStatus: () => wait({ hasKey: true, encryption: true, touchId: true }, 0),
    saveKey: async () => { throw new Error(tr('Im Demo-Modus brauchst du keinen Schlüssel. Beende zuerst die Demo.', 'You need no key in demo mode. End the demo first.')) },
    verifyKey: () => wait(demoChecks().map((c) => ({ ...c })), 600),
    clearKey: async () => {},
    pairs: () => wait(MARKET.map((m) => m.pair)),
    price: (pairId) => wait(round(priceOf(pairId) * (1 + (Math.random() - 0.5) * 0.004), pairOf(pairId)?.priceDecimals ?? 2)),
    prices: (ids) => wait(Object.fromEntries(ids.map((id) => [id, priceOf(id)]))),
    balances: () => wait({ ...balances }),
    openOrders: () => wait(orders.map((o) => ({ ...o }))),
    async send(req) {
      const valid = req.levels.filter((l) => !l.problem)
      const chosen = valid.slice(0, req.sendCount ?? valid.length)
      const amount = chosen.reduce((a, l) => a + l.cost, 0)
      const last = priceOf(req.pairId)
      if (chosen.some((l) => (req.side === 'buy' ? l.price >= last : l.price <= last))) {
        const msg = tr(`Der Kurs steht gerade bei ${last} €. Stufen auf der falschen Seite, es wurde nichts gesendet.`, `The price is currently ${last} €. Levels on the wrong side, nothing was sent.`)
        addLog({ action: req.validate ? 'validate' : 'send', pair: req.pairName, side: req.side, count: chosen.length, amount, success: false, message: msg })
        throw new Error(msg)
      }
      addLog({ action: req.validate ? 'validate' : 'send', pair: req.pairName, side: req.side, count: chosen.length, ok: chosen.length, failed: 0, amount, success: true, message: req.validate ? tr('Probelauf ohne Fehler', 'Test run without errors') : tr(`${chosen.length} Orders angelegt`, `${chosen.length} orders placed`) })
      if (req.validate) return wait({ userref: 0, validate: true, orders: chosen.map((l) => ({ index: l.index, price: l.price, volume: l.volume })) }, 400)
      const plan: PlanDto = { userref: nextRef++, createdAt: new Date().toISOString(), pairId: req.pairId, pairName: req.pairName, side: req.side, input: req.input,
        sent: chosen.length, failed: 0, totalCost: chosen.reduce((a, l) => a + l.cost, 0), levels: req.levels, sentIndices: chosen.map((l) => l.index), postOnly: req.postOnly }
      plans.unshift(plan)
      const placed = place(plan, plan.sentIndices!.map((i) => req.levels.findIndex((l) => l.index === i)))
      if (req.draftId) drafts = drafts.map((d) => (d.id === req.draftId ? { ...d, status: 'released', releasedAt: new Date().toISOString(), userref: plan.userref } : d))
      return wait({ userref: plan.userref, validate: false, orders: placed }, 500)
    },
    async sendRest(userref, validate) {
      const plan = plans.find((p) => p.userref === userref)
      if (!plan?.levels) throw new Error(tr('Plan nicht gefunden', 'Plan not found'))
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
      addLog({ action: 'cancel-plan', userref, success: true, count: n, message: tr(`${n} Orders storniert`, `${n} orders cancelled`) })
      return wait(n)
    },
    async cancelAll() {
      const n = orders.length
      orders = []
      addLog({ action: 'cancel-all', success: true, count: n, message: tr(`Notbremse: ${n} Orders storniert`, `Emergency stop: ${n} orders cancelled`) })
      return wait(n)
    },
    systemStatus: () => wait('online'),
    log: () => wait(log.map((e) => ({ ...e }))),
    backupExport: async () => { throw new Error(tr('Im Demo-Modus gibt es nichts zu sichern. Beende zuerst die Demo.', 'There is nothing to back up in demo mode. End the demo first.')) },
    backupPick: async () => { throw new Error(tr('Im Demo-Modus kannst du keine Sicherung einspielen. Beende zuerst die Demo.', 'You cannot restore a backup in demo mode. End the demo first.')) },
    backupRestore: async () => { throw new Error(tr('Im Demo-Modus nicht möglich.', 'Not possible in demo mode.')) },
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
    drafts: () => wait(drafts.map((d) => ({ ...d }))),
    async saveDraft(d) { drafts = drafts.some((x) => x.id === d.id) ? drafts.map((x) => (x.id === d.id ? d : x)) : [d, ...drafts] },
    async deleteDraft(id) { drafts = drafts.filter((d) => d.id !== id) },
    onFills: () => () => {},
    onOpenPage: () => () => {},
  }
}
