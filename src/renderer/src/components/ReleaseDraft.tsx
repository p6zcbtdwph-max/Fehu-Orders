// Entwurf senden: Fenster mit Prüfung gegen die aktuellen Regeln und den Kurs (aus dem früheren Reiter „Entwürfe“)
import { api } from '../api'
import { useEffect, useState } from 'react'
import { AlertTriangle, FlaskConical, Rocket } from 'lucide-react'
import { buildLadder } from '@shared/ladder'
import { RaisedNotice } from './MinOrder'
import type { DraftDto, PairDto, SendResult } from '@shared/ipc'
import { wrongSide } from '@shared/safety'
import Modal from './ui/Modal'
import { SendSummary } from './SendSuccess'
import { num, pct } from '../format'
import { tr } from '@shared/i18n'
import { useMoney } from '../money'
import { activeExchange, exName, probeOk } from '@shared/exchanges'
import TradeKeyGate, { canTest, useTradeKey } from './TradeKeyGate'

/** Was ein Entwurf jetzt bedeuten würde: Stufen nach den aktuellen Regeln des Paars */
export function evaluate(d: DraftDto, pair: PairDto | undefined, last: number | undefined, minCost: number) {
  if (!pair) return null
  // Gleiche Rechnung wie im Planer, also auch mit Mindest-Orderwert (zu kleine Stufen werden angehoben)
  const ladder = buildLadder(d.input, pair, { minCost })
  const sendable = ladder.levels.filter((l) => !l.problem)
  const count = d.sendCount ? Math.min(d.sendCount, sendable.length) : sendable.length
  const toSend = sendable.slice(0, count)
  const cost = toSend.reduce((a, l) => a + l.cost, 0)
  const volume = toSend.reduce((a, l) => a + l.volume, 0)
  const wrong = wrongSide(d.side, toSend.map((l) => l.price), last)
  return { ladder, sendable, count, toSend, cost, volume, wrong }
}

export function ReleaseModal({ draft, pair, last, minOrder, hasKey, onNeedKey, onClose }: {
  minOrder: number
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
  const ev = evaluate(draft, pair, last, minOrder)

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
  const tk = useTradeKey(activeExchange())
  const blocked = !hasKey || !ev || !ev.ladder.valid || shortfall || !!busy

  return (
    <Modal title={tr('Entwurf senden?', 'Send draft?')} size="md" onClose={() => !busy && onClose(sentOk ? result : null)}
      footer={sentOk ? (
        <button type="button" className="btn btn-primary" onClick={() => onClose(result)}>{tr('Fertig', 'Done')}</button>
      ) : <>
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => onClose(null)}>{tr('Abbrechen', 'Cancel')}</button>
        <button type="button" className="btn btn-secondary" disabled={blocked || !canTest(tk, activeExchange())} onClick={() => run(true)}><FlaskConical size={16} /> {busy === 'validate' ? tr('Prüfe …', 'Checking …') : tr('Testen', 'Test')}</button>
        <button type="button" className="btn btn-primary" disabled={blocked || tk.has === false} onClick={() => run(false)}><Rocket size={16} /> {busy === 'send' ? tr('Sende …', 'Sending …') : tr(`${ev?.count ?? 0} Orders senden`, `Send ${ev?.count ?? 0} orders`)}</button>
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
              {ev.count < ev.sendable.length && tr(` Die übrigen ${ev.sendable.length - ev.count} Stufen kannst du später unter „Meine Pläne“ nachschicken.`, ` You can send the other ${ev.sendable.length - ev.count} levels later under “My plans”.`)}
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
            {pair && <RaisedNotice ladder={ev.ladder} input={draft.input} rules={pair} userMin={minOrder} base={draft.pairName.split('/')[0]} eur={eur} />}
            {ev.ladder.errors.length > 0 && <div className="notice notice-warning space-y-1">{ev.ladder.errors.map((e) => <p key={e}>{e}</p>)}</div>}
            {shortfall && <p className="notice notice-danger">{tr('Nicht genug verfügbares Guthaben: nötig', 'Not enough available balance: needed')} {draft.side === 'buy' ? eur(need) : `${num(need, pair?.volumeDecimals)} ${draft.pairName.split('/')[0]}`}, {tr('verfügbar', 'available')} {draft.side === 'buy' ? eur(have ?? 0) : num(have ?? 0, pair?.volumeDecimals)}.</p>}
          </>
        )}
        {hasKey && <TradeKeyGate exchange={activeExchange()} state={tk} />}
        {!hasKey && <p className="notice notice-info">{tr(`Zum Senden brauchst du einen ${exName()}-API-Schlüssel.`, `To release you need a ${exName()} API key.`)} <button type="button" className="btn-link" onClick={onNeedKey}>{tr('Schlüssel anlegen', 'Create key')}</button></p>}
        {err && <p className="notice notice-danger">{err}</p>}
        {result && (
          <div className={`notice ${failed.length ? 'notice-warning' : 'notice-success'}`}>
            {result.validate
              ? failed.length ? tr(`Test: ${failed.length} Orders würden abgelehnt. Grund: ${failed[0].error}`, `Test run: ${failed.length} orders would be rejected. Reason: ${failed[0].error}`) : probeOk(ok)
              : tr(`${ok} Orders angelegt${failed.length ? `, ${failed.length} fehlgeschlagen (${failed[0].error})` : ''}. Plan-Nummer ${result.userref}.`, `${ok} orders placed${failed.length ? `, ${failed.length} failed (${failed[0].error})` : ''}. Plan number ${result.userref}.`)}
            {result.orders.some((o) => o.uncertain) && <p className="mt-1 text-xs font-medium">{tr('Die Verbindung brach ab. Schau unter „Meine Pläne“ nach, was wirklich angelegt wurde.', 'The connection dropped. Check under “My plans” what was really placed.')}</p>}
          </div>
        )}
        {!result && !err && <p className="text-xs text-ink-muted">{tr(`Erst der Knopf „Orders senden“ legt die Orders echt bei ${exName()} an. Ab dann sperrt ${exName()} den vollen Betrag auf deinem Konto, bis die Orders ausgeführt oder storniert sind. Der Test prüft nur.`, `Only the “Send orders” button really places the orders at ${exName()}. From then on ${exName()} locks the full amount in your account until the orders are filled or cancelled. The test run only checks.`)}</p>}
      </div>
      )}
    </Modal>
  )
}
