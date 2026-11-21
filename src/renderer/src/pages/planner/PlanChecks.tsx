// Kennzahlen und Prüfungen des Plans im Planer: Stufen, Gegenwert, Hinweise, Warnungen und Ergebnis des letzten Sendens.
// Warnungen (zu wenig Guthaben, falsche Kursseite, über der Obergrenze) bleiben immer sichtbar, Erklärungen sind Hints.
import { AlertTriangle, History, ShieldOff } from 'lucide-react'
import { tr } from '@shared/i18n'
import { exName, probeOk } from '@shared/exchanges'
import { zoneTrigger, hasZones, type Ladder, type LadderInput } from '@shared/ladder'
import type { PairDto, SendResult } from '@shared/ipc'
import type { SendSplit } from '@shared/send-split'
import KpiStrip from '../../components/ui/KpiStrip'
import Hint from '../../components/Hint'
import { RaisedNotice } from '../../components/MinOrder'
import { windowPhrase } from '../../components/HistoryHints'
import { num, pct } from '../../format'
import { useMoney } from '../../money'

export interface PlanChecksProps {
  input: LadderInput
  ladder: Ladder | null
  pair: PairDto | undefined
  last: number | null
  split: SendSplit
  minOrder: number
  limit: number | null
  overLimit: boolean
  feePct: number | null
  feeEur: number | null
  /** Guthaben: gebraucht, verfügbar (null = unbekannt), zu wenig */
  need: number
  have: number | null
  shortfall: boolean
  /** Preise auf der falschen Kursseite */
  wrong: number[]
  postOnly: boolean
  /** Rückblick: nie erreichte Stufen im gewählten Zeitraum */
  never: { count: number; cost: number } | null
  range: number
  covered: number
  sendError: string | null
  result: SendResult | null
  onOpenSettings?: () => void
}

