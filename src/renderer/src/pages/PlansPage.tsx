import { useState } from 'react'
import { ArrowLeft, Bell, BellRing, ChevronRight, Pencil, RefreshCw, Rocket, Send, Shield, Trash2, TrendingUp } from 'lucide-react'
import { api } from '../api'
import OpenOrdersCard from '../components/OpenOrdersCard'
import ArmZoneModal, { triggerText } from '../components/ArmZone'
import { ReleaseModal, evaluate } from '../components/ReleaseDraft'
import type { DraftDto, PlanDto, PlanStatusDto, SendResult } from '@shared/ipc'
import { profitLadderSuggestion } from '@shared/plan-status'
import { boardCounts, heldWithLevels, readyZones, restLevels, type BoardEntry, type BoardStatus } from '@shared/plan-board'
import type { Prefill } from './PlannerPage'
import SectionCard from '../components/ui/SectionCard'
import Tabs from '../components/ui/Tabs'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import { SendSuccessModal } from '../components/SendSuccess'
import { dateLocale, num, pct } from '../format'
import { tr } from '@shared/i18n'
import { useMoney } from '../money'
import { exName, probeOk } from '@shared/exchanges'
import type { PlanData } from '../plan-data'

export type PlanFilter = 'all' | 'drafts' | 'running' | 'done' | 'orders'

export interface PlansView {
  filter: PlanFilter
  /** Geöffneter Plan (Detailansicht), sonst die Liste */
  id: string | null
}

/** Farbige Status-Marke, überall gleich */
export function StatusPill({ e }: { e: Pick<BoardEntry, 'status' | 'wait'> }): JSX.Element {
  const text: Record<BoardStatus, string> = {
    draft: tr('Entwurf', 'Draft'),
    wait: e.wait?.kind === 'alarm' ? tr('Kursalarm', 'Price alert') : tr('Wartet auf dich', 'Waiting for you'),
    run: tr('Läuft', 'Running'),
    done: tr('Fertig', 'Done'),
  }
  const tone = { draft: 'neutral', wait: 'warning', run: 'accent', done: 'success' } as const
  return <Badge tone={tone[e.status]}>{e.status === 'wait' && e.wait?.kind === 'alarm' && <BellRing size={12} className="mr-1 inline" />}{text[e.status]}</Badge>
}

/** Name in der Liste: Entwurfsname, sonst Paar und Richtung */
export const entryTitle = (e: BoardEntry): string => e.name || `${e.pairName} ${e.side === 'buy' ? tr('Kauf', 'buy') : tr('Verkauf', 'sell')}`

const dt = (iso: string) => new Date(iso).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })
const fillDate = (t: number): string => new Date(t * 1000).toLocaleDateString(dateLocale(), { dateStyle: 'medium' })

/** Kurzer Fortschritt für die Liste */
export function progressText(e: BoardEntry): string {
  if (e.draft) {
    const n = e.draft.input.zones?.reduce((a, z) => a + z.steps, 0) ?? e.draft.input.steps
    return tr(`${n} Stufen, noch nicht gesendet`, `${n} levels, not sent yet`)
  }
  const p = e.plan!
  const total = p.levels?.length ?? p.sent
  if (!e.st) return tr(`${p.sent} von ${total} gesendet`, `${p.sent} of ${total} sent`)
  return tr(`${e.st.filled} von ${total} ausgeführt`, `${e.st.filled} of ${total} filled`) + (e.st.open ? tr(`, ${e.st.open} offen`, `, ${e.st.open} open`) : '')
}

interface Props {
  hasKey: boolean
  data: PlanData
  view: PlansView
  onView: (v: PlansView) => void
  onEditDraft: (d: DraftDto) => void
  onPlanSell: (p: Prefill) => void
  onNeedKey: () => void
}

/**
 * „Meine Pläne“: Entwürfe und gesendete Pläne in einer Liste. Ein Klick öffnet die Detailansicht
 * mit allen Knöpfen (senden, Zone aktivieren, Rest senden, Verkaufsplan, stornieren).
 */
