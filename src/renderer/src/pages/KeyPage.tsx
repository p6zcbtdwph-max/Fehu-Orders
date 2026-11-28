import { api } from '../api'
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Check, Eye, ExternalLink, Fingerprint, Globe, KeyRound, ShieldAlert, ShieldCheck, Zap, X } from 'lucide-react'
import type { KeyCheck, KeyStatusDto } from '@shared/ipc'
import { checkKeyFormat, normalizeCoinbase } from '@shared/safety'
import { EXCHANGE_IDS, exchangeMeta, exchangeName, readPermissionRows, type ExchangeId } from '@shared/exchanges'
import { modeLabel, modeText, readKeyCanCancel, roleName, TRADE_KEY_MODES, type KeyRole, type KeyRoles, type TradeKeyMode } from '@shared/key-roles'
import KillSwitch from '../components/KillSwitch'
import { tr } from '@shared/i18n'
import SectionCard from '../components/bausteine/SectionCard'
import Segmented from '../components/bausteine/Segmented'
import HomeIps from '../components/HomeIps'
import Knopf from '../components/bausteine/Knopf'
import Feld from '../components/bausteine/Feld'
import Textfeld from '../components/bausteine/Textfeld'
import Haken from '../components/bausteine/Haken'

function CheckList({ checks, exchange }: { checks: KeyCheck[]; exchange: string }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-2">
          {c.ok ? <Check size={16} className="mt-0.5 flex-shrink-0 text-success-fg" /> : !c.required ? <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-warning-fg" /> : <X size={16} className="mt-0.5 flex-shrink-0 text-danger-fg" />}
          <span>
            <strong>{c.label}</strong> <span className="text-ink-muted">({c.exchangeLabel})</span>
            {!c.ok && c.required && c.id !== 'withdraw' && c.id !== 'no-trade' && <span className="block text-xs text-danger-fg">{tr(`Fehlt. Setze bei ${exchange} das Häkchen „${c.exchangeLabel}“.`, `Missing. Tick “${c.exchangeLabel}” at ${exchange}.`)}</span>}
            {c.detail && <span className={`block text-xs ${c.ok ? (c.required ? 'text-warning-fg' : 'text-success-fg') : c.required ? 'text-danger-fg' : 'text-warning-fg'}`}>{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

interface Props {
  /** Börse, mit der die App gerade arbeitet (oben links gewählt) */
  active: ExchangeId
  /** Welche Börsen schon einen Schlüssel haben */
  keys: Partial<Record<ExchangeId, boolean>>
  onKeyChanged: () => void
  /** Diese Börse ab jetzt benutzen */
  onUse: (ex: ExchangeId) => void
}

/**
 * Schlüssel anlegen und verwalten ist getrennt vom Benutzen: Oben wählt man, für welche Börse
 * man einen Schlüssel einrichtet. Mit welcher Börse die App arbeitet, wählt man oben links in der Leiste.
 * Steht in den Einstellungen unter „Börsen und Schlüssel“.
 */
export default function KeyPage({ active, keys, onKeyChanged, onUse }: Props): JSX.Element {
  const [sel, setSel] = useState<ExchangeId>(active)
  const [status, setStatus] = useState<KeyStatusDto | null>(null)
  const reload = () => { api().keyStatus().then(setStatus).catch(() => setStatus(null)) }
  useEffect(reload, [])
  const changed = () => { reload(); onKeyChanged() }
  const roles: KeyRoles = status?.roles[sel] ?? { read: false, trade: !!keys[sel], tradeTemporary: false }
  // Wer schon einen Handels-Schlüssel hat, aber noch keinen zum Ansehen, landet beim Nur-Lese-Schlüssel
  const [role, setRole] = useState<KeyRole>('read')
  const name = exchangeName(sel)
  return (
    <div>
      <p className="mb-4 text-sm text-ink-muted">{tr('API-Schlüssel je Börse Schritt für Schritt anlegen und sicher hinterlegen. Hier wählst du nur, welchen Schlüssel du einrichtest. Mit welcher Börse die App arbeitet, wählst du oben links in der Leiste.', 'Create and store an API key per exchange step by step. Here you only choose which key you set up. Which exchange the app works with is chosen at the top left of the bar.')}</p>
      <div className="mb-4 space-y-2">
        <span className="label">{tr('Schlüssel einrichten für', 'Set up key for')}</span>
        <Segmented<ExchangeId> block size="md" value={sel} onChange={setSel} aria-label={tr('Schlüssel einrichten für', 'Set up key for')}
          options={EXCHANGE_IDS.map((id) => ({ id, label: exchangeName(id), icon: keys[id] ? Check : undefined, title: keys[id] ? tr('Schlüssel hinterlegt', 'Key saved') : tr('Noch kein Schlüssel', 'No key yet') }))} />
        {sel === active ? (
          <p className="text-xs text-ink-muted">{tr(`${name} ist die Börse, mit der die App gerade arbeitet.`, `${name} is the exchange the app is working with right now.`)}</p>
        ) : (
          <div className="notice notice-info flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1">{tr(`Die App arbeitet gerade mit ${exchangeName(active)}. Einen Schlüssel für ${name} kannst du trotzdem hier anlegen, die App wechselt dabei nicht.`, `The app is working with ${exchangeName(active)} right now. You can still set up a ${name} key here, the app does not switch.`)}</span>
            {keys[sel] && <Knopf symbol={ArrowRightLeft} groesse="klein" onClick={() => onUse(sel)}>{tr(`${name} jetzt benutzen`, `Use ${name} now`)}</Knopf>}
          </div>
        )}
      </div>
      <TwoKeys exchange={sel} roles={roles} onPick={setRole} />
      <div className="mb-4 space-y-2">
        <span className="label">{tr('Diesen Schlüssel einrichten', 'Set up this key')}</span>
        <Segmented<KeyRole> block size="md" value={role} onChange={setRole} aria-label={tr('Diesen Schlüssel einrichten', 'Set up this key')}
          options={[
            { id: 'read', label: roleName('read'), icon: roles.read ? Check : Eye },
            { id: 'trade', label: roleName('trade'), icon: roles.trade ? Check : Zap },
          ]} />
      </div>
      <KeyPanel key={`${sel}-${role}`} exchange={sel} role={role} roles={roles} mode={status?.tradeKeyMode ?? 'keep'} onKeyChanged={changed} />
      <div className="mt-4"><KillSwitch onDone={changed} /></div>
    </div>
  )
}

/**
 * Erklärt die zwei Schlüssel und zeigt, welcher da ist. Der Nur-Lese-Schlüssel bleibt dauerhaft für Portfolio, Guthaben
 * und Ausführungen. Der Handels-Schlüssel wird nur zum Senden gebraucht und kann nach dem Senden vergessen werden.
 */
function TwoKeys({ exchange, roles, onPick }: { exchange: ExchangeId; roles: KeyRoles; onPick: (r: KeyRole) => void }) {
  const name = exchangeName(exchange)
  const tile = (role: KeyRole, Icon: typeof Eye, text: string) => {
    const has = roles[role]
    return (
      // @fehu-ausnahme: klickbare Karte, ganze Fläche ist das Ziel
      <button type="button" onClick={() => onPick(role)} className="flex min-w-0 flex-1 items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-accent-edge">
        <Icon size={18} className={`mt-0.5 flex-shrink-0 ${has ? 'text-success-fg' : 'text-ink-muted'}`} />
        <span className="min-w-0 space-y-1">
          <strong className="block">{roleName(role)}</strong>
          <span className="block text-xs text-ink-muted">{text}</span>
          <span className={`block text-xs font-medium ${has ? 'text-success-fg' : 'text-ink-muted'}`}>
            {has ? (role === 'trade' && roles.tradeTemporary ? tr('Da, nur im Arbeitsspeicher', 'Present, in memory only') : tr('Hinterlegt', 'Saved')) : tr('Noch nicht da', 'Not there yet')}
          </span>
        </span>
      </button>
    )
  }
  return (
    <div className="mb-4"><SectionCard title={tr('Zwei Schlüssel je Börse', 'Two keys per exchange')}>
      <div className="space-y-3 text-sm">
        <p className="text-ink-muted">{tr(
          'So machen es auch Profis: Ein Schlüssel, der nur ansehen darf, bleibt dauerhaft in der App. Der Schlüssel, der handeln darf, kommt nur dann rein, wenn du wirklich senden willst. Wer den Nur-Lese-Schlüssel stiehlt, kann damit weder kaufen noch verkaufen noch abheben.',
          'This is how professionals do it: a key that can only view stays in the app permanently. The key that can trade only comes in when you really want to send. Whoever steals the read-only key can neither buy, sell nor withdraw with it.',
        )}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {tile('read', Eye, tr('Guthaben, Portfolio, offene Orders, Ausführungen und Mitteilungen.', 'Balances, portfolio, open orders, fills and notifications.') + (readKeyCanCancel(exchange) ? tr(' Bei Kraken darf er auch stornieren, damit die Notbremse immer geht.', ' At Kraken it may also cancel, so the emergency stop always works.') : ''))}
          {tile('trade', Zap, tr('Nur zum Senden und Testen. Wie lange die App ihn behält, stellst du beim Handels-Schlüssel ein.', 'Only for sending and test runs. How long the app keeps it is set under the trading key.'))}
        </div>
        {roles.trade && !roles.read && <p className="notice notice-info">{tr(`Dein bisheriger ${name}-Schlüssel ist ein Handels-Schlüssel. Er funktioniert weiter wie gewohnt. Für mehr Sicherheit lege zusätzlich einen Nur-Lese-Schlüssel an und stelle beim Handels-Schlüssel „Bis die App schließt“ oder „Nur für eine Sendung“ ein.`, `Your existing ${name} key is a trading key. It keeps working as before. For more safety, also add a read-only key and set the trading key to “Until the app closes” or “For one send only”.`)}</p>}
        {roles.read && !roles.trade && <p className="text-xs text-ink-muted">{tr(`Ansehen geht. Zum Senden an ${name} fügst du den Handels-Schlüssel ein, wenn du ihn brauchst.`, `Viewing works. To send to ${name}, paste the trading key when you need it.`)}</p>}
      </div>
    </SectionCard></div>
  )
}

/** Wie lange die App den Handels-Schlüssel behält. Gilt für alle Börsen. */
function TradeKeyModeCard({ mode, onChanged }: { mode: TradeKeyMode; onChanged: () => void }) {
  const [value, setValue] = useState<TradeKeyMode>(mode)
  const [saved, setSaved] = useState(false)
  useEffect(() => setValue(mode), [mode])
  async function pick(m: TradeKeyMode) {
    setValue(m)
    setSaved(false)
    await api().saveSettings({ tradeKeyMode: m })
    setSaved(true)
    onChanged()
  }
  return (
    <SectionCard title={tr('Wie lange soll die App den Handels-Schlüssel behalten?', 'How long should the app keep the trading key?')}>
      <div className="space-y-3 text-sm">
        <Segmented<TradeKeyMode> block size="md" value={value} onChange={pick} aria-label={tr('Handels-Schlüssel behalten', 'Keep trading key')}
          options={TRADE_KEY_MODES.map((m) => ({ id: m, label: modeLabel(m) }))} />
        <p>{modeText(value)}</p>
        {value !== 'keep' && <p className="notice notice-info">{tr(
          'Die Börse zeigt den geheimen Teil nur einmal. Damit du ihn wieder einfügen kannst, bewahre ihn in einem Passwort-Manager auf (zum Beispiel in der App „Passwörter“ auf dem Mac), nicht in Notizen oder Mails. Ohne Handels-Schlüssel siehst du weiter alles, du kannst nur nicht senden.',
          'The exchange shows the secret only once. So you can paste it again, keep it in a password manager (for example the Passwords app on the Mac), not in notes or e-mails. Without a trading key you still see everything, you just cannot send.',
        )}</p>}
        {value !== 'keep' && <p className="text-xs text-ink-muted">{tr('Ein schon gespeicherter Handels-Schlüssel wird dabei sofort von der Festplatte gelöscht und bleibt nur noch bis zum Schließen der App.', 'A trading key that is already saved is removed from disk right away and only stays until the app closes.')}</p>}
        {saved && <p className="text-xs text-success-fg">{tr('Gespeichert. Gilt für alle Börsen.', 'Saved. Applies to all exchanges.')}</p>}
      </div>
    </SectionCard>
  )
}

function KeyPanel({ exchange, role, roles, mode, onKeyChanged }: { exchange: ExchangeId; role: KeyRole; roles: KeyRoles; mode: TradeKeyMode; onKeyChanged: () => void }): JSX.Element {
  const ex = exchangeMeta(exchange)
  const hasKey = roles[role]
  const isRead = role === 'read'
  const rName = roleName(role)
  const permissions = isRead ? readPermissionRows(ex.id) : ex.permissions
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
      const r = await api().saveKey(key, secret, { noWithdrawConfirmed: needsConfirm ? noWithdraw : undefined, exchange, role })
      setChecks(r.checks)
      if (r.saved) {
        setKey('')
        setSecret('')
        setNoWithdraw(false)
        setMsg({ ok: true, text: !isRead && mode !== 'keep'
          ? tr(`Alle Rechte stimmen. Der Handels-Schlüssel liegt nur im Arbeitsspeicher, nicht auf der Festplatte, ${mode === 'once' ? 'und wird nach dem nächsten echten Senden vergessen' : 'bis du die App schließt'}.`, `All permissions are correct. The trading key is kept in memory only, not on disk, ${mode === 'once' ? 'and is forgotten after the next real send' : 'until you close the app'}.`)
          : tr('Alle Rechte stimmen. Der Schlüssel ist verschlüsselt gespeichert.', 'All permissions are correct. The key is stored encrypted.') })
        onKeyChanged()
      } else {
        setMsg({ ok: false, text: isRead && r.checks.some((c) => c.id === 'no-trade' && !c.ok)
          ? tr(`Nicht als Nur-Lese-Schlüssel gespeichert, weil dieser Schlüssel handeln darf. Nimm bei ${ex.name} das Handelsrecht raus oder speichere ihn oben unter „Handels-Schlüssel“.`, `Not saved as read-only key because this key can trade. Remove the trading permission at ${ex.name} or save it under “Trading key” above.`)
          : tr(`Nicht gespeichert. Korrigiere bei ${ex.name} die rot markierten Rechte (Schlüssel bearbeiten) und klicke dann noch einmal auf „Prüfen und speichern“.`, `Not saved. Fix the permissions marked in red at ${ex.name} (edit the key) and click “Check and save” again.`) })
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
      const c = await api().verifyKey(exchange, role)
      setChecks(c)
      setMsg(c.every((x) => x.ok || !x.required) ? { ok: true, text: tr('Alle Rechte stimmen.', 'All permissions are correct.') } : { ok: false, text: tr('Bei den Rechten stimmt etwas nicht, siehe unten.', 'Something is wrong with the permissions, see below.') })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(null)
  }

  async function clear() {
    await api().clearKey(exchange, role)
    setConfirmClear(false)
    setChecks(null)
    setSource('status')
    setMsg({ ok: true, text: tr(`${rName} aus der App gelöscht. Bei ${ex.name} ist er noch gültig. Lösche ihn dort auch, wenn du ihn nicht mehr brauchst.`, `${rName} deleted from the app. It is still valid at ${ex.name}. Delete it there too if you no longer need it.`) })
    onKeyChanged()
  }

  return (
      <div className="space-y-4">
        <SectionCard title={tr('Status', 'Status')}>
          <div className="space-y-3 text-sm">
            {hasKey ? (
              <p className="notice notice-success flex items-center gap-2"><ShieldCheck size={16} /> {!isRead && roles.tradeTemporary
                ? tr(`Ein ${ex.name}-Handels-Schlüssel ist da, nur im Arbeitsspeicher. ${mode === 'once' ? 'Nach dem nächsten echten Senden vergisst die App ihn.' : 'Beim Schließen der App ist er weg.'}`, `A ${ex.name} trading key is present, in memory only. ${mode === 'once' ? 'The app forgets it after the next real send.' : 'It is gone when the app closes.'}`)
                : tr(`Ein ${ex.name}-${rName} ist hinterlegt. Ein neuer ersetzt ihn.`, `A ${ex.name} ${rName.toLowerCase()} is saved. A new one replaces it.`)}</p>
            ) : (
              <p className="notice notice-info flex items-center gap-2"><KeyRound size={16} /> {isRead
                ? tr(`Noch kein ${ex.name}-Nur-Lese-Schlüssel. Folge den Schritten unten, aber setze nur die Häkchen zum Ansehen.`, `No ${ex.name} read-only key yet. Follow the steps below, but tick only the viewing boxes.`)
                : tr(`Gerade kein ${ex.name}-Handels-Schlüssel da. Den brauchst du nur zum Senden.`, `No ${ex.name} trading key right now. You only need it for sending.`)}</p>
            )}
            <p className="text-ink-muted">{ex.name}: {ex.origin}.</p>
            <p className="flex items-center gap-2 text-ink-muted"><ShieldCheck size={16} className="text-success-fg" /> {isRead || mode === 'keep'
              ? tr('Der Schlüssel bleibt auf diesem Mac, verschlüsselt über den macOS-Schlüsselbund. Jede Börse hat ihre eigenen Schlüssel.', 'The key stays on this Mac, encrypted via the macOS keychain. Each exchange has its own keys.')
              : tr('Der Handels-Schlüssel kommt nicht auf die Festplatte, er liegt nur im Arbeitsspeicher der App.', 'The trading key is not written to disk, it is only kept in the app’s memory.')}</p>
            {touchId === true && <p className="flex items-center gap-2 text-ink-muted"><Fingerprint size={16} className="text-success-fg" /> {tr('Touch ID ist aktiv: Vor jedem echten Senden fragt der Mac nach deinem Finger. Der Test geht ohne.', 'Touch ID is on: before every real send the Mac asks for your finger. The test run works without it.')}</p>}
            {touchId === false && <p className="flex items-start gap-2 text-ink-muted"><Fingerprint size={16} className="mt-0.5 flex-shrink-0 text-warning-fg" /> <span>{tr('Dieser Mac hat kein Touch ID oder es ist kein Finger eingerichtet. Vor dem Senden fragt die App dann nur mit dem Bestätigungsfenster. Einrichten kannst du Touch ID in den Systemeinstellungen unter „Touch ID & Passwort“.', 'This Mac has no Touch ID or no finger is set up. The app then only asks with the confirmation window before sending. You can set up Touch ID in System Settings under “Touch ID & Password”.')}</span></p>}
            {hasKey && (
              <div className="flex flex-wrap gap-2">
                <Knopf disabled={!!busy} onClick={verify}>{busy === 'verify' ? tr('Prüfe …', 'Checking …') : tr('Rechte erneut prüfen', 'Check permissions again')}</Knopf>
                {confirmClear ? (
                  <>
                    <Knopf art="gefahr" onClick={clear}>{tr('Ja, löschen', 'Yes, delete')}</Knopf>
                    <Knopf art="leise" onClick={() => setConfirmClear(false)}>{tr('Abbrechen', 'Cancel')}</Knopf>
                  </>
                ) : <Knopf onClick={() => setConfirmClear(true)}>{tr(`${rName} löschen`, `Delete ${rName.toLowerCase()}`)}</Knopf>}
              </div>
            )}
            {source === 'status' && msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
            {source === 'status' && checks && <CheckList checks={checks} exchange={ex.name} />}
          </div>
        </SectionCard>

        {!isRead && <TradeKeyModeCard mode={mode} onChanged={onKeyChanged} />}

        <SectionCard title={tr(`So legst du den ${rName} bei ${ex.name} an`, `How to create the ${rName.toLowerCase()} at ${ex.name}`)}>
          {isRead && <p className="notice notice-info mb-4 text-sm">{tr(`Ein zweiter, eigener Schlüssel bei ${ex.name}. Nenne ihn zum Beispiel „Fehu Orders Lesen“, damit du ihn vom Handels-Schlüssel unterscheiden kannst. Die Schritte sind dieselben, nur die Häkchen in der Tabelle sind andere.`, `A second, separate key at ${ex.name}. Name it for example “Fehu Orders Read” so you can tell it apart from the trading key. The steps are the same, only the boxes in the table differ.`)}</p>}
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
                          {permissions.map((p) => (
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

        <div data-guide="key"><SectionCard title={tr(`${rName} einfügen`, `Paste ${rName.toLowerCase()}`)}>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="label">{ex.keyLabel}</span>
              <Feld className="w-full font-mono" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder={ex.keyPlaceholder} />
            </label>
            <label className="block">
              <span className="label">{ex.secretLabel}</span>
              {ex.secretMultiline
                // Ein PEM-Block ist mehrzeilig. Das Feld ist absichtlich klein und unscharf dargestellt, damit niemand mitliest.
                ? <Textfeld className="h-24 w-full font-mono text-xs [-webkit-text-security:disc]" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder={ex.secretPlaceholder} />
                : <Feld className="w-full font-mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder={ex.secretPlaceholder} />}
            </label>
            {needsConfirm && (
              <label className="notice notice-warning flex cursor-pointer items-start gap-2">
                <Haken className="mt-0.5" checked={noWithdraw} onChange={(e) => setNoWithdraw(e.target.checked)} />
                <span>{tr(`Ich habe bei ${ex.name} geprüft: Das Recht „${ex.withdrawLabel}“ (Auszahlen) ist bei diesem Schlüssel aus. ${ex.name} lässt das nicht automatisch prüfen, deshalb ist diese Bestätigung Pflicht.`, `I checked at ${ex.name}: the “${ex.withdrawLabel}” permission is off for this key. ${ex.name} does not let apps check this, so this confirmation is required.`)}</span>
              </label>
            )}
            {formatIssues.length > 0 && <div className="notice notice-warning space-y-1">{formatIssues.map((t) => <p key={t}>{t}</p>)}</div>}
            {source === 'form' && msg && <p className={`notice ${msg.ok ? 'notice-success' : 'notice-danger'}`}>{msg.text}</p>}
            {source === 'form' && checks && <CheckList checks={checks} exchange={ex.name} />}
            <Knopf art="primaer" disabled={!!busy || !filled.key || !filled.secret || formatIssues.length> 0 || (needsConfirm && !noWithdraw)} onClick={save}>
              {busy === 'save' ? tr('Prüfe alle Rechte …', 'Checking all permissions …') : tr('Prüfen und speichern', 'Check and save')}
            </Knopf>
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
            <HomeIps />
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
  )
}