export default function PlanChecks(p: PlanChecksProps): JSX.Element {
  const { input, ladder, pair, last, split, minOrder, limit, overLimit, feePct, feeEur, need, have, shortfall, wrong, postOnly, never, range, covered, sendError, result, onOpenSettings } = p
  const { sendable, held, heldLevels, nowCount, nowCost, partial } = split
  const { eur, fmtPrice } = useMoney()
  const zoned = hasZones(input)
  const base = pair?.name.split('/')[0] ?? ''
  const ok = result?.orders.filter((o) => !o.error).length ?? 0
  const failed = result?.orders.filter((o) => o.error) ?? []
  return (
    <>
      {ladder && (
        <KpiStrip items={[
          { label: tr('Stufen', 'Levels'), value: `${sendable.length} / ${input.steps}`, tone: sendable.length < input.steps ? 'warning' : 'default', hint: partial || heldLevels.length ? tr(`${nowCount} jetzt, ${sendable.length - nowCount} später`, `${nowCount} now, ${sendable.length - nowCount} later`) : undefined },
          { label: partial ? tr('Gegenwert jetzt', 'Value now') : tr('Gegenwert', 'Value'), value: eur(partial ? nowCost : ladder.totalCost), tone: overLimit ? 'warning' : 'default', hint: feeEur !== null ? tr(`+ ca. ${eur(feeEur)} Gebühr (${num(feePct ?? 0, 2)} %)`, `+ approx. ${eur(feeEur)} fee (${num(feePct ?? 0, 2)} %)`) : partial ? tr(`von ${eur(ladder.totalCost)} gesamt`, `of ${eur(ladder.totalCost)} total`) : undefined },
          { label: tr(`Menge ${base}`, `Volume ${base}`), value: num(ladder.totalVolume, pair?.volumeDecimals) },
          { label: tr('Ø Preis bei voller Ausführung', 'Avg. price if fully filled'), value: ladder.averagePrice ? fmtPrice(ladder.averagePrice, pair?.priceDecimals ?? 2) : '–', hint: last && ladder.averagePrice ? pct(ladder.averagePrice / last - 1) + tr(' zum Kurs', ' vs. price') : undefined },
        ]} />
      )}
      {ladder && ladder.errors.length > 0 && (
        <div className="notice notice-warning space-y-1">{ladder.errors.map((e) => <p key={e}>{e}</p>)}</div>
      )}
      {heldLevels.length > 0 && zoned && (
        <p className="notice notice-accent flex items-start gap-2 text-xs">
          <ShieldOff size={14} className="mt-0.5 flex-shrink-0" />
          <span>{[...held].map((z) => {
            const t = zoneTrigger(input.zones!, z)
            const cost = heldLevels.filter((l) => l.zone === z).reduce((a, l) => a + l.cost, 0)
            return <span key={z} className="block">{tr(
              <><strong>Zone {z + 1} ist pausiert.</strong> {input.side === 'buy' ? eur(cost) : `≈ ${eur(cost)}`} gehen beim Senden noch nicht raus und sperren kein Guthaben. Unter „Meine Pläne“ leuchtet „Zone {z + 1} aktivieren“ auf, sobald Zone {t.zone + 1} zu {t.percent} % ausgeführt ist.</>,
              <><strong>Zone {z + 1} is disarmed.</strong> {input.side === 'buy' ? eur(cost) : `≈ ${eur(cost)}`} will not be sent yet and lock no funds. Under “My plans”, “Arm zone {z + 1}” lights up once zone {t.zone + 1} is {t.percent} % filled.</>,
            )}</span>
          })}</span>
        </p>
      )}
      {never && never.count > 0 && ladder && (
        <Hint id="never-reached" icon={History}
          title={tr(`${never.count} von ${sendable.length} Stufen hat der Kurs ${windowPhrase(range, covered)} nie erreicht.`, `${never.count} of ${sendable.length} levels were never reached by the price ${windowPhrase(range, covered)}.`)}>
          {tr(
            <>Darin stecken {eur(never.cost)} ({pct(ladder.totalCost > 0 ? never.cost / ladder.totalCost : 0)} des Plans). Solche Orders sperren Guthaben und wären zuletzt nicht ausgeführt worden. Das kann gewollt sein (Absicherung für einen tiefen Fall), ist aber gut zu wissen.</>,
            <>They hold {eur(never.cost)} ({pct(ladder.totalCost > 0 ? never.cost / ladder.totalCost : 0)} of the plan). Such orders lock funds and would not have been filled recently. That can be on purpose (a reserve for a deep drop), but it is good to know.</>,
          )}
        </Hint>
      )}
      {ladder && pair && <RaisedNotice ladder={ladder} input={input} rules={pair} userMin={minOrder} base={base} eur={eur} />}
      {overLimit && limit !== null && (
        <p className="notice notice-warning flex flex-wrap items-start gap-x-3 gap-y-1">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span className="min-w-0 flex-1">{tr(
            <><strong>Über deiner Obergrenze von {eur(limit)} pro Sendung.</strong> Aus Sicherheitsgründen steht sie am Anfang auf 50 €, damit dein erster echter Test klein bleibt. So wird nichts gesendet. Verkleinere den Betrag, sende mit „Davon jetzt senden“ erst einen Teil, oder hebe die Grenze in den Einstellungen an.</>,
            <><strong>Above your limit of {eur(limit)} per send.</strong> For safety it starts at 50 € so your first real test stays small. Nothing will be sent like this. Lower the amount, send only part of it with “Send now”, or raise the limit in Settings.</>,
          )}</span>
          {onOpenSettings && <button type="button" className="btn-link" onClick={onOpenSettings}>{tr('Zu den Einstellungen', 'Open settings')}</button>}
        </p>
      )}
      {shortfall && (
        <p className="notice notice-danger">
          {tr(
            `Nicht genug verfügbares Guthaben: Du brauchst ${input.side === 'buy' ? eur(need) : `${num(need, pair?.volumeDecimals)} ${base}`}, verfügbar sind ${input.side === 'buy' ? eur(have ?? 0) : `${num(have ?? 0, pair?.volumeDecimals)} ${base}`}. Guthaben in offenen Orders ist schon abgezogen, denn jede offene Order sperrt ihren Betrag.`,
            `Not enough available balance: you need ${input.side === 'buy' ? eur(need) : `${num(need, pair?.volumeDecimals)} ${base}`}, available is ${input.side === 'buy' ? eur(have ?? 0) : `${num(have ?? 0, pair?.volumeDecimals)} ${base}`}. Funds in open orders are already deducted, because every open order locks its amount.`,
          )}
        </p>
      )}
      {!shortfall && have !== null && ladder && ladder.totalCost > 0 && (
        <p className="text-xs text-ink-muted">{tr(
          `Verfügbar: ${input.side === 'buy' ? eur(have) : `${num(have, pair?.volumeDecimals)} ${base}`}. Reicht für ${partial ? 'diese Sendung' : 'diesen Plan'}.`,
          `Available: ${input.side === 'buy' ? eur(have) : `${num(have, pair?.volumeDecimals)} ${base}`}. Enough for ${partial ? 'this send' : 'this plan'}.`,
        )}</p>
      )}
      {ladder && ladder.totalCost > 0 && (
        <Hint id="locked-funds" title={tr('Jede Order braucht echtes Guthaben.', 'Every order needs real funds.')}>
          {tr(
            <>{exName()} sperrt beim Senden den vollen Betrag aller gesendeten Stufen ({input.side === 'buy' ? 'beim Kaufen Euro' : `beim Verkaufen ${base}`}), auch für Stufen weit weg vom Kurs, die vielleicht nie ausgeführt werden. Das Geld bleibt gesperrt, bis die Order ausgeführt oder storniert ist, und steht so lange nicht für andere Orders bereit. Mehr Orders als Guthaben geht nicht.{' '}
              {partial ? `Mit „Davon jetzt senden“ sperrst du nur ${eur(nowCost)} für die ${nowCount} Stufen nah am Kurs.` : 'Tipp: Mit „Davon jetzt senden“ sperrst du erst einmal nur die Stufen nah am Kurs, oder du speicherst den Plan als Entwurf. Entwürfe sperren kein Geld.'}</>,
            <>When sending, {exName()} locks the full amount of all sent levels ({input.side === 'buy' ? 'euro when buying' : `${base} when selling`}), even for levels far from the price that may never be filled. The money stays locked until the order is filled or cancelled and cannot be used for other orders meanwhile. You cannot place more orders than you have funds.{' '}
              {partial ? `With “Send now” you only lock ${eur(nowCost)} for the ${nowCount} levels close to the price.` : 'Tip: with “Send now” you first lock only the levels close to the price, or save the plan as a draft. Drafts lock no money.'}</>,
          )}
        </Hint>
      )}
      {wrong.length > 0 && (
        <p className="notice notice-danger flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            {tr(
              `${wrong.length === 1 ? '1 Stufe liegt' : `${wrong.length} Stufen liegen`} ${input.side === 'buy' ? 'beim oder über dem' : 'beim oder unter dem'} aktuellen Kurs. ${postOnly ? `Mit Post-only storniert ${exName()} diese Orders sofort wieder.` : 'Diese Orders würden sofort zum Marktpreis ausgeführt.'} ${input.side === 'buy' ? 'Beim Kaufen liegen alle Stufen unter dem Kurs.' : 'Beim Verkaufen liegen alle Stufen über dem Kurs.'}`,
              `${wrong.length === 1 ? '1 level is' : `${wrong.length} levels are`} ${input.side === 'buy' ? 'at or above' : 'at or below'} the current price. ${postOnly ? `With post-only, ${exName()} cancels these orders right away.` : 'These orders would be filled immediately at market price.'} ${input.side === 'buy' ? 'When buying, all levels are below the price.' : 'When selling, all levels are above the price.'}`,
            )}
          </span>
        </p>
      )}
      {sendError && <p className="notice notice-danger">{sendError}</p>}
      {result && (
        <div className={`notice ${failed.length ? 'notice-warning' : 'notice-success'}`}>
          {result.validate
            ? failed.length ? tr(`Test: ${failed.length} Orders würden abgelehnt.`, `Test run: ${failed.length} orders would be rejected.`) : probeOk(ok)
            : tr(`${ok} Orders angelegt${failed.length ? `, ${failed.length} fehlgeschlagen` : ''}. Plan-Nummer ${result.userref}.`, `${ok} orders placed${failed.length ? `, ${failed.length} failed` : ''}. Plan number ${result.userref}.`)}
          {result.orders.some((o) => o.uncertain) && <p className="mt-1 text-xs font-medium">{tr('Die Verbindung brach ab. Schau unter „Meine Pläne“ nach, was wirklich angelegt wurde, bevor du noch einmal sendest.', 'The connection dropped. Check under “My plans” what was really placed before you send again.')}</p>}
          {failed.length > 0 && <p className="mt-1 text-xs">{tr('Grund', 'Reason')}: {failed[0].error}</p>}
        </div>
      )}
    </>
  )
}
