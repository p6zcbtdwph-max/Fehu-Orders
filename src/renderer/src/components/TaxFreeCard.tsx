// Beim Verkaufen: Wie viel von diesem Coin ist schon über ein Jahr gehalten und damit steuerfrei verkaufbar?
// Rechenhilfe aus den Käufen, die die App kennt, plus selbst eingetragene ältere Käufe. Keine Steuerberatung.
import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import { tr } from '@shared/i18n'
import { activeExchange, exName } from '@shared/exchanges'
import { dateToSec, holdingPeriods, sellTaxNote, type LotEvent, type ManualLot } from '@shared/holding-period'
import { localDate } from '@shared/dates'
import { dateLocale, num } from '../format'
import { NumberField } from './NumberField'

export default function TaxFreeCard({ coin, held, sellVolume, decimals }: {
  coin: string
  /** Bestand dieses Coins bei der Börse (frei + in Orders + Earn), falls bekannt */
  held?: number
  /** Menge, die der Plan verkaufen will */
  sellVolume: number
  decimals: number
}): JSX.Element {
  const [events, setEvents] = useState<LotEvent[] | null>(null)
  const [manual, setManual] = useState<ManualLot[]>([])
  const [adding, setAdding] = useState(false)
  const [vol, setVol] = useState(0)
  const [date, setDate] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [showLots, setShowLots] = useState(false)

  const load = () => {
    api().lotEvents().then(setEvents).catch(() => setEvents([]))
    api().settings().then((s) => setManual(s.manualLots ?? [])).catch(() => {})
  }
  useEffect(load, [])

  const now = Math.floor(Date.now() / 1000)
  const hp = useMemo(() => (events ? holdingPeriods(events.filter((e) => e.coin === coin), now, held !== undefined ? { [coin]: held } : undefined)[0] : undefined), [events, coin, held, now])
  const fmt = (n: number) => num(n, decimals)
  const day = (sec: number) => new Date(sec * 1000).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
  const note = sellTaxNote(hp, sellVolume, fmt, day)
  const mine = manual.filter((l) => l.coin === coin && l.exchange === activeExchange())

  async function saveManual(list: ManualLot[]) {
    const s = await api().saveSettings({ manualLots: list })
    setManual(s.manualLots ?? [])
    load()
  }
  async function add() {
    setErr(null)
    if (!(vol > 0)) return setErr(tr('Bitte eine Menge größer 0 eintragen.', 'Please enter an amount above 0.'))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > localDate()) return setErr(tr('Bitte ein Kaufdatum eintragen, das nicht in der Zukunft liegt.', 'Please enter a purchase date that is not in the future.'))
    await saveManual([...manual, { id: `lot-${Date.now()}`, exchange: activeExchange(), coin, volume: vol, date }])
    setAdding(false)
    setVol(0)
    setDate('')
  }

  return (
    <section className="card mb-4 p-4" aria-label={tr('Haltefrist', 'Holding period')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold"><CalendarClock size={16} /> {tr(`Haltefrist ${coin}: steuerfrei nach einem Jahr`, `Holding period ${coin}: tax-free after one year`)}</span>
      </div>
      {events === null ? <p className="text-xs text-ink-muted">{tr('Wird geladen …', 'Loading …')}</p> : (
        <div className="space-y-3 text-sm">
          {!hp || !hp.lots.length ? (
            <p className="text-ink-muted">{tr(
              `Die App kennt noch keinen Kauf von ${coin} mit Datum auf ${exName()}. Hast du ${coin} früher gekauft, trag den Kauf unten ein, dann rechnet die App die Frist mit.`,
              `The app does not know any dated ${coin} purchase on ${exName()} yet. If you bought ${coin} earlier, add the purchase below and the app includes it.`,
            )}</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Stat label={tr('Steuerfrei verkaufbar', 'Tax-free to sell')} value={`${fmt(hp.taxFree)} ${coin}`} good />
              <Stat label={tr('Noch in der Jahresfrist', 'Still within one year')} value={`${fmt(hp.inPeriod)} ${coin}`} />
              <Stat label={tr('Nächster wird frei', 'Next to become free')} value={hp.next ? `${fmt(hp.next.volume)} ${tr('am', 'on')} ${day(hp.next.freeAt)}` : '–'} />
            </div>
          )}
          {note && <p className={`notice ${note.level === 'ok' ? 'notice-success' : 'notice-warning'}`}>{note.text}</p>}
          {hp && hp.unmatchedSells > 0 && <p className="text-xs text-ink-muted">{tr(`${fmt(hp.unmatchedSells)} ${coin} wurden über die App verkauft, ohne dass ein Kauf dazu bekannt ist. Trag ältere Käufe ein, damit die Rechnung stimmt.`, `${fmt(hp.unmatchedSells)} ${coin} were sold via the app without a known purchase. Add older purchases so the calculation is right.`)}</p>}

          {hp && hp.lots.length > 0 && (
            <div>
              <button type="button" className="btn-link text-xs" onClick={() => setShowLots(!showLots)}>{showLots ? tr('Käufe ausblenden', 'Hide purchases') : tr(`Gehaltene Käufe zeigen (${hp.lots.length})`, `Show held purchases (${hp.lots.length})`)}</button>
              {showLots && (
                <div className="mt-2 overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>{tr('Gekauft am', 'Bought on')}</th><th className="num">{tr('Noch gehalten', 'Still held')}</th><th>{tr('Steuerfrei ab', 'Tax-free from')}</th><th>{tr('Quelle', 'Source')}</th></tr></thead>
                    <tbody>
                      {hp.lots.map((l, i) => (
                        <tr key={i}>
                          <td>{day(l.at)}</td>
                          <td className="num tabular-nums">{fmt(l.volume)}</td>
                          <td className={l.freeAt <= now ? 'text-success-fg' : ''}>{l.freeAt <= now ? tr('schon frei', 'already free') : day(l.freeAt)}</td>
                          <td className="text-ink-muted">{l.source === 'app' ? tr('über die App', 'via the app') : tr('eingetragen', 'entered')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {mine.length > 0 && (
            <ul className="space-y-1 text-xs">
              {mine.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <span>{tr('Eingetragen', 'Entered')}: {fmt(l.volume)} {coin}, {tr('gekauft am', 'bought on')} {day(dateToSec(l.date) ?? 0)}</span>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={tr('Eintrag löschen', 'Delete entry')} onClick={() => saveManual(manual.filter((x) => x.id !== l.id))}><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          {adding ? (
            <div className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40"><NumberField label={tr(`Menge ${coin}`, `Amount ${coin}`)} value={vol} onChange={setVol} /></div>
                <label className="block">
                  <span className="label">{tr('Kaufdatum', 'Purchase date')}</span>
                  <input type="date" className="input" value={date} max={localDate()} onChange={(e) => setDate(e.target.value)} />
                </label>
                <button type="button" className="btn btn-primary btn-sm mb-1" onClick={add}>{tr('Eintragen', 'Add')}</button>
                <button type="button" className="btn btn-ghost btn-sm mb-1" onClick={() => { setAdding(false); setErr(null) }}>{tr('Abbrechen', 'Cancel')}</button>
              </div>
              {err && <p className="notice notice-danger mt-2">{err}</p>}
            </div>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> {tr('Älteren Kauf eintragen', 'Add an older purchase')}</button>
          )}
          <p className="text-xs text-ink-muted">{tr(
            'Rechenhilfe, keine Steuerberatung. In Deutschland ist ein Verkauf steuerfrei, wenn der Kauf länger als ein Jahr her ist. Verkauft wird nach „zuerst gekauft, zuerst verkauft“, je Börse. Die App kennt nur Käufe, die über sie liefen oder die du einträgst. Ist dein Bestand kleiner, zieht sie den Unterschied von den ältesten Käufen ab, zeigt also eher zu wenig als zu viel steuerfrei.',
            'A calculation aid, not tax advice. In Germany a sale is tax-free if the purchase was more than a year ago. Coins are sold “first in, first out”, per exchange. The app only knows purchases made through it or entered by you. If your holdings are smaller, it subtracts the difference from the oldest purchases, so it shows too little rather than too much as tax-free.',
          )}</p>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-lg border border-line p-2.5">
      <span className="block text-xs text-ink-muted">{label}</span>
      <strong className={`tabular-nums ${good ? 'text-success-fg' : ''}`}>{value}</strong>
    </div>
  )
}
