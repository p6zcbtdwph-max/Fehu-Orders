import { api } from '../api'
import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Bell, History, Layers, ShieldOff, SlidersHorizontal, BookmarkPlus, ClipboardList, GraduationCap, FlaskConical, Info, RefreshCw, Send, Star, Trash2 } from 'lucide-react'
import { buildLadder, otherUnitLadder, DEFAULT_MIN_ORDER_EUR, hasZones, heldZones, isHeld, zoneTrigger, MAX_STEPS, splitIntoZones, zoneEnd, zoneSummary, type LadderInput, type LadderZone, type PriceSpacing, type Side, type SizeCurve } from '@shared/ladder'
import { reach, toCandles, unreached, windowStats, type Candle, type OhlcRow } from '@shared/history'
import ZoneEditor, { zoneColor } from '../components/ZoneEditor'
import HistoryHints, { windowLabel, windowPhrase } from '../components/HistoryHints'
import type { DraftDto, PairDto, SendResult, TemplateDto } from '@shared/ipc'
import { firstTestInput, wrongSide } from '@shared/safety'
import KpiStrip from '../components/ui/KpiStrip'
import { NumberField } from '../components/NumberField'
import PairPicker from '../components/PairPicker'
import AmountInput, { tidy } from '../components/AmountInput'
import HoldingsCard from '../components/HoldingsCard'
import { holdingsFor, sellablePairs } from '@shared/holdings'
import CenterSliders from '../components/CenterSliders'
import { MinOrderLine, RaisedNotice } from '../components/MinOrder'
import SectionCard from '../components/ui/SectionCard'
import Segmented from '../components/ui/Segmented'
import { SendSuccessModal } from '../components/SendSuccess'
import Modal from '../components/ui/Modal'
import { useChartTheme } from '../utils/chartTheme'
import { dateLocale, num, numberFormat, pct } from '../format'
import { tr } from '@shared/i18n'
import { parseWeightList, toInputText } from '@shared/number-format'
import { useMoney } from '../money'
import { activeExchange, exName, FIRST_TEST_MAX_EUR, probeHint, probeOk } from '@shared/exchanges'

const curves = (): { id: SizeCurve; label: string; title: string }[] => [
  { id: 'flat', label: tr('Gleich', 'Equal'), title: tr('Jede Stufe gleich groß', 'Every level the same size') },
  { id: 'linear', label: 'Linear', title: tr('Wächst gleichmäßig von Stufe zu Stufe', 'Grows evenly from level to level') },
  { id: 'log', label: tr('Logarithmisch', 'Logarithmic'), title: tr('Wächst am Anfang schnell, dann flacher', 'Grows fast at first, then flattens') },
  { id: 'exp', label: tr('Exponentiell', 'Exponential'), title: tr('Wächst am Anfang langsam, am Ende stark', 'Grows slowly at first, strongly at the end') },
  { id: 'fib', label: 'Fibonacci', title: tr('Stufen im Verhältnis 1, 1, 2, 3, 5, 8 … (jede Stufe so groß wie die beiden davor)', 'Levels in the ratio 1, 1, 2, 3, 5, 8 … (each level as big as the two before it)') },
  { id: 'custom', label: tr('Eigene Prozente', 'Custom percentages'), title: tr('Du gibst für jede Stufe selbst den Anteil vor', 'You set the share of every level yourself') },
]

const RANGES: { id: number; label: () => string; interval: number; days: number }[] = [
  { id: 30, label: () => tr('30 T', '30 d'), interval: 60, days: 30 },
  { id: 90, label: () => tr('90 T', '90 d'), interval: 240, days: 90 },
  { id: 365, label: () => tr('1 J', '1 y'), interval: 1440, days: 365 },
]

export interface Prefill {
  pairId: string
  input: LadderInput
  postOnly?: boolean
  sendCount?: number
  /** Entwurf, der gerade bearbeitet wird */
  draft?: DraftDto
}

/** Kurzer Vorschlag für den Namen eines Entwurfs */
export const draftTitle = (pairName: string, input: LadderInput) => tr(
  `${pairName.split('/')[0]} ${input.side === 'buy' ? 'Kauf' : 'Verkauf'} ${input.steps} Stufen`,
  `${pairName.split('/')[0]} ${input.side === 'buy' ? 'buy' : 'sell'} ${input.steps} levels`,
)

/** Prozentliste als Text im gewählten Zahlenformat */
const weightsText = (w?: number[]) => (w ?? []).map((x) => toInputText(x, numberFormat())).join(numberFormat() === 'de' ? '; ' : ', ')

const spacings = (): { id: PriceSpacing; label: string; title: string }[] => [
  { id: 'linear', label: tr('Gleiche €-Abstände', 'Equal € steps'), title: tr('Zwischen zwei Stufen liegt immer derselbe Betrag', 'Always the same amount between two levels') },
  { id: 'geometric', label: tr('Gleiche %-Abstände', 'Equal % steps'), title: tr('Zwischen zwei Stufen liegt immer derselbe Prozentsatz (logarithmisch)', 'Always the same percentage between two levels (logarithmic)') },
]

export { NumberField }

