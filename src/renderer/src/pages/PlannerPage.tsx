import { api } from '../api'
import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Bell, BookmarkPlus, ClipboardList, GraduationCap, FlaskConical, Info, RefreshCw, Send, Star, Trash2 } from 'lucide-react'
import { buildLadder, MAX_STEPS, type LadderInput, type PriceSpacing, type Side, type SizeCurve } from '@shared/ladder'
import type { DraftDto, PairDto, SendResult, TemplateDto } from '@shared/ipc'
import { firstTestInput, wrongSide } from '@shared/safety'
import KpiStrip from '../components/ui/KpiStrip'
import PairPicker from '../components/PairPicker'
import SectionCard from '../components/ui/SectionCard'
import Segmented from '../components/ui/Segmented'
import Modal from '../components/ui/Modal'
import { useChartTheme } from '../utils/chartTheme'
import { num, numberFormat, pct } from '../format'
import { parseNumber, parseWeightList, toInputText } from '@shared/number-format'
import { useMoney } from '../money'

const CURVES: { id: SizeCurve; label: string; title: string }[] = [
  { id: 'flat', label: 'Gleich', title: 'Jede Stufe gleich groß' },
  { id: 'linear', label: 'Linear', title: 'Wächst gleichmäßig von Stufe zu Stufe' },
  { id: 'log', label: 'Logarithmisch', title: 'Wächst am Anfang schnell, dann flacher' },
  { id: 'exp', label: 'Exponentiell', title: 'Wächst am Anfang langsam, am Ende stark' },
  { id: 'fib', label: 'Fibonacci', title: 'Stufen im Verhältnis 1, 1, 2, 3, 5, 8 … (jede Stufe so groß wie die beiden davor)' },
  { id: 'custom', label: 'Eigene Prozente', title: 'Du gibst für jede Stufe selbst den Anteil vor' },
]

