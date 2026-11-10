import { useEffect, useState } from 'react'
import { RefreshCw, TrendingUp, X } from 'lucide-react'
import type { OpenOrderDto, PlanDto, PlanStatusDto } from '@shared/ipc'
import { profitLadderSuggestion } from '@shared/plan-status'
import type { Prefill } from './PlannerPage'
import SectionCard from '../components/ui/SectionCard'
import Modal from '../components/ui/Modal'
import { eur, num } from '../format'

export default function OrdersPage({ hasKey, onPlanSell }: { hasKey: boolean; onPlanSell: (p: Prefill) => void }): JSX.Element {
  const [orders, setOrders] = useState<OpenOrderDto[] | null>(null)
  const [plans, setPlans] = useState<PlanDto[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [cancelPlan, setCancelPlan] = useState<PlanDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Record<number, PlanStatusDto>>({})

  async function load() {
    setError(null)
    window.api.plans().then(setPlans)
    if (!hasKey) return
    try {
      const [o, b] = await Promise.all([window.api.openOrders(), window.api.balances()])
      setOrders(o)
      setBalances(b)
      const st = await window.api.planStatus()
      setStatus(Object.fromEntries(st.map((x) => [x.userref, x])))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
    // neue Ausführungen (Meldung aus dem Hauptprozess) sofort anzeigen
    return window.api.onFills(() => load())
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
      await window.api.cancelPlan(p.userref)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
    setCancelPlan(null)
    load()
  }

  async function cancelOne(txid: string) {
    try {
      await window.api.cancelOrder(txid)
    } catch (e) {
      setError((e as Error).message)
    }
    load()
  }

  const openByPlan = (ref: number) => orders?.filter((o) => o.userref === ref).length ?? 0

  return (
    <div className="page">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">Offene Orders</h1>
          <p className="page-subtitle">Was gerade bei Kraken liegt, nach Plänen gruppiert.</p>
        </div>
        <button type="button" className="btn btn-secondary ml-auto" onClick={load}><RefreshCw size={16} /> Aktualisieren</button>
      </header>
      {!hasKey && <p className="notice notice-info mb-4">Hinterlege zuerst unter Einstellungen einen Kraken-API-Schlüssel.</p>}
      {error && <p className="notice notice-danger mb-4">{error}</p>}

      <div className="space-y-4">
        {Object.keys(balances).length > 0 && (
          <SectionCard title="Guthaben">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {Object.entries(balances).map(([k, v]) => <span key={k}><span className="text-ink-muted">{k.replace(/^Z(EUR|USD)$/, '$1').replace(/^XXBT$/, 'BTC').replace(/^X(ETH|XRP|LTC)$/, '$1')}</span> <span className="tabular-nums">{num(v, 8)}</span></span>)}
            </div>
          </SectionCard>
        )}

        <SectionCard title="Pläne">
          {plans.length === 0 ? <p className="text-sm text-ink-muted">Noch keine Pläne gesendet.</p> : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Datum</th><th>Paar</th><th>Richtung</th><th className="num">Gesendet</th><th className="num">Noch offen</th><th className="num">Ausgeführt</th><th className="num">Ø Preis</th><th className="num">Gegenwert</th><th /></tr></thead>
                <tbody>
                  {plans.map((p) => {
                    const open = openByPlan(p.userref)
                    const st = status[p.userref]
                    return (
                      <tr key={p.userref}>
                        <td className="tabular-nums">{new Date(p.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td>{p.pairName}</td>
                        <td>{p.side === 'buy' ? 'Kauf' : 'Verkauf'}</td>
                        <td className="num">{p.sent}</td>
                        <td className="num">{orders ? open : '–'}</td>
                        <td className="num">
                          {st ? <span className={st.filled + st.partial > 0 ? 'text-success-fg' : ''}>{st.filled}{st.partial ? ` + ${st.partial} teilw.` : ''}</span> : '–'}
                        </td>
                        <td className="num">{st && st.averagePrice ? num(st.averagePrice, 2) : '–'}</td>
                        <td className="num">{eur(p.totalCost)}</td>
                        <td className="text-right">
                          <span className="inline-flex gap-2">
                            {p.side === 'buy' && st && st.filledVolume > 0 && (
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => sellLadder(p, st)} title="Verkaufsstaffel 10–50 % über deinem Kaufpreis vorschlagen"><TrendingUp size={14} /> Gewinnstaffel</button>
                            )}
                            {open > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => setCancelPlan(p)}>Plan stornieren</button>}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

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
                        <td className="num">{num(o.price, 8)}</td>
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
