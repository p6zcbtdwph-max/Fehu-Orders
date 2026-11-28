import { api } from '../api'
import { useEffect, useMemo, useState } from 'react'
import { Layers, SlidersHorizontal, BookmarkPlus, ClipboardList, GraduationCap, FlaskConical, Send } from 'lucide-react'
import { buildLadder, otherUnitLadder, DEFAULT_MIN_ORDER_EUR, hasZones, MAX_STEPS, splitIntoZones, zoneSummary, type LadderInput, type LadderZone, type Side } from '@shared/ladder'
import { unreached, windowStats } from '@shared/history'
import ZoneEditor from '../components/ZoneEditor'
import HistoryHints from '../components/HistoryHints'
import type { DraftDto, PairDto, SendResult } from '@shared/ipc'
import { firstTestInput, wrongSide } from '@shared/safety'
import { NumberField } from '../components/NumberField'
import AmountInput, { tidy } from '../components/AmountInput'
import HoldingsCard from '../components/HoldingsCard'
import TaxFreeCard from '../components/TaxFreeCard'
import { holdingsFor, sellablePairs } from '@shared/holdings'
import PlanResults from './planner/PlanResults'
import { ConfirmSendDialog, DraftDialog, FirstTestDialog, SaveTemplateDialog } from './planner/PlannerDialogs'
import PlanChecks from './planner/PlanChecks'
import DistributionFields from './planner/DistributionFields'
import { TemplatePicker, useTemplates } from './planner/Templates'
import PairField from './planner/PairField'
import { useMarketData } from './planner/useMarketData'
import { splitSend } from '@shared/send-split'
import { MinOrderLine } from '../components/MinOrder'
import SectionCard from '../components/bausteine/SectionCard'
import Segmented from '../components/bausteine/Segmented'
import { SendSuccessModal } from '../components/SendSuccess'
import { numberFormat, pct } from '../format'
import { tr } from '@shared/i18n'
import { currencySign, toInputText } from '@shared/number-format'
import { useMoney } from '../money'
import { activeExchange, exName, FIRST_TEST_MAX_EUR, probeHint } from '@shared/exchanges'



export interface Prefill {
  pairId: string
  input: LadderInput
  postOnly?: boolean
  sendCount?: number
  /** Entwurf, der gerade bearbeitet wird */
  draft?: DraftDto
}

/** Neuer Plan aus der Übersicht: nur die Richtung vorgeben, der Rest bleibt wie zuletzt */
export interface SideStart {
  side: 'buy' | 'sell'
}

/** Kurzer Vorschlag für den Namen eines Entwurfs */
export const draftTitle = (pairName: string, input: LadderInput) => tr(
  `${pairName.split('/')[0]} ${input.side === 'buy' ? 'Kauf' : 'Verkauf'} ${input.steps} Stufen`,
  `${pairName.split('/')[0]} ${input.side === 'buy' ? 'buy' : 'sell'} ${input.steps} levels`,
)

/** Prozentliste als Text im gewählten Zahlenformat */
const weightsText = (w?: number[]) => (w ?? []).map((x) => toInputText(x, numberFormat())).join(numberFormat() === 'de' ? '; ' : ', ')


export { NumberField }

const PLANNER_VIEW = 'fehu-orders-planner-view'
/** Bereiche der Einführung und der Schritt, in dem sie stehen */
const GUIDE_STEP: Record<string, number> = { pair: 1, plan: 2, result: 3, actions: 4 }

