import { forwardRef, type InputHTMLAttributes } from 'react'

// Haken (Checkbox), Fehu Design 03 Bausteine.md › Haken und Schalter: 16 × 16, angehakt Gold.
// Aussehen aus .checkbox in assets/index.css. Das Etikett steht rechts daneben in einem <label>,
// das den Haken umschließt, damit die ganze Zeile klickbar ist.

export type HakenProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

const Haken = forwardRef<HTMLInputElement, HakenProps>(function Haken({ className = '', ...rest }, ref) {
  return <input ref={ref} type="checkbox" className={`checkbox ${className}`.trim()} {...rest} />
})

export default Haken
