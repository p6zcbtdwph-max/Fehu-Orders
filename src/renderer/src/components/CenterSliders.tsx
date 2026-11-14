import { RotateCcw } from 'lucide-react'
import { CENTER_MAX, CENTER_MIN, type LadderCenters, type Side } from '@shared/ladder'
import { num } from '../format'
import { tr } from '@shared/i18n'

// Alle Texte an einer Stelle, auf Deutsch und Englisch. Als Funktion, damit ein Sprachwechsel sofort greift.
export const centerText = () => ({
  heading: tr('Schwerpunkte', 'Centers of weight'),
  intro: tr('Wo im Preisbereich liegen deine Orders und dein Geld im Mittel? 0 % = erste Stufe (nah am Kurs), 100 % = letzte Stufe.', 'Where in the price range do your orders and your money sit on average? 0 % = first level (close to the price), 100 % = last level.'),
  orderLabel: tr('Orderanzahl', 'Number of orders'),
  orderHint: tr('Wo die Stufen dichter beieinander liegen. Erste und letzte Stufe bleiben fest.', 'Where the levels sit closer together. The first and last level stay fixed.'),
  volumeLabel: { buy: tr('Geldmenge', 'Amount of money'), sell: tr('Verkaufsmenge', 'Amount to sell') } as Record<Side, string>,
  volumeHint: {
    buy: tr('Wo im Mittel dein Geld eingesetzt wird. Der Formelwert hängt auch von der Lage der Stufen ab.', 'Where your money is put to work on average. The formula value also depends on where the levels sit.'),
    sell: tr('Wo im Mittel deine Menge verkauft wird. Der Formelwert hängt auch von der Lage der Stufen ab.', 'Where your holdings are sold on average. The formula value also depends on where the levels sit.'),
  } as Record<Side, string>,
  formula: tr('Formel', 'Formula'),
  isFormula: tr('wie die Formel', 'same as formula'),
  reset: tr('Zurück auf den Wert der Formel', 'Back to the formula value'),
  atPrice: tr('bei', 'at'),
  needSteps: (n: number) => tr(`Ab ${n} Stufen verstellbar.`, `Adjustable from ${n} levels.`),
  legend: {
    buy: tr('Punkte = Stufen (größer = mehr Geld), Striche = Schwerpunkte.', 'Dots = levels (bigger = more money), lines = centers of weight.'),
    sell: tr('Punkte = Stufen (größer = mehr Menge), Striche = Schwerpunkte.', 'Dots = levels (bigger = more volume), lines = centers of weight.'),
  } as Record<Side, string>,
})

const percent = (c: number) => `${num(Math.round(c * 100), 0)} %`

interface SliderProps {
  label: string
  hint: string
  value: number
  formulaValue: number
  custom: boolean
  disabledText?: string
  priceAt: (c: number) => string
  onChange: (v: number | undefined) => void
  tone: 'order' | 'volume'
}

