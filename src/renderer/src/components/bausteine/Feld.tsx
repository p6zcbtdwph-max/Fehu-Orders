import { forwardRef, type InputHTMLAttributes } from 'react'
import { FeldRahmen, useFeldIds, type FeldTexte } from './FeldRahmen'

// Das eine Eingabefeld für Text und Zahlen (Fehu Design, 03 Bausteine.md › Eingabefeld).
// Aussehen aus .input in assets/index.css. Gleiche API wie im Lifemanager.
// Für Haken gibt es <Haken>, für mehrzeiligen Text <Textfeld>.

export type FeldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & FeldTexte & {
  type?: 'text' | 'number' | 'search' | 'email' | 'url' | 'tel' | 'password' | 'date' | 'time'
}

const Feld = forwardRef<HTMLInputElement, FeldProps>(function Feld(
  { label, hinweis, fehler, id, className = '', type = 'text', 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const v = useFeldIds(id, describedBy, { hinweis, fehler })
  return (
    <FeldRahmen label={label} hinweis={hinweis} fehler={fehler} id={v.id} hinweisId={v.hinweisId} fehlerId={v.fehlerId}>
      <input
        ref={ref}
        id={id ?? (label || hinweis || fehler ? v.id : undefined)}
        type={type}
        aria-describedby={v.describedBy}
        aria-invalid={ariaInvalid ?? (v.invalid || undefined)}
        className={`input ${fehler ? 'border-danger' : ''} ${className}`.trim()}
        {...rest}
      />
    </FeldRahmen>
  )
})

export default Feld
