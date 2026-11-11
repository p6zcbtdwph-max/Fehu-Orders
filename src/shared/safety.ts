// Schutz vor typischen Fehlern: Schlüssel falsch kopiert, Preis auf der falschen Seite des Kurses.
// Rein, ohne Netz, damit es testbar ist.
import type { Side } from './ladder'

function base64Bytes(s: string): number | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length % 4 !== 0) return null
  try {
    return atob(s).length
  } catch {
    return null
  }
}

/**
 * Prüft das Format von API-Schlüssel und privatem Schlüssel, bevor etwas an Kraken geht.
 * Krakens privater Schlüssel ist Base64 und 64 Byte lang (88 Zeichen, endet auf ==).
 */
export function checkKeyFormat(key: string, secret: string): string[] {
  const k = key.trim()
  const s = secret.trim()
  const e: string[] = []
  if (!k || !s) return e
  if (/\s/.test(k) || /\s/.test(s)) e.push('Im Schlüssel steckt ein Leerzeichen oder Zeilenumbruch. Kopiere ihn noch einmal am Stück.')
  if (k === s) return [...e, 'API-Schlüssel und privater Schlüssel sind gleich. Du hast vermutlich zweimal dasselbe eingefügt.']
  const kBytes = base64Bytes(k)
  const sBytes = base64Bytes(s)
  if (kBytes === 64 && sBytes !== 64) return [...e, 'Die beiden Felder sind vermutlich vertauscht: Der lange Schlüssel mit „==“ am Ende gehört ins Feld „Privater Schlüssel“.']
  if (sBytes !== 64) e.push('Der private Schlüssel sieht unvollständig aus. Er ist 88 Zeichen lang und endet meist auf „==“.')
  if (k.length < 40) e.push('Der API-Schlüssel ist zu kurz. Kopiere ihn bitte vollständig.')
  return e
}

/**
 * Stufen, die auf der falschen Seite des aktuellen Kurses liegen:
 * Kauf zum oder über dem Kurs bzw. Verkauf zum oder unter dem Kurs.
 * Solche Orders würden sofort ausgeführt (oder mit Post-only sofort storniert).
 */
export function wrongSide(side: Side, prices: number[], last: number | null | undefined): number[] {
  if (!last || !(last > 0)) return []
  return prices.filter((p) => (side === 'buy' ? p >= last : p <= last))
}

/** Meldung, wenn Stufen nach dem frisch geladenen Kurs auf der falschen Seite liegen (sonst null) */
export function priceGuard(side: Side, prices: number[], last: number, fmt: (n: number) => string = String): string | null {
  const w = wrongSide(side, prices, last)
  if (!w.length) return null
  return `Der Kurs steht gerade bei ${fmt(last)}. ${w.length} ${w.length === 1 ? 'Stufe liegt' : 'Stufen liegen'} ${side === 'buy' ? 'beim oder über dem' : 'beim oder unter dem'} Kurs und ${w.length === 1 ? 'würde' : 'würden'} sofort ausgeführt oder storniert. Es wurde nichts gesendet. Passe die Preise an.`
}

/** Kursalarm: hat der Kurs die erste Stufe erreicht? Kauf: Kurs fällt darauf oder darunter. Verkauf: steigt darauf oder darüber. */
export function alarmHit(side: Side, firstPrice: number, last: number | null | undefined): boolean {
  if (!last || !(last > 0) || !(firstPrice > 0)) return false
  return side === 'buy' ? last <= firstPrice : last >= firstPrice
}

const SUFFIX: Record<string, string> = { F: 'Earn (flexibel)', S: 'Earn (gebunden)', M: 'Earn', B: 'Earn', P: 'Earn', HOLD: 'zurückgehalten' }

/**
 * Lesbarer Name eines Kraken-Assets: XXBT → BTC, ZEUR → EUR, XBT.F → BTC (Earn).
 * earn ist gesetzt, wenn das Guthaben nicht im normalen Spot-Konto liegt.
 */
export function assetLabel(code: string): { name: string; earn?: string } {
  const [raw, suffix] = code.split('.')
  let name = raw
  if (name.length === 4 && (name[0] === 'X' || name[0] === 'Z') && !['XTZ', 'ZRX'].some((x) => name.endsWith(x))) name = name.slice(1)
  if (name === 'XBT') name = 'BTC'
  if (name === 'XDG') name = 'DOGE'
  if (name.length > 4 && /^ETH2$/.test(name)) name = 'ETH'
  return suffix ? { name, earn: SUFFIX[suffix] ?? suffix } : { name }
}

/** Vorschlag für den ersten echten Test: zwei kleine Kauf-Stufen 20 % unter dem Kurs, knapp über Krakens Minimum */
export function firstTestInput(last: number, rules: { orderMin: number; costMin: number }): { side: 'buy'; priceStart: number; priceEnd: number; steps: number; total: number; spacing: 'linear'; curve: 'flat'; ratio: number } {
  const priceStart = +(last * 0.8).toPrecision(6)
  const priceEnd = +(last * 0.78).toPrecision(6)
  const perStage = Math.max(rules.orderMin * priceStart * 1.1, rules.costMin * 1.1, 5)
  return { side: 'buy', priceStart, priceEnd, steps: 2, total: Math.ceil(perStage * 2), spacing: 'linear', curve: 'flat', ratio: 1 }
}
