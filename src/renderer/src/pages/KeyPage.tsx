import { api } from '../api'
import { useEffect, useState } from 'react'
import { Check, ExternalLink, Fingerprint, Globe, KeyRound, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import type { KeyCheck } from '@shared/ipc'
import { checkKeyFormat } from '@shared/safety'
import SectionCard from '../components/ui/SectionCard'
import { lang, tr } from '@shared/i18n'

const KRAKEN_API_URL = 'https://pro.kraken.com/app/settings/api'

/**
 * So sollen die Häkchen bei Kraken gesetzt sein. kraken ist der Originalname, wie Kraken ihn auf Englisch zeigt,
 * de die deutsche Bedeutung (Kraken zeigt die Rechte meist auf Englisch, auch wenn die Seite auf Deutsch steht).
 */
const permissions = (): { kraken: string; de: string; on: boolean; why: string; danger?: boolean }[] => [
  { kraken: 'Query Funds', de: 'Guthaben abfragen', on: true, why: tr('Guthaben anzeigen und vor dem Senden prüfen', 'Show balances and check them before sending') },
  { kraken: 'Deposit Funds', de: 'Geld einzahlen', on: false, why: tr('Nicht nötig', 'Not needed') },
  { kraken: 'Withdraw Funds', de: 'Geld abheben / auszahlen', on: false, why: tr('Niemals! Damit könnte man Geld von deinem Konto abheben.', 'Never! It would allow money to be withdrawn from your account.'), danger: true },
  { kraken: 'Query Open Orders & Trades', de: 'Offene Orders und Trades abfragen', on: true, why: tr('Offene Orders anzeigen', 'Show open orders') },
  { kraken: 'Query Closed Orders & Trades', de: 'Geschlossene Orders und Trades abfragen', on: true, why: tr('Ausführungen und Durchschnittspreis anzeigen', 'Show fills and average price') },
  { kraken: 'Create & Modify Orders', de: 'Orders erstellen und ändern', on: true, why: tr('Orders anlegen und Probelauf', 'Place orders and run test runs') },
  { kraken: 'Cancel & Close Orders', de: 'Orders stornieren und schließen', on: true, why: tr('Pläne und Orders stornieren', 'Cancel plans and orders') },
  { kraken: tr('Alle übrigen (Ledger, Export, WebSocket, Earn …)', 'All others (Ledger, Export, WebSocket, Earn …)'), de: tr('Kontobuch, Export, Echtzeit-Schnittstelle, Earn …', ''), on: false, why: tr('Nicht nötig', 'Not needed') },
]

/** Englischer Kraken-Begriff mit deutscher Übersetzung darunter (nur in der deutschen Ansicht) */
function Term({ en, de }: { en: string; de?: string }) {
  return (
    <span className="inline-block align-top">
      <span className="font-medium">{en}</span>
      {lang() === 'de' && de && <span className="block text-xs font-normal text-ink-muted">= {de}</span>}
    </span>
  )
}

function CheckList({ checks }: { checks: KeyCheck[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-2">
          {c.ok ? <Check size={16} className="mt-0.5 flex-shrink-0 text-success-fg" /> : <X size={16} className="mt-0.5 flex-shrink-0 text-danger-fg" />}
          <span>
            <strong>{c.label}</strong> <span className="text-ink-muted">({tr('bei Kraken: ', 'at Kraken: ')}„{c.krakenLabel}“)</span>
            {!c.ok && c.id !== 'withdraw' && <span className="block text-xs text-danger-fg">{tr(`Fehlt. Setze bei Kraken das Häkchen „${c.krakenLabel}“.`, `Missing. Tick “${c.krakenLabel}” at Kraken.`)}</span>}
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
        setMsg({ ok: true, text: tr('Alle Rechte stimmen. Der Schlüssel ist verschlüsselt gespeichert.', 'All permissions are correct. The key is stored encrypted.') })
        onKeyChanged()
      } else {
        setMsg({ ok: false, text: tr('Nicht gespeichert. Korrigiere bei Kraken die rot markierten Häkchen (Schlüssel bearbeiten, englisch „Edit“) und klicke dann noch einmal auf „Prüfen und speichern“.', 'Not saved. Fix the boxes marked in red at Kraken (edit the key) and then click “Check and save” again.') })
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
    setMsg({ ok: true, text: tr('Schlüssel aus der App gelöscht. Lösche ihn am besten auch bei Kraken, wenn du ihn nicht mehr brauchst.', 'Key deleted from the app. Best also delete it at Kraken if you no longer need it.') })
    onKeyChanged()
  }

  return (
    <div className="page page-narrow">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{tr('Schlüssel', 'API key')}</h1>
          <p className="page-subtitle">{tr('Kraken-API-Schlüssel Schritt für Schritt anlegen und sicher hinterlegen.', 'Create a Kraken API key step by step and store it safely.')}</p>
        </div>
      </header>

      <div className="space-y-4">
        <SectionCard title={tr('Status', 'Status')}>
          <div className="space-y-3 text-sm">
            {hasKey ? (
              <p className="notice notice-success flex items-center gap-2"><ShieldCheck size={16} /> {tr('Ein Schlüssel ist hinterlegt. Ein neuer ersetzt ihn.', 'A key is saved. A new one replaces it.')}</p>
            ) : (
              <p className="notice notice-info flex items-center gap-2"><KeyRound size={16} /> {tr('Noch kein Schlüssel hinterlegt. Folge den Schritten unten.', 'No key saved yet. Follow the steps below.')}</p>
            )}
            <p className="flex items-center gap-2 text-ink-muted"><ShieldCheck size={16} className="text-success-fg" /> {tr('Der Schlüssel bleibt auf diesem Mac, verschlüsselt über den macOS-Schlüsselbund.', 'The key stays on this Mac, encrypted via the macOS keychain.')}</p>
            {touchId === true && <p className="flex items-center gap-2 text-ink-muted"><Fingerprint size={16} className="text-success-fg" /> {tr('Touch ID ist aktiv: Vor jedem echten Senden fragt der Mac nach deinem Finger. Der Probelauf geht ohne.', 'Touch ID is on: before every real send your Mac asks for your fingerprint. Test runs work without it.')}</p>}
            {touchId === false && <p className="flex items-start gap-2 text-ink-muted"><Fingerprint size={16} className="mt-0.5 flex-shrink-0 text-warning-fg" /> <span>{tr('Dieser Mac hat kein Touch ID oder es ist kein Finger eingerichtet. Vor dem Senden fragt die App dann nur mit dem Bestätigungsfenster. Einrichten kannst du Touch ID in den Systemeinstellungen unter „Touch ID & Passwort“.', 'This Mac has no Touch ID or no fingerprint is set up. Before sending, the app then only asks with the confirmation window. You can set up Touch ID in System Settings under “Touch ID & Password”.')}</span></p>}
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
            {source === 'status' && checks && <CheckList checks={checks} />}
          </div>
        </SectionCard>

        <SectionCard title={tr('So legst du den Schlüssel bei Kraken an', 'How to create the key at Kraken')}>
          <ol className="space-y-4 text-sm [&>li]:flex [&>li]:gap-3">
            <li>
              <span className="step-num">1</span>
              <div className="min-w-0 flex-1 space-y-1">
                <p>{tr(
                  <><strong>Bei Kraken anmelden</strong> und die API-Einstellungen öffnen: <em>Einstellungen › API</em> (englisch <em>Settings › API</em>, manchmal auch „Verbindungen &amp; API“ / <em>Connections &amp; API</em>).</>,
                  <><strong>Log in to Kraken</strong> and open the API settings: <em>Settings › API</em> (sometimes <em>Connections &amp; API</em>).</>,
                )}</p>
                <a className="btn btn-secondary btn-sm" href={KRAKEN_API_URL} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {tr('Kraken-API-Seite öffnen', 'Open Kraken API page')}</a>
              </div>
            </li>
            <li>
              <span className="step-num">2</span>
              <p className="min-w-0 flex-1">{tr(
                <><strong>Neuen Schlüssel erstellen</strong> (Knopf <em>Create API key</em> = API-Schlüssel erstellen) und bei <em>Key name</em> (Name des Schlüssels) <em>Fehu Orders</em> eintragen. So erkennst du ihn später wieder.</>,
                <><strong>Create a new key</strong> (<em>Create API key</em>) and enter <em>Fehu Orders</em> as <em>Key name</em>. That way you recognise it later.</>,
              )}</p>
            </li>
            <li>
              <span className="step-num">3</span>
              <div className="min-w-0 flex-1 space-y-2">
                <p><strong>{tr('Genau diese Häkchen setzen:', 'Tick exactly these boxes:')}</strong></p>
                {lang() === 'de' && <p className="text-xs text-ink-muted">Kraken zeigt die Rechte auf Englisch. Links steht der Name genau so, wie du ihn bei Kraken siehst, darunter, was er auf Deutsch bedeutet.</p>}
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>{tr('Bei Kraken (englisch) = Deutsch', 'At Kraken')}</th><th>{tr('Häkchen', 'Tick')}</th><th>{tr('Wofür', 'What for')}</th></tr></thead>
                    <tbody>
                      {permissions().map((p) => (
                        <tr key={p.kraken}>
                          <td className="whitespace-nowrap"><Term en={p.kraken} de={p.de} /></td>
                          <td>{p.on ? <span className="inline-flex items-center gap-1 text-success-fg"><Check size={14} /> {tr('an', 'on')}</span> : <span className={`inline-flex items-center gap-1 ${p.danger ? 'font-semibold text-danger-fg' : 'text-ink-muted'}`}><X size={14} /> {tr('aus', 'off')}</span>}</td>
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
              <p className="min-w-0 flex-1">{tr(
                <><strong>Alles andere so lassen:</strong> <em>Nonce Window</em> (Zeitfenster für Anfragen), <em>IP Whitelisting</em> (IP-Beschränkung) und <em>Key Expiration</em> / <em>Expiration date</em> (Ablaufdatum). Das brauchst du für den Anfang nicht. Die IP-Beschränkung kannst du später als Profi-Schutz einrichten, siehe unten.</>,
                <><strong>Leave everything else as it is</strong> (<em>Nonce Window</em>, <em>IP Whitelisting</em>, expiration date). You do not need these to start. You can set up the IP restriction later as extra protection, see below.</>,
              )}</p>
            </li>
            <li>
              <span className="step-num">5</span>
              <p className="min-w-0 flex-1">{tr(
                <><strong>Erstellen</strong> (<em>Generate key</em> = Schlüssel erzeugen) <strong>und beide Schlüssel kopieren:</strong> <em>API Key</em> (öffentlicher Schlüssel) und <em>Private Key</em> (privater Schlüssel). Kraken zeigt den privaten Schlüssel nur einmal. Schick ihn niemandem, auch nicht per Chat oder Mail, und speichere ihn nicht in Notizen.</>,
                <><strong>Generate the key and copy both keys:</strong> <em>API Key</em> and <em>Private Key</em>. Kraken shows the private key only once. Never send it to anyone, not by chat or email either, and do not store it in notes.</>,
              )}</p>
            </li>
            <li>
              <span className="step-num">6</span>
              <p className="min-w-0 flex-1">{tr(
                <><strong>Unten einfügen und „Prüfen und speichern“.</strong> Die App prüft jedes Recht einzeln. Ein Schlüssel, der Geld abheben darf, wird nicht gespeichert.</>,
                <><strong>Paste them below and click “Check and save”.</strong> The app checks every permission one by one. A key that can withdraw money is not saved.</>,
              )}</p>
            </li>
          </ol>
        </SectionCard>

        <div data-guide="key"><SectionCard title={tr('Schlüssel einfügen', 'Paste key')}>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="label">{tr('API-Schlüssel (bei Kraken: API Key)', 'API Key')}</span>
              <input className="input w-full font-mono" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder={tr('der kürzere der beiden', 'the shorter of the two')} />
            </label>
            <label className="block">
              <span className="label">{tr('Privater Schlüssel (bei Kraken: Private Key)', 'Private Key')}</span>
              <input className="input w-full font-mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder={tr('der längere, endet meist auf ==', 'the longer one, usually ends in ==')} />
            </label>
            {formatIssues.length > 0 && <div className="notice notice-warning space-y-1">{formatIssues.map((t) => <p key={t}>{t}</p>)}</div>}
            {source === 'form' && msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
            {source === 'form' && checks && <CheckList checks={checks} />}
            <button type="button" className="btn btn-primary" disabled={!!busy || !key.trim() || !secret.trim() || formatIssues.length > 0} onClick={save}>
              {busy === 'save' ? tr('Prüfe alle Rechte …', 'Checking all permissions …') : tr('Prüfen und speichern', 'Check and save')}
            </button>
          </div>
        </SectionCard></div>

        <SectionCard title={tr('Profi-Tipp: IP-Beschränkung (IP Whitelisting)', 'Pro tip: IP restriction (IP Whitelisting)')}>
          <div className="space-y-2 text-sm">
            <p className="flex items-start gap-2"><Globe size={16} className="mt-0.5 flex-shrink-0 text-ink-muted" /><span>{tr(
              <>Bei Kraken kannst du einen Schlüssel auf deine <strong>IP-Adresse</strong> beschränken. Das ist die Adresse, unter der dein Internetanschluss im Netz auftritt. Dann funktioniert der Schlüssel nur noch von deinem Anschluss aus. Selbst wenn ihn jemand stiehlt, kann er damit woanders nichts anfangen.</>,
              <>At Kraken you can restrict a key to your <strong>IP address</strong>. That is the address your internet connection uses on the net. The key then only works from your connection. Even if someone steals it, it is useless anywhere else.</>,
            )}</span></p>
            <p className="text-ink-muted">{tr('Das ist der stärkste Schutz für den Fall, dass der Schlüssel in falsche Hände gerät. Touch ID und die Obergrenze in der App helfen dann nicht mehr, weil ein Dieb die App gar nicht braucht.', 'This is the strongest protection in case the key falls into the wrong hands. Touch ID and the limit in the app no longer help then, because a thief does not need the app at all.')}</p>
            <p className="font-medium">{tr('So geht es:', 'How it works:')}</p>
            <ol className="list-decimal space-y-1 pl-5 text-ink-muted">
              {tr(
                <>
                  <li>Deine aktuelle IP-Adresse findest du in deinem Router, bei einer FRITZ!Box unter <em>Internet › Online-Monitor</em> („IPv4-Adresse“).</li>
                  <li>Bei Kraken den Schlüssel bearbeiten (<em>Edit</em>) und unter <em>IP Whitelisting</em> (erlaubte IP-Adressen) genau diese Adresse eintragen.</li>
                  <li>Hier „Rechte erneut prüfen“. Alles grün heißt: es klappt.</li>
                </>,
                <>
                  <li>You find your current IP address in your router, or by searching the web for “what is my IP”.</li>
                  <li>Edit the key at Kraken and enter exactly this address under <em>IP Whitelisting</em>.</li>
                  <li>Click “Check permissions again” here. All green means it works.</li>
                </>,
              )}
            </ol>
            <p className="notice notice-warning">{tr('Achtung: Bei den meisten privaten Anschlüssen in Deutschland ändert sich die IP-Adresse ab und zu, zum Beispiel nach einem Router-Neustart. Dann meldet die App „fehlende Berechtigung“, bis du die neue Adresse bei Kraken einträgst. Unterwegs (anderes WLAN, Handy-Hotspot) geht der Schlüssel ebenfalls nicht. Lohnt sich vor allem, wenn du eine feste IP-Adresse hast oder größere Beträge verwaltest.', 'Note: with most home connections the IP address changes now and then, for example after a router restart. The app then reports “missing permission” until you enter the new address at Kraken. On the road (other Wi-Fi, phone hotspot) the key does not work either. Mainly worth it if you have a fixed IP address or manage larger amounts.')}</p>
          </div>
        </SectionCard>

        <SectionCard title={tr('Häufige Fehler', 'Common mistakes')}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {tr(
              <>
                <li><strong className="text-ink">Felder vertauscht:</strong> Der private Schlüssel (<em>Private Key</em>) ist der längere (88 Zeichen). Die App warnt dich, wenn es so aussieht.</li>
                <li><strong className="text-ink">Nicht vollständig kopiert:</strong> Am besten über den Kopieren-Knopf bei Kraken (<em>Copy</em>), nicht mit der Maus markieren.</li>
                <li><strong className="text-ink">Häkchen vergessen:</strong> Du kannst die Rechte bei Kraken nachträglich ändern (<em>Edit</em>) und hier „Rechte erneut prüfen“.</li>
                <li className="flex items-start gap-1"><ShieldAlert size={14} className="mt-0.5 flex-shrink-0 text-danger-fg" /><span><strong className="text-ink">Auszahlungen erlaubt:</strong> Lösche so einen Schlüssel bei Kraken und lege einen neuen ohne „Withdraw Funds“ (Geld abheben) an.</span></li>
              </>,
              <>
                <li><strong className="text-ink">Fields swapped:</strong> the <em>Private Key</em> is the longer one (88 characters). The app warns you if it looks like that.</li>
                <li><strong className="text-ink">Not copied completely:</strong> best use Kraken’s copy button, do not select with the mouse.</li>
                <li><strong className="text-ink">Box forgotten:</strong> you can change the permissions at Kraken later and click “Check permissions again” here.</li>
                <li className="flex items-start gap-1"><ShieldAlert size={14} className="mt-0.5 flex-shrink-0 text-danger-fg" /><span><strong className="text-ink">Withdrawals allowed:</strong> delete such a key at Kraken and create a new one without “Withdraw Funds”.</span></li>
              </>,
            )}
          </ul>
        </SectionCard>
      </div>
    </div>
  )
}
