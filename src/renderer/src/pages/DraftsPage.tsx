import { api } from '../api'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bell, BellRing, ClipboardList, FlaskConical, Pencil, RefreshCw, Rocket, Trash2 } from 'lucide-react'
import { buildLadder } from '@shared/ladder'
import type { DraftDto, PairDto, SendResult } from '@shared/ipc'
import { wrongSide } from '@shared/safety'
import SectionCard from '../components/ui/SectionCard'
import Modal from '../components/ui/Modal'
import { SendSummary } from '../components/SendSuccess'
import Badge from '../components/ui/Badge'
import { dateLocale, num, pct } from '../format'
import { tr } from '@shared/i18n'
import { useMoney } from '../money'
import { activeExchange, exName, probeOk } from '@shared/exchanges'

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
          <h1 className="page-title">{tr('Entwürfe', 'Drafts')}</h1>
          <p className="page-subtitle">{tr(`Order-Gruppen zwischenspeichern, für Szenarien zurückhalten und erst nach deiner Freigabe an ${exName()} senden.`, `Save groups of orders, hold them back for scenarios and send them to ${exName()} only after you release them.`)}</p>
        </div>
        <button type="button" className="btn btn-secondary ml-auto" onClick={load}><RefreshCw size={16} /> {tr('Kurse aktualisieren', 'Refresh prices')}</button>
      </header>

      {error && <p className="notice notice-danger mb-4">{error}</p>}
      {notice && <p className="notice notice-success mb-4">{notice}</p>}

      <div className="space-y-4" data-guide="drafts">
        {open.length === 0 && (
          <SectionCard title={tr('Noch keine Entwürfe', 'No drafts yet')}>
            <div className="space-y-2 text-sm text-ink-muted">
              {tr(
                <>
                  <p>Plane im <strong className="text-ink">Planer</strong> eine Staffel und klicke oben auf <strong className="text-ink">Als Entwurf</strong>. Sie wird dann hier gespeichert, ohne dass etwas an {exName()} geht. Ein Entwurf sperrt auch kein Guthaben. Erst beim Freigeben muss der volle Betrag auf deinem {exName()}-Konto bereitliegen.</p>
                  <p>Mit einem <strong className="text-ink">Szenario</strong> wie „Crash“ oder „Bullrun“ hältst du passende Gruppen zusammen und gibst sie frei, wenn es so weit ist.</p>
                </>,
                <>
                  <p>Plan a ladder in the <strong className="text-ink">Planner</strong> and click <strong className="text-ink">Save as draft</strong> at the top. It is then stored here without anything going to {exName()}. A draft locks no funds either. Only when you release it does the full amount have to be in your {exName()} account.</p>
                  <p>With a <strong className="text-ink">scenario</strong> such as “Crash” or “Bull run” you keep matching groups together and release them when the time comes.</p>
                </>,
              )}
            </div>
          </SectionCard>
        )}

        {groups.map(([scenario, list]) => (
          <SectionCard key={scenario || '-'} title={<span className="flex items-center gap-2"><ClipboardList size={16} className="text-accent-fg" /> {scenario || tr('Ohne Szenario', 'No scenario')} <span className="font-normal text-ink-muted">· {list.length}</span></span>}>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{tr('Entwurf', 'Draft')}</th><th>{tr('Paar', 'Pair')}</th><th className="num">{tr('Stufen', 'Levels')}</th><th className="num">{tr('Preisbereich', 'Price range')}</th><th className="num">{tr('Gegenwert', 'Value')}</th><th className="num">{tr('Kurs jetzt', 'Price now')}</th><th className="sticky right-0 bg-surface" /></tr></thead>
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
                            ? <span className="mt-1 block"><Badge tone="accent"><BellRing size={12} className="mr-1 inline" />{tr('Kursalarm ausgelöst', 'Price alert triggered')} {new Date(d.alarmFiredAt).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })}</Badge></span>
                            : d.alarm && <span className="mt-1 flex items-center gap-1 text-xs text-ink-muted"><Bell size={12} /> {tr('Alarm bei', 'Alert at')} {fmtPrice(first, dec)} {sym}</span>}
                          {ev && ev.wrong.length > 0 && <span className="mt-1 block"><Badge tone="danger">{tr(`${ev.wrong.length} Stufen auf falscher Kursseite`, `${ev.wrong.length} levels on the wrong side of the price`)}</Badge></span>}
                          {ev && !ev.ladder.valid && <span className="mt-1 block"><Badge tone="warning">{tr(`Passt nicht mehr zu ${exName()}s Regeln`, `No longer fits ${exName()}’s rules`)}</Badge></span>}
                        </td>
                        <td className="whitespace-nowrap">{d.pairName} <span className="text-ink-muted">{d.side === 'buy' ? tr('Kauf', 'buy') : tr('Verkauf', 'sell')}</span></td>
                        <td className="num">{ev ? (ev.count < ev.sendable.length ? tr(`${ev.count} von ${ev.sendable.length}`, `${ev.count} of ${ev.sendable.length}`) : ev.count) : d.input.steps}</td>
                        <td className="num whitespace-nowrap">{fmtPrice(first, dec)} – {fmtPrice(lastLevel, dec)}</td>
                        <td className="num">{d.side === 'buy' ? eur(ev?.cost ?? d.input.total) : <>{num(ev?.volume ?? d.input.total, pair?.volumeDecimals)} {d.pairName.split('/')[0]} <span className="text-ink-muted">≈ {eur(ev?.cost ?? 0)}</span></>}</td>
                        <td className="num whitespace-nowrap">
                          {last ? <>{fmtPrice(last, dec)} {sym}<span className="block text-xs text-ink-muted">{tr('erste Stufe', 'first level')} {pct(first / last - 1)}</span></> : '–'}
                        </td>
                        {/* Knöpfe bleiben rechts sichtbar, auch wenn die Tabelle im schmalen Fenster seitlich scrollt */}
                        <td className="sticky right-0 bg-surface text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                          <span className="inline-flex gap-1.5">
                            <button type="button" className="btn btn-primary btn-sm whitespace-nowrap" onClick={() => { setNotice(null); setRelease(d) }}><Rocket size={14} /> {tr('Freigeben', 'Release')}</button>
                            <button type="button" className="btn btn-ghost btn-icon" aria-label={tr('Im Planer bearbeiten', 'Edit in planner')} title={tr('Im Planer bearbeiten', 'Edit in planner')} onClick={() => onEdit(d)}><Pencil size={15} /></button>
                            <button type="button" className="btn btn-ghost btn-icon" aria-label={tr('Entwurf löschen', 'Delete draft')} title={tr('Entwurf löschen', 'Delete draft')} onClick={() => setRemove(d)}><Trash2 size={15} /></button>
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
          <SectionCard title={tr('Freigegeben', 'Released')}>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{tr('Entwurf', 'Draft')}</th><th>{tr('Szenario', 'Scenario')}</th><th>{tr('Paar', 'Pair')}</th><th>{tr('Freigegeben', 'Released')}</th><th className="num">{tr('Plan-Nummer', 'Plan number')}</th><th /></tr></thead>
                <tbody>
                  {released.map((d) => (
                    <tr key={d.id}>
                      <td>{d.name}</td>
                      <td className="text-ink-muted">{d.scenario || '–'}</td>
                      <td className="whitespace-nowrap">{d.pairName} <span className="text-ink-muted">{d.side === 'buy' ? tr('Kauf', 'buy') : tr('Verkauf', 'sell')}</span></td>
                      <td className="whitespace-nowrap tabular-nums">{d.releasedAt ? new Date(d.releasedAt).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '–'}</td>
                      <td className="num">{d.userref ?? '–'}</td>
                      <td className="text-right"><button type="button" className="btn-mini" aria-label={tr('Aus der Liste löschen', 'Remove from list')} title={tr('Aus der Liste löschen', 'Remove from list')} onClick={() => setRemove(d)}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-muted">{tr('Freigegebene Pläne verfolgst du unter „Offene Orders“.', 'Track released plans under “Open orders”.')}</p>
          </SectionCard>
        )}
      </div>

      {release && (
        <ReleaseModal draft={release} pair={pairOf(release.pairId)} last={prices[release.pairId]} hasKey={hasKey} onNeedKey={onNeedKey}
          onClose={(sent) => {
            setRelease(null)
            if (sent) {
              setNotice(tr(`„${release.name}“ wurde freigegeben und an ${exName()} gesendet (Plan-Nummer ${sent.userref}).`, `“${release.name}” was released and sent to ${exName()} (plan number ${sent.userref}).`))
              load()
            }
          }} />
      )}

      {remove && (
        <Modal title={tr('Entwurf löschen?', 'Delete draft?')} size="sm" onClose={() => setRemove(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setRemove(null)}>{tr('Abbrechen', 'Cancel')}</button>
            <button type="button" className="btn btn-danger" onClick={() => doRemove(remove)}>{tr('Löschen', 'Delete')}</button>
          </>}>
          <p className="text-sm">{tr(
            `„${remove.name}“ wird aus der App gelöscht. ${remove.status === 'released' ? `Die Orders bei ${exName()} bleiben davon unberührt.` : `Bei ${exName()} ändert sich nichts.`}`,
            `“${remove.name}” will be deleted from the app. ${remove.status === 'released' ? `The orders at ${exName()} are not affected.` : `Nothing changes at ${exName()}.`}`,
          )}</p>
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
        sendCount: ev.count < ev.sendable.length ? ev.count : undefined, draftId: draft.id, exchange: activeExchange(),
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
    <Modal title={tr('Entwurf freigeben?', 'Release draft?')} size="md" onClose={() => !busy && onClose(sentOk ? result : null)}
      footer={sentOk ? (
        <button type="button" className="btn btn-primary" onClick={() => onClose(result)}>{tr('Fertig', 'Done')}</button>
      ) : <>
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => onClose(null)}>{tr('Abbrechen', 'Cancel')}</button>
        <button type="button" className="btn btn-secondary" disabled={blocked} onClick={() => run(true)}><FlaskConical size={16} /> {busy === 'validate' ? tr('Prüfe …', 'Checking …') : tr('Probelauf', 'Test run')}</button>
        <button type="button" className="btn btn-primary" disabled={blocked} onClick={() => run(false)}><Rocket size={16} /> {busy === 'send' ? tr('Sende …', 'Sending …') : tr(`Freigeben und ${ev?.count ?? 0} Orders senden`, `Release and send ${ev?.count ?? 0} orders`)}</button>
      </>}>
      {sentOk && result ? <SendSummary result={result} pairName={draft.pairName} side={draft.side} priceDecimals={dec} /> : (
      <div className="space-y-2 text-sm">
        <p><strong>{draft.name}</strong>{draft.scenario && <span className="text-ink-muted"> · {draft.scenario}</span>}</p>
        {draft.note && <p className="text-ink-muted">{draft.note}</p>}
        {!pair && <p className="notice notice-danger">{tr(`Das Handelspaar ${draft.pairName} gibt es bei ${exName()} gerade nicht.`, `The trading pair ${draft.pairName} is currently not available at ${exName()}.`)}</p>}
        {ev && (
          <>
            <p>
              <strong>{draft.side === 'buy' ? tr('Kaufen', 'Buy') : tr('Verkaufen', 'Sell')}</strong> {draft.pairName} {tr(`in ${ev.count} Stufen von`, `in ${ev.count} levels from`)} {fmtPrice(ev.toSend[0]?.price ?? 0, dec)} {tr('bis', 'to')} {fmtPrice(ev.toSend[ev.toSend.length - 1]?.price ?? 0, dec)} {sym}.
              {ev.count < ev.sendable.length && tr(` Die übrigen ${ev.sendable.length - ev.count} Stufen kannst du später unter „Offene Orders“ nachschicken.`, ` You can send the other ${ev.sendable.length - ev.count} levels later under “Open orders”.`)}
            </p>
            <p>{tr('Gegenwert', 'Value')}: <strong>{eur(ev.cost)}</strong> {tr('plus Gebühren.', 'plus fees.')} {draft.postOnly ? tr('Nur als Limit-Order ins Orderbuch (Post-only).', 'Only as limit order into the order book (post-only).') : ''}</p>
            {last && <p className="text-ink-muted">{tr('Kurs jetzt', 'Price now')} {fmtPrice(last, dec)} {sym}{moved !== null && tr(`, seit dem Speichern ${pct(moved)}`, `, ${pct(moved)} since saving`)}.</p>}
            {moved !== null && Math.abs(moved) > 0.1 && <p className="notice notice-warning">{tr(`Der Kurs hat sich seit dem Speichern um ${pct(Math.abs(moved))} bewegt. Prüfe, ob die Stufen noch passen.`, `The price has moved ${pct(Math.abs(moved))} since saving. Check whether the levels still fit.`)}</p>}
            {ev.wrong.length > 0 && (
              <p className="notice notice-danger flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{tr(
                  `${ev.wrong.length} ${ev.wrong.length === 1 ? 'Stufe liegt' : 'Stufen liegen'} auf der falschen Seite des Kurses und ${draft.postOnly ? 'würden sofort wieder storniert' : 'würden sofort zum Marktpreis ausgeführt'}. Bearbeite den Entwurf am besten vorher.`,
                  `${ev.wrong.length} ${ev.wrong.length === 1 ? 'level is' : 'levels are'} on the wrong side of the price and ${draft.postOnly ? 'would be cancelled right away' : 'would be filled immediately at market price'}. Best edit the draft first.`,
                )}</span>
              </p>
            )}
            {ev.ladder.errors.length > 0 && <div className="notice notice-warning space-y-1">{ev.ladder.errors.map((e) => <p key={e}>{e}</p>)}</div>}
            {shortfall && <p className="notice notice-danger">{tr('Nicht genug verfügbares Guthaben: nötig', 'Not enough available balance: needed')} {draft.side === 'buy' ? eur(need) : `${num(need, pair?.volumeDecimals)} ${draft.pairName.split('/')[0]}`}, {tr('verfügbar', 'available')} {draft.side === 'buy' ? eur(have ?? 0) : num(have ?? 0, pair?.volumeDecimals)}.</p>}
          </>
        )}
        {!hasKey && <p className="notice notice-info">{tr(`Zum Freigeben brauchst du einen ${exName()}-API-Schlüssel.`, `To release you need a ${exName()} API key.`)} <button type="button" className="btn-link" onClick={onNeedKey}>{tr('Schlüssel anlegen', 'Create key')}</button></p>}
        {err && <p className="notice notice-danger">{err}</p>}
        {result && (
          <div className={`notice ${failed.length ? 'notice-warning' : 'notice-success'}`}>
            {result.validate
              ? failed.length ? tr(`Probelauf: ${failed.length} Orders würden abgelehnt. Grund: ${failed[0].error}`, `Test run: ${failed.length} orders would be rejected. Reason: ${failed[0].error}`) : probeOk(ok)
              : tr(`${ok} Orders angelegt${failed.length ? `, ${failed.length} fehlgeschlagen (${failed[0].error})` : ''}. Plan-Nummer ${result.userref}.`, `${ok} orders placed${failed.length ? `, ${failed.length} failed (${failed[0].error})` : ''}. Plan number ${result.userref}.`)}
            {result.orders.some((o) => o.uncertain) && <p className="mt-1 text-xs font-medium">{tr('Die Verbindung brach ab. Schau unter „Offene Orders“ nach, was wirklich angelegt wurde.', 'The connection dropped. Check under “Open orders” what was really placed.')}</p>}
          </div>
        )}
        {!result && !err && <p className="text-xs text-ink-muted">{tr(`Erst der Knopf „Freigeben und senden“ legt die Orders echt bei ${exName()} an. Ab dann sperrt ${exName()} den vollen Betrag auf deinem Konto, bis die Orders ausgeführt oder storniert sind. Der Probelauf prüft nur.`, `Only the “Release and send” button really places the orders at ${exName()}. From then on ${exName()} locks the full amount in your account until the orders are filled or cancelled. The test run only checks.`)}</p>}
      </div>
      )}
    </Modal>
  )
}
