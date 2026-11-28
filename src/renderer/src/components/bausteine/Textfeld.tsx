import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { FeldRahmen, useFeldIds, type FeldTexte } from './FeldRahmen'

// Mehrzeiliges Textfeld (Fehu Design, 03 Bausteine.md › Textfeld). Gleiche Hülle wie <Feld>.

export type TextfeldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FeldTexte

const Textfeld = forwardRef<HTMLTextAreaElement, TextfeldProps>(function Textfeld(
  { label, hinweis, fehler, id, className = '', 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const v = useFeldIds(id, describedBy, { hinweis, fehler })
  return (
    <FeldRahmen label={label} hinweis={hinweis} fehler={fehler} id={v.id} hinweisId={v.hinweisId} fehlerId={v.fehlerId}>
      <textarea
        ref={ref}
        id={id ?? (label || hinweis || fehler ? v.id : undefined)}
        aria-describedby={v.describedBy}
        aria-invalid={ariaInvalid ?? (v.invalid || undefined)}
        className={`input py-2 ${fehler ? 'border-danger' : ''} ${className}`.trim()}
        {...rest}
      />
    </FeldRahmen>
  )
})

export default Textfeld
