import { api } from '../api'
import { useEffect, useState } from 'react'
import SectionCard from '../components/ui/SectionCard'

export default function SettingsPage({ hasKey, onOpenKey }: { hasKey: boolean; onOpenKey: () => void }): JSX.Element {
  const [maxPlan, setMaxPlan] = useState(500)
  const [savedMax, setSavedMax] = useState(false)

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
        <SectionCard title="Kraken-API-Schlüssel">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p className="flex-1 text-ink-muted">{hasKey ? 'Ein Schlüssel ist hinterlegt.' : 'Noch kein Schlüssel hinterlegt.'} Anlegen, prüfen und löschen geht im Reiter „Schlüssel“.</p>
            <button type="button" className="btn btn-secondary" onClick={onOpenKey}>Zum Reiter Schlüssel</button>
          </div>
        </SectionCard>

        <SectionCard title="Sicherheit">
          <div className="space-y-3 text-sm">
            <label className="block max-w-xs">
              <span className="label">Obergrenze pro Plan (EUR)</span>
              <input className="input w-full tabular-nums" inputMode="decimal" value={maxPlan} onChange={(e) => { setMaxPlan(Number(e.target.value.replace(',', '.')) || 0); setSavedMax(false) }} />
              <span className="mt-1 block text-xs text-ink-muted">Ein Plan mit höherem Gegenwert wird nicht gesendet. Schützt vor Tippfehlern.</span>
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => api().saveSettings({ maxPlanEur: maxPlan }).then(() => setSavedMax(true))}>{savedMax ? 'Gespeichert' : 'Speichern'}</button>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
