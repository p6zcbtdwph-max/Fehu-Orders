// Rechenkern: verteilt einen Betrag nach einer mathematischen Funktion auf
// viele Limit-Orders in einem Preisbereich. Reine Funktionen ohne Netz,
// damit alles mit Tests abgesichert ist.

export type Side = 'buy' | 'sell'
/** Abstand der Preise: gleiche Euro-Schritte oder gleiche Prozent-Schritte */
export type PriceSpacing = 'linear' | 'geometric'
/** Wie sich die Menge über die Stufen verteilt */
export type SizeCurve = 'flat' | 'linear' | 'log' | 'exp' | 'fib' | 'custom'

export interface PairRules {
  /** Nachkommastellen beim Preis */
  priceDecimals: number
  /** Nachkommastellen bei der Menge */
  volumeDecimals: number
  /** Kleinste Menge pro Order (in der Basiswährung, z. B. BTC) */
  orderMin: number
  /** Kleinster Gegenwert pro Order (in der Kurswährung, z. B. EUR) */
  costMin: number
  /** Erlaubter Preisschritt bei Kraken (z. B. 0.5). Fehlt er, gilt 1 Einheit der letzten Nachkommastelle. */
  tickSize?: number
}

export interface LadderInput {
  side: Side
  /** Preis der ersten Stufe (nah am aktuellen Kurs) */
  priceStart: number
  /** Preis der letzten Stufe (am weitesten weg) */
  priceEnd: number
  steps: number
  /** Kauf: Gesamtbetrag in EUR. Verkauf: Gesamtmenge in der Basiswährung (z. B. BTC). */
  total: number
  spacing: PriceSpacing
  curve: SizeCurve
  /** Verhältnis letzte Stufe zu erster Stufe bei linear/log/exp (z. B. 3 = letzte Stufe dreimal so groß) */
  ratio: number
  /** Nur bei curve 'custom': Anteil je Stufe in Prozent (wird auf 100 % normiert) */
  customWeights?: number[]
}

export interface LadderLevel {
  index: number
  price: number
  volume: number
  /** Gegenwert in der Kurswährung */
  cost: number
  /** Anteil am Gesamtbetrag (0–1) */
  share: number
  /** Grund, warum die Stufe nicht gesendet werden kann */
  problem?: string
}

export interface Ladder {
  levels: LadderLevel[]
  totalVolume: number
  totalCost: number
  /** Durchschnittspreis, falls alle Stufen ausgeführt werden */
  averagePrice: number
  valid: boolean
  errors: string[]
}

export const MAX_STEPS = 200

/** Position t von 0 (erste Stufe) bis 1 (letzte Stufe) */
function position(i: number, steps: number): number {
  return steps === 1 ? 0 : i / (steps - 1)
}

/** Fibonacci-Zahlen 1, 1, 2, 3, 5, 8 … für Stufe i */
export function fibonacci(i: number): number {
  let a = 1
  let b = 1
  for (let k = 0; k < i; k++) [a, b] = [b, a + b]
  return a
}

/** Prozentliste aus Text wie "10, 20; 30 40" */
export function parseWeights(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .map((x) => Number(x.replace('%', '')))
    .filter((x) => Number.isFinite(x) && x > 0)
}

/** Gewicht einer Stufe. Bei ratio 1 sind alle Kurven gleichmäßig. fib und custom werden in buildLadder behandelt. */
export function weight(curve: SizeCurve, t: number, ratio: number): number {
  switch (curve) {
    case 'fib':
    case 'custom':
    case 'flat':
      return 1
    case 'linear':
      return 1 + (ratio - 1) * t
    case 'exp':
      return Math.pow(ratio, t)
    case 'log':
      // steigt am Anfang schnell, dann flacher
      return 1 + (ratio - 1) * (Math.log(1 + 9 * t) / Math.log(10))
  }
}

export function priceAt(spacing: PriceSpacing, start: number, end: number, t: number): number {
  return spacing === 'geometric' ? start * Math.pow(end / start, t) : start + (end - start) * t
}

function roundTo(value: number, decimals: number, mode: 'down' | 'up' | 'nearest'): number {
  const f = Math.pow(10, decimals)
  // kleine Korrektur gegen Gleitkomma-Reste wie 0.30000000000000004
  const scaled = Number((value * f).toFixed(6))
  const r = mode === 'down' ? Math.floor(scaled) : mode === 'up' ? Math.ceil(scaled) : Math.round(scaled)
  return r / f
}

/**
 * Rundet einen Preis auf Krakens Preisschritt (tick size) und die Nachkommastellen.
 * Kauf rundet ab, Verkauf auf: so wird nie schlechter gehandelt als berechnet.
 */
