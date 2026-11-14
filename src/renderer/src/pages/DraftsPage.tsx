import { api } from '../api'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bell, BellRing, ClipboardList, FlaskConical, Pencil, RefreshCw, Rocket, Trash2 } from 'lucide-react'
import { buildLadder } from '@shared/ladder'
import type { DraftDto, PairDto, SendResult } from '@shared/ipc'
import { wrongSide } from '@shared/safety'
import SectionCard from '../components/ui/SectionCard'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import { dateLocale, num, pct } from '../format'
import { useMoney } from '../money'
import { exName, probeOk } from '@shared/exchanges'

/** Was ein Entwurf jetzt bedeuten würde: Stufen nach den aktuellen Regeln des Paars */
function evaluate(d: DraftDto, pair: PairDto | undefined, last: number | undefined) {
  if (!pair) return null
  const ladder = buildLadder(d.input, pair)
  const sendable = ladder.levels.filter((l) => !l.problem)
  const count = d.sendCount ? Math.min(d.sendCount, sendable.length) : sendable.length
  const toSend = sendable.slice(0, count)
  const cost = toSend.reduce((a, l) => a + l.cost, 0)
  const volume = toSend.reduce((a, l) => a + l.volume, 0)
  const wrong = wrongSide(d.side, toSend.map((l) => l.price), last)
  return { ladder, sendable, count, toSend, cost, volume, wrong }
}

