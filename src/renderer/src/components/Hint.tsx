// Ein Hinweis-System für Erklärungen: beim ersten Mal ganz, nach „Verstanden“ nur noch eine Zeile,
// die sich bei Bedarf wieder aufklappen lässt. Warnungen und Fehler (zu wenig Guthaben, falsche Kursseite …)
// sind keine Hints, sie bleiben immer sichtbar.
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Info, type LucideIcon } from 'lucide-react'
import { tr } from '@shared/i18n'

const KEY = 'fehu-orders-hints-seen'
const listeners = new Set<() => void>()

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

let seen = read()
function write(next: string[]): void {
  seen = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ohne Speicher: gilt bis zum Neustart */ }
  listeners.forEach((l) => l())
}

/** Alle Erklärungen wieder ganz zeigen (Einstellungen) */
export function resetHints(): void {
  write([])
}
export const seenHintCount = (): number => seen.length

function useSeen(id: string): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => seen.includes(id))
}

type Tone = 'info' | 'accent'

/**
 * id: fester Name, unter dem „Verstanden“ gemerkt wird.
 * title: kurze Zeile, die nach „Verstanden“ stehen bleibt (z. B. „Jede Order braucht echtes Guthaben.“).
 * children: die ganze Erklärung.
 */
export default function Hint({ id, title, children, tone = 'info', icon: Icon = Info, className = '' }: { id: string; title: ReactNode; children: ReactNode; tone?: Tone; icon?: LucideIcon; className?: string }): JSX.Element {
  const isSeen = useSeen(id)
  const [open, setOpen] = useState(false)
  if (isSeen && !open) {
    return (
      <button type="button" className={`flex w-full items-center gap-2 text-left text-xs text-ink-muted hover:text-ink ${className}`} onClick={() => setOpen(true)} aria-expanded={false}>
        <Icon size={14} className="flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDown size={14} className="flex-shrink-0" aria-hidden />
        <span className="sr-only">{tr('Erklärung aufklappen', 'Show explanation')}</span>
      </button>
    )
  }
  return (
    <div className={`notice notice-${tone} flex items-start gap-2 text-xs ${className}`}>
      <Icon size={14} className="mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <strong>{title}</strong> {children}
      </div>
      {isSeen
        ? <button type="button" className="btn-link flex-shrink-0 text-xs" onClick={() => setOpen(false)} aria-expanded>{tr('Einklappen', 'Collapse')} <ChevronUp size={12} className="inline" aria-hidden /></button>
        : <button type="button" className="btn-link flex-shrink-0 text-xs" onClick={() => write([...seen, id])}>{tr('Verstanden', 'Got it')}</button>}
    </div>
  )
}