export default function PlannerPage({ hasKey, onNeedKey, prefill, onPrefillUsed, onOpenDrafts, onOpenOrders, onOpenSettings, firstTest: firstTestRequest = 0, active = true }: { hasKey: boolean; onNeedKey: () => void; prefill?: Prefill | SideStart | null; /** Zählt hoch, wenn „Erster Test“ von außen geöffnet werden soll */ firstTest?: number; onPrefillUsed?: () => void; onOpenDrafts?: () => void; onOpenOrders?: () => void; onOpenSettings?: () => void; active?: boolean }): JSX.Element {
  const { eur, fmtPrice, sym, usdHint } = useMoney()
  /** Börse, für die die Paare geladen wurden (die Seite wird beim Börsenwechsel neu aufgebaut) */
  const [pairsExchange] = useState(activeExchange)
  /** Wie viele Stufen jetzt gesendet werden (leer = alle) */
  const [sendCount, setSendCount] = useState<number | null>(null)
  const [pairs, setPairs] = useState<PairDto[]>([])
  const [pairId, setPairId] = useState<string>('')
  const [last, setLast] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [input, setInput] = useState<LadderInput>({ side: 'buy', priceStart: 0, priceEnd: 0, steps: 10, total: 100, spacing: 'linear', curve: 'flat', ratio: 3 })
  const [postOnly, setPostOnly] = useState(true)
  const [busy, setBusy] = useState<'validate' | 'send' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  /** Rückmeldungsfenster nach dem echten Senden */
  const [sentInfo, setSentInfo] = useState<{ result: SendResult; pairName: string; side: 'buy' | 'sell'; priceDecimals: number } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [customText, setCustomText] = useState('')
  const [range, setRange] = useState(90)
  /** Beim Verkaufen auch Paare ohne Bestand in der Suche zeigen */
  const [showAll, setShowAll] = useState(false)
  /** Beim Verkaufen: so viel vom Coin mindestens behalten (gilt für die Prozent-Knöpfe) */
  const [keep, setKeep] = useState(0)
  // Beim Laden einer Vorlage oder eines Vorschlags den Kurs nicht überschreiben
  const [keepPrices, setKeepPrices] = useState(false)
  /** Entwurf, der gerade bearbeitet wird */
  const [draft, setDraft] = useState<DraftDto | null>(null)
  const [draftForm, setDraftForm] = useState<{ name: string; scenario: string; note: string; alarm: boolean } | null>(null)
  /** Fenster „Ersten Test vorbereiten“ */
  const [firstTest, setFirstTest] = useState(false)
  const [limit, setLimit] = useState<number | null>(null)
  /** Mindest-Orderwert aus den Einstellungen: keine Stufe darunter */
  const [minOrder, setMinOrder] = useState(DEFAULT_MIN_ORDER_EUR)
  // Obergrenze und Mindest-Orderwert neu lesen, sobald der Planer wieder sichtbar ist (sie können in den Einstellungen geändert worden sein)
  useEffect(() => {
    if (active) api().settings().then((s) => { setLimit(s.maxPlanEur); setMinOrder(s.minOrderEur ?? DEFAULT_MIN_ORDER_EUR) }).catch(() => setLimit(null))
  }, [active])
  const [scenarios, setScenarios] = useState<string[]>([])
  const [draftMsg, setDraftMsg] = useState<string | null>(null)

  const pair = pairs.find((p) => p.id === pairId)
  const set = <K extends keyof LadderInput>(k: K, v: LadderInput[K]) => {
    setInput((s) => {
      const next = { ...s, [k]: v }
      // Neue Formel: Regler springen auf deren Standardwert, damit man ihn sieht
      if (k === 'spacing') next.orderCenter = undefined
      if (k === 'curve') next.volumeCenter = undefined
      // Richtung gewechselt und keine Einheit gewählt: Kauf rechnet in Geld, Verkauf in Stück.
      // Den Wert umrechnen, damit aus 100 € nicht plötzlich 100 BTC werden.
      if (k === 'side' && v !== s.side && !s.unit && last && last > 0 && s.total > 0) {
        next.total = v === 'sell' ? tidy(s.total / last, pair?.volumeDecimals ?? 8) : tidy(s.total * last, 2)
      }
      return next
    })
    setResult(null)
  }

  const zoned = hasZones(input)
  const setZones = (zones: LadderZone[]) => {
    setInput((s) => zoneSummary({ ...s, zones }))
    setResult(null)
  }
  /** Zwischen einem Bereich und Preiszonen umschalten. Die Zonen starten als Aufteilung des jetzigen Bereichs. */
  const setMode = (mode: 'range' | 'zones') => {
    setInput((s) => {
      if (mode === 'range') return { ...s, zones: undefined }
      if (hasZones(s)) return s
      const curve = s.curve === 'custom' ? 'flat' : s.curve
      return zoneSummary({ ...s, curve, customWeights: undefined, zones: splitIntoZones(s) })
    })
    setResult(null)
  }
  /** Kurs aus dem Rückblick als letzte Stufe übernehmen (mit Zonen: als Ende der letzten Zone) */
  const useAsEnd = (price: number) => {
    if (!hasZones(input)) return set('priceEnd', price)
    const zs = input.zones!.slice()
    const lastZone = zs[zs.length - 1]
    zs[zs.length - 1] = lastZone.steps === 1 ? { ...lastZone, steps: 2, priceEnd: price } : { ...lastZone, priceEnd: price }
    setZones(zs)
  }

  useEffect(() => {
    api().pairs().then((ps) => {
      setPairs(ps)
      setPairId((cur) => cur || (ps.find((p) => p.name === 'BTC/EUR')?.id ?? ps[0]?.id ?? ''))
    }).catch((e) => setLoadError(e.message))
  }, [])


  // Ansicht: in vier Schritten (Standard) oder alles auf einer Seite
  const [view, setViewState] = useState<'steps' | 'all'>(() => {
    try { return localStorage.getItem(PLANNER_VIEW) === 'all' ? 'all' : 'steps' } catch { return 'steps' }
  })
  const setView = (v: 'steps' | 'all') => {
    setViewState(v)
    try { localStorage.setItem(PLANNER_VIEW, v) } catch { /* egal */ }
  }
  const wizard = view === 'steps'
  const [step, setStep] = useState(1)
  const goStep = (n: number) => { setStep(Math.min(4, Math.max(1, n))); window.scrollTo?.({ top: 0 }) }

  // Die Einführung zeigt Bereiche des Planers: passenden Schritt öffnen
  useEffect(() => {
    const onGuide = (e: Event) => {
      const n = GUIDE_STEP[(e as CustomEvent<string>).detail]
      if (n) setStep(n)
    }
    window.addEventListener('fehu-guide', onGuide)
    return () => window.removeEventListener('fehu-guide', onGuide)
  }, [])

  // Vorschlag von „Meine Pläne“ (Gewinnstaffel) übernehmen
  useEffect(() => {
    if (!prefill) return
    if (!('input' in prefill)) {
      // Nur Richtung wählen (Kaufplan / Verkaufsplan aus der Übersicht)
      setInput((s) => ({ ...s, side: prefill.side }))
      setDraft(null)
      setDraftMsg(null)
      setResult(null)
      setStep(1)
      onPrefillUsed?.()
      return
    }
    setKeepPrices(true)
    setPairId(prefill.pairId)
    setInput(prefill.input)
    if (prefill.postOnly !== undefined) setPostOnly(prefill.postOnly)
    setSendCount(prefill.sendCount ?? null)
    setCustomText(weightsText(prefill.input.customWeights))
    setDraft(prefill.draft ?? null)
    setDraftMsg(null)
    setResult(null)
    // fertiger Plan (Entwurf, Verkaufsplan): gleich zum Prüfen
    setStep(3)
    onPrefillUsed?.()
  }, [prefill])

  const selling = input.side === 'sell'
  const { fees, available, balances, holdPrices, holdLoading, candles, daily, weekly } = useMarketData({ hasKey, pairId, pairs, selling, range, result })

  // Vorlagen: laden, speichern, löschen. Beim Anwenden übernimmt der Planer Paar, Eingaben und Post-only.
  const tpl = useTemplates({
    current: () => (pair ? { pairName: pair.name, input, postOnly } : null),
    onApply: (t) => {
      const p = pairs.find((x) => x.name === t.pairName)
      setKeepPrices(true)
      if (p) setPairId(p.id)
      setInput(t.input)
      setPostOnly(t.postOnly)
      setCustomText(weightsText(t.input.customWeights))
      setResult(null)
    },
  })

  const loadPrice = (startFromPrice = true) => {
    if (!pairId) return
    api().price(pairId).then((p) => {
      setLast(p)
      if (startFromPrice && !keepPrices) {
        // Vorschlag: Kauf 2–20 % unter dem Kurs, Verkauf 5–40 % darüber
        setInput((s) => {
          const next = s.side === 'buy' ? { ...s, priceStart: +(p * 0.98).toPrecision(6), priceEnd: +(p * 0.8).toPrecision(6) } : { ...s, priceStart: +(p * 1.05).toPrecision(6), priceEnd: +(p * 1.4).toPrecision(6) }
          // Mit Preiszonen: die Zonen im neuen Bereich neu aufteilen (z. B. nach Wechsel von Kaufen auf Verkaufen)
          return hasZones(s) ? zoneSummary({ ...next, zones: splitIntoZones(next, s.zones!.length) }) : next
        })
      }
    }).catch((e) => setLoadError(e.message))
  }
  useEffect(() => loadPrice(true), [pairId, input.side])
  // Kurs alle 30 Sekunden auffrischen, damit Warnungen und Abstände stimmen
  useEffect(() => {
    if (!pairId) return
    const t = setInterval(() => api().price(pairId).then(setLast).catch(() => {}), 30_000)
    return () => clearInterval(t)
  }, [pairId])
  // nach dem ersten Kursabruf dürfen Richtungswechsel die Preise wieder vorschlagen
  useEffect(() => {
    if (keepPrices) {
      const t = setTimeout(() => setKeepPrices(false), 500)
      return () => clearTimeout(t)
    }
    return undefined
  }, [keepPrices])

  const ladder = useMemo(() => (pair ? buildLadder(input, pair, { minCost: minOrder }) : null), [input, pair, minOrder])
  // Derselbe Plan in der anderen Einheit, für den Vergleich „feste Euro“ gegen „feste Stück“
  const altLadder = useMemo(() => (pair && ladder ? otherUnitLadder(input, ladder, pair, { minCost: minOrder }) : null), [input, ladder, pair, minOrder])
  const holdings = useMemo(() => (hasKey && selling && available ? holdingsFor(pairs, available, balances, holdPrices, minOrder) : []), [hasKey, selling, pairs, available, balances, holdPrices, minOrder])
  const sellPairs = useMemo(() => sellablePairs(pairs, holdings), [pairs, holdings])
  // Beim Verkaufen zeigt die Suche nur Paare mit freiem Bestand (außer „Alle Paare zeigen“ oder es gibt keinen Bestand)
  const pickable = selling && !showAll && sellPairs.length ? sellPairs : pairs
  const holding = pair ? holdings.find((h) => h.base === pair.base) ?? null : null
  // Wechsel auf Verkaufen mit einem Coin, den man nicht hat: den größten eigenen Bestand wählen
  useEffect(() => {
    if (!selling || showAll || keepPrices || !pair || !sellPairs.length) return
    if (!sellPairs.some((p) => p.id === pair.id)) {
      const top = holdings.find((h) => !h.dust)
      if (top) setPairId(top.pair.id)
    }
  }, [selling, sellPairs])
  const quote = currencySign(pair?.name.split('/')[1] ?? 'EUR')
  const base = pair?.name.split('/')[0] ?? ''
  // Nur die ersten N scharfen Stufen (nah am Kurs) gehen jetzt raus, der Rest und entschärfte Zonen bleiben im Plan
  const split = splitSend(ladder?.levels ?? [], input, sendCount)
  const { sendable, held, armedLevels, heldLevels, nowCount, toSend, nowCost, nowVolume, partial, later } = split

  // Gebühren und Guthaben (für das, was jetzt gesendet wird)
  const feePct = fees ? (postOnly ? fees.maker : fees.taker) : null
  const feeEur = ladder && feePct !== null ? (nowCost * feePct) / 100 : null
  const needAsset = pair ? (input.side === 'buy' ? pair.quote : pair.base) : ''
  const need = input.side === 'buy' ? nowCost + (feeEur ?? 0) : nowVolume
  const have = available && needAsset ? available[needAsset] ?? 0 : null
  const shortfall = have !== null && nowCost > 0 && have + 1e-12 < need
  // Stufen auf der falschen Seite des Kurses würden sofort ausgeführt (oder mit Post-only sofort storniert)
  // Beim Verkaufen: Haltefrist des gewählten Coins (steuerfrei nach einem Jahr)
  const taxCard = selling && pair ? (
    <TaxFreeCard key={`${pairsExchange}-${pair.base}`} coin={pair.name.split('/')[0]} decimals={pair.volumeDecimals}
      held={holding ? holding.available + holding.locked + holding.earn : undefined}
      sellVolume={sendable.reduce((a, l) => a + l.volume, 0)} />
  ) : null
  const wrong = wrongSide(input.side, toSend.map((l) => l.price), last)
  // Über der Obergrenze pro Sendung schickt der Hauptprozess nichts raus. Lieber vorher sagen als hinterher.
  const overLimit = limit !== null && nowCost > limit + 1e-9
  // Rückblick: wie oft der Kurs die Stufen im gewählten Zeitraum erreicht hat (Tageskerzen)
  const nowSec = Date.now() / 1000
  const covered = daily.length ? windowStats(daily, range, nowSec)?.covered ?? range : range
  const never = daily.length && sendable.length ? unreached(sendable, daily, input.side, range, nowSec) : null

  function openDraftForm() {
    if (!pair) return
    api().drafts().then((ds) => setScenarios([...new Set(ds.map((d) => d.scenario).filter(Boolean))])).catch(() => setScenarios([]))
    setDraftForm({ name: draft?.name ?? draftTitle(pair.name, input), scenario: draft?.scenario ?? '', note: draft?.note ?? '', alarm: draft?.alarm ?? true })
  }

  // „Erster Test“ aus der Übersicht
  useEffect(() => { if (firstTestRequest > 0) openFirstTest() }, [firstTestRequest])

  function openFirstTest() {
    api().settings().then((s) => setLimit(s.maxPlanEur)).catch(() => setLimit(null))
    setFirstTest(true)
  }

  function loadFirstTest() {
    const btc = pairs.find((p) => p.name === 'BTC/EUR') ?? pair
    if (!btc) return
    api().price(btc.id).then((p) => {
      setKeepPrices(true)
      setPairId(btc.id)
      setLast(p)
      const t = firstTestInput(p, btc, minOrder, Math.min(limit ?? FIRST_TEST_MAX_EUR, FIRST_TEST_MAX_EUR))
      setInput(t)
      setSendCount(null)
      setPostOnly(true)
      setDraft(null)
      setResult(null)
      setFirstTest(false)
      setStep(3)
    }).catch((e) => setLoadError((e as Error).message))
  }

  async function storeDraft(asNew: boolean) {
    if (!pair || !draftForm) return
    const nowIso = new Date().toISOString()
    const base = !asNew && draft ? draft : null
    const d: DraftDto = {
      id: base?.id ?? `d${Date.now()}`, createdAt: base?.createdAt ?? nowIso, updatedAt: nowIso, status: 'draft',
      name: draftForm.name.trim() || draftTitle(pair.name, input), scenario: draftForm.scenario.trim(), note: draftForm.note.trim() || undefined,
      pairId: pair.id, pairName: pair.name, side: input.side, input, postOnly, sendCount: partial ? nowCount : undefined, priceAtSave: last ?? undefined,
      alarm: draftForm.alarm,
    }
    await api().saveDraft(d)
    setDraft(d)
    setDraftForm(null)
    setDraftMsg(tr(`Entwurf „${d.name}“ gespeichert. Es wurde nichts an ${exName()} gesendet.`, `Draft “${d.name}” saved. Nothing was sent to ${exName()}.`))
  }

  async function run(validate: boolean) {
    if (!pair || !ladder) return
    setBusy(validate ? 'validate' : 'send')
    setSendError(null)
    setResult(null)
    try {
      // Wird gerade ein Entwurf bearbeitet, gilt er nach dem echten Senden als freigegeben (sonst ließe er sich ein zweites Mal senden)
      const r = await api().send({ pairId: pair.id, pairName: pair.name, side: input.side, input, levels: ladder.levels, validate, postOnly, sendCount: partial ? nowCount : undefined, draftId: validate ? undefined : draft?.id, exchange: pairsExchange })
      setResult(r)
      if (!validate) setSentInfo({ result: r, pairName: pair.name, side: input.side, priceDecimals: pair.priceDecimals })
      if (!validate && draft && r.orders.some((o) => o.txid || o.uncertain)) {
        setDraftMsg(tr(`Der Entwurf „${draft.name}“ ist jetzt gesendet (Plan-Nummer ${r.userref}).`, `The draft “${draft.name}” is now sent (plan number ${r.userref}).`))
        setDraft(null)
      }
    } catch (e) {
      setSendError((e as Error).message)
    } finally {
      setBusy(null)
      setConfirm(false)
    }
  }


  const sendCountField = (
    <NumberField label={tr('Davon jetzt senden', 'Send now')} step="1" value={sendCount ?? armedLevels.length}
      onChange={(v) => setSendCount(Number.isFinite(v) && v > 0 && Math.round(v) < armedLevels.length ? Math.round(v) : null)}
      hint={partial ? tr(`Die ${nowCount} Stufen nah am Kurs. Den Rest sendest du später unter „Meine Pläne“.`, `The ${nowCount} levels close to the price. Send the rest later under “My plans”.`) : tr('Alle Stufen', 'All levels')} />
  )
  const postOnlyField = (
  <label className="flex items-start gap-2 text-sm">
    <input type="checkbox" className="checkbox mt-0.5" checked={postOnly} onChange={(e) => setPostOnly(e.target.checked)} />
    <span>
      {tr('Nur als Limit-Order ins Orderbuch (Post-only)', 'Only as limit order into the order book (post-only)')}
      <span className="block text-xs text-ink-muted">{tr('Verhindert, dass eine Stufe sofort zum Marktpreis ausgeführt wird, wenn der Preis falsch eingegeben ist.', 'Prevents a level from being filled immediately at market price if the price was entered wrongly.')}</span>
    </span>
  </label>
  )
  const openConfirm = () => { setConfirm(true); api().settings().then((s) => setLimit(s.maxPlanEur)).catch(() => undefined) }
  const canSend = hasKey && !!ladder?.valid && !busy && !shortfall
  const checksEl = (
    <PlanChecks input={input} ladder={ladder} pair={pair} last={last} split={split} minOrder={minOrder} limit={limit} overLimit={overLimit} feePct={feePct} feeEur={feeEur}
      need={need} have={have} shortfall={shortfall} wrong={wrong} postOnly={postOnly} never={never} range={range} covered={covered} sendError={sendError} result={result} onOpenSettings={onOpenSettings} />
  )
  const resultsEl = (
    <PlanResults input={input} ladder={ladder} pair={pair} last={last} candles={candles} daily={daily} weekly={weekly} range={range} setRange={setRange} result={result} held={held} later={later} />
  )
  const planEl = (
    <div data-guide="plan" className="min-w-0"><SectionCard title={tr('Plan', 'Plan')} action={<button type="button" className="btn btn-ghost btn-sm" onClick={tpl.openSave} title={tr('Diesen Plan als Vorlage speichern', 'Save this plan as a template')}><BookmarkPlus size={14} /> {tr('Als Vorlage', 'Save as template')}</button>}>
      <div className="space-y-4">
        <TemplatePicker {...tpl} />
        <div>
          <span className="label">{tr('Aufbau', 'Layout')}</span>
          <Segmented<'range' | 'zones'> block value={zoned ? 'zones' : 'range'} onChange={setMode} options={[
            { id: 'range', label: tr('Ein Bereich', 'One range'), icon: SlidersHorizontal, title: tr('Alle Stufen in einem Preisbereich, verteilt nach einer Formel', 'All levels in one price range, spread by a formula') },
            { id: 'zones', label: tr('Preiszonen', 'Price zones'), icon: Layers, title: tr('Mehrere getrennte Bereiche mit eigenem Anteil, z. B. viel Geld an alten Tiefs', 'Several separate ranges with their own share, e.g. a lot of money at old lows') },
          ]} />
        </div>
        {zoned ? (
          <ZoneEditor side={input.side} zones={input.zones!} ladder={ladder} last={last} daily={daily} days={range} quote={quote} total={input.total} eur={eur}
            fmtPrice={(p) => `${fmtPrice(p, pair?.priceDecimals ?? 2)} ${sym}`} onChange={setZones} />
        ) : (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={tr(`Erste Stufe (${quote})`, `First level (${quote})`)} value={input.priceStart} onChange={(v) => set('priceStart', v)} hint={last ? [pct(input.priceStart / last - 1) + tr(' zum Kurs', ' vs. price'), usdHint(input.priceStart)].filter(Boolean).join(' · ') : undefined} />
          <NumberField label={tr(`Letzte Stufe (${quote})`, `Last level (${quote})`)} value={input.priceEnd} onChange={(v) => set('priceEnd', v)} hint={last ? [pct(input.priceEnd / last - 1) + tr(' zum Kurs', ' vs. price'), usdHint(input.priceEnd)].filter(Boolean).join(' · ') : undefined} />
        </div>
        )}
        <HistoryHints side={input.side} daily={daily} last={last} current={zoned ? input.zones![input.zones!.length - 1].priceStart : input.priceStart}
          fmtPrice={(p) => `${fmtPrice(p, pair?.priceDecimals ?? 2)} ${sym}`} onUse={useAsEnd}
          useLabel={zoned ? tr('Als Ende der letzten Zone übernehmen', 'Use as end of the last zone') : tr('Als letzte Stufe übernehmen', 'Use as last level')} />
        <div className="grid grid-cols-2 gap-3">
          {zoned
            ? <div><span className="label">{tr('Anzahl Stufen', 'Number of levels')}</span><p className="pt-2 text-sm tabular-nums">{input.steps} <span className="text-xs text-ink-muted">{tr('aus den Zonen', 'from the zones')}</span></p></div>
            : <NumberField label={tr('Anzahl Stufen', 'Number of levels')} step="1" value={input.steps} onChange={(v) => set('steps', Math.round(v))} hint={tr(`1 bis ${MAX_STEPS}`, `1 to ${MAX_STEPS}`)} />}
          {!wizard && sendCountField}
        </div>
        {pair && <MinOrderLine userMin={minOrder} price={input.priceStart} rules={pair} pairName={pair.name} eur={eur} onOpenSettings={onOpenSettings} />}
        <DistributionFields input={input} set={set} zoned={zoned} ladder={ladder} pair={pair} customText={customText} setCustomText={setCustomText} />
        {!wizard && postOnlyField}
      </div>
    </SectionCard></div>
  )
  const STEPS = [tr('Was?', 'What?'), tr('Zu welchen Preisen?', 'At what prices?'), tr('Prüfen', 'Check'), tr('Abschließen', 'Finish')]

  return (
    <div className="page">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">{draft ? tr('Entwurf bearbeiten', 'Edit draft') : input.side === 'sell' ? tr('Neuer Verkaufsplan', 'New sell plan') : tr('Neuer Kaufplan', 'New buy plan')}</h1>
          <p className="page-subtitle">{tr(`Viele Limit-Orders auf einmal planen, prüfen und an ${exName()} senden.`, `Plan, check and send many limit orders to ${exName()} at once.`)}</p>
        </div>
        <Segmented<'steps' | 'all'> value={wizard ? 'steps' : 'all'} onChange={setView} aria-label={tr('Ansicht des Planers', 'Planner view')}
          options={[{ id: 'steps', label: tr('In Schritten', 'Step by step'), title: tr('Der Planer führt dich in vier Schritten durch einen Plan', 'The planner guides you through a plan in four steps') }, { id: 'all', label: tr('Alles auf einer Seite', 'All on one page'), title: tr('Alle Felder auf einmal, für Geübte', 'All fields at once, for experienced users') }]} />
        {!wizard && (
        <div className="ml-auto flex flex-shrink-0 items-center gap-2" data-guide="actions">
          <button type="button" className="btn btn-ghost" onClick={openFirstTest} title={tr('Einen kleinen, sicheren Plan für den ersten echten Test laden (bis 50 €)', 'Load a small, safe plan for your first real test (up to 50 €)')}>
            <GraduationCap size={16} /> {tr('Erster Test', 'First test')}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!ladder?.valid || !!busy} onClick={openDraftForm} title={tr('Zwischenspeichern und später unter „Meine Pläne“ senden', 'Save for now and send later under “My plans”')}>
            <ClipboardList size={16} /> {tr('Als Entwurf', 'Save as draft')}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!hasKey || !ladder?.valid || !!busy} onClick={() => run(true)} title={probeHint()}>
            <FlaskConical size={16} /> {busy === 'validate' ? tr('Prüfe …', 'Checking …') : tr('Testen', 'Test')}
          </button>
          <button type="button" data-primary-action className="btn btn-primary" disabled={!hasKey || !ladder?.valid || !!busy || !!shortfall} onClick={() => { setConfirm(true); api().settings().then((s) => setLimit(s.maxPlanEur)).catch(() => undefined) }}>
            <Send size={16} /> {tr(`An ${exName()} senden`, `Send to ${exName()}`)}
          </button>
        </div>
        )}
      </header>

      {loadError && <p className="notice notice-danger mb-4">{loadError}</p>}
      {draft && (
        <p className="notice notice-accent mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
          <ClipboardList size={16} className="flex-shrink-0" />
          <span className="flex-1">{tr(<>Du bearbeitest den Entwurf <strong>{draft.name}</strong>. Änderungen speicherst du mit „Als Entwurf“.</>, <>You are editing the draft <strong>{draft.name}</strong>. Save changes with “Save as draft”.</>)}</span>
          <button type="button" className="btn-link" onClick={() => { setDraft(null); setDraftMsg(null) }}>{tr('Bearbeiten beenden', 'Stop editing')}</button>
        </p>
      )}
      {draftMsg && (
        <p className="notice notice-success mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex-1">{draftMsg}</span>
          {onOpenDrafts && <button type="button" className="btn-link" onClick={onOpenDrafts}>{tr('Zu den Entwürfen', 'Go to drafts')}</button>}
        </p>
      )}
      {!hasKey && (
        <p className="notice notice-info mb-4">
          {tr(`Planen geht auch ohne Schlüssel. Zum Prüfen und Senden brauchst du einen ${exName()}-API-Schlüssel.`, `You can plan without a key. To check and send you need a ${exName()} API key.`)}{' '}
          <button type="button" className="btn-link" onClick={onNeedKey}>{tr('Schlüssel hinterlegen', 'Add key')}</button>
        </p>
      )}

      {wizard ? (
        <>
          <nav className="mb-4 flex flex-wrap gap-2" aria-label={tr('Schritte', 'Steps')}>
            {STEPS.map((label, i) => (
              <button key={i} type="button" onClick={() => goStep(i + 1)} aria-current={step === i + 1 ? 'step' : undefined} disabled={i > 0 && !pair}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${step === i + 1 ? 'bg-accent font-semibold text-accent-on' : step > i + 1 ? 'bg-success-soft text-success-fg' : 'bg-sunken text-ink-muted hover:text-ink'}`}>
                {i + 1} {label}
              </button>
            ))}
          </nav>
          {step === 1 && <>
          <section className="card mb-4 p-4" data-guide="pair">
            <div className="grid grid-cols-1 items-start gap-4 @md:grid-cols-2 @xl:grid-cols-[1.2fr_1fr_1fr]">
              <PairField pairs={pairs} pickable={pickable} pairId={pairId} pair={pair} last={last} onPick={(id) => { setPairId(id); setResult(null) }} onReload={() => loadPrice(false)} />
              <div>
                <span className="label">{tr('Richtung', 'Side')}</span>
                <Segmented<Side> block size="md" value={input.side} onChange={(v) => set('side', v)} options={[{ id: 'buy', label: tr('Kaufen', 'Buy') }, { id: 'sell', label: tr('Verkaufen', 'Sell') }]} />
              </div>
              <AmountInput input={input} ladder={ladder} alt={altLadder} last={last} quote={quote} base={base} volumeDecimals={pair?.volumeDecimals ?? 8}
                holding={holding} keep={keep} onKeep={setKeep} eur={eur} usdHint={usdHint}
                onChange={(patch) => { setInput((s) => ({ ...s, ...patch })); setResult(null) }} />
            </div>
          </section>

          {selling && <HoldingsCard holdings={holdings} pairId={pairId} showAll={showAll} onShowAll={setShowAll} onPick={(id) => { setPairId(id); setResult(null) }} eur={eur} hasKey={hasKey} loading={holdLoading} />}
          {taxCard}
          </>}
          {step === 2 && (
            <div className="grid grid-cols-1 gap-4 @lg:grid-cols-[22rem_1fr]">
              {planEl}
              <div className="min-w-0 space-y-4">{resultsEl}</div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-4" data-guide="result">
              {checksEl}
              <SectionCard title={tr('Bei der Börse testen', 'Test at the exchange')}>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <p className="min-w-0 flex-1 text-ink-muted">{probeHint()}. {tr('Es wird nichts angelegt und kein Geld gesperrt.', 'Nothing is placed and no funds are locked.')}</p>
                  <button type="button" className="btn btn-secondary" disabled={!hasKey || !ladder?.valid || !!busy} onClick={() => run(true)}>
                    <FlaskConical size={16} /> {busy === 'validate' ? tr('Prüfe …', 'Checking …') : tr('Testen', 'Test')}
                  </button>
                </div>
              </SectionCard>
              {resultsEl}
            </div>
          )}
          {step === 4 && (
            <div className="space-y-4" data-guide="actions">
              <SectionCard title={tr('Zusammenfassung', 'Summary')}>
                <div className="space-y-3 text-sm">
                  <p>
                    <strong>{input.side === 'buy' ? tr('Kaufen', 'Buy') : tr('Verkaufen', 'Sell')}</strong> {pair?.name}{' '}
                    {tr(`in ${toSend.length} Stufen`, `in ${toSend.length} levels`)}{toSend.length > 0 && <> {tr('von', 'from')} {fmtPrice(toSend[0].price, pair?.priceDecimals ?? 2)} {tr('bis', 'to')} {fmtPrice(toSend[toSend.length - 1].price, pair?.priceDecimals ?? 2)} {quote}</>}.{' '}
                    {tr('Gegenwert', 'Value')}: <strong>{eur(nowCost)}</strong>.
                  </p>
                  <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">{sendCountField}</div>
                  {postOnlyField}
                  {(!!shortfall || overLimit || wrong.length > 0 || !ladder?.valid) && (
                    <p className="notice notice-warning">{tr('Es gibt noch Warnungen. Schau sie dir im Schritt „Prüfen“ an.', 'There are still warnings. Have a look at them in the “Check” step.')} <button type="button" className="btn-link" onClick={() => goStep(3)}>{tr('Zu Prüfen', 'Go to Check')}</button></p>
                  )}
                  {sendError && <p className="notice notice-danger">{sendError}</p>}
                  {!hasKey && <p className="notice notice-info">{tr(`Zum Senden brauchst du einen ${exName()}-API-Schlüssel. Als Entwurf aufheben geht auch ohne.`, `To send you need a ${exName()} API key. Saving as a draft works without one.`)} <button type="button" className="btn-link" onClick={onNeedKey}>{tr('Schlüssel hinterlegen', 'Add key')}</button></p>}
                </div>
              </SectionCard>
              <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                <button type="button" className="card flex flex-col items-start gap-1 p-4 text-left transition-colors hover:border-accent-edge disabled:opacity-50" disabled={!ladder?.valid || !!busy} onClick={openDraftForm}>
                  <span className="flex items-center gap-2 font-semibold text-ink"><ClipboardList size={16} /> {draft ? tr('Entwurf speichern', 'Save draft') : tr('Als Entwurf aufheben', 'Save as draft')}</span>
                  <span className="text-sm text-ink-muted">{tr('Geht noch nicht an die Börse und sperrt kein Geld. Du findest ihn unter „Meine Pläne“ und kannst ihn später senden, auch mit Kursalarm.', 'Does not go to the exchange yet and locks no funds. You find it under “My plans” and can send it later, also with a price alert.')}</span>
                </button>
                <button type="button" data-primary-action className="card flex flex-col items-start gap-1 border-accent-edge bg-accent-soft p-4 text-left transition-colors hover:border-accent-edge disabled:opacity-50" disabled={!canSend} onClick={openConfirm}>
                  <span className="flex items-center gap-2 font-semibold text-ink"><Send size={16} /> {tr(`Jetzt an ${exName()} senden`, `Send to ${exName()} now`)}</span>
                  <span className="text-sm text-ink-muted">{tr(`Die Orders werden echt angelegt. ${exName()} sperrt dafür den Betrag, bis sie ausgeführt oder storniert sind. Vorher siehst du noch eine Bestätigung.`, `The orders are really placed. ${exName()} locks the amount until they are filled or cancelled. You see a confirmation first.`)}</span>
                </button>
              </div>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {step > 1 && <button type="button" className="btn btn-secondary" onClick={() => goStep(step - 1)}>{tr('Zurück', 'Back')}</button>}
            <button type="button" className="btn btn-ghost" onClick={openFirstTest} title={tr('Einen kleinen, sicheren Plan für den ersten echten Test laden (bis 50 €)', 'Load a small, safe plan for your first real test (up to 50 €)')}>
              <GraduationCap size={16} /> {tr('Erster Test', 'First test')}
            </button>
            {step < 4 && <button type="button" className="btn btn-primary ml-auto" disabled={!pair} onClick={() => goStep(step + 1)}>{tr(`Weiter: ${STEPS[step]}`, `Next: ${STEPS[step]}`)}</button>}
          </div>
        </>
      ) : (
        <>
      <section className="card mb-4 p-4" data-guide="pair">
        <div className="grid grid-cols-1 items-start gap-4 @md:grid-cols-2 @xl:grid-cols-[1.2fr_1fr_1fr]">
          <PairField pairs={pairs} pickable={pickable} pairId={pairId} pair={pair} last={last} onPick={(id) => { setPairId(id); setResult(null) }} onReload={() => loadPrice(false)} />
          <div>
            <span className="label">{tr('Richtung', 'Side')}</span>
            <Segmented<Side> block size="md" value={input.side} onChange={(v) => set('side', v)} options={[{ id: 'buy', label: tr('Kaufen', 'Buy') }, { id: 'sell', label: tr('Verkaufen', 'Sell') }]} />
          </div>
          <AmountInput input={input} ladder={ladder} alt={altLadder} last={last} quote={quote} base={base} volumeDecimals={pair?.volumeDecimals ?? 8}
            holding={holding} keep={keep} onKeep={setKeep} eur={eur} usdHint={usdHint}
            onChange={(patch) => { setInput((s) => ({ ...s, ...patch })); setResult(null) }} />
        </div>
      </section>

      {selling && <HoldingsCard holdings={holdings} pairId={pairId} showAll={showAll} onShowAll={setShowAll} onPick={(id) => { setPairId(id); setResult(null) }} eur={eur} hasKey={hasKey} loading={holdLoading} />}
          {taxCard}

      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-[22rem_1fr]">
        {planEl}

        <div className="min-w-0 space-y-4" data-guide="result">
          {checksEl}
          {resultsEl}
        </div>
      </div>
        </>
      )}

      {tpl.saveAs !== null && <SaveTemplateDialog initial={tpl.saveAs} onSave={tpl.store} onClose={tpl.closeSave} />}

      {draftForm && pair && (
        <DraftDialog form={draftForm} setForm={setDraftForm} editing={!!draft} scenarios={scenarios} input={input} pair={pair} split={split} onSave={storeDraft} onClose={() => setDraftForm(null)} />
      )}

      {firstTest && (
        <FirstTestDialog limit={limit} setLimit={setLimit} minOrder={minOrder} hasKey={hasKey} onNeedKey={onNeedKey} onOpenOrders={onOpenOrders} onLoad={loadFirstTest} onClose={() => setFirstTest(false)} />
      )}

      {sentInfo && <SendSuccessModal {...sentInfo} onClose={() => setSentInfo(null)} onOpenOrders={onOpenOrders} />}

      {confirm && ladder && pair && (
        <ConfirmSendDialog input={input} pair={pair} last={last} busy={busy} limit={limit} overLimit={overLimit} toSend={toSend} nowCount={nowCount} nowCost={nowCost} feeEur={feeEur}
          wrong={wrong} held={held} heldLevels={heldLevels} armedLevels={armedLevels} partial={partial} postOnly={postOnly} onSend={() => run(false)} onClose={() => setConfirm(false)} />
      )}
    </div>
  )
}
