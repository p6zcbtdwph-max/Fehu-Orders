import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FlaskConical, RefreshCw, Send } from 'lucide-react'
import { buildLadder, MAX_STEPS, type LadderInput, type PriceSpacing, type Side, type SizeCurve } from '@shared/ladder'
import type { PairDto, SendResult } from '@shared/ipc'
import KpiStrip from '../components/ui/KpiStrip'
import SectionCard from '../components/ui/SectionCard'
import Segmented from '../components/ui/Segmented'
import Modal from '../components/ui/Modal'
import { useChartTheme } from '../utils/chartTheme'
import { eur, num, pct, price as fmtPrice } from '../format'

const CURVES: { id: SizeCurve; label: string; title: string }[] = [
  { id: 'flat', label: 'Gleich', title: 'Jede Stufe gleich groß' },
  { id: 'linear', label: 'Linear', title: 'Wächst gleichmäßig von Stufe zu Stufe' },
  { id: 'log', label: 'Logarithmisch', title: 'Wächst am Anfang schnell, dann flacher' },
  { id: 'exp', label: 'Exponentiell', title: 'Wächst am Anfang langsam, am Ende stark' },
]

const SPACINGS: { id: PriceSpacing; label: string; title: string }[] = [
  { id: 'linear', label: 'Gleiche €-Abstände', title: 'Zwischen zwei Stufen liegt immer derselbe Betrag' },
  { id: 'geometric', label: 'Gleiche %-Abstände', title: 'Zwischen zwei Stufen liegt immer derselbe Prozentsatz (logarithmisch)' },
]

function NumberField({ label, value, onChange, hint, step = 'any' }: { label: string; value: number; onChange: (n: number) => void; hint?: string; step?: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    if (Number(text.replace(',', '.')) !== value) setText(String(value))
  }, [value])
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input w-full tabular-nums" inputMode="decimal" step={step} value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value.replace(',', '.'))
          if (!Number.isNaN(n)) onChange(n)
        }} />
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  )
}

