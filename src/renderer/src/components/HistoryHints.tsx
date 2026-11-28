import { History } from 'lucide-react'
import { HISTORY_WINDOWS, windowStats, type Candle } from '@shared/history'
import type { Side } from '@shared/ladder'
import { pct, fmtDate } from '../format'
import { tr } from '@shared/i18n'
import LinkKnopf from './bausteine/LinkKnopf'

/** Wie viele Tage ein Zeitraum heißt: „30 Tage“, „1 Jahr“ oder die Tage, die es wirklich gibt */
export const windowLabel = (days: number, covered = days): string =>
  covered < days - 5 ? tr(`${covered} Tage`, `${covered} days`) : days >= 365 ? tr('1 Jahr', '1 year') : tr(`${days} Tage`, `${days} days`)

/** Für Sätze: „in den letzten 90 Tagen“, „im letzten Jahr“ */
export const windowPhrase = (days: number, covered = days): string =>
  covered < days - 5 ? tr(`in den letzten ${covered} Tagen`, `in the last ${covered} days`) : days >= 365 ? tr('im letzten Jahr', 'in the last year') : tr(`in den letzten ${days} Tagen`, `in the last ${days} days`)

/**
 * Tiefst- (Kauf) bzw. Höchstkurse (Verkauf) der letzten 30 Tage, 90 Tage und des letzten Jahres.
 * Ein Klick übernimmt den Kurs als letzte Stufe. Nur ein Blick zurück, keine Vorhersage.
 */
export default function HistoryHints({ side, daily, last, current, fmtPrice, onUse, useLabel }: {
  side: Side
  daily: Candle[]
  last: number | null
  /** Preis der ersten Stufe: ein Vorschlag muss weiter weg vom Kurs liegen, sonst wäre der Plan ungültig */
  current: number
  fmtPrice: (p: number) => string
  onUse: (price: number) => void
  useLabel: string
}): JSX.Element | null {
  if (daily.length < 2) return null
  const now = Date.now() / 1000
  const rows = HISTORY_WINDOWS.map((d) => windowStats(daily, d, now)).filter((w): w is NonNullable<typeof w> => !!w)
  // Zeiträume, die wegen fehlender Daten gleich ausfallen, nur einmal zeigen
  const seen = new Set<number>()
  const unique = rows.filter((w) => (seen.has(w.covered) ? false : (seen.add(w.covered), true)))
  if (!unique.length) return null
  return (
    <div className="rounded-lg border border-line-soft p-3">
      <span className="label flex items-center gap-1.5"><History size={14} /> {side === 'buy' ? tr('Tiefstkurse im Rückblick', 'Lowest prices looking back') : tr('Höchstkurse im Rückblick', 'Highest prices looking back')}</span>
      <ul className="space-y-1.5">
        {unique.map((w) => {
          const p = side === 'buy' ? w.low : w.high
          const at = side === 'buy' ? w.lowAt : w.highAt
          const usable = side === 'buy' ? p < current : p > current
          return (
            <li key={w.days} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span className="w-20 flex-shrink-0 text-xs text-ink-muted">{windowLabel(w.days, w.covered)}</span>
              <span className="tabular-nums font-medium" title={tr(`am ${fmtDate(at * 1000)}`, `on ${fmtDate(at * 1000)}`)}>{fmtPrice(p)}</span>
              {last && <span className="text-xs text-ink-muted tabular-nums">{pct(p / last - 1)}</span>}
              {usable && <LinkKnopf className="ml-auto text-xs" title={useLabel} onClick={() => onUse(+p.toPrecision(6))}>{tr('übernehmen', 'use')}</LinkKnopf>}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-ink-muted">{tr(
        'Zeigt nur, was war. Der Kurs kann tiefer oder höher gehen, das ist keine Vorhersage.',
        'Only shows what happened. The price can go lower or higher, this is not a forecast.',
      )}</p>
    </div>
  )
}
