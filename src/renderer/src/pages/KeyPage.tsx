import { api } from '../api'
import { useEffect, useState } from 'react'
import { Check, ExternalLink, Fingerprint, Globe, KeyRound, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import type { KeyCheck } from '@shared/ipc'
import { checkKeyFormat, normalizeCoinbase } from '@shared/safety'
import { activeExchange, exchangeMeta } from '@shared/exchanges'
import { tr } from '@shared/i18n'
import SectionCard from '../components/ui/SectionCard'

function CheckList({ checks, exchange }: { checks: KeyCheck[]; exchange: string }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-2">
          {c.ok ? <Check size={16} className="mt-0.5 flex-shrink-0 text-success-fg" /> : <X size={16} className="mt-0.5 flex-shrink-0 text-danger-fg" />}
          <span>
            <strong>{c.label}</strong> <span className="text-ink-muted">({c.exchangeLabel})</span>
            {!c.ok && c.id !== 'withdraw' && <span className="block text-xs text-danger-fg">{tr(`Fehlt. Setze bei ${exchange} das Häkchen „${c.exchangeLabel}“.`, `Missing. Tick “${c.exchangeLabel}” at ${exchange}.`)}</span>}
            {c.detail && <span className={`block text-xs ${c.ok ? 'text-warning-fg' : 'text-danger-fg'}`}>{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function KeyPage({ hasKey, onKeyChanged }: { hasKey: boolean; onKeyChanged: () => void }): JSX.Element {
  const ex = exchangeMeta(activeExchange())
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [noWithdraw, setNoWithdraw] = useState(false)
  const [busy, setBusy] = useState<'save' | 'verify' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [checks, setChecks] = useState<KeyCheck[] | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  /** Wo die Meldung steht: beim Status (erneut prüfen) oder beim Formular (speichern) */
  const [source, setSource] = useState<'status' | 'form'>('form')
  const formatIssues = checkKeyFormat(key, secret, ex.id)
  // Coinbase: Wer die heruntergeladene Datei einfügt, muss das Namensfeld nicht extra füllen
  const filled = ex.id === 'coinbase' ? normalizeCoinbase(key, secret) : { key: key.trim(), secret: secret.trim() }
  const [touchId, setTouchId] = useState<boolean | null>(null)
  useEffect(() => {
    api().keyStatus().then((s) => setTouchId(s.touchId)).catch(() => setTouchId(null))
  }, [])
  /** Bei Börsen, die das Auszahlungsrecht nicht verraten, bestätigt der Nutzer selbst */
  const needsConfirm = !ex.withdrawAutoCheck

  async function save() {
    setBusy('save')
    setSource('form')
    setMsg(null)
    setChecks(null)
    try {
      const r = await api().saveKey(key, secret, { noWithdrawConfirmed: needsConfirm ? noWithdraw : undefined })
      setChecks(r.checks)
      if (r.saved) {
        setKey('')
        setSecret('')
        setNoWithdraw(false)
        setMsg({ ok: true, text: tr('Alle Rechte stimmen. Der Schlüssel ist verschlüsselt gespeichert.', 'All permissions are correct. The key is stored encrypted.') })
        onKeyChanged()
      } else {
        setMsg({ ok: false, text: tr(`Nicht gespeichert. Korrigiere bei ${ex.name} die rot markierten Rechte (Schlüssel bearbeiten) und klicke dann noch einmal auf „Prüfen und speichern“.`, `Not saved. Fix the permissions marked in red at ${ex.name} (edit the key) and click “Check and save” again.`) })
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
      setMsg(c.every((x) => x.ok) ? { ok: true, text: tr('Alle Rechte stimmen.', 'All permissions are correct.') } : { ok: false, text: tr('Bei den Rechten stimmt etwas nicht, siehe unten.', 'Something is wrong with the permissions, see below.') })
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
    setMsg({ ok: true, text: tr(`Schlüssel aus der App gelöscht. Lösche ihn am besten auch bei ${ex.name}, wenn du ihn nicht mehr brauchst.`, `Key deleted from the app. Best also delete it at ${ex.name} if you no longer need it.`) })
    onKeyChanged()
  }

  return (
    <div className="page page-narrow">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{tr('Schlüssel', 'API key')} · {ex.name}</h1>
          <p className="page-subtitle">{tr(`${ex.name}-API-Schlüssel Schritt für Schritt anlegen und sicher hinterlegen. Die Börse wechselst du links unten.`, `Create a ${ex.name} API key step by step and store it safely. Switch the exchange at the bottom left.`)}</p>
        </div>
      </header>

      <div className="space-y-4">
        <SectionCard title={tr('Status', 'Status')}>
          <div className="space-y-3 text-sm">
            {hasKey ? (
              <p className="notice notice-success flex items-center gap-2"><ShieldCheck size={16} /> {tr(`Ein ${ex.name}-Schlüssel ist hinterlegt. Ein neuer ersetzt ihn.`, `A ${ex.name} key is saved. A new one replaces it.`)}</p>
            ) : (
              <p className="notice notice-info flex items-center gap-2"><KeyRound size={16} /> {tr(`Noch kein ${ex.name}-Schlüssel hinterlegt. Folge den Schritten unten.`, `No ${ex.name} key saved yet. Follow the steps below.`)}</p>
            )}
            <p className="text-ink-muted">{ex.name}: {ex.origin}.</p>
            <p className="flex items-center gap-2 text-ink-muted"><ShieldCheck size={16} className="text-success-fg" /> {tr('Der Schlüssel bleibt auf diesem Mac, verschlüsselt über den macOS-Schlüsselbund. Jede Börse hat ihren eigenen Schlüssel.', 'The key stays on this Mac, encrypted via the macOS keychain. Each exchange has its own key.')}</p>
            {touchId === true && <p className="flex items-center gap-2 text-ink-muted"><Fingerprint size={16} className="text-success-fg" /> {tr('Touch ID ist aktiv: Vor jedem echten Senden fragt der Mac nach deinem Finger. Der Probelauf geht ohne.', 'Touch ID is on: before every real send the Mac asks for your finger. The test run works without it.')}</p>}
            {touchId === false && <p className="flex items-start gap-2 text-ink-muted"><Fingerprint size={16} className="mt-0.5 flex-shrink-0 text-warning-fg" /> <span>{tr('Dieser Mac hat kein Touch ID oder es ist kein Finger eingerichtet. Vor dem Senden fragt die App dann nur mit dem Bestätigungsfenster. Einrichten kannst du Touch ID in den Systemeinstellungen unter „Touch ID & Passwort“.', 'This Mac has no Touch ID or no finger is set up. The app then only asks with the confirmation window before sending. You can set up Touch ID in System Settings under “Touch ID & Password”.')}</span></p>}
            {hasKey && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={verify}>{busy === 'verify' ? tr('Prüfe …', 'Checking …') : tr('Rechte erneut prüfen', 'Check permissions again')}</button>
                {confirmClear ? (
                  <>
                    <button type="button" className="btn btn-danger" onClick={clear}>{tr('Ja, löschen', 'Yes, delete')}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(false)}>{tr('Abbrechen', 'Cancel')}</button>
                  </>
                ) : <button type="button" className="btn btn-outline" onClick={() => setConfirmClear(true)}>{tr('Schlüssel löschen', 'Delete key')}</button>}
              </div>
            )}
            {source === 'status' && msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
            {source === 'status' && checks && <CheckList checks={checks} exchange={ex.name} />}
          </div>
        </SectionCard>

        <SectionCard title={tr(`So legst du den Schlüssel bei ${ex.name} an`, `How to create the key at ${ex.name}`)}>
          <ol className="space-y-4 text-sm [&>li]:flex [&>li]:gap-3">
            {ex.steps.map((st, i) => (
              <li key={st.title}>
                <span className="step-num">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <p><strong>{st.title}.</strong> {st.text}</p>
                  {i === 0 && <a className="btn btn-secondary btn-sm" href={ex.apiUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {tr(`${ex.name}-API-Seite öffnen`, `Open ${ex.name} API page`)}</a>}
                  {i === ex.permissionsStep && (
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead><tr><th>{tr(`Bei ${ex.name} (Englisch)`, `At ${ex.name}`)}</th><th>{tr('Bedeutung', 'Meaning')}</th><th>{tr('Häkchen', 'Tick')}</th><th>{tr('Wofür', 'What for')}</th></tr></thead>
                        <tbody>
                          {ex.permissions.map((p) => (
                            <tr key={p.exchange}>
                              <td className="whitespace-nowrap font-medium">{p.exchange}</td>
                              <td className="text-ink-muted">{p.de}</td>
                              <td>{p.on ? <span className="inline-flex items-center gap-1 text-success-fg"><Check size={14} /> {tr('an', 'on')}</span> : <span className={`inline-flex items-center gap-1 ${p.danger ? 'font-semibold text-danger-fg' : 'text-ink-muted'}`}><X size={14} /> {tr('aus', 'off')}</span>}</td>
                              <td className={`text-xs ${p.danger ? 'font-medium text-danger-fg' : 'text-ink-muted'}`}>{p.why}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>

        <div data-guide="key"><SectionCard title={tr('Schlüssel einfügen', 'Paste key')}>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="label">{ex.keyLabel}</span>
              <input className="input w-full font-mono" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder={ex.keyPlaceholder} />
            </label>
            <label className="block">
              <span className="label">{ex.secretLabel}</span>
              {ex.secretMultiline
                // Ein PEM-Block ist mehrzeilig. Das Feld ist absichtlich klein und unscharf dargestellt, damit niemand mitliest.
                ? <textarea className="input h-24 w-full font-mono text-xs [-webkit-text-security:disc]" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder={ex.secretPlaceholder} />
                : <input className="input w-full font-mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder={ex.secretPlaceholder} />}
            </label>
            {needsConfirm && (
              <label className="notice notice-warning flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={noWithdraw} onChange={(e) => setNoWithdraw(e.target.checked)} />
                <span>{tr(`Ich habe bei ${ex.name} geprüft: Das Recht „${ex.withdrawLabel}“ (Auszahlen) ist bei diesem Schlüssel aus. ${ex.name} lässt das nicht automatisch prüfen, deshalb ist diese Bestätigung Pflicht.`, `I checked at ${ex.name}: the “${ex.withdrawLabel}” permission is off for this key. ${ex.name} does not let apps check this, so this confirmation is required.`)}</span>
              </label>
            )}
            {formatIssues.length > 0 && <div className="notice notice-warning space-y-1">{formatIssues.map((t) => <p key={t}>{t}</p>)}</div>}
            {source === 'form' && msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
            {source === 'form' && checks && <CheckList checks={checks} exchange={ex.name} />}
            <button type="button" className="btn btn-primary" disabled={!!busy || !filled.key || !filled.secret || formatIssues.length > 0 || (needsConfirm && !noWithdraw)} onClick={save}>
              {busy === 'save' ? tr('Prüfe alle Rechte …', 'Checking all permissions …') : tr('Prüfen und speichern', 'Check and save')}
            </button>
          </div>
        </SectionCard></div>

        <SectionCard title={tr('Profi-Tipp: IP-Beschränkung', 'Pro tip: IP restriction')}>
          <div className="space-y-2 text-sm">
            <p className="flex items-start gap-2"><Globe size={16} className="mt-0.5 flex-shrink-0 text-ink-muted" /><span>{tr(`Bei ${ex.name} kannst du einen Schlüssel auf deine IP-Adresse beschränken. Das ist die Adresse, unter der dein Internetanschluss im Netz auftritt. Dann funktioniert der Schlüssel nur noch von deinem Anschluss aus. Selbst wenn ihn jemand stiehlt, kann er damit woanders nichts anfangen.`, `At ${ex.name} you can restrict a key to your IP address, the address your internet connection uses. The key then only works from your connection. Even if someone steals it, it is useless elsewhere.`)}</span></p>
            <p className="text-ink-muted">{tr('Das ist der stärkste Schutz für den Fall, dass der Schlüssel in falsche Hände gerät. Touch ID und die Obergrenze in der App helfen dann nicht mehr, weil ein Dieb die App gar nicht braucht.', 'This is the strongest protection if the key falls into the wrong hands. Touch ID and the limit in the app no longer help then, because a thief does not need the app.')}</p>
            <ol className="list-decimal space-y-1 pl-5 text-ink-muted">
              <li>{tr('Deine aktuelle IP-Adresse findest du in deinem Router, bei einer FRITZ!Box unter Internet › Online-Monitor („IPv4-Adresse“).', 'You find your current IP address in your router, on a FRITZ!Box under Internet › Online Monitor (“IPv4 address”).')}</li>
              <li>{tr(`Bei ${ex.name} den Schlüssel bearbeiten und bei der IP-Liste (IP whitelist / allowlist) genau diese Adresse eintragen.`, `Edit the key at ${ex.name} and enter exactly this address in the IP whitelist / allowlist.`)}</li>
              <li>{tr('Hier „Rechte erneut prüfen“. Alles grün heißt: es klappt.', 'Click “Check permissions again” here. All green means it works.')}</li>
            </ol>
            <p className="notice notice-warning">{tr(`Achtung: Bei den meisten privaten Anschlüssen in Deutschland ändert sich die IP-Adresse ab und zu, zum Beispiel nach einem Router-Neustart. Dann meldet die App „fehlende Berechtigung“, bis du die neue Adresse bei ${ex.name} einträgst. Unterwegs (anderes WLAN, Handy-Hotspot) geht der Schlüssel ebenfalls nicht.`, `Note: on most home connections the IP address changes now and then, for example after a router restart. The app then reports a missing permission until you enter the new address at ${ex.name}. On the go (other Wi-Fi, phone hotspot) the key will not work either.`)}</p>
          </div>
        </SectionCard>

        <SectionCard title={tr('Häufige Fehler', 'Common mistakes')}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            <li><strong className="text-ink">{tr('Felder vertauscht:', 'Fields swapped:')}</strong> {tr('Die App warnt dich, wenn es so aussieht.', 'The app warns you if it looks like that.')}</li>
            <li><strong className="text-ink">{tr('Nicht vollständig kopiert:', 'Not copied completely:')}</strong> {tr(`Am besten über den Kopieren-Knopf bei ${ex.name}, nicht mit der Maus markieren.`, `Best use the copy button at ${ex.name} instead of selecting with the mouse.`)}</li>
            <li><strong className="text-ink">{tr('Häkchen vergessen:', 'Forgot a box:')}</strong> {tr(`Du kannst die Rechte bei ${ex.name} meist nachträglich ändern und hier „Rechte erneut prüfen“.`, `You can usually change the permissions at ${ex.name} later and click “Check permissions again” here.`)}</li>
            {ex.id === 'coinbase' && <li><strong className="text-ink">{tr('Ed25519 statt ECDSA:', 'Ed25519 instead of ECDSA:')}</strong> {tr('Dann lehnt Coinbase jede Anfrage ab. Lege einen neuen Schlüssel an und wähle ECDSA.', 'Coinbase then rejects every request. Create a new key and choose ECDSA.')}</li>}
            {ex.id === 'bitvavo' && <li><strong className="text-ink">{tr('E-Mail nicht bestätigt:', 'E-mail not confirmed:')}</strong> {tr('Ein neuer Bitvavo-Schlüssel funktioniert erst nach dem Klick auf den Link in der Bestätigungs-Mail.', 'A new Bitvavo key only works after you click the link in the confirmation e-mail.')}</li>}
            <li className="flex items-start gap-1"><ShieldAlert size={14} className="mt-0.5 flex-shrink-0 text-danger-fg" /><span><strong className="text-ink">{tr('Auszahlungen erlaubt:', 'Withdrawals allowed:')}</strong> {tr(`Lösche so einen Schlüssel bei ${ex.name} und lege einen neuen ohne „${ex.withdrawLabel}“ an.`, `Delete such a key at ${ex.name} and create a new one without “${ex.withdrawLabel}”.`)}</span></li>
          </ul>
        </SectionCard>
      </div>
    </div>
  )
}
