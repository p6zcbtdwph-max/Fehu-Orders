import { forwardRef, type ButtonHTMLAttributes } from 'react'

// Chip (Fehu Design, 03 Bausteine.md › Filterchip): Pille, Höhe 28, für Schnellauswahl in Leisten.
// Aussehen aus .btn-chip. aktiv setzt aria-pressed und die Markierung.

export type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & { aktiv?: boolean }

const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip({ aktiv, className = '', type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={aktiv}
      className={`btn-chip ${aktiv ? 'segmented-on' : ''} ${className}`.trim()}
      {...rest}
    />
  )
})

export default Chip
