// Rechte Spalte des Planers unter den Kennzahlen: Kurs-Chart mit den Stufen, Verteilung und Stufentabelle.
// Rechnet nichts am Plan, zeigt nur an.
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { hasZones, isHeld, zoneEnd, type Ladder, type LadderInput } from '@shared/ladder'
import { reach, windowStats, type Candle, type OhlcRow } from '@shared/history'
import type { PairDto, SendResult } from '@shared/ipc'
import { tr } from '@shared/i18n'
import { zoneColor } from '../../components/ZoneEditor'
import { windowLabel } from '../../components/HistoryHints'
import SectionCard from '../../components/ui/SectionCard'
import Segmented from '../../components/ui/Segmented'
import { useChartTheme } from '../../utils/chartTheme'
import { num, pct, fmtDate, fmtDayMonth, fmtDateTime } from '../../format'
import { useMoney } from '../../money'

export const RANGES: { id: number; label: () => string; interval: number; days: number }[] = [
  { id: 30, label: () => tr('30 T', '30 d'), interval: 60, days: 30 },
  { id: 90, label: () => tr('90 T', '90 d'), interval: 240, days: 90 },
  { id: 365, label: () => tr('1 J', '1 y'), interval: 1440, days: 365 },
]

export interface PlanResultsProps {
  input: LadderInput
  ladder: Ladder | null
  pair: PairDto | undefined
  last: number | null
  /** Kurse für das Chart im gewählten Zeitraum */
  candles: OhlcRow[]
  /** Tageskerzen für „Erreicht“ */
  daily: Candle[]
  range: number
  setRange: (r: number) => void
  result: SendResult | null
  /** Nummern der entschärften Zonen */
  held: Set<number>
  /** Indizes der Stufen, die später oder gar nicht rausgehen */
  later: Set<number>
}

export default function PlanResults({ input, ladder, pair, last, candles, daily, range, setRange, result, held, later }: PlanResultsProps): JSX.Element {
  const theme = useChartTheme()
  const { eur, fmtPrice } = useMoney()
  const zoned = hasZones(input)
  const base = pair?.name.split('/')[0] ?? ''
  const sendable = ladder?.levels.filter((l) => !l.problem) ?? []
  const nowSec = Date.now() / 1000
  const reachOf = (price: number) => (daily.length ? reach(daily, input.side, price, range, nowSec) : null)
  const covered = daily.length ? windowStats(daily, range, nowSec)?.covered ?? range : range
  // Tief und Hoch im Chart-Zeitraum
  const chartLow = candles.length ? Math.min(...candles.map((c) => c[2] ?? c[1])) : null
  const chartHigh = candles.length ? Math.max(...candles.map((c) => c[3] ?? c[1])) : null
  const extreme = input.side === 'buy' ? chartLow : chartHigh
  // Blasse Linien: Stufen, die später oder gar nicht rausgehen
  const partial = later.size > 0
  return (
    <>
    {candles.length > 1 && ladder && (
      <SectionCard title={tr('Kurs und Stufen', 'Price and levels')} action={<Segmented<number> value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r.id, label: r.label() }))} />}>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={candles.map(([t, c]) => ({ t: t * 1000, c }))}>
              <CartesianGrid {...theme.grid} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} {...theme.axis}
                tickFormatter={(v) => fmtDayMonth(v)} />
              <YAxis {...theme.axis} width={70} tickFormatter={(v) => fmtPrice(v, 0)}
                domain={[
                  (min: number) => Math.min(min, chartLow ?? min, ...sendable.map((l) => l.price)) * 0.98,
                  (max: number) => Math.max(max, chartHigh ?? max, ...sendable.map((l) => l.price)) * 1.02,
                ]} />
              <Tooltip {...theme.tooltip} labelFormatter={(v) => fmtDateTime(Number(v))}
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
                      const when = rc.lastAt ? fmtDate(rc.lastAt * 1000) : ''
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
                        : isHeld(l, held) ? <span className="text-ink-faint">{tr('pausiert', 'paused')}</span>
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
    </>
  )
}
