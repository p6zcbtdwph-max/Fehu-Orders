import { useEffect, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, GraduationCap, PlayCircle, X } from 'lucide-react'

export type GuidePage = 'planner' | 'drafts' | 'orders' | 'key' | 'settings'

interface Step {
  title: string
  body: ReactNode
  /** Seite, die zu diesem Schritt geöffnet wird */
  page?: GuidePage
  /** Bereich mit data-guide="…", der hervorgehoben wird */
  target?: string
}

export const GUIDE_STEPS: Step[] = [
  {
    title: 'Willkommen bei Fehu Orders',
    body: (
      <>
        <p>Statt einer großen Order legst du hier <strong>viele kleine Limit-Orders</strong> auf einmal an, zum Beispiel alle paar Prozent tiefer ein Stück.</p>
        <p>Eine <strong>Limit-Order</strong> wird nur zu deinem Preis oder besser ausgeführt. Fällt der Kurs, wird Stufe für Stufe gekauft. Steigt er, wird verkauft.</p>
        <p>In sieben kurzen Schritten zeigen wir dir, wo was ist.</p>
      </>
    ),
  },
  {
    page: 'planner', target: 'pair', title: '1. Coin und Betrag',
    body: (
      <>
        <p>Tippe bei <strong>Handelspaar</strong> das Symbol ein, zum Beispiel <em>SOL</em>. Mit dem Stern landet ein Paar auf deiner Watchlist und ist mit einem Klick wieder da.</p>
        <p>Wähle <strong>Kaufen</strong> oder <strong>Verkaufen</strong> und rechts den <strong>Betrag</strong>. Er wird auf alle Stufen verteilt.</p>
      </>
    ),
  },
  {
    page: 'planner', target: 'plan', title: '2. Die Stufen festlegen',
    body: (
      <>
        <p><strong>Erste und letzte Stufe</strong> sind Anfang und Ende deiner Staffel, beim Kaufen meist knapp unter und deutlich unter dem Kurs. Dazwischen liegen so viele Stufen, wie du bei <strong>Anzahl</strong> einträgst.</p>
        <p><strong>Preisabstände</strong>: gleiche Euro-Abstände oder gleiche Prozent-Abstände zwischen den Stufen.</p>
        <p><strong>Mengenverteilung</strong> bestimmt, wie viel Geld auf jede Stufe kommt. „Gleich“ heißt überall gleich viel, „Linear“ oder „Exponentiell“ heißt: je weiter weg vom Kurs, desto mehr.</p>
        <p>Mit <strong>Davon jetzt senden</strong> schickst du erst die Stufen nah am Kurs. Den Rest kannst du später nachschieben.</p>
      </>
    ),
  },
  {
    page: 'planner', target: 'result', title: '3. Ergebnis prüfen',
    body: (
      <>
        <p>Oben siehst du, was der Plan kostet, die geschätzte <strong>Gebühr</strong> und den <strong>Durchschnittspreis</strong>, falls alle Stufen ausgeführt werden.</p>
        <p>Im Chart zeigen die gestrichelten Linien, wo deine Orders im Kursverlauf liegen. Reicht dein Guthaben nicht, sagt die App es dir, bevor etwas rausgeht.</p>
      </>
    ),
  },
  {
    page: 'planner', target: 'actions', title: '4. Erst prüfen, dann senden',
    body: (
      <>
        <p><strong>Probelauf</strong>: Kraken prüft jede Order, legt aber nichts an. Mach das vor jedem echten Plan.</p>
        <p><strong>An Kraken senden</strong> legt die Orders wirklich an, erst nach einer Bestätigung. Eine Obergrenze pro Plan in den Einstellungen schützt vor Tippfehlern.</p>
      </>
    ),
  },
  {
    page: 'drafts', target: 'drafts', title: '5. Entwürfe: erst planen, später freigeben',
    body: (
      <>
        <p>Mit <strong>Als Entwurf</strong> im Planer speicherst du eine Order-Gruppe, ohne dass etwas an Kraken geht.</p>
        <p>Unter <strong>Entwürfe</strong> stehen sie nach <strong>Szenario</strong> sortiert, zum Beispiel „Crash“ oder „Bullrun“. Erst mit <strong>Freigeben</strong> werden die Orders echt angelegt. Die App zeigt dir vorher, ob die Stufen zum aktuellen Kurs noch passen.</p>
      </>
    ),
  },
  {
    page: 'orders', target: 'plans', title: '6. Pläne verfolgen',
    body: (
      <>
        <p>Unter <strong>Offene Orders</strong> stehen deine Pläne: wie viele Stufen offen und wie viele schon ausgeführt sind.</p>
        <p><strong>Gewinnstaffel</strong> plant nach einem Kauf passende Verkäufe über deinem Durchschnittspreis. <strong>Rest senden</strong> schickt die zurückgehaltenen Stufen, <strong>Stornieren</strong> löscht alle offenen Orders des Plans.</p>
        <p>Wird eine Order ausgeführt, meldet sich der Mac mit einer Mitteilung.</p>
      </>
    ),
  },
  {
    page: 'key', target: 'key', title: '7. Mit Kraken verbinden',
    body: (
      <>
        <p>Für echte Orders brauchst du einen <strong>API-Schlüssel</strong> von Kraken. Er erlaubt der App, in deinem Namen Orders anzulegen.</p>
        <p>Im Reiter <strong>Schlüssel</strong> zeigt dir eine Anleitung, welche Häkchen du bei Kraken setzt. Erlaube nur Abfragen und Orders, <strong>niemals Auszahlungen</strong>. Die App prüft das beim Speichern. Der Schlüssel bleibt verschlüsselt im Schlüsselbund dieses Macs und wird nirgendwo anders hin geschickt.</p>
      </>
    ),
  },
  {
    title: 'Jetzt ausprobieren',
    body: (
      <>
        <p>Im <strong>Demo-Modus</strong> spielst du alles mit Beispielkursen und erfundenem Guthaben durch. Es geht nichts an Kraken, du brauchst keinen Schlüssel.</p>
        <p>Die Einführung findest du jederzeit wieder unten links unter <strong>Einführung</strong>.</p>
      </>
    ),
  },
]

