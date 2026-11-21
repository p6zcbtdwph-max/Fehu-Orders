import { useState } from 'react'
import { BellRing, Check, ChevronRight, Circle, Plus, Shield, X } from 'lucide-react'
import SectionCard from '../components/ui/SectionCard'
import { assetLabel } from '@shared/safety'
import { activeExchange, exName } from '@shared/exchanges'
import { tr } from '@shared/i18n'
import { boardCounts, type BoardEntry } from '@shared/plan-board'
import { num } from '../format'
import { useMoney } from '../money'
import type { PlanData } from '../plan-data'
import { Kpi, StatusPill, entryTitle, progressText } from './PlansPage'

export const FIRST_STEPS_HIDDEN = 'fehu-orders-first-steps-hidden'
export const DEMO_TRIED = 'fehu-orders-demo-tried'
const GUIDE_SEEN = 'fehu-orders-guide-seen'

const flag = (k: string): boolean => {
  try { return !!localStorage.getItem(k) } catch { return false }
}

interface Props {
  hasKey: boolean
  demo: boolean
  data: PlanData
  /** Einen Plan in „Meine Pläne“ öffnen */
  onOpenPlan: (id: string) => void
  onOpenPlans: () => void
  onNewPlan: (side: 'buy' | 'sell') => void
  onGuide: () => void
  onDemo: () => void
  onNeedKey: () => void
  onFirstTest: () => void
}

