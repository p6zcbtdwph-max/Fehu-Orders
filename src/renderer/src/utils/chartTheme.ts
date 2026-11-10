// Gemeinsamer Stil für alle Diagramme (Recharts).
// Farben folgen der Rolle, nicht dem Rang: Serie 1 ist immer Fehu-Gold, Serie 2 immer Indigo usw.
// Palette mit dem Farbsehschwäche-Prüfer validiert (hell gegen #fcfcfb, dunkel gegen #0f172a).
// Slot 5/6 liegen bei Deuteranopie nur knapp auseinander — ab 5 Serien immer Legende + direkte Beschriftung.

import { useEffect, useState } from 'react'

// Seit v1.68 stehen alle Farbwerte als CSS-Variablen in assets/index.css (--chart-*, --cat-*),
// hell und dunkel an einer Stelle. Hier werden sie nur ausgelesen; die Werte hier sind
// der Rückfall für Tests ohne Stylesheet.
const FALLBACK: Record<string, string> = {
  'chart-1': '#c28d36', 'chart-2': '#6366f1', 'chart-3': '#14b8a6', 'chart-4': '#f43f5e', 'chart-5': '#0ea5e9', 'chart-6': '#a855f7',
  'chart-good': '#10b981', 'chart-warning': '#f97316', 'chart-critical': '#f43f5e', 'chart-neutral': '#94a3b8',
  'chart-text': '#6b7280', 'chart-grid': '#eef0f3', 'chart-grid-strong': '#e2e8f0', 'chart-surface': '#ffffff', 'chart-sunken': '#f8fafc',
  'chart-border': '#e5e7eb', 'chart-ink': '#111827', 'chart-cursor': '#cbd5e1', 'chart-empty': '#e5e7eb',
  'cat-1': '#6366f1', 'cat-2': '#22d3ee', 'cat-3': '#f59e0b', 'cat-4': '#10b981', 'cat-5': '#f43f5e', 'cat-6': '#a78bfa',
  'cat-7': '#94a3b8', 'cat-8': '#fb923c', 'cat-9': '#34d399', 'cat-10': '#60a5fa', 'cat-11': '#f472b6', 'cat-12': '#facc15',
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
export const CATEGORY_COUNT = 12

// Status: nur für gut/schlecht-Bedeutung, nie als „Serie 4“
export const STATUS = {
  get good() { return cssColor('chart-good') },
  get warning() { return cssColor('chart-warning') },
  get critical() { return cssColor('chart-critical') },
  get neutral() { return cssColor('chart-neutral') },
}

/** Feste Farbe für die i-te Kategorie (Budget, Vermögen, Reisen, Bucket List …). */
export function categoryColor(i: number): string {
  return i < 0 ? STATUS.neutral : cssColor(`cat-${(i % CATEGORY_COUNT) + 1}`)
}

/** Die 12 Kategoriefarben in fester Reihenfolge. */
export function categoryPalette(): string[] {
  return Array.from({ length: CATEGORY_COUNT }, (_, i) => cssColor(`cat-${i + 1}`))
}

/** Auswahl für Farbwähler (Counter, Würfel, Experimente, Prozesse): dieselben 12 Töne plus Fehu-Gold. */
export function pickerColors(): string[] {
  return [cssColor('chart-1'), ...Array.from({ length: CATEGORY_COUNT }, (_, i) => cssColor(`cat-${i + 1}`)).filter(c => c !== cssColor('cat-7'))]
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
        borderRadius: 10,
        boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)',
        fontSize: 12,
        color: c('chart-ink'),
        padding: '8px 10px',
      },
      labelStyle: { color: text, marginBottom: 4, fontWeight: 500 },
      itemStyle: { color: c('chart-ink'), padding: 0 },
      cursor: { stroke: c('chart-cursor'), strokeWidth: 1, fill: dark ? 'rgb(148 163 184 / 0.08)' : 'rgb(100 116 139 / 0.06)' },
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
