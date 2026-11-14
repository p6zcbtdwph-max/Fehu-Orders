import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, GraduationCap, PlayCircle, X } from 'lucide-react'
import { tr } from '@shared/i18n'
import RiskNotice from './RiskNotice'
import { exName } from '@shared/exchanges'

export type GuidePage = 'planner' | 'drafts' | 'orders' | 'key' | 'settings'

interface Step {
  title: string
  body: ReactNode
  /** Seite, die zu diesem Schritt geöffnet wird */
  page?: GuidePage
  /** Bereich mit data-guide="…", der hervorgehoben wird */
  target?: string
  /** Risiko-Hinweis: weiter erst nach dem Häkchen „verstanden“ */
  risk?: boolean
}

/** Die Schritte als Funktion, damit sie in der gerade gewählten Sprache erscheinen */
export const guideSteps = (): Step[] => [
  {
    title: tr('Willkommen bei Fehu Orders', 'Welcome to Fehu Orders'),
    body: tr(
      <>
        <p>Statt einer großen Order legst du hier <strong>viele kleine Limit-Orders</strong> auf einmal an, zum Beispiel alle paar Prozent tiefer ein Stück.</p>
        <p>Eine <strong>Limit-Order</strong> wird nur zu deinem Preis oder besser ausgeführt. Fällt der Kurs, wird Stufe für Stufe gekauft. Steigt er, wird verkauft.</p>
        <p>Zuerst ein wichtiger Hinweis zu den Risiken, danach zeigen wir dir in acht kurzen Schritten, wo was ist.</p>
      </>,
      <>
        <p>Instead of one big order, you place <strong>many small limit orders</strong> at once here, for example a small piece every few percent lower.</p>
        <p>A <strong>limit order</strong> is only filled at your price or better. If the price falls, you buy level by level. If it rises, you sell.</p>
        <p>First an important note on the risks, then eight short steps show you where everything is.</p>
      </>,
    ),
  },
  {
    title: tr('Bitte zuerst lesen: Risiken', 'Please read first: risks'),
    risk: true,
    body: <RiskNotice compact />,
  },
  {
    page: 'planner', target: 'pair', title: tr('1. Coin und Betrag', '1. Coin and amount'),
    body: tr(
      <>
        <p>Tippe bei <strong>Handelspaar</strong> das Symbol ein, zum Beispiel <em>SOL</em>. Mit dem Stern landet ein Paar auf deiner Watchlist und ist mit einem Klick wieder da.</p>
        <p>Wähle <strong>Kaufen</strong> oder <strong>Verkaufen</strong> und rechts den <strong>Betrag</strong>. Er wird auf alle Stufen verteilt.</p>
      </>,
      <>
        <p>Type the symbol into <strong>Trading pair</strong>, for example <em>SOL</em>. The star puts a pair on your watchlist so it is one click away next time.</p>
        <p>Choose <strong>Buy</strong> or <strong>Sell</strong> and the <strong>amount</strong> on the right. It is spread across all levels.</p>
      </>,
    ),
  },
  {
    page: 'planner', target: 'plan', title: tr('2. Die Stufen festlegen', '2. Set the levels'),
    body: tr(
      <>
        <p><strong>Erste und letzte Stufe</strong> sind Anfang und Ende deiner Staffel, beim Kaufen meist knapp unter und deutlich unter dem Kurs. Dazwischen liegen so viele Stufen, wie du bei <strong>Anzahl</strong> einträgst.</p>
        <p><strong>Preisabstände</strong>: gleiche Euro-Abstände oder gleiche Prozent-Abstände zwischen den Stufen.</p>
        <p><strong>Mengenverteilung</strong> bestimmt, wie viel Geld auf jede Stufe kommt. „Gleich“ heißt überall gleich viel, „Linear“ oder „Exponentiell“ heißt: je weiter weg vom Kurs, desto mehr.</p>
        <p>Mit <strong>Davon jetzt senden</strong> schickst du erst die Stufen nah am Kurs. Den Rest kannst du später nachschieben.</p>
      </>,
      <>
        <p><strong>First and last level</strong> are the start and end of your ladder, when buying usually just below and well below the price. In between there are as many levels as you enter under <strong>Count</strong>.</p>
        <p><strong>Price spacing</strong>: equal euro steps or equal percentage steps between the levels.</p>
        <p><strong>Size distribution</strong> decides how much money goes on each level. “Equal” means the same everywhere, “Linear” or “Exponential” means: the further from the price, the more.</p>
        <p>With <strong>Send now</strong> you only send the levels close to the price first. You can add the rest later.</p>
      </>,
    ),
  },
  {
    page: 'planner', target: 'result', title: tr('3. Ergebnis prüfen', '3. Check the result'),
    body: tr(
      <>
        <p>Oben siehst du, was der Plan kostet, die geschätzte <strong>Gebühr</strong> und den <strong>Durchschnittspreis</strong>, falls alle Stufen ausgeführt werden.</p>
        <p>Im Chart zeigen die gestrichelten Linien, wo deine Orders im Kursverlauf liegen. Reicht dein Guthaben nicht, sagt die App es dir, bevor etwas rausgeht.</p>
        <p><strong>Wichtig:</strong> Jede Order muss mit echtem Guthaben hinterlegt sein. {exName()} sperrt den Betrag aller gesendeten Stufen sofort, auch wenn sie erst viel später oder nie ausgeführt werden. Bis zur Ausführung oder Stornierung ist das Geld gebunden. Entwürfe sperren dagegen nichts.</p>
      </>,
      <>
        <p>At the top you see what the plan costs, the estimated <strong>fee</strong> and the <strong>average price</strong> if all levels are filled.</p>
        <p>In the chart, the dashed lines show where your orders sit in the price history. If your balance is not enough, the app tells you before anything goes out.</p>
        <p><strong>Important:</strong> every order must be backed by real funds. {exName()} reserves the amount of all sent levels immediately, even if they are filled much later or never. The money stays locked until the order is filled or cancelled. Drafts, on the other hand, lock nothing.</p>
      </>,
    ),
  },
  {
    page: 'planner', target: 'actions', title: tr('4. Erst prüfen, dann senden', '4. Check first, then send'),
    body: tr(
      <>
        <p><strong>Probelauf</strong>: {exName()} prüft jede Order, legt aber nichts an. Mach das vor jedem echten Plan.</p>
        <p><strong>An {exName()} senden</strong> legt die Orders wirklich an, erst nach einer Bestätigung und, wenn dein Mac es hat, mit Touch ID.</p>
      </>,
      <>
        <p><strong>Test run</strong>: {exName()} checks every order but places nothing. Do this before every real plan.</p>
        <p><strong>Send to {exName()}</strong> really places the orders, only after a confirmation and, if your Mac has it, with Touch ID.</p>
      </>,
    ),
  },
  {
    page: 'settings', target: 'limit', title: tr('5. Dein erster echter Test: höchstens 50 €', '5. Your first real test: at most 50 €'),
    body: tr(
      <>
        <p className="notice notice-warning"><strong>Aus Sicherheitsgründen kannst du am Anfang pro Plan nur bis 50 € senden.</strong> Ein größerer Plan wird nicht abgeschickt, und die App sagt dir, dass die Obergrenze erreicht ist. Das ist kein Fehler, sondern Absicht.</p>
        <p>So bleibt dein erster echter Test klein, falls du dich vertippst oder noch etwas nicht ganz verstanden hast. Im Planer lädt <strong>Erster Test</strong> dafür einen fertigen Mini-Plan.</p>
        <p>Wenn alles geklappt hat, hebst du die Grenze hier unter <strong>Einstellungen › Sicherheit › Obergrenze pro Plan</strong> an, zum Beispiel auf 500 €. Sie gilt für jede einzelne Sendung.</p>
      </>,
      <>
        <p className="notice notice-warning"><strong>For safety reasons you can only send up to 50 € per plan at the start.</strong> A larger plan is not sent, and the app tells you that the limit has been reached. This is not a bug, it is on purpose.</p>
        <p>That keeps your first real test small in case you make a typo or have not fully understood something yet. In the planner, <strong>First test</strong> loads a ready-made mini plan for this.</p>
        <p>Once everything has worked, raise the limit here under <strong>Settings › Safety › Limit per plan</strong>, for example to 500 €. It applies to every single send.</p>
      </>,
    ),
  },
  {
    page: 'drafts', target: 'drafts', title: tr('6. Entwürfe: erst planen, später freigeben', '6. Drafts: plan now, release later'),
    body: tr(
      <>
        <p>Mit <strong>Als Entwurf</strong> im Planer speicherst du eine Order-Gruppe, ohne dass etwas an {exName()} geht.</p>
        <p>Unter <strong>Entwürfe</strong> stehen sie nach <strong>Szenario</strong> sortiert, zum Beispiel „Crash“ oder „Bullrun“. Erst mit <strong>Freigeben</strong> werden die Orders echt angelegt. Mit dem <strong>Kursalarm</strong> meldet sich dein Mac, wenn der Kurs die erste Stufe erreicht. Die App zeigt dir vorher, ob die Stufen zum aktuellen Kurs noch passen.</p>
      </>,
      <>
        <p>With <strong>Save as draft</strong> in the planner you store a group of orders without sending anything to {exName()}.</p>
        <p>Under <strong>Drafts</strong> they are sorted by <strong>scenario</strong>, for example “Crash” or “Bull run”. Only <strong>Release</strong> really places the orders. With a <strong>price alert</strong> your Mac notifies you when the price reaches the first level. Beforehand the app shows you whether the levels still fit the current price.</p>
      </>,
    ),
  },
  {
    page: 'orders', target: 'plans', title: tr('7. Pläne verfolgen', '7. Track your plans'),
    body: tr(
      <>
        <p>Unter <strong>Offene Orders</strong> stehen deine Pläne: wie viele Stufen offen und wie viele schon ausgeführt sind.</p>
        <p><strong>Gewinnstaffel</strong> plant nach einem Kauf passende Verkäufe über deinem Durchschnittspreis. <strong>Rest senden</strong> schickt die zurückgehaltenen Stufen, <strong>Stornieren</strong> löscht alle offenen Orders des Plans.</p>
        <p>Wird eine Order ausgeführt, meldet sich der Mac mit einer Mitteilung. Die <strong>Notbremse</strong> storniert im Notfall alle offenen Orders auf einmal, und unter <strong>Protokoll</strong> steht jeder Schritt mit Uhrzeit.</p>
      </>,
      <>
        <p>Under <strong>Open orders</strong> you see your plans: how many levels are open and how many are already filled.</p>
        <p><strong>Profit ladder</strong> plans matching sells above your average price after a buy. <strong>Send rest</strong> sends the levels you held back, <strong>Cancel</strong> deletes all open orders of the plan.</p>
        <p>When an order is filled, your Mac shows a notification. The <strong>emergency stop</strong> cancels all open orders at once, and the <strong>Log</strong> records every step with its time.</p>
      </>,
    ),
  },
  {
    page: 'key', target: 'key', title: tr(`8. Mit ${exName()} verbinden`, `8. Connect to ${exName()}`),
    body: tr(
      <>
        <p>Für echte Orders brauchst du einen <strong>API-Schlüssel</strong> von {exName()}. Er erlaubt der App, in deinem Namen Orders anzulegen.</p>
        <p>Im Reiter <strong>Schlüssel</strong> zeigt dir eine Anleitung, welche Häkchen du bei {exName()} setzt. {exName()} zeigt die Namen auf Englisch, deshalb steht bei jedem Häkchen der englische Originalname und die deutsche Bedeutung. Erlaube nur Abfragen und Orders, <strong>niemals Auszahlungen</strong> („Withdraw Funds“). Die App prüft das beim Speichern. Der Schlüssel bleibt verschlüsselt im Schlüsselbund dieses Macs und wird nirgendwo anders hin geschickt.</p>
      </>,
      <>
        <p>For real orders you need an <strong>API key</strong> from {exName()}. It allows the app to place orders on your behalf.</p>
        <p>In the <strong>API key</strong> tab a guide shows you which boxes to tick at {exName()}. Only allow queries and orders, <strong>never withdrawals</strong> (“Withdraw Funds”). The app checks this when saving. The key stays encrypted in this Mac’s keychain and is never sent anywhere else.</p>
      </>,
    ),
  },
  {
    title: tr('Jetzt ausprobieren', 'Try it now'),
    body: tr(
      <>
        <p>Im <strong>Demo-Modus</strong> spielst du alles mit Beispielkursen und erfundenem Guthaben durch. Es geht nichts an {exName()}, du brauchst keinen Schlüssel.</p>
        <p>Für den ersten echten Test denk an die <strong>Grenze von 50 € pro Plan</strong>. Die Einführung findest du jederzeit wieder unten links unter <strong>Einführung</strong>, die Sprache stellst du dort unter <strong>Sprache</strong> um.</p>
      </>,
      <>
        <p>In <strong>demo mode</strong> you can try everything with sample prices and made-up balances. Nothing goes to {exName()} and you need no key.</p>
        <p>For your first real test, remember the <strong>limit of 50 € per plan</strong>. You can reopen the introduction at any time bottom left under <strong>Introduction</strong>, and switch the language there under <strong>Language</strong>.</p>
      </>,
    ),
  },
]

