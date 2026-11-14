import { api } from '../api'
import { Fragment, useEffect, useState } from 'react'
import { OctagonX, RefreshCw, Send, TrendingUp, X } from 'lucide-react'
import { assetLabel } from '@shared/safety'
import type { OpenOrderDto, PlanDto, PlanStatusDto } from '@shared/ipc'
import { profitLadderSuggestion } from '@shared/plan-status'
import type { Prefill } from './PlannerPage'
import SectionCard from '../components/ui/SectionCard'
import Modal from '../components/ui/Modal'
import { dateLocale, num } from '../format'
import { tr } from '@shared/i18n'
import { useMoney } from '../money'
import { activeExchange, exName, probeOk } from '@shared/exchanges'

export default function OrdersPage({ hasKey, onPlanSell }: { hasKey: boolean; onPlanSell: (p: Prefill) => void }): JSX.Element {
  const [orders, setOrders] = useState<OpenOrderDto[] | null>(null)
  const [plans, setPlans] = useState<PlanDto[]>([])
  /** Nachkommastellen je Paar, damit günstige Coins (DOGE 0,1234567) nicht auf 0,12 gekürzt werden */
  const [decimals, setDecimals] = useState<Record<string, number>>({})
  const dec = (pairId: string) => decimals[pairId] ?? 2
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [cancelPlan, setCancelPlan] = useState<PlanDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Record<number, PlanStatusDto>>({})
  const { eur, fmtPrice, sym } = useMoney()
  const [restPlan, setRestPlan] = useState<PlanDto | null>(null)
  const [restMsg, setRestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [brake, setBrake] = useState(false)
  const [brakeMsg, setBrakeMsg] = useState<string | null>(null)

  async function emergencyStop() {
    setBusy(true)
    try {
      const n = await api().cancelAll()
      setBrakeMsg(tr(`Notbremse ausgeführt: ${n} ${n === 1 ? 'Order' : 'Orders'} storniert.`, `Emergency stop done: ${n} ${n === 1 ? 'order' : 'orders'} cancelled.`))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
    setBrake(false)
    load()
  }

  // Guthaben nach Coin zusammenfassen: normal handelbar und in Earn getrennt
  const balanceRows = Object.entries(balances).reduce<Record<string, { spot: number; earn: number; earnLabel?: string }>>((acc, [code, v]) => {
    // Nur Kraken hat Kürzel wie XXBT oder BTC.F, die anderen Börsen nennen Coins schon lesbar
    const { name, earn } = activeExchange() === 'kraken' ? assetLabel(code) : { name: code, earn: undefined }
    const row = (acc[name] ??= { spot: 0, earn: 0 })
    if (earn) { row.earn += v; row.earnLabel = earn } else row.spot += v
    return acc
  }, {})

  async function load() {
    setError(null)
    api().plans().then(setPlans).catch(() => {})
    api().pairs().then((ps) => setDecimals(Object.fromEntries(ps.map((x) => [x.id, x.priceDecimals])))).catch(() => {})
    if (!hasKey) return
    try {
      const [o, b] = await Promise.all([api().openOrders(), api().balances()])
      setOrders(o)
      setBalances(b)
      const st = await api().planStatus()
      setStatus(Object.fromEntries(st.map((x) => [x.userref, x])))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
    // neue Ausführungen (Meldung aus dem Hauptprozess) sofort anzeigen
    return api().onFills(() => load())
  }, [hasKey])

  function sellLadder(p: PlanDto, st: PlanStatusDto) {
    const s = profitLadderSuggestion(st.averagePrice, st.filledVolume)
    onPlanSell({
      pairId: p.pairId,
      input: { ...p.input, side: 'sell', priceStart: +s.priceStart.toPrecision(6), priceEnd: +s.priceEnd.toPrecision(6), total: s.total, curve: 'linear', ratio: 2, customWeights: undefined, orderCenter: undefined, volumeCenter: undefined },
    })
  }

  async function doCancelPlan(p: PlanDto) {
    setBusy(true)
    try {
      await api().cancelPlan(p.userref)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
    setCancelPlan(null)
    load()
  }

  async function cancelOne(txid: string) {
    try {
      await api().cancelOrder(txid)
    } catch (e) {
      setError((e as Error).message)
    }
    load()
  }

  const restLevels = (p: PlanDto) => {
    const sent = new Set(p.sentIndices ?? [])
    return (p.levels ?? []).filter((l) => !sent.has(l.index))
  }

  async function sendRest(p: PlanDto, validate: boolean) {
    setBusy(true)
    setRestMsg(null)
    try {
      const r = await api().sendRest(p.userref, validate)
      const failed = r.orders.filter((o) => o.error)
      const ok = r.orders.length - failed.length
      setRestMsg(failed.length
        ? { ok: false, text: tr(`${validate ? 'Probelauf' : 'Senden'}: ${failed.length} von ${r.orders.length} Orders abgelehnt. Grund: ${failed[0].error}`, `${validate ? 'Test run' : 'Send'}: ${failed.length} of ${r.orders.length} orders rejected. Reason: ${failed[0].error}`) }
        : { ok: true, text: validate ? probeOk(ok) : tr(`${ok} weitere Orders angelegt.`, `${ok} more orders placed.`) })
      if (r.orders.some((o) => o.uncertain)) setRestMsg({ ok: false, text: tr('Die Verbindung brach beim Senden ab. Klicke auf „Aktualisieren“ und prüfe, was wirklich angelegt wurde, bevor du noch einmal sendest.', 'The connection dropped while sending. Click “Refresh” and check what was really placed before you send again.') })
      if (!validate) {
        setRestPlan(null)
        load()
      }
    } catch (e) {
      setRestMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(false)
  }

  const hasActions = (p: PlanDto, st: PlanStatusDto | undefined, open: number) =>
    restLevels(p).length > 0 || (p.side === 'buy' && !!st && st.filledVolume > 0) || open > 0

  const openByPlan = (ref: number) => orders?.filter((o) => o.userref === ref).length ?? 0

  return (
    <div className="page">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">{tr('Offene Orders', 'Open orders')}</h1>
          <p className="page-subtitle">{tr(`Was gerade bei ${exName()} liegt, nach Plänen gruppiert.`, `What is currently at ${exName()}, grouped by plan.`)}</p>
        </div>
        <div className="ml-auto flex flex-shrink-0 gap-2">
          {hasKey && <button type="button" className="btn btn-outline text-danger-fg" onClick={() => { setBrakeMsg(null); setBrake(true) }} title={tr('Alle offenen Orders auf allen verbundenen Börsen auf einmal stornieren', 'Cancel all open orders on all connected exchanges at once')}><OctagonX size={16} /> {tr('Notbremse', 'Emergency stop')}</button>}
          <button type="button" className="btn btn-secondary" onClick={load}><RefreshCw size={16} /> {tr('Aktualisieren', 'Refresh')}</button>
        </div>
      </header>
      {!hasKey && <p className="notice notice-info mb-4">{tr(`Hinterlege zuerst im Reiter „Schlüssel“ einen ${exName()}-API-Schlüssel.`, `First add a ${exName()} API key in the “API key” tab.`)}</p>}
      {error && <p className="notice notice-danger mb-4">{error}</p>}
      {brakeMsg && <p className="notice notice-success mb-4">{brakeMsg}</p>}
      {restMsg && !restPlan && <p className={`notice mb-4 ${restMsg.ok ? 'notice-success' : 'notice-danger'}`}>{restMsg.text}</p>}

      <div className="space-y-4">
        {Object.keys(balances).length > 0 && (
          <SectionCard title={tr('Guthaben', 'Balances')}>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Coin</th><th className="num">{tr('Handelbar', 'Tradable')}</th><th className="num">{tr('In Earn', 'In Earn')}</th></tr></thead>
                <tbody>
                  {Object.entries(balanceRows).sort(([a], [b]) => (a === 'EUR' ? -1 : b === 'EUR' ? 1 : a.localeCompare(b))).map(([name, r]) => (
                    <tr key={name}>
                      <td className="font-medium">{name}</td>
                      <td className="num">{name === 'EUR' ? eur(r.spot) : num(r.spot, 8)}</td>
                      <td className="num text-ink-muted">{r.earn > 0 ? <span title={r.earnLabel}>{name === 'EUR' ? eur(r.earn) : num(r.earn, 8)}</span> : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.values(balanceRows).some((r) => r.earn > 0) && <p className="mt-2 text-xs text-ink-muted">{tr('„In Earn“ ist Guthaben in Krakens Belohnungsprogramm (Staking). Gebundenes Guthaben lässt sich nicht sofort verkaufen.', '“In Earn” is balance in Kraken’s rewards program (staking). Bonded balance cannot be sold right away.')}</p>}
          </SectionCard>
        )}

        <div data-guide="plans"><SectionCard title={tr('Pläne', 'Plans')}>
          {plans.length === 0 ? <p className="text-sm text-ink-muted">{tr('Noch keine Pläne gesendet.', 'No plans sent yet.')}</p> : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{tr('Datum', 'Date')}</th><th>Plan</th><th className="num">{tr('Gesendet', 'Sent')}</th><th className="num">{tr('Noch offen', 'Still open')}</th><th className="num">{tr('Ausgeführt', 'Filled')}</th><th className="num">{tr('Ø Preis', 'Avg. price')}</th><th className="num">{tr('Gegenwert', 'Value')}</th></tr></thead>
                <tbody>
                  {plans.map((p) => {
                    const open = openByPlan(p.userref)
                    const st = status[p.userref]
                    return (
                      <Fragment key={p.userref}>
                      <tr className={hasActions(p, st, open) ? '[&>td]:border-b-0' : ''}>
                        <td className="whitespace-nowrap tabular-nums">{new Date(p.createdAt).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="whitespace-nowrap">{p.pairName} <span className="text-ink-muted">{p.side === 'buy' ? tr('Kauf', 'buy') : tr('Verkauf', 'sell')}</span></td>
                        <td className="num">{p.levels ? `${p.sent} / ${p.levels.length}` : p.sent}</td>
                        <td className="num">{orders ? open : '–'}</td>
                        <td className="num">
                          {st ? <span className={st.filled + st.partial > 0 ? 'text-success-fg' : ''}>{st.filled}{st.partial ? ` + ${st.partial} ${tr('teilw.', 'partial')}` : ''}</span> : '–'}
                        </td>
                        <td className="num">{st && st.averagePrice ? `${fmtPrice(st.averagePrice, dec(p.pairId))} ${sym}` : '–'}</td>
                        <td className="num">{eur(p.totalCost)}</td>
                      </tr>
                      {hasActions(p, st, open) && (
                        <tr>
                          <td colSpan={7} className="pt-0">
                            <span className="inline-flex gap-2">
                              {restLevels(p).length > 0 && (
                                <button type="button" className="btn btn-secondary btn-sm whitespace-nowrap" onClick={() => { setRestMsg(null); setRestPlan(p) }} title={tr(`Die noch nicht gesendeten Stufen dieses Plans an ${exName()} schicken`, `Send the levels of this plan that have not been sent yet to ${exName()}`)}>
                                  <Send size={14} /> {tr('Rest senden', 'Send rest')} ({restLevels(p).length})
                                </button>
                              )}
                              {p.side === 'buy' && st && st.filledVolume > 0 && (
                                <button type="button" className="btn btn-secondary btn-sm whitespace-nowrap" onClick={() => sellLadder(p, st)} title={tr('Verkaufsstaffel 10–50 % über deinem Kaufpreis vorschlagen', 'Suggest a sell ladder 10–50 % above your buy price')}><TrendingUp size={14} /> {tr('Gewinnstaffel', 'Profit ladder')}</button>
                              )}
                              {open > 0 && <button type="button" className="btn btn-outline btn-sm whitespace-nowrap" onClick={() => setCancelPlan(p)}>{tr('Stornieren', 'Cancel')}</button>}
                            </span>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard></div>

        {orders && (
          <SectionCard title={tr(`Alle offenen Orders (${orders.length})`, `All open orders (${orders.length})`)}>
            {orders.length === 0 ? <p className="text-sm text-ink-muted">{tr('Keine offenen Orders.', 'No open orders.')}</p> : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>{tr('Paar', 'Pair')}</th><th>{tr('Richtung', 'Side')}</th><th className="num">{tr('Preis', 'Price')}</th><th className="num">{tr('Menge', 'Volume')}</th><th className="num">{tr('Ausgeführt', 'Filled')}</th><th>Plan</th><th /></tr></thead>
                  <tbody>
                    {orders.sort((a, b) => b.price - a.price).map((o) => (
                      <tr key={o.txid}>
                        <td>{o.pair}</td>
                        <td>{o.side === 'buy' ? tr('Kauf', 'Buy') : tr('Verkauf', 'Sell')}</td>
                        <td className="num">{fmtPrice(o.price, 8)}</td>
                        <td className="num">{num(o.volume, 8)}</td>
                        <td className="num">{num(o.filled, 8)}</td>
                        <td className="tabular-nums text-ink-muted">{o.userref || '–'}</td>
                        <td className="text-right"><button type="button" className="btn-mini" aria-label={tr('Order stornieren', 'Cancel order')} title={tr('Order stornieren', 'Cancel order')} onClick={() => cancelOne(o.txid)}><X size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}
      </div>

      {restPlan && (
        <Modal title={tr('Restliche Stufen senden?', 'Send the remaining levels?')} size="sm" onClose={() => !busy && setRestPlan(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => sendRest(restPlan, true)}>{tr('Probelauf', 'Test run')}</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => sendRest(restPlan, false)}>{busy ? tr('Sende …', 'Sending …') : tr(`${restLevels(restPlan).length} Orders senden`, `Send ${restLevels(restPlan).length} orders`)}</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p>
              {restPlan.side === 'buy' ? tr('Kaufen', 'Buy') : tr('Verkaufen', 'Sell')} {restPlan.pairName}: {restLevels(restPlan).length} {tr('Stufen von', 'levels from')}{' '}
              {fmtPrice(restLevels(restPlan)[0].price, dec(restPlan.pairId))} {tr('bis', 'to')} {fmtPrice(restLevels(restPlan)[restLevels(restPlan).length - 1].price, dec(restPlan.pairId))} {sym}.
            </p>
            <p>{tr('Gegenwert', 'Value')}: <strong>{eur(restLevels(restPlan).reduce((a, l) => a + l.cost, 0))}</strong></p>
            <p className="text-ink-muted">{tr('Die Stufen wurden beim Planen berechnet. Liegt der Kurs inzwischen woanders, prüfe sie vorher mit dem Probelauf.', 'The levels were calculated when planning. If the price has moved since, check them first with a test run.')}</p>
            {restMsg && <p className={`notice ${restMsg.ok ? 'notice-success' : 'notice-danger'}`}>{restMsg.text}</p>}
          </div>
        </Modal>
      )}

      {brake && (
        <Modal title={tr('Notbremse: alle Orders stornieren?', 'Emergency stop: cancel all orders?')} size="sm" onClose={() => !busy && setBrake(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setBrake(false)}>{tr('Abbrechen', 'Cancel')}</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={emergencyStop}>{busy ? tr('Storniere …', 'Cancelling …') : tr('Alle stornieren', 'Cancel all')}</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p>{tr(
              <>Storniert <strong>alle offenen Orders</strong> auf <strong>allen Börsen</strong>, für die ein Schlüssel hinterlegt ist, auf einmal{orders ? ` (bei ${exName()} gerade ${orders.length})` : ''}, auch solche, die du nicht mit dieser App angelegt hast.</>,
              <>Cancels <strong>all open orders</strong> on <strong>all exchanges</strong> with a saved key at once{orders ? ` (currently ${orders.length} at ${exName()})` : ''}, including ones you did not place with this app.</>,
            )}</p>
            <p className="text-ink-muted">{tr('Bereits ausgeführte Käufe und Verkäufe bleiben bestehen. Noch nicht gesendete Stufen deiner Pläne bleiben in der App und gehen nicht raus.', 'Buys and sells already filled stay as they are. Levels of your plans that were not sent yet stay in the app and do not go out.')}</p>
          </div>
        </Modal>
      )}

      {cancelPlan && (
        <Modal title={tr('Plan stornieren?', 'Cancel plan?')} size="sm" onClose={() => !busy && setCancelPlan(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setCancelPlan(null)}>{tr('Abbrechen', 'Back')}</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => doCancelPlan(cancelPlan)}>{busy ? tr('Storniere …', 'Cancelling …') : tr('Stornieren', 'Cancel plan')}</button>
          </>}>
          <p className="text-sm">{tr(
            `Alle noch offenen Orders dieses Plans (${cancelPlan.pairName}, ${openByPlan(cancelPlan.userref)} Stück) werden bei ${exName()} storniert. Bereits ausgeführte Käufe oder Verkäufe bleiben bestehen.`,
            `All still open orders of this plan (${cancelPlan.pairName}, ${openByPlan(cancelPlan.userref)} orders) will be cancelled at ${exName()}. Buys or sells already filled stay as they are.`,
          )}</p>
        </Modal>
      )}
    </div>
  )
}
