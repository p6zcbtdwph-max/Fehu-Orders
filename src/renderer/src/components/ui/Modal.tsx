import { useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useLanguage } from '../../i18n'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

interface Props {
  /** Titel oben links. Ohne Titel nur der Inhalt (z. B. eigene Kopfzeile). */
  title?: ReactNode
  /** Kleine Zeile unter dem Titel */
  subtitle?: ReactNode
  /** Symbol vor dem Titel */
  icon?: ReactNode
  /** Klick auf den Hintergrund, Esc und das ✕ schließen. Ohne onClose bleibt der Dialog offen, bis gespeichert wird. */
  onClose?: () => void
  /** sm = Rückfrage/kleines Formular, md = Standard, lg = großes Formular, xl = Übersicht */
  size?: ModalSize
  /** Buttons unten rechts: links „Abbrechen“, rechts die Hauptaktion */
  footer?: ReactNode
  /** Kleine Knöpfe im Kopf links vom ✕ (z. B. Woche vor/zurück) */
  headerActions?: ReactNode
  /** Zusätzliche Klassen für den Inhaltsbereich (z. B. space-y-4) */
  className?: string
  /** Inhalt füllt den Dialog ohne Innenabstand (Listen, Bilder) */
  flush?: boolean
  children?: ReactNode
}

// Der eine Dialog der App (seit v1.61). Alle Fenster haben dieselben Breiten,
// denselben Kopf mit ✕, denselben Abstand und dieselbe Fußzeile.
// Esc, Enter und der Fokus kommen aus utils/modalKeys.ts (über data-modal).
export default function Modal({ title, subtitle, icon, onClose, size = 'md', footer, headerActions, className = '', flush, children }: Props): JSX.Element {
  const { t } = useLanguage()
  const titleId = useId()
  // Immer direkt in <body>: so liegt ein Dialog im Dialog sicher obenauf
  // (die Einblend-Animation des Fensters würde fixe Kinder sonst einsperren).
  return createPortal(
    <div data-modal className="modal-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`modal-panel modal-${size} flex max-h-[88vh] flex-col`}
        onClick={e => e.stopPropagation()}
      >
        {(title || onClose) && (
          <div className={`modal-head ${title ? '' : 'pb-0'}`}>
            {icon && <span className="mt-0.5 flex-shrink-0 text-accent-fg">{icon}</span>}
            <div className="min-w-0 flex-1">
              {title && <h2 id={titleId} className="card-title">{title}</h2>}
              {subtitle && <div className="mt-0.5 text-sm text-ink-muted">{subtitle}</div>}
            </div>
            {headerActions && <div className="-mt-1 flex flex-shrink-0 items-center gap-1">{headerActions}</div>}
            {onClose && (
              <button type="button" onClick={onClose} data-modal-close aria-label={t('common.close')} title={t('common.close')}
                className="btn btn-ghost btn-icon -mr-2 -mt-1 h-7 w-7 flex-shrink-0">
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className={flush ? `min-h-0 flex-1 overflow-y-auto ${className}` : `modal-body ${title || onClose ? '' : 'pt-6'} ${className}`}>
          {children}
        </div>
        {footer && <div className="modal-foot modal-actions">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
