// Planer: wie sich Preise und Mengen auf die Stufen verteilen (Abstände, Mengenverteilung, eigene Prozente, Schwerpunkte).
import { tr } from '@shared/i18n'
import { parseWeightList } from '@shared/number-format'
import type { Ladder, LadderInput, PriceSpacing, SizeCurve } from '@shared/ladder'
import type { PairDto } from '@shared/ipc'
import { NumberField } from '../../components/NumberField'
import CenterSliders from '../../components/CenterSliders'
import Segmented from '../../components/bausteine/Segmented'
import { num, numberFormat } from '../../format'
import { useMoney } from '../../money'
import Feld from '../../components/bausteine/Feld'
import Auswahl from '../../components/bausteine/Auswahl'

const curves = (): { id: SizeCurve; label: string; title: string }[] => [
  { id: 'flat', label: tr('Gleich', 'Equal'), title: tr('Jede Stufe gleich groß', 'Every level the same size') },
  { id: 'linear', label: 'Linear', title: tr('Wächst gleichmäßig von Stufe zu Stufe', 'Grows evenly from level to level') },
  { id: 'log', label: tr('Logarithmisch', 'Logarithmic'), title: tr('Wächst am Anfang schnell, dann flacher', 'Grows fast at first, then flattens') },
  { id: 'exp', label: tr('Exponentiell', 'Exponential'), title: tr('Wächst am Anfang langsam, am Ende stark', 'Grows slowly at first, strongly at the end') },
  { id: 'fib', label: 'Fibonacci', title: tr('Stufen im Verhältnis 1, 1, 2, 3, 5, 8 … (jede Stufe so groß wie die beiden davor)', 'Levels in the ratio 1, 1, 2, 3, 5, 8 … (each level as big as the two before it)') },
  { id: 'custom', label: tr('Eigene Prozente', 'Custom percentages'), title: tr('Du gibst für jede Stufe selbst den Anteil vor', 'You set the share of every level yourself') },
]

const spacings = (): { id: PriceSpacing; label: string; title: string }[] => [
  { id: 'linear', label: tr('Gleiche €-Abstände', 'Equal € steps'), title: tr('Zwischen zwei Stufen liegt immer derselbe Betrag', 'Always the same amount between two levels') },
  { id: 'geometric', label: tr('Gleiche %-Abstände', 'Equal % steps'), title: tr('Zwischen zwei Stufen liegt immer derselbe Prozentsatz (logarithmisch)', 'Always the same percentage between two levels (logarithmic)') },
]

export default function DistributionFields({ input, set, zoned, ladder, pair, customText, setCustomText }: {
  input: LadderInput
  set: <K extends keyof LadderInput>(k: K, v: LadderInput[K]) => void
  zoned: boolean
  ladder: Ladder | null
  pair: PairDto | undefined
  /** Eigene Prozente als Text, so wie getippt */
  customText: string
  setCustomText: (t: string) => void
}): JSX.Element {
  const { fmtPrice, sym } = useMoney()
  return (
    <>
      <div>
        <span className="label">{tr('Preisabstände', 'Price spacing')}</span>
        <Segmented<PriceSpacing> block value={input.spacing} onChange={(v) => set('spacing', v)} options={spacings()} />
      </div>
      <div>
        <span className="label">{tr('Mengenverteilung', 'Size distribution')}</span>
        <Auswahl className="w-full" value={input.curve} disabled={!!input.perLevel} onChange={(e) => set('curve', e.target.value as SizeCurve)}>
          {curves().filter((c) => !zoned || c.id !== 'custom').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Auswahl>
        <span className="mt-1 block text-xs text-ink-muted">{input.perLevel
          ? tr(`Bei „Pro Stufe“ ist jede Stufe gleich groß. Die Verteilung gilt erst wieder mit „Gesamt“.${zoned ? ' Die Anteile der Zonen zählen dann auch nicht, jede Stufe bekommt denselben Wert.' : ''}`, `With “Per level” every level is the same size. The distribution applies again with “Total”.${zoned ? ' Zone shares do not count either, every level gets the same value.' : ''}`)
          : <>{curves().find((c) => c.id === input.curve)?.title}{zoned && tr('. Gilt innerhalb jeder Zone.', '. Applies within each zone.')}</>}</span>
      </div>
      {input.curve === 'custom' && !zoned && !input.perLevel && (
        <label className="block">
          <span className="label">{tr('Anteil je Stufe in %', 'Share per level in %')}</span>
          <Feld className="w-full tabular-nums" value={customText} placeholder={numberFormat() === 'de' ? tr('z. B. 12,5; 12,5; 25; 50', 'e.g. 12,5; 12,5; 25; 50') : tr('z. B. 12.5, 12.5, 25, 50', 'e.g. 12.5, 12.5, 25, 50')}
            onChange={(e) => { setCustomText(e.target.value); set('customWeights', parseWeightList(e.target.value, numberFormat())) }} />
          <span className="mt-1 block text-xs text-ink-muted">
            {tr(
              `${input.steps} Werte, getrennt mit ${numberFormat() === 'de' ? 'Semikolon oder Leerzeichen (Komma ist das Dezimalzeichen)' : 'Komma'}. Summe ${num((input.customWeights ?? []).filter(Number.isFinite).reduce((a, b) => a + b, 0), 1)} % (wird auf 100 % umgerechnet).`,
              `${input.steps} values, separated by ${numberFormat() === 'de' ? 'semicolon or space (comma is the decimal sign)' : 'comma'}. Sum ${num((input.customWeights ?? []).filter(Number.isFinite).reduce((a, b) => a + b, 0), 1)} % (scaled to 100 %).`,
            )}
          </span>
        </label>
      )}
      {['linear', 'log', 'exp'].includes(input.curve) && !input.perLevel && (
        <NumberField label={tr('Letzte Stufe im Verhältnis zur ersten', 'Last level relative to the first')} value={input.ratio} onChange={(v) => set('ratio', v)}
          hint={input.ratio >= 1 ? tr(`Die letzte Stufe ist ${num(input.ratio, 2)}× so groß wie die erste.`, `The last level is ${num(input.ratio, 2)}× the size of the first.`) : tr('Unter 1: die Stufen werden kleiner.', 'Below 1: the levels get smaller.')} />
      )}
      {ladder?.centers && (
        <CenterSliders side={input.side} steps={input.steps} centers={ladder.centers} shares={ladder.levels.map((l) => l.share)}
          orderCenter={input.orderCenter} volumeCenter={input.volumeCenter} priceStart={input.priceStart} priceEnd={input.priceEnd}
          formatPrice={(p) => `${fmtPrice(p, p >= 100 ? 0 : Math.min(pair?.priceDecimals ?? 2, 2))} ${sym}`} onChange={(k, v) => set(k, v)}
          volumeOff={input.perLevel ? tr('Bei „Pro Stufe“ ist jede Stufe gleich groß.', 'With “Per level” every level is the same size.') : undefined} />
      )}
    </>
  )
}
