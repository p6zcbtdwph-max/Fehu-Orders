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
import { exName } from '@shared/exchanges'

export default function SettingsPage({ hasKey, onOpenKey }: { hasKey: boolean; onOpenKey: () => void }): JSX.Element {
  const [maxPlan, setMaxPlan] = useState(500)
  const [savedMax, setSavedMax] = useState(false)
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
    api().settings().then((s) => setMaxPlan(s.maxPlanEur))
  }, [])

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