function CenterSlider({ label, hint, value, formulaValue, custom, disabledText, priceAt, onChange, tone }: SliderProps) {
  const T = centerText()
  const disabled = !!disabledText
  return (
    <div className={disabled ? 'opacity-60' : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label mb-0 flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${tone === 'volume' ? 'bg-accent-600 dark:bg-accent-400' : 'bg-ink-muted'}`} aria-hidden />
          {label}
        </span>
        <span className="text-sm font-semibold tabular-nums">{percent(value)}</span>
      </div>
      <input type="range" className="range mt-1" min={CENTER_MIN * 100} max={CENTER_MAX * 100} step={1} disabled={disabled}
        value={Math.round(value * 100)} aria-label={label} aria-valuetext={`${percent(value)}, ${T.atPrice} ${priceAt(value)}`}
        onChange={(e) => {
          const v = Number(e.target.value) / 100
          // Wer den Regler auf den Formelwert zurückschiebt, bekommt wieder genau die Formel
          onChange(Math.abs(v - formulaValue) < 0.005 ? undefined : v)
        }} />
      <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span>
          {disabled ? disabledText : <>{T.atPrice} {priceAt(value)} · {custom ? `${T.formula} ${percent(formulaValue)}` : T.isFormula}</>}
        </span>
        {custom && !disabled && (
          <button type="button" className="btn-mini" onClick={() => onChange(undefined)} aria-label={T.reset} title={T.reset}><RotateCcw size={13} /></button>
        )}
      </div>
      {!disabled && <span className="mt-0.5 block text-xs text-ink-faint">{hint}</span>}
    </div>
  )
}

/** Kleine Leiste von erster bis letzter Stufe: Punkte für die Stufen, Striche für die Schwerpunkte */
function CenterTrack({ centers, shares, firstLabel, lastLabel, legend }: { centers: LadderCenters; shares: number[]; firstLabel: string; lastLabel: string; legend: string }) {
  const max = Math.max(...shares, 0)
  return (
    <div>
      <div className="relative mx-2 h-9" aria-hidden>
        <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--color-border)]" />
        {centers.positions.map((p, i) => {
          const size = max > 0 ? 4 + 10 * Math.sqrt(shares[i] / max) : 6
          return <span key={i} className="absolute top-1/2 rounded-full bg-accent-500/60 dark:bg-accent-400/60" style={{ left: `${p * 100}%`, width: size, height: size, transform: 'translate(-50%, -50%)' }} />
        })}
        <span className="absolute top-0 h-full w-0.5 rounded bg-ink-muted transition-[left] duration-fast" style={{ left: `${centers.order * 100}%`, transform: 'translateX(-50%)' }} />
        <span className="absolute top-0 h-full w-0.5 rounded bg-accent-600 transition-[left] duration-fast dark:bg-accent-400" style={{ left: `${centers.volume * 100}%`, transform: 'translateX(-50%)' }} />
      </div>
      <div className="flex justify-between gap-2 whitespace-nowrap text-xs tabular-nums text-ink-faint">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>
      <span className="mt-0.5 block text-xs text-ink-faint">{legend}</span>
    </div>
  )
}

export default function CenterSliders({ side, steps, centers, shares, orderCenter, volumeCenter, priceStart, priceEnd, formatPrice, onChange }: {
  side: Side
  steps: number
  centers: LadderCenters
  shares: number[]
  orderCenter?: number
  volumeCenter?: number
  priceStart: number
  priceEnd: number
  formatPrice: (p: number) => string
  onChange: (key: 'orderCenter' | 'volumeCenter', v: number | undefined) => void
}) {
  // Schwerpunkt in Prozent → Preis an dieser Stelle (nur zur Anzeige)
  const priceAt = (c: number) => formatPrice(priceStart + (priceEnd - priceStart) * c)
  const T = centerText()
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
      <div>
        <span className="label mb-0">{T.heading}</span>
        <span className="block text-xs text-ink-muted">{T.intro}</span>
      </div>
      <CenterTrack centers={centers} shares={shares} firstLabel={formatPrice(priceStart)} lastLabel={formatPrice(priceEnd)} legend={T.legend[side]} />
      <CenterSlider tone="order" label={T.orderLabel} hint={T.orderHint}
        value={orderCenter ?? centers.orderDefault} formulaValue={centers.orderDefault} custom={orderCenter !== undefined}
        disabledText={steps < 3 ? T.needSteps(3) : undefined} priceAt={priceAt} onChange={(v) => onChange('orderCenter', v)} />
      <CenterSlider tone="volume" label={T.volumeLabel[side]} hint={T.volumeHint[side]}
        value={volumeCenter ?? centers.volumeDefault} formulaValue={centers.volumeDefault} custom={volumeCenter !== undefined}
        disabledText={steps < 2 ? T.needSteps(2) : undefined} priceAt={priceAt} onChange={(v) => onChange('volumeCenter', v)} />
    </div>
  )
}
