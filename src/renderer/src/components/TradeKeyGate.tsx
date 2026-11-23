// Im Sendefenster: Fehlt der Handels-Schlüssel (zum Beispiel bei „Nur für eine Sendung“), fügt man ihn direkt hier ein.
// Die App prüft die Rechte genauso streng wie unter Einstellungen › Börsen und Schlüssel und behält ihn so lange,
// wie dort eingestellt.
import { useEffect, useState } from 'react'
import { Check, KeyRound, X } from 'lucide-react'
import { api } from '../api'
import { tr } from '@shared/i18n'
import { exchangeMeta, type ExchangeId } from '@shared/exchanges'
import { checkKeyFormat, normalizeCoinbase } from '@shared/safety'
import type { KeyCheck } from '@shared/ipc'
import type { TradeKeyMode } from '@shared/key-roles'

export interface TradeKeyState {
  /** null = wird noch geladen */
  has: boolean | null
  mode: TradeKeyMode
  reload: () => void
}

/** Ist für diese Börse gerade ein Handels-Schlüssel da? */
export function useTradeKey(exchange: ExchangeId): TradeKeyState {
  const [has, setHas] = useState<boolean | null>(null)
  const [mode, setMode] = useState<TradeKeyMode>('keep')
  const reload = () => {
    api().keyStatus().then((s) => {
      setHas(!!s.roles?.[exchange]?.trade)
      setMode(s.tradeKeyMode ?? 'keep')
    }).catch(() => setHas(null))
  }
  useEffect(reload, [exchange])
  return { has, mode, reload }
}

/** Darf getestet werden? Bitvavo prüft in der App (geht ohne Handelsrecht), Kraken und Coinbase prüfen bei der Börse. */
export const canTest = (state: TradeKeyState, exchange: ExchangeId): boolean => state.has !== false || !exchangeMeta(exchange).serverValidate

export default function TradeKeyGate({ exchange, state }: { exchange: ExchangeId; state: TradeKeyState }): JSX.Element | null {
  const ex = exchangeMeta(exchange)
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [noWithdraw, setNoWithdraw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [checks, setChecks] = useState<KeyCheck[] | null>(null)
  if (state.has !== false) return null

  const filled = ex.id === 'coinbase' ? normalizeCoinbase(key, secret) : { key: key.trim(), secret: secret.trim() }
  const issues = checkKeyFormat(key, secret, ex.id)
  const needsConfirm = !ex.withdrawAutoCheck

  async function save() {
    setBusy(true)
    setMsg(null)
    setChecks(null)
    try {
      const r = await api().saveKey(key, secret, { exchange, role: 'trade', noWithdrawConfirmed: needsConfirm ? noWithdraw : undefined })
      if (r.saved) {
        setKey('')
        setSecret('')
        state.reload()
      } else {
        setChecks(r.checks)
        setMsg(tr('Nicht übernommen. Bei diesem Schlüssel stimmen Rechte nicht, siehe unten.', 'Not accepted. Some permissions of this key are wrong, see below.'))
      }
    } catch (e) {
      setMsg((e as Error).message)
    }
    setBusy(false)
  }

  const keepText = state.mode === 'once'
    ? tr('Nach dieser Sendung vergisst die App ihn wieder.', 'The app forgets it again after this send.')
    : state.mode === 'session'
      ? tr('Er bleibt nur im Arbeitsspeicher, bis du die App schließt.', 'It only stays in memory until you close the app.')
      : tr('Er wird verschlüsselt im Schlüsselbund gespeichert.', 'It is stored encrypted in the keychain.')

  return (
    <div className="space-y-2 rounded-lg border border-accent-400 bg-accent-soft p-3 text-sm">
      <p className="flex items-start gap-2"><KeyRound size={16} className="mt-0.5 flex-shrink-0" />
        <span><strong>{tr(`Handels-Schlüssel für ${ex.name} einfügen`, `Paste the ${ex.name} trading key`)}</strong>{' '}
          {tr(`Zum Senden braucht die App ihn. ${keepText}`, `The app needs it to send. ${keepText}`)}</span>
      </p>
      <input className="input w-full font-mono text-xs" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false}
        placeholder={ex.keyLabel} aria-label={ex.keyLabel} />
      {ex.secretMultiline
        ? <textarea className="input h-16 w-full font-mono text-xs [-webkit-text-security:disc]" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder={ex.secretLabel} aria-label={ex.secretLabel} />
        : <input className="input w-full font-mono text-xs" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder={ex.secretLabel} aria-label={ex.secretLabel} />}
      {needsConfirm && (
        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={noWithdraw} onChange={(e) => setNoWithdraw(e.target.checked)} />
          <span>{tr(`Bei diesem Schlüssel ist „${ex.withdrawLabel}“ (Auszahlen) aus.`, `“${ex.withdrawLabel}” (withdraw) is off for this key.`)}</span>
        </label>
      )}
      {issues.length > 0 && <div className="notice notice-warning space-y-1 text-xs">{issues.map((t) => <p key={t}>{t}</p>)}</div>}
      {msg && <p className="notice notice-danger text-xs">{msg}</p>}
      {checks && (
        <ul className="space-y-1 text-xs">
          {checks.filter((c) => !c.ok && c.required).map((c) => (
            <li key={c.id} className="flex items-start gap-1.5"><X size={14} className="mt-0.5 flex-shrink-0 text-danger-fg" /><span><strong>{c.label}</strong> ({c.exchangeLabel}){c.detail && <span className="block">{c.detail}</span>}</span></li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !filled.key || !filled.secret || issues.length > 0 || (needsConfirm && !noWithdraw)} onClick={save}>
        <Check size={14} /> {busy ? tr('Prüfe Rechte …', 'Checking permissions …') : tr('Prüfen und übernehmen', 'Check and use')}
      </button>
    </div>
  )
}