export function roundPrice(value: number, rules: Pick<PairRules, 'priceDecimals' | 'tickSize'>, mode: 'down' | 'up'): number {
  const tick = rules.tickSize && rules.tickSize > 0 ? rules.tickSize : 0
  if (!tick || Math.abs(tick - Math.pow(10, -rules.priceDecimals)) < 1e-15) return roundTo(value, rules.priceDecimals, mode)
  const steps = Number((value / tick).toFixed(6))
  const n = mode === 'down' ? Math.floor(steps) : Math.ceil(steps)
  return Number((n * tick).toFixed(rules.priceDecimals))
}

export function validateInput(input: LadderInput): string[] {
  const e: string[] = []
  const { priceStart, priceEnd, steps, total, ratio, side } = input
  if (!(priceStart > 0) || !(priceEnd > 0)) e.push('Preise müssen größer als 0 sein.')
  if (!Number.isInteger(steps) || steps < 1) e.push('Die Anzahl der Stufen muss eine ganze Zahl ab 1 sein.')
  if (steps > MAX_STEPS) e.push(`Höchstens ${MAX_STEPS} Stufen.`)
  if (!(total > 0)) e.push(side === 'buy' ? 'Der Gesamtbetrag muss größer als 0 sein.' : 'Die Gesamtmenge muss größer als 0 sein.')
  if (!(ratio > 0)) e.push('Das Verhältnis muss größer als 0 sein.')
  if (input.curve === 'custom') {
    const w = input.customWeights ?? []
    if (w.length !== steps) e.push(`Bei eigener Verteilung braucht es genau ${steps} Prozentwerte (jetzt ${w.length}).`)
  }
  if (priceStart > 0 && priceEnd > 0 && steps > 1) {
    if (side === 'buy' && priceEnd > priceStart) e.push('Beim Kauf liegt die letzte Stufe unter der ersten (tiefer kaufen).')
    if (side === 'sell' && priceEnd < priceStart) e.push('Beim Verkauf liegt die letzte Stufe über der ersten (höher verkaufen).')
  }
  return e
}

export function buildLadder(input: LadderInput, rules: PairRules): Ladder {
  const errors = validateInput(input)
  if (errors.length) return { levels: [], totalVolume: 0, totalCost: 0, averagePrice: 0, valid: false, errors }

  const { side, steps, total, spacing, curve, ratio, priceStart, priceEnd } = input
  const weights =
    curve === 'fib'
      ? Array.from({ length: steps }, (_, i) => fibonacci(i))
      : curve === 'custom'
        ? (input.customWeights ?? []).slice(0, steps)
        : Array.from({ length: steps }, (_, i) => weight(curve, position(i, steps), ratio))
  const sum = weights.reduce((a, b) => a + b, 0)

  const levels: LadderLevel[] = weights.map((w, i) => {
    const share = w / sum
    // Kauf: Preis abrunden, Verkauf: aufrunden. So wird nie schlechter gehandelt als berechnet.
    const price = roundPrice(priceAt(spacing, priceStart, priceEnd, position(i, steps)), rules, side === 'buy' ? 'down' : 'up')
    // Menge immer abrunden, damit Budget bzw. Bestand nie überschritten wird
    const rawVolume = side === 'buy' ? (total * share) / price : total * share
    const volume = roundTo(rawVolume, rules.volumeDecimals, 'down')
    const cost = volume * price
    let problem: string | undefined
    if (volume <= 0) problem = 'Menge wird nach dem Runden 0'
    else if (volume < rules.orderMin) problem = `Menge unter Mindestmenge ${rules.orderMin}`
    else if (cost < rules.costMin) problem = `Gegenwert unter Mindestbetrag ${rules.costMin}`
    return { index: i, price, volume, cost, share, problem }
  })

  const ok = levels.filter((l) => !l.problem)
  const totalVolume = ok.reduce((a, l) => a + l.volume, 0)
  const totalCost = ok.reduce((a, l) => a + l.cost, 0)
  const dupes = new Set<number>()
  levels.forEach((l, i) => i > 0 && l.price === levels[i - 1].price && dupes.add(l.price))
  if (dupes.size) errors.push('Mehrere Stufen haben nach dem Runden denselben Preis. Weniger Stufen oder größeren Preisbereich wählen.')
  if (levels.some((l) => l.problem)) errors.push('Einige Stufen sind zu klein für die Börse. Weniger Stufen oder mehr Betrag wählen.')

  return {
    levels,
    totalVolume,
    totalCost,
    averagePrice: totalVolume > 0 ? totalCost / totalVolume : 0,
    valid: errors.length === 0,
    errors,
  }
}