export default function PlannerPage({ hasKey, onNeedKey, prefill, onPrefillUsed, onOpenDrafts, onOpenOrders, onOpenSettings, active = true }: { hasKey: boolean; onNeedKey: () => void; prefill?: Prefill | null; onPrefillUsed?: () => void; onOpenDrafts?: () => void; onOpenOrders?: () => void; onOpenSettings?: () => void; active?: boolean }): JSX.Element {
  const theme = useChartTheme()
  const { eur, fmtPrice, sym, usdHint } = useMoney()
  const [watchlist, setWatchlist] = useState<string[]>([])
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
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [templateId, setTemplateId] = useState('')
  const [saveAs, setSaveAs] = useState<string | null>(null)
  const [range, setRange] = useState(90)
  const [candles, setCandles] = useState<OhlcRow[]>([])
  /** Tageskerzen (bis etwa 1 Jahr) für Tief- und Höchstkurse und „wie oft erreicht“ */
  const [daily, setDaily] = useState<Candle[]>([])
  const [fees, setFees] = useState<{ maker: number; taker: number } | null>(null)
  const [available, setAvailable] = useState<Record<string, number> | null>(null)
  /** Gesamtguthaben (frei + gesperrt, bei Kraken auch Earn) und Kurse für die Bestandsliste beim Verkaufen */
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [holdPrices, setHoldPrices] = useState<Record<string, number>>({})
  const [holdLoading, setHoldLoading] = useState(false)
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
    api().templates().then(setTemplates)
    api().settings().then((s) => setWatchlist(s.watchlist ?? []))
  }, [])

  function toggleWatch(name: string) {
    const next = watchlist.includes(name) ? watchlist.filter((x) => x !== name) : [...watchlist, name]
    setWatchlist(next)
    api().saveSettings({ watchlist: next })
  }

  // Vorschlag von „Offene Orders“ (Gewinnstaffel) übernehmen
  useEffect(() => {
    if (!prefill) return
    setKeepPrices(true)
    setPairId(prefill.pairId)
    setInput(prefill.input)
    if (prefill.postOnly !== undefined) setPostOnly(prefill.postOnly)
    setSendCount(prefill.sendCount ?? null)
    setCustomText(weightsText(prefill.input.customWeights))
    setDraft(prefill.draft ?? null)
    setDraftMsg(null)
    setResult(null)
    onPrefillUsed?.()
  }, [prefill])

  // Guthaben und Gebühren nur mit Schlüssel
  useEffect(() => {
    if (!hasKey || !pairId) return
    api().fees(pairId).then(setFees).catch(() => setFees(null))
    api().available().then(setAvailable).catch(() => setAvailable(null))
  }, [hasKey, pairId, result])

  // Bestand beim Verkaufen: freies und gesamtes Guthaben, dazu die Kurse der eigenen Coins für den Wert
  const selling = input.side === 'sell'
  useEffect(() => {
    if (!hasKey || !selling || !pairs.length) return
    let gone = false
    setHoldLoading(true)
    Promise.all([api().available(), api().balances().catch(() => ({} as Record<string, number>))]).then(async ([free, all]) => {
      if (gone) return
      setAvailable(free)
      setBalances(all)
      const ids = holdingsFor(pairs, free, all).map((h) => h.pair.id)
      const ps = ids.length ? await api().prices(ids).catch(() => ({} as Record<string, number>)) : {}
      if (!gone) setHoldPrices(ps)
    }).catch(() => undefined).finally(() => { if (!gone) setHoldLoading(false) })
    return () => { gone = true }
  }, [hasKey, selling, pairs, result])

  useEffect(() => {
    if (!pairId) return
    const r = RANGES.find((x) => x.id === range)!
    const since = Date.now() / 1000 - r.days * 86400
    api().ohlc(pairId, r.interval).then((c) => setCandles(c.filter(([t]) => t >= since))).catch(() => setCandles([]))
  }, [pairId, range])
  useEffect(() => {
    if (!pairId) return
    setDaily([])
    api().ohlc(pairId, 1440).then((c) => setDaily(toCandles(c))).catch(() => setDaily([]))
  }, [pairId])

  function applyTemplate(id: string) {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (!t) return
    const p = pairs.find((x) => x.name === t.pairName)
    setKeepPrices(true)
    if (p) setPairId(p.id)
    setInput(t.input)
    setPostOnly(t.postOnly)
    setCustomText(weightsText(t.input.customWeights))
    setResult(null)
  }

  async function storeTemplate(name: string) {
    if (!pair || !name.trim()) return
    const t: TemplateDto = { id: String(Date.now()), name: name.trim(), pairName: pair.name, input, postOnly }
    await api().saveTemplate(t)
    setTemplates(await api().templates())
    setTemplateId(t.id)
    setSaveAs(null)
  }

  async function removeTemplate() {
    if (!templateId) return
    await api().deleteTemplate(templateId)
    setTemplates(await api().templates())
    setTemplateId('')
  }

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
  const quote = pair?.name.split('/')[1] ?? 'EUR'
  const base = pair?.name.split('/')[0] ?? ''
  const sendable = ladder?.levels.filter((l) => !l.problem) ?? []
  // Nur die ersten N Stufen (nah am Kurs) gehen jetzt raus, der Rest bleibt im Plan
  // Entschärfte Preiszonen bleiben im Plan, gehen aber jetzt nicht raus
  const held = heldZones(input)
  const armedLevels = sendable.filter((l) => !isHeld(l, held))
  const heldLevels = sendable.filter((l) => isHeld(l, held))
  const nowCount = sendCount ? Math.min(sendCount, armedLevels.length) : armedLevels.length
  const toSend = armedLevels.slice(0, nowCount)
  const nowCost = toSend.reduce((a, l) => a + l.cost, 0)
  const nowVolume = toSend.reduce((a, l) => a + l.volume, 0)
  const partial = nowCount < armedLevels.length
  const later = new Set([...armedLevels.slice(nowCount), ...heldLevels].map((l) => l.index))

  // Gebühren und Guthaben (für das, was jetzt gesendet wird)
  const feePct = fees ? (postOnly ? fees.maker : fees.taker) : null
  const feeEur = ladder && feePct !== null ? (nowCost * feePct) / 100 : null
  const needAsset = pair ? (input.side === 'buy' ? pair.quote : pair.base) : ''
  const need = input.side === 'buy' ? nowCost + (feeEur ?? 0) : nowVolume
  const have = available && needAsset ? available[needAsset] ?? 0 : null
  const shortfall = have !== null && nowCost > 0 && have + 1e-12 < need
  const watched = pairs.filter((p) => watchlist.includes(p.name))
  // Stufen auf der falschen Seite des Kurses würden sofort ausgeführt (oder mit Post-only sofort storniert)
  const wrong = wrongSide(input.side, toSend.map((l) => l.price), last)
  // Über der Obergrenze pro Plan schickt der Hauptprozess nichts raus. Lieber vorher sagen als hinterher.
  const overLimit = limit !== null && nowCost > limit + 1e-9
  // Rückblick: wie oft der Kurs die Stufen im gewählten Zeitraum erreicht hat (Tageskerzen)
  const nowSec = Date.now() / 1000
  const reachOf = (price: number) => (daily.length ? reach(daily, input.side, price, range, nowSec) : null)
  const covered = daily.length ? windowStats(daily, range, nowSec)?.covered ?? range : range
  const never = daily.length && sendable.length ? unreached(sendable, daily, input.side, range, nowSec) : null
  // Tief und Hoch im Chart-Zeitraum
  const chartLow = candles.length ? Math.min(...candles.map((c) => c[2] ?? c[1])) : null
  const chartHigh = candles.length ? Math.max(...candles.map((c) => c[3] ?? c[1])) : null
  const extreme = input.side === 'buy' ? chartLow : chartHigh

  function openDraftForm() {
    if (!pair) return
    api().drafts().then((ds) => setScenarios([...new Set(ds.map((d) => d.scenario).filter(Boolean))])).catch(() => setScenarios([]))
    setDraftForm({ name: draft?.name ?? draftTitle(pair.name, input), scenario: draft?.scenario ?? '', note: draft?.note ?? '', alarm: draft?.alarm ?? true })
  }

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
        setDraftMsg(tr(`Der Entwurf „${draft.name}“ ist jetzt freigegeben (Plan-Nummer ${r.userref}).`, `The draft “${draft.name}” is now released (plan number ${r.userref}).`))
        setDraft(null)
      }
    } catch (e) {
      setSendError((e as Error).message)
    } finally {
      setBusy(null)
      setConfirm(false)
    }
  }

  const ok = result?.orders.filter((o) => !o.error).length ?? 0
  const failed = result?.orders.filter((o) => o.error) ?? []

  return (
    <div className="page">
      <header className="mb-5 page-header">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">{tr('Planer', 'Planner')}</h1>
          <p className="page-subtitle">{tr(`Viele Limit-Orders auf einmal planen, prüfen und an ${exName()} senden.`, `Plan, check and send many limit orders to ${exName()} at once.`)}</p>
        </div>
        <div className="ml-auto flex flex-shrink-0 items-center gap-2" data-guide="actions">
          <button type="button" className="btn btn-ghost" onClick={openFirstTest} title={tr('Einen kleinen, sicheren Plan für den ersten echten Test laden (bis 50 €)', 'Load a small, safe plan for your first real test (up to 50 €)')}>
            <GraduationCap size={16} /> {tr('Erster Test', 'First test')}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!ladder?.valid || !!busy} onClick={openDraftForm} title={tr('Zwischenspeichern und später im Reiter „Entwürfe“ freigeben', 'Save for now and release later in the “Drafts” tab')}>
            <ClipboardList size={16} /> {tr('Als Entwurf', 'Save as draft')}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!hasKey || !ladder?.valid || !!busy} onClick={() => run(true)} title={probeHint()}>
            <FlaskConical size={16} /> {busy === 'validate' ? tr('Prüfe …', 'Checking …') : tr('Probelauf', 'Test run')}
          </button>
          <button type="button" data-primary-action className="btn btn-primary" disabled={!hasKey || !ladder?.valid || !!busy || !!shortfall} onClick={() => { setConfirm(true); api().settings().then((s) => setLimit(s.maxPlanEur)).catch(() => undefined) }}>
            <Send size={16} /> {tr(`An ${exName()} senden`, `Send to ${exName()}`)}
          </button>
        </div>
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

      <section className="card mb-4 p-4" data-guide="pair">
        <div className="grid grid-cols-1 items-start gap-4 @md:grid-cols-2 @xl:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <span className="label">{tr('Handelspaar', 'Trading pair')}</span>
            <span className="flex gap-2">
              <PairPicker pairs={pickable} value={pairId} watchlist={watchlist} onChange={(id) => { setPairId(id); setResult(null) }} />
              {pair && (
                <button type="button" className="btn btn-ghost btn-icon flex-shrink-0" aria-pressed={watchlist.includes(pair.name)} onClick={() => toggleWatch(pair.name)}
                  aria-label={watchlist.includes(pair.name) ? tr('Von der Watchlist nehmen', 'Remove from watchlist') : tr('Auf die Watchlist', 'Add to watchlist')} title={watchlist.includes(pair.name) ? tr('Von der Watchlist nehmen', 'Remove from watchlist') : tr('Auf die Watchlist', 'Add to watchlist')}>
                  <Star size={16} className={watchlist.includes(pair.name) ? 'fill-current text-accent-fg' : ''} />
                </button>
              )}
            </span>
            {watched.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {watched.map((p) => (
                  <button key={p.id} type="button" className={`btn-chip ${p.id === pairId ? 'segmented-on' : ''}`} aria-pressed={p.id === pairId} onClick={() => { setPairId(p.id); setResult(null) }}>{p.name.split('/')[0]}</button>
                ))}
              </div>
            )}
            <span className="mt-1.5 flex items-center gap-2 text-xs text-ink-muted">
              {tr('Aktueller Kurs', 'Current price')}: {last && pair ? `${fmtPrice(last, pair.priceDecimals)} ${sym}` : '…'}
              <button type="button" className="btn-mini" onClick={() => loadPrice(false)} aria-label={tr('Kurs neu laden', 'Reload price')} title={tr('Kurs neu laden', 'Reload price')}><RefreshCw size={14} /></button>
            </span>
          </div>
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

      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-[22rem_1fr]">
        <div data-guide="plan" className="min-w-0"><SectionCard title={tr('Plan', 'Plan')} action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaveAs(templateId ? templates.find((t) => t.id === templateId)?.name ?? '' : '')} title={tr('Diesen Plan als Vorlage speichern', 'Save this plan as a template')}><BookmarkPlus size={14} /> {tr('Als Vorlage', 'Save as template')}</button>}>
          <div className="space-y-4">
            {templates.length > 0 && (
              <label className="block">
                <span className="label">{tr('Vorlage', 'Template')}</span>
                <span className="flex gap-2">
                  <select className="select w-full" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                    <option value="">{tr('Keine Vorlage', 'No template')}</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.pairName}</option>)}
                  </select>
                  {templateId && <button type="button" className="btn btn-ghost btn-icon flex-shrink-0" onClick={removeTemplate} aria-label={tr('Vorlage löschen', 'Delete template')} title={tr('Vorlage löschen', 'Delete template')}><Trash2 size={16} /></button>}
                </span>
              </label>
            )}
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
              <NumberField label={tr('Davon jetzt senden', 'Send now')} step="1" value={sendCount ?? armedLevels.length}
                onChange={(v) => setSendCount(Number.isFinite(v) && v > 0 && Math.round(v) < armedLevels.length ? Math.round(v) : null)}
                hint={partial ? tr(`Die ${nowCount} Stufen nah am Kurs. Den Rest sendest du später unter „Offene Orders“.`, `The ${nowCount} levels close to the price. Send the rest later under “Open orders”.`) : tr('Alle Stufen', 'All levels')} />
            </div>
            {pair && <MinOrderLine userMin={minOrder} price={input.priceStart} rules={pair} pairName={pair.name} eur={eur} onOpenSettings={onOpenSettings} />}
            <div>
              <span className="label">{tr('Preisabstände', 'Price spacing')}</span>
              <Segmented<PriceSpacing> block value={input.spacing} onChange={(v) => set('spacing', v)} options={spacings()} />
            </div>
            <div>
              <span className="label">{tr('Mengenverteilung', 'Size distribution')}</span>
              <select className="select w-full" value={input.curve} disabled={!!input.perLevel} onChange={(e) => set('curve', e.target.value as SizeCurve)}>
                {curves().filter((c) => !zoned || c.id !== 'custom').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <span className="mt-1 block text-xs text-ink-muted">{input.perLevel
                ? tr(`Bei „Pro Stufe“ ist jede Stufe gleich groß. Die Verteilung gilt erst wieder mit „Gesamt“.${zoned ? ' Die Anteile der Zonen zählen dann auch nicht, jede Stufe bekommt denselben Wert.' : ''}`, `With “Per level” every level is the same size. The distribution applies again with “Total”.${zoned ? ' Zone shares do not count either, every level gets the same value.' : ''}`)
                : <>{curves().find((c) => c.id === input.curve)?.title}{zoned && tr('. Gilt innerhalb jeder Zone.', '. Applies within each zone.')}</>}</span>
            </div>
            {input.curve === 'custom' && !zoned && !input.perLevel && (
              <label className="block">
                <span className="label">{tr('Anteil je Stufe in %', 'Share per level in %')}</span>
                <input className="input w-full tabular-nums" value={customText} placeholder={numberFormat() === 'de' ? tr('z. B. 12,5; 12,5; 25; 50', 'e.g. 12,5; 12,5; 25; 50') : tr('z. B. 12.5, 12.5, 25, 50', 'e.g. 12.5, 12.5, 25, 50')}
                  onChange={(e) => { setCustomText(e.target.value); set('customWeights', parseWeightList(e.target.value, numberFormat())) }} />
                <span className="mt-1 block text-xs text-ink-muted">
                  {tr(
                    `${input.steps} Werte, getrennt mit ${numberFormat() === 'de' ? 'Semikolon oder Leerzeichen (Komma ist das Dezimalzeichen)' : 'Komma'}. Summe ${num((input.customWeights ?? []).filter(Number.isFinite).reduce((a, b) => a + b, 0), 1)} % (wird auf 100 % umgerechnet).`,
                    `${input.steps} values, separated by ${numberFormat() === 'de' ? 'semicolon or space (comma is the decimal sign)' : 'comma'}. Sum ${num((input.customWeights ?? []).filter(Number.isFinite).reduce((a, b) => a + b, 0), 1)} % (scaled to 100 %).`,
                  )}
                </span>
              </label>
            )}
            {['linear', 'log', 'exp'].includes(input.curve) && !input.perLevel && (
              <NumberField label={tr('Letzte Stufe im Verhältnis zur ersten', 'Last level relative to the first')} value={input.ratio} onChange={(v) => set('ratio', v)}
                hint={input.ratio >= 1 ? tr(`Die letzte Stufe ist ${num(input.ratio, 2)}× so groß wie die erste.`, `The last level is ${num(input.ratio, 2)}× the size of the first.`) : tr('Unter 1: die Stufen werden kleiner.', 'Below 1: the levels get smaller.')} />
            )}
            {ladder?.centers && (
              <CenterSliders side={input.side} steps={input.steps} centers={ladder.centers} shares={ladder.levels.map((l) => l.share)}
                orderCenter={input.orderCenter} volumeCenter={input.volumeCenter} priceStart={input.priceStart} priceEnd={input.priceEnd}
                formatPrice={(p) => `${fmtPrice(p, p >= 100 ? 0 : Math.min(pair?.priceDecimals ?? 2, 2))} ${sym}`} onChange={(k, v) => set(k, v)}
                volumeOff={input.perLevel ? tr('Bei „Pro Stufe“ ist jede Stufe gleich groß.', 'With “Per level” every level is the same size.') : undefined} />
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="checkbox mt-0.5" checked={postOnly} onChange={(e) => setPostOnly(e.target.checked)} />
              <span>
                {tr('Nur als Limit-Order ins Orderbuch (Post-only)', 'Only as limit order into the order book (post-only)')}
                <span className="block text-xs text-ink-muted">{tr('Verhindert, dass eine Stufe sofort zum Marktpreis ausgeführt wird, wenn der Preis falsch eingegeben ist.', 'Prevents a level from being filled immediately at market price if the price was entered wrongly.')}</span>
              </span>
            </label>
          </div>
        </SectionCard></div>

        <div className="min-w-0 space-y-4" data-guide="result">
          {ladder && (
            <KpiStrip items={[
              { label: tr('Stufen', 'Levels'), value: `${sendable.length} / ${input.steps}`, tone: sendable.length < input.steps ? 'warning' : 'default', hint: partial || heldLevels.length ? tr(`${nowCount} jetzt, ${sendable.length - nowCount} später`, `${nowCount} now, ${sendable.length - nowCount} later`) : undefined },
              { label: partial ? tr('Gegenwert jetzt', 'Value now') : tr('Gegenwert', 'Value'), value: eur(partial ? nowCost : ladder.totalCost), tone: overLimit ? 'warning' : 'default', hint: feeEur !== null ? tr(`+ ca. ${eur(feeEur)} Gebühr (${num(feePct ?? 0, 2)} %)`, `+ approx. ${eur(feeEur)} fee (${num(feePct ?? 0, 2)} %)`) : partial ? tr(`von ${eur(ladder.totalCost)} gesamt`, `of ${eur(ladder.totalCost)} total`) : undefined },
              { label: tr(`Menge ${base}`, `Volume ${base}`), value: num(ladder.totalVolume, pair?.volumeDecimals) },
              { label: tr('Ø Preis bei voller Ausführung', 'Avg. price if fully filled'), value: ladder.averagePrice ? fmtPrice(ladder.averagePrice, pair?.priceDecimals ?? 2) : '–', hint: last && ladder.averagePrice ? pct(ladder.averagePrice / last - 1) + tr(' zum Kurs', ' vs. price') : undefined },
            ]} />
          )}
          {ladder && ladder.errors.length > 0 && (
            <div className="notice notice-warning space-y-1">{ladder.errors.map((e) => <p key={e}>{e}</p>)}</div>
          )}
          {heldLevels.length > 0 && zoned && (
            <p className="notice notice-accent flex items-start gap-2 text-xs">
              <ShieldOff size={14} className="mt-0.5 flex-shrink-0" />
              <span>{[...held].map((z) => {
                const t = zoneTrigger(input.zones!, z)
                const cost = heldLevels.filter((l) => l.zone === z).reduce((a, l) => a + l.cost, 0)
                return <span key={z} className="block">{tr(
                  <><strong>Zone {z + 1} ist entschärft.</strong> {input.side === 'buy' ? eur(cost) : `≈ ${eur(cost)}`} gehen beim Senden noch nicht raus und sperren kein Guthaben. Unter „Offene Orders“ leuchtet „Zone {z + 1} scharf schalten“ auf, sobald Zone {t.zone + 1} zu {t.percent} % ausgeführt ist.</>,
                  <><strong>Zone {z + 1} is disarmed.</strong> {input.side === 'buy' ? eur(cost) : `≈ ${eur(cost)}`} will not be sent yet and lock no funds. Under “Open orders”, “Arm zone {z + 1}” lights up once zone {t.zone + 1} is {t.percent} % filled.</>,
                )}</span>
              })}</span>
            </p>
          )}
          {never && never.count > 0 && ladder && (
            <p className="notice notice-info flex items-start gap-2 text-xs">
              <History size={14} className="mt-0.5 flex-shrink-0" />
              <span>{tr(
                <><strong>{never.count} von {sendable.length} Stufen</strong> hat der Kurs {windowPhrase(range, covered)} nie erreicht. Darin stecken {eur(never.cost)} ({pct(ladder.totalCost > 0 ? never.cost / ladder.totalCost : 0)} des Plans). Solche Orders sperren Guthaben und wären zuletzt nicht ausgeführt worden. Das kann gewollt sein (Absicherung für einen tiefen Fall), ist aber gut zu wissen.</>,
                <><strong>{never.count} of {sendable.length} levels</strong> were never reached by the price {windowPhrase(range, covered)}. They hold {eur(never.cost)} ({pct(ladder.totalCost > 0 ? never.cost / ladder.totalCost : 0)} of the plan). Such orders lock funds and would not have been filled recently. That can be on purpose (a reserve for a deep drop), but it is good to know.</>,
              )}</span>
            </p>
          )}
          {ladder && pair && <RaisedNotice ladder={ladder} input={input} rules={pair} userMin={minOrder} base={base} eur={eur} />}
          {overLimit && limit !== null && (
            <p className="notice notice-warning flex flex-wrap items-start gap-x-3 gap-y-1">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span className="min-w-0 flex-1">{tr(
                <><strong>Über deiner Obergrenze von {eur(limit)} pro Plan.</strong> Aus Sicherheitsgründen steht sie am Anfang auf 50 €, damit dein erster echter Test klein bleibt. So wird nichts gesendet. Verkleinere den Betrag, sende mit „Davon jetzt senden“ erst einen Teil, oder hebe die Grenze in den Einstellungen an.</>,
                <><strong>Above your limit of {eur(limit)} per plan.</strong> For safety it starts at 50 € so your first real test stays small. Nothing will be sent like this. Lower the amount, send only part of it with “Send now”, or raise the limit in Settings.</>,
              )}</span>
              {onOpenSettings && <button type="button" className="btn-link" onClick={onOpenSettings}>{tr('Zu den Einstellungen', 'Open settings')}</button>}
            </p>
          )}
          {shortfall && (
            <p className="notice notice-danger">
              {tr(
                `Nicht genug verfügbares Guthaben: Du brauchst ${input.side === 'buy' ? eur(need) : `${num(need, pair?.volumeDecimals)} ${base}`}, verfügbar sind ${input.side === 'buy' ? eur(have ?? 0) : `${num(have ?? 0, pair?.volumeDecimals)} ${base}`}. Guthaben in offenen Orders ist schon abgezogen, denn jede offene Order sperrt ihren Betrag.`,
                `Not enough available balance: you need ${input.side === 'buy' ? eur(need) : `${num(need, pair?.volumeDecimals)} ${base}`}, available is ${input.side === 'buy' ? eur(have ?? 0) : `${num(have ?? 0, pair?.volumeDecimals)} ${base}`}. Funds in open orders are already deducted, because every open order locks its amount.`,
              )}
            </p>
          )}
          {!shortfall && have !== null && ladder && ladder.totalCost > 0 && (
            <p className="text-xs text-ink-muted">{tr(
              `Verfügbar: ${input.side === 'buy' ? eur(have) : `${num(have, pair?.volumeDecimals)} ${base}`}. Reicht für ${partial ? 'diese Sendung' : 'diesen Plan'}.`,
              `Available: ${input.side === 'buy' ? eur(have) : `${num(have, pair?.volumeDecimals)} ${base}`}. Enough for ${partial ? 'this send' : 'this plan'}.`,
            )}</p>
          )}
          {ladder && ladder.totalCost > 0 && (
            <p className="notice notice-info flex items-start gap-2 text-xs">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                {tr(
                  <><strong>Jede Order braucht echtes Guthaben.</strong> {exName()} sperrt beim Senden den vollen Betrag aller gesendeten Stufen ({input.side === 'buy' ? 'beim Kaufen Euro' : `beim Verkaufen ${base}`}), auch für Stufen weit weg vom Kurs, die vielleicht nie ausgeführt werden. Das Geld bleibt gesperrt, bis die Order ausgeführt oder storniert ist, und steht so lange nicht für andere Orders bereit. Mehr Orders als Guthaben geht nicht.{' '}
                  {partial ? `Mit „Davon jetzt senden“ sperrst du nur ${eur(nowCost)} für die ${nowCount} Stufen nah am Kurs.` : 'Tipp: Mit „Davon jetzt senden“ sperrst du erst einmal nur die Stufen nah am Kurs, oder du speicherst den Plan als Entwurf. Entwürfe sperren kein Geld.'}</>,
                  <><strong>Every order needs real funds.</strong> When sending, {exName()} locks the full amount of all sent levels ({input.side === 'buy' ? 'euro when buying' : `${base} when selling`}), even for levels far from the price that may never be filled. The money stays locked until the order is filled or cancelled and cannot be used for other orders meanwhile. You cannot place more orders than you have funds.{' '}
                  {partial ? `With “Send now” you only lock ${eur(nowCost)} for the ${nowCount} levels close to the price.` : 'Tip: with “Send now” you first lock only the levels close to the price, or save the plan as a draft. Drafts lock no money.'}</>,
                )}
              </span>
            </p>
          )}
          {wrong.length > 0 && (
            <p className="notice notice-danger flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                {tr(
                  `${wrong.length === 1 ? '1 Stufe liegt' : `${wrong.length} Stufen liegen`} ${input.side === 'buy' ? 'beim oder über dem' : 'beim oder unter dem'} aktuellen Kurs. ${postOnly ? `Mit Post-only storniert ${exName()} diese Orders sofort wieder.` : 'Diese Orders würden sofort zum Marktpreis ausgeführt.'} ${input.side === 'buy' ? 'Beim Kaufen liegen alle Stufen unter dem Kurs.' : 'Beim Verkaufen liegen alle Stufen über dem Kurs.'}`,
                  `${wrong.length === 1 ? '1 level is' : `${wrong.length} levels are`} ${input.side === 'buy' ? 'at or above' : 'at or below'} the current price. ${postOnly ? `With post-only, ${exName()} cancels these orders right away.` : 'These orders would be filled immediately at market price.'} ${input.side === 'buy' ? 'When buying, all levels are below the price.' : 'When selling, all levels are above the price.'}`,
                )}
              </span>
            </p>
          )}
          {sendError && <p className="notice notice-danger">{sendError}</p>}
          {result && (
            <div className={`notice ${failed.length ? 'notice-warning' : 'notice-success'}`}>
              {result.validate
                ? failed.length ? tr(`Probelauf: ${failed.length} Orders würden abgelehnt.`, `Test run: ${failed.length} orders would be rejected.`) : probeOk(ok)
                : tr(`${ok} Orders angelegt${failed.length ? `, ${failed.length} fehlgeschlagen` : ''}. Plan-Nummer ${result.userref}.`, `${ok} orders placed${failed.length ? `, ${failed.length} failed` : ''}. Plan number ${result.userref}.`)}
              {result.orders.some((o) => o.uncertain) && <p className="mt-1 text-xs font-medium">{tr('Die Verbindung brach ab. Schau unter „Offene Orders“ nach, was wirklich angelegt wurde, bevor du noch einmal sendest.', 'The connection dropped. Check under “Open orders” what was really placed before you send again.')}</p>}
              {failed.length > 0 && <p className="mt-1 text-xs">{tr('Grund', 'Reason')}: {failed[0].error}</p>}
            </div>
          )}

          {candles.length > 1 && ladder && (
            <SectionCard title={tr('Kurs und Stufen', 'Price and levels')} action={<Segmented<number> value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r.id, label: r.label() }))} />}>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={candles.map(([t, c]) => ({ t: t * 1000, c }))}>
                    <CartesianGrid {...theme.grid} />
                    <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} {...theme.axis}
                      tickFormatter={(v) => new Date(v).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' })} />
                    <YAxis {...theme.axis} width={70} tickFormatter={(v) => fmtPrice(v, 0)}
                      domain={[
                        (min: number) => Math.min(min, chartLow ?? min, ...sendable.map((l) => l.price)) * 0.98,
                        (max: number) => Math.max(max, chartHigh ?? max, ...sendable.map((l) => l.price)) * 1.02,
                      ]} />
                    <Tooltip {...theme.tooltip} labelFormatter={(v) => new Date(Number(v)).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })}
                      formatter={(v) => [fmtPrice(Number(v), pair?.priceDecimals ?? 2), tr('Kurs', 'Price')]} />
                    {zoned && input.zones!.map((z, i) => (
                      <ReferenceArea key={`z${i}`} y1={z.priceStart} y2={zoneEnd(z)} fill={zoneColor(theme.series, i)} fillOpacity={0.1} strokeOpacity={0} ifOverflow="extendDomain" />
                    ))}
                    {extreme !== null && (
                      <ReferenceLine y={extreme} stroke={theme.status.neutral} strokeDasharray="1 3" ifOverflow="extendDomain"
                        label={{ value: input.side === 'buy' ? tr('Tief', 'Low') : tr('Hoch', 'High'), position: 'insideBottomLeft', fill: theme.status.neutral, fontSize: 11 }} />
                    )}
                    {sendable.map((l) => (
                      <ReferenceLine key={l.index} y={l.price} stroke={input.side === 'buy' ? theme.status.good : theme.status.critical} strokeOpacity={later.has(l.index) ? 0.15 : 0.35 + 0.65 * (l.share / Math.max(...sendable.map((x) => x.share)))} strokeDasharray="4 3" />
                    ))}
                    <Line type="monotone" dataKey="c" stroke={theme.accent} {...theme.line} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-ink-muted">{tr('Gestrichelte Linien sind deine Stufen. Je kräftiger die Linie, desto größer die Stufe.', 'Dashed lines are your levels. The stronger the line, the bigger the level.')}{extreme !== null && tr(` Die gepunktete Linie ist der ${input.side === 'buy' ? 'Tiefstkurs' : 'Höchstkurs'} im gezeigten Zeitraum.`, ` The dotted line is the ${input.side === 'buy' ? 'lowest' : 'highest'} price in the period shown.`)}{zoned && tr(' Farbige Flächen sind deine Preiszonen.', ' Coloured areas are your price zones.')}{partial && tr(' Blasse Linien sind die Stufen für später.', ' Faint lines are the levels for later.')}</p>
            </SectionCard>
          )}

          {ladder && ladder.levels.length > 0 && (
            <SectionCard title={tr('Verteilung', 'Distribution')}>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ladder.levels.map((l) => ({ preis: l.price, betrag: Math.round(l.cost * 100) / 100, problem: !!l.problem }))}>
                    <CartesianGrid {...theme.grid} />
                    <XAxis dataKey="preis" {...theme.axis} tickFormatter={(v) => fmtPrice(v, 0)} />
                    <YAxis {...theme.axis} tickFormatter={(v) => eur(Number(v)).replace(/,00(?= )/, '')} width={70} />
                    <Tooltip {...theme.tooltip} formatter={(v) => [eur(Number(v)), tr('Gegenwert', 'Value')]} labelFormatter={(v) => `${tr('Preis', 'Price')} ${fmtPrice(Number(v), pair?.priceDecimals ?? 2)}`} />
                    <Bar dataKey="betrag" fill={theme.accent} radius={theme.bar.radius}>
                      {zoned && ladder.levels.map((l) => <Cell key={l.index} fill={zoneColor(theme.series, l.zone ?? 0)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )}

          {ladder && ladder.levels.length > 0 && (
            <SectionCard title={tr('Stufen', 'Levels')}>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>#</th><th className="num">{tr('Preis', 'Price')}</th><th className="num">{tr('Abstand', 'Distance')}</th><th className="num">{tr('Menge', 'Volume')} {base}</th><th className="num">{tr('Gegenwert', 'Value')}</th><th className="num">{tr('Anteil', 'Share')}</th>{daily.length > 0 && <th className="num" title={tr('An wie vielen Tagen der Kurs diese Stufe im gewählten Zeitraum erreicht hat', 'On how many days the price reached this level in the selected period')}>{tr(`Erreicht (${windowLabel(range, covered)})`, `Reached (${windowLabel(range, covered)})`)}</th>}<th>Status</th></tr>
                  </thead>
                  <tbody>
                    {ladder.levels.map((l) => {
                      const r = result?.orders.find((o) => o.index === l.index)
                      return (
                        <tr key={l.index}>
                          <td className="tabular-nums text-ink-muted">
                            {zoned && <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: zoneColor(theme.series, l.zone ?? 0) }} title={tr(`Zone ${(l.zone ?? 0) + 1}`, `Zone ${(l.zone ?? 0) + 1}`)} />}
                            {l.index + 1}
                          </td>
                          <td className="num">{fmtPrice(l.price, pair?.priceDecimals ?? 2)}</td>
                          <td className="num text-ink-muted">{last ? pct(l.price / last - 1) : '–'}</td>
                          <td className="num">{num(l.volume, pair?.volumeDecimals)}</td>
                          <td className="num">{eur(l.cost)}</td>
                          <td className="num text-ink-muted">{pct(l.share)}</td>
                          {daily.length > 0 && (() => {
                            const rc = reachOf(l.price)
                            if (!rc) return <td className="num">–</td>
                            const when = rc.lastAt ? new Date(rc.lastAt * 1000).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''
                            return (
                              <td className={`num ${rc.hits === 0 ? 'text-warning-fg' : 'text-ink-muted'}`} title={rc.hits ? tr(`an ${rc.hits} von ${rc.of} Tagen, zuletzt am ${when}`, `on ${rc.hits} of ${rc.of} days, last on ${when}`) : tr(`an keinem der letzten ${rc.of} Tage`, `on none of the last ${rc.of} days`)}>
                                {rc.hits ? tr(`${rc.hits} T`, `${rc.hits} d`) : tr('nie', 'never')}
                              </td>
                            )
                          })()}
                          <td className="text-xs">
                            {l.problem ? <span className="text-warning-fg">{l.problem}</span>
                              : r?.error ? <span className="text-danger-fg">{r.error}</span>
                              : r ? <span className="text-success-fg">{result?.validate ? tr('geprüft', 'checked') : tr('angelegt', 'placed')}</span>
                              : isHeld(l, held) ? <span className="text-ink-faint">{tr('entschärft', 'disarmed')}</span>
                              : later.has(l.index) ? <span className="text-ink-faint">{tr('später', 'later')}</span>
                              : l.raised ? <span className="text-warning-fg" title={tr('Auf den Mindest-Orderwert angehoben', 'Raised to the minimum order value')}>{tr('angehoben', 'raised')}</span>
                              : <span className="text-ink-muted">{tr('bereit', 'ready')}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {saveAs !== null && (
        <Modal title={tr('Als Vorlage speichern', 'Save as template')} size="sm" onClose={() => setSaveAs(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setSaveAs(null)}>{tr('Abbrechen', 'Cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={!saveAs.trim()} onClick={() => storeTemplate(saveAs)}>{tr('Speichern', 'Save')}</button>
          </>}>
          <label className="block">
            <span className="label">{tr('Name', 'Name')}</span>
            <input className="input w-full" autoFocus value={saveAs} placeholder={tr('z. B. BTC Dip 10 Stufen log', 'e.g. BTC dip 10 levels log')} onChange={(e) => setSaveAs(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && storeTemplate(saveAs)} />
          </label>
          <p className="mt-2 text-xs text-ink-muted">{tr('Gespeichert werden Paar, Richtung, Preise, Stufen, Betrag und Verteilung. Ein gleichnamiger Plan wird ersetzt.', 'Saved are pair, side, prices, levels, amount and distribution. A template with the same name is replaced.')}</p>
        </Modal>
      )}

      {draftForm && pair && (
        <Modal title={draft ? tr('Entwurf speichern', 'Save draft') : tr('Als Entwurf speichern', 'Save as draft')} size="sm" onClose={() => setDraftForm(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setDraftForm(null)}>{tr('Abbrechen', 'Cancel')}</button>
            {draft && <button type="button" className="btn btn-secondary" onClick={() => storeDraft(true)}>{tr('Als neuen Entwurf', 'As new draft')}</button>}
            <button type="button" className="btn btn-primary" onClick={() => storeDraft(false)}>{draft ? tr('Entwurf aktualisieren', 'Update draft') : tr('Speichern', 'Save')}</button>
          </>}>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="label">{tr('Name', 'Name')}</span>
              <input className="input w-full" autoFocus value={draftForm.name} onChange={(e) => setDraftForm({ ...draftForm, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">{tr('Szenario (optional)', 'Scenario (optional)')}</span>
              <input className="input w-full" list="draft-scenarios" value={draftForm.scenario} placeholder={tr('z. B. Crash, Bullrun, Nach dem Halving', 'e.g. Crash, Bull run, After the halving')} onChange={(e) => setDraftForm({ ...draftForm, scenario: e.target.value })} />
              <datalist id="draft-scenarios">{scenarios.map((x) => <option key={x} value={x} />)}</datalist>
              <span className="mt-1 block text-xs text-ink-muted">{tr('Entwürfe mit gleichem Szenario stehen zusammen.', 'Drafts with the same scenario are grouped together.')}</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="checkbox mt-0.5" checked={draftForm.alarm} onChange={(e) => setDraftForm({ ...draftForm, alarm: e.target.checked })} />
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
              <input className="input w-full" value={draftForm.note} placeholder={tr('z. B. nur freigeben, wenn BTC unter 60.000 € fällt', 'e.g. only release if BTC falls below 60,000 €')} onChange={(e) => setDraftForm({ ...draftForm, note: e.target.value })} />
            </label>
            <p className="text-xs text-ink-muted">{tr(
              `${input.side === 'buy' ? 'Kauf' : 'Verkauf'} ${pair.name}, ${nowCount} ${partial || heldLevels.length ? `von ${sendable.length} ` : ''}Stufen, ${eur(nowCost)}. Es geht nichts an ${exName()}. Freigeben kannst du den Entwurf im Reiter „Entwürfe“.`,
              `${input.side === 'buy' ? 'Buy' : 'Sell'} ${pair.name}, ${nowCount} ${partial || heldLevels.length ? `of ${sendable.length} ` : ''}levels, ${eur(nowCost)}. Nothing goes to ${exName()}. You can release the draft in the “Drafts” tab.`,
            )}</p>
          </div>
        </Modal>
      )}

      {firstTest && (
        <Modal title={tr('Ersten echten Test vorbereiten', 'Prepare your first real test')} size="md" onClose={() => setFirstTest(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setFirstTest(false)}>{tr('Abbrechen', 'Cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={loadFirstTest}>{tr('Mini-Plan laden', 'Load mini plan')}</button>
          </>}>
          <div className="space-y-3 text-sm">
            <p className="notice notice-warning">{tr(
              <><strong>Beim ersten Test kannst du höchstens 50 € pro Plan senden.</strong> Das ist eine Sicherheitsgrenze, kein Fehler. Ist ein Plan größer, schickt die App nichts ab und sagt dir Bescheid. Später hebst du die Grenze unter Einstellungen › Sicherheit an.</>,
              <><strong>For your first test you can send at most 50 € per plan.</strong> This is a safety limit, not a bug. If a plan is bigger, the app sends nothing and tells you so. Later you can raise the limit under Settings › Safety.</>,
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
                  <li>Unter <strong>Offene Orders</strong> nachsehen, ob beide Orders da sind, und den Plan <strong>stornieren</strong>.</li>
                  <li>Im <strong>Protokoll</strong> siehst du danach jeden Schritt mit Uhrzeit.</li>
                </>,
                <>
                  <li><strong>Load mini plan:</strong> buy BTC/EUR, 2 levels about 20 % below the price, just above your minimum order value ({eur(minOrder)}) and {exName()}’s minimum. The price will hardly fall that far, so the orders just sit there.</li>
                  <li>Click <strong>Test run</strong>. {probeHint()}.</li>
                  <li><strong>Send to {exName()}</strong> and confirm.</li>
                  <li>Check under <strong>Open orders</strong> that both orders are there, and <strong>cancel</strong> the plan.</li>
                  <li>Afterwards the <strong>Log</strong> shows every step with its time.</li>
                </>,
              )}
            </ol>
            {minOrder * 1.02 > FIRST_TEST_MAX_EUR && <p className="notice notice-danger">{tr(
              `Dein Mindest-Orderwert steht bei ${eur(minOrder)}. Schon eine einzige Order wäre damit größer als die 50-€-Grenze beim ersten Test, die App würde nichts senden. Senke ihn für den Test in den Einstellungen, zum Beispiel auf 10 €.`,
              `Your minimum order value is ${eur(minOrder)}. Even a single order would then be larger than the 50 € first-test limit, so the app would send nothing. Lower it in Settings for the test, for example to 10 €.`,
            )}</p>}
            {!hasKey && <p className="notice notice-info">{tr('Für Schritt 3 bis 5 brauchst du einen Schlüssel.', 'For steps 3 to 5 you need a key.')} <button type="button" className="btn-link" onClick={() => { setFirstTest(false); onNeedKey() }}>{tr('Schlüssel anlegen', 'Create key')}</button></p>}
            {onOpenOrders && <p className="text-xs text-ink-muted">{tr(<>Geht etwas schief, stoppt die <strong>Notbremse</strong> unter „Offene Orders“ alle offenen Orders auf einmal.</>, <>If something goes wrong, the <strong>emergency stop</strong> under “Open orders” stops all open orders at once.</>)}</p>}
          </div>
        </Modal>
      )}

      {sentInfo && <SendSuccessModal {...sentInfo} onClose={() => setSentInfo(null)} onOpenOrders={onOpenOrders} />}

      {confirm && ladder && pair && (
        <Modal title={tr('Orders wirklich senden?', 'Really send the orders?')} size="sm" onClose={() => !busy && setConfirm(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirm(false)}>{tr('Abbrechen', 'Cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={!!busy || overLimit} onClick={() => run(false)}>{busy ? tr('Sende …', 'Sending …') : tr(`${nowCount} Orders senden`, `Send ${nowCount} orders`)}</button>
          </>}>
          <div className="space-y-2 text-sm">
            {overLimit && limit !== null && <p className="notice notice-warning">{tr(
              <><strong>Über deiner Obergrenze von {eur(limit)} pro Plan.</strong> Zur Sicherheit wird so nichts gesendet. Am Anfang steht sie auf 50 €, damit der erste Test klein bleibt. Ändern kannst du sie unter Einstellungen › Sicherheit.</>,
              <><strong>Above your limit of {eur(limit)} per plan.</strong> For safety nothing is sent like this. It starts at 50 € so your first test stays small. You can change it under Settings › Safety.</>,
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
            {heldLevels.length > 0 && <p className="text-ink-muted">{tr(`Entschärft und nicht dabei: ${[...held].map((z) => `Zone ${z + 1}`).join(', ')} mit ${heldLevels.length} Stufen. Die schaltest du später unter „Offene Orders“ scharf.`, `Disarmed and not included: ${[...held].map((z) => `zone ${z + 1}`).join(', ')} with ${heldLevels.length} levels. You arm them later under “Open orders”.`)}</p>}
            {partial && <p className="text-ink-muted">{tr(`Die restlichen ${armedLevels.length - nowCount} Stufen bleiben im Plan. Du kannst sie später unter „Offene Orders“ mit „Rest senden“ nachschicken.`, `The remaining ${armedLevels.length - nowCount} levels stay in the plan. You can send them later under “Open orders” with “Send rest”.`)}</p>}
            <p>{tr(
              <>{exName()} sperrt dafür jetzt <strong>{input.side === 'buy' ? eur(nowCost) : `${num(toSend.reduce((a, l) => a + l.volume, 0), pair.volumeDecimals)} ${base}`}</strong> von deinem Guthaben, bis die Orders ausgeführt oder storniert sind.</>,
              <>{exName()} now locks <strong>{input.side === 'buy' ? eur(nowCost) : `${num(toSend.reduce((a, l) => a + l.volume, 0), pair.volumeDecimals)} ${base}`}</strong> of your balance for this until the orders are filled or cancelled.</>,
            )}</p>
            <p className="text-ink-muted">{tr(`Die Orders werden echt bei ${exName()} angelegt. Du kannst sie unter „Offene Orders“ jederzeit stornieren, solange sie noch nicht ausgeführt sind. Dann ist das Geld sofort wieder frei.`, `The orders are really placed at ${exName()}. You can cancel them any time under “Open orders” as long as they are not filled yet. The money is then free again right away.`)}</p>
            <p className="text-xs text-ink-muted">{tr('Hat dein Mac Touch ID, fragt er nach dem Klick noch nach deinem Finger.', 'If your Mac has Touch ID, it asks for your fingerprint after the click.')}</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
