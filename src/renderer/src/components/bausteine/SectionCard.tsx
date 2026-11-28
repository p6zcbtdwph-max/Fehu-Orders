import type { ReactNode } from 'react'
import LinkKnopf from './LinkKnopf'

/** Karte mit Überschrift und optionalem Link oder Knopf rechts. */
export default function SectionCard({ title, action, children, className = '' }: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="section-title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Kleiner Textlink rechts im Kartenkopf. */
export function SectionLink({ onClick, children }: { onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <LinkKnopf onClick={onClick}>
      {children}
    </LinkKnopf>
  )
}
