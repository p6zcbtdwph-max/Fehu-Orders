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
