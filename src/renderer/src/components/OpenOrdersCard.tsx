// „Alle offenen Orders“: je Paar und Richtung zu einer Zeile zusammengefasst (Summe, Preisspanne, Ø Preis),
// aufklappbar bis zur einzelnen Order. Nur Anzeige: bei der Börse bleibt jede Order einzeln bestehen.
import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { tr } from '@shared/i18n'
import type { OpenOrderDto, PairDto } from '@shared/ipc'
import { groupOpenOrders, type OrderGroup } from '@shared/order-groups'
import { findPair, pairLabel } from '@shared/pair-label'
import SectionCard from './ui/SectionCard'
import Segmented from './ui/Segmented'
import { num } from '../format'
import { useMoney } from '../money'

type View = 'grouped' | 'single'
const VIEW_KEY = 'fehu-orders-open-view'

function startView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'single' ? 'single' : 'grouped' } catch { return 'grouped' }
}

export default function OpenOrdersCard({ orders, pairs, onCancel }: { orders: OpenOrderDto[]; pairs: PairDto[]; onCancel: (txid: string) => void }): JSX.Element {
  const { eur, fmtPrice, sym } = useMoney()
  const [view, setViewState] = useState<View>(startView)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const setView = (v: View) => {
    setViewState(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* egal */ }
  }
  const toggle = (key: string) => setOpen((s) => {
    const n = new Set(s)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    return n
  })
  // Börsen nennen Paare in offenen Orders unterschiedlich (Kraken „XBTEUR“, Coinbase „BTC-EUR“ …): immer „BTC/EUR“ zeigen
  const label = (id: string) => pairLabel(id, pairs)
  const dec = (id: string) => findPair(id, pairs)?.priceDecimals ?? 8
  const side = (s: 'buy' | 'sell') => (s === 'buy' ? tr('Kauf', 'Buy') : tr('Verkauf', 'Sell'))
  const groups = groupOpenOrders(orders)
  const merged = groups.filter((g) => g.orders.length > 1).length

  const orderRow = (o: OpenOrderDto, nested = false) => (
    <tr key={o.txid} className={nested ? 'bg-sunken-soft/50' : ''}>
      <td className={nested ? 'pl-8 text-ink-muted' : ''}>{nested ? '' : label(o.pair)}</td>
      <td className={nested ? 'text-ink-muted' : ''}>{nested ? '' : side(o.side)}</td>
      <td className="num">{fmtPrice(o.price, dec(o.pair))} {sym}</td>
      <td className="num">{num(o.volume, 8)}</td>
      <td className="num">{num(o.filled, 8)}</td>
      <td className="tabular-nums text-ink-muted">{o.userref || '–'}</td>
      <td className="text-right"><button type="button" className="btn-mini" aria-label={tr('Order stornieren', 'Cancel order')} title={tr('Order stornieren', 'Cancel order')} onClick={() => onCancel(o.txid)}><X size={14} /></button></td>
    </tr>
  )

  const groupRow = (g: OrderGroup<OpenOrderDto>) => {
    const isOpen = open.has(g.key)
    const d = dec(g.pair)
    return (
      <Fragment key={g.key}>
        <tr className="cursor-pointer hover:bg-sunken-soft" onClick={() => toggle(g.key)}>
          <td className="whitespace-nowrap">
            <button type="button" className="mr-1 inline-flex align-middle text-ink-muted" aria-expanded={isOpen}
              aria-label={isOpen ? tr('Einzelne Orders zuklappen', 'Hide single orders') : tr('Einzelne Orders zeigen', 'Show single orders')}
              onClick={(e) => { e.stopPropagation(); toggle(g.key) }}>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {label(g.pair)} <span className="text-xs text-ink-muted">· {g.orders.length} Orders</span>
          </td>
          <td>{side(g.side)}</td>
          <td className="num">
            {fmtPrice(g.highPrice, d)} – {fmtPrice(g.lowPrice, d)} {sym}
            <span className="block text-xs text-ink-muted">Ø {fmtPrice(g.averagePrice, d)} {sym}</span>
          </td>
          <td className="num">
            {num(g.open, 8)}
            <span className="block text-xs text-ink-muted" title={g.side === 'buy' ? tr('So viel ist für diese Orders gesperrt', 'This much is locked for these orders') : tr('Gegenwert zum Limitpreis', 'Value at the limit price')}>
              {g.side === 'buy' ? tr('gesperrt', 'locked') : '≈'} {eur(g.openValue)}
            </span>
          </td>
          <td className="num">{num(g.filled, 8)}</td>
          <td className="text-ink-muted">{g.plans.length === 0 ? '–' : g.plans.length === 1 ? g.plans[0] : tr(`${g.plans.length} Pläne`, `${g.plans.length} plans`)}</td>
          <td />
        </tr>
        {isOpen && g.orders.map((o) => orderRow(o, true))}
      </Fragment>
    )
  }

  return (
    <SectionCard title={tr(`Alle offenen Orders (${orders.length})`, `All open orders (${orders.length})`)}
      action={orders.length > 1 ? <Segmented<View> value={view} onChange={setView} aria-label={tr('Ansicht', 'View')} options={[
        { id: 'grouped', label: tr('Je Paar', 'Per pair'), title: tr('Orders desselben Paars und derselben Richtung in einer Zeile', 'Orders of the same pair and side in one row') },
        { id: 'single', label: tr('Einzeln', 'Single'), title: tr('Jede Order in einer eigenen Zeile', 'Every order in its own row') },
      ]} /> : undefined}>
      {orders.length === 0 ? <p className="text-sm text-ink-muted">{tr('Keine offenen Orders.', 'No open orders.')}</p> : (
        <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>{tr('Paar', 'Pair')}</th><th>{tr('Richtung', 'Side')}</th><th className="num">{tr('Preis', 'Price')}</th><th className="num">{view === 'grouped' ? tr('Offene Menge', 'Open volume') : tr('Menge', 'Volume')}</th><th className="num">{tr('Ausgeführt', 'Filled')}</th><th>Plan</th><th /></tr></thead>
              <tbody>
                {view === 'single'
                  ? [...orders].sort((a, b) => b.price - a.price).map((o) => orderRow(o))
                  : groups.map((g) => (g.orders.length > 1 ? groupRow(g) : orderRow(g.orders[0])))}
              </tbody>
            </table>
          </div>
          {view === 'grouped' && merged > 0 && (
            <p className="mt-2 text-xs text-ink-muted">{tr(
              'Nur zur Übersicht zusammengefasst. Bei der Börse bleibt jede Order einzeln bestehen, mit ihrem eigenen Preis. Klick auf eine Zeile zeigt die einzelnen Orders, dort kannst du sie auch einzeln stornieren.',
              'Combined for overview only. At the exchange every order stays separate, with its own price. Click a row to see the single orders, where you can also cancel them one by one.',
            )}</p>
          )}
        </>
      )}
    </SectionCard>
  )
}
