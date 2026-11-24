import { useRef } from 'react'
import { tr } from '@shared/i18n'

/**
 * Aufteilungs-Regler: ein Balken, der immer genau 100 % ergibt. Zwischen zwei Zonen sitzt ein Griff,
 * den man mit der Maus oder den Pfeiltasten verschiebt. Was die eine Zone gewinnt, verliert die Nachbarzone.
 * Jede Zone behält mindestens 1 %.
 */
export default function ShareSlider({ shares, colors, labels, onChange }: {
  /** Anteile in ganzen Prozent, Summe 100 */
  shares: number[]
  colors: string[]
  labels: string[]
  onChange: (shares: number[]) => void
}): JSX.Element {
  const bar = useRef<HTMLDivElement>(null)
  // Grenzen zwischen den Zonen in Prozent vom linken Rand
  const cuts = shares.slice(0, -1).reduce<number[]>((acc, s) => [...acc, (acc[acc.length - 1] ?? 0) + s], [])

  /** Grenze k auf Position p (Prozent) setzen, Nachbarn behalten mindestens 1 % */
  function moveCut(k: number, p: number) {
    const lo = (k === 0 ? 0 : cuts[k - 1]) + 1
    const hi = (k === cuts.length - 1 ? 100 : cuts[k + 1]) - 1
    const pos = Math.round(Math.min(hi, Math.max(lo, p)))
    if (pos === cuts[k]) return
    const next = shares.slice()
    const delta = pos - cuts[k]
    next[k] += delta
    next[k + 1] -= delta
    onChange(next)
  }

  function drag(k: number, e: React.PointerEvent) {
    const el = bar.current
    if (!el) return
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture?.(e.pointerId)
    const rect = el.getBoundingClientRect()
    const at = (x: number) => ((x - rect.left) / rect.width) * 100
    const onMove = (ev: PointerEvent) => moveCut(k, at(ev.clientX))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div>
      <div ref={bar} className="relative flex h-9 w-full select-none overflow-visible rounded-lg">
        {shares.map((s, i) => (
          <div key={i} className={`flex items-center justify-center overflow-hidden text-xs font-semibold text-white tabular-nums ${i === 0 ? 'rounded-l-lg' : ''} ${i === shares.length - 1 ? 'rounded-r-lg' : ''}`}
            style={{ width: `${s}%`, background: colors[i] }} title={`${labels[i]}: ${s} %`}>
            {s >= 8 ? `${s} %` : ''}
          </div>
        ))}
        {cuts.map((c, k) => (
          <div key={k} role="slider" tabIndex={0} aria-label={tr(`Grenze zwischen ${labels[k]} und ${labels[k + 1]}`, `Border between ${labels[k]} and ${labels[k + 1]}`)}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={c} aria-valuetext={`${labels[k]} ${shares[k]} %, ${labels[k + 1]} ${shares[k + 1]} %`}
            className="absolute top-1/2 z-10 flex h-11 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-md border border-line-strong bg-surface shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
            style={{ left: `${c}%` }}
            onPointerDown={(e) => drag(k, e)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 5 : 1
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); moveCut(k, c - step) }
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); moveCut(k, c + step) }
            }}>
            <span className="h-5 w-0.5 rounded bg-ink-muted" aria-hidden />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-muted">
        {shares.map((s, i) => (
          <span key={i} className="flex items-center gap-1 tabular-nums">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: colors[i] }} aria-hidden />{labels[i]} {s} %
          </span>
        ))}
      </div>
    </div>
  )
}