/** Startseite: Was ist los, was ist zu tun? */
export default function OverviewPage({ hasKey, demo, data, onOpenPlan, onOpenPlans, onNewPlan, onGuide, onDemo, onNeedKey, onFirstTest }: Props): JSX.Element {
  const { eur } = useMoney()
  const { board, balances, available, error } = data
  const counts = boardCounts(board)
  const todo = board.filter((e) => e.status === 'wait')
  const running = board.filter((e) => e.kind === 'plan' && e.status !== 'done').slice(0, 5)
  const filled = running.reduce((a, e) => a + (e.st?.filled ?? 0), 0)
  const levels = running.reduce((a, e) => a + (e.plan?.levels?.length ?? e.plan?.sent ?? 0), 0)

  // Euro: verfügbar und in offenen Orders gebunden
  const eurTotal = balances.EUR ?? balances.ZEUR ?? 0
  const eurFree = available ? available.EUR ?? available.ZEUR ?? 0 : null

  return (
    <div className="page">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">{tr('Übersicht', 'Overview')}</h1>
          <p className="page-subtitle">{tr(`Was gerade bei ${exName()} los ist und was als Nächstes zu tun ist.`, `What is going on at ${exName()} and what to do next.`)}</p>
        </div>
        <div className="ml-auto flex flex-shrink-0 gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => onNewPlan('sell')}><Plus size={16} /> {tr('Verkaufsplan', 'Sell plan')}</button>
          <button type="button" className="btn btn-primary" onClick={() => onNewPlan('buy')}><Plus size={16} /> {tr('Kaufplan', 'Buy plan')}</button>
        </div>
      </header>
      {error && <p className="notice notice-danger mb-4">{error}</p>}

      <div className="space-y-4">
        <FirstSteps hasKey={hasKey} demo={demo} sentAny={!demo && data.plans.length > 0} onGuide={onGuide} onDemo={onDemo} onNeedKey={onNeedKey} onFirstTest={onFirstTest} />

        <SectionCard title={tr(`Zu tun${todo.length ? ` (${todo.length})` : ''}`, `To do${todo.length ? ` (${todo.length})` : ''}`)}>
          {todo.length === 0 ? <p className="text-sm text-ink-muted">{tr('Gerade wartet nichts auf dich. Sobald ein Kursalarm auslöst oder eine Zone bereit ist, steht es hier.', 'Nothing is waiting for you right now. As soon as a price alert fires or a zone is ready, it shows up here.')}</p> : (
            <ul className="divide-y divide-line">
              {todo.map((e) => <TodoRow key={e.id} e={e} onOpen={() => onOpenPlan(e.id)} />)}
            </ul>
          )}
        </SectionCard>

        <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">
          <Kpi label={tr('Euro verfügbar', 'Euro available')} value={hasKey ? (eurFree !== null ? eur(eurFree) : eur(eurTotal)) : '–'}
            sub={hasKey ? (eurFree !== null && eurTotal > eurFree ? tr(`${eur(eurTotal - eurFree)} in offenen Orders gebunden`, `${eur(eurTotal - eurFree)} locked in open orders`) : tr(`bei ${exName()}`, `at ${exName()}`)) : tr('ohne Schlüssel unbekannt', 'unknown without a key')} />
          <Kpi label={tr('Laufende Pläne', 'Running plans')} value={String(counts.running)} sub={levels ? tr(`${filled} von ${levels} Stufen ausgeführt`, `${filled} of ${levels} levels filled`) : undefined} />
          <Kpi label={tr('Entwürfe', 'Drafts')} value={String(counts.drafts)} sub={tr('sperren kein Geld', 'lock no funds')} />
        </div>

        {running.length > 0 && (
          <SectionCard title={tr('Laufende Pläne', 'Running plans')} action={<button type="button" className="btn btn-ghost btn-sm" onClick={onOpenPlans}>{tr('Alle Pläne', 'All plans')} <ChevronRight size={14} /></button>}>
            <ul className="divide-y divide-line">
              {running.map((e) => (
                <li key={e.id}>
                  <button type="button" className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-sunken-soft" onClick={() => onOpenPlan(e.id)}>
                    <span className="min-w-0 flex-1 truncate font-medium">{entryTitle(e)}</span>
                    <span className="hidden text-ink-muted @md:inline">{progressText(e)}</span>
                    <StatusPill e={e} />
                    <ChevronRight size={14} className="text-ink-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {Object.keys(balances).length > 0 && <Balances balances={balances} eur={eur} />}
      </div>
    </div>
  )
}

function TodoRow({ e, onOpen }: { e: BoardEntry; onOpen: () => void }) {
  const alarm = e.wait?.kind === 'alarm'
  const text = alarm
    ? tr(`Entwurf „${entryTitle(e)}“: Der Kurs hat die erste Stufe erreicht.`, `Draft “${entryTitle(e)}”: the price reached the first level.`)
    : tr(`${entryTitle(e)}: Zone ${(e.wait?.kind === 'zone' ? e.wait.zone : 0) + 1} ist bereit.`, `${entryTitle(e)}: zone ${(e.wait?.kind === 'zone' ? e.wait.zone : 0) + 1} is ready.`)
  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      {alarm ? <BellRing size={16} className="text-warning-fg" /> : <Shield size={16} className="text-accent-fg" />}
      <span className="min-w-0 flex-1">{text}</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={onOpen}>
        {alarm ? tr('Ansehen und senden', 'Review and send') : tr(`Zone ${(e.wait?.kind === 'zone' ? e.wait.zone : 0) + 1} aktivieren`, `Activate zone ${(e.wait?.kind === 'zone' ? e.wait.zone : 0) + 1}`)}
      </button>
    </li>
  )
}

/** Die ersten vier Schritte für Einsteiger. Verschwindet, wenn alles erledigt ist oder man sie ausblendet. */
function FirstSteps({ hasKey, demo, sentAny, onGuide, onDemo, onNeedKey, onFirstTest }: {
  hasKey: boolean; demo: boolean; sentAny: boolean; onGuide: () => void; onDemo: () => void; onNeedKey: () => void; onFirstTest: () => void
}) {
  const [hidden, setHidden] = useState(() => flag(FIRST_STEPS_HIDDEN))
  const steps = [
    { done: flag(GUIDE_SEEN), label: tr('Einführung ansehen', 'Watch the introduction'), action: onGuide, button: tr('Starten', 'Start') },
    { done: demo || flag(DEMO_TRIED), label: tr('Im Demo-Modus ausprobieren, ohne echtes Geld', 'Try it in demo mode, without real money'), action: onDemo, button: tr('Demo starten', 'Start demo') },
    { done: hasKey && !demo, label: tr(`Mit ${exName()} verbinden (API-Schlüssel)`, `Connect to ${exName()} (API key)`), action: onNeedKey, button: tr('Schlüssel anlegen', 'Add key') },
    { done: sentAny, label: tr('Ersten echten Test senden, höchstens 50 €', 'Send a first real test, at most 50 €'), action: onFirstTest, button: tr('Erster Test', 'First test') },
  ]
  if (hidden || steps.every((s) => s.done)) return null
  const next = steps.findIndex((s) => !s.done)
  return (
    <SectionCard title={tr('Erste Schritte', 'First steps')} action={
      <button type="button" className="btn-mini" aria-label={tr('Erste Schritte ausblenden', 'Hide first steps')} title={tr('Ausblenden', 'Hide')}
        onClick={() => { setHidden(true); try { localStorage.setItem(FIRST_STEPS_HIDDEN, '1') } catch { /* egal */ } }}><X size={14} /></button>}>
      <ol className="space-y-2 text-sm">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-3">
            {s.done ? <Check size={16} className="text-success-fg" /> : <Circle size={16} className="text-ink-faint" />}
            <span className={`min-w-0 flex-1 ${s.done ? 'text-ink-muted line-through' : ''}`}>{i + 1}. {s.label}</span>
            {!s.done && <button type="button" className={`btn btn-sm ${i === next ? 'btn-primary' : 'btn-secondary'}`} onClick={s.action}>{s.button}</button>}
          </li>
        ))}
      </ol>
    </SectionCard>
  )
}

function Balances({ balances, eur }: { balances: Record<string, number>; eur: (n: number) => string }) {
  // Guthaben nach Coin zusammenfassen: normal handelbar und in Earn getrennt
  const rows = Object.entries(balances).reduce<Record<string, { spot: number; earn: number; earnLabel?: string }>>((acc, [code, v]) => {
    // Nur Kraken hat Kürzel wie XXBT oder BTC.F, die anderen Börsen nennen Coins schon lesbar
    const { name, earn } = activeExchange() === 'kraken' ? assetLabel(code) : { name: code, earn: undefined }
    const row = (acc[name] ??= { spot: 0, earn: 0 })
    if (earn) { row.earn += v; row.earnLabel = earn } else row.spot += v
    return acc
  }, {})
  return (
    <SectionCard title={tr('Guthaben', 'Balances')}>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>Coin</th><th className="num">{tr('Handelbar', 'Tradable')}</th><th className="num">{tr('In Earn', 'In Earn')}</th></tr></thead>
          <tbody>
            {Object.entries(rows).sort(([a], [b]) => (a === 'EUR' ? -1 : b === 'EUR' ? 1 : a.localeCompare(b))).map(([name, r]) => (
              <tr key={name}>
                <td className="font-medium">{name}</td>
                <td className="num">{name === 'EUR' ? eur(r.spot) : num(r.spot, 8)}</td>
                <td className="num text-ink-muted">{r.earn > 0 ? <span title={r.earnLabel}>{name === 'EUR' ? eur(r.earn) : num(r.earn, 8)}</span> : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.values(rows).some((r) => r.earn > 0) && <p className="mt-2 text-xs text-ink-muted">{tr('„In Earn“ ist Guthaben in Krakens Belohnungsprogramm (Staking). Gebundenes Guthaben lässt sich nicht sofort verkaufen.', '“In Earn” is balance in Kraken’s rewards program (staking). Bonded balance cannot be sold right away.')}</p>}
    </SectionCard>
  )
}
