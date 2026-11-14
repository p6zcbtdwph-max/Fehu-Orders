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
  /**
   * Nur für Börsen, die Preise nach gültigen Ziffern begrenzen (ältere Bitvavo-Märkte ohne tickSize:
   * „pricePrecision 5“ heißt 76543 erlaubt, 76543.2 nicht). Fehlt der Wert, zählen nur Nachkommastellen und tickSize.
   */
  priceSignificant?: number
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

/**
 * Ganzzahl-Rundung mit Schutz vor Gleitkomma-Resten: liegt x so nah an einer ganzen Zahl, dass der Abstand nur
 * Rechenungenauigkeit sein kann (z. B. 7085982107.9999990 statt 7085982108), gilt diese ganze Zahl.
 * Die frühere Korrektur mit toFixed(6) reichte bei großen Zahlen (Preis × 10^Nachkommastellen über 10^9) nicht.
 */
export function snapRound(x: number, mode: 'down' | 'up' | 'nearest'): number {
  const near = Math.round(x)
  if (Math.abs(x - near) <= Math.abs(x) * 1e-12 + 1e-9) return near
  return mode === 'down' ? Math.floor(x) : mode === 'up' ? Math.ceil(x) : near
}

function roundTo(value: number, decimals: number, mode: 'down' | 'up' | 'nearest'): number {
  if (!Number.isFinite(value)) return value
  const d = Math.max(0, Math.min(20, Math.floor(decimals)))
  const f = Math.pow(10, d)
  // Teilen durch 10^d (statt mal 10^-d) liefert die Gleitkommazahl, die dem Dezimalwert am nächsten liegt
  return snapRound(value * f, mode) / f
}

/**
 * Rundet einen Preis auf Krakens Preisschritt (tick size) und die Nachkommastellen.
 * Kauf rundet ab, Verkauf auf: so wird nie schlechter gehandelt als berechnet.
 */
export function roundPrice(value: number, rules: Pick<PairRules, 'priceDecimals' | 'tickSize' | 'priceSignificant'>, mode: 'down' | 'up'): number {
  if (!Number.isFinite(value)) return value
  const sig = rules.priceSignificant
  if (sig && sig > 0 && !(rules.tickSize && rules.tickSize > 0) && value > 0) {
    // Preisschritt aus den gültigen Ziffern: bei 5 Ziffern und 76543.2 ist der Schritt 1, bei 0.0123456 ist er 0.0000001
    const digits = Math.floor(Math.log10(value)) + 1
    const exp = Math.max(digits - Math.floor(sig), -Math.max(0, Math.floor(rules.priceDecimals)))
    // Beim Aufrunden kann eine Stelle dazukommen (99999.5 → 100000), das passt dann immer noch
    return roundToExp(value, exp, mode)
  }
  const tick = rules.tickSize && rules.tickSize > 0 ? rules.tickSize : 0
  if (!tick || Math.abs(tick - Math.pow(10, -rules.priceDecimals)) < 1e-15) return roundTo(value, rules.priceDecimals, mode)
  const n = snapRound(value / tick, mode)
  return Number((n * tick).toFixed(Math.max(0, Math.min(20, Math.floor(rules.priceDecimals)))))
}

/** Kleinster erlaubter Preisschritt bei diesem Preis (tickSize, gültige Ziffern oder letzte Nachkommastelle) */
export function priceStep(price: number, rules: Pick<PairRules, 'priceDecimals' | 'tickSize' | 'priceSignificant'>): number {
  if (rules.tickSize && rules.tickSize > 0) return rules.tickSize
  const sig = rules.priceSignificant
  if (sig && sig > 0 && price > 0) return Math.pow(10, Math.max(Math.floor(Math.log10(price)) + 1 - Math.floor(sig), -Math.max(0, Math.floor(rules.priceDecimals))))
  return Math.pow(10, -rules.priceDecimals)
}

/** Rundet auf Vielfache von 10^exp (exp darf negativ sein: -2 = auf Hundertstel) */
function roundToExp(value: number, exp: number, mode: 'down' | 'up'): number {
  if (exp <= 0) return roundTo(value, -exp, mode)
  const f = Math.pow(10, exp)
  return snapRound(value / f, mode) * f
}

/**
 * Preis als Text mit genau den Nachkommastellen, die die Börse erlaubt (z. B. "76543.2").
 * Ohne diesen Schritt würde aus 76543.2 durch Gleitkomma-Reste "76543.199999999997",
 * und Kraken lehnt das mit „price can only be specified up to 1 decimals“ ab.
 */
