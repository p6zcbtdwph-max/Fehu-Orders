import { useState } from 'react'
import { ExternalLink, ShieldOff, Trash2 } from 'lucide-react'
import { api } from '../api'
import Modal from './ui/Modal'
import SectionCard from './ui/SectionCard'
import { tr } from '@shared/i18n'
import { exchangeMeta, exchangeName, type ExchangeId } from '@shared/exchanges'
import { roleName } from '@shared/key-roles'
import type { ClearAllResult } from '@shared/ipc'

/**
 * Notfall-Knopf: alle Schlüssel sofort aus der App löschen. Ehrlich erklärt: Das löscht nur auf diesem Mac.
 * Bei der Börse bleibt ein Schlüssel gültig, bis man ihn dort widerruft. Deshalb zeigt das Ergebnis
 * direkt die Links zu den Schlüssel-Seiten der Börsen.
 */
export default function KillSwitch({ onDone }: { onDone?: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [cancelOrders, setCancelOrders] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ClearAllResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      setResult(await api().clearAllKeys({ cancelOrders }))
      onDone?.()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  const close = () => { if (!busy) { setOpen(false); setResult(null); setError(null); setCancelOrders(false) } }

  return (
    <SectionCard title={tr('Notfall: alle Schlüssel löschen', 'Emergency: delete all keys')}>
      <div className="space-y-3 text-sm">
        <p>{tr(
          'Für den Fall, dass dein Mac gestohlen wird, du ihn reparieren lässt oder dir etwas komisch vorkommt: Ein Klick löscht alle Schlüssel aller Börsen aus der App, Nur-Lese- und Handels-Schlüssel.',
          'In case your Mac is stolen, goes in for repair or something seems off: one click deletes all keys of all exchanges from the app, read-only and trading keys.',
        )}</p>
        <p className="notice notice-warning">{tr(
          <>Wichtig: Das löscht die Schlüssel <strong>nur auf diesem Mac</strong>. Bei der Börse sind sie danach noch gültig. Wirklich unbrauchbar wird ein Schlüssel erst, wenn du ihn bei der Börse löschst (widerrufst). Die Links dazu bekommst du direkt danach.</>,
          <>Important: this deletes the keys <strong>on this Mac only</strong>. At the exchange they are still valid. A key only becomes useless once you delete (revoke) it at the exchange. You get the links for that right afterwards.</>,
        )}</p>
        <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}><ShieldOff size={16} /> {tr('Alle Schlüssel sofort löschen', 'Delete all keys now')}</button>
      </div>
      {open && (
        <Modal size="md" onClose={close} icon={<ShieldOff size={18} className="text-danger-fg" />}
          title={result ? tr('Schlüssel aus der App gelöscht', 'Keys deleted from the app') : tr('Alle Schlüssel aus der App löschen?', 'Delete all keys from the app?')}
          footer={result ? (
            <button type="button" className="btn btn-primary" onClick={close}>{tr('Fertig', 'Done')}</button>
          ) : <>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>{tr('Abbrechen', 'Cancel')}</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={run}><Trash2 size={14} /> {busy ? tr('Lösche …', 'Deleting …') : tr('Ja, alle löschen', 'Yes, delete all')}</button>
          </>}>
          {result ? <Done result={result} /> : (
            <div className="space-y-3 text-sm">
              <p>{tr('Alle Schlüssel aller Börsen verschwinden aus der App, auch ein Handels-Schlüssel, der nur im Arbeitsspeicher liegt. Pläne, Entwürfe, Protokoll und Einstellungen bleiben.', 'All keys of all exchanges disappear from the app, including a trading key that is only kept in memory. Plans, drafts, log and settings stay.')}</p>
              <p className="text-ink-muted">{tr('Deine offenen Orders bei den Börsen bleiben bestehen und können weiter ausgeführt werden. Die App sieht sie nur nicht mehr, bis du wieder einen Schlüssel einfügst.', 'Your open orders at the exchanges stay and can still be filled. The app just cannot see them until you paste a key again.')}</p>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3">
                <input type="checkbox" className="mt-0.5" checked={cancelOrders} onChange={(e) => setCancelOrders(e.target.checked)} />
                <span>
                  <strong>{tr('Vorher alle offenen Orders stornieren (Notbremse)', 'Cancel all open orders first (emergency stop)')}</strong>
                  <span className="block text-xs text-ink-muted">{tr('Nur nötig, wenn du auch die laufenden Orders sofort stoppen willst. Danach geht das nicht mehr aus der App, weil die Schlüssel weg sind.', 'Only needed if you also want to stop running orders right away. Afterwards the app cannot do that any more, because the keys are gone.')}</span>
                </span>
              </label>
              {error && <p className="notice notice-danger">{error}</p>}
            </div>
          )}
        </Modal>
      )}
    </SectionCard>
  )
}

function Done({ result }: { result: ClearAllResult }) {
  const exs: ExchangeId[] = result.deleted.map((d) => d.exchange)
  return (
    <div className="space-y-3 text-sm">
      {result.deleted.length ? (
        <ul className="space-y-1">
          {result.deleted.map((d) => <li key={d.exchange}><strong>{exchangeName(d.exchange)}:</strong> {d.roles.map(roleName).join(', ')} {tr('gelöscht', 'deleted')}</li>)}
        </ul>
      ) : <p>{tr('Es waren keine Schlüssel in der App gespeichert.', 'There were no keys saved in the app.')}</p>}
      {result.cancelled !== undefined && <p className="notice notice-success">{tr(`Notbremse: ${result.cancelled} ${result.cancelled === 1 ? 'Order' : 'Orders'} storniert.`, `Emergency stop: ${result.cancelled} ${result.cancelled === 1 ? 'order' : 'orders'} cancelled.`)}</p>}
      {result.cancelError && <p className="notice notice-danger">{result.cancelError}</p>}
      {exs.length > 0 && <>
        <p className="notice notice-warning"><strong>{tr('Jetzt noch bei der Börse widerrufen.', 'Now revoke them at the exchange too.')}</strong> {tr('Erst dann ist ein gestohlener Schlüssel wirklich wertlos. Melde dich an, öffne die API-Seite und lösche dort die Schlüssel mit dem Namen Fehu Orders.', 'Only then is a stolen key truly worthless. Log in, open the API page and delete the keys named Fehu Orders there.')}</p>
        <div className="flex flex-wrap gap-2">
          {exs.map((ex) => (
            <a key={ex} className="btn btn-secondary btn-sm" href={exchangeMeta(ex).apiUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {tr(`${exchangeName(ex)}: Schlüssel widerrufen`, `${exchangeName(ex)}: revoke keys`)}</a>
          ))}
        </div>
      </>}
    </div>
  )
}
