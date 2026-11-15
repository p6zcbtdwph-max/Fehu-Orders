import { useEffect, useMemo, useState } from 'react'
import { Pencil, Shield } from 'lucide-react'
import { api } from '../api'
import { buildLadder, DEFAULT_MIN_ORDER_EUR, zoneTrigger, type LadderLevel } from '@shared/ladder'
import { triggerMet, type ZoneProgress } from '@shared/plan-status'
import type { PairDto, PlanDto, SendResult } from '@shared/ipc'
import Modal from './ui/Modal'
import { NumberField } from './NumberField'
import { num, pct } from '../format'
import { tr } from '@shared/i18n'
import { useMoney } from '../money'
import { exName, probeOk } from '@shared/exchanges'

/** Noch nicht gesendete Stufen einer Zone */
export const zoneLevels = (p: PlanDto, zone: number): LadderLevel[] => {
  const sent = new Set(p.sentIndices ?? [])
  return (p.levels ?? []).filter((l) => l.zone === zone && !sent.has(l.index) && !l.problem)
}

/** Text zur Bedingung, z. B. „Zone 2 ist zu 67 % ausgeführt (Ziel 50 %)“ */
export function triggerText(p: PlanDto, zone: number, progress: ZoneProgress[] | undefined): { met: boolean; text: string } {
  const t = zoneTrigger(p.input.zones ?? [], zone)
  const z = progress?.find((x) => x.zone === t.zone)
  const met = triggerMet(progress, t)
  const now = z ? Math.round(z.filledShare * 100) : null
  return {
    met,
    text: now === null
      ? tr(`Zone ${t.zone + 1} soll zu ${t.percent} % ausgeführt sein (Stand noch unbekannt).`, `Zone ${t.zone + 1} should be ${t.percent} % filled (status not known yet).`)
      : met
        ? tr(`Zone ${t.zone + 1} ist zu ${now} % ausgeführt (Ziel ${t.percent} %). Jetzt ist die Zeit, Zone ${zone + 1} scharf zu schalten.`, `Zone ${t.zone + 1} is ${now} % filled (target ${t.percent} %). Now is the time to arm zone ${zone + 1}.`)
        : tr(`Zone ${t.zone + 1} ist zu ${now} % ausgeführt, Ziel ${t.percent} %.`, `Zone ${t.zone + 1} is ${now} % filled, target ${t.percent} %.`),
  }
}

/**
 * Fenster zum Scharfschalten einer entschärften Zone. Wahlweise vorher bearbeiten (Preisbereich, Stufenzahl),
 * dann Probelauf oder echt senden. Senden ist immer ein bewusster Klick (plus Touch ID im Hauptprozess).
 */
