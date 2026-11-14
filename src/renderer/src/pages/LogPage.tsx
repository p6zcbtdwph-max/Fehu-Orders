import { api } from '../api'
import { useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { LogEntry } from '@shared/ipc'
import SectionCard from '../components/ui/SectionCard'
import Badge from '../components/ui/Badge'
import Segmented from '../components/ui/Segmented'
import { dateLocale, localDate, num } from '../format'
import { tr } from '@shared/i18n'
import { useMoney } from '../money'

/** Name einer Aktion im Protokoll, in der gewählten Sprache */
export const actionLabel = (a: string): string => ({
  send: tr('Gesendet', 'Sent'),
  validate: tr('Probelauf', 'Test run'),
  rest: tr('Rest gesendet', 'Rest sent'),
  'cancel-plan': tr('Plan storniert', 'Plan cancelled'),
  'cancel-order': tr('Order storniert', 'Order cancelled'),
  'cancel-all': tr('Notbremse', 'Emergency stop'),
  'key-save': tr('Schlüssel gespeichert', 'Key saved'),
  'key-clear': tr('Schlüssel gelöscht', 'Key deleted'),
  alarm: tr('Kursalarm', 'Price alert'),
  restore: tr('Sicherung eingespielt', 'Backup restored'),
} as Record<string, string>)[a] ?? a

const fmtTime = (iso: string) => new Date(iso).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'medium' })

/** CSV für Excel/Numbers: Semikolon, Komma als Dezimalzeichen, BOM für Umlaute. Spalten in der gewählten Sprache. */
export function toCsv(entries: LogEntry[]): string {
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = tr(
    ['Zeit', 'Aktion', 'Paar', 'Richtung', 'Plan-Nummer', 'Orders', 'Angelegt', 'Fehlgeschlagen', 'Gegenwert EUR', 'Erfolg', 'Meldung'],
    ['Time', 'Action', 'Pair', 'Side', 'Plan number', 'Orders', 'Placed', 'Failed', 'Value EUR', 'Success', 'Message'],
  )
  const rows = entries.map((e) => [
    fmtTime(e.at), actionLabel(e.action), e.pair, e.side === 'buy' ? tr('Kauf', 'Buy') : e.side === 'sell' ? tr('Verkauf', 'Sell') : '', e.userref, e.count, e.ok, e.failed,
    e.amount !== undefined ? Math.round(e.amount * 100) / 100 : undefined, e.success ? tr('ja', 'yes') : tr('nein', 'no'), e.message,
  ].map(cell).join(';'))
  return '﻿' + [head.join(';'), ...rows].join('\r\n')
}

type Filter = 'all' | 'orders' | 'errors'

export default function LogPage(): JSX.Element {
  const { eur } = useMoney()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const load = () => api().log().then(setEntries).catch(() => setEntries([]))
  useEffect(() => { load() }, [])

  const shown = useMemo(() => entries.filter((e) =>
    filter === 'all' ? true : filter === 'errors' ? !e.success : ['send', 'rest', 'cancel-plan', 'cancel-order', 'cancel-all'].includes(e.action),
  ), [entries, filter])

  function exportCsv() {
    const blob = new Blob([toCsv(shown)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fehu-orders-${tr('protokoll', 'log')}-${localDate()}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="page">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">{tr('Protokoll', 'Log')}</h1>
          <p className="page-subtitle">{tr('Jedes Senden, Stornieren und jeder Fehler mit Uhrzeit. Bleibt nur auf diesem Mac.', 'Every send, cancel and error with its time. Stays on this Mac only.')}</p>
        </div>
        <div className="ml-auto flex flex-shrink-0 gap-2">
          <button type="button" className="btn btn-secondary" onClick={load}><RefreshCw size={16} /> {tr('Aktualisieren', 'Refresh')}</button>
          <button type="button" className="btn btn-primary" disabled={!shown.length} onClick={exportCsv}><Download size={16} /> {tr('Als CSV speichern', 'Save as CSV')}</button>
        </div>
      </header>

      <SectionCard title={tr(`${shown.length} ${shown.length === 1 ? 'Eintrag' : 'Einträge'}`, `${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}`)}
        action={<Segmented<Filter> value={filter} onChange={setFilter} options={[{ id: 'all', label: tr('Alles', 'All') }, { id: 'orders', label: 'Orders' }, { id: 'errors', label: tr('Fehler', 'Errors') }]} />}>
        {shown.length === 0 ? <p className="text-sm text-ink-muted">{tr('Noch keine Einträge. Sobald du einen Probelauf machst oder etwas sendest, steht es hier.', 'No entries yet. As soon as you do a test run or send something, it shows up here.')}</p> : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>{tr('Zeit', 'Time')}</th><th>{tr('Aktion', 'Action')}</th><th>{tr('Paar', 'Pair')}</th><th className="num">Orders</th><th className="num">{tr('Gegenwert', 'Value')}</th><th>{tr('Ergebnis', 'Result')}</th></tr></thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={e.at + i}>
                    <td className="whitespace-nowrap tabular-nums text-ink-muted">{fmtTime(e.at)}</td>
                    <td className="whitespace-nowrap">{actionLabel(e.action)}{e.userref ? <span className="block text-xs text-ink-muted">Plan {e.userref}</span> : null}</td>
                    <td className="whitespace-nowrap">{e.pair ?? '–'}{e.side && <span className="text-ink-muted"> {e.side === 'buy' ? tr('Kauf', 'buy') : tr('Verkauf', 'sell')}</span>}</td>
                    <td className="num">{e.count !== undefined ? num(e.count, 0) : '–'}</td>
                    <td className="num">{e.amount !== undefined ? eur(e.amount) : '–'}</td>
                    <td className="min-w-[16rem]">
                      <Badge tone={e.success ? 'success' : 'danger'}>{e.success ? 'OK' : tr('Fehler', 'Error')}</Badge>
                      {e.message && <span className="ml-2 text-xs text-ink-muted">{e.message}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