export function priceText(price: number, rules: Pick<PairRules, 'priceDecimals' | 'tickSize' | 'priceSignificant'>): string {
  return toText(snapNearest(price, rules), rules.priceDecimals)
}

/** Menge als Text mit höchstens den erlaubten Nachkommastellen (immer abgerundet) */
export function volumeText(volume: number, rules: Pick<PairRules, 'volumeDecimals'>): string {
  return toText(roundTo(volume, rules.volumeDecimals, 'down'), rules.volumeDecimals)
}

function snapNearest(price: number, rules: Pick<PairRules, 'priceDecimals' | 'tickSize' | 'priceSignificant'>): number {
  const down = roundPrice(price, rules, 'down')
  const up = roundPrice(price, rules, 'up')
  return price - down <= up - price ? down : up
}

function toText(n: number, decimals: number): string {
  const d = Math.max(0, Math.min(20, Math.floor(decimals)))
  const s = n.toFixed(d)
  return d > 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/**
 * Letzte Sicherung vor dem Senden: bringt Preise und Mengen auf die aktuellen Regeln des Paars
 * (wichtig für Entwürfe und „Rest senden“, deren Stufen mit älteren Regeln berechnet wurden).
 * Kauf rundet den Preis ab, Verkauf auf, die Menge immer ab. duplicate: zwei Stufen hätten danach denselben Preis.
 */
export function conformLevels<T extends Pick<LadderLevel, 'price' | 'volume'>>(levels: T[], rules: PairRules, side: Side): { levels: T[]; duplicate: boolean; changed: number } {
  let changed = 0
  const out = levels.map((l) => {
    const price = roundPrice(l.price, rules, side === 'buy' ? 'down' : 'up')
    const volume = roundTo(l.volume, rules.volumeDecimals, 'down')
    if (price === l.price && volume === l.volume) return l
    changed++
    return { ...l, price, volume, ...('cost' in l ? { cost: price * volume } : {}) }
  })
  const prices = new Set(out.map((l) => l.price))
  return { levels: out, duplicate: prices.size < out.length, changed }
}

/**
 * Fallen nach dem Runden Stufen auf denselben Preis (eng gesetzte Stufen, z. B. mit dem Schwerpunkt-Regler),
 * rückt jede um einen Preisschritt weiter weg vom Kurs (Kauf tiefer, Verkauf höher), solange sie dabei
 * die letzte Stufe nicht erreicht. Geht das nicht, bleibt der doppelte Preis stehen und wird als Fehler gemeldet.
 */
function separateLevels(prices: number[], rules: Pick<PairRules, 'priceDecimals' | 'tickSize' | 'priceSignificant'>, side: Side): number[] {
  if (prices.length < 3) return prices
  const dir = side === 'buy' ? -1 : 1
  const last = prices[prices.length - 1]
  const out = prices.slice()
  for (let i = 1; i < out.length - 1; i++) {
    if ((out[i] - out[i - 1]) * dir > 0) continue
    const next = roundPrice(out[i - 1] + dir * priceStep(out[i - 1], rules), rules, side === 'buy' ? 'down' : 'up')
    if ((last - next) * dir > 0) out[i] = next
  }
  return out
}

/**
 * Grund, warum die Börse eine Stufe ablehnen würde (Menge 0, unter Mindestmenge, unter Mindestbetrag), sonst undefined.
 * Dieselbe Prüfung läuft im Planer und noch einmal direkt vor dem Senden, nach dem letzten Runden.
 */
export function levelProblem(price: number, volume: number, rules: Pick<PairRules, 'orderMin' | 'costMin'>): string | undefined {
  if (!Number.isFinite(price) || !(price > 0)) return tr('Preis wird nach dem Runden 0 oder ist ungültig', 'Price becomes 0 after rounding or is invalid')
  if (!Number.isFinite(volume) || volume <= 0) return tr('Menge wird nach dem Runden 0', 'Volume becomes 0 after rounding')
  if (volume < rules.orderMin) return tr(`Menge unter Mindestmenge ${rules.orderMin}`, `Volume below minimum ${rules.orderMin}`)
  // winzige Toleranz, damit 0.1 × 50 = 4.999999999 nicht als „unter 5 €“ gilt
  if (price * volume < rules.costMin * (1 - 1e-9)) return tr(`Gegenwert unter Mindestbetrag ${rules.costMin}`, `Value below minimum cost ${rules.costMin}`)
  return undefined
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

  // Kauf: Preis abrunden, Verkauf: aufrunden. So wird nie schlechter gehandelt als berechnet.
  const prices = separateLevels(ts.map((t) => roundPrice(priceAt(spacing, priceStart, priceEnd, t), rules, side === 'buy' ? 'down' : 'up')), rules, side)
  const levels: LadderLevel[] = weights.map((w, i) => {
    const share = w / sum
    const price = prices[i]
    // Menge immer abrunden, damit Budget bzw. Bestand nie überschritten wird
    // Preis 0 nach dem Runden (Preis kleiner als ein Preisschritt): keine Menge, die Stufe wird als Problem gemeldet
    const rawVolume = !(price > 0) ? 0 : side === 'buy' ? (total * share) / price : total * share
    const volume = roundTo(rawVolume, rules.volumeDecimals, 'down')
    const cost = volume * price
    return { index: i, price, volume, cost, share, problem: levelProblem(price, volume, rules) }
  })

  const ok = levels.filter((l) => !l.problem)
  const totalVolume = ok.reduce((a, l) => a + l.volume, 0)
  const totalCost = ok.reduce((a, l) => a + l.cost, 0)
  // Jede Stufe muss echt weiter weg vom Kurs liegen als die vorige (Kauf tiefer, Verkauf höher).
  // Früher wurde nur mit der direkten Nachbarstufe verglichen: Passten nicht alle Stufen in den Preisbereich,
  // sprang eine Stufe zurück auf einen schon belegten Preis, und der Planer meldete trotzdem „gültig“.
  const dir = side === 'buy' ? -1 : 1
  const unordered = levels.some((l, i) => i > 0 && !((l.price - levels[i - 1].price) * dir > 0))
  if (unordered) errors.push(tr('Mehrere Stufen haben nach dem Runden denselben Preis. Weniger Stufen oder größeren Preisbereich wählen.', 'Several levels have the same price after rounding. Choose fewer levels or a wider price range.'))
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

/**
 * Letzte Prüfung direkt vor dem Senden, nach dem letzten Runden auf die aktuellen Regeln des Paars.
 * Fehlt etwas, wird gar nichts gesendet (error), statt dass die Börse einzelne Orders ablehnt:
 * - jede Stufe braucht einen gültigen Preis und eine Menge über 0
 * - keine zwei Stufen auf demselben Preis
 * - jede Stufe erfüllt nach dem Runden noch Mindestmenge und Mindestbetrag
 */
export function prepareForSend<T extends Pick<LadderLevel, 'price' | 'volume'> & { index?: number }>(levels: T[], rules: PairRules, side: Side): { levels: T[]; error?: string } {
  const bad = levels.filter((l) => !Number.isFinite(l.price) || !(l.price > 0) || !Number.isFinite(l.volume) || !(l.volume > 0))
  if (bad.length) return { levels, error: tr(`${bad.length} Stufe(n) haben einen ungültigen Preis oder eine ungültige Menge. Es wurde nichts gesendet.`, `${bad.length} level(s) have an invalid price or volume. Nothing was sent.`) }
  const r = conformLevels(levels, rules, side)
  if (r.duplicate) return { levels: r.levels, error: tr('Nach dem Runden auf die erlaubten Preisschritte lägen mehrere Stufen auf demselben Preis. Es wurde nichts gesendet. Bitte im Planer weniger Stufen oder einen größeren Preisbereich wählen.', 'After rounding to the allowed price steps, several levels would have the same price. Nothing was sent. Please choose fewer levels or a wider price range in the planner.') }
  const small = r.levels.map((l, i) => ({ i, p: levelProblem(l.price, l.volume, rules) })).filter((x) => x.p)
  if (small.length) {
    const first = small[0]
    const n = (r.levels[first.i].index ?? first.i) + 1
    return {
      levels: r.levels,
      error: tr(
        `${small.length} Stufe(n) würde die Börse ablehnen (z. B. Stufe ${n}: ${first.p}). Es wurde nichts gesendet. Bitte im Planer weniger Stufen oder mehr Betrag wählen.`,
        `The exchange would reject ${small.length} level(s) (e.g. level ${n}: ${first.p}). Nothing was sent. Please choose fewer levels or a larger amount in the planner.`,
      ),
    }
  }
  return { levels: r.levels }
}
