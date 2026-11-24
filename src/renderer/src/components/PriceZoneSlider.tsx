import { useRef } from 'react'
import type { LadderZone, Side } from '@shared/ladder'
import { zoneEnd } from '@shared/ladder'
import { moveHandle, sliderDomain, sliderStep, zoneHandles } from '@shared/zone-slider'
import { tr } from '@shared/i18n'

/**
 * Preis-Regler für die Zonen: eine Preisachse mit dem aktuellen Kurs, jede Zone als farbiger Abschnitt.
 * An Anfang und Ende jeder Zone sitzt ein Griff (Maus oder Pfeiltasten). Die Zonen können sich dabei nicht überschneiden.
 * Kauf: rechts ist der Kurs, nach links wird es billiger. Verkauf: links ist der Kurs, nach rechts wird es teurer.
 */
export default function PriceZoneSlider({ zones, side, last, colors, marks = [], fmtPrice, onChange }: {
  zones: LadderZone[]
  side: Side
  last: number | null
  colors: string[]
  /** zusätzliche Markierungen, z. B. Tiefstkurse aus dem Rückblick */
  marks?: { price: number; label: string }[]
  fmtPrice: (p: number) => string
  onChange: (zones: LadderZone[]) => void
}): JSX.Element | null {
  const bar = useRef<HTMLDivElement>(null)
  const domain = sliderDomain(zones, side, last)
  const step = sliderStep(last ?? domain.hi)
  const span = domain.hi - domain.lo
  if (!(span > 0)) return null
  const x = (p: number) => ((p - domain.lo) / span) * 100
  const handles = zoneHandles(zones)
  const label = (k: number) => {
    const h = handles[k]
    return h.edge === 'start' ? tr(`Zone ${h.zone + 1} Anfang`, `Zone ${h.zone + 1} start`) : tr(`Zone ${h.zone + 1} Ende`, `Zone ${h.zone + 1} end`)
  }

  function drag(k: number, e: React.PointerEvent) {
    const el = bar.current
    if (!el) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    // Zonen vom Beginn des Ziehens: jede Bewegung rechnet von dort, so bleibt nichts hängen
    const start = zones
    const onMove = (ev: PointerEvent) => onChange(moveHandle(start, side, k, domain.lo + ((ev.clientX - rect.left) / rect.width) * span, domain, step))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const shownMarks = marks.filter((m) => m.price > domain.lo && m.price < domain.hi)
  return (
    <div>
      <div ref={bar} className="relative mx-2 mt-5 h-8 select-none">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" aria-hidden />
        {zones.map((z, i) => {
          const a = x(z.priceStart)
          const b = x(zoneEnd(z))
          const left = Math.min(a, b)
          return (
            <div key={i} className={`absolute top-1/2 h-4 -translate-y-1/2 rounded ${z.armed === false ? 'opacity-50' : ''}`} aria-hidden
              style={{ left: `${left}%`, width: `${Math.max(Math.abs(b - a), 0.8)}%`, background: colors[i], backgroundImage: z.armed === false ? 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,.45) 4px 8px)' : undefined }} />
          )
        })}
        {shownMarks.map((m) => (
          <div key={m.label} className="absolute top-0 h-full w-px bg-ink-muted/60" style={{ left: `${x(m.price)}%` }} title={`${m.label}: ${fmtPrice(m.price)}`} aria-hidden />
        ))}
        {last && last >= domain.lo && last <= domain.hi && (
          <div className="absolute -top-5 h-[3.25rem] w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${x(last)}%` }} aria-hidden>
            <span className={`absolute top-0 whitespace-nowrap text-xs font-semibold leading-none text-ink ${x(last) > 85 ? 'right-1.5' : 'left-1.5'}`}>{tr('Kurs', 'Price')}</span>
          </div>
        )}
        {handles.map((h, k) => (
          <div key={`${h.zone}-${h.edge}`} role="slider" tabIndex={0} aria-label={label(k)}
            aria-valuemin={Math.round(domain.lo)} aria-valuemax={Math.round(domain.hi)} aria-valuenow={h.price} aria-valuetext={`${label(k)}: ${fmtPrice(h.price)}`}
            title={`${label(k)}: ${fmtPrice(h.price)}`}
            className="absolute top-1/2 z-10 h-6 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-sm border-2 border-surface shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
            style={{ left: `${x(h.price)}%`, background: colors[h.zone] }}
            onPointerDown={(e) => drag(k, e)}
            onKeyDown={(e) => {
              const n = e.shiftKey ? 10 : 1
              const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0
              if (!d) return
              e.preventDefault()
              onChange(moveHandle(zones, side, k, h.price + d * n * step, domain, step))
            }} />
        ))}
      </div>
      <div className="mx-2 mt-1 flex justify-between text-xs text-ink-muted tabular-nums">
        <span>{fmtPrice(domain.lo)}</span>
        <span>{fmtPrice(domain.hi)}</span>
      </div>
    </div>
  )
}
