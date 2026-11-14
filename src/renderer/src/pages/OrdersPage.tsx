import { api } from '../api'
import { Fragment, useEffect, useState } from 'react'
import { OctagonX, RefreshCw, Send, TrendingUp, X } from 'lucide-react'
import { assetLabel } from '@shared/safety'
import type { OpenOrderDto, PlanDto, PlanStatusDto } from '@shared/ipc'
import { profitLadderSuggestion } from '@shared/plan-status'
import type { Prefill } from './PlannerPage'
import SectionCard from '../components/ui/SectionCard'
import Modal from '../components/ui/Modal'
import { num } from '../format'
import { useMoney } from '../money'

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
      setBrakeMsg(`Notbremse ausgeführt: ${n} ${n === 1 ? 'Order' : 'Orders'} storniert.`)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
    setBrake(false)
    load()
  }

  // Guthaben nach Coin zusammenfassen: normal handelbar und in Earn getrennt
  const balanceRows = Object.entries(balances).reduce<Record<string, { spot: number; earn: number; earnLabel?: string }>>((acc, [code, v]) => {
    const { name, earn } = assetLabel(code)
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
      input: { ...p.input, side: 'sell', priceStart: +s.priceStart.toPrecision(6), priceEnd: +s.priceEnd.toPrecision(6), total: s.total, curve: 'linear', ratio: 2, customWeights: undefined },
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
        ? { ok: false, text: `${validate ? 'Probelauf' : 'Senden'}: ${failed.length} von ${r.orders.length} Orders abgelehnt. Grund: ${failed[0].error}` }
        : { ok: true, text: validate ? `Probelauf erfolgreich: Kraken würde alle ${ok} Orders annehmen.` : `${ok} weitere Orders angelegt.` })
      if (r.orders.some((o) => o.uncertain)) setRestMsg({ ok: false, text: 'Die Verbindung brach beim Senden ab. Klicke auf „Aktualisieren“ und prüfe, was wirklich angelegt wurde, bevor du noch einmal sendest.' })
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
          <h1 className="page-title">Offene Orders</h1>
          <p className="page-subtitle">Was gerade bei Kraken liegt, nach Plänen gruppiert.</p>
        </div>
        <div className="ml-auto flex flex-shrink-0 gap-2">
          {hasKey && <button type="button" className="btn btn-outline text-danger-fg" onClick={() => { setBrakeMsg(null); setBrake(true) }} title="Alle offenen Orders bei Kraken auf einmal stornieren"><OctagonX size={16} /> Notbremse</button>}
          <button type="button" className="btn btn-secondary" onClick={load}><RefreshCw size={16} /> Aktualisieren</button>
        </div>
      </header>
      {!hasKey && <p className="notice notice-info mb-4">Hinterlege zuerst im Reiter „Schlüssel“ einen Kraken-API-Schlüssel.</p>}
      {error && <p className="notice notice-danger mb-4">{error}</p>}
      {brakeMsg && <p className="notice notice-success mb-4">{brakeMsg}</p>}
      {restMsg && !restPlan && <p className={`notice mb-4 ${restMsg.ok ? 'notice-success' : 'notice-danger'}`}>{restMsg.text}</p>}

      <div className="space-y-4">
        {Object.keys(balances).length > 0 && (
          <SectionCard title="Guthaben">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Coin</th><th className="num">Handelbar</th><th className="num">In Earn</th></tr></thead>
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
            {Object.values(balanceRows).some((r) => r.earn > 0) && <p className="mt-2 text-xs text-ink-muted">„In Earn“ ist Guthaben in Krakens Belohnungsprogramm (Staking). Gebundenes Guthaben lässt sich nicht sofort verkaufen.</p>}
          </SectionCard>
        )}

        <div data-guide="plans"><SectionCard title="Pläne">
          {plans.length === 0 ? <p className="text-sm text-ink-muted">Noch keine Pläne gesendet.</p> : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Datum</th><th>Plan</th><th className="num">Gesendet</th><th className="num">Noch offen</th><th className="num">Ausgeführt</th><th className="num">Ø Preis</th><th className="num">Gegenwert</th></tr></thead>
                <tbody>
                  {plans.map((p) => {
                    const open = openByPlan(p.userref)
                    const st = status[p.userref]
                    return (
                      <Fragment key={p.userref}>
                      <tr className={hasActions(p, st, open) ? '[&>td]:border-b-0' : ''}>
                        <td className="whitespace-nowrap tabular-nums">{new Date(p.createdAt).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="whitespace-nowrap">{p.pairName} <span className="text-ink-muted">{p.side === 'buy' ? 'Kauf' : 'Verkauf'}</span></td>
                        <td className="num">{p.levels ? `${p.sent} / ${p.levels.length}` : p.sent}</td>
                        <td className="num">{orders ? open : '–'}</td>
                        <td className="num">
                          {st ? <span className={st.filled + st.partial > 0 ? 'text-success-fg' : ''}>{st.filled}{st.partial ? ` + ${st.partial} teilw.` : ''}</span> : '–'}
                        </td>
                        <td className="num">{st && st.averagePrice ? `${fmtPrice(st.averagePrice, dec(p.pairId))} ${sym}` : '–'}</td>
                        <td className="num">{eur(p.totalCost)}</td>
                      </tr>
                      {hasActions(p, st, open) && (
                        <tr>
                          <td colSpan={7} className="pt-0">
                            <span className="inline-flex gap-2">
                              {restLevels(p).length > 0 && (
                                <button type="button" className="btn btn-secondary btn-sm whitespace-nowrap" onClick={() => { setRestMsg(null); setRestPlan(p) }} title="Die noch nicht gesendeten Stufen dieses Plans an Kraken schicken">
                                  <Send size={14} /> Rest senden ({restLevels(p).length})
                                </button>
                              )}
                              {p.side === 'buy' && st && st.filledVolume > 0 && (
                                <button type="button" className="btn btn-secondary btn-sm whitespace-nowrap" onClick={() => sellLadder(p, st)} title="Verkaufsstaffel 10–50 % über deinem Kaufpreis vorschlagen"><TrendingUp size={14} /> Gewinnstaffel</button>
                              )}
                              {open > 0 && <button type="button" className="btn btn-outline btn-sm whitespace-nowrap" onClick={() => setCancelPlan(p)}>Stornieren</button>}
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
          <SectionCard title={`Alle offenen Orders (${orders.length})`}>
            {orders.length === 0 ? <p className="text-sm text-ink-muted">Keine offenen Orders.</p> : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Paar</th><th>Richtung</th><th className="num">Preis</th><th className="num">Menge</th><th className="num">Ausgeführt</th><th>Plan</th><th /></tr></thead>
                  <tbody>
                    {orders.sort((a, b) => b.price - a.price).map((o) => (
                      <tr key={o.txid}>
                        <td>{o.pair}</td>
                        <td>{o.side === 'buy' ? 'Kauf' : 'Verkauf'}</td>
                        <td className="num">{fmtPrice(o.price, 8)}</td>
                        <td className="num">{num(o.volume, 8)}</td>
                        <td className="num">{num(o.filled, 8)}</td>
                        <td className="tabular-nums text-ink-muted">{o.userref || '–'}</td>
                        <td className="text-right"><button type="button" className="btn-mini" aria-label="Order stornieren" title="Order stornieren" onClick={() => cancelOne(o.txid)}><X size={14} /></button></td>
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
        <Modal title="Restliche Stufen senden?" size="sm" onClose={() => !busy && setRestPlan(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => sendRest(restPlan, true)}>Probelauf</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => sendRest(restPlan, false)}>{busy ? 'Sende …' : `${restLevels(restPlan).length} Orders senden`}</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p>
              {restPlan.side === 'buy' ? 'Kaufen' : 'Verkaufen'} {restPlan.pairName}: {restLevels(restPlan).length} Stufen von{' '}
              {fmtPrice(restLevels(restPlan)[0].price, dec(restPlan.pairId))} bis {fmtPrice(restLevels(restPlan)[restLevels(restPlan).length - 1].price, dec(restPlan.pairId))} {sym}.
            </p>
            <p>Gegenwert: <strong>{eur(restLevels(restPlan).reduce((a, l) => a + l.cost, 0))}</strong></p>
            <p className="text-ink-muted">Die Stufen wurden beim Planen berechnet. Liegt der Kurs inzwischen woanders, prüfe sie vorher mit dem Probelauf.</p>
            {restMsg && <p className={`notice ${restMsg.ok ? 'notice-success' : 'notice-danger'}`}>{restMsg.text}</p>}
          </div>
        </Modal>
      )}

      {brake && (
        <Modal title="Notbremse: alle Orders stornieren?" size="sm" onClose={() => !busy && setBrake(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setBrake(false)}>Abbrechen</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={emergencyStop}>{busy ? 'Storniere …' : 'Alle stornieren'}</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p>Storniert <strong>alle offenen Orders</strong> in deinem Kraken-Konto auf einmal{orders ? ` (gerade ${orders.length})` : ''}, auch solche, die du nicht mit dieser App angelegt hast.</p>
            <p className="text-ink-muted">Bereits ausgeführte Käufe und Verkäufe bleiben bestehen. Noch nicht gesendete Stufen deiner Pläne bleiben in der App und gehen nicht raus.</p>
          </div>
        </Modal>
      )}

      {cancelPlan && (
        <Modal title="Plan stornieren?" size="sm" onClose={() => !busy && setCancelPlan(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setCancelPlan(null)}>Abbrechen</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => doCancelPlan(cancelPlan)}>{busy ? 'Storniere …' : 'Stornieren'}</button>
          </>}>
          <p className="text-sm">Alle noch offenen Orders dieses Plans ({cancelPlan.pairName}, {openByPlan(cancelPlan.userref)} Stück) werden bei Kraken storniert. Bereits ausgeführte Käufe oder Verkäufe bleiben bestehen.</p>
        </Modal>
      )}
    </div>
  )
}
