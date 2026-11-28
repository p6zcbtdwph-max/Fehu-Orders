import { forwardRef, type SelectHTMLAttributes } from 'react'
import { FeldRahmen, useFeldIds, type FeldTexte } from './FeldRahmen'

// Die eine Auswahl (Fehu Design, 03 Bausteine.md › Auswahl): sieht aus wie das Eingabefeld, Pfeil rechts.
// Aussehen aus .select in assets/index.css. Gleiche API wie im Lifemanager.

export type AuswahlProps = SelectHTMLAttributes<HTMLSelectElement> & FeldTexte

const Auswahl = forwardRef<HTMLSelectElement, AuswahlProps>(function Auswahl(
  { label, hinweis, fehler, id, className = '', children, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const v = useFeldIds(id, describedBy, { hinweis, fehler })
  return (
    <FeldRahmen label={label} hinweis={hinweis} fehler={fehler} id={v.id} hinweisId={v.hinweisId} fehlerId={v.fehlerId}>
      <select
        ref={ref}
        id={id ?? (label || hinweis || fehler ? v.id : undefined)}
        aria-describedby={v.describedBy}
        aria-invalid={ariaInvalid ?? (v.invalid || undefined)}
        className={`select ${fehler ? 'border-danger' : ''} ${className}`.trim()}
        {...rest}
      >
        {children}
      </select>
    </FeldRahmen>
  )
})

export default Auswahl
