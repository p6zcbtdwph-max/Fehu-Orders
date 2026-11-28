// Eigene IP-Adressen speichern (für die IP-Sperre der API-Schlüssel). Verschlüsselt im Schlüsselbund,
// in der Liste nur verdeckt. Zeigen auf Klick, Kopieren ohne Anzeigen.
import { api } from '../api'
import { useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, Lock, Plus, Trash2 } from 'lucide-react'
import type { HomeIpView } from '@shared/ip'
import { ipProblem, MAX_IPS } from '@shared/ip'
import { tr } from '@shared/i18n'
import Knopf from './bausteine/Knopf'
import Feld from './bausteine/Feld'

export default function HomeIps(): JSX.Element {
  const [list, setList] = useState<HomeIpView[]>([])
  /** Klartext der aufgedeckten Adressen (nur im Speicher, solange die Seite offen ist) */
  const [shown, setShown] = useState<Record<number, string>>({})
  const [copied, setCopied] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [ip, setIp] = useState('')
  const [label, setLabel] = useState('')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remove, setRemove] = useState<number | null>(null)

  useEffect(() => {
    api().homeIps().then(setList).catch((e) => setError((e as Error).message))
  }, [])

  const problem = ip.trim() ? ipProblem(ip) : null

  async function add() {
    setTouched(true)
    if (ipProblem(ip)) return
    setError(null)
    try {
      setList(await api().addHomeIp(ip.trim(), label.trim() || undefined))
      setShown({})
      setIp('')
      setLabel('')
      setTouched(false)
      setAdding(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function toggle(i: number) {
    if (shown[i] !== undefined) {
      const next = { ...shown }
      delete next[i]
      setShown(next)
      return
    }
    try {
      const text = await api().revealHomeIp(i)
      setShown({ ...shown, [i]: text })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function copy(i: number) {
    try {
      await api().copyHomeIp(i)
      setCopied(i)
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 2000)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function doRemove(i: number) {
    setError(null)
    try {
      setList(await api().deleteHomeIp(i))
      setShown({})
    } catch (e) {
      setError((e as Error).message)
    }
    setRemove(null)
  }

  return (
    <div className="space-y-2 rounded-lg border border-line p-3" data-guide="home-ip">
      <p className="flex items-center gap-2 font-medium text-ink"><Lock size={15} className="text-ink-muted" /> {tr('Deine IP-Adressen', 'Your IP addresses')}</p>
      <p className="text-xs text-ink-muted">{tr(
        'Hier kannst du die Adresse(n) ablegen, die du bei der Börse einträgst, damit du sie nicht woanders aufschreiben musst. Die Adressen liegen verschlüsselt im Schlüsselbund deines Macs, genau wie die API-Schlüssel, und kommen nicht in die Datensicherung.',
        'Keep the address(es) you enter at the exchange here, so you do not have to note them elsewhere. They are stored encrypted in your Mac’s keychain, just like the API keys, and are not included in backups.',
      )}</p>
      {list.length > 0 && (
        <ul className="divide-y divide-line">
          {list.map((x, i) => (
            <li key={`${i}-${x.masked}`} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="font-mono tabular-nums text-ink [overflow-wrap:anywhere]">{shown[i] ?? x.masked}</span>
                <span className="ml-2 text-xs text-ink-muted">{x.label ? `${x.label} · ` : ''}{x.kind}</span>
              </span>
              <span className="inline-flex gap-1">
                <Knopf art="leise" nurSymbol symbol={shown[i] !== undefined ? EyeOff : Eye} onClick={() => toggle(i)} aria-label={shown[i] !== undefined ? tr('Verdecken', 'Hide') : tr('Anzeigen', 'Show')} />
                <Knopf art="leise" nurSymbol symbol={copied === i ? Check : Copy} className={copied === i ? 'text-success-fg' : ''} onClick={() => copy(i)} aria-label={tr('Kopieren', 'Copy')} title={copied === i ? tr('Kopiert', 'Copied') : tr('Kopieren', 'Copy')} />
                {remove === i
                  ? <>
                    <Knopf art="gefahr" groesse="klein" onClick={() => doRemove(i)}>{tr('Löschen', 'Delete')}</Knopf>
                    <Knopf art="leise" groesse="klein" onClick={() => setRemove(null)}>{tr('Abbrechen', 'Cancel')}</Knopf>
                  </>
                  : <Knopf art="leise" nurSymbol symbol={Trash2} onClick={() => setRemove(i)} aria-label={tr('Adresse löschen', 'Delete address')} title={tr('Adresse löschen', 'Delete address')} />}
              </span>
            </li>
          ))}
        </ul>
      )}
      {copied !== null && <p className="text-xs text-success-fg">{tr('In die Zwischenablage kopiert. Bei der Börse mit ⌘ V einfügen.', 'Copied to the clipboard. Paste it at the exchange with ⌘ V.')}</p>}
      {adding ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-[1fr_12rem]">
            <label className="block">
              <span className="label">{tr('IP-Adresse', 'IP address')}</span>
              <Feld className={`w-full font-mono ${touched && problem ? 'border-danger' : ''}`} autoFocus value={ip} placeholder={tr('z. B. 84.123.45.67', 'e.g. 84.123.45.67')}
                spellCheck={false} autoComplete="off" onChange={(e) => { setIp(e.target.value); setError(null) }} onBlur={() => setTouched(true)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            </label>
            <label className="block">
              <span className="label">{tr('Bezeichnung (optional)', 'Label (optional)')}</span>
              <Feld className="w-full" value={label} maxLength={40} placeholder={tr('z. B. Zuhause', 'e.g. Home')} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            </label>
          </div>
          {touched && problem && <p className="text-xs text-danger-fg">{problem}</p>}
          <div className="flex gap-2">
            <Knopf art="primaer" groesse="klein" disabled={!ip.trim()} onClick={add}>{tr('Im Schlüsselbund speichern', 'Save to keychain')}</Knopf>
            <Knopf art="leise" groesse="klein" onClick={() => { setAdding(false); setIp(''); setLabel(''); setTouched(false) }}>{tr('Abbrechen', 'Cancel')}</Knopf>
          </div>
        </div>
      ) : list.length < MAX_IPS && (
        <Knopf symbol={Plus} groesse="klein" onClick={() => setAdding(true)}>{list.length ? tr('Weitere Adresse', 'Add another address') : tr('IP-Adresse speichern', 'Save IP address')}</Knopf>
      )}
      {error && <p className="notice notice-danger">{error}</p>}
    </div>
  )
}
