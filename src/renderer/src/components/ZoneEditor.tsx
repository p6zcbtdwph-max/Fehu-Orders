import { Plus, Trash2 } from 'lucide-react'
import { appendZone, MAX_STEPS, MAX_ZONES, type Ladder, type LadderZone, type Side } from '@shared/ladder'
import { reach, windowStats, type Candle } from '@shared/history'
import { windowPhrase } from './HistoryHints'
import { num, pct } from '../format'
import { tr } from '@shared/i18n'
import { NumberField } from './NumberField'
import { useChartTheme } from '../utils/chartTheme'

/** Farbe einer Zone, gleich im Editor, im Chart und in der Stufentabelle (Farbe 1 ist die Kurslinie, darum ab 2) */
export const zoneColor = (series: string[], i: number): string => series[(i + 1) % series.length]

/**
 * Editor für Preiszonen: mehrere getrennte Bereiche mit eigenem Anteil am Betrag und eigener Stufenzahl.
 * Zwischen den Zonen liegen keine Orders.
 */
export default function ZoneEditor({ side, zones, ladder, last, daily, days, quote, total, eur, fmtPrice, onChange }: {
  side: Side
  zones: LadderZone[]
  ladder: Ladder | null
  last: number | null
  /** Tageskerzen für den Hinweis „erreicht an … Tagen“ */
  daily: Candle[]
  days: number
  quote: string
  /** Kauf: Betrag in Euro, Verkauf: Menge */
  total: number
  eur: (n: number) => string
  fmtPrice: (p: number) => string
  onChange: (zones: LadderZone[]) => void
}): JSX.Element {
  const { series } = useChartTheme()
  const shareSum = zones.reduce((a, z) => a + (z.share > 0 ? z.share : 0), 0)
  const stepSum = zones.reduce((a, z) => a + (Number.isFinite(z.steps) ? z.steps : 0), 0)
  const now = Date.now() / 1000
  const covered = daily.length ? windowStats(daily, days, now)?.covered ?? days : days
  const update = (i: number, patch: Partial<LadderZone>) => onChange(zones.map((z, k) => (k === i ? { ...z, ...patch } : z)))
  const remove = (i: number) => onChange(zones.filter((_, k) => k !== i))
  const valueOf = (i: number) => (ladder?.levels ?? []).filter((l) => l.zone === i && !l.problem).reduce((a, l) => a + l.cost, 0)

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">{tr(
        `Lege fest, wo dein ${side === 'buy' ? 'Geld' : 'Bestand'} liegen soll. Zone 1 ist am nächsten am Kurs, jede weitere liegt ${side === 'buy' ? 'tiefer' : 'höher'}. Zwischen den Zonen gibt es keine Orders. Preisabstände und Mengenverteilung unten gelten innerhalb jeder Zone.`,
        `Decide where your ${side === 'buy' ? 'money' : 'holdings'} should sit. Zone 1 is closest to the price, each further zone is ${side === 'buy' ? 'lower' : 'higher'}. There are no orders between zones. Price spacing and size distribution below apply within each zone.`,
      )}</p>
      {zones.map((z, i) => {
        const part = shareSum > 0 && z.share > 0 ? z.share / shareSum : 0
        const r = daily.length ? reach(daily, side, z.priceStart, days, now) : null
        return (
          <div key={i} className="rounded-lg border border-line p-3" style={{ borderLeft: `4px solid ${zoneColor(series, i)}` }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{tr(`Zone ${i + 1}`, `Zone ${i + 1}`)}</span>
              <span className="flex items-center gap-2 text-xs text-ink-muted tabular-nums">
                {pct(part)} · {side === 'buy' ? eur(valueOf(i) || total * part) : `≈ ${eur(valueOf(i))}`}
                {zones.length > 1 && (
                  <button type="button" className="btn-mini" onClick={() => remove(i)} aria-label={tr(`Zone ${i + 1} entfernen`, `Remove zone ${i + 1}`)} title={tr(`Zone ${i + 1} entfernen`, `Remove zone ${i + 1}`)}><Trash2 size={14} /></button>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label={tr(`Von (${quote})`, `From (${quote})`)} value={z.priceStart} onChange={(v) => update(i, { priceStart: v })}
                hint={last ? pct(z.priceStart / last - 1) + tr(' zum Kurs', ' vs. price') : undefined} />
              {z.steps === 1
                ? <div><span className="label">{tr(`Bis (${quote})`, `To (${quote})`)}</span><p className="pt-2 text-xs text-ink-muted">{tr('Bei 1 Stufe nur „Von“', 'With 1 level only “From”')}</p></div>
                : <NumberField label={tr(`Bis (${quote})`, `To (${quote})`)} value={z.priceEnd} onChange={(v) => update(i, { priceEnd: v })}
                  hint={last ? pct(z.priceEnd / last - 1) + tr(' zum Kurs', ' vs. price') : undefined} />}
              <NumberField label={tr('Stufen', 'Levels')} step="1" value={z.steps} onChange={(v) => update(i, { steps: Math.round(v) })} />
              <NumberField label={tr('Anteil in %', 'Share in %')} value={z.share} onChange={(v) => update(i, { share: v })} />
            </div>
            {r && r.of > 0 && (
              <p className="mt-1.5 text-xs text-ink-muted">{r.hits > 0
                ? tr(`Zonenbeginn ${fmtPrice(z.priceStart)} ${windowPhrase(days, covered)} an ${r.hits} Tagen erreicht.`, `Zone start ${fmtPrice(z.priceStart)} reached on ${r.hits} days ${windowPhrase(days, covered)}.`)
                : tr(`Zonenbeginn ${fmtPrice(z.priceStart)} ${windowPhrase(days, covered)} nie erreicht.`, `Zone start ${fmtPrice(z.priceStart)} never reached ${windowPhrase(days, covered)}.`)}</p>
            )}
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn btn-ghost btn-sm" disabled={zones.length >= MAX_ZONES} onClick={() => onChange(appendZone(zones, side))}
          title={zones.length >= MAX_ZONES ? tr(`Höchstens ${MAX_ZONES} Zonen`, `At most ${MAX_ZONES} zones`) : tr(`Weitere Zone ${side === 'buy' ? 'unterhalb' : 'oberhalb'} der letzten anlegen`, `Add another zone ${side === 'buy' ? 'below' : 'above'} the last one`)}>
          <Plus size={14} /> {tr('Zone hinzufügen', 'Add zone')}
        </button>
        <span className={`text-xs tabular-nums ${stepSum > MAX_STEPS ? 'text-warning-fg' : 'text-ink-muted'}`}>
          {tr(`${num(stepSum, 0)} Stufen gesamt · Anteile ${num(shareSum, 1)} %`, `${num(stepSum, 0)} levels in total · shares ${num(shareSum, 1)} %`)}
          {Math.abs(shareSum - 100) > 0.05 && shareSum > 0 && tr(' (wird auf 100 % umgerechnet)', ' (scaled to 100 %)')}
        </span>
      </div>
    </div>
  )
}
