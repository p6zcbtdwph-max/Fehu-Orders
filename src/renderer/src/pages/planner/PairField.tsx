// Planer: Handelspaar wählen, Watchlist (Stern und Schnellauswahl) und aktueller Kurs.
import { useEffect, useState } from 'react'
import { RefreshCw, Star } from 'lucide-react'
import { tr } from '@shared/i18n'
import type { PairDto } from '@shared/ipc'
import { api } from '../../api'
import PairPicker from '../../components/PairPicker'
import { useMoney } from '../../money'

export default function PairField({ pairs, pickable, pairId, pair, last, onPick, onReload }: {
  /** Alle Paare der Börse (für die Schnellauswahl) */
  pairs: PairDto[]
  /** Paare, die die Suche zeigt (beim Verkaufen nur die mit Bestand) */
  pickable: PairDto[]
  pairId: string
  pair: PairDto | undefined
  last: number | null
  onPick: (id: string) => void
  onReload: () => void
}): JSX.Element {
  const { fmtPrice, sym } = useMoney()
  const [watchlist, setWatchlist] = useState<string[]>([])
  useEffect(() => { api().settings().then((s) => setWatchlist(s.watchlist ?? [])).catch(() => undefined) }, [])
  function toggleWatch(name: string) {
    const next = watchlist.includes(name) ? watchlist.filter((x) => x !== name) : [...watchlist, name]
    setWatchlist(next)
    api().saveSettings({ watchlist: next })
  }
  const watched = pairs.filter((p) => watchlist.includes(p.name))
  return (
    <div>
      <span className="label">{tr('Handelspaar', 'Trading pair')}</span>
      <span className="flex gap-2">
        <PairPicker pairs={pickable} value={pairId} watchlist={watchlist} onChange={onPick} />
        {pair && (
          <button type="button" className="btn btn-ghost btn-icon flex-shrink-0" aria-pressed={watchlist.includes(pair.name)} onClick={() => toggleWatch(pair.name)}
            aria-label={watchlist.includes(pair.name) ? tr('Von der Watchlist nehmen', 'Remove from watchlist') : tr('Auf die Watchlist', 'Add to watchlist')} title={watchlist.includes(pair.name) ? tr('Von der Watchlist nehmen', 'Remove from watchlist') : tr('Auf die Watchlist', 'Add to watchlist')}>
            <Star size={16} className={watchlist.includes(pair.name) ? 'fill-current text-accent-fg' : ''} />
          </button>
        )}
      </span>
      {watched.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {watched.map((p) => (
            <button key={p.id} type="button" className={`btn-chip ${p.id === pairId ? 'segmented-on' : ''}`} aria-pressed={p.id === pairId} onClick={() => onPick(p.id)}>{p.name.split('/')[0]}</button>
          ))}
        </div>
      )}
      <span className="mt-1.5 flex items-center gap-2 text-xs text-ink-muted">
        {tr('Aktueller Kurs', 'Current price')}: {last && pair ? `${fmtPrice(last, pair.priceDecimals)} ${sym}` : '…'}
        <button type="button" className="btn-mini" onClick={onReload} aria-label={tr('Kurs neu laden', 'Reload price')} title={tr('Kurs neu laden', 'Reload price')}><RefreshCw size={14} /></button>
      </span>
    </div>
  )
}
