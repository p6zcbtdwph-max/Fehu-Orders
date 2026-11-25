// Lesbarer Name eines Handelspaars für die Anzeige. Börsen nennen dasselbe Paar unterschiedlich:
// Kraken in offenen Orders „XBTEUR“ (XBT ist Krakens interner Name für Bitcoin), in der Paarliste „XXBTZEUR“,
// Coinbase „BTC-EUR“, Bitvavo „BTC-EUR“. Für den Nutzer heißt es überall „BTC/EUR“.
// Nur Anzeige: An die Börse gehen weiterhin deren eigene Kürzel.
import type { PairDto } from './ipc'
import { assetLabel } from './safety'

/** Bekannte Kurswährungen, längste zuerst (damit „USDT“ vor „USD“ greift) */
const QUOTES = ['USDT', 'USDC', 'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'JPY', 'AUD', 'BTC', 'XBT', 'ETH']

/** Coin-Kürzel vereinheitlichen: XBT → BTC, XDG → DOGE, Krakens X/Z-Vorsilbe weg (XXBT, ZEUR). Wie bei den Beständen. */
export const coinName = (code: string): string => assetLabel(code.toUpperCase()).name

/** Paar-Kürzel ohne Paarliste lesbar machen: „XBTEUR“ → „BTC/EUR“, „BTC-EUR“ → „BTC/EUR“, „XXBTZEUR“ → „BTC/EUR“ */
export function normalizePairName(id: string): string {
  const s = id.trim().toUpperCase()
  const sep = s.match(/^([A-Z0-9.]+)[-/_]([A-Z0-9.]+)$/)
  if (sep) return `${coinName(sep[1])}/${coinName(sep[2])}`
  for (const q of QUOTES) {
    for (const suffix of [`Z${q}`, `X${q}`, q]) {
      if (s.length > suffix.length + 1 && s.endsWith(suffix)) {
        // „Z“/„X“ vor der Kurswährung nur bei Krakens langen Codes (XXBTZEUR, XETHZEUR)
        if (suffix !== q && s.length - suffix.length !== 4) continue
        return `${coinName(s.slice(0, -suffix.length))}/${coinName(q)}`
      }
    }
  }
  return coinName(s)
}

/** Vergleichsschlüssel ohne Trennzeichen und mit vereinheitlichten Coin-Namen */
const key = (id: string): string => normalizePairName(id).replace('/', '')

/** Passendes Paar aus der Liste der Börse, egal wie die Börse es gerade schreibt */
export function findPair(id: string, pairs: PairDto[]): PairDto | undefined {
  const k = key(id)
  return pairs.find((p) => p.id === id) ?? pairs.find((p) => key(p.name) === k || key(p.id) === k)
}

/** Name für die Anzeige, z. B. „BTC/EUR“ */
export function pairLabel(id: string, pairs: PairDto[] = []): string {
  return findPair(id, pairs)?.name ?? normalizePairName(id)
}
