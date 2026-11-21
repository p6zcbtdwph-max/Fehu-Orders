import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, KeyRound, OctagonX, PlayCircle } from 'lucide-react'
import { api } from '../api'
import Modal from './ui/Modal'
import { tr } from '@shared/i18n'
import { EXCHANGE_IDS, exchangeName, exName, type ExchangeId } from '@shared/exchanges'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

interface Props {
  exchange: ExchangeId
  /** Welche Börsen einen Schlüssel haben */
  keys: Partial<Record<ExchangeId, boolean>>
  /** Schlüssel der aktiven Börse (null = wird noch geladen) */
  hasKey: boolean | null
  demo: boolean
  onExchange: (ex: ExchangeId) => void
  /** Einstellungen › Börsen und Schlüssel öffnen */
  onManageKeys: () => void
  onEndDemo: () => void
  /** Nach der Notbremse, damit offene Seiten neu laden */
  onEmergencyDone: () => void
}

/**
 * Obere Leiste auf jeder Seite: aktive Börse mit Verbindungsstatus, Demo-Hinweis und Notbremse.
 * Das sind die Dinge, die man immer im Blick haben sollte. Alles, was man nur einmal einstellt,
 * liegt in den Einstellungen.
 */
export default function TopBar({ exchange, keys, hasKey, demo, onExchange, onManageKeys, onEndDemo, onEmergencyDone }: Props): JSX.Element {
  return (
    <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-canvas/90 px-6 backdrop-blur" style={drag}>
      <ExchangeMenu exchange={exchange} keys={keys} hasKey={hasKey} demo={demo} onExchange={onExchange} onManageKeys={onManageKeys} />
      {demo && (
        <span className="flex items-center gap-2 rounded-full bg-warning-soft px-3 py-1 text-xs font-medium text-warning-fg" style={noDrag}
          title={tr(`Beispielkurse und erfundenes Guthaben. Es wird nichts an ${exName()} gesendet, probier ruhig alles aus.`, `Sample prices and made-up balances. Nothing is sent to ${exName()}, so feel free to try everything.`)}>
          <PlayCircle size={14} /> {tr(`Demo: nichts geht an ${exName()}`, `Demo: nothing goes to ${exName()}`)}
          <button type="button" className="btn-link text-xs" onClick={onEndDemo}>{tr('Beenden', 'End')}</button>
        </span>
      )}
      <div className="ml-auto" style={noDrag}>
        {(hasKey || demo) && <EmergencyStop onDone={onEmergencyDone} />}
      </div>
    </div>
  )
}

function ExchangeMenu({ exchange, keys, hasKey, demo, onExchange, onManageKeys }: Pick<Props, 'exchange' | 'keys' | 'hasKey' | 'demo' | 'onExchange' | 'onManageKeys'>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Klick daneben oder Esc schließt die Auswahl
  useEffect(() => {
    if (!open) return
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', click)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key) }
  }, [open])

  const status = demo ? tr('Demo', 'Demo') : hasKey === null ? '…' : hasKey ? tr('verbunden', 'connected') : tr('kein Schlüssel', 'no key')
  const dot = demo ? 'bg-warning-500' : hasKey ? 'bg-success-500' : 'bg-ink-faint'

  return (
    <div ref={ref} className="relative" style={noDrag}>
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        title={tr('Mit welcher Börse die App gerade arbeitet. Pläne, Entwürfe und Orders gelten je Börse.', 'Which exchange the app is working with. Plans, drafts and orders belong to one exchange each.')}
        className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium text-ink transition-colors hover:border-accent-400">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        {exchangeName(exchange)}
        <span className="font-normal text-ink-muted">· {status}</span>
        <ChevronDown size={14} className="text-ink-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-40 mt-1 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <p className="px-2.5 pb-1 pt-1.5 text-xs text-ink-muted">{tr('Mit dieser Börse arbeiten', 'Work with this exchange')}</p>
          {EXCHANGE_IDS.map((id) => {
            const on = id === exchange
            return (
              <button key={id} type="button" role="menuitemradio" aria-checked={on} onClick={() => { setOpen(false); onExchange(id) }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${on ? 'bg-accent-soft font-medium' : 'hover:bg-sunken-soft'}`}>
                <span className="w-4">{on && <Check size={14} className="text-accent-fg" />}</span>
                <span className="flex-1">{exchangeName(id)}</span>
                <span className={`text-xs ${keys[id] ? 'text-success-fg' : 'text-ink-muted'}`}>{keys[id] ? tr('Schlüssel da', 'key saved') : tr('kein Schlüssel', 'no key')}</span>
              </button>
            )
          })}
          <div className="my-1 border-t border-line" />
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onManageKeys() }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-sunken-soft hover:text-ink">
            <KeyRound size={14} /> {tr('Schlüssel anlegen und verwalten', 'Add and manage keys')}
          </button>
        </div>
      )}
    </div>
  )
}

/** Notbremse: storniert alle offenen Orders auf allen Börsen mit Schlüssel. Auf jeder Seite erreichbar. */
function EmergencyStop({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function run() {
    setBusy(true)
    try {
      const n = await api().cancelAll()
      setMsg({ ok: true, text: tr(`Notbremse ausgeführt: ${n} ${n === 1 ? 'Order' : 'Orders'} storniert.`, `Emergency stop done: ${n} ${n === 1 ? 'order' : 'orders'} cancelled.`) })
      onDone()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(false)
  }

  const close = () => { if (!busy) { setOpen(false); setMsg(null) } }

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm text-danger-fg" onClick={() => { setMsg(null); setOpen(true) }}
        title={tr('Alle offenen Orders auf allen verbundenen Börsen auf einmal stornieren', 'Cancel all open orders on all connected exchanges at once')}>
        <OctagonX size={14} /> {tr('Notbremse', 'Emergency stop')}
      </button>
      {open && (
        <Modal title={tr('Notbremse: alle Orders stornieren?', 'Emergency stop: cancel all orders?')} size="sm" onClose={close}
          footer={msg?.ok ? (
            <button type="button" className="btn btn-primary" onClick={close}>{tr('Fertig', 'Done')}</button>
          ) : <>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>{tr('Abbrechen', 'Cancel')}</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={run}>{busy ? tr('Storniere …', 'Cancelling …') : tr('Alle stornieren', 'Cancel all')}</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p>{tr(
              <>Storniert <strong>alle offenen Orders</strong> auf <strong>allen Börsen</strong>, für die ein Schlüssel hinterlegt ist, auf einmal, auch solche, die du nicht mit dieser App angelegt hast.</>,
              <>Cancels <strong>all open orders</strong> on <strong>all exchanges</strong> with a saved key at once, including ones you did not place with this app.</>,
            )}</p>
            <p className="text-ink-muted">{tr('Bereits ausgeführte Käufe und Verkäufe bleiben bestehen. Noch nicht gesendete Stufen deiner Pläne bleiben in der App und gehen nicht raus.', 'Buys and sells already filled stay as they are. Levels of your plans that were not sent yet stay in the app and do not go out.')}</p>
            {msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
          </div>
        </Modal>
      )}
    </>
  )
}
