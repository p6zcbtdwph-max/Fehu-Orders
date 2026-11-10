import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import SectionCard from '../components/ui/SectionCard'

export default function SettingsPage({ hasKey, onKeyChanged }: { hasKey: boolean; onKeyChanged: () => void }): JSX.Element {
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [maxPlan, setMaxPlan] = useState(500)
  const [savedMax, setSavedMax] = useState(false)

  useEffect(() => {
    window.api.settings().then((s) => setMaxPlan(s.maxPlanEur))
  }, [])

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      await window.api.saveKey(key, secret)
      setKey('')
      setSecret('')
      setMsg({ ok: true, text: 'Schlüssel geprüft und verschlüsselt gespeichert.' })
      onKeyChanged()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(false)
  }

  async function clear() {
    await window.api.clearKey()
    setMsg({ ok: true, text: 'Schlüssel gelöscht.' })
    onKeyChanged()
  }

  return (
    <div className="page page-narrow">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">Einstellungen</h1>
        </div>
      </header>
      <div className="space-y-4">
        <SectionCard title="Kraken-API-Schlüssel">
          <div className="space-y-3 text-sm">
            <p className="text-ink-muted">
              Lege den Schlüssel bei Kraken unter Einstellungen › API an. Nötig sind nur <strong>Guthaben abfragen</strong>, <strong>Offene Orders abfragen</strong>,{' '}
              <strong>Orders erstellen und ändern</strong> und <strong>Orders stornieren</strong>. <strong>Niemals Auszahlungen erlauben.</strong>
            </p>
            <p className="flex items-center gap-2 text-ink-muted"><ShieldCheck size={16} className="text-success-fg" /> Der Schlüssel bleibt auf diesem Mac, verschlüsselt über den macOS-Schlüsselbund.</p>
            {hasKey && <p className="notice notice-success">Ein Schlüssel ist hinterlegt. Ein neuer ersetzt ihn.</p>}
            <label className="block"><span className="label">API-Schlüssel</span><input className="input w-full font-mono" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} /></label>
            <label className="block"><span className="label">Privater Schlüssel (Secret)</span><input className="input w-full font-mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} /></label>
            {msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary" disabled={busy || !key || !secret} onClick={save}>{busy ? 'Prüfe …' : 'Prüfen und speichern'}</button>
              {hasKey && <button type="button" className="btn btn-outline" onClick={clear}>Schlüssel löschen</button>}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Sicherheit">
          <div className="space-y-3 text-sm">
            <label className="block max-w-xs">
              <span className="label">Obergrenze pro Plan (EUR)</span>
              <input className="input w-full tabular-nums" inputMode="decimal" value={maxPlan} onChange={(e) => { setMaxPlan(Number(e.target.value.replace(',', '.')) || 0); setSavedMax(false) }} />
              <span className="mt-1 block text-xs text-ink-muted">Ein Plan mit höherem Gegenwert wird nicht gesendet. Schützt vor Tippfehlern.</span>
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => window.api.saveSettings({ maxPlanEur: maxPlan }).then(() => setSavedMax(true))}>{savedMax ? 'Gespeichert' : 'Speichern'}</button>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
