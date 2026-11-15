import { api } from '../api'
import { useEffect, useState } from 'react'
import { DatabaseBackup, Download, Upload } from 'lucide-react'
import type { BackupSummary } from '@shared/backup'
import SectionCard from '../components/ui/SectionCard'
import Modal from '../components/ui/Modal'
import { NumberField } from './PlannerPage'
import RiskNotice from '../components/RiskNotice'
import { dateLocale } from '../format'
import { tr } from '@shared/i18n'
import { exName, FIRST_TEST_MAX_EUR } from '@shared/exchanges'
import { DEFAULT_MIN_ORDER_EUR, effectiveMinCost, MAX_MIN_ORDER_EUR } from '@shared/ladder'
import type { PairDto } from '@shared/ipc'
import { useMoney } from '../money'

/** Mindestwerte der aktiven Börse für die Paare auf der Watchlist (beim aktuellen Kurs) */
function ExchangeMinimums({ userMin }: { userMin: number }) {
  const { eur } = useMoney()
  const [rows, setRows] = useState<{ pair: PairDto; price: number }[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let off = false
    Promise.all([api().pairs(), api().settings()]).then(async ([ps, s]) => {
      const names = s.watchlist.length ? s.watchlist : ['BTC/EUR', 'ETH/EUR']
      const list = ps.filter((p) => names.includes(p.name)).slice(0, 12)
      const prices = list.length ? await api().prices(list.map((p) => p.id)) : {}
      if (!off) setRows(list.filter((p) => prices[p.id] > 0).map((p) => ({ pair: p, price: prices[p.id] })))
    }).catch(() => !off && setError(true))
    return () => { off = true }
  }, [])
  if (error) return <p className="text-xs text-ink-muted">{tr(`Die Mindestwerte von ${exName()} konnten gerade nicht geladen werden. Im Planer siehst du sie trotzdem beim gewählten Paar.`, `${exName()}’s minimums could not be loaded right now. You still see them in the planner for the selected pair.`)}</p>
  if (!rows) return <p className="text-xs text-ink-muted">{tr(`Lade die Mindestwerte von ${exName()} …`, `Loading ${exName()}’s minimums …`)}</p>
  if (!rows.length) return null
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead><tr><th>{tr('Paar', 'Pair')}</th><th className="num">{tr(`${exName()} verlangt`, `${exName()} requires`)}</th><th className="num">{tr('Es gilt', 'Applies')}</th></tr></thead>
        <tbody>
          {rows.map(({ pair, price }) => {
            const m = effectiveMinCost(userMin, price, pair)
            return (
              <tr key={pair.id}>
                <td>{pair.name}</td>
                <td className="num">{eur(m.exchange)}</td>
                <td className={`num ${m.exchangeHigher ? 'font-medium text-warning-fg' : ''}`}>{eur(m.effective)}{m.exchangeHigher && <span className="block text-xs font-normal">{tr(`Mindestwert von ${exName()}`, `${exName()}’s minimum`)}</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-ink-muted">{tr(`Paare von deiner Watchlist. Manche Börsen geben eine Mindestmenge vor (z. B. 0.00005 BTC), dann hängt der Euro-Wert vom Kurs ab.`, `Pairs from your watchlist. Some exchanges set a minimum volume (e.g. 0.00005 BTC), so the euro value depends on the price.`)}</p>
    </div>
  )
}

export default function SettingsPage({ hasKey, onOpenKey }: { hasKey: boolean; onOpenKey: () => void }): JSX.Element {
  const [maxPlan, setMaxPlan] = useState(500)
  const [savedMax, setSavedMax] = useState(false)
  const [minOrder, setMinOrder] = useState(DEFAULT_MIN_ORDER_EUR)
  /** Gespeicherter Wert, nach ihm richten sich Tabelle und Hinweise */
  const [savedMinOrder, setSavedMinOrder] = useState(DEFAULT_MIN_ORDER_EUR)
  const [minMsg, setMinMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [restore, setRestore] = useState<BackupSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const date = (iso: string) => (iso ? new Date(iso).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : tr('unbekannt', 'unknown'))

  async function doExport() {
    setBackupMsg(null)
    try {
      const r = await api().backupExport()
      if (r) setBackupMsg({ ok: true, text: tr(`Gesichert: ${r.plans} Pläne, ${r.drafts} Entwürfe, ${r.templates} Vorlagen. Datei: ${r.path}`, `Backed up: ${r.plans} plans, ${r.drafts} drafts, ${r.templates} templates. File: ${r.path}`) })
    } catch (e) {
      setBackupMsg({ ok: false, text: (e as Error).message })
    }
  }

  async function pick() {
    setBackupMsg(null)
    try {
      const s = await api().backupPick()
      if (s) setRestore(s)
    } catch (e) {
      setBackupMsg({ ok: false, text: (e as Error).message })
    }
  }

  async function doRestore() {
    setBusy(true)
    try {
      const safety = await api().backupRestore()
      setBackupMsg({ ok: true, text: tr(`Sicherung eingespielt. Dein vorheriger Stand liegt zur Sicherheit hier: ${safety}`, `Backup restored. Your previous state was saved here, just in case: ${safety}`) })
      api().settings().then((s) => setMaxPlan(s.maxPlanEur))
    } catch (e) {
      setBackupMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(false)
    setRestore(null)
  }

  useEffect(() => {
    api().settings().then((s) => {
      setMaxPlan(s.maxPlanEur)
      setMinOrder(s.minOrderEur ?? DEFAULT_MIN_ORDER_EUR)
      setSavedMinOrder(s.minOrderEur ?? DEFAULT_MIN_ORDER_EUR)
    })
  }, [])

  const minValid = minOrder >= 1 && minOrder <= MAX_MIN_ORDER_EUR
  async function saveMin() {
    setMinMsg(null)
    try {
      const s = await api().saveSettings({ minOrderEur: minOrder })
      setSavedMinOrder(s.minOrderEur)
      setMinMsg({ ok: true, text: tr('Gespeichert. Der Planer rechnet ab jetzt mit diesem Wert.', 'Saved. The planner uses this value from now on.') })
    } catch (e) {
      setMinMsg({ ok: false, text: (e as Error).message })
    }
  }

  return (
    <div className="page page-narrow">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{tr('Einstellungen', 'Settings')}</h1>
        </div>
      </header>
      <div className="space-y-4">
        <SectionCard title={tr(`${exName()}-API-Schlüssel`, `${exName()} API key`)}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p className="flex-1 text-ink-muted">{hasKey ? tr('Ein Schlüssel ist hinterlegt.', 'A key is saved.') : tr('Noch kein Schlüssel hinterlegt.', 'No key saved yet.')} {tr('Anlegen, prüfen und löschen geht im Reiter „Schlüssel“.', 'Create, check and delete it in the “API key” tab.')}</p>
            <button type="button" className="btn btn-secondary" onClick={onOpenKey}>{tr('Zum Reiter Schlüssel', 'Open API key tab')}</button>
          </div>
        </SectionCard>

        <div data-guide="limit"><SectionCard title={tr('Sicherheit', 'Safety')}>
          <div className="space-y-3 text-sm">
            <p className="text-ink-muted">{tr(
              <>Zur Sicherheit steht die Obergrenze am Anfang auf <strong className="text-ink">50 €</strong>. Dein erster echter Test bleibt so klein, auch wenn du dich vertippst. Klappt alles, kannst du sie hier anheben.</>,
              <>For safety, the limit starts at <strong className="text-ink">50 €</strong>. That keeps your first real test small, even if you make a typo. Once everything works, you can raise it here.</>,
            )}</p>
            <div className="max-w-xs">
              <NumberField label={tr('Obergrenze pro Plan (EUR)', 'Limit per plan (EUR)')} value={maxPlan} onChange={(v) => { setMaxPlan(v); setSavedMax(false) }}
                hint={tr('Ein Plan mit höherem Gegenwert wird nicht gesendet. Schützt vor Tippfehlern.', 'A plan worth more than this is not sent. Protects against typos.')} />
            </div>
            <button type="button" className="btn btn-secondary" disabled={!(maxPlan >= 1)} onClick={() => api().saveSettings({ maxPlanEur: maxPlan }).then(() => setSavedMax(true))}>{savedMax ? tr('Gespeichert', 'Saved') : tr('Speichern', 'Save')}</button>
          </div>
        </SectionCard></div>

        <SectionCard title={tr('Mindest-Orderwert', 'Minimum order value')}>
          <div className="space-y-3 text-sm">
            <p className="text-ink-muted">{tr(
              <>Keine einzelne Order fällt unter diesen Wert, egal wie du den Plan einstellst. Ergibt eine Stufe weniger, hebt der Planer sie auf den Mindestwert an und zeigt dir, um wie viel der Plan dadurch größer wird. Verlangt die Börse selbst mehr (zum Beispiel 25 €), gilt automatisch ihr Wert, damit die Order nicht abgelehnt wird.</>,
              <>No single order falls below this value, however you set up the plan. If a level comes out smaller, the planner raises it to the minimum and shows you how much bigger the plan gets. If the exchange itself requires more (for example 25 €), its value applies automatically so the order is not rejected.</>,
            )}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-48">
                <NumberField label={tr('Mindest-Orderwert (EUR)', 'Minimum order value (EUR)')} value={minOrder} onChange={(v) => { setMinOrder(v); setMinMsg(null) }}
                  hint={tr(`Standard ${DEFAULT_MIN_ORDER_EUR} €, erlaubt 1 bis ${MAX_MIN_ORDER_EUR.toLocaleString('de-DE')} €`, `Default ${DEFAULT_MIN_ORDER_EUR} €, allowed 1 to ${MAX_MIN_ORDER_EUR.toLocaleString('en-US')} €`)} />
              </div>
              <button type="button" className="btn btn-secondary mb-5" disabled={!minValid || minOrder === savedMinOrder} onClick={saveMin}>{tr('Speichern', 'Save')}</button>
            </div>
            {minValid && minOrder > maxPlan && <p className="notice notice-warning">{tr(`Der Mindest-Orderwert ist höher als deine Obergrenze pro Plan (${maxPlan} €). Dann passt keine einzige Order in einen Plan.`, `The minimum order value is higher than your limit per plan (${maxPlan} €). Then not a single order fits into a plan.`)}</p>}
            {minValid && minOrder <= maxPlan && minOrder * 1.02 > FIRST_TEST_MAX_EUR && <p className="notice notice-warning">{tr(`Beim ersten echten Test auf einer Börse gilt höchstens ${FIRST_TEST_MAX_EUR} € pro Plan. Mit diesem Mindest-Orderwert passt dort keine Order hinein.`, `The first real test on an exchange is capped at ${FIRST_TEST_MAX_EUR} € per plan. With this minimum order value no order fits.`)}</p>}
            {minMsg && <p className={`notice ${minMsg.ok ? 'notice-success' : 'notice-danger'}`}>{minMsg.text}</p>}
            <ExchangeMinimums userMin={savedMinOrder} />
          </div>
        </SectionCard>

        <SectionCard title={tr('Datensicherung', 'Backup')}>
          <div className="space-y-3 text-sm">
            <p className="text-ink-muted">{tr(
              <>Pläne, Entwürfe, Vorlagen, Einstellungen und Protokoll liegen nur auf diesem Mac. Sichere sie ab und zu in eine Datei, zum Beispiel in iCloud Drive. Der API-Schlüssel kommt bewusst <strong className="text-ink">nicht</strong> mit hinein. Auf einem neuen Mac legst du ihn im Reiter „Schlüssel“ neu an.</>,
              <>Plans, drafts, templates, settings and log are stored only on this Mac. Back them up to a file now and then, for example to iCloud Drive. The API key is deliberately <strong className="text-ink">not</strong> included. On a new Mac you add it again in the “API key” tab.</>,
            )}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={doExport}><Download size={16} /> {tr('Sichern', 'Back up')}</button>
              <button type="button" className="btn btn-outline" onClick={pick}><Upload size={16} /> {tr('Wiederherstellen …', 'Restore …')}</button>
            </div>
            {backupMsg && <p className={`notice break-all ${backupMsg.ok ? 'notice-success' : 'notice-danger'}`}>{backupMsg.text}</p>}
          </div>
        </SectionCard>

        <SectionCard title={tr('Risiko-Hinweis', 'Risk notice')}>
          <RiskNotice />
        </SectionCard>
      </div>

      {restore && (
        <Modal title={tr('Sicherung wiederherstellen?', 'Restore backup?')} size="sm" onClose={() => !busy && setRestore(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRestore(null)}>{tr('Abbrechen', 'Cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={doRestore}><DatabaseBackup size={16} /> {busy ? tr('Spiele ein …', 'Restoring …') : tr('Wiederherstellen', 'Restore')}</button>
          </>}>
          <div className="space-y-2 text-sm">
            {tr(
              <><p>Sicherung vom <strong>{date(restore.createdAt)}</strong> mit {restore.plans} Plänen, {restore.drafts} Entwürfen, {restore.templates} Vorlagen und {restore.log} Protokoll-Einträgen.</p>
              <p className="text-ink-muted">Sie ersetzt den aktuellen Stand in der App. Der jetzige Stand wird vorher automatisch im App-Ordner gesichert. Bei {exName()} ändert sich nichts, dein Schlüssel bleibt wie er ist.</p></>,
              <><p>Backup from <strong>{date(restore.createdAt)}</strong> with {restore.plans} plans, {restore.drafts} drafts, {restore.templates} templates and {restore.log} log entries.</p>
              <p className="text-ink-muted">It replaces the current state in the app. The current state is backed up automatically in the app folder first. Nothing changes at {exName()}, your key stays as it is.</p></>,
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