export default function PlannerPage({ hasKey, onNeedKey }: { hasKey: boolean; onNeedKey: () => void }): JSX.Element {
  const theme = useChartTheme()
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

  const pair = pairs.find((p) => p.id === pairId)
  const set = <K extends keyof LadderInput>(k: K, v: LadderInput[K]) => {
    setInput((s) => ({ ...s, [k]: v }))
    setResult(null)
  }

  useEffect(() => {
    window.api.pairs().then((ps) => {
      setPairs(ps)
      setPairId(ps.find((p) => p.name === 'BTC/EUR')?.id ?? ps[0]?.id ?? '')
    }).catch((e) => setLoadError(e.message))
  }, [])

  const loadPrice = (startFromPrice = true) => {
    if (!pairId) return
    window.api.price(pairId).then((p) => {
      setLast(p)
      if (startFromPrice) {
        // Vorschlag: Kauf 2–20 % unter dem Kurs, Verkauf 5–40 % darüber
        setInput((s) => s.side === 'buy' ? { ...s, priceStart: +(p * 0.98).toPrecision(6), priceEnd: +(p * 0.8).toPrecision(6) } : { ...s, priceStart: +(p * 1.05).toPrecision(6), priceEnd: +(p * 1.4).toPrecision(6) })
      }
    }).catch((e) => setLoadError(e.message))
  }
  useEffect(() => loadPrice(true), [pairId, input.side])

  const ladder = useMemo(() => (pair ? buildLadder(input, pair) : null), [input, pair])
  const quote = pair?.name.split('/')[1] ?? 'EUR'
  const base = pair?.name.split('/')[0] ?? ''
  const sendable = ladder?.levels.filter((l) => !l.problem) ?? []

  async function run(validate: boolean) {
    if (!pair || !ladder) return
    setBusy(validate ? 'validate' : 'send')
    setSendError(null)
    setResult(null)
    try {
      setResult(await window.api.send({ pairId: pair.id, pairName: pair.name, side: input.side, input, levels: ladder.levels, validate, postOnly }))
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
        <div className="ml-auto flex flex-shrink-0 items-center gap-2">
          <button type="button" className="btn btn-secondary" disabled={!hasKey || !ladder?.valid || !!busy} onClick={() => run(true)} title="Kraken prüft alle Orders, legt aber nichts an">
            <FlaskConical size={16} /> {busy === 'validate' ? 'Prüfe …' : 'Probelauf'}
          </button>
          <button type="button" data-primary-action className="btn btn-primary" disabled={!hasKey || !ladder?.valid || !!busy} onClick={() => setConfirm(true)}>
            <Send size={16} /> An Kraken senden
          </button>
        </div>
      </header>

      {loadError && <p className="notice notice-danger mb-4">Kraken ist nicht erreichbar: {loadError}</p>}
      {!hasKey && (
        <p className="notice notice-info mb-4">
          Planen geht auch ohne Schlüssel. Zum Prüfen und Senden brauchst du einen Kraken-API-Schlüssel.{' '}
          <button type="button" className="btn-link" onClick={onNeedKey}>Schlüssel hinterlegen</button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-[22rem_1fr]">
        <SectionCard title="Plan">
          <div className="space-y-4">
            <label className="block">
              <span className="label">Handelspaar</span>
              <select className="select w-full" value={pairId} onChange={(e) => { setPairId(e.target.value); setResult(null) }}>
                {pairs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                Aktueller Kurs: {last && pair ? `${fmtPrice(last, pair.priceDecimals)} ${quote}` : '…'}
                <button type="button" className="btn-mini" onClick={() => loadPrice(false)} aria-label="Kurs neu laden" title="Kurs neu laden"><RefreshCw size={14} /></button>
              </span>
            </label>
            <div>
              <span className="label">Richtung</span>
              <Segmented<Side> block size="md" value={input.side} onChange={(v) => set('side', v)} options={[{ id: 'buy', label: 'Kaufen' }, { id: 'sell', label: 'Verkaufen' }]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Erste Stufe" value={input.priceStart} onChange={(v) => set('priceStart', v)} hint={last ? pct(input.priceStart / last - 1) + ' zum Kurs' : undefined} />
              <NumberField label="Letzte Stufe" value={input.priceEnd} onChange={(v) => set('priceEnd', v)} hint={last ? pct(input.priceEnd / last - 1) + ' zum Kurs' : undefined} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Anzahl Stufen" step="1" value={input.steps} onChange={(v) => set('steps', Math.round(v))} hint={`1 bis ${MAX_STEPS}`} />
              <NumberField label={input.side === 'buy' ? `Gesamt in ${quote}` : `Gesamt in ${base}`} value={input.total} onChange={(v) => set('total', v)} />
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
            {input.curve !== 'flat' && (
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
        </SectionCard>

        <div className="min-w-0 space-y-4">
          {ladder && (
            <KpiStrip items={[
              { label: 'Stufen', value: `${sendable.length} / ${input.steps}`, tone: sendable.length < input.steps ? 'warning' : 'default' },
              { label: 'Gegenwert', value: eur(ladder.totalCost) },
              { label: `Menge ${base}`, value: num(ladder.totalVolume, pair?.volumeDecimals) },
              { label: 'Ø Preis bei voller Ausführung', value: ladder.averagePrice ? fmtPrice(ladder.averagePrice, pair?.priceDecimals ?? 2) : '–', hint: last && ladder.averagePrice ? pct(ladder.averagePrice / last - 1) + ' zum Kurs' : undefined },
            ]} />
          )}
          {ladder && ladder.errors.length > 0 && (
            <div className="notice notice-warning space-y-1">{ladder.errors.map((e) => <p key={e}>{e}</p>)}</div>
          )}
          {sendError && <p className="notice notice-danger">{sendError}</p>}
          {result && (
            <div className={`notice ${failed.length ? 'notice-warning' : 'notice-success'}`}>
              {result.validate
                ? failed.length ? `Probelauf: ${failed.length} Orders würden abgelehnt.` : `Probelauf erfolgreich: Kraken würde alle ${ok} Orders annehmen. Es wurde nichts angelegt.`
                : `${ok} Orders angelegt${failed.length ? `, ${failed.length} fehlgeschlagen` : ''}. Plan-Nummer ${result.userref}.`}
              {failed.length > 0 && <p className="mt-1 text-xs">Grund: {failed[0].error}</p>}
            </div>
          )}

          {ladder && ladder.levels.length > 0 && (
            <SectionCard title="Verteilung">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ladder.levels.map((l) => ({ preis: l.price, betrag: Math.round(l.cost * 100) / 100, problem: !!l.problem }))}>
                    <CartesianGrid {...theme.grid} />
                    <XAxis dataKey="preis" {...theme.axis} tickFormatter={(v) => fmtPrice(v, 0)} />
                    <YAxis {...theme.axis} tickFormatter={(v) => `${v} €`} width={60} />
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

      {confirm && ladder && pair && (
        <Modal title="Orders wirklich senden?" size="sm" onClose={() => !busy && setConfirm(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirm(false)}>Abbrechen</button>
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => run(false)}>{busy ? 'Sende …' : `${sendable.length} Orders senden`}</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p><strong>{input.side === 'buy' ? 'Kaufen' : 'Verkaufen'}</strong> {pair.name} in {sendable.length} Stufen von {fmtPrice(input.priceStart, pair.priceDecimals)} bis {fmtPrice(input.priceEnd, pair.priceDecimals)} {quote}.</p>
            <p>Gegenwert zusammen: <strong>{eur(ladder.totalCost)}</strong></p>
            <p className="text-ink-muted">Die Orders werden echt bei Kraken angelegt. Du kannst sie unter „Offene Orders“ jederzeit stornieren, solange sie noch nicht ausgeführt sind.</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
