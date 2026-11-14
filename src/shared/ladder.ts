// Rechenkern: verteilt einen Betrag nach einer mathematischen Funktion auf
// viele Limit-Orders in einem Preisbereich. Reine Funktionen ohne Netz,
// damit alles mit Tests abgesichert ist.
import { tr } from './i18n'

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
  /**
   * Schwerpunkt der Orderanzahl (0–1): wo im Preisbereich die Stufen im Mittel liegen.
   * 0 = bei der ersten Stufe, 1 = bei der letzten. Fehlt der Wert, gilt die gewählte Formel.
   */
  orderCenter?: number
  /**
   * Schwerpunkt des Volumens (0–1): wo im Preisbereich das Geld (Kauf) bzw. die Menge (Verkauf)
   * im Mittel liegt. Fehlt der Wert, gilt die gewählte Formel.
   */
  volumeCenter?: number
}

/** Schwerpunkte einer Leiter, jeweils 0–1 (Anteil des Wegs von der ersten zur letzten Stufe) */
export interface LadderCenters {
  /** Schwerpunkt der Orderanzahl, so wie er jetzt ist */
  order: number
  /** Schwerpunkt der Orderanzahl ohne Regler, also nur nach der Formel */
  orderDefault: number
  /** Schwerpunkt des Volumens, so wie er jetzt ist */
  volume: number
  /** Schwerpunkt des Volumens nur nach der Formel (bei der jetzigen Lage der Stufen) */
  volumeDefault: number
  /** Lage jeder Stufe im Preisbereich (0–1) */
  positions: number[]
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
  centers?: LadderCenters
}

export const MAX_STEPS = 200
/** Grenzen der Schwerpunkt-Regler. Ganz an den Rand geht nicht, weil die erste und letzte Stufe fest bleiben. */
export const CENTER_MIN = 0.05
export const CENTER_MAX = 0.95

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

/**
 * Lage jeder Stufe im Preisbereich (0 = erste Stufe, 1 = letzte), vor dem Runden.
 * k verschiebt die Stufen: 1 = genau nach der Formel, größer = dichter an der ersten Stufe,
 * kleiner = dichter an der letzten. Erste und letzte Stufe bleiben immer an ihrem Platz.
 */
export function stageT(steps: number, k = 1): number[] {
  return Array.from({ length: steps }, (_, i) => Math.pow(position(i, steps), k))
}

export function stagePositions(spacing: PriceSpacing, start: number, end: number, ts: number[]): number[] {
  const span = end - start
  return ts.map((t) => (span === 0 ? t : (priceAt(spacing, start, end, t) - start) / span))
}

/** Gewichteter Mittelwert der Lagen, also der Schwerpunkt (0–1) */
export function weightedCenter(weights: number[], positions: number[]): number {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!(sum > 0)) return 0.5
  return weights.reduce((a, w, i) => a + w * positions[i], 0) / sum
}