export default function Guide({ step, onStep, onClose, onPage, demo, onStartDemo }: {
  step: number
  onStep: (n: number) => void
  onClose: () => void
  onPage: (p: GuidePage) => void
  demo: boolean
  onStartDemo: () => void
}): JSX.Element {
  const s = GUIDE_STEPS[step]
  const last = step === GUIDE_STEPS.length - 1

  // Seite wechseln und den Bereich hervorheben, sobald er gerendert ist
  useEffect(() => {
    if (s.page) onPage(s.page)
    if (!s.target) return
    let el: HTMLElement | null = null
    const t = setTimeout(() => {
      el = document.querySelector<HTMLElement>(`[data-guide="${s.target}"]`)
      el?.classList.add('guide-target')
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 250)
    return () => { clearTimeout(t); el?.classList.remove('guide-target') }
  }, [step])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && !last) onStep(step + 1)
      if (e.key === 'ArrowLeft' && step > 0) onStep(step - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [step])

  return (
    <div role="dialog" aria-label="Einführung" className="card fixed bottom-5 right-5 z-40 w-[24rem] max-w-[calc(100vw-2.5rem)] p-5 shadow-xl">
      <div className="mb-3 flex items-center gap-2">
        <GraduationCap size={18} className="text-accent-fg" />
        <span className="eyebrow flex-1">Einführung · {step + 1} von {GUIDE_STEPS.length}</span>
        <button type="button" className="btn-mini" onClick={onClose} aria-label="Einführung schließen" title="Schließen (Esc)"><X size={16} /></button>
      </div>
      <h2 className="mb-2 text-base font-semibold text-ink">{s.title}</h2>
      <div className="space-y-2 text-sm text-ink-muted [&_strong]:text-ink">{s.body}</div>
      <div className="mt-4 flex items-center gap-1" aria-hidden>
        {GUIDE_STEPS.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-accent-500' : 'bg-track'}`} />)}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {step > 0 && <button type="button" className="btn btn-ghost" onClick={() => onStep(step - 1)}><ArrowLeft size={16} /> Zurück</button>}
        <span className="flex-1" />
        {last ? (
          <>
            {!demo && <button type="button" className="btn btn-primary" onClick={onStartDemo}><PlayCircle size={16} /> Demo starten</button>}
            <button type="button" className={`btn ${demo ? 'btn-primary' : 'btn-secondary'}`} onClick={onClose}>Fertig</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => onStep(step + 1)}>{step === 0 ? 'Los geht’s' : 'Weiter'} <ArrowRight size={16} /></button>
        )}
      </div>
    </div>
  )
}
