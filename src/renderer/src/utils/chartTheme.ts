// Gemeinsamer Stil für alle Diagramme (Recharts).
// Farben folgen der Rolle, nicht dem Rang: Reihe 1 ist immer Gold, Reihe 2 Blau usw. (Fehu Design, chart.*).
// Palette mit dem Farbsehschwäche-Prüfer validiert (hell gegen #FFFDF9, dunkel gegen #181613).

import { useEffect, useState } from 'react'

// Seit v1.68 stehen alle Farbwerte als CSS-Variablen in assets/index.css (--chart-*, --cat-*),
// hell und dunkel an einer Stelle. Hier werden sie nur ausgelesen; die Werte hier sind
// der Rückfall für Tests ohne Stylesheet.
const FALLBACK: Record<string, string> = {
  // Fehu Design 0.1.0, hell (tokens.json › chart.light und Signalfarben)
  'chart-1': '#B8862E', 'chart-2': '#2A6FB8', 'chart-3': '#D0533A', 'chart-4': '#1C9A88', 'chart-5': '#8A5BC4', 'chart-6': '#5C8F2A',
  'chart-good': '#367A49', 'chart-warning': '#B8541A', 'chart-critical': '#C2352A', 'chart-neutral': '#CFC6B5',
  'chart-text': '#5C564C', 'chart-grid': '#E5DFD3', 'chart-grid-strong': '#CFC6B5', 'chart-surface': '#FFFDF9', 'chart-sunken': '#F2EEE6',
  'chart-border': '#E5DFD3', 'chart-ink': '#1C1915', 'chart-cursor': '#CFC6B5', 'chart-empty': '#E5DFD3',
}

/** Liest eine Farbe aus den CSS-Variablen (--chart-…, --cat-…). */
export function cssColor(name: string): string {
  if (typeof document !== 'undefined') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
    if (v) return v
  }
  return FALLBACK[name] ?? '#94a3b8'
}

const SERIES_KEYS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6']
export const CATEGORY_COUNT = 6

// Status: nur für gut/schlecht-Bedeutung, nie als „Serie 4“
export const STATUS = {
  get good() { return cssColor('chart-good') },
  get warning() { return cssColor('chart-warning') },
  get critical() { return cssColor('chart-critical') },
  get neutral() { return cssColor('chart-neutral') },
}

/** Feste Farbe für die i-te Kategorie (Budget, Vermögen, Reisen, Bucket List …). */
export function categoryColor(i: number): string {
  return i < 0 ? STATUS.neutral : cssColor(`chart-${(i % CATEGORY_COUNT) + 1}`)
}

/** Die 6 Kategoriefarben in fester Reihenfolge (= Diagrammreihen). */
export function categoryPalette(): string[] {
  return Array.from({ length: CATEGORY_COUNT }, (_, i) => cssColor(`chart-${i + 1}`))
}

/** Auswahl für Farbwähler: die 6 Reihenfarben. */
export function pickerColors(): string[] {
  return Array.from({ length: CATEGORY_COUNT }, (_, i) => cssColor(`chart-${i + 1}`))
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

/** Reagiert auf den Wechsel hell/dunkel, damit Diagramme neu zeichnen */
export function useChartTheme() {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isDark()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return chartTheme(dark)
}

export function chartTheme(dark = isDark()) {
  const series = SERIES_KEYS.map(cssColor)
  const text = cssColor('chart-text')
  const grid = cssColor('chart-grid')
  const c = cssColor
  return {
    dark,
    series,
    /** Farbe für Serie i (feste Reihenfolge, kein Durchrotieren über 6 hinaus) */
    color: (i: number) => series[Math.min(i, series.length - 1)],
    accent: series[0],
    /** Gitter für Netz-/Radardiagramme und Linien auf Karten */
    gridStrong: c('chart-grid-strong'),
    /** Leere Fläche (Weltkarte, leere Ringe) */
    empty: c('chart-empty'),
    surface: c('chart-surface'),
    sunken: c('chart-sunken'),
    category: categoryColor,
    status: STATUS,
    grid: { stroke: grid, strokeDasharray: '0', vertical: false },
    axis: {
      tick: { fill: text, fontSize: 12 },
      axisLine: false,
      tickLine: false,
    },
    tooltip: {
      contentStyle: {
        background: c('chart-surface'),
        border: `1px solid ${c('chart-border')}`,
        borderRadius: 8,
        boxShadow: 'var(--fd-shadow-md)',
        fontSize: 12,
        color: c('chart-ink'),
        padding: '8px 10px',
      },
      labelStyle: { color: text, marginBottom: 4, fontWeight: 500 },
      itemStyle: { color: c('chart-ink'), padding: 0 },
      cursor: { stroke: c('chart-cursor'), strokeWidth: 1, fill: c('chart-ink'), fillOpacity: dark ? 0.08 : 0.06 },
    },
    legend: { wrapperStyle: { fontSize: 12, color: text } },
    line: { strokeWidth: 2, dot: false, activeDot: { r: 4 } },
    bar: { radius: [4, 4, 0, 0] as [number, number, number, number] },
    /** Beträge und Zähler: Achse beginnt immer bei 0, sonst wirkt eine flache Linie wie ein Ausschlag */
    zeroDomain: [0, 'auto'] as [number, string],
    /** Messwerte (Gewicht, Puls …): eng skaliert, aber mindestens ±5 % um den Wert */
    valueDomain: [
      (min: number) => niceStep(min - Math.max(Math.abs(min) * 0.05, 1), 'down'),
      (max: number) => niceStep(max + Math.max(Math.abs(max) * 0.05, 1), 'up'),
    ] as [(n: number) => number, (n: number) => number],
  }
}

/** Rundet auf eine glatte Achsenstufe (1, 2, 5, 10 …). */
export function niceStep(v: number, dir: 'up' | 'down'): number {
  if (!isFinite(v) || v === 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1)
  return (dir === 'up' ? Math.ceil(v / mag) : Math.floor(v / mag)) * mag
}

export type ChartTheme = ReturnType<typeof chartTheme>
