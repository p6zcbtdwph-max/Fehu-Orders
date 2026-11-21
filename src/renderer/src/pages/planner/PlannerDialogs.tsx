// Fenster des Planers: Vorlage und Entwurf speichern, ersten echten Test vorbereiten, Senden bestätigen.
import { useState } from 'react'
import { Bell } from 'lucide-react'
import type { SendSplit } from '@shared/send-split'
import { tr } from '@shared/i18n'
import { exName, FIRST_TEST_MAX_EUR, probeHint } from '@shared/exchanges'
import type { LadderInput, LadderLevel } from '@shared/ladder'
import type { PairDto } from '@shared/ipc'
import { api } from '../../api'
import Modal from '../../components/ui/Modal'
import { num } from '../../format'
import { useMoney } from '../../money'

export function FirstTestDialog({ limit, setLimit, minOrder, hasKey, onNeedKey, onOpenOrders, onLoad, onClose }: {
  limit: number | null
  setLimit: (n: number) => void
  minOrder: number
  hasKey: boolean
  onNeedKey: () => void
  onOpenOrders?: () => void
  onLoad: () => void
  onClose: () => void
}): JSX.Element {
  const { eur } = useMoney()
  return (
    <Modal title={tr('Ersten echten Test vorbereiten', 'Prepare your first real test')} size="md" onClose={() => onClose()}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={() => onClose()}>{tr('Abbrechen', 'Cancel')}</button>
        <button type="button" className="btn btn-primary" onClick={onLoad}>{tr('Mini-Plan laden', 'Load mini plan')}</button>
      </>}>
      <div className="space-y-3 text-sm">
        <p className="notice notice-warning">{tr(
          <><strong>Beim ersten Test kannst du höchstens 50 € pro Sendung senden.</strong> Das ist eine Sicherheitsgrenze, kein Fehler. Ist ein Plan größer, schickt die App nichts ab und sagt dir Bescheid. Später hebst du die Grenze unter Einstellungen › Sicherheit an.</>,
          <><strong>For your first test you can send at most 50 € per send.</strong> This is a safety limit, not a bug. If a plan is bigger, the app sends nothing and tells you so. Later you can raise the limit under Settings › Safety.</>,
        )}</p>
        <p>{tr('So testest du Senden, Anzeige und Stornieren mit echtem Geld, aber praktisch ohne Risiko:', 'This is how you test sending, display and cancelling with real money but practically without risk:')}</p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            <strong>{tr('Obergrenze klein halten.', 'Keep the limit small.')}</strong>{' '}
            {limit !== null && limit > 50
              ? <>{tr('Sie steht bei', 'It is set to')} {eur(limit)}. <button type="button" className="btn-link" onClick={() => api().saveSettings({ maxPlanEur: 50 }).then((s) => setLimit(s.maxPlanEur))}>{tr('Auf 50 € senken', 'Lower to 50 €')}</button></>
              : limit !== null ? <>{tr('Sie steht bei', 'It is set to')} {eur(limit)}. {tr('Passt.', 'Fine.')}</> : null}
          </li>
          {tr(
            <>
              <li><strong>Mini-Plan laden:</strong> BTC/EUR kaufen, 2 Stufen etwa 20 % unter dem Kurs, knapp über deinem Mindest-Orderwert ({eur(minOrder)}) und dem Mindestbetrag von {exName()}. So tief wird der Kurs kaum fallen, die Orders bleiben also nur liegen.</li>
              <li><strong>Probelauf</strong> klicken. {probeHint()}.</li>
              <li><strong>An {exName()} senden</strong> und bestätigen.</li>
              <li>Unter <strong>Meine Pläne</strong> nachsehen, ob beide Orders da sind, und den Plan <strong>stornieren</strong>.</li>
              <li>Im <strong>Verlauf</strong> siehst du danach jeden Schritt mit Uhrzeit.</li>
            </>,
            <>
              <li><strong>Load mini plan:</strong> buy BTC/EUR, 2 levels about 20 % below the price, just above your minimum order value ({eur(minOrder)}) and {exName()}’s minimum. The price will hardly fall that far, so the orders just sit there.</li>
              <li>Click <strong>Test run</strong>. {probeHint()}.</li>
              <li><strong>Send to {exName()}</strong> and confirm.</li>
              <li>Check under <strong>My plans</strong> that both orders are there, and <strong>cancel</strong> the plan.</li>
              <li>Afterwards <strong>History</strong> shows every step with its time.</li>
            </>,
          )}
        </ol>
        {minOrder * 1.02 > FIRST_TEST_MAX_EUR && <p className="notice notice-danger">{tr(
          `Dein Mindest-Orderwert steht bei ${eur(minOrder)}. Schon eine einzige Order wäre damit größer als die 50-€-Grenze beim ersten Test, die App würde nichts senden. Senke ihn für den Test in den Einstellungen, zum Beispiel auf 10 €.`,
          `Your minimum order value is ${eur(minOrder)}. Even a single order would then be larger than the 50 € first-test limit, so the app would send nothing. Lower it in Settings for the test, for example to 10 €.`,
        )}</p>}
        {!hasKey && <p className="notice notice-info">{tr('Für Schritt 3 bis 5 brauchst du einen Schlüssel.', 'For steps 3 to 5 you need a key.')} <button type="button" className="btn-link" onClick={() => { onClose(); onNeedKey() }}>{tr('Schlüssel anlegen', 'Create key')}</button></p>}
        {onOpenOrders && <p className="text-xs text-ink-muted">{tr(<>Geht etwas schief, stoppt die <strong>Notbremse</strong> oben rechts alle offenen Orders auf einmal.</>, <>If something goes wrong, the <strong>emergency stop</strong> at the top right stops all open orders at once.</>)}</p>}
      </div>
    </Modal>
  )
}

