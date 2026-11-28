import { forwardRef, type ButtonHTMLAttributes } from 'react'

// Textknopf ohne Fläche (Fehu Design, 03 Bausteine.md › Knopf, Art „link“): Sprung zu einer anderen
// Stelle oder kleine Nebenaktion im Text („Alle anzeigen“, „Übernehmen“). Aussehen aus .btn-link.
// leise = graue Variante (.btn-quiet), z. B. „Erledigte zeigen“.

export type LinkKnopfProps = ButtonHTMLAttributes<HTMLButtonElement> & { leise?: boolean }

const LinkKnopf = forwardRef<HTMLButtonElement, LinkKnopfProps>(function LinkKnopf(
  { leise, className = '', type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={`${leise ? 'btn-quiet' : 'btn-link'} ${className}`.trim()} {...rest} />
})

export default LinkKnopf
