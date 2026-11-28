import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// Der eine Knopf der App (Fehu Design, 03 Bausteine.md › Knopf).
// Aussehen kommt aus den Klassen .btn-* in assets/index.css, die auf den Fehu-Tokens stehen.
// Gleiche API wie im Lifemanager.

export type KnopfArt = 'primaer' | 'sekundaer' | 'leise' | 'gefahr'
export type KnopfGroesse = 'klein' | 'normal' | 'gross'

const ART: Record<KnopfArt, string> = {
  primaer: 'btn-primary',
  sekundaer: 'btn-secondary',
  leise: 'btn-ghost',
  gefahr: 'btn-danger',
}
const GROESSE: Record<KnopfGroesse, string> = { klein: 'btn-sm', normal: '', gross: 'btn-lg' }
const SYMBOL_PX: Record<KnopfGroesse, number> = { klein: 14, normal: 16, gross: 16 }

type Basis = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Standard 'sekundaer'. Höchstens ein 'primaer' je Ansicht. */
  art?: KnopfArt
  /** klein 28, normal 32, gross 40 px. Standard 'normal'. */
  groesse?: KnopfGroesse
  /** lucide-Symbol links vom Text */
  symbol?: LucideIcon
}
type MitText = Basis & { nurSymbol?: false }
/** Nur Symbol: quadratisch, braucht einen Namen für Screenreader und Tooltip. */
type NurSymbol = Basis & { nurSymbol: true; symbol: LucideIcon; 'aria-label': string; children?: never }

export type KnopfProps = MitText | NurSymbol

export function knopfKlassen(art: KnopfArt = 'sekundaer', groesse: KnopfGroesse = 'normal', nurSymbol = false, extra = ''): string {
  return ['btn', ART[art], GROESSE[groesse], nurSymbol ? 'btn-icon' : '', extra].filter(Boolean).join(' ')
}

const Knopf = forwardRef<HTMLButtonElement, KnopfProps>(function Knopf(
  { art = 'sekundaer', groesse = 'normal', symbol: Symbol, nurSymbol, className = '', type = 'button', title, children, ...rest },
  ref,
) {
  // Symbolknopf: Tooltip mit demselben Text wie aria-label (03 Bausteine.md)
  const tooltip = title ?? (nurSymbol ? rest['aria-label'] : undefined)
  return (
    <button ref={ref} type={type} title={tooltip} className={knopfKlassen(art, groesse, !!nurSymbol, className)} {...rest}>
      {Symbol && <Symbol size={SYMBOL_PX[groesse]} aria-hidden="true" className="flex-shrink-0" />}
      {children as ReactNode}
    </button>
  )
})

export default Knopf
