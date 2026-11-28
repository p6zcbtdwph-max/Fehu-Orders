import { useId, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

// Gemeinsamer Rahmen für Feld, Auswahl und Textfeld: Etikett darüber, Hinweis und Fehler darunter.
// Ohne label, hinweis und fehler bleibt nur das Bedienelement selbst (kein zusätzliches <div>),
// so passt der Baustein auch in Zeilen, in denen das Etikett schon woanders steht.

export interface FeldTexte {
  /** Sichtbares Etikett über dem Feld */
  label?: ReactNode
  /** Hilfetext unter dem Feld */
  hinweis?: ReactNode
  /** Fehlertext unter dem Feld. Sagt, was zu tun ist. Färbt den Rand rot. */
  fehler?: ReactNode
}

interface Verknuepfung {
  id: string
  describedBy: string | undefined
  invalid: boolean
}

/** Liefert id und aria-describedby für das Feld; eigene Werte des Aufrufers gehen vor bzw. bleiben erhalten. */
export function useFeldIds(id: string | undefined, describedBy: string | undefined, { hinweis, fehler }: FeldTexte): Verknuepfung & { hinweisId: string; fehlerId: string } {
  const auto = useId()
  const feldId = id ?? `feld-${auto}`
  const hinweisId = `${feldId}-hinweis`
  const fehlerId = `${feldId}-fehler`
  const ids = [describedBy, hinweis ? hinweisId : '', fehler ? fehlerId : ''].filter(Boolean).join(' ')
  return { id: feldId, describedBy: ids || undefined, invalid: !!fehler, hinweisId, fehlerId }
}

export function FeldRahmen({ label, hinweis, fehler, id, hinweisId, fehlerId, children }: FeldTexte & {
  id: string
  hinweisId: string
  fehlerId: string
  children: ReactNode
}): JSX.Element {
  if (!label && !hinweis && !fehler) return <>{children}</>
  return (
    <div className="min-w-0">
      {label && <label htmlFor={id} className="label">{label}</label>}
      {children}
      {hinweis && <p id={hinweisId} className="mt-1 text-xs text-ink-muted">{hinweis}</p>}
      {fehler && (
        <p id={fehlerId} role="alert" className="mt-1 flex items-start gap-1 text-xs text-danger-fg">
          <AlertTriangle size={14} aria-hidden="true" className="mt-px flex-shrink-0" />
          <span>{fehler}</span>
        </p>
      )}
    </div>
  )
}