export default function PlansPage({ hasKey, data, view, onView, onEditDraft, onPlanSell, onNeedKey }: Props): JSX.Element {
  const { board, orders, pairs, error, load } = data
  const { eur } = useMoney()
  const counts = boardCounts(board)
  const [notice, setNotice] = useState<string | null>(null)
  const open = view.id ? board.find((e) => e.id === view.id) : undefined

  const shown = board.filter((e) => view.filter === 'all'
    || (view.filter === 'drafts' && e.kind === 'draft')
    || (view.filter === 'running' && e.kind === 'plan' && e.status !== 'done')
    || (view.filter === 'done' && e.status === 'done'))

  async function cancelOne(txid: string) {
    try { await api().cancelOrder(txid) } catch (e) { setNotice((e as Error).message) }
    load()
  }

  return (
    <div className="page">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">{tr('Meine Pläne', 'My plans')}</h1>
          <p className="page-subtitle">{tr(`Entwürfe und gesendete Pläne bei ${exName()} an einem Ort.`, `Drafts and plans sent to ${exName()} in one place.`)}</p>
        </div>
        <div className="ml-auto flex flex-shrink-0 gap-2">
          <button type="button" className="btn btn-secondary" onClick={load}><RefreshCw size={16} /> {tr('Aktualisieren', 'Refresh')}</button>
        </div>
      </header>
      {!hasKey && <p className="notice notice-info mb-4">{tr(`Ohne ${exName()}-Schlüssel siehst du nur deine Entwürfe und gespeicherten Pläne, aber nicht, was bei ${exName()} offen oder ausgeführt ist.`, `Without a ${exName()} key you only see your drafts and saved plans, not what is open or filled at ${exName()}.`)} <button type="button" className="btn-link" onClick={onNeedKey}>{tr('Schlüssel hinterlegen', 'Add key')}</button></p>}
      {error && <p className="notice notice-danger mb-4">{error}</p>}
      {notice && <p className="notice notice-success mb-4">{notice}</p>}

      {open ? (
        <PlanDetail e={open} data={data} hasKey={hasKey} onBack={() => onView({ ...view, id: null })} onEditDraft={onEditDraft} onPlanSell={onPlanSell} onNeedKey={onNeedKey}
          onNotice={(t) => { setNotice(t); if (t) onView({ ...view, id: null }) }} onCancelOrder={cancelOne} />
      ) : <>
        <div data-guide="drafts">
          <Tabs<PlanFilter> className="mb-4" active={view.filter} onChange={(f) => { setNotice(null); onView({ filter: f, id: null }) }} tabs={[
            { id: 'all', label: tr('Alle', 'All'), count: counts.all },
            { id: 'drafts', label: tr('Entwürfe', 'Drafts'), count: counts.drafts },
            { id: 'running', label: tr('Laufend', 'Running'), count: counts.running },
            { id: 'done', label: tr('Fertig', 'Done'), count: counts.done },
            { id: 'orders', label: tr('Einzelne Orders', 'Single orders'), count: orders?.length },
          ]} />
        </div>
        {view.filter === 'orders' ? (
          orders ? <OpenOrdersCard orders={orders} pairs={pairs} onCancel={cancelOne} /> : <p className="text-sm text-ink-muted">{tr(`Offene Orders siehst du, sobald ein ${exName()}-Schlüssel hinterlegt ist.`, `You see open orders once a ${exName()} key is saved.`)}</p>
        ) : (
          <div data-guide="plans"><SectionCard title={tr(`${shown.length} ${shown.length === 1 ? 'Plan' : 'Pläne'}`, `${shown.length} ${shown.length === 1 ? 'plan' : 'plans'}`)}>
            {shown.length === 0 ? <EmptyList filter={view.filter} /> : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Plan</th><th>{tr('Status', 'Status')}</th><th>{tr('Fortschritt', 'Progress')}</th><th className="num">{tr('Gegenwert', 'Value')}</th><th>{tr('Datum', 'Date')}</th><th /></tr></thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr key={e.id} className="cursor-pointer hover:bg-sunken-soft" onClick={() => { setNotice(null); onView({ ...view, id: e.id }) }}>
                        <td className="min-w-[10rem] max-w-[18rem] [overflow-wrap:anywhere]">
                          <span className="font-medium text-ink">{entryTitle(e)}</span>
                          {e.name && <span className="block text-xs text-ink-muted">{e.pairName} {e.side === 'buy' ? tr('Kauf', 'buy') : tr('Verkauf', 'sell')}{e.draft?.scenario ? ` · ${e.draft.scenario}` : ''}</span>}
                        </td>
                        <td className="whitespace-nowrap"><StatusPill e={e} /></td>
                        <td className="text-sm">{progressText(e)}</td>
                        <td className="num">{valueOf(e, data, eur)}</td>
                        <td className="whitespace-nowrap tabular-nums text-ink-muted">{dt(e.at)}</td>
                        <td className="text-right"><span className="inline-flex items-center gap-1 text-sm text-accent-fg">{actionLabel(e)} <ChevronRight size={14} /></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard></div>
        )}
      </>}
    </div>
  )
}

/** Gegenwert eines Eintrags als Text */
function valueOf(e: BoardEntry, data: PlanData, eur: (n: number) => string): string {
  if (e.plan) return eur(e.plan.totalCost)
  const d = e.draft!
  const ev = evaluate(d, data.pairs.find((p) => p.id === d.pairId), data.prices[d.pairId], data.minOrder)
  return d.side === 'buy' ? eur(ev?.cost ?? d.input.total) : `≈ ${eur(ev?.cost ?? 0)}`
}
/** Was ein Klick in der Liste bewirkt */
function actionLabel(e: BoardEntry): string {
  if (e.status === 'wait' && e.wait?.kind === 'zone') return tr(`Zone ${e.wait.zone + 1} aktivieren`, `Activate zone ${e.wait.zone + 1}`)
  if (e.kind === 'draft') return e.status === 'wait' ? tr('Ansehen und senden', 'Review and send') : tr('Öffnen', 'Open')
  return tr('Öffnen', 'Open')
}

function EmptyList({ filter }: { filter: PlanFilter }) {
  const text = {
    all: tr('Noch keine Pläne. Lege im Planer deinen ersten Plan an und sende ihn oder speichere ihn als Entwurf.', 'No plans yet. Create your first plan in the planner and send it or save it as a draft.'),
    drafts: tr('Keine Entwürfe. Im Planer speicherst du mit „Als Entwurf“ einen Plan, ohne dass etwas an die Börse geht. Ein Entwurf sperrt kein Guthaben.', 'No drafts. In the planner, “Save as draft” stores a plan without anything going to the exchange. A draft locks no funds.'),
    running: tr('Gerade läuft kein Plan.', 'No plan is running right now.'),
    done: tr('Noch kein Plan ist fertig.', 'No plan is done yet.'),
    orders: '',
  }[filter]
  return <p className="text-sm text-ink-muted">{text}</p>
}

/** Detailansicht eines Plans oder Entwurfs mit allen Aktionen */
function PlanDetail({ e, data, hasKey, onBack, onEditDraft, onPlanSell, onNeedKey, onNotice, onCancelOrder }: {
  e: BoardEntry
  data: PlanData
  hasKey: boolean
  onBack: () => void
  onEditDraft: (d: DraftDto) => void
  onPlanSell: (p: Prefill) => void
  onNeedKey: () => void
  /** Meldung über der Liste zeigen (und zur Liste zurück) */
  onNotice: (t: string | null) => void
  onCancelOrder: (txid: string) => void
}) {
  return (
    <div className="space-y-4">
      <button type="button" className="btn-link inline-flex items-center gap-1 text-sm" onClick={onBack}><ArrowLeft size={14} /> {tr('Alle Pläne', 'All plans')}</button>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold text-ink">{entryTitle(e)}</h2>
        <StatusPill e={e} />
      </div>
      {e.draft
        ? <DraftDetail d={e.draft} entry={e} data={data} hasKey={hasKey} onEdit={onEditDraft} onNeedKey={onNeedKey} onNotice={onNotice} />
        : <SentDetail p={e.plan!} st={e.st} data={data} onPlanSell={onPlanSell} onCancelOrder={onCancelOrder} />}
    </div>
  )
}

function DraftDetail({ d, entry, data, hasKey, onEdit, onNeedKey, onNotice }: {
  d: DraftDto; entry: BoardEntry; data: PlanData; hasKey: boolean; onEdit: (d: DraftDto) => void; onNeedKey: () => void; onNotice: (t: string | null) => void
}) {
  const { eur, fmtPrice, sym } = useMoney()
  const [release, setRelease] = useState(false)
  const [remove, setRemove] = useState(false)
  const pair = data.pairs.find((p) => p.id === d.pairId)
  const last = data.prices[d.pairId]
  const ev = evaluate(d, pair, last, data.minOrder)
  const dec = pair?.priceDecimals ?? 2
  const first = ev?.toSend[0]?.price ?? d.input.priceStart
  const lastLevel = ev?.toSend[ev.toSend.length - 1]?.price ?? d.input.priceEnd

  return (
    <>
      {entry.wait?.kind === 'alarm' && <p className="notice notice-warning flex items-center gap-2"><BellRing size={16} className="flex-shrink-0" />{tr(`Der Kursalarm hat am ${dt(entry.wait.at)} ausgelöst: Der Kurs hat die erste Stufe erreicht. Prüfe den Entwurf und sende ihn, wenn er noch passt.`, `The price alert fired on ${dt(entry.wait.at)}: the price reached the first level. Check the draft and send it if it still fits.`)}</p>}
      <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
        <Kpi label={tr('Paar', 'Pair')} value={`${d.pairName} ${d.side === 'buy' ? tr('Kauf', 'buy') : tr('Verkauf', 'sell')}`} />
        <Kpi label={tr('Stufen', 'Levels')} value={ev ? (ev.count < ev.sendable.length ? tr(`${ev.count} von ${ev.sendable.length}`, `${ev.count} of ${ev.sendable.length}`) : String(ev.count)) : String(d.input.steps)} />
        <Kpi label={tr('Preisbereich', 'Price range')} value={`${fmtPrice(first, dec)} – ${fmtPrice(lastLevel, dec)} ${sym}`} />
        <Kpi label={tr('Gegenwert', 'Value')} value={d.side === 'buy' ? eur(ev?.cost ?? d.input.total) : `${num(ev?.volume ?? d.input.total, pair?.volumeDecimals)} ${d.pairName.split('/')[0]}`} />
      </div>
      <SectionCard title={tr('Details', 'Details')}>
        <div className="space-y-2 text-sm">
          {d.scenario && <p><span className="text-ink-muted">{tr('Gruppe', 'Group')}:</span> {d.scenario}</p>}
          {d.note && <p className="text-ink-muted">{d.note}</p>}
          <p>{tr('Kurs jetzt', 'Price now')}: {last ? <>{fmtPrice(last, dec)} {sym} <span className="text-ink-muted">({tr('erste Stufe', 'first level')} {pct(first / last - 1)})</span></> : '–'}</p>
          {d.alarm && !d.alarmFiredAt && <p className="flex items-center gap-1 text-ink-muted"><Bell size={14} /> {tr('Kursalarm bei', 'Price alert at')} {fmtPrice(first, dec)} {sym}</p>}
          {ev && ev.wrong.length > 0 && <p><Badge tone="danger">{tr(`${ev.wrong.length} Stufen auf falscher Kursseite`, `${ev.wrong.length} levels on the wrong side of the price`)}</Badge></p>}
          {ev && !ev.ladder.valid && <p><Badge tone="warning">{tr(`Passt nicht mehr zu ${exName()}s Regeln`, `No longer fits ${exName()}’s rules`)}</Badge></p>}
          <p className="text-xs text-ink-muted">{tr('Ein Entwurf sperrt kein Guthaben. Erst beim Senden legt die Börse die Orders an.', 'A draft locks no funds. Only sending places the orders at the exchange.')}</p>
        </div>
      </SectionCard>
      <SectionCard title={tr('Was du jetzt tun kannst', 'What you can do now')}>
        <span className="inline-flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => setRelease(true)}><Rocket size={16} /> {tr('Senden', 'Send')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => onEdit(d)}><Pencil size={16} /> {tr('Im Planer bearbeiten', 'Edit in planner')}</button>
          <button type="button" className="btn btn-outline" onClick={() => setRemove(true)}><Trash2 size={16} /> {tr('Löschen', 'Delete')}</button>
        </span>
      </SectionCard>

      {release && (
        <ReleaseModal draft={d} pair={pair} last={last} minOrder={data.minOrder} hasKey={hasKey} onNeedKey={onNeedKey}
          onClose={(sent: SendResult | null) => {
            setRelease(false)
            if (sent) {
              onNotice(tr(`„${d.name}“ wurde an ${exName()} gesendet (Plan-Nummer ${sent.userref}).`, `“${d.name}” was sent to ${exName()} (plan number ${sent.userref}).`))
              data.load()
            }
          }} />
      )}
      {remove && (
        <Modal title={tr('Entwurf löschen?', 'Delete draft?')} size="sm" onClose={() => setRemove(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setRemove(false)}>{tr('Abbrechen', 'Cancel')}</button>
            <button type="button" className="btn btn-danger" onClick={async () => { await api().deleteDraft(d.id); setRemove(false); onNotice(tr(`„${d.name}“ wurde gelöscht.`, `“${d.name}” was deleted.`)); data.load() }}>{tr('Löschen', 'Delete')}</button>
          </>}>
          <p className="text-sm">{tr(`„${d.name}“ wird aus der App gelöscht. Bei ${exName()} ändert sich nichts.`, `“${d.name}” will be deleted from the app. Nothing changes at ${exName()}.`)}</p>
        </Modal>
      )}
    </>
  )
}

function SentDetail({ p, st, data, onPlanSell, onCancelOrder }: {
  p: PlanDto; st: PlanStatusDto | undefined; data: PlanData; onPlanSell: (p: Prefill) => void; onCancelOrder: (txid: string) => void
}) {
  const { eur, fmtPrice, sym } = useMoney()
  const pair = data.pairs.find((x) => x.id === p.pairId)
  const dec = pair?.priceDecimals ?? 2
  const [arm, setArm] = useState<number | null>(null)
  const [rest, setRest] = useState(false)
  const [cancel, setCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [sent, setSent] = useState<SendResult | null>(null)
  const myOrders = data.orders?.filter((o) => o.userref === p.userref) ?? null
  const left = restLevels(p)
  const held = heldWithLevels(p)
  const ready = new Set(readyZones(p, st))
  const total = p.levels?.length ?? p.sent

  function sellPlan() {
    if (!st) return
    const s = profitLadderSuggestion(st.averagePrice, st.filledVolume)
    onPlanSell({
      pairId: p.pairId,
      input: { ...p.input, side: 'sell', priceStart: +s.priceStart.toPrecision(6), priceEnd: +s.priceEnd.toPrecision(6), total: s.total, unit: 'base', perLevel: undefined, curve: 'linear', ratio: 2, customWeights: undefined, orderCenter: undefined, volumeCenter: undefined, zones: undefined },
    })
  }

  async function sendRest(validate: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await api().sendRest(p.userref, validate)
      const failed = r.orders.filter((o) => o.error)
      const ok = r.orders.length - failed.length
      if (r.orders.some((o) => o.uncertain)) setMsg({ ok: false, text: tr('Die Verbindung brach beim Senden ab. Klicke auf „Aktualisieren“ und prüfe, was wirklich angelegt wurde, bevor du noch einmal sendest.', 'The connection dropped while sending. Click “Refresh” and check what was really placed before you send again.') })
      else setMsg(failed.length
        ? { ok: false, text: tr(`${validate ? 'Test' : 'Senden'}: ${failed.length} von ${r.orders.length} Orders abgelehnt. Grund: ${failed[0].error}`, `${validate ? 'Test run' : 'Send'}: ${failed.length} of ${r.orders.length} orders rejected. Reason: ${failed[0].error}`) }
        : { ok: true, text: validate ? probeOk(ok) : tr(`${ok} weitere Orders angelegt.`, `${ok} more orders placed.`) })
      if (!validate) { setRest(false); setMsg(null); setSent(r); data.load() }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(false)
  }

  async function cancelPlan() {
    setBusy(true)
    try { await api().cancelPlan(p.userref) } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
    setBusy(false)
    setCancel(false)
    data.load()
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
        <Kpi label={tr('Ausgeführt', 'Filled')} value={st ? `${st.filled} / ${total}` : '–'} sub={st?.partial ? tr(`+ ${st.partial} teilweise`, `+ ${st.partial} partial`) : st?.lastFillAt ? `${tr('zuletzt', 'last')} ${fillDate(st.lastFillAt)}` : undefined} />
        <Kpi label={tr('Noch offen', 'Still open')} value={myOrders ? String(myOrders.length) : '–'} sub={tr(`${p.sent} von ${total} gesendet`, `${p.sent} of ${total} sent`)} />
        <Kpi label={tr('Ø Preis', 'Avg. price')} value={st && st.averagePrice ? `${fmtPrice(st.averagePrice, dec)} ${sym}` : '–'} />
        <Kpi label={tr('Gegenwert', 'Value')} value={eur(p.totalCost)} sub={`${p.pairName} ${p.side === 'buy' ? tr('Kauf', 'buy') : tr('Verkauf', 'sell')} · ${dt(p.createdAt)}`} />
      </div>
      {msg && !rest && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}

      {st?.zones && p.input.zones && (
        <SectionCard title={tr('Zonen', 'Zones')}>
          <ul className="space-y-1 text-sm tabular-nums">
            {p.input.zones.map((z, i) => {
              const zp = st.zones!.find((x) => x.zone === i)
              return <li key={i}>{tr(`Zone ${i + 1}`, `Zone ${i + 1}`)}: {z.armed === false && held.includes(i) ? <span className="text-ink-muted">{tr('pausiert', 'paused')} · {triggerText(p, i, st.zones).text}</span> : zp && zp.sentVolume > 0 ? tr(`${Math.round(zp.filledShare * 100)} % ausgeführt`, `${Math.round(zp.filledShare * 100)} % filled`) : '–'}</li>
            })}
          </ul>
        </SectionCard>
      )}

      <SectionCard title={tr('Was du jetzt tun kannst', 'What you can do now')}>
        {held.length || left.length || (p.side === 'buy' && st && st.filledVolume > 0) || (myOrders?.length ?? 0) > 0 ? (
          <span className="inline-flex flex-wrap gap-2">
            {held.map((z) => (
              <button key={z} type="button" className={`btn whitespace-nowrap ${ready.has(z) ? 'btn-primary' : 'btn-outline'}`} title={triggerText(p, z, st?.zones).text}
                onClick={() => { setMsg(null); setArm(z) }}>
                <Shield size={16} /> {tr(`Zone ${z + 1} aktivieren`, `Activate zone ${z + 1}`)}
              </button>
            ))}
            {left.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => { setMsg(null); setRest(true) }}><Send size={16} /> {tr(`Restliche ${left.length} Stufen senden`, `Send remaining ${left.length} levels`)}</button>}
            {p.side === 'buy' && st && st.filledVolume > 0 && <button type="button" className="btn btn-secondary" onClick={sellPlan} title={tr('Verkaufsstaffel 10–50 % über deinem Kaufpreis vorschlagen', 'Suggest a sell ladder 10–50 % above your buy price')}><TrendingUp size={16} /> {tr('Verkaufsplan für diesen Kauf', 'Sell plan for this buy')}</button>}
            {(myOrders?.length ?? 0) > 0 && <button type="button" className="btn btn-outline text-danger-fg" onClick={() => setCancel(true)}>{tr('Plan stornieren', 'Cancel plan')}</button>}
          </span>
        ) : <p className="text-sm text-ink-muted">{tr('Bei diesem Plan gibt es gerade nichts zu tun.', 'There is nothing to do for this plan right now.')}</p>}
      </SectionCard>

      {myOrders && myOrders.length > 0 && <OpenOrdersCard orders={myOrders} pairs={data.pairs} onCancel={onCancelOrder} />}

      {arm !== null && (
        <ArmZoneModal plan={p} zone={arm} progress={st?.zones} pair={pair} onClose={() => setArm(null)}
          onSent={(r) => { setSent(r); setArm(null); data.load() }} />
      )}
      {sent && <SendSuccessModal result={sent} pairName={p.pairName} side={p.side} priceDecimals={dec} onClose={() => setSent(null)} />}

      {rest && left.length > 0 && (
        <Modal title={tr('Restliche Stufen senden?', 'Send the remaining levels?')} size="sm" onClose={() => !busy && setRest(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => sendRest(true)}>{tr('Testen', 'Test')}</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => sendRest(false)}>{busy ? tr('Sende …', 'Sending …') : tr(`${left.length} Orders senden`, `Send ${left.length} orders`)}</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p>{p.side === 'buy' ? tr('Kaufen', 'Buy') : tr('Verkaufen', 'Sell')} {p.pairName}: {left.length} {tr('Stufen von', 'levels from')} {fmtPrice(left[0].price, dec)} {tr('bis', 'to')} {fmtPrice(left[left.length - 1].price, dec)} {sym}.</p>
            <p>{tr('Gegenwert', 'Value')}: <strong>{eur(left.reduce((a, l) => a + l.cost, 0))}</strong></p>
            <p className="text-ink-muted">{tr('Die Stufen wurden beim Planen berechnet. Liegt der Kurs inzwischen woanders, prüfe sie vorher mit dem Test.', 'The levels were calculated when planning. If the price has moved since, check them first with a test run.')}</p>
            {msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
          </div>
        </Modal>
      )}

      {cancel && (
        <Modal title={tr('Plan stornieren?', 'Cancel plan?')} size="sm" onClose={() => !busy && setCancel(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setCancel(false)}>{tr('Abbrechen', 'Back')}</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={cancelPlan}>{busy ? tr('Storniere …', 'Cancelling …') : tr('Stornieren', 'Cancel plan')}</button>
          </>}>
          <p className="text-sm">{tr(
            `Alle noch offenen Orders dieses Plans (${p.pairName}, ${myOrders?.length ?? 0} Stück) werden bei ${exName()} storniert. Bereits ausgeführte Käufe oder Verkäufe bleiben bestehen.`,
            `All still open orders of this plan (${p.pairName}, ${myOrders?.length ?? 0} orders) will be cancelled at ${exName()}. Buys or sells already filled stay as they are.`,
          )}</p>
        </Modal>
      )}
    </>
  )
}

/** Kennzahl-Kachel */
export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="card min-w-0 p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="truncate text-lg font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="truncate text-xs text-ink-muted">{sub}</p>}
    </div>
  )
}
