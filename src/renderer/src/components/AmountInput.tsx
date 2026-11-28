// Menge im Planer: in Geld oder Stück, für den ganzen Plan oder pro Stufe. Beim Verkaufen mit Bestand,
// Prozent-Knöpfen und „mindestens behalten“.
import { amountUnit, planAmount, type AmountUnit, type Ladder, type LadderInput } from '@shared/ladder'
import { shareOfHolding, type Holding } from '@shared/holdings'
import { tr } from '@shared/i18n'
import { num } from '../format'
import { NumberField } from './NumberField'
import Segmented from './bausteine/Segmented'

type Fmt = (n: number) => string

const SHARES = [0.25, 0.5, 0.75, 1]

/** Sinnvoll gerundeter Startwert nach dem Umrechnen (z. B. 1234.5678 € → 1235, 0.123456 SOL → 0.1235) */
export function tidy(n: number, decimals: number): number {
  if (!(n > 0) || !Number.isFinite(n)) return n
  const digits = Math.max(0, Math.min(decimals, 4 - Math.floor(Math.log10(n))))
  const f = Math.pow(10, digits)
  return Math.floor(n * f) / f
}

export default function AmountInput({ input, ladder, alt, last, quote, base, volumeDecimals, holding, keep, onKeep, onChange, eur, usdHint }: {
  input: LadderInput
  ladder: Ladder | null
  /** Derselbe Plan in der anderen Einheit (zum Vergleich) */
  alt: Ladder | null
  last: number | null
  quote: string
  base: string
  volumeDecimals: number
  /** Bestand des gewählten Coins (nur beim Verkaufen mit Schlüssel) */
  holding?: Holding | null
  keep: number
  onKeep: (n: number) => void
  onChange: (patch: Partial<LadderInput>) => void
  eur: Fmt
  usdHint: (n: number) => string
}): JSX.Element {
  const unit = amountUnit(input)
  const buy = input.side === 'buy'
  const per = !!input.perLevel
  const steps = input.steps > 0 ? input.steps : 1
  const sym = unit === 'quote' ? quote : base

  /** Einheit wechseln: den Wert so umrechnen, dass der Plan etwa gleich groß bleibt */
  function setUnit(next: AmountUnit) {
    if (next === unit) return
    const k = last && last > 0 ? last : 0
    const total = !k || !(input.total > 0) ? input.total : next === 'quote' ? tidy(input.total * k, 2) : tidy(input.total / k, volumeDecimals)
    onChange({ unit: next, total })
  }
  /** Gesamt oder pro Stufe: Wert durch die Stufen teilen bzw. malnehmen */
  function setPer(next: boolean) {
    if (next === per) return
    const d = unit === 'quote' ? 2 : volumeDecimals
    const total = !(input.total > 0) ? input.total : next ? tidy(input.total / steps, d) : tidy(input.total * steps, d)
    onChange({ perLevel: next, total })
  }
  /** Anteil am freien Bestand (minus „behalten“) als Menge übernehmen, in der gewählten Einheit */
  function applyShare(fraction: number) {
    if (!holding) return
    const pieces = shareOfHolding(holding.available, fraction, keep, volumeDecimals)
    const inUnit = unit === 'base' ? pieces : last && last > 0 ? Math.floor(pieces * last * 100) / 100 : 0
    if (!(inUnit > 0)) return
    // Pro Stufe: den Anteil auf die Stufen verteilen (abgerundet, damit es nie mehr wird)
    const total = per ? (unit === 'base' ? Math.floor((inUnit / steps) * Math.pow(10, volumeDecimals)) / Math.pow(10, volumeDecimals) : Math.floor((inUnit / steps) * 100) / 100) : inUnit
    onChange({ total })
  }

  const label = buy
    ? unit === 'quote'
      ? per ? tr(`Betrag pro Stufe (${quote})`, `Amount per level (${quote})`) : tr(`Betrag zum Investieren (${quote})`, `Amount to invest (${quote})`)
      : per ? tr(`Stück pro Stufe (${base})`, `Units per level (${base})`) : tr(`Menge zum Kaufen (${base})`, `Volume to buy (${base})`)
    : unit === 'base'
      ? per ? tr(`Stück pro Stufe (${base})`, `Units per level (${base})`) : tr(`Menge zum Verkaufen (${base})`, `Volume to sell (${base})`)
      : per ? tr(`Erlös pro Stufe (${quote})`, `Proceeds per level (${quote})`) : tr(`Erlös aus dem Verkauf (${quote})`, `Proceeds from the sale (${quote})`)

  // Hinweis unter dem Feld: Umrechnung in die andere Einheit, bei „pro Stufe“ mit der Summe
  const sum = planAmount(input)
  const sumText = unit === 'quote' ? eur(sum) : `${num(sum, volumeDecimals)} ${base}`
  const other = ladder && ladder.totalVolume > 0
    ? unit === 'quote' ? `≈ ${num(ladder.totalVolume, Math.min(volumeDecimals, 6))} ${base}` : `≈ ${eur(ladder.totalCost)}`
    : unit === 'base' && last ? `≈ ${eur(sum * last)}` : ''
  const hint = [
    per ? tr(`× ${steps} Stufen = ${sumText}`, `× ${steps} levels = ${sumText}`) : unit === 'quote' && buy ? usdHint(input.total) || tr('Wird auf alle Stufen verteilt.', 'Spread across all levels.') : '',
    other,
  ].filter(Boolean).join(' · ')

  // Bleibt nach dem Plan weniger als „mindestens behalten“?
  const left = holding && ladder ? holding.available - ladder.totalVolume : null
  const keepBroken = !buy && holding && keep > 0 && left !== null && left < keep - 1e-12

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Segmented<AmountUnit> aria-label={tr('Einheit', 'Unit')} value={unit} onChange={setUnit} options={[
          { id: 'quote', label: quote, title: buy ? tr('Du gibst einen Geldbetrag vor', 'You set an amount of money') : tr('Du gibst vor, wie viel Geld der Verkauf bringen soll', 'You set how much money the sale should bring') },
          { id: 'base', label: tr(`Stück ${base}`, `Units ${base}`), title: buy ? tr(`Du gibst vor, wie viele ${base} du kaufen willst`, `You set how many ${base} you want to buy`) : tr(`Du gibst vor, wie viele ${base} du verkaufen willst`, `You set how many ${base} you want to sell`) },
        ]} />
        <Segmented<'total' | 'per'> aria-label={tr('Bezug', 'Scope')} value={per ? 'per' : 'total'} onChange={(v) => setPer(v === 'per')} options={[
          { id: 'total', label: tr('Gesamt', 'Total'), title: tr('Wird nach der Mengenverteilung auf alle Stufen verteilt', 'Spread across all levels by the size distribution') },
          { id: 'per', label: tr('Pro Stufe', 'Per level'), title: tr('Jede Stufe bekommt genau diesen Wert', 'Every level gets exactly this value') },
        ]} />
      </div>
      <NumberField label={label} value={input.total} onChange={(v) => onChange({ total: v })} hint={hint || undefined} />

      {!buy && holding && (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">
            {tr(<>Du hast <strong className="text-ink">{num(holding.available, volumeDecimals)} {base}</strong> frei</>, <>You have <strong className="text-ink">{num(holding.available, volumeDecimals)} {base}</strong> free</>)}
            {holding.locked > 0 && tr(`, ${num(holding.locked, volumeDecimals)} in offenen Orders`, `, ${num(holding.locked, volumeDecimals)} in open orders`)}
            {holding.earn > 0 && tr(`, ${num(holding.earn, volumeDecimals)} in Earn`, `, ${num(holding.earn, volumeDecimals)} in Earn`)}.
          </p>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tr('Anteil vom Bestand', 'Share of holdings')}>
            {SHARES.map((f) => (
              <button key={f} type="button" className="btn-chip" onClick={() => applyShare(f)}
                title={tr(`${f === 1 ? 'Alles' : `${f * 100} %`} vom freien Bestand${keep > 0 ? `, nach Abzug von ${num(keep, volumeDecimals)} ${base} zum Behalten` : ''}`, `${f === 1 ? 'All' : `${f * 100} %`} of free holdings${keep > 0 ? `, after keeping ${num(keep, volumeDecimals)} ${base}` : ''}`)}>
                {f === 1 ? tr('Alles', 'All') : `${f * 100} %`}
              </button>
            ))}
          </div>
          <NumberField label={tr(`Mindestens behalten (${base})`, `Keep at least (${base})`)} value={keep} emptyValue={0} onChange={(v) => onKeep(Number.isFinite(v) && v > 0 ? v : 0)}
            hint={tr('Wird bei den Prozent-Knöpfen zuerst abgezogen. Leer = nichts behalten.', 'Deducted first when using the percent buttons. Empty = keep nothing.')} />
          {keepBroken && (
            <p className="notice notice-warning text-xs">{tr(
              `Nach diesem Plan blieben nur ${num(Math.max(0, left ?? 0), volumeDecimals)} ${base}, weniger als die ${num(keep, volumeDecimals)} ${base}, die du behalten willst.`,
              `After this plan only ${num(Math.max(0, left ?? 0), volumeDecimals)} ${base} would be left, less than the ${num(keep, volumeDecimals)} ${base} you want to keep.`,
            )}</p>
          )}
        </div>
      )}

      {ladder && alt && ladder.totalVolume > 0 && <UnitCompare input={input} ladder={ladder} alt={alt} base={base} quote={quote} volumeDecimals={volumeDecimals} eur={eur} sym={sym} />}
    </div>
  )
}

