import { api } from '../api'
import { useEffect, useState } from 'react'
import { DatabaseBackup, Download, Upload } from 'lucide-react'
import type { BackupSummary } from '@shared/backup'
import SectionCard from '../components/ui/SectionCard'
import Modal from '../components/ui/Modal'
import { NumberField } from './PlannerPage'
import { dateLocale } from '../format'
import { exName } from '@shared/exchanges'

export default function SettingsPage({ hasKey, onOpenKey }: { hasKey: boolean; onOpenKey: () => void }): JSX.Element {
  const [maxPlan, setMaxPlan] = useState(500)
  const [savedMax, setSavedMax] = useState(false)
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [restore, setRestore] = useState<BackupSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const date = (iso: string) => (iso ? new Date(iso).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : 'unbekannt')

  async function doExport() {
    setBackupMsg(null)
    try {
      const r = await api().backupExport()
      if (r) setBackupMsg({ ok: true, text: `Gesichert: ${r.plans} Pläne, ${r.drafts} Entwürfe, ${r.templates} Vorlagen. Datei: ${r.path}` })
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
      setBackupMsg({ ok: true, text: `Sicherung eingespielt. Dein vorheriger Stand liegt zur Sicherheit hier: ${safety}` })
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
          <h1 className="page-title">Einstellungen</h1>
        </div>
      </header>
      <div className="space-y-4">
        <SectionCard title={`${exName()}-API-Schlüssel`}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p className="flex-1 text-ink-muted">{hasKey ? 'Ein Schlüssel ist hinterlegt.' : 'Noch kein Schlüssel hinterlegt.'} Anlegen, prüfen und löschen geht im Reiter „Schlüssel“.</p>
            <button type="button" className="btn btn-secondary" onClick={onOpenKey}>Zum Reiter Schlüssel</button>
          </div>
        </SectionCard>

        <SectionCard title="Sicherheit">
          <div className="space-y-3 text-sm">
            <div className="max-w-xs">
              <NumberField label="Obergrenze pro Plan (EUR)" value={maxPlan} onChange={(v) => { setMaxPlan(v); setSavedMax(false) }}
                hint="Ein Plan mit höherem Gegenwert wird nicht gesendet. Schützt vor Tippfehlern." />
            </div>
            <button type="button" className="btn btn-secondary" disabled={!(maxPlan >= 1)} onClick={() => api().saveSettings({ maxPlanEur: maxPlan }).then(() => setSavedMax(true))}>{savedMax ? 'Gespeichert' : 'Speichern'}</button>
          </div>
        </SectionCard>

        <SectionCard title="Datensicherung">
          <div className="space-y-3 text-sm">
            <p className="text-ink-muted">Pläne, Entwürfe, Vorlagen, Einstellungen und Protokoll liegen nur auf diesem Mac. Sichere sie ab und zu in eine Datei, zum Beispiel in iCloud Drive. Der API-Schlüssel kommt bewusst <strong className="text-ink">nicht</strong> mit hinein. Auf einem neuen Mac legst du ihn im Reiter „Schlüssel“ neu an.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={doExport}><Download size={16} /> Sichern</button>
              <button type="button" className="btn btn-outline" onClick={pick}><Upload size={16} /> Wiederherstellen …</button>
            </div>
            {backupMsg && <p className={`notice break-all ${backupMsg.ok ? 'notice-success' : 'notice-danger'}`}>{backupMsg.text}</p>}
          </div>
        </SectionCard>
      </div>

      {restore && (
        <Modal title="Sicherung wiederherstellen?" size="sm" onClose={() => !busy && setRestore(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRestore(null)}>Abbrechen</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={doRestore}><DatabaseBackup size={16} /> {busy ? 'Spiele ein …' : 'Wiederherstellen'}</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p>Sicherung vom <strong>{date(restore.createdAt)}</strong> mit {restore.plans} Plänen, {restore.drafts} Entwürfen, {restore.templates} Vorlagen und {restore.log} Protokoll-Einträgen.</p>
            <p className="text-ink-muted">Sie ersetzt den aktuellen Stand in der App. Der jetzige Stand wird vorher automatisch im App-Ordner gesichert. Bei der Börse ändert sich nichts, deine Schlüssel bleiben wie sie sind.</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
