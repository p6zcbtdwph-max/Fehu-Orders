import type React from 'react'
import type { LucideIcon } from 'lucide-react'

// Einheitliche Reiter für alle Seiten.
// variant="underline" (Standard): Unterbereiche einer Seite, direkt unter dem Seitenkopf. Nur Text + Anzahl.
// variant="segmented": kleine Umschalter innerhalb einer Karte (z. B. Monat/Jahr, Liste/Raster).
export interface TabItem<T extends string> {
  id: T
  label: string
  icon?: LucideIcon
  count?: number
}

interface Props<T extends string> {
  tabs: TabItem<T>[]
  active: T
  onChange: (id: T) => void
  variant?: 'underline' | 'segmented'
  className?: string
}

/** Pfeiltasten links/rechts wechseln die Auswahl (gleiche Tastatur-Logik für Reiter und Umschalter, v1.63) */
export function arrowKeys<T>(ids: T[], active: T, onChange: (id: T) => void) {
  return (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = ids.indexOf(active)
    if (i < 0) return
    const next = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]
    e.preventDefault()
    onChange(next)
    const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=tab],[role=radio]')
    buttons[ids.indexOf(next)]?.focus()
  }
}

export default function Tabs<T extends string>({ tabs, active, onChange, variant = 'underline', className = '' }: Props<T>): JSX.Element {
  const onKeyDown = arrowKeys(tabs.map(x => x.id), active, onChange)
  if (variant === 'segmented') {
    // Gleiche Optik wie <Segmented> (seit v1.63: ein Umschalter für alle Auswahlen)
    return (
      <div role="tablist" onKeyDown={onKeyDown} className={`segmented inline-flex ${className}`}>
        {tabs.map(tab => {
          const on = tab.id === active
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(tab.id)}
              className={`segmented-item ${on ? 'segmented-on' : ''}`}
            >
              {Icon && <Icon size={14} />}
              {tab.label}
              {tab.count !== undefined && <span className="text-xs tabular-nums text-ink-muted">{tab.count}</span>}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div role="tablist" onKeyDown={onKeyDown} className={`flex flex-wrap gap-1 border-b border-line ${className}`}>
      {tabs.map(tab => {
        const on = tab.id === active
        // Seit v1.62 haben Reiter keine Symbole mehr: eine Leiste sieht überall gleich aus.
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
              on
                ? 'border-accent-500 font-semibold text-accent-fg'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? 'bg-accent-soft text-accent-fg dark:text-accent-300' : 'bg-sunken text-ink-muted'}`}>
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
