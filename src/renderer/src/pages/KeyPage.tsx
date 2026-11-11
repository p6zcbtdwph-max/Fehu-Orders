import { api } from '../api'
import { useEffect, useState } from 'react'
import { Check, ExternalLink, Fingerprint, Globe, KeyRound, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import type { KeyCheck } from '@shared/ipc'
import { checkKeyFormat } from '@shared/safety'
import SectionCard from '../components/ui/SectionCard'

const KRAKEN_API_URL = 'https://pro.kraken.com/app/settings/api'

/** So sollen die Häkchen bei Kraken gesetzt sein */
const PERMISSIONS: { kraken: string; on: boolean; why: string; danger?: boolean }[] = [
  { kraken: 'Query Funds', on: true, why: 'Guthaben anzeigen und vor dem Senden prüfen' },
  { kraken: 'Deposit Funds', on: false, why: 'Nicht nötig' },
  { kraken: 'Withdraw Funds', on: false, why: 'Niemals! Damit könnte man Geld von deinem Konto abheben.', danger: true },
  { kraken: 'Query Open Orders & Trades', on: true, why: 'Offene Orders anzeigen' },
  { kraken: 'Query Closed Orders & Trades', on: true, why: 'Ausführungen und Durchschnittspreis anzeigen' },
  { kraken: 'Create & Modify Orders', on: true, why: 'Orders anlegen und Probelauf' },
  { kraken: 'Cancel & Close Orders', on: true, why: 'Pläne und Orders stornieren' },
  { kraken: 'Alle übrigen (Ledger, Export, WebSocket, Earn …)', on: false, why: 'Nicht nötig' },
]

function CheckList({ checks }: { checks: KeyCheck[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-2">
          {c.ok ? <Check size={16} className="mt-0.5 flex-shrink-0 text-success-fg" /> : <X size={16} className="mt-0.5 flex-shrink-0 text-danger-fg" />}
          <span>
            <strong>{c.label}</strong> <span className="text-ink-muted">({c.krakenLabel})</span>
            {!c.ok && c.id !== 'withdraw' && <span className="block text-xs text-danger-fg">Fehlt. Setze bei Kraken das Häkchen „{c.krakenLabel}“.</span>}
            {c.detail && <span className={`block text-xs ${c.ok ? 'text-warning-fg' : 'text-danger-fg'}`}>{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function KeyPage({ hasKey, onKeyChanged }: { hasKey: boolean; onKeyChanged: () => void }): JSX.Element {
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState<'save' | 'verify' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [checks, setChecks] = useState<KeyCheck[] | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  /** Wo die Meldung steht: beim Status (erneut prüfen) oder beim Formular (speichern) */
  const [source, setSource] = useState<'status' | 'form'>('form')
  const formatIssues = checkKeyFormat(key, secret)
  const [touchId, setTouchId] = useState<boolean | null>(null)
  useEffect(() => {
    api().keyStatus().then((s) => setTouchId(s.touchId)).catch(() => setTouchId(null))
  }, [])

  async function save() {
    setBusy('save')
    setSource('form')
    setMsg(null)
    setChecks(null)
    try {
      const r = await api().saveKey(key, secret)
      setChecks(r.checks)
      if (r.saved) {
        setKey('')
        setSecret('')
        setMsg({ ok: true, text: 'Alle Rechte stimmen. Der Schlüssel ist verschlüsselt gespeichert.' })
        onKeyChanged()
      } else {
        setMsg({ ok: false, text: 'Nicht gespeichert. Korrigiere bei Kraken die rot markierten Häkchen (Schlüssel bearbeiten) und klicke dann noch einmal auf „Prüfen und speichern“.' })
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(null)
  }

  async function verify() {
    setBusy('verify')
    setSource('status')
    setMsg(null)
    setChecks(null)
    try {
      const c = await api().verifyKey()
      setChecks(c)
      setMsg(c.every((x) => x.ok) ? { ok: true, text: 'Alle Rechte stimmen.' } : { ok: false, text: 'Bei den Rechten stimmt etwas nicht, siehe unten.' })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(null)
  }

  async function clear() {
    await api().clearKey()
    setConfirmClear(false)
    setChecks(null)
    setSource('status')
    setMsg({ ok: true, text: 'Schlüssel aus der App gelöscht. Lösche ihn am besten auch bei Kraken, wenn du ihn nicht mehr brauchst.' })
    onKeyChanged()
  }

  return (
    <div className="page page-narrow">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">Schlüssel</h1>
          <p className="page-subtitle">Kraken-API-Schlüssel Schritt für Schritt anlegen und sicher hinterlegen.</p>
        </div>
      </header>

      <div className="space-y-4">
        <SectionCard title="Status">
          <div className="space-y-3 text-sm">
            {hasKey ? (
              <p className="notice notice-success flex items-center gap-2"><ShieldCheck size={16} /> Ein Schlüssel ist hinterlegt. Ein neuer ersetzt ihn.</p>
            ) : (
              <p className="notice notice-info flex items-center gap-2"><KeyRound size={16} /> Noch kein Schlüssel hinterlegt. Folge den Schritten unten.</p>
            )}
            <p className="flex items-center gap-2 text-ink-muted"><ShieldCheck size={16} className="text-success-fg" /> Der Schlüssel bleibt auf diesem Mac, verschlüsselt über den macOS-Schlüsselbund.</p>
            {touchId === true && <p className="flex items-center gap-2 text-ink-muted"><Fingerprint size={16} className="text-success-fg" /> Touch ID ist aktiv: Vor jedem echten Senden fragt der Mac nach deinem Finger. Der Probelauf geht ohne.</p>}
            {touchId === false && <p className="flex items-start gap-2 text-ink-muted"><Fingerprint size={16} className="mt-0.5 flex-shrink-0 text-warning-fg" /> <span>Dieser Mac hat kein Touch ID oder es ist kein Finger eingerichtet. Vor dem Senden fragt die App dann nur mit dem Bestätigungsfenster. Einrichten kannst du Touch ID in den Systemeinstellungen unter „Touch ID &amp; Passwort“.</span></p>}
            {hasKey && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={verify}>{busy === 'verify' ? 'Prüfe …' : 'Rechte erneut prüfen'}</button>
                {confirmClear ? (
                  <>
                    <button type="button" className="btn btn-danger" onClick={clear}>Ja, löschen</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(false)}>Abbrechen</button>
                  </>
                ) : <button type="button" className="btn btn-outline" onClick={() => setConfirmClear(true)}>Schlüssel löschen</button>}
              </div>
            )}
            {source === 'status' && msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
            {source === 'status' && checks && <CheckList checks={checks} />}
          </div>
        </SectionCard>

        <SectionCard title="So legst du den Schlüssel bei Kraken an">
          <ol className="space-y-4 text-sm [&>li]:flex [&>li]:gap-3">
            <li>
              <span className="step-num">1</span>
              <div className="min-w-0 flex-1 space-y-1">
                <p><strong>Bei Kraken anmelden</strong> und die API-Einstellungen öffnen: <em>Einstellungen › API</em> (oder „Verbindungen &amp; API“).</p>
                <a className="btn btn-secondary btn-sm" href={KRAKEN_API_URL} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Kraken-API-Seite öffnen</a>
              </div>
            </li>
            <li>
              <span className="step-num">2</span>
              <p className="min-w-0 flex-1"><strong>Neuen Schlüssel erstellen</strong> („Create API key“) und als Namen <em>Fehu Orders</em> eintragen. So erkennst du ihn später wieder.</p>
            </li>
            <li>
              <span className="step-num">3</span>
              <div className="min-w-0 flex-1 space-y-2">
                <p><strong>Genau diese Häkchen setzen:</strong></p>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Bei Kraken</th><th>Häkchen</th><th>Wofür</th></tr></thead>
                    <tbody>
                      {PERMISSIONS.map((p) => (
                        <tr key={p.kraken}>
                          <td className="whitespace-nowrap font-medium">{p.kraken}</td>
                          <td>{p.on ? <span className="inline-flex items-center gap-1 text-success-fg"><Check size={14} /> an</span> : <span className={`inline-flex items-center gap-1 ${p.danger ? 'font-semibold text-danger-fg' : 'text-ink-muted'}`}><X size={14} /> aus</span>}</td>
                          <td className={`text-xs ${p.danger ? 'font-medium text-danger-fg' : 'text-ink-muted'}`}>{p.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </li>
            <li>
              <span className="step-num">4</span>
              <p className="min-w-0 flex-1"><strong>Alles andere so lassen</strong> (Nonce Window, IP-Beschränkung, Ablaufdatum). Das brauchst du für den Anfang nicht. Die IP-Beschränkung kannst du später als Profi-Schutz einrichten, siehe unten.</p>
            </li>
            <li>
              <span className="step-num">5</span>
              <p className="min-w-0 flex-1"><strong>Erstellen und beide Schlüssel kopieren.</strong> Kraken zeigt den privaten Schlüssel nur einmal. Schick ihn niemandem, auch nicht per Chat oder Mail, und speichere ihn nicht in Notizen.</p>
            </li>
            <li>
              <span className="step-num">6</span>
              <p className="min-w-0 flex-1"><strong>Unten einfügen und „Prüfen und speichern“.</strong> Die App prüft jedes Recht einzeln. Ein Schlüssel, der Geld abheben darf, wird nicht gespeichert.</p>
            </li>
          </ol>
        </SectionCard>

        <div data-guide="key"><SectionCard title="Schlüssel einfügen">
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="label">API-Schlüssel (API Key)</span>
              <input className="input w-full font-mono" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="der kürzere der beiden" />
            </label>
            <label className="block">
              <span className="label">Privater Schlüssel (Private Key)</span>
              <input className="input w-full font-mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder="der längere, endet meist auf ==" />
            </label>
            {formatIssues.length > 0 && <div className="notice notice-warning space-y-1">{formatIssues.map((t) => <p key={t}>{t}</p>)}</div>}
            {source === 'form' && msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
            {source === 'form' && checks && <CheckList checks={checks} />}
            <button type="button" className="btn btn-primary" disabled={!!busy || !key.trim() || !secret.trim() || formatIssues.length > 0} onClick={save}>
              {busy === 'save' ? 'Prüfe alle Rechte …' : 'Prüfen und speichern'}
            </button>
          </div>
        </SectionCard></div>

        <SectionCard title="Profi-Tipp: IP-Beschränkung">
          <div className="space-y-2 text-sm">
            <p className="flex items-start gap-2"><Globe size={16} className="mt-0.5 flex-shrink-0 text-ink-muted" /><span>Bei Kraken kannst du einen Schlüssel auf deine <strong>IP-Adresse</strong> beschränken. Das ist die Adresse, unter der dein Internetanschluss im Netz auftritt. Dann funktioniert der Schlüssel nur noch von deinem Anschluss aus. Selbst wenn ihn jemand stiehlt, kann er damit woanders nichts anfangen.</span></p>
            <p className="text-ink-muted">Das ist der stärkste Schutz für den Fall, dass der Schlüssel in falsche Hände gerät. Touch ID und die Obergrenze in der App helfen dann nicht mehr, weil ein Dieb die App gar nicht braucht.</p>
            <p className="font-medium">So geht es:</p>
            <ol className="list-decimal space-y-1 pl-5 text-ink-muted">
              <li>Deine aktuelle IP-Adresse findest du in deinem Router, bei einer FRITZ!Box unter <em>Internet › Online-Monitor</em> („IPv4-Adresse“).</li>
              <li>Bei Kraken den Schlüssel bearbeiten und unter <em>IP Whitelisting</em> genau diese Adresse eintragen.</li>
              <li>Hier „Rechte erneut prüfen“. Alles grün heißt: es klappt.</li>
            </ol>
            <p className="notice notice-warning">Achtung: Bei den meisten privaten Anschlüssen in Deutschland ändert sich die IP-Adresse ab und zu, zum Beispiel nach einem Router-Neustart. Dann meldet die App „fehlende Berechtigung“, bis du die neue Adresse bei Kraken einträgst. Unterwegs (anderes WLAN, Handy-Hotspot) geht der Schlüssel ebenfalls nicht. Lohnt sich vor allem, wenn du eine feste IP-Adresse hast oder größere Beträge verwaltest.</p>
          </div>
        </SectionCard>

        <SectionCard title="Häufige Fehler">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            <li><strong className="text-ink">Felder vertauscht:</strong> Der private Schlüssel ist der längere (88 Zeichen). Die App warnt dich, wenn es so aussieht.</li>
            <li><strong className="text-ink">Nicht vollständig kopiert:</strong> Am besten über den Kopieren-Knopf bei Kraken, nicht mit der Maus markieren.</li>
            <li><strong className="text-ink">Häkchen vergessen:</strong> Du kannst die Rechte bei Kraken nachträglich ändern und hier „Rechte erneut prüfen“.</li>
            <li className="flex items-start gap-1"><ShieldAlert size={14} className="mt-0.5 flex-shrink-0 text-danger-fg" /><span><strong className="text-ink">Auszahlungen erlaubt:</strong> Lösche so einen Schlüssel bei Kraken und lege einen neuen ohne „Withdraw Funds“ an.</span></li>
          </ul>
        </SectionCard>
      </div>
    </div>
  )
}