/** Kurzer Vergleich: was derselbe Plan mit festen Euro statt festen Stück ergäbe (und umgekehrt) */
function UnitCompare({ input, ladder, alt, base, volumeDecimals, eur }: { input: LadderInput; ladder: Ladder; alt: Ladder; base: string; quote: string; volumeDecimals: number; eur: Fmt; sym: string }) {
  const unit = amountUnit(input)
  const buy = input.side === 'buy'
  // Nur zeigen, wenn es einen spürbaren Unterschied gibt (mehr als 0,1 % beim Durchschnittspreis)
  if (!(alt.averagePrice > 0) || Math.abs(alt.averagePrice / ladder.averagePrice - 1) < 0.001) return null
  // Wurden Stufen auf den Mindest-Orderwert angehoben, verzerrt das den Vergleich: dann lieber keinen zeigen
  if (ladder.raised?.count || alt.raised?.count) return null
  const money = unit === 'quote' ? ladder : alt
  const units = unit === 'base' ? ladder : alt
  const d = Math.min(volumeDecimals, 6)
  const avg = (l: Ladder) => eur(l.averagePrice)
  return (
    <p className="rounded-lg border border-line p-2.5 text-xs text-ink-muted">
      {buy
        ? tr(
          <><strong className="text-ink">Vergleich:</strong> Mit festen Euro je Stufe bekämst du für {eur(money.totalCost)} <strong className="text-ink">{num(money.totalVolume, d)} {base}</strong> (Ø {avg(money)}), mit festen Stück {num(units.totalVolume, d)} {base} für {eur(units.totalCost)} (Ø {avg(units)}). Feste Euro kaufen automatisch mehr, wenn es billiger ist. Feste Stück kaufen immer gleich viel.</>,
          <><strong className="text-ink">Comparison:</strong> With fixed euro per level you would get <strong className="text-ink">{num(money.totalVolume, d)} {base}</strong> for {eur(money.totalCost)} (avg {avg(money)}), with fixed units {num(units.totalVolume, d)} {base} for {eur(units.totalCost)} (avg {avg(units)}). Fixed euro automatically buys more when it is cheaper. Fixed units always buy the same amount.</>,
        )
        : tr(
          <><strong className="text-ink">Vergleich:</strong> Mit festen Stück je Stufe verkaufst du im Schnitt zu <strong className="text-ink">{avg(units)}</strong>, mit festen Euro je Stufe zu {avg(money)}. Feste Stück verkaufen bei höheren Preisen gleich viel und bringen dort darum mehr Geld.</>,
          <><strong className="text-ink">Comparison:</strong> With fixed units per level you sell at <strong className="text-ink">{avg(units)}</strong> on average, with fixed euro per level at {avg(money)}. Fixed units sell the same amount at higher prices and therefore bring more money there.</>,
        )}
    </p>
  )
}
