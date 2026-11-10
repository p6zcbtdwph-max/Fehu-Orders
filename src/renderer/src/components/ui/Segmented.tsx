import type { LucideIcon } from 'lucide-react'
import { arrowKeys } from './Tabs'

// Ein Umschalter für alle Auswahlen innerhalb einer Seite oder Karte (seit v1.63):
// Hell/Dunkel, 30T/90T/1J, 25/5-Pomodoro, Jahr 2026/2025, Balken/Kreis …
// Für Unterbereiche einer Seite gibt es weiterhin <Tabs> (Unterstrich-Leiste).
export interface SegmentOption<T extends string | number> {
  id: T
  label: string
  icon?: LucideIcon
  count?: number
  title?: string
}

interface Props<T extends string | number> {
  options: SegmentOption<T>[]
  value: T
  onChange: (id: T) => void
  size?: 'sm' | 'md'
  /** Füllt die verfügbare Breite gleichmäßig (z. B. in Formularen) */
  block?: boolean
  className?: string
  'aria-label'?: string
}

export default function Segmented<T extends string | number>({ options, value, onChange, size = 'sm', block, className = '', ...rest }: Props<T>): JSX.Element {
  return (
    <div role="radiogroup" aria-label={rest['aria-label']} onKeyDown={arrowKeys(options.map(o => o.id), value, onChange)} className={`segmented ${block ? 'flex w-full' : 'inline-flex'} ${className}`}>
      {options.map(opt => {
        const on = opt.id === value
        const Icon = opt.icon
        return (
          <button
            key={String(opt.id)}
            type="button"
            role="radio"
            aria-checked={on}
            title={opt.title}
            onClick={() => onChange(opt.id)}
            className={`segmented-item ${size === 'md' ? 'segmented-md' : ''} ${block ? 'flex-1' : ''} ${on ? 'segmented-on' : ''}`}
          >
            {Icon && <Icon size={size === 'md' ? 15 : 14} />}
            {opt.label}
            {opt.count !== undefined && <span className="text-xs tabular-nums text-ink-muted">{opt.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