export function ConfirmSendDialog({ input, pair, last, busy, limit, overLimit, toSend, nowCount, nowCost, feeEur, wrong, held, heldLevels, armedLevels, partial, postOnly, onSend, onClose }: {
  input: LadderInput
  pair: PairDto
  last: number | null
  busy: 'validate' | 'send' | null
  limit: number | null
  overLimit: boolean
  toSend: LadderLevel[]
  nowCount: number
  nowCost: number
  feeEur: number | null
  /** Preise auf der falschen Kursseite */
  wrong: number[]
  held: Set<number>
  heldLevels: LadderLevel[]
  armedLevels: LadderLevel[]
  partial: boolean
  postOnly: boolean
  onSend: () => void
  onClose: () => void
}): JSX.Element {
  const { eur, fmtPrice, sym } = useMoney()
  const base = pair.name.split('/')[0] ?? ''
  return (
    <Modal title={tr('Orders wirklich senden?', 'Really send the orders?')} size="sm" onClose={() => !busy && onClose()}
      footer={<>
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => onClose()}>{tr('Abbrechen', 'Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={!!busy || overLimit} onClick={() => onSend()}>{busy ? tr('Sende …', 'Sending …') : tr(`${nowCount} Orders senden`, `Send ${nowCount} orders`)}</button>
      </>}>
      <div className="space-y-2 text-sm">
        {overLimit && limit !== null && <p className="notice notice-warning">{tr(
          <><strong>Über deiner Obergrenze von {eur(limit)} pro Sendung.</strong> Zur Sicherheit wird so nichts gesendet. Am Anfang steht sie auf 50 €, damit der erste Test klein bleibt. Ändern kannst du sie unter Einstellungen › Sicherheit.</>,
          <><strong>Above your limit of {eur(limit)} per send.</strong> For safety nothing is sent like this. It starts at 50 € so your first test stays small. You can change it under Settings › Safety.</>,
        )}</p>}
        <p>{tr(
          <><strong>{input.side === 'buy' ? 'Kaufen' : 'Verkaufen'}</strong> {pair.name} in {nowCount} Stufen von {fmtPrice(toSend[0]?.price ?? input.priceStart, pair.priceDecimals)} bis {fmtPrice(toSend[toSend.length - 1]?.price ?? input.priceEnd, pair.priceDecimals)} {sym}.</>,
          <><strong>{input.side === 'buy' ? 'Buy' : 'Sell'}</strong> {pair.name} in {nowCount} levels from {fmtPrice(toSend[0]?.price ?? input.priceStart, pair.priceDecimals)} to {fmtPrice(toSend[toSend.length - 1]?.price ?? input.priceEnd, pair.priceDecimals)} {sym}.</>,
        )}</p>
        <p>{tr('Gegenwert jetzt', 'Value now')}: <strong>{eur(nowCost)}</strong>{feeEur !== null && <> {tr(`plus ca. ${eur(feeEur)} Gebühren`, `plus approx. ${eur(feeEur)} fees`)}</>}</p>
        {wrong.length > 0 && <p className="notice notice-danger">{tr(
          `Achtung: ${wrong.length} ${wrong.length === 1 ? 'Stufe liegt' : 'Stufen liegen'} auf der falschen Seite des Kurses (${fmtPrice(last ?? 0, pair.priceDecimals)} ${sym}) und ${postOnly ? 'werden sofort wieder storniert' : 'würden sofort ausgeführt'}.`,
          `Warning: ${wrong.length} ${wrong.length === 1 ? 'level is' : 'levels are'} on the wrong side of the price (${fmtPrice(last ?? 0, pair.priceDecimals)} ${sym}) and ${postOnly ? 'will be cancelled right away' : 'would be filled immediately'}.`,
        )}</p>}
        {heldLevels.length > 0 && <p className="text-ink-muted">{tr(`Pausiert und nicht dabei: ${[...held].map((z) => `Zone ${z + 1}`).join(', ')} mit ${heldLevels.length} Stufen. Die schaltest du später unter „Meine Pläne“ scharf.`, `Disarmed and not included: ${[...held].map((z) => `zone ${z + 1}`).join(', ')} with ${heldLevels.length} levels. You arm them later under “My plans”.`)}</p>}
        {partial && <p className="text-ink-muted">{tr(`Die restlichen ${armedLevels.length - nowCount} Stufen bleiben im Plan. Du kannst sie später unter „Meine Pläne“ mit „Rest senden“ nachschicken.`, `The remaining ${armedLevels.length - nowCount} levels stay in the plan. You can send them later under “My plans” with “Send rest”.`)}</p>}
        <p>{tr(
          <>{exName()} sperrt dafür jetzt <strong>{input.side === 'buy' ? eur(nowCost) : `${num(toSend.reduce((a, l) => a + l.volume, 0), pair.volumeDecimals)} ${base}`}</strong> von deinem Guthaben, bis die Orders ausgeführt oder storniert sind.</>,
          <>{exName()} now locks <strong>{input.side === 'buy' ? eur(nowCost) : `${num(toSend.reduce((a, l) => a + l.volume, 0), pair.volumeDecimals)} ${base}`}</strong> of your balance for this until the orders are filled or cancelled.</>,
        )}</p>
        <p className="text-ink-muted">{tr(`Die Orders werden echt bei ${exName()} angelegt. Du kannst sie unter „Meine Pläne“ jederzeit stornieren, solange sie noch nicht ausgeführt sind. Dann ist das Geld sofort wieder frei.`, `The orders are really placed at ${exName()}. You can cancel them any time under “My plans” as long as they are not filled yet. The money is then free again right away.`)}</p>
        <p className="text-xs text-ink-muted">{tr('Hat dein Mac Touch ID, fragt er nach dem Klick noch nach deinem Finger.', 'If your Mac has Touch ID, it asks for your fingerprint after the click.')}</p>
      </div>
    </Modal>
  )
}

export function SaveTemplateDialog({ initial, onSave, onClose }: { initial: string; onSave: (name: string) => void; onClose: () => void }): JSX.Element {
  const [name, setName] = useState(initial)
  return (
    <Modal title={tr('Als Vorlage speichern', 'Save as template')} size="sm" onClose={() => onClose()}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={() => onClose()}>{tr('Abbrechen', 'Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave(name)}>{tr('Speichern', 'Save')}</button>
      </>}>
      <label className="block">
        <span className="label">{tr('Name', 'Name')}</span>
        <input className="input w-full" autoFocus value={name} placeholder={tr('z. B. BTC Dip 10 Stufen log', 'e.g. BTC dip 10 levels log')} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSave(name)} />
      </label>
      <p className="mt-2 text-xs text-ink-muted">{tr('Gespeichert werden Paar, Richtung, Preise, Stufen, Betrag und Verteilung. Ein gleichnamiger Plan wird ersetzt.', 'Saved are pair, side, prices, levels, amount and distribution. A template with the same name is replaced.')}</p>
    </Modal>
  )
}

export interface DraftForm { name: string; scenario: string; note: string; alarm: boolean }

export function DraftDialog({ form, setForm, editing, scenarios, input, pair, split, onSave, onClose }: {
  form: DraftForm
  setForm: (f: DraftForm) => void
  /** Ein vorhandener Entwurf wird bearbeitet */
  editing: boolean
  scenarios: string[]
  input: LadderInput
  pair: PairDto
  split: SendSplit
  onSave: (asNew: boolean) => void
  onClose: () => void
}): JSX.Element {
  const { eur, fmtPrice, sym } = useMoney()
  const { sendable, heldLevels, nowCount, nowCost, partial, toSend } = split
  const draft = editing
  return (
    <Modal title={draft ? tr('Entwurf speichern', 'Save draft') : tr('Als Entwurf speichern', 'Save as draft')} size="sm" onClose={() => onClose()}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={() => onClose()}>{tr('Abbrechen', 'Cancel')}</button>
        {draft && <button type="button" className="btn btn-secondary" onClick={() => onSave(true)}>{tr('Als neuen Entwurf', 'As new draft')}</button>}
        <button type="button" className="btn btn-primary" onClick={() => onSave(false)}>{draft ? tr('Entwurf aktualisieren', 'Update draft') : tr('Speichern', 'Save')}</button>
      </>}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="label">{tr('Name', 'Name')}</span>
          <input className="input w-full" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">{tr('Szenario (optional)', 'Scenario (optional)')}</span>
          <input className="input w-full" list="draft-scenarios" value={form.scenario} placeholder={tr('z. B. Crash, Bullrun, Nach dem Halving', 'e.g. Crash, Bull run, After the halving')} onChange={(e) => setForm({ ...form, scenario: e.target.value })} />
          <datalist id="draft-scenarios">{scenarios.map((x) => <option key={x} value={x} />)}</datalist>
          <span className="mt-1 block text-xs text-ink-muted">{tr('Entwürfe mit gleichem Szenario stehen zusammen.', 'Drafts with the same scenario are grouped together.')}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="checkbox mt-0.5" checked={form.alarm} onChange={(e) => setForm({ ...form, alarm: e.target.checked })} />
          <span>
            <span className="inline-flex items-center gap-1"><Bell size={14} /> {tr('Kursalarm', 'Price alert')}</span>
            <span className="block text-xs text-ink-muted">{tr(
              `Dein Mac meldet sich, wenn der Kurs die erste Stufe (${fmtPrice(toSend[0]?.price ?? input.priceStart, pair.priceDecimals)} ${sym}) erreicht. Gesendet wird nichts, die Freigabe bleibt bei dir. Die App muss dafür laufen.`,
              `Your Mac notifies you when the price reaches the first level (${fmtPrice(toSend[0]?.price ?? input.priceStart, pair.priceDecimals)} ${sym}). Nothing is sent, releasing stays up to you. The app must be running for this.`,
            )}</span>
          </span>
        </label>
        <label className="block">
          <span className="label">{tr('Notiz (optional)', 'Note (optional)')}</span>
          <input className="input w-full" value={form.note} placeholder={tr('z. B. nur senden, wenn BTC unter 60.000 € fällt', 'e.g. only send if BTC falls below 60,000 €')} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <p className="text-xs text-ink-muted">{tr(
          `${input.side === 'buy' ? 'Kauf' : 'Verkauf'} ${pair.name}, ${nowCount} ${partial || heldLevels.length ? `von ${sendable.length} ` : ''}Stufen, ${eur(nowCost)}. Es geht nichts an ${exName()}. Senden kannst du den Entwurf später unter „Meine Pläne“.`,
          `${input.side === 'buy' ? 'Buy' : 'Sell'} ${pair.name}, ${nowCount} ${partial || heldLevels.length ? `of ${sendable.length} ` : ''}levels, ${eur(nowCost)}. Nothing goes to ${exName()}. You can send the draft later under “My plans”.`,
        )}</p>
      </div>
    </Modal>
  )
}
