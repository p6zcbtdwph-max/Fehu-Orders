import type { ReactNode } from 'react'

// Eine ruhige Kennzahlen-Leiste statt vieler Einzelkacheln: höchstens drei
// Werte, die wirklich eine Frage beantworten. Alles, was die Reiter schon
// zählen, gehört nicht hierher.
export interface Kpi {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger'
  /** Klickbare Kennzahl (z. B. wählt sie das Diagramm darunter); `active` markiert die gewählte */
  onClick?: () => void
  active?: boolean
}

const TONE: Record<NonNullable<Kpi['tone']>, string> = {
  default: 'text-ink',
  // Seit v1.62: Werte sind immer Tinte. Farbe nur, wenn sie etwas bedeutet (gut, Warnung, Problem).
  accent: 'text-ink',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
}

// v1.72: Spalten nach dem verfügbaren Platz (Container-Breakpoints), nicht nach dem
// Fenster. Bricht die Leiste in zwei Reihen um, trennen 1-px-Fugen (gap-px auf
// bg-line-soft) auch die Reihen, statt dass Zahlen in schmale Spalten gequetscht werden.
const COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  // Vier Werte nur nebeneinander, wenn die Leiste selbst breit genug ist (sonst brechen Zahlen wie 70.822,3 mitten durch)
  4: 'grid-cols-2 @[40rem]/kpi:grid-cols-4',
  5: 'grid-cols-2 @lg:grid-cols-5',
}

export default function KpiStrip({ items, className = '' }: { items: Kpi[]; className?: string }): JSX.Element {
  return (
    <div className="@container/kpi">
    <div data-kpis className={`card mb-4 grid gap-px overflow-hidden bg-line-soft ${COLS[items.length] ?? ''} ${className}`} style={items.length > 5 ? { gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))' } : undefined}>
      {items.map((k, i) => {
        // Bei 5 Werten in zwei Spalten füllt der letzte die Reihe, statt eine leere Zelle zu lassen
        const span = items.length === 5 && i === 4 ? 'col-span-2 @lg:col-span-1' : ''
        const body = (
          <>
            <p className="truncate text-xs text-ink-muted">{k.label}</p>
            <p className={`mt-0.5 whitespace-nowrap text-2xl font-semibold tabular-nums ${TONE[k.tone ?? 'default']}`}>{k.value}</p>
            {k.hint && <p className="mt-0.5 truncate text-xs text-ink-muted">{k.hint}</p>}
          </>
        )
        return k.onClick ? (
          <button key={k.label} type="button" onClick={k.onClick} aria-pressed={!!k.active}
            className={`relative min-w-0 ${span} px-4 py-3 text-left transition-colors hover:bg-sunken-soft ${k.active ? 'bg-sunken-soft' : 'bg-surface'}`}>
            {body}
            {k.active && <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-accent-500" />}
          </button>
        ) : (
          <div key={k.label} className={`min-w-0 bg-surface px-4 py-3 ${span}`}>{body}</div>
        )
      })}
    </div>
    </div>
  )
}