const RISK_OK = 'fehu-orders-risk-ok'

export default function Guide({ step, onStep, onClose, onPage, demo, onStartDemo }: {
  step: number
  onStep: (n: number) => void
  onClose: () => void
  onPage: (p: GuidePage) => void
  demo: boolean
  onStartDemo: () => void
}): JSX.Element {
  const steps = guideSteps()
  const s = steps[step]
  const last = step === steps.length - 1
  const [riskOk, setRiskOk] = useState(() => {
    try { return localStorage.getItem(RISK_OK) === '1' } catch { return false }
  })
  const acceptRisk = (on: boolean) => {
    setRiskOk(on)
    try { on ? localStorage.setItem(RISK_OK, '1') : localStorage.removeItem(RISK_OK) } catch { /* egal */ }
  }
  const blocked = !!s.risk && !riskOk

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
      if (e.key === 'ArrowRight' && !last && !blocked) onStep(step + 1)
      if (e.key === 'ArrowLeft' && step > 0) onStep(step - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [step, blocked])

  return (
    <div role="dialog" aria-label={tr('Einführung', 'Introduction')} className={`card fixed bottom-5 right-5 z-40 max-h-[calc(100vh-2.5rem)] overflow-y-auto p-5 shadow-xl ${s.risk ? 'w-[30rem] ring-2 ring-danger-500/50' : 'w-[24rem]'}`} style={{ maxWidth: 'calc(100vw - 2.5rem)' }}>
      <div className="mb-3 flex items-center gap-2">
        <GraduationCap size={18} className="text-accent-fg" />
        <span className="eyebrow flex-1">{tr('Einführung', 'Introduction')} · {tr(`${step + 1} von ${steps.length}`, `${step + 1} of ${steps.length}`)}</span>
        <button type="button" className="btn-mini" onClick={onClose} aria-label={tr('Einführung schließen', 'Close introduction')} title={tr('Schließen (Esc)', 'Close (Esc)')}><X size={16} /></button>
      </div>
      <h2 className="mb-2 text-base font-semibold text-ink">{s.title}</h2>
      <div className="space-y-2 text-sm text-ink-muted [&_strong]:text-ink">{s.body}</div>
      {s.risk && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2.5 text-sm font-medium text-ink">
          <input type="checkbox" className="mt-0.5" checked={riskOk} onChange={(e) => acceptRisk(e.target.checked)} />
          <span>{tr('Ich habe den Risiko-Hinweis gelesen und verstanden.', 'I have read and understood the risk notice.')}</span>
        </label>
      )}
      <div className="mt-4 flex items-center gap-1" aria-hidden>
        {steps.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-accent-500' : 'bg-track'}`} />)}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {step > 0 && <button type="button" className="btn btn-ghost" onClick={() => onStep(step - 1)}><ArrowLeft size={16} /> {tr('Zurück', 'Back')}</button>}
        <span className="flex-1" />
        {last ? (
          <>
            {!demo && <button type="button" className="btn btn-primary" onClick={onStartDemo}><PlayCircle size={16} /> {tr('Demo starten', 'Start demo')}</button>}
            <button type="button" className={`btn ${demo ? 'btn-primary' : 'btn-secondary'}`} onClick={onClose}>{tr('Fertig', 'Done')}</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" disabled={blocked} title={blocked ? tr('Bitte zuerst das Häkchen setzen', 'Please tick the box first') : undefined} onClick={() => onStep(step + 1)}>{step === 0 ? tr('Los geht’s', 'Let’s go') : tr('Weiter', 'Next')} <ArrowRight size={16} /></button>
        )}
      </div>
    </div>
  )
}