/** Sucht x in [lo, hi], sodass f(x) = target. f muss steigen. Liegt target außerhalb, gilt der nächste Rand. */
function solveIncreasing(f: (x: number) => number, target: number, lo: number, hi: number): number {
  if (target <= f(lo)) return lo
  if (target >= f(hi)) return hi
  for (let n = 0; n < 60; n++) {
    const mid = (lo + hi) / 2
    if (f(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const clampCenter = (c: number) => Math.min(CENTER_MAX, Math.max(CENTER_MIN, c))

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
  if (!(priceStart > 0) || !(priceEnd > 0)) e.push(tr('Preise müssen größer als 0 sein.', 'Prices must be greater than 0.'))
  if (!Number.isInteger(steps) || steps < 1) e.push(tr('Die Anzahl der Stufen muss eine ganze Zahl ab 1 sein.', 'The number of levels must be a whole number of at least 1.'))
  if (steps > MAX_STEPS) e.push(tr(`Höchstens ${MAX_STEPS} Stufen.`, `At most ${MAX_STEPS} levels.`))
  if (!(total > 0)) e.push(side === 'buy' ? tr('Der Gesamtbetrag muss größer als 0 sein.', 'The total amount must be greater than 0.') : tr('Die Gesamtmenge muss größer als 0 sein.', 'The total volume must be greater than 0.'))
  if (!(ratio > 0)) e.push(tr('Das Verhältnis muss größer als 0 sein.', 'The ratio must be greater than 0.'))
  if (input.curve === 'custom') {
    const w = input.customWeights ?? []
    if (w.length !== steps) e.push(tr(`Bei eigener Verteilung braucht es genau ${steps} Prozentwerte (jetzt ${w.length}).`, `A custom distribution needs exactly ${steps} percentages (now ${w.length}).`))
    if (w.some((x) => !(x > 0) || !Number.isFinite(x))) e.push(tr('Jeder Prozentwert muss eine Zahl über 0 sein.', 'Every percentage must be a number above 0.'))
  }
  for (const c of [input.orderCenter, input.volumeCenter]) {
    if (c !== undefined && !(c >= 0 && c <= 1)) e.push(tr('Der Schwerpunkt muss zwischen 0 % und 100 % liegen.', 'The center of weight must be between 0 % and 100 %.'))
  }
  if (priceStart > 0 && priceEnd > 0 && steps > 1) {
    if (side === 'buy' && priceEnd > priceStart) e.push(tr('Beim Kauf liegt die letzte Stufe unter der ersten (tiefer kaufen).', 'When buying, the last level is below the first (buy lower).'))
    if (side === 'sell' && priceEnd < priceStart) e.push(tr('Beim Verkauf liegt die letzte Stufe über der ersten (höher verkaufen).', 'When selling, the last level is above the first (sell higher).'))
  }
  return e
}

export function buildLadder(input: LadderInput, rules: PairRules): Ladder {
  const errors = validateInput(input)
  if (errors.length) return { levels: [], totalVolume: 0, totalCost: 0, averagePrice: 0, valid: false, errors }

  const { side, steps, total, spacing, curve, ratio, priceStart, priceEnd } = input
  const baseWeights =
    curve === 'fib'
      ? Array.from({ length: steps }, (_, i) => fibonacci(i))
      : curve === 'custom'
        ? (input.customWeights ?? []).slice(0, steps)
        : Array.from({ length: steps }, (_, i) => weight(curve, position(i, steps), ratio))

  // Regler 1: Schwerpunkt der Orderanzahl. Die Stufen rücken zusammen oder auseinander,
  // erste und letzte Stufe bleiben fest. Mit 1 oder 2 Stufen gibt es nichts zu verschieben.
  const meanAt = (logK: number) => {
    const pos = stagePositions(spacing, priceStart, priceEnd, stageT(steps, Math.exp(logK)))
    return pos.reduce((a, b) => a + b, 0) / steps
  }
  const orderDefault = meanAt(0)
  // größeres k zieht die Stufen zur ersten hin, also sinkt der Schwerpunkt: darum -logK
  const logK = input.orderCenter !== undefined && steps > 2 ? -solveIncreasing((x) => meanAt(-x), clampCenter(input.orderCenter), -5, 5) : 0
  const ts = stageT(steps, Math.exp(logK))
  const positions = stagePositions(spacing, priceStart, priceEnd, ts)

  // Regler 2: Schwerpunkt des Volumens. Die Gewichte der Formel werden zur einen oder
  // anderen Seite gekippt (mal e^(a·Lage)). a = 0 heißt: genau wie die Formel.
  const volumeDefault = weightedCenter(baseWeights, positions)
  const tilt = (a: number) => baseWeights.map((w, i) => w * Math.exp(a * (positions[i] - 0.5)))
  const a = input.volumeCenter !== undefined && steps > 1 ? solveIncreasing((x) => weightedCenter(tilt(x), positions), clampCenter(input.volumeCenter), -60, 60) : 0
  const weights = a === 0 ? baseWeights : tilt(a)
  const sum = weights.reduce((x, y) => x + y, 0)
  const centers: LadderCenters = {
    order: positions.reduce((x, y) => x + y, 0) / steps,
    orderDefault,
    volume: weightedCenter(weights, positions),
    volumeDefault,
    positions,
  }

  const levels: LadderLevel[] = weights.map((w, i) => {
    const share = w / sum
    // Kauf: Preis abrunden, Verkauf: aufrunden. So wird nie schlechter gehandelt als berechnet.
    const price = roundPrice(priceAt(spacing, priceStart, priceEnd, ts[i]), rules, side === 'buy' ? 'down' : 'up')
    // Menge immer abrunden, damit Budget bzw. Bestand nie überschritten wird
    const rawVolume = side === 'buy' ? (total * share) / price : total * share
    const volume = roundTo(rawVolume, rules.volumeDecimals, 'down')
    const cost = volume * price
    let problem: string | undefined
    if (volume <= 0) problem = tr('Menge wird nach dem Runden 0', 'Volume becomes 0 after rounding')
    else if (volume < rules.orderMin) problem = tr(`Menge unter Mindestmenge ${rules.orderMin}`, `Volume below minimum ${rules.orderMin}`)
    else if (cost < rules.costMin) problem = tr(`Gegenwert unter Mindestbetrag ${rules.costMin}`, `Value below minimum cost ${rules.costMin}`)
    return { index: i, price, volume, cost, share, problem }
  })

  const ok = levels.filter((l) => !l.problem)
  const totalVolume = ok.reduce((a, l) => a + l.volume, 0)
  const totalCost = ok.reduce((a, l) => a + l.cost, 0)
  const dupes = new Set<number>()
  levels.forEach((l, i) => i > 0 && l.price === levels[i - 1].price && dupes.add(l.price))
  if (dupes.size) errors.push(tr('Mehrere Stufen haben nach dem Runden denselben Preis. Weniger Stufen oder größeren Preisbereich wählen.', 'Several levels have the same price after rounding. Choose fewer levels or a wider price range.'))
  if (levels.some((l) => l.problem)) errors.push(tr('Einige Stufen sind zu klein für die Börse. Weniger Stufen oder mehr Betrag wählen.', 'Some levels are too small for the exchange. Choose fewer levels or a larger amount.'))

  return {
    levels,
    totalVolume,
    totalCost,
    averagePrice: totalVolume > 0 ? totalCost / totalVolume : 0,
    valid: errors.length === 0,
    errors,
    centers,
  }
}