const RANGES: { id: number; label: string; interval: number; days: number }[] = [
  { id: 30, label: '30 T', interval: 60, days: 30 },
  { id: 90, label: '90 T', interval: 240, days: 90 },
  { id: 365, label: '1 J', interval: 1440, days: 365 },
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
export const draftTitle = (pairName: string, input: LadderInput) => `${pairName.split('/')[0]} ${input.side === 'buy' ? 'Kauf' : 'Verkauf'} ${input.steps} Stufen`

/** Prozentliste als Text im gewählten Zahlenformat */
const weightsText = (w?: number[]) => (w ?? []).map((x) => toInputText(x, numberFormat())).join(numberFormat() === 'de' ? '; ' : ', ')

const SPACINGS: { id: PriceSpacing; label: string; title: string }[] = [
  { id: 'linear', label: 'Gleiche €-Abstände', title: 'Zwischen zwei Stufen liegt immer derselbe Betrag' },
  { id: 'geometric', label: 'Gleiche %-Abstände', title: 'Zwischen zwei Stufen liegt immer derselbe Prozentsatz (logarithmisch)' },
]

/**
 * Zahlenfeld im gewählten Format (Deutsch 1.234,56 oder Amerikanisch 1,234.56).
 * Ist der Text keine gültige Zahl, meldet das Feld NaN: der Plan wird dann ungültig,
 * statt still mit dem alten Wert weiterzurechnen.
 */
export function NumberField({ label, value, onChange, hint, step = 'any', emptyValue }: { label: string; value: number; onChange: (n: number) => void; hint?: string; step?: string; emptyValue?: number }) {
  const fmt = numberFormat()
  const [text, setText] = useState(toInputText(value, fmt))
  const [shownFmt, setShownFmt] = useState(fmt)
  useEffect(() => {
    // Wert kam von außen (Vorlage, Kursvorschlag) oder das Format wurde umgestellt
    if (fmt !== shownFmt) {
      // Text im alten Format lesen und im neuen schreiben; Ungültiges bleibt stehen, damit man es sieht
      const old = parseNumber(text, shownFmt)
      setShownFmt(fmt)
      if (!Number.isNaN(old)) setText(toInputText(old, fmt))
      else if (!Number.isNaN(parseNumber(text, fmt))) onChange(parseNumber(text, fmt)) // war ungültig, passt aber zum neuen Format
      return
    }
    const parsed = parseNumber(text, fmt)
    if (text.trim() !== '' && !Number.isNaN(parsed) && parsed !== value && Number.isFinite(value)) setText(toInputText(value, fmt))
  }, [value, fmt])
  const invalid = text.trim() !== '' && Number.isNaN(parseNumber(text, fmt))
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className={`input w-full tabular-nums ${invalid ? 'border-danger-500' : ''}`} inputMode="decimal" step={step} value={text} aria-invalid={invalid}
        onChange={(e) => {
          setText(e.target.value)
          const n = parseNumber(e.target.value, fmt)
          onChange(e.target.value.trim() === '' && emptyValue !== undefined ? emptyValue : n)
        }}
        onBlur={() => { if (text.trim() === '' && Number.isFinite(value)) setText(toInputText(value, fmt)) }} />
      {invalid
        ? <span className="mt-1 block text-xs text-danger-fg">Keine gültige Zahl. Gewählt ist das {fmt === 'de' ? 'deutsche Format, z. B. 60.000,50' : 'amerikanische Format, z. B. 60,000.50'} (umstellen links unten bei „Zahlenformat“).</span>
        : hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  )
}

export default function PlannerPage({ hasKey, onNeedKey, prefill, onPrefillUsed, onOpenDrafts, onOpenOrders }: { hasKey: boolean; onNeedKey: () => void; prefill?: Prefill | null; onPrefillUsed?: () => void; onOpenDrafts?: () => void; onOpenOrders?: () => void }): JSX.Element {
  const theme = useChartTheme()
  const { eur, fmtPrice, sym, usdHint } = useMoney()
  const [watchlist, setWatchlist] = useState<string[]>([])
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
  const [sendError, setSendError] = useState<string | null>(null)
  const [customText, setCustomText] = useState('')
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [templateId, setTemplateId] = useState('')
  const [saveAs, setSaveAs] = useState<string | null>(null)
  const [range, setRange] = useState(90)
  const [candles, setCandles] = useState<[number, number][]>([])
  const [fees, setFees] = useState<{ maker: number; taker: number } | null>(null)
  const [available, setAvailable] = useState<Record<string, number> | null>(null)
  // Beim Laden einer Vorlage oder eines Vorschlags den Kurs nicht überschreiben
  const [keepPrices, setKeepPrices] = useState(false)
  /** Entwurf, der gerade bearbeitet wird */
  const [draft, setDraft] = useState<DraftDto | null>(null)
  const [draftForm, setDraftForm] = useState<{ name: string; scenario: string; note: string; alarm: boolean } | null>(null)
  /** Fenster „Ersten Test vorbereiten“ */
  const [firstTest, setFirstTest] = useState(false)
  const [limit, setLimit] = useState<number | null>(null)
  const [scenarios, setScenarios] = useState<string[]>([])
  const [draftMsg, setDraftMsg] = useState<string | null>(null)

  const pair = pairs.find((p) => p.id === pairId)
  const set = <K extends keyof LadderInput>(k: K, v: LadderInput[K]) => {
    setInput((s) => ({ ...s, [k]: v }))
    setResult(null)
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

  useEffect(() => {
    if (!pairId) return
    const r = RANGES.find((x) => x.id === range)!
    const since = Date.now() / 1000 - r.days * 86400
    api().ohlc(pairId, r.interval).then((c) => setCandles(c.filter(([t]) => t >= since))).catch(() => setCandles([]))
  }, [pairId, range])

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
        setInput((s) => s.side === 'buy' ? { ...s, priceStart: +(p * 0.98).toPrecision(6), priceEnd: +(p * 0.8).toPrecision(6) } : { ...s, priceStart: +(p * 1.05).toPrecision(6), priceEnd: +(p * 1.4).toPrecision(6) })
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

  const ladder = useMemo(() => (pair ? buildLadder(input, pair) : null), [input, pair])
  const quote = pair?.name.split('/')[1] ?? 'EUR'
  const base = pair?.name.split('/')[0] ?? ''
  const sendable = ladder?.levels.filter((l) => !l.problem) ?? []
  // Nur die ersten N Stufen (nah am Kurs) gehen jetzt raus, der Rest bleibt im Plan
  const nowCount = sendCount ? Math.min(sendCount, sendable.length) : sendable.length
  const toSend = sendable.slice(0, nowCount)
  const nowCost = toSend.reduce((a, l) => a + l.cost, 0)
  const nowVolume = toSend.reduce((a, l) => a + l.volume, 0)
  const partial = nowCount < sendable.length
  const later = new Set(sendable.slice(nowCount).map((l) => l.index))

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
      const t = firstTestInput(p, btc)
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
    setDraftMsg(`Entwurf „${d.name}“ gespeichert. Es wurde nichts an Kraken gesendet.`)
  }

  async function run(validate: boolean) {
    if (!pair || !ladder) return
    setBusy(validate ? 'validate' : 'send')
    setSendError(null)
    setResult(null)
    try {
      // Wird gerade ein Entwurf bearbeitet, gilt er nach dem echten Senden als freigegeben (sonst ließe er sich ein zweites Mal senden)
      const r = await api().send({ pairId: pair.id, pairName: pair.name, side: input.side, input, levels: ladder.levels, validate, postOnly, sendCount: partial ? nowCount : undefined, draftId: validate ? undefined : draft?.id })
      setResult(r)
      if (!validate && draft && r.orders.some((o) => o.txid || o.uncertain)) {
        setDraftMsg(`Der Entwurf „${draft.name}“ ist jetzt freigegeben (Plan-Nummer ${r.userref}).`)
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
          <h1 className="page-title">Planer</h1>
          <p className="page-subtitle">Viele Limit-Orders auf einmal planen, prüfen und an Kraken senden.</p>
        </div>
        <div className="ml-auto flex flex-shrink-0 items-center gap-2" data-guide="actions">
          <button type="button" className="btn btn-ghost" onClick={openFirstTest} title="Einen kleinen, sicheren Plan für den ersten echten Test laden">
            <GraduationCap size={16} /> Erster Test
          </button>
          <button type="button" className="btn btn-secondary" disabled={!ladder?.valid || !!busy} onClick={openDraftForm} title="Zwischenspeichern und später im Reiter „Entwürfe“ freigeben">
            <ClipboardList size={16} /> Als Entwurf
          </button>
          <button type="button" className="btn btn-secondary" disabled={!hasKey || !ladder?.valid || !!busy} onClick={() => run(true)} title="Kraken prüft alle Orders, legt aber nichts an">
            <FlaskConical size={16} /> {busy === 'validate' ? 'Prüfe …' : 'Probelauf'}
          </button>
          <button type="button" data-primary-action className="btn btn-primary" disabled={!hasKey || !ladder?.valid || !!busy || !!shortfall} onClick={() => setConfirm(true)}>
            <Send size={16} /> An Kraken senden
          </button>
        </div>
      </header>

      {loadError && <p className="notice notice-danger mb-4">{loadError}</p>}
      {draft && (
        <p className="notice notice-accent mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
          <ClipboardList size={16} className="flex-shrink-0" />
          <span className="flex-1">Du bearbeitest den Entwurf <strong>{draft.name}</strong>. Änderungen speicherst du mit „Als Entwurf“.</span>
          <button type="button" className="btn-link" onClick={() => { setDraft(null); setDraftMsg(null) }}>Bearbeiten beenden</button>
        </p>
      )}
      {draftMsg && (
        <p className="notice notice-success mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex-1">{draftMsg}</span>
          {onOpenDrafts && <button type="button" className="btn-link" onClick={onOpenDrafts}>Zu den Entwürfen</button>}
        </p>
      )}
      {!hasKey && (
        <p className="notice notice-info mb-4">
          Planen geht auch ohne Schlüssel. Zum Prüfen und Senden brauchst du einen Kraken-API-Schlüssel.{' '}
          <button type="button" className="btn-link" onClick={onNeedKey}>Schlüssel hinterlegen</button>
        </p>
      )}

      <section className="card mb-4 p-4" data-guide="pair">
        <div className="grid grid-cols-1 items-start gap-4 @md:grid-cols-2 @xl:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <span className="label">Handelspaar</span>
            <span className="flex gap-2">
              <PairPicker pairs={pairs} value={pairId} watchlist={watchlist} onChange={(id) => { setPairId(id); setResult(null) }} />
              {pair && (
                <button type="button" className="btn btn-ghost btn-icon flex-shrink-0" aria-pressed={watchlist.includes(pair.name)} onClick={() => toggleWatch(pair.name)}
                  aria-label={watchlist.includes(pair.name) ? 'Von der Watchlist nehmen' : 'Auf die Watchlist'} title={watchlist.includes(pair.name) ? 'Von der Watchlist nehmen' : 'Auf die Watchlist'}>
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
              Aktueller Kurs: {last && pair ? `${fmtPrice(last, pair.priceDecimals)} ${sym}` : '…'}
              <button type="button" className="btn-mini" onClick={() => loadPrice(false)} aria-label="Kurs neu laden" title="Kurs neu laden"><RefreshCw size={14} /></button>
            </span>
          </div>
          <div>
            <span className="label">Richtung</span>
            <Segmented<Side> block size="md" value={input.side} onChange={(v) => set('side', v)} options={[{ id: 'buy', label: 'Kaufen' }, { id: 'sell', label: 'Verkaufen' }]} />
          </div>
          <NumberField label={input.side === 'buy' ? `Betrag zum Investieren (${quote})` : `Menge zum Verkaufen (${base})`} value={input.total} onChange={(v) => set('total', v)}
            hint={input.side === 'buy' ? usdHint(input.total) || 'Wird auf alle Stufen verteilt.' : last ? `≈ ${eur(input.total * last)}` : undefined} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-[22rem_1fr]">
        <div data-guide="plan" className="min-w-0"><SectionCard title="Plan" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaveAs(templateId ? templates.find((t) => t.id === templateId)?.name ?? '' : '')} title="Diesen Plan als Vorlage speichern"><BookmarkPlus size={14} /> Als Vorlage</button>}>
          <div className="space-y-4">
            {templates.length > 0 && (
              <label className="block">
                <span className="label">Vorlage</span>
                <span className="flex gap-2">
                  <select className="select w-full" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                    <option value="">Keine Vorlage</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.pairName}</option>)}
                  </select>
                  {templateId && <button type="button" className="btn btn-ghost btn-icon flex-shrink-0" onClick={removeTemplate} aria-label="Vorlage löschen" title="Vorlage löschen"><Trash2 size={16} /></button>}
                </span>
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <NumberField label={`Erste Stufe (${quote})`} value={input.priceStart} onChange={(v) => set('priceStart', v)} hint={last ? [pct(input.priceStart / last - 1) + ' zum Kurs', usdHint(input.priceStart)].filter(Boolean).join(' · ') : undefined} />
              <NumberField label={`Letzte Stufe (${quote})`} value={input.priceEnd} onChange={(v) => set('priceEnd', v)} hint={last ? [pct(input.priceEnd / last - 1) + ' zum Kurs', usdHint(input.priceEnd)].filter(Boolean).join(' · ') : undefined} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Anzahl Stufen" step="1" value={input.steps} onChange={(v) => set('steps', Math.round(v))} hint={`1 bis ${MAX_STEPS}`} />
              <NumberField label="Davon jetzt senden" step="1" value={sendCount ?? sendable.length}
                onChange={(v) => setSendCount(Number.isFinite(v) && v > 0 && Math.round(v) < sendable.length ? Math.round(v) : null)}
                hint={partial ? `Die ${nowCount} Stufen nah am Kurs. Den Rest sendest du später unter „Offene Orders“.` : 'Alle Stufen'} />
            </div>
            <div>
              <span className="label">Preisabstände</span>
              <Segmented<PriceSpacing> block value={input.spacing} onChange={(v) => set('spacing', v)} options={SPACINGS} />
            </div>
            <div>
              <span className="label">Mengenverteilung</span>
              <select className="select w-full" value={input.curve} onChange={(e) => set('curve', e.target.value as SizeCurve)}>
                {CURVES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <span className="mt-1 block text-xs text-ink-muted">{CURVES.find((c) => c.id === input.curve)?.title}</span>
            </div>
            {input.curve === 'custom' && (
              <label className="block">
                <span className="label">Anteil je Stufe in %</span>
                <input className="input w-full tabular-nums" value={customText} placeholder={numberFormat() === 'de' ? 'z. B. 12,5; 12,5; 25; 50' : 'z. B. 12.5, 12.5, 25, 50'}
                  onChange={(e) => { setCustomText(e.target.value); set('customWeights', parseWeightList(e.target.value, numberFormat())) }} />
                <span className="mt-1 block text-xs text-ink-muted">
                  {input.steps} Werte, getrennt mit {numberFormat() === 'de' ? 'Semikolon oder Leerzeichen (Komma ist das Dezimalzeichen)' : 'Komma'}. Summe {num((input.customWeights ?? []).filter(Number.isFinite).reduce((a, b) => a + b, 0), 1)} % (wird auf 100 % umgerechnet).
                </span>
              </label>
            )}
            {['linear', 'log', 'exp'].includes(input.curve) && (
              <NumberField label="Letzte Stufe im Verhältnis zur ersten" value={input.ratio} onChange={(v) => set('ratio', v)}
                hint={input.ratio >= 1 ? `Die letzte Stufe ist ${num(input.ratio, 2)}× so groß wie die erste.` : 'Unter 1: die Stufen werden kleiner.'} />
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="checkbox mt-0.5" checked={postOnly} onChange={(e) => setPostOnly(e.target.checked)} />
              <span>
                Nur als Limit-Order ins Orderbuch (Post-only)
                <span className="block text-xs text-ink-muted">Verhindert, dass eine Stufe sofort zum Marktpreis ausgeführt wird, wenn der Preis falsch eingegeben ist.</span>
              </span>
            </label>
          </div>
        </SectionCard></div>

        <div className="min-w-0 space-y-4" data-guide="result">
          {ladder && (
            <KpiStrip items={[
              { label: 'Stufen', value: `${sendable.length} / ${input.steps}`, tone: sendable.length < input.steps ? 'warning' : 'default', hint: partial ? `${nowCount} jetzt, ${sendable.length - nowCount} später` : undefined },
              { label: partial ? 'Gegenwert jetzt' : 'Gegenwert', value: eur(partial ? nowCost : ladder.totalCost), hint: feeEur !== null ? `+ ca. ${eur(feeEur)} Gebühr (${num(feePct ?? 0, 2)} %)` : partial ? `von ${eur(ladder.totalCost)} gesamt` : undefined },
              { label: `Menge ${base}`, value: num(ladder.totalVolume, pair?.volumeDecimals) },
              { label: 'Ø Preis bei voller Ausführung', value: ladder.averagePrice ? fmtPrice(ladder.averagePrice, pair?.priceDecimals ?? 2) : '–', hint: last && ladder.averagePrice ? pct(ladder.averagePrice / last - 1) + ' zum Kurs' : undefined },
            ]} />
          )}
          {ladder && ladder.errors.length > 0 && (
            <div className="notice notice-warning space-y-1">{ladder.errors.map((e) => <p key={e}>{e}</p>)}</div>
          )}
          {shortfall && (
            <p className="notice notice-danger">
              Nicht genug verfügbares Guthaben: Du brauchst {input.side === 'buy' ? eur(need) : `${num(need, pair?.volumeDecimals)} ${base}`}, verfügbar sind {input.side === 'buy' ? eur(have ?? 0) : `${num(have ?? 0, pair?.volumeDecimals)} ${base}`}. Guthaben in offenen Orders ist schon abgezogen, denn jede offene Order sperrt ihren Betrag.
            </p>
          )}
          {!shortfall && have !== null && ladder && ladder.totalCost > 0 && (
            <p className="text-xs text-ink-muted">Verfügbar: {input.side === 'buy' ? eur(have) : `${num(have, pair?.volumeDecimals)} ${base}`}. Reicht für {partial ? 'diese Sendung' : 'diesen Plan'}.</p>
          )}
          {ladder && ladder.totalCost > 0 && (
            <p className="notice notice-info flex items-start gap-2 text-xs">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                <strong>Jede Order braucht echtes Guthaben.</strong> Kraken sperrt beim Senden den vollen Betrag aller gesendeten Stufen ({input.side === 'buy' ? 'beim Kaufen Euro' : `beim Verkaufen ${base}`}), auch für Stufen weit weg vom Kurs, die vielleicht nie ausgeführt werden. Das Geld bleibt gesperrt, bis die Order ausgeführt oder storniert ist, und steht so lange nicht für andere Orders bereit. Mehr Orders als Guthaben geht nicht.{' '}
                {partial ? `Mit „Davon jetzt senden“ sperrst du nur ${eur(nowCost)} für die ${nowCount} Stufen nah am Kurs.` : 'Tipp: Mit „Davon jetzt senden“ sperrst du erst einmal nur die Stufen nah am Kurs, oder du speicherst den Plan als Entwurf. Entwürfe sperren kein Geld.'}
              </span>
            </p>
          )}
          {wrong.length > 0 && (
            <p className="notice notice-danger flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                {wrong.length === 1 ? '1 Stufe liegt' : `${wrong.length} Stufen liegen`} {input.side === 'buy' ? 'beim oder über dem' : 'beim oder unter dem'} aktuellen Kurs.{' '}
                {postOnly ? 'Mit Post-only storniert Kraken diese Orders sofort wieder.' : 'Diese Orders würden sofort zum Marktpreis ausgeführt.'}{' '}
                {input.side === 'buy' ? 'Beim Kaufen liegen alle Stufen unter dem Kurs.' : 'Beim Verkaufen liegen alle Stufen über dem Kurs.'}
              </span>
            </p>
          )}
          {sendError && <p className="notice notice-danger">{sendError}</p>}
          {result && (
            <div className={`notice ${failed.length ? 'notice-warning' : 'notice-success'}`}>
              {result.validate
                ? failed.length ? `Probelauf: ${failed.length} Orders würden abgelehnt.` : `Probelauf erfolgreich: Kraken würde alle ${ok} Orders annehmen. Es wurde nichts angelegt.`
                : `${ok} Orders angelegt${failed.length ? `, ${failed.length} fehlgeschlagen` : ''}. Plan-Nummer ${result.userref}.`}
              {result.orders.some((o) => o.uncertain) && <p className="mt-1 text-xs font-medium">Die Verbindung brach ab. Schau unter „Offene Orders“ nach, was wirklich angelegt wurde, bevor du noch einmal sendest.</p>}
              {failed.length > 0 && <p className="mt-1 text-xs">Grund: {failed[0].error}</p>}
            </div>
          )}

          {candles.length > 1 && ladder && (
            <SectionCard title="Kurs und Stufen" action={<Segmented<number> value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />}>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={candles.map(([t, c]) => ({ t: t * 1000, c }))}>
                    <CartesianGrid {...theme.grid} />
                    <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} {...theme.axis}
                      tickFormatter={(v) => new Date(v).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} />
                    <YAxis {...theme.axis} width={70} tickFormatter={(v) => fmtPrice(v, 0)}
                      domain={[
                        (min: number) => Math.min(min, ...sendable.map((l) => l.price)) * 0.98,
                        (max: number) => Math.max(max, ...sendable.map((l) => l.price)) * 1.02,
                      ]} />
                    <Tooltip {...theme.tooltip} labelFormatter={(v) => new Date(Number(v)).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                      formatter={(v) => [fmtPrice(Number(v), pair?.priceDecimals ?? 2), 'Kurs']} />
                    {sendable.map((l) => (
                      <ReferenceLine key={l.index} y={l.price} stroke={input.side === 'buy' ? theme.status.good : theme.status.critical} strokeOpacity={later.has(l.index) ? 0.15 : 0.35 + 0.65 * (l.share / Math.max(...sendable.map((x) => x.share)))} strokeDasharray="4 3" />
                    ))}
                    <Line type="monotone" dataKey="c" stroke={theme.accent} {...theme.line} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-ink-muted">Gestrichelte Linien sind deine Stufen. Je kräftiger die Linie, desto größer die Stufe.{partial && ' Blasse Linien sind die Stufen für später.'}</p>
            </SectionCard>
          )}

          {ladder && ladder.levels.length > 0 && (
            <SectionCard title="Verteilung">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ladder.levels.map((l) => ({ preis: l.price, betrag: Math.round(l.cost * 100) / 100, problem: !!l.problem }))}>
                    <CartesianGrid {...theme.grid} />
                    <XAxis dataKey="preis" {...theme.axis} tickFormatter={(v) => fmtPrice(v, 0)} />
                    <YAxis {...theme.axis} tickFormatter={(v) => eur(Number(v)).replace(/,00(?= )/, '')} width={70} />
                    <Tooltip {...theme.tooltip} formatter={(v) => [eur(Number(v)), 'Gegenwert']} labelFormatter={(v) => `Preis ${fmtPrice(Number(v), pair?.priceDecimals ?? 2)}`} />
                    <Bar dataKey="betrag" fill={theme.accent} radius={theme.bar.radius} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )}

          {ladder && ladder.levels.length > 0 && (
            <SectionCard title="Stufen">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>#</th><th className="num">Preis</th><th className="num">Abstand</th><th className="num">Menge {base}</th><th className="num">Gegenwert</th><th className="num">Anteil</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {ladder.levels.map((l) => {
                      const r = result?.orders.find((o) => o.index === l.index)
                      return (
                        <tr key={l.index}>
                          <td className="tabular-nums text-ink-muted">{l.index + 1}</td>
                          <td className="num">{fmtPrice(l.price, pair?.priceDecimals ?? 2)}</td>
                          <td className="num text-ink-muted">{last ? pct(l.price / last - 1) : '–'}</td>
                          <td className="num">{num(l.volume, pair?.volumeDecimals)}</td>
                          <td className="num">{eur(l.cost)}</td>
                          <td className="num text-ink-muted">{pct(l.share)}</td>
                          <td className="text-xs">
                            {l.problem ? <span className="text-warning-fg">{l.problem}</span>
                              : r?.error ? <span className="text-danger-fg">{r.error}</span>
                              : r ? <span className="text-success-fg">{result?.validate ? 'geprüft' : 'angelegt'}</span>
                              : later.has(l.index) ? <span className="text-ink-faint">später</span>
                              : <span className="text-ink-muted">bereit</span>}
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
        <Modal title="Als Vorlage speichern" size="sm" onClose={() => setSaveAs(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setSaveAs(null)}>Abbrechen</button>
            <button type="button" className="btn btn-primary" disabled={!saveAs.trim()} onClick={() => storeTemplate(saveAs)}>Speichern</button>
          </>}>
          <label className="block">
            <span className="label">Name</span>
            <input className="input w-full" autoFocus value={saveAs} placeholder="z. B. BTC Dip 10 Stufen log" onChange={(e) => setSaveAs(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && storeTemplate(saveAs)} />
          </label>
          <p className="mt-2 text-xs text-ink-muted">Gespeichert werden Paar, Richtung, Preise, Stufen, Betrag und Verteilung. Ein gleichnamiger Plan wird ersetzt.</p>
        </Modal>
      )}

      {draftForm && pair && (
        <Modal title={draft ? 'Entwurf speichern' : 'Als Entwurf speichern'} size="sm" onClose={() => setDraftForm(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setDraftForm(null)}>Abbrechen</button>
            {draft && <button type="button" className="btn btn-secondary" onClick={() => storeDraft(true)}>Als neuen Entwurf</button>}
            <button type="button" className="btn btn-primary" onClick={() => storeDraft(false)}>{draft ? 'Entwurf aktualisieren' : 'Speichern'}</button>
          </>}>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="label">Name</span>
              <input className="input w-full" autoFocus value={draftForm.name} onChange={(e) => setDraftForm({ ...draftForm, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Szenario (optional)</span>
              <input className="input w-full" list="draft-scenarios" value={draftForm.scenario} placeholder="z. B. Crash, Bullrun, Nach dem Halving" onChange={(e) => setDraftForm({ ...draftForm, scenario: e.target.value })} />
              <datalist id="draft-scenarios">{scenarios.map((x) => <option key={x} value={x} />)}</datalist>
              <span className="mt-1 block text-xs text-ink-muted">Entwürfe mit gleichem Szenario stehen zusammen.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="checkbox mt-0.5" checked={draftForm.alarm} onChange={(e) => setDraftForm({ ...draftForm, alarm: e.target.checked })} />
              <span>
                <span className="inline-flex items-center gap-1"><Bell size={14} /> Kursalarm</span>
                <span className="block text-xs text-ink-muted">Dein Mac meldet sich, wenn der Kurs die erste Stufe ({fmtPrice(toSend[0]?.price ?? input.priceStart, pair.priceDecimals)} {sym}) erreicht. Gesendet wird nichts, die Freigabe bleibt bei dir. Die App muss dafür laufen.</span>
              </span>
            </label>
            <label className="block">
              <span className="label">Notiz (optional)</span>
              <input className="input w-full" value={draftForm.note} placeholder="z. B. nur freigeben, wenn BTC unter 60.000 € fällt" onChange={(e) => setDraftForm({ ...draftForm, note: e.target.value })} />
            </label>
            <p className="text-xs text-ink-muted">{input.side === 'buy' ? 'Kauf' : 'Verkauf'} {pair.name}, {nowCount} {partial ? `von ${sendable.length} ` : ''}Stufen, {eur(nowCost)}. Es geht nichts an Kraken. Freigeben kannst du den Entwurf im Reiter „Entwürfe“.</p>
          </div>
        </Modal>
      )}

      {firstTest && (
        <Modal title="Ersten echten Test vorbereiten" size="md" onClose={() => setFirstTest(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setFirstTest(false)}>Abbrechen</button>
            <button type="button" className="btn btn-primary" onClick={loadFirstTest}>Mini-Plan laden</button>
          </>}>
          <div className="space-y-3 text-sm">
            <p>So testest du Senden, Anzeige und Stornieren mit echtem Geld, aber praktisch ohne Risiko:</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                <strong>Obergrenze klein halten.</strong>{' '}
                {limit !== null && limit > 50
                  ? <>Sie steht bei {eur(limit)}. <button type="button" className="btn-link" onClick={() => api().saveSettings({ maxPlanEur: 50 }).then((s) => setLimit(s.maxPlanEur))}>Auf 50 € senken</button></>
                  : limit !== null ? <>Sie steht bei {eur(limit)}. Passt.</> : null}
              </li>
              <li><strong>Mini-Plan laden:</strong> BTC/EUR kaufen, 2 Stufen etwa 20 % unter dem Kurs, knapp über Krakens Mindestbetrag (meist unter 15 €). So tief wird der Kurs kaum fallen, die Orders bleiben also nur liegen.</li>
              <li><strong>Probelauf</strong> klicken. Kraken prüft alles, legt aber nichts an.</li>
              <li><strong>An Kraken senden</strong> und bestätigen.</li>
              <li>Unter <strong>Offene Orders</strong> nachsehen, ob beide Orders da sind, und den Plan <strong>stornieren</strong>.</li>
              <li>Im <strong>Protokoll</strong> siehst du danach jeden Schritt mit Uhrzeit.</li>
            </ol>
            {!hasKey && <p className="notice notice-info">Für Schritt 3 bis 5 brauchst du einen Schlüssel. <button type="button" className="btn-link" onClick={() => { setFirstTest(false); onNeedKey() }}>Schlüssel anlegen</button></p>}
            {onOpenOrders && <p className="text-xs text-ink-muted">Geht etwas schief, stoppt die <strong>Notbremse</strong> unter „Offene Orders“ alle offenen Orders auf einmal.</p>}
          </div>
        </Modal>
      )}

      {confirm && ladder && pair && (
        <Modal title="Orders wirklich senden?" size="sm" onClose={() => !busy && setConfirm(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirm(false)}>Abbrechen</button>
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => run(false)}>{busy ? 'Sende …' : `${nowCount} Orders senden`}</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p><strong>{input.side === 'buy' ? 'Kaufen' : 'Verkaufen'}</strong> {pair.name} in {nowCount} Stufen von {fmtPrice(toSend[0]?.price ?? input.priceStart, pair.priceDecimals)} bis {fmtPrice(toSend[toSend.length - 1]?.price ?? input.priceEnd, pair.priceDecimals)} {sym}.</p>
            <p>Gegenwert jetzt: <strong>{eur(nowCost)}</strong>{feeEur !== null && <> plus ca. {eur(feeEur)} Gebühren</>}</p>
            {wrong.length > 0 && <p className="notice notice-danger">Achtung: {wrong.length} {wrong.length === 1 ? 'Stufe liegt' : 'Stufen liegen'} auf der falschen Seite des Kurses ({fmtPrice(last ?? 0, pair.priceDecimals)} {sym}) und {postOnly ? 'werden sofort wieder storniert' : 'würden sofort ausgeführt'}.</p>}
            {partial && <p className="text-ink-muted">Die restlichen {sendable.length - nowCount} Stufen bleiben im Plan. Du kannst sie später unter „Offene Orders“ mit „Rest senden“ nachschicken.</p>}
            <p>Kraken sperrt dafür jetzt <strong>{input.side === 'buy' ? eur(nowCost) : `${num(toSend.reduce((a, l) => a + l.volume, 0), pair.volumeDecimals)} ${base}`}</strong> von deinem Guthaben, bis die Orders ausgeführt oder storniert sind.</p>
            <p className="text-ink-muted">Die Orders werden echt bei Kraken angelegt. Du kannst sie unter „Offene Orders“ jederzeit stornieren, solange sie noch nicht ausgeführt sind. Dann ist das Geld sofort wieder frei.</p>
            <p className="text-xs text-ink-muted">Hat dein Mac Touch ID, fragt er nach dem Klick noch nach deinem Finger.</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
