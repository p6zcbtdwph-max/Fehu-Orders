// Mindest-Orderwert im Planer und bei Entwürfen: was gilt, und Warnung, wenn Stufen angehoben wurden
import { ArrowUpCircle, Info } from 'lucide-react'
import { amountUnit, effectiveMinCost, planAmount, type Ladder, type LadderInput, type PairRules } from '@shared/ladder'
import { tr } from '@shared/i18n'
import { exName } from '@shared/exchanges'
import { num } from '../format'
import LinkKnopf from './bausteine/LinkKnopf'

type Fmt = (n: number) => string

/** Eine Zeile: was je Order mindestens gilt und woher der Wert kommt */
export function MinOrderLine({ userMin, price, rules, pairName, eur, onOpenSettings }: { userMin: number; price: number; rules: PairRules; pairName: string; eur: Fmt; onOpenSettings?: () => void }) {
  if (!(price > 0)) return null
  const m = effectiveMinCost(userMin, price, rules)
  return (
    <p className="flex items-start gap-1.5 text-xs text-ink-muted">
      <Info size={13} className="mt-0.5 flex-shrink-0" />
      <span>
        {tr(
          <>Jede Order mindestens <strong className="text-ink">{eur(m.effective)}</strong>. Dein Mindest-Orderwert: {eur(m.user)}. {exName()} verlangt bei {pairName} mindestens {eur(m.exchange)}{m.exchangeHigher ? ', darum gilt dieser Wert' : ''}. Kleinere Stufen hebt der Planer automatisch an.</>,
          <>Every order at least <strong className="text-ink">{eur(m.effective)}</strong>. Your minimum order value: {eur(m.user)}. {exName()} requires at least {eur(m.exchange)} for {pairName}{m.exchangeHigher ? ', so that value applies' : ''}. The planner raises smaller levels automatically.</>,
        )}
        {onOpenSettings && <> <LinkKnopf onClick={onOpenSettings}>{tr('Ändern', 'Change')}</LinkKnopf></>}
      </span>
    </p>
  )
}

/**
 * Warnung, wenn Stufen auf den Mindest-Orderwert angehoben wurden. Dadurch wird der Plan größer als eingegeben:
 * beim Kauf mehr Euro, beim Verkauf mehr Menge.
 */
export function RaisedNotice({ ladder, input, rules, userMin, base, eur }: { ladder: Ladder; input: LadderInput; rules: PairRules; userMin: number; base: string; eur: Fmt }) {
  const count = ladder.raised?.count ?? 0
  if (!count) return null
  const first = ladder.levels.find((l) => l.raised)
  const min = effectiveMinCost(userMin, first?.price ?? input.priceStart, rules).effective
  // „buy“ heißt hier: der Plan ist in Geld angegeben (früher immer beim Kauf), sonst in Stück
  const buy = amountUnit(input) === 'quote'
  const before = planAmount(input)
  const after = buy ? ladder.totalCost : ladder.totalVolume
  const grows = buy ? after - before >= 0.01 : after > before * (1 + 1e-9)
  // Wie viele Stufen passen in den eingegebenen Betrag, ohne dass etwas angehoben werden muss (nur bei Geld sinnvoll)
  const fit = buy && !input.perLevel && min > 0 ? Math.floor(before / (min * 1.01)) : 0
  const levels = tr(count === 1 ? '1 Stufe lag' : `${count} Stufen lagen`, count === 1 ? '1 level was' : `${count} levels were`)
  return (
    <p className="notice notice-warning flex items-start gap-2">
      <ArrowUpCircle size={16} className="mt-0.5 flex-shrink-0" />
      <span>
        {tr(
          <><strong>{levels} unter dem Mindest-Orderwert</strong> von {eur(min)} und {count === 1 ? 'wurde' : 'wurden'} darauf angehoben, damit {exName()} {count === 1 ? 'sie' : 'sie'} annimmt.{' '}
            {grows
              ? buy ? <>Dadurch steigt der Betrag von {eur(before)} auf <strong>{eur(after)}</strong>.</> : <>Dadurch steigt die Menge von {num(before, rules.volumeDecimals)} auf <strong>{num(after, rules.volumeDecimals)} {base}</strong>.</>
              : <>Der Gesamtbetrag ändert sich dadurch kaum.</>}
            {grows && (fit >= 1 && fit < input.steps ? <> Willst du bei {eur(before)} bleiben, wähle höchstens {fit} {fit === 1 ? 'Stufe' : 'Stufen'}.</> : <> Willst du beim eingegebenen Wert bleiben, wähle weniger Stufen.</>)}</>,
          <><strong>{levels} below the minimum order value</strong> of {eur(min)} and {count === 1 ? 'was' : 'were'} raised to it so that {exName()} accepts {count === 1 ? 'it' : 'them'}.{' '}
            {grows
              ? buy ? <>This raises the amount from {eur(before)} to <strong>{eur(after)}</strong>.</> : <>This raises the volume from {num(before, rules.volumeDecimals)} to <strong>{num(after, rules.volumeDecimals)} {base}</strong>.</>
              : <>The total barely changes.</>}
            {grows && (fit >= 1 && fit < input.steps ? <> To stay at {eur(before)}, choose at most {fit} {fit === 1 ? 'level' : 'levels'}.</> : <> To keep the value you entered, choose fewer levels.</>)}</>,
        )}
      </span>
    </p>
  )
}
