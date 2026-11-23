import { useEffect, useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { ChevronDown, ChevronRight, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import SectionCard from '../components/ui/SectionCard'
import Segmented from '../components/ui/Segmented'
import { tr } from '@shared/i18n'
import { activeExchange, exchangeName } from '@shared/exchanges'
import { buildPortfolio, MAX_CASH_POTS, shares, type CashPot, type CoinRow, type PortfolioSlice, type PortfolioSource } from '@shared/portfolio'
import { parseNumber, toInputText } from '@shared/number-format'
import { num, numberFormat, pct } from '../format'
import { useMoney } from '../money'
import { categoryColor, cssColor, useChartTheme } from '../utils/chartTheme'
import { Kpi } from './PlansPage'

const HIDE_KEY = 'fehu-orders-portfolio-hidden'
const MASK = '•••'

interface Props {
  /** Zählt hoch nach der Notbremse und beim Wechsel von Börse oder Demo */
  reload: string | number
  /** Plan oder Entwurf in „Meine Pläne“ öffnen (nur für die gerade gewählte Börse) */
  onOpenPlan: (id: string) => void
}

/** Portfolio: alle Pläne je Coin, Ist (gekauft) und Soll (noch geplant), dazu Cash */
export default function PortfolioPage({ reload, onOpenPlan }: Props): JSX.Element {
  const { eur, fmtPrice, sym } = useMoney()
  const [sources, setSources] = useState<PortfolioSource[] | null>(null)
  const [pots, setPots] = useState<CashPot[]>([])
  const [includeDrafts, setIncludeDrafts] = useState(true)
  const [usdRate, setUsdRate] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'ist' | 'after'>('after')
  const [open, setOpen] = useState<string | null>(null)
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false } })

  async function load() {
    setError(null)
    try {
      const [src, s] = await Promise.all([api().portfolio(), api().settings()])
      setSources(src)
      setPots(s.cashPots ?? [])
      setIncludeDrafts(s.portfolioDrafts !== false)
      // Dollar-Kurs nur, wenn ein Plan in Dollar läuft
      if (src.some((x) => [...x.plans, ...x.drafts].some((p) => /\/(USD|USDC|USDT)$/.test(p.pairName)))) api().usdRate().then(setUsdRate).catch(() => setUsdRate(null))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
    return api().onFills(() => load())
  }, [reload])

  const p = useMemo(() => (sources ? buildPortfolio(sources, pots, { includeDrafts, usdRate }) : null), [sources, pots, includeDrafts, usdRate])

  const toggleHidden = () => {
    setHidden((h) => {
      try { !h ? localStorage.setItem(HIDE_KEY, '1') : localStorage.removeItem(HIDE_KEY) } catch { /* egal */ }
      return !h
    })
  }
  const money = (n: number) => (hidden ? MASK : eur(n))
  const signed = (n: number) => (hidden ? MASK : `${n > 0 ? '+' : n < 0 ? '−' : ''}${eur(Math.abs(n))}`)
  const savePots = (next: CashPot[]) => {
    setPots(next)
    api().saveSettings({ cashPots: next }).catch((e) => setError((e as Error).message))
  }
  const saveDrafts = (on: boolean) => {
    setIncludeDrafts(on)
    api().saveSettings({ portfolioDrafts: on }).catch(() => undefined)
  }

  const errors = (sources ?? []).filter((s) => s.error)
  const colorOf = (key: string, i: number) => (key === 'cash' ? cssColor('chart-neutral') : key === 'reserve' ? cssColor('chart-grid-strong') : categoryColor(i))
  const order = p ? p.rows.map((r) => r.coin) : []
  const color = (key: string) => colorOf(key, order.indexOf(key))

  return (
    <div className="page">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">Portfolio</h1>
          <p className="page-subtitle">{tr('Was deine Pläne schon gekauft haben (Ist) und was sie noch kaufen sollen (Soll), je Coin zusammengefasst, über alle Börsen.', 'What your plans have already bought (actual) and what they are still meant to buy (planned), grouped by coin across all exchanges.')}</p>
        </div>
        <button type="button" className="btn btn-secondary ml-auto" onClick={toggleHidden} aria-pressed={hidden}>
          {hidden ? <Eye size={16} /> : <EyeOff size={16} />} {hidden ? tr('Beträge zeigen', 'Show amounts') : tr('Beträge verbergen', 'Hide amounts')}
        </button>
      </header>
      {error && <p className="notice notice-danger mb-4">{error}</p>}
      {errors.map((s) => <p key={s.exchange} className="notice notice-warning mb-4">{tr(`Nicht alles geladen. ${s.error} Die übrigen Börsen werden trotzdem gezeigt.`, `Not everything loaded. ${s.error} The other exchanges are still shown.`)}</p>)}

      {!p ? <p className="text-sm text-ink-muted">{tr('Wird geladen …', 'Loading …')}</p> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
            <Kpi label={tr('Investiert (Ist)', 'Invested (actual)')} value={money(p.invested)}
              sub={p.invested > 0 ? (hidden ? tr('heute wert •••', 'worth ••• today') : tr(`heute wert ${eur(p.value)} (${pctSigned(p.pnl / p.invested)})`, `worth ${eur(p.value)} today (${pctSigned(p.pnl / p.invested)})`)) : tr('noch nichts ausgeführt', 'nothing filled yet')} />
            <Kpi label={tr('Noch geplant (Soll)', 'Still planned')} value={money(p.soll)}
              sub={hidden ? undefined : tr(`${eur(p.sollOpen)} in Orders, ${eur(p.sollLater)} später`, `${eur(p.sollOpen)} in orders, ${eur(p.sollLater)} later`)} />
            <Kpi label="Cash" value={money(p.cash)}
              sub={hidden ? undefined : tr(`${eur(p.cashExchange)} Börse, ${eur(p.cashPots + p.cashReserve)} Töpfe`, `${eur(p.cashExchange)} exchange, ${eur(p.cashPots + p.cashReserve)} pots`)} />
            <Coverage p={p} money={money} />
          </div>

          {!hidden && p.unsentBuy > p.cashExchangeFree + 0.005 && p.cashUnknown.length === 0 && (
            <p className="notice notice-info">{tr(
              `Für noch nicht gesendete Käufe${includeDrafts ? ' und Entwürfe' : ''} brauchst du ${eur(p.unsentBuy)} bei der Börse, frei sind dort gerade ${eur(p.cashExchangeFree)}. Überweise rechtzeitig Geld, bevor du sie sendest.`,
              `Unsent buys${includeDrafts ? ' and drafts' : ''} need ${eur(p.unsentBuy)} at the exchange, ${eur(p.cashExchangeFree)} is free there right now. Transfer money in time before you send them.`)}</p>
          )}
          {p.cashUnknown.length > 0 && (
            <p className="notice notice-info">{tr(`Ohne Schlüssel kennt die App das Euro-Guthaben bei ${p.cashUnknown.map(exchangeName).join(', ')} nicht, es fehlt im Cash.`, `Without a key the app does not know the euro balance at ${p.cashUnknown.map(exchangeName).join(', ')}, it is missing from cash.`)}</p>
          )}

          <div className="space-y-4">
            <SectionCard title={tr('Aufteilung', 'Allocation')} action={
              <Segmented<'ist' | 'after'> value={view} onChange={setView} aria-label={tr('Aufteilung', 'Allocation')}
                options={[{ id: 'ist', label: tr('Ist', 'Now'), title: tr('So ist es heute', 'As it is today') }, { id: 'after', label: tr('Soll', 'Planned'), title: tr('Nachdem alle Pläne gelaufen sind', 'After all plans have run') }]} />}>
              <Donut slices={view === 'ist' ? p.ist : p.after} color={color} hidden={hidden} center={view === 'ist' ? tr('heute', 'today') : tr('nach allen Plänen', 'after all plans')} money={money} />
              <p className="mt-3 text-xs text-ink-muted">{view === 'ist'
                ? tr('Coins zum heutigen Kurs, Cash mit den Euro in offenen Kauforders.', 'Coins at today’s price, cash including euro in open buy orders.')
                : tr('Als wären alle offenen und geplanten Orders ausgeführt: Euro wandern vom Cash zum Coin. Reserve bleibt unberührt.', 'As if all open and planned orders were filled: euro moves from cash to the coin. The reserve stays untouched.')}</p>
            </SectionCard>

            <SectionCard title={tr('Je Coin', 'By coin')} action={
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" className="checkbox" checked={includeDrafts} onChange={(e) => saveDrafts(e.target.checked)} />
                {tr('Entwürfe mitzählen', 'Count drafts')}
              </label>}>
              {p.rows.length === 0 ? <p className="text-sm text-ink-muted">{tr('Noch keine Pläne oder Entwürfe. Sobald du einen Plan anlegst, erscheint er hier.', 'No plans or drafts yet. As soon as you create a plan, it shows up here.')}</p> : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr>
                      <th>Coin</th>
                      <th className="num">{tr('Ist: investiert', 'Invested')}</th>
                      <th className="num">{tr('Ø Einstand', 'Avg. cost')}</th>
                      <th className="num">{tr('Wert heute', 'Value today')}</th>
                      <th className="num">{tr('Soll: noch geplant', 'Still planned')}</th>
                      <th className="num">{tr('Fortschritt', 'Progress')}</th>
                    </tr></thead>
                    <tbody>
                      {p.rows.map((r) => (
                        <CoinLine key={r.coin} r={r} color={color(r.coin)} open={open === r.coin} onToggle={() => setOpen(open === r.coin ? null : r.coin)}
                          money={money} signed={signed} hidden={hidden} fmtPrice={(n, d) => `${fmtPrice(n, d)} ${sym}`} sources={sources ?? []} onOpenPlan={onOpenPlan} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-ink-muted">{tr('Ist zählt nur, was deine Pläne in dieser App gekauft haben, inklusive Gebühren. Verkaufspläne ziehen die verkaufte Menge ab. Klick auf eine Zeile zeigt die einzelnen Pläne.', 'Actual only counts what your plans in this app have bought, including fees. Sell plans subtract the sold amount. Click a row to see the single plans.')}</p>
            </SectionCard>
          </div>

          <CashCard sources={sources ?? []} pots={pots} onChange={savePots} money={money} />
        </div>
      )}
    </div>
  )
}

const pctSigned = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${pct(Math.abs(x))}`

function Coverage({ p, money }: { p: NonNullable<ReturnType<typeof buildPortfolio>>; money: (n: number) => string }) {
  if (p.buyNeed <= 0) return <Kpi label={tr('Pläne gedeckt?', 'Plans covered?')} value={tr('Nichts offen', 'Nothing open')} sub={tr('keine offenen Kaufpläne', 'no open buy plans')} />
  const ok = p.shortfall <= 0.005
  return (
    <div className="card min-w-0 p-3">
      <p className="text-xs text-ink-muted">{tr('Pläne gedeckt?', 'Plans covered?')}</p>
      <p className={`truncate text-lg font-semibold ${ok ? 'text-success-fg' : 'text-danger-fg'}`}>{ok ? tr('Ja', 'Yes') : tr(`Es fehlen ${money(p.shortfall)}`, `${money(p.shortfall)} short`)}</p>
      <p className="truncate text-xs text-ink-muted" title={tr('Reserve-Töpfe zählen nicht mit. Erlöse aus geplanten Verkäufen zählen mit.', 'Reserve pots do not count. Proceeds from planned sells count.')}>
        {tr(`braucht ${money(p.buyNeed)}, da: ${money(p.buyCash)}`, `needs ${money(p.buyNeed)}, have ${money(p.buyCash)}`)}
      </p>
    </div>
  )
}

function Donut({ slices, color, hidden, center, money }: { slices: PortfolioSlice[]; color: (key: string) => string; hidden: boolean; center: string; money: (n: number) => string }) {
  const t = useChartTheme()
  const share = shares(slices)
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (total <= 0) return <p className="py-10 text-center text-sm text-ink-muted">{tr('Noch nichts zu zeigen. Trag unten Cash ein oder leg einen Plan an.', 'Nothing to show yet. Add cash below or create a plan.')}</p>
  return (
    <>
      <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-52 w-52 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="95%" startAngle={90} endAngle={-270} paddingAngle={slices.length > 1 ? 1 : 0} isAnimationActive={false} stroke={t.dark ? '#0b0f17' : '#ffffff'}>
              {slices.map((s) => <Cell key={s.key} fill={color(s.key)} />)}
            </Pie>
            {!hidden && <Tooltip formatter={(v) => money(Number(v))} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-ink-muted">{center}</span>
          <span className="text-lg font-semibold tabular-nums">{money(total)}</span>
        </div>
      </div>
      <ul className="min-w-0 max-w-md flex-1 basis-56 space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: color(s.key) }} />
            <span className="min-w-0 flex-1 truncate">{s.label === 'Cash' ? 'Cash' : s.label === 'Reserve' ? tr('Reserve', 'Reserve') : s.label}</span>
            <span className="tabular-nums text-ink-muted">{hidden ? MASK : money(s.value)}</span>
            <span className="w-14 text-right font-medium tabular-nums">{num(share[s.key], 1)} %</span>
          </li>
        ))}
      </ul>
      </div>
    </>
  )
}

function CoinLine({ r, color, open, onToggle, money, signed, hidden, fmtPrice, sources, onOpenPlan }: {
  r: CoinRow; color: string; open: boolean; onToggle: () => void; money: (n: number) => string; signed: (n: number) => string; hidden: boolean
  fmtPrice: (n: number, d: number) => string; sources: PortfolioSource[]; onOpenPlan: (id: string) => void
}) {
  const what = [
    r.plans ? tr(`${r.plans} ${r.plans === 1 ? 'Plan' : 'Pläne'}`, `${r.plans} ${r.plans === 1 ? 'plan' : 'plans'}`) : '',
    r.drafts ? tr(`${r.drafts} ${r.drafts === 1 ? 'Entwurf' : 'Entwürfe'}`, `${r.drafts} ${r.drafts === 1 ? 'draft' : 'drafts'}`) : '',
    r.exchanges.length > 1 ? tr(`${r.exchanges.length} Börsen`, `${r.exchanges.length} exchanges`) : exchangeName(r.exchanges[0]),
  ].filter(Boolean).join(' · ')
  const sollParts = [
    r.openCount ? tr(`${r.openCount} offene Orders`, `${r.openCount} open orders`) : '',
    r.heldZoneCount ? tr(`${r.heldZoneCount} ${r.heldZoneCount === 1 ? 'Zone' : 'Zonen'} pausiert`, `${r.heldZoneCount} ${r.heldZoneCount === 1 ? 'zone' : 'zones'} paused`) : '',
    r.draftEur && !hidden ? tr(`Entwürfe ${signed(r.draftEur)}`, `drafts ${signed(r.draftEur)}`) : '',
  ].filter(Boolean).join(', ')
  const pnlTone = r.pnl === null ? '' : r.pnl >= 0 ? 'text-success-fg' : 'text-danger-fg'
  const decimals = r.price !== null && r.price < 10 ? 4 : 2
  return (
    <>
      <tr className="cursor-pointer align-top" onClick={onToggle} aria-expanded={open}>
        <td>
          <span className="flex items-center gap-2 font-semibold">
            {open ? <ChevronDown size={14} className="text-ink-muted" /> : <ChevronRight size={14} className="text-ink-muted" />}
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{r.coin}
          </span>
          <span className="block whitespace-nowrap pl-[22px] text-xs text-ink-muted">{what}</span>
        </td>
        <td className="num">
          {r.invested > 0 ? money(r.invested) : '–'}
          {r.heldVolume > 0 && <span className="block text-xs text-ink-muted">{hidden ? MASK : `${num(r.heldVolume, 8)} ${r.coin}`}</span>}
          {r.fees > 0 && !hidden && <span className="block text-xs text-ink-muted">{tr(`Gebühren ${money(r.fees)}`, `fees ${money(r.fees)}`)}</span>}
          {r.unknown && <span className="block text-xs text-warning-fg">{tr('Stand unbekannt', 'status unknown')}</span>}
          {r.soldOutside && <span className="block text-xs text-ink-muted" title={tr('Verkäufe aus Bestand, den du außerhalb dieser App gekauft hast, zählen hier nicht mit.', 'Sales from holdings you bought outside this app are not counted here.')}>{tr('mehr verkauft als hier gekauft', 'sold more than bought here')}</span>}
        </td>
        <td className="num">{r.avgPrice !== null ? fmtPrice(r.avgPrice, decimals) : '–'}<span className="block text-xs text-ink-muted">{r.price !== null ? tr(`Kurs ${fmtPrice(r.price, decimals)}`, `price ${fmtPrice(r.price, decimals)}`) : ''}</span></td>
        <td className="num">{r.value !== null && r.heldVolume > 0 ? money(r.value) : '–'}{r.pnlPct !== null && <span className={`block text-xs ${pnlTone}`}>{hidden ? pctSigned(r.pnlPct) : `${signed(r.pnl ?? 0)} (${pctSigned(r.pnlPct)})`}</span>}</td>
        <td className="num">{r.soll !== 0 ? signed(r.soll) : '–'}<span className="ml-auto block max-w-[13rem] whitespace-normal text-xs text-ink-muted">{sollParts}</span></td>
        <td className="num w-28">
          {r.progress !== null ? (
            <>
              {num(r.progress * 100, 0)} %
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full" style={{ background: `${color}33` }}>
                <span className="block h-full rounded-full" style={{ width: `${Math.min(100, r.progress * 100)}%`, background: color }} />
              </span>
            </>
          ) : '–'}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-sunken-soft">
            <PlanList coin={r.coin} sources={sources} onOpenPlan={onOpenPlan} money={money} />
          </td>
        </tr>
      )}
    </>
  )
}

function PlanList({ coin, sources, onOpenPlan, money }: { coin: string; sources: PortfolioSource[]; onOpenPlan: (id: string) => void; money: (n: number) => string }) {
  const active = activeExchange()
  const items = sources.flatMap((s) => {
    const status = new Map(s.status.map((x) => [x.userref, x]))
    const names = new Map(s.drafts.filter((d) => d.userref).map((d) => [d.userref, d.name]))
    return [
      ...s.plans.filter((p) => p.pairName.split('/')[0] === coin).map((p) => {
        const st = status.get(p.userref)
        const levels = p.levels?.length ?? p.sent
        return {
          id: `p:${p.userref}`, ex: s.exchange, at: p.createdAt,
          title: `${names.get(p.userref) ?? p.pairName} · ${p.side === 'buy' ? tr('Kauf', 'buy') : tr('Verkauf', 'sell')}`,
          info: st ? tr(`${st.filled} von ${levels} Stufen ausgeführt, ${st.open} offen`, `${st.filled} of ${levels} levels filled, ${st.open} open`) : tr('Stand unbekannt', 'status unknown'),
          amount: st ? st.filledCost : 0,
        }
      }),
      ...s.drafts.filter((d) => d.pairName.split('/')[0] === coin).map((d) => ({
        id: `d:${d.id}`, ex: s.exchange, at: d.updatedAt || d.createdAt,
        title: `${d.name} · ${tr('Entwurf', 'draft')}`, info: d.pairName, amount: 0,
      })),
    ]
  }).sort((a, b) => b.at.localeCompare(a.at))
  return (
    <ul className="divide-y divide-line text-sm">
      {items.map((it) => (
        <li key={`${it.ex}-${it.id}`} className="flex flex-wrap items-center gap-3 py-1.5">
          <span className="min-w-0 flex-1 truncate font-medium">{it.title}</span>
          <span className="text-xs text-ink-muted">{exchangeName(it.ex)}</span>
          <span className="text-xs text-ink-muted">{it.info}{it.amount > 0 ? ` · ${money(it.amount)}` : ''}</span>
          {it.ex === active
            ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenPlan(it.id)}>{tr('Öffnen', 'Open')} <ChevronRight size={14} /></button>
            : <span className="text-xs text-ink-faint" title={tr(`Zum Öffnen oben auf ${exchangeName(it.ex)} wechseln`, `Switch to ${exchangeName(it.ex)} at the top to open it`)}>{tr(`auf ${exchangeName(it.ex)}`, `on ${exchangeName(it.ex)}`)}</span>}
        </li>
      ))}
    </ul>
  )
}

function CashCard({ sources, pots, onChange, money }: { sources: PortfolioSource[]; pots: CashPot[]; onChange: (p: CashPot[]) => void; money: (n: number) => string }) {
  const add = () => onChange([...pots, { id: `pot-${Date.now().toString(36)}`, name: pots.length ? tr('Neuer Topf', 'New pot') : tr('Tagesgeld', 'Savings account'), amount: 0 }])
  const update = (id: string, patch: Partial<CashPot>) => onChange(pots.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  return (
    <SectionCard title="Cash" action={pots.length < MAX_CASH_POTS && <button type="button" className="btn btn-secondary btn-sm" onClick={add}><Plus size={14} /> {tr('Topf hinzufügen', 'Add pot')}</button>}>
      <p className="mb-3 text-xs text-ink-muted">{tr('Euro bei den Börsen liest die App selbst. Geld anderswo (Tagesgeld, Girokonto) trägst du hier ein. Ein Topf als „Reserve“ zählt in der Torte extra und nicht für Käufe. Alles bleibt nur auf deinem Mac.', 'The app reads euro at the exchanges itself. Money elsewhere (savings, current account) you enter here. A pot marked “reserve” shows separately in the chart and does not count for buys. Everything stays on your Mac.')}</p>
      <ul className="divide-y divide-line text-sm">
        {sources.filter((s) => s.hasKey || s.eurTotal !== null).map((s) => (
          <li key={s.exchange} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">{exchangeName(s.exchange)}</span>
            {s.eurTotal === null ? <span className="text-ink-muted">{tr('nicht geladen', 'not loaded')}</span> : (
              <span className="tabular-nums">{money(s.eurTotal)}{s.eurFree !== null && s.eurTotal - s.eurFree > 0.005 && <span className="ml-1 text-xs text-ink-muted">{tr(`davon ${money(s.eurTotal - s.eurFree)} in Orders`, `${money(s.eurTotal - s.eurFree)} in orders`)}</span>}</span>
            )}
          </li>
        ))}
        {pots.map((pot) => (
          <li key={pot.id} className="flex flex-wrap items-center gap-3 py-2">
            <input className="input input-sm min-w-0 flex-1 basis-40" value={pot.name} maxLength={60} aria-label={tr('Name des Topfs', 'Pot name')} onChange={(e) => update(pot.id, { name: e.target.value })} />
            <label className="flex items-center gap-1.5 text-xs text-ink-muted" title={tr('Notgroschen: zählt nicht für Käufe', 'Emergency fund: does not count for buys')}>
              <input type="checkbox" className="checkbox" checked={!!pot.reserve} onChange={(e) => update(pot.id, { reserve: e.target.checked || undefined })} /> {tr('Reserve', 'Reserve')}
            </label>
            <AmountField value={pot.amount} onChange={(amount) => update(pot.id, { amount })} />
            <button type="button" className="btn-mini" aria-label={tr('Topf löschen', 'Delete pot')} title={tr('Löschen', 'Delete')} onClick={() => onChange(pots.filter((p) => p.id !== pot.id))}><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
      {pots.length === 0 && <p className="mt-2 text-xs text-ink-muted">{tr('Noch kein eigener Topf. Mit „Topf hinzufügen“ trägst du zum Beispiel dein Tagesgeld ein.', 'No own pot yet. Use “Add pot” to enter your savings account, for example.')}</p>}
    </SectionCard>
  )
}

/** Euro-Betrag im gewählten Zahlenformat, übernimmt den Wert beim Verlassen des Felds */
function AmountField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const fmt = numberFormat()
  const [text, setText] = useState(toInputText(value, fmt, true))
  useEffect(() => setText(toInputText(value, fmt, true)), [value, fmt])
  const parsed = parseNumber(text, fmt)
  const invalid = text.trim() !== '' && (Number.isNaN(parsed) || parsed < 0)
  const commit = () => {
    const n = text.trim() === '' ? 0 : parsed
    if (!Number.isNaN(n) && n >= 0 && n !== value) onChange(n)
  }
  return (
    <span className="flex items-center gap-1">
      <input className={`input input-sm w-36 text-right tabular-nums ${invalid ? 'border-danger-500' : ''}`} inputMode="decimal" value={text} aria-label={tr('Betrag in Euro', 'Amount in euro')} aria-invalid={invalid}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      <span className="text-ink-muted">€</span>
    </span>
  )
}
