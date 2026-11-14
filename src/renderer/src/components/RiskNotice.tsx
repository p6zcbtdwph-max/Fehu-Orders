import { ShieldAlert } from 'lucide-react'
import { tr } from '@shared/i18n'

/**
 * Risiko-Hinweis (Haftungsausschluss). Steht in der Einführung und dauerhaft in den Einstellungen.
 * compact: ohne Rahmen, für die Einführung.
 */
export default function RiskNotice({ compact = false }: { compact?: boolean }): JSX.Element {
  const points = tr(
    [
      <><strong>Krypto ist hochriskant.</strong> Kurse können in Stunden stark fallen. Du kannst dein eingesetztes Geld teilweise oder ganz verlieren.</>,
      <><strong>Echte Orders, echtes Geld.</strong> Was du an Kraken sendest, wird wirklich ausgeführt, sobald der Kurs deine Stufe erreicht. Ausgeführte Orders lassen sich nicht rückgängig machen.</>,
      <><strong>Keine Anlageberatung.</strong> Fehu Orders ist nur ein Werkzeug. Die App gibt keine Empfehlungen, was oder wann du kaufen oder verkaufen sollst. Jede Entscheidung triffst du selbst.</>,
      <><strong>Beta-Version ohne Gewähr.</strong> Die App kann Fehler haben. Kraken kann ausfallen oder Orders ablehnen. Prüfe deine Orders immer auch direkt bei Kraken.</>,
      <><strong>Du trägst die Verantwortung,</strong> auch für deinen API-Schlüssel und für Steuern auf deine Gewinne. Setze nur Geld ein, dessen Verlust du verkraften kannst.</>,
    ],
    [
      <><strong>Crypto is high risk.</strong> Prices can drop sharply within hours. You can lose some or all of the money you put in.</>,
      <><strong>Real orders, real money.</strong> What you send to Kraken is really executed as soon as the price reaches your level. Filled orders cannot be undone.</>,
      <><strong>No investment advice.</strong> Fehu Orders is only a tool. The app gives no recommendations on what or when to buy or sell. Every decision is yours.</>,
      <><strong>Beta version without warranty.</strong> The app may contain bugs. Kraken may go down or reject orders. Always also check your orders directly at Kraken.</>,
      <><strong>You are responsible,</strong> including for your API key and for taxes on your gains. Only use money you can afford to lose.</>,
    ],
  )
  return (
    <div className={compact ? 'space-y-2' : 'notice notice-danger space-y-2'} role="note" aria-label={tr('Risiko-Hinweis', 'Risk notice')}>
      <p className="flex items-center gap-2 font-semibold text-danger-fg"><ShieldAlert size={18} className="flex-shrink-0" /> {tr('Wichtiger Risiko-Hinweis', 'Important risk notice')}</p>
      <ul className="list-disc space-y-1.5 pl-5 text-sm">
        {points.map((p, i) => <li key={i}>{p}</li>)}
      </ul>
    </div>
  )
}
