// Beim Verkaufen: Liste der Coins, die man besitzt. Ein Klick wählt das Paar im Planer.
import { Wallet } from 'lucide-react'
import type { Holding } from '@shared/holdings'
import { tr } from '@shared/i18n'
import { exName } from '@shared/exchanges'
import { num } from '../format'

export default function HoldingsCard({ holdings, pairId, showAll, onShowAll, onPick, eur, hasKey, loading }: {
  holdings: Holding[]
  pairId: string
  showAll: boolean
  onShowAll: (v: boolean) => void
  onPick: (pairId: string) => void
  eur: (n: number) => string
  hasKey: boolean
  loading: boolean
}): JSX.Element {
  const sellable = holdings.filter((h) => !h.dust)
  const hidden = holdings.length - sellable.length
  const rows = showAll ? holdings : sellable
  return (
    <section className="card mb-4 p-4" aria-label={tr('Dein Bestand', 'Your holdings')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold"><Wallet size={16} /> {tr('Dein Bestand', 'Your holdings')}</span>
        {hasKey && holdings.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" className="checkbox" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} />
            {tr('Alle Paare zeigen', 'Show all pairs')}
          </label>
        )}
      </div>
      {!hasKey ? (
        <p className="text-xs text-ink-muted">{tr(`Mit einem ${exName()}-Schlüssel siehst du hier, welche Coins du besitzt und wie viele davon frei sind. Ohne Schlüssel zeigt die Suche alle Paare.`, `With a ${exName()} key you see here which coins you own and how many of them are free. Without a key the search shows all pairs.`)}</p>
      ) : loading && holdings.length === 0 ? (
        <p className="text-xs text-ink-muted">{tr('Bestand wird geladen …', 'Loading holdings …')}</p>
      ) : holdings.length === 0 ? (
        <p className="text-xs text-ink-muted">{tr(`Bei ${exName()} liegt gerade kein Coin, den du verkaufen könntest. Die Suche zeigt darum alle Paare.`, `There is no coin at ${exName()} right now that you could sell. The search therefore shows all pairs.`)}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th className="num">{tr('Frei', 'Free')}</th>
                  <th className="num">{tr('In Orders', 'In orders')}</th>
                  <th className="num">{tr('In Earn', 'In Earn')}</th>
                  <th className="num">{tr('Wert ca.', 'Value approx.')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const on = h.pair.id === pairId || h.base === holdings.find((x) => x.pair.id === pairId)?.base
                  return (
                    <tr key={h.base} className={`${h.dust ? "text-ink-muted" : "is-clickable"} ${on ? "bg-accent-soft" : ""}`}
                      onClick={() => !h.dust && onPick(h.pair.id)} aria-selected={on}
                      title={h.dust ? tr('Zu wenig frei für eine Order', 'Too little free for an order') : tr(`${h.pair.name} im Planer wählen`, `Choose ${h.pair.name} in the planner`)}>
                      <td>
                        {h.dust ? <span className="font-medium">{h.coin}</span> : (
                          <button type="button" className="btn-link font-medium" onClick={(e) => { e.stopPropagation(); onPick(h.pair.id) }}>{h.coin}</button>
                        )}
                      </td>
                      <td className="num tabular-nums">{h.available > 0 ? num(h.available, h.pair.volumeDecimals) : '–'}</td>
                      <td className="num tabular-nums text-ink-muted">{h.locked > 0 ? num(h.locked, h.pair.volumeDecimals) : '–'}</td>
                      <td className="num tabular-nums text-ink-muted">{h.earn > 0 ? num(h.earn, h.pair.volumeDecimals) : '–'}</td>
                      <td className="num tabular-nums">{h.value !== undefined && h.value > 0 ? eur(h.value) : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {tr('Klick auf einen Coin wählt ihn zum Verkaufen. Verkaufen kannst du nur den freien Bestand: Coins in offenen Orders sind gesperrt, Coins in Earn sind gebunden.', 'Click a coin to sell it. You can only sell free holdings: coins in open orders are locked, coins in Earn are bonded.')}
            {!showAll && hidden > 0 && tr(` ${hidden} ${hidden === 1 ? 'Coin ist' : 'Coins sind'} ausgeblendet, weil frei zu wenig für eine Order da ist.`, ` ${hidden} ${hidden === 1 ? 'coin is' : 'coins are'} hidden because too little is free for an order.`)}
          </p>
        </>
      )}
    </section>
  )
}
