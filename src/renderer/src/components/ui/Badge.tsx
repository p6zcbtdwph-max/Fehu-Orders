import type { ReactNode } from 'react'

/**
 * Das eine Abzeichen (seit v1.62) für Status, Bewertung und Kategorie.
 * Farben haben überall dieselbe Bedeutung:
 *   neutral = Info/Kategorie · accent = läuft/aktiv · success = erledigt/gut
 *   warning = Achtung · danger = Problem
 */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

// Farben stehen seit v1.64 als Klassen in index.css (.badge, .badge-accent …)
const TONE: Record<BadgeTone, string> = {
  neutral: '',
  accent: 'badge-accent',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
}

/** Nur die Farben eines Abzeichens, für Stellen mit eigener Größe */
const COLORS: Record<BadgeTone, string> = {
  neutral: 'border-line bg-sunken text-ink-muted',
  accent: 'border-accent-500/30 bg-accent-500/10 text-accent-fg',
  success: 'border-success-500/30 bg-success-500/10 text-success-fg',
  warning: 'border-warning-500/30 bg-warning-500/10 text-warning-fg',
  danger: 'border-danger-500/30 bg-danger-500/10 text-danger-fg',
}
export function badgeTone(tone: BadgeTone = 'neutral'): string {
  return COLORS[tone]
}

export function badgeClass(tone: BadgeTone = 'neutral'): string {
  return `badge ${TONE[tone]}`.trim()
}

export default function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: ReactNode; className?: string }): JSX.Element {
  return <span className={`${badgeClass(tone)} ${className}`}>{children}</span>
}
