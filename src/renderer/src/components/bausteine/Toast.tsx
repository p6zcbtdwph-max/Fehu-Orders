import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useLanguage } from '../../i18n'
import { toastDauer, toastHinzu, type ToastAktion, type ToastArt, type ToastDaten } from './toast-regeln'

// Toast (Fehu Design, 03 Bausteine.md › Toast): unten rechts, dunkle Fläche toast / on-toast,
// Aktion in toast-action. 4 s, mit Aktion 10 s, Fehler bleiben bis zum Schließen.
// Ein Satz ohne „erfolgreich“: „Export fertig“, „Vorlage gelöscht“.
//
//   const toast = useToast()
//   toast('Export fertig')
//   toast('Vorlage gelöscht', { aktion: { label: 'Rückgängig', onClick: undo } })
//   toast('Export hat nicht geklappt', { art: 'fehler' })

export interface ToastOptionen {
  art?: ToastArt
  aktion?: ToastAktion
}
type ToastFn = (text: string, optionen?: ToastOptionen) => void

const ToastKontext = createContext<ToastFn | null>(null)

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [liste, setListe] = useState<ToastDaten[]>([])
  const naechste = useRef(1)
  const schliessen = useCallback((id: number) => setListe((l) => l.filter((t) => t.id !== id)), [])
  const zeigen = useCallback<ToastFn>((text, { art = 'info', aktion } = {}) => {
    const id = naechste.current++
    setListe((l) => toastHinzu(l, { id, text, art, aktion }))
  }, [])
  return (
    <ToastKontext.Provider value={zeigen}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96">
          {liste.map((t) => <ToastZeile key={t.id} toast={t} onClose={schliessen} />)}
        </div>,
        document.body,
      )}
    </ToastKontext.Provider>
  )
}

/** Toast zeigen. Ohne Provider (z. B. in Tests) passiert nichts. */
export function useToast(): ToastFn {
  const fn = useContext(ToastKontext)
  return useMemo(() => fn ?? (() => {}), [fn])
}

function ToastZeile({ toast, onClose }: { toast: ToastDaten; onClose: (id: number) => void }): JSX.Element {
  const { t } = useLanguage()
  const [pause, setPause] = useState(false)
  const dauer = toastDauer(toast.art, !!toast.aktion)
  useEffect(() => {
    if (dauer === null || pause) return
    const timer = window.setTimeout(() => onClose(toast.id), dauer)
    return () => window.clearTimeout(timer)
  }, [dauer, pause, onClose, toast.id])
  return (
    <div
      role={toast.art === 'fehler' ? 'alert' : 'status'}
      aria-live={toast.art === 'fehler' ? 'assertive' : 'polite'}
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
      className="toast-enter pointer-events-auto flex items-center gap-3 rounded-lg bg-toast py-2 pl-4 pr-2 text-sm text-toast-ink shadow-md"
    >
      <span className="min-w-0 flex-1">{toast.text}</span>
      {toast.aktion && (
        <button
          type="button"
          onClick={() => { toast.aktion?.onClick(); onClose(toast.id) }}
          className="h-control-sm flex-shrink-0 rounded-md px-2 text-sm font-medium text-toast-action hover:underline"
        >
          {toast.aktion.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        aria-label={t('common.close')}
        title={t('common.close')}
        className="inline-flex h-control-sm w-control-sm flex-shrink-0 items-center justify-center rounded-md text-toast-ink hover:bg-toast-ink/10"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