export default function ArmZoneModal({ plan, zone, progress, pair, onClose, onSent }: {
  plan: PlanDto
  zone: number
  progress?: ZoneProgress[]
  pair?: PairDto
  onClose: () => void
  onSent: (r: SendResult) => void
}): JSX.Element {
  const { eur, fmtPrice, sym } = useMoney()
  const original = zoneLevels(plan, zone)
  const z = plan.input.zones![zone]
  const buy = plan.side === 'buy'
  // Betrag der Zone bleibt beim Bearbeiten gleich (Kauf: Euro, Verkauf: Menge)
  const total = buy ? original.reduce((a, l) => a + l.cost, 0) : original.reduce((a, l) => a + l.volume, 0)
  const [editing, setEditing] = useState(false)
  const [from, setFrom] = useState(original[0]?.price ?? z.priceStart)
  const [to, setTo] = useState(original[original.length - 1]?.price ?? z.priceEnd)
  const [steps, setSteps] = useState(original.length || z.steps)
  const [minOrder, setMinOrder] = useState(DEFAULT_MIN_ORDER_EUR)
  const [busy, setBusy] = useState<'validate' | 'send' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { api().settings().then((s) => setMinOrder(s.minOrderEur ?? DEFAULT_MIN_ORDER_EUR)).catch(() => undefined) }, [])

  const edited = useMemo(() => {
    if (!editing || !pair) return null
    return buildLadder({ side: plan.side, priceStart: from, priceEnd: steps === 1 ? from : to, steps, total, spacing: plan.input.spacing, curve: plan.input.curve === 'custom' ? 'flat' : plan.input.curve, ratio: plan.input.ratio }, pair, { minCost: minOrder })
  }, [editing, pair, from, to, steps, total, minOrder])
  const levels = edited ? edited.levels.filter((l) => !l.problem) : original
  const cost = levels.reduce((a, l) => a + l.cost, 0)
  const dec = pair?.priceDecimals ?? 2
  const cond = triggerText(plan, zone, progress)
  const blocked = !!edited && !edited.valid

  async function go(validate: boolean) {
    setBusy(validate ? 'validate' : 'send')
    setMsg(null)
    try {
      const r = await api().armZone(plan.userref, zone, validate, edited ? edited.levels.filter((l) => !l.problem) : undefined)
      const failed = r.orders.filter((o) => o.error)
      if (validate) setMsg(failed.length ? { ok: false, text: tr(`Probelauf: ${failed.length} Orders würden abgelehnt. Grund: ${failed[0].error}`, `Test run: ${failed.length} orders would be rejected. Reason: ${failed[0].error}`) } : { ok: true, text: probeOk(r.orders.length) })
      else onSent(r)
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(null)
  }

  return (
    <Modal title={tr(`Zone ${zone + 1} scharf schalten?`, `Arm zone ${zone + 1}?`)} size="sm" onClose={() => !busy && onClose()}
      footer={<>
        <button type="button" className="btn btn-secondary" disabled={!!busy || blocked || !levels.length} onClick={() => go(true)}>{busy === 'validate' ? tr('Prüfe …', 'Checking …') : tr('Probelauf', 'Test run')}</button>
        <button type="button" className="btn btn-primary" disabled={!!busy || blocked || !levels.length} onClick={() => go(false)}>
          <Shield size={16} /> {busy === 'send' ? tr('Sende …', 'Sending …') : tr(`${levels.length} Orders senden`, `Send ${levels.length} orders`)}
        </button>
      </>}>
      <div className="space-y-3 text-sm">
        <p className={`notice ${cond.met ? 'notice-success' : 'notice-info'} text-xs`}>{cond.text}</p>
        <p>
          {buy ? tr('Kaufen', 'Buy') : tr('Verkaufen', 'Sell')} {plan.pairName}: {levels.length} {tr('Stufen von', 'levels from')}{' '}
          {levels.length ? `${fmtPrice(levels[0].price, dec)} ${tr('bis', 'to')} ${fmtPrice(levels[levels.length - 1].price, dec)} ${sym}` : '–'}.
        </p>
        <p>{tr('Gegenwert', 'Value')}: <strong>{eur(cost)}</strong>{!buy && <> · {num(levels.reduce((a, l) => a + l.volume, 0), pair?.volumeDecimals ?? 8)} {plan.pairName.split('/')[0]}</>}</p>
        {!editing ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} disabled={!pair}><Pencil size={14} /> {tr('Vorher bearbeiten', 'Edit first')}</button>
        ) : (
          <div className="rounded-lg border border-line p-3">
            <p className="mb-2 text-xs text-ink-muted">{tr(
              `Preisbereich und Stufen der Zone anpassen. Der Betrag der Zone bleibt ${buy ? eur(total) : `${num(total, pair?.volumeDecimals ?? 8)} ${plan.pairName.split('/')[0]}`}.`,
              `Adjust the zone's price range and levels. The zone's amount stays ${buy ? eur(total) : `${num(total, pair?.volumeDecimals ?? 8)} ${plan.pairName.split('/')[0]}`}.`,
            )}</p>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label={tr('Von', 'From')} value={from} onChange={setFrom} />
              <NumberField label={tr('Bis', 'To')} value={to} onChange={setTo} />
              <NumberField label={tr('Stufen', 'Levels')} step="1" value={steps} onChange={(v) => setSteps(Math.round(v))} />
            </div>
            {edited && edited.errors.length > 0 && <div className="notice notice-warning mt-2 space-y-1 text-xs">{edited.errors.map((e) => <p key={e}>{e}</p>)}</div>}
            {edited && edited.valid && (
              <ul className="mt-2 space-y-0.5 text-xs tabular-nums text-ink-muted">
                {edited.levels.map((l) => <li key={l.index}>{fmtPrice(l.price, dec)} {sym} · {eur(l.cost)} · {pct(l.share)}</li>)}
              </ul>
            )}
            <button type="button" className="btn-link mt-2 text-xs" onClick={() => setEditing(false)}>{tr('Wie geplant senden', 'Send as planned')}</button>
          </div>
        )}
        <p className="text-ink-muted">{tr(`Die Orders werden echt bei ${exName()} angelegt, mit derselben Plan-Nummer. Liegt der Kurs inzwischen woanders, prüfe sie vorher mit dem Probelauf.`, `The orders are really placed at ${exName()}, with the same plan number. If the price has moved since, check them first with a test run.`)}</p>
        {msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
      </div>
    </Modal>
  )
}
