// Rechnung hinter dem Preis-Regler der Zonen: welche Griffe es gibt, wie weit sie reichen
// und wie ein verschobener Griff die Zonen ändert. Ohne Oberfläche, damit es testbar ist.
import { zoneEnd, type LadderZone, type Side } from './ladder'

export interface Handle {
  zone: number
  edge: 'start' | 'end'
  price: number
}

/** Griffe vom Kurs weg: Anfang Zone 1, Ende Zone 1, Anfang Zone 2 … (Zonen mit 1 Stufe haben nur einen Griff) */
export function zoneHandles(zones: LadderZone[]): Handle[] {
  const out: Handle[] = []
  zones.forEach((z, zone) => {
    out.push({ zone, edge: 'start', price: z.priceStart })
    if (z.steps !== 1) out.push({ zone, edge: 'end', price: z.priceEnd })
  })
  return out
}

/** Sinnvoller Schritt für den Regler: etwa ein Zehntausendstel des Preises, als runde Zahl (80.000 → 10) */
export function sliderStep(price: number): number {
  if (!(price > 0)) return 1
  return Math.pow(10, Math.floor(Math.log10(price)) - 4 + 1)
}

/**
 * Bereich des Reglers. Kauf: vom tiefsten Punkt (mindestens 25 % unter dem Kurs) bis zum Kurs.
 * Verkauf: vom Kurs bis mindestens 35 % darüber. Reichen die Zonen weiter, wächst der Bereich mit.
 */
export function sliderDomain(zones: LadderZone[], side: Side, last: number | null): { lo: number; hi: number } {
  const prices = zones.flatMap((z) => [z.priceStart, zoneEnd(z)]).filter((p) => p > 0 && Number.isFinite(p))
  const ref = last && last > 0 ? last : prices.length ? (side === 'buy' ? Math.max(...prices) : Math.min(...prices)) : 1
  if (side === 'buy') {
    const lo = Math.min(ref * 0.75, ...prices.map((p) => p * 0.95))
    return { lo: Math.max(0, lo), hi: Math.max(ref, ...prices) }
  }
  return { lo: Math.min(ref, ...prices), hi: Math.max(ref * 1.35, ...prices.map((p) => p * 1.05)) }
}

/**
 * Griff k auf einen neuen Preis schieben. Er bleibt zwischen seinen Nachbarn (mit mindestens einem Schritt Abstand),
 * innerhalb des Reglers und, beim Kauf, unter dem Kurs bzw. beim Verkauf darüber. Der Preis wird auf den Schritt gerundet.
 */
export function moveHandle(zones: LadderZone[], side: Side, k: number, price: number, domain: { lo: number; hi: number }, step: number): LadderZone[] {
  const hs = zoneHandles(zones)
  const h = hs[k]
  if (!h || !Number.isFinite(price)) return zones
  const dir = side === 'buy' ? -1 : 1 // vom Kurs weg: Kauf nach unten, Verkauf nach oben
  const prev = hs[k - 1]?.price
  const next = hs[k + 1]?.price
  // „near“ = Grenze zum Kurs hin, „far“ = Grenze vom Kurs weg
  let near = prev !== undefined ? prev + dir * step : side === 'buy' ? domain.hi - step : domain.lo + step
  let far = next !== undefined ? next - dir * step : side === 'buy' ? domain.lo + step : domain.hi - step
  if (side === 'buy') { far = Math.max(far, step); near = Math.max(near, far) } else { near = Math.min(near, far) }
  const lo = Math.min(near, far)
  const hi = Math.max(near, far)
  const snapped = Math.round(price / step) * step
  const p = +Math.min(hi, Math.max(lo, snapped)).toPrecision(10)
  return zones.map((z, i) => (i !== h.zone ? z : h.edge === 'start' ? { ...z, priceStart: p, ...(z.steps === 1 ? { priceEnd: p } : {}) } : { ...z, priceEnd: p }))
}