export default function DraftsPage({ hasKey, onEdit, onNeedKey }: { hasKey: boolean; onEdit: (d: DraftDto) => void; onNeedKey: () => void }): JSX.Element {
  const { eur, fmtPrice, sym } = useMoney()
  const [drafts, setDrafts] = useState<DraftDto[]>([])
  const [pairs, setPairs] = useState<PairDto[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [release, setRelease] = useState<DraftDto | null>(null)
  const [remove, setRemove] = useState<DraftDto | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const [ds, ps] = await Promise.all([api().drafts(), api().pairs()])
      setDrafts(ds)
      setPairs(ps)
      const ids = [...new Set(ds.filter((d) => d.status === 'draft').map((d) => d.pairId))]
      setPrices(ids.length ? await api().prices(ids) : {})
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => { load() }, [])

  const open = drafts.filter((d) => d.status === 'draft')
  const released = drafts.filter((d) => d.status === 'released')
  const groups = useMemo(() => {
    const m = new Map<string, DraftDto[]>()
    for (const d of open) m.set(d.scenario || '', [...(m.get(d.scenario || '') ?? []), d])
    // benannte Szenarien zuerst, „Ohne Szenario“ am Ende
    return [...m.entries()].sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : -1) : 1))
  }, [drafts])
  const pairOf = (id: string) => pairs.find((p) => p.id === id)

  async function doRemove(d: DraftDto) {
    await api().deleteDraft(d.id)
    setRemove(null)
    load()
  }

  return (
    <div className="page">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">Entwürfe</h1>
          <p className="page-subtitle">Order-Gruppen zwischenspeichern, für Szenarien zurückhalten und erst nach deiner Freigabe an {exName()} senden.</p>
        </div>
        <button type="button" className="btn btn-secondary ml-auto" onClick={load}><RefreshCw size={16} /> Kurse aktualisieren</button>
      </header>

      {error && <p className="notice notice-danger mb-4">{error}</p>}
      {notice && <p className="notice notice-success mb-4">{notice}</p>}

      <div className="space-y-4" data-guide="drafts">
        {open.length === 0 && (
          <SectionCard title="Noch keine Entwürfe">
            <div className="space-y-2 text-sm text-ink-muted">
              <p>Plane im <strong className="text-ink">Planer</strong> eine Staffel und klicke oben auf <strong className="text-ink">Als Entwurf</strong>. Sie wird dann hier gespeichert, ohne dass etwas an {exName()} geht. Ein Entwurf sperrt auch kein Guthaben. Erst beim Freigeben muss der volle Betrag auf deinem {exName()}-Konto bereitliegen.</p>
              <p>Mit einem <strong className="text-ink">Szenario</strong> wie „Crash“ oder „Bullrun“ hältst du passende Gruppen zusammen und gibst sie frei, wenn es so weit ist.</p>
            </div>
          </SectionCard>
        )}

        {groups.map(([scenario, list]) => (
          <SectionCard key={scenario || '-'} title={<span className="flex items-center gap-2"><ClipboardList size={16} className="text-accent-fg" /> {scenario || 'Ohne Szenario'} <span className="font-normal text-ink-muted">· {list.length}</span></span>}>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Entwurf</th><th>Paar</th><th className="num">Stufen</th><th className="num">Preisbereich</th><th className="num">Gegenwert</th><th className="num">Kurs jetzt</th><th className="sticky right-0 bg-surface" /></tr></thead>
                <tbody>
                  {list.map((d) => {
                    const pair = pairOf(d.pairId)
                    const last = prices[d.pairId]
                    const ev = evaluate(d, pair, last)
                    const first = ev?.toSend[0]?.price ?? d.input.priceStart
                    const lastLevel = ev?.toSend[ev.toSend.length - 1]?.price ?? d.input.priceEnd
                    const dec = pair?.priceDecimals ?? 2
                    return (
                      <tr key={d.id}>
                        <td className="min-w-[10rem] max-w-[18rem] [overflow-wrap:anywhere]">
                          <span className="font-medium text-ink">{d.name}</span>
                          {d.note && <span className="block text-xs text-ink-muted">{d.note}</span>}
                          {d.alarmFiredAt
                            ? <span className="mt-1 block"><Badge tone="accent"><BellRing size={12} className="mr-1 inline" />Kursalarm ausgelöst {new Date(d.alarmFiredAt).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })}</Badge></span>
                            : d.alarm && <span className="mt-1 flex items-center gap-1 text-xs text-ink-muted"><Bell size={12} /> Alarm bei {fmtPrice(first, dec)} {sym}</span>}
                          {ev && ev.wrong.length > 0 && <span className="mt-1 block"><Badge tone="danger">{ev.wrong.length} Stufen auf falscher Kursseite</Badge></span>}
                          {ev && !ev.ladder.valid && <span className="mt-1 block"><Badge tone="warning">Passt nicht mehr zu den Regeln von {exName()}</Badge></span>}
                        </td>
                        <td className="whitespace-nowrap">{d.pairName} <span className="text-ink-muted">{d.side === 'buy' ? 'Kauf' : 'Verkauf'}</span></td>
                        <td className="num">{ev ? (ev.count < ev.sendable.length ? `${ev.count} von ${ev.sendable.length}` : ev.count) : d.input.steps}</td>
                        <td className="num whitespace-nowrap">{fmtPrice(first, dec)} – {fmtPrice(lastLevel, dec)}</td>
                        <td className="num">{d.side === 'buy' ? eur(ev?.cost ?? d.input.total) : <>{num(ev?.volume ?? d.input.total, pair?.volumeDecimals)} {d.pairName.split('/')[0]} <span className="text-ink-muted">≈ {eur(ev?.cost ?? 0)}</span></>}</td>
                        <td className="num whitespace-nowrap">
                          {last ? <>{fmtPrice(last, dec)} {sym}<span className="block text-xs text-ink-muted">erste Stufe {pct(first / last - 1)}</span></> : '–'}
                        </td>
                        {/* Knöpfe bleiben rechts sichtbar, auch wenn die Tabelle im schmalen Fenster seitlich scrollt */}
                        <td className="sticky right-0 bg-surface text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                          <span className="inline-flex gap-1.5">
                            <button type="button" className="btn btn-primary btn-sm whitespace-nowrap" onClick={() => { setNotice(null); setRelease(d) }}><Rocket size={14} /> Freigeben</button>
                            <button type="button" className="btn btn-ghost btn-icon" aria-label="Im Planer bearbeiten" title="Im Planer bearbeiten" onClick={() => onEdit(d)}><Pencil size={15} /></button>
                            <button type="button" className="btn btn-ghost btn-icon" aria-label="Entwurf löschen" title="Entwurf löschen" onClick={() => setRemove(d)}><Trash2 size={15} /></button>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        ))}

        {released.length > 0 && (
          <SectionCard title="Freigegeben">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Entwurf</th><th>Szenario</th><th>Paar</th><th>Freigegeben</th><th className="num">Plan-Nummer</th><th /></tr></thead>
                <tbody>
                  {released.map((d) => (
                    <tr key={d.id}>
                      <td>{d.name}</td>
                      <td className="text-ink-muted">{d.scenario || '–'}</td>
                      <td className="whitespace-nowrap">{d.pairName} <span className="text-ink-muted">{d.side === 'buy' ? 'Kauf' : 'Verkauf'}</span></td>
                      <td className="whitespace-nowrap tabular-nums">{d.releasedAt ? new Date(d.releasedAt).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '–'}</td>
                      <td className="num">{d.userref ?? '–'}</td>
                      <td className="text-right"><button type="button" className="btn-mini" aria-label="Aus der Liste löschen" title="Aus der Liste löschen" onClick={() => setRemove(d)}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-muted">Freigegebene Pläne verfolgst du unter „Offene Orders“.</p>
          </SectionCard>
        )}
      </div>

      {release && (
        <ReleaseModal draft={release} pair={pairOf(release.pairId)} last={prices[release.pairId]} hasKey={hasKey} onNeedKey={onNeedKey}
          onClose={(sent) => {
            setRelease(null)
            if (sent) {
              setNotice(`„${release.name}“ wurde freigegeben und an ${exName()} gesendet (Plan-Nummer ${sent.userref}).`)
              load()
            }
          }} />
      )}

      {remove && (
        <Modal title="Entwurf löschen?" size="sm" onClose={() => setRemove(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setRemove(null)}>Abbrechen</button>
            <button type="button" className="btn btn-danger" onClick={() => doRemove(remove)}>Löschen</button>
          </>}>
          <p className="text-sm">„{remove.name}“ wird aus der App gelöscht. {remove.status === 'released' ? `Die Orders bei ${exName()} bleiben davon unberührt.` : `Bei ${exName()} ändert sich nichts.`}</p>
        </Modal>
      )}
    </div>
  )
}

function ReleaseModal({ draft, pair, last, hasKey, onNeedKey, onClose }: {
  draft: DraftDto
  pair: PairDto | undefined
  last: number | undefined
  hasKey: boolean
  onNeedKey: () => void
  onClose: (sent: SendResult | null) => void
}): JSX.Element {
  const { eur, fmtPrice, sym } = useMoney()
  const [busy, setBusy] = useState<'validate' | 'send' | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [available, setAvailable] = useState<Record<string, number> | null>(null)
  const ev = evaluate(draft, pair, last)

  useEffect(() => {
    if (hasKey) api().available().then(setAvailable).catch(() => setAvailable(null))
  }, [hasKey])

  const needAsset = pair ? (draft.side === 'buy' ? pair.quote : pair.base) : ''
  const need = ev ? (draft.side === 'buy' ? ev.cost : ev.volume) : 0
  const have = available && needAsset ? available[needAsset] ?? 0 : null
  const shortfall = have !== null && need > 0 && have + 1e-12 < need
  const moved = last && draft.priceAtSave ? last / draft.priceAtSave - 1 : null
  const dec = pair?.priceDecimals ?? 2
  const sentOk = result && !result.validate && result.orders.some((o) => o.txid || o.uncertain)

  async function run(validate: boolean) {
    if (!pair || !ev) return
    setBusy(validate ? 'validate' : 'send')
    setErr(null)
    setResult(null)
    try {
      setResult(await api().send({
        pairId: pair.id, pairName: pair.name, side: draft.side, input: draft.input, levels: ev.ladder.levels, validate, postOnly: draft.postOnly,
        sendCount: ev.count < ev.sendable.length ? ev.count : undefined, draftId: draft.id,
      }))
    } catch (e) {
      setErr((e as Error).message)
    }
    setBusy(null)
  }

  const failed = result?.orders.filter((o) => o.error) ?? []
  const ok = (result?.orders.length ?? 0) - failed.length
  const blocked = !hasKey || !ev || !ev.ladder.valid || shortfall || !!busy

  return (
    <Modal title="Entwurf freigeben?" size="md" onClose={() => !busy && onClose(sentOk ? result : null)}
      footer={sentOk ? (
        <button type="button" className="btn btn-primary" onClick={() => onClose(result)}>Fertig</button>
      ) : <>
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => onClose(null)}>Abbrechen</button>
        <button type="button" className="btn btn-secondary" disabled={blocked} onClick={() => run(true)}><FlaskConical size={16} /> {busy === 'validate' ? 'Prüfe …' : 'Probelauf'}</button>
        <button type="button" className="btn btn-primary" disabled={blocked} onClick={() => run(false)}><Rocket size={16} /> {busy === 'send' ? 'Sende …' : `Freigeben und ${ev?.count ?? 0} Orders senden`}</button>
      </>}>
      <div className="space-y-2 text-sm">
        <p><strong>{draft.name}</strong>{draft.scenario && <span className="text-ink-muted"> · {draft.scenario}</span>}</p>
        {draft.note && <p className="text-ink-muted">{draft.note}</p>}
        {!pair && <p className="notice notice-danger">Das Handelspaar {draft.pairName} gibt es bei {exName()} gerade nicht.</p>}
        {ev && (
          <>
            <p>
              <strong>{draft.side === 'buy' ? 'Kaufen' : 'Verkaufen'}</strong> {draft.pairName} in {ev.count} Stufen von {fmtPrice(ev.toSend[0]?.price ?? 0, dec)} bis {fmtPrice(ev.toSend[ev.toSend.length - 1]?.price ?? 0, dec)} {sym}.
              {ev.count < ev.sendable.length && ` Die übrigen ${ev.sendable.length - ev.count} Stufen kannst du später unter „Offene Orders“ nachschicken.`}
            </p>
            <p>Gegenwert: <strong>{eur(ev.cost)}</strong> plus Gebühren. {draft.postOnly ? 'Nur als Limit-Order ins Orderbuch (Post-only).' : ''}</p>
            {last && <p className="text-ink-muted">Kurs jetzt {fmtPrice(last, dec)} {sym}{moved !== null && `, seit dem Speichern ${pct(moved)}`}.</p>}
            {moved !== null && Math.abs(moved) > 0.1 && <p className="notice notice-warning">Der Kurs hat sich seit dem Speichern um {pct(Math.abs(moved))} bewegt. Prüfe, ob die Stufen noch passen.</p>}
            {ev.wrong.length > 0 && (
              <p className="notice notice-danger flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{ev.wrong.length} {ev.wrong.length === 1 ? 'Stufe liegt' : 'Stufen liegen'} auf der falschen Seite des Kurses und {draft.postOnly ? 'würden sofort wieder storniert' : 'würden sofort zum Marktpreis ausgeführt'}. Bearbeite den Entwurf am besten vorher.</span>
              </p>
            )}
            {ev.ladder.errors.length > 0 && <div className="notice notice-warning space-y-1">{ev.ladder.errors.map((e) => <p key={e}>{e}</p>)}</div>}
            {shortfall && <p className="notice notice-danger">Nicht genug verfügbares Guthaben: nötig {draft.side === 'buy' ? eur(need) : `${num(need, pair?.volumeDecimals)} ${draft.pairName.split('/')[0]}`}, verfügbar {draft.side === 'buy' ? eur(have ?? 0) : num(have ?? 0, pair?.volumeDecimals)}.</p>}
          </>
        )}
        {!hasKey && <p className="notice notice-info">Zum Freigeben brauchst du einen {exName()}-API-Schlüssel. <button type="button" className="btn-link" onClick={onNeedKey}>Schlüssel anlegen</button></p>}
        {err && <p className="notice notice-danger">{err}</p>}
        {result && (
          <div className={`notice ${failed.length ? 'notice-warning' : 'notice-success'}`}>
            {result.validate
              ? failed.length ? `Probelauf: ${failed.length} Orders würden abgelehnt. Grund: ${failed[0].error}` : probeOk(ok)
              : `${ok} Orders angelegt${failed.length ? `, ${failed.length} fehlgeschlagen (${failed[0].error})` : ''}. Plan-Nummer ${result.userref}.`}
            {result.orders.some((o) => o.uncertain) && <p className="mt-1 text-xs font-medium">Die Verbindung brach ab. Schau unter „Offene Orders“ nach, was wirklich angelegt wurde.</p>}
          </div>
        )}
        {!result && !err && <p className="text-xs text-ink-muted">Erst der Knopf „Freigeben und senden“ legt die Orders echt bei {exName()} an. Ab dann sperrt {exName()} den vollen Betrag auf deinem Konto, bis die Orders ausgeführt oder storniert sind. Der Probelauf prüft nur.</p>}
      </div>
    </Modal>
  )
}
