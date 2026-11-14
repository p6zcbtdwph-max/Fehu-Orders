// Rückmeldung nach dem echten Senden: Ist alles angelegt? Steht es wirklich bei der Börse?
// Damit man nicht erst unter „Offene Orders“ nachsehen muss.
import { AlertTriangle, CheckCircle2, ListChecks } from 'lucide-react'
import type { SendResult } from '@shared/ipc'
import { exName } from '@shared/exchanges'
import { tr } from '@shared/i18n'
import { useMoney } from '../money'
import Modal from './ui/Modal'

interface Props {
  result: SendResult
  pairName: string
  side: 'buy' | 'sell'
  priceDecimals: number
}

/** Zahlen für die Rückmeldung, rein, damit sie testbar sind */
export function sendSummary(result: SendResult) {
  const placed = result.orders.filter((o) => o.txid)
  const uncertain = result.orders.filter((o) => o.uncertain)
  const failed = result.orders.filter((o) => o.error && !o.uncertain)
  const prices = placed.map((o) => o.price)
  const allOk = placed.length === result.orders.length && result.orders.length > 0
  const checkOk = !!result.check && result.check.found === result.check.placed
  return {
    placed: placed.length,
    total: result.orders.length,
    uncertain: uncertain.length,
    failed,
    cost: placed.reduce((a, o) => a + o.price * o.volume, 0),
    volume: placed.reduce((a, o) => a + o.volume, 0),
    from: prices.length ? prices[0] : 0,
    to: prices.length ? prices[prices.length - 1] : 0,
    /** alles angelegt und (falls nachgeprüft) auch alles in den offenen Orders gefunden */
    allOk,
    checkOk,
    state: (allOk ? 'ok' : placed.length + uncertain.length > 0 ? 'partial' : 'none') as 'ok' | 'partial' | 'none',
  }
}

export function SendSummary({ result, pairName, side, priceDecimals }: Props): JSX.Element {
  const { eur, fmtPrice, sym } = useMoney()
  const s = sendSummary(result)
  const ex = exName()
  const Icon = s.state === 'ok' ? CheckCircle2 : AlertTriangle
  const tone = s.state === 'ok' ? 'text-success-fg' : s.state === 'partial' ? 'text-warning-fg' : 'text-danger-fg'
  const title = s.state === 'ok'
    ? tr('Alles angelegt', 'All placed')
    : s.state === 'partial' ? tr('Nur teilweise angelegt', 'Only partly placed') : tr('Nichts angelegt', 'Nothing placed')
  return (
    <div className="space-y-3 text-sm" data-testid="send-summary">
      <div className="flex items-start gap-3">
        <Icon size={36} className={`shrink-0 ${tone}`} aria-hidden />
        <div className="min-w-0">
          <p className={`text-base font-semibold ${tone}`}>{title}</p>
          <p>{tr(
            <><strong>{s.placed} von {s.total}</strong> Orders liegen jetzt bei {ex}.</>,
            <><strong>{s.placed} of {s.total}</strong> orders are now at {ex}.</>,
          )}</p>
        </div>
      </div>

      {s.placed > 0 && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 rounded-lg border border-line bg-sunken px-3 py-2">
          <dt className="text-ink-muted">{tr('Auftrag', 'Order')}</dt>
          <dd>{side === 'buy' ? tr('Kaufen', 'Buy') : tr('Verkaufen', 'Sell')} {pairName}</dd>
          <dt className="text-ink-muted">{tr('Preise', 'Prices')}</dt>
          <dd>{s.placed === 1 ? `${fmtPrice(s.from, priceDecimals)} ${sym}` : `${fmtPrice(s.from, priceDecimals)} ${tr('bis', 'to')} ${fmtPrice(s.to, priceDecimals)} ${sym}`}</dd>
          <dt className="text-ink-muted">{tr('Gegenwert', 'Value')}</dt>
          <dd>{eur(s.cost)}</dd>
          <dt className="text-ink-muted">{tr('Plan-Nummer', 'Plan number')}</dt>
          <dd>{result.userref}</dd>
        </dl>
      )}

      {s.placed > 0 && (result.check
        ? s.checkOk
          ? <p className="notice notice-success flex items-center gap-2"><ListChecks size={16} aria-hidden className="shrink-0" />{tr(`Gerade nachgeprüft: Alle ${s.placed} Orders stehen bei ${ex} in den offenen Orders.`, `Just checked: all ${s.placed} orders are listed as open orders at ${ex}.`)}</p>
          : <p className="notice notice-warning">{tr(
            `Nachgeprüft: ${result.check.found} von ${result.check.placed} Orders stehen in den offenen Orders. Die übrigen wurden vielleicht schon ausgeführt (Kurs war schon da). Schau zur Sicherheit unter „Offene Orders“ nach.`,
            `Checked: ${result.check.found} of ${result.check.placed} orders are listed as open. The others may already have been filled (the price was already there). To be safe, look under “Open orders”.`,
          )}</p>
        : <p className="text-ink-muted">{tr(`${ex} hat jede dieser Orders mit einer eigenen Order-Nummer bestätigt. Die Nachkontrolle der offenen Orders klappte gerade nicht, das ändert daran nichts.`, `${ex} confirmed each of these orders with its own order number. Checking the open orders did not work just now, which does not change that.`)}</p>
      )}

      {s.uncertain > 0 && <p className="notice notice-warning">{tr(
        `Bei ${s.uncertain} Orders brach die Verbindung ab. Ob sie angelegt wurden, ist unklar. Schau unter „Offene Orders“ nach, bevor du noch einmal sendest.`,
        `The connection dropped for ${s.uncertain} orders. It is unclear whether they were placed. Check under “Open orders” before you send again.`,
      )}</p>}
      {s.failed.length > 0 && <p className="notice notice-danger">{tr(
        `${s.failed.length} Orders wurden nicht angelegt. Grund: ${s.failed[0].error}`,
        `${s.failed.length} orders were not placed. Reason: ${s.failed[0].error}`,
      )}</p>}
    </div>
  )
}

/** Eigenes Fenster mit der Rückmeldung, z. B. nach „An Kraken senden“ im Planer */
export function SendSuccessModal({ onClose, onOpenOrders, ...props }: Props & { onClose: () => void; onOpenOrders?: () => void }): JSX.Element {
  return (
    <Modal title={tr('Gesendet', 'Sent')} size="sm" onClose={onClose}
      footer={<>
        {onOpenOrders && <button type="button" className="btn btn-secondary" onClick={() => { onClose(); onOpenOrders() }}>{tr('Offene Orders ansehen', 'View open orders')}</button>}
        <button type="button" className="btn btn-primary" onClick={onClose}>{tr('Fertig', 'Done')}</button>
      </>}>
      <SendSummary {...props} />
    </Modal>
  )
}
