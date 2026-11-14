import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Star } from 'lucide-react'
import type { PairDto } from '@shared/ipc'
import { searchPairs } from '@shared/pair-search'
import { exName } from '@shared/exchanges'

/** Suchfeld für Handelspaare: Coin-Symbol tippen, mit Pfeiltasten wählen, Enter übernimmt. */
export default function PairPicker({ pairs, value, watchlist, onChange }: { pairs: PairDto[]; value: string; watchlist: string[]; onChange: (id: string) => void }): JSX.Element {
  const current = pairs.find((p) => p.id === value)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const hits = useMemo(() => searchPairs(pairs, query, watchlist).slice(0, 60), [pairs, query, watchlist])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function pick(p: PairDto) {
    onChange(p.id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={box} className="relative w-full">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"><Search size={16} /></span>
      <input
        className="input w-full pl-9"
        role="combobox"
        aria-expanded={open}
        aria-controls="pair-list"
        aria-label="Handelspaar suchen"
        placeholder={current ? `${current.name} · Symbol suchen …` : 'Symbol suchen, z. B. SOL'}
        value={open ? query : current?.name ?? ''}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, hits.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]); (e.target as HTMLInputElement).blur() }
          else if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur() }
        }}
      />
      {open && (
        <ul id="pair-list" ref={list} role="listbox" className="card absolute z-30 mt-1 max-h-72 w-full overflow-y-auto p-1 shadow-lg">
          {hits.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">Kein Paar mit „{query}“ bei {exName()}.</li>}
          {hits.map((p, i) => (
            <li key={p.id} data-i={i} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(p) }} onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between rounded-md px-3 py-1.5 text-sm ${i === active ? 'bg-accent-soft text-ink' : 'text-ink'} ${p.id === value ? 'font-medium' : ''}`}>
              <span>
                <span className="font-medium">{p.name.split('/')[0]}</span>
                <span className="text-ink-muted"> / {p.name.split('/')[1]}</span>
              </span>
              {watchlist.includes(p.name) && <Star size={14} className="fill-current text-accent-fg" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
