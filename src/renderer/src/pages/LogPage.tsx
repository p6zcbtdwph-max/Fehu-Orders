import { api } from '../api'
import { useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { LogEntry } from '@shared/ipc'
import SectionCard from '../components/ui/SectionCard'
import Badge from '../components/ui/Badge'
import Segmented from '../components/ui/Segmented'
import { localDate, num } from '../format'
import { useMoney } from '../money'

export const ACTION_LABEL: Record<string, string> = {
  send: 'Gesendet',
  validate: 'Probelauf',
  rest: 'Rest gesendet',
  'cancel-plan': 'Plan storniert',
  'cancel-order': 'Order storniert',
  'cancel-all': 'Notbremse',
  'key-save': 'Schlüssel gespeichert',
  'key-clear': 'Schlüssel gelöscht',
  alarm: 'Kursalarm',
  restore: 'Sicherung eingespielt',
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'medium' })

/** CSV für Excel/Numbers: Semikolon, Komma als Dezimalzeichen, BOM für Umlaute */
export function toCsv(entries: LogEntry[]): string {
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['Zeit', 'Aktion', 'Paar', 'Richtung', 'Plan-Nummer', 'Orders', 'Angelegt', 'Fehlgeschlagen', 'Gegenwert EUR', 'Erfolg', 'Meldung']
  const rows = entries.map((e) => [
    fmtTime(e.at), ACTION_LABEL[e.action] ?? e.action, e.pair, e.side === 'buy' ? 'Kauf' : e.side === 'sell' ? 'Verkauf' : '', e.userref, e.count, e.ok, e.failed,
    e.amount !== undefined ? Math.round(e.amount * 100) / 100 : undefined, e.success ? 'ja' : 'nein', e.message,
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
    a.download = `fehu-orders-protokoll-${localDate()}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="page">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">Protokoll</h1>
          <p className="page-subtitle">Jedes Senden, Stornieren und jeder Fehler mit Uhrzeit. Bleibt nur auf diesem Mac.</p>
        </div>
        <div className="ml-auto flex flex-shrink-0 gap-2">
          <button type="button" className="btn btn-secondary" onClick={load}><RefreshCw size={16} /> Aktualisieren</button>
          <button type="button" className="btn btn-primary" disabled={!shown.length} onClick={exportCsv}><Download size={16} /> Als CSV speichern</button>
        </div>
      </header>

      <SectionCard title={`${shown.length} ${shown.length === 1 ? 'Eintrag' : 'Einträge'}`}
        action={<Segmented<Filter> value={filter} onChange={setFilter} options={[{ id: 'all', label: 'Alles' }, { id: 'orders', label: 'Orders' }, { id: 'errors', label: 'Fehler' }]} />}>
        {shown.length === 0 ? <p className="text-sm text-ink-muted">Noch keine Einträge. Sobald du einen Probelauf machst oder etwas sendest, steht es hier.</p> : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Zeit</th><th>Aktion</th><th>Paar</th><th className="num">Orders</th><th className="num">Gegenwert</th><th>Ergebnis</th></tr></thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={e.at + i}>
                    <td className="whitespace-nowrap tabular-nums text-ink-muted">{fmtTime(e.at)}</td>
                    <td className="whitespace-nowrap">{ACTION_LABEL[e.action] ?? e.action}{e.userref ? <span className="block text-xs text-ink-muted">Plan {e.userref}</span> : null}</td>
                    <td className="whitespace-nowrap">{e.pair ?? '–'}{e.side && <span className="text-ink-muted"> {e.side === 'buy' ? 'Kauf' : 'Verkauf'}</span>}</td>
                    <td className="num">{e.count !== undefined ? num(e.count, 0) : '–'}</td>
                    <td className="num">{e.amount !== undefined ? eur(e.amount) : '–'}</td>
                    <td className="min-w-[16rem]">
                      <Badge tone={e.success ? 'success' : 'danger'}>{e.success ? 'OK' : 'Fehler'}</Badge>
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
