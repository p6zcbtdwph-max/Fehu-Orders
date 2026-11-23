// Haltefrist für Krypto in Deutschland (§ 23 EStG): Wer einen Coin länger als ein Jahr hält, verkauft ihn steuerfrei.
// Verkauft wird nach „first in, first out“: Zuerst gehen die ältesten Käufe raus.
// Rein, ohne Netz, damit es testbar ist. Keine Steuerberatung, nur eine Rechenhilfe aus den bekannten Käufen.
import { tr } from './i18n'

/** Ein Kauf oder Verkauf mit Datum. at: Unix-Sekunden. */
export interface LotEvent {
  coin: string
  side: 'buy' | 'sell'
  volume: number
  at: number
  /** app = über diese App ausgeführt, manual = selbst eingetragen */
  source: 'app' | 'manual'
}

/** Selbst eingetragener älterer Kauf (vor der App oder anderswo gekauft), je Börse */
export interface ManualLot {
  id: string
  exchange: string
  coin: string
  volume: number
  /** Kaufdatum JJJJ-MM-TT */
  date: string
}

export interface Lot {
  at: number
  volume: number
  /** Ab diesem Zeitpunkt (Unix-Sekunden) steuerfrei */
  freeAt: number
  source: 'app' | 'manual'
}

export interface HoldingPeriod {
  coin: string
  /** Noch gehaltene Käufe, älteste zuerst */
  lots: Lot[]
  /** Davon schon länger als ein Jahr gehalten */
  taxFree: number
  /** Noch in der Frist */
  inPeriod: number
  /** Nächster Kauf, der steuerfrei wird */
  next?: { freeAt: number; volume: number }
  /** Verkäufe, für die kein bekannter Kauf da war (Kauf außerhalb der App, nicht eingetragen) */
  unmatchedSells: number
}

/**
 * Ab wann ein Kauf steuerfrei ist: einen Tag nach dem Jahrestag (gekauft am 15.11.2025, steuerfrei ab 16.11.2026).
 * Gerechnet in der Ortszeit des Macs, so wie die Daten auch angezeigt werden.
 */
export function freeFrom(at: number): number {
  const d = new Date(at * 1000)
  const f = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate() + 1)
  // 29. Februar: im Folgejahr gibt es ihn nicht, JavaScript macht daraus den 1. März, plus ein Tag = 2. März. Das ist auf der sicheren Seite.
  return Math.floor(f.getTime() / 1000)
}

/** Datum JJJJ-MM-TT (Ortszeit, Mittag, damit keine Zeitzone den Tag verschiebt) in Unix-Sekunden */
export function dateToSec(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  if (d.getMonth() !== Number(m[2]) - 1) return null
  return Math.floor(d.getTime() / 1000)
}

const EPS = 1e-12

/**
 * Rechnet je Coin aus, welche Käufe noch gehalten werden (FIFO) und wie viel davon schon steuerfrei ist.
 * held: tatsächlicher Bestand je Coin bei der Börse (falls bekannt). Ist er kleiner als die bekannten Käufe
 * (zum Beispiel weil außerhalb der App verkauft wurde), werden zuerst die ältesten Käufe gekürzt. Das ist FIFO
 * und vorsichtig: Es zeigt eher zu wenig als zu viel steuerfrei an.
 */
export function holdingPeriods(events: LotEvent[], now: number, held?: Record<string, number>): HoldingPeriod[] {
  const coins = [...new Set(events.map((e) => e.coin))].sort()
  return coins.map((coin) => {
    const evs = events.filter((e) => e.coin === coin && e.volume > 0 && Number.isFinite(e.at)).sort((a, b) => a.at - b.at || (a.side === 'buy' ? -1 : 1))
    let lots: Lot[] = []
    let unmatched = 0
    for (const e of evs) {
      if (e.side === 'buy') {
        lots.push({ at: e.at, volume: e.volume, freeAt: freeFrom(e.at), source: e.source })
        continue
      }
      let rest = e.volume
      while (rest > EPS && lots.length) {
        const take = Math.min(rest, lots[0].volume)
        lots[0] = { ...lots[0], volume: lots[0].volume - take }
        rest -= take
        if (lots[0].volume <= EPS) lots.shift()
      }
      if (rest > EPS) unmatched += rest
    }
    const have = held?.[coin]
    if (have !== undefined && Number.isFinite(have)) {
      let extra = lots.reduce((a, l) => a + l.volume, 0) - Math.max(0, have)
      while (extra > EPS && lots.length) {
        const take = Math.min(extra, lots[0].volume)
        lots[0] = { ...lots[0], volume: lots[0].volume - take }
        extra -= take
        if (lots[0].volume <= EPS) lots.shift()
      }
    }
    lots = lots.filter((l) => l.volume > EPS)
    const taxFree = lots.filter((l) => l.freeAt <= now).reduce((a, l) => a + l.volume, 0)
    const waiting = lots.filter((l) => l.freeAt > now)
    const inPeriod = waiting.reduce((a, l) => a + l.volume, 0)
    const next = waiting.length ? { freeAt: waiting[0].freeAt, volume: waiting.filter((l) => l.freeAt === waiting[0].freeAt).reduce((a, l) => a + l.volume, 0) } : undefined
    return { coin, lots, taxFree, inPeriod, ...(next ? { next } : {}), unmatchedSells: unmatched }
  })
}

/** Text zum geplanten Verkauf: passt er in den steuerfreien Teil? Gibt null zurück, wenn es nichts zu sagen gibt. */
export function sellTaxNote(hp: HoldingPeriod | undefined, sellVolume: number, fmt: (n: number) => string, date: (sec: number) => string): { level: 'ok' | 'warn'; text: string } | null {
  if (!hp || !(sellVolume > 0) || !hp.lots.length) return null
  if (sellVolume <= hp.taxFree + EPS) {
    return { level: 'ok', text: tr(`Dieser Verkauf (${fmt(sellVolume)} ${hp.coin}) liegt komplett im steuerfreien Teil: Die ältesten Käufe sind über ein Jahr alt.`, `This sale (${fmt(sellVolume)} ${hp.coin}) is fully within the tax-free part: the oldest buys are more than a year old.`) }
  }
  const taxed = sellVolume - hp.taxFree
  return {
    level: 'warn',
    text: tr(
      `Von diesem Verkauf sind ${fmt(taxed)} ${hp.coin} noch innerhalb der Jahresfrist. Ein Gewinn darauf ist steuerpflichtig.${hp.next ? ` Die nächsten ${fmt(hp.next.volume)} ${hp.coin} werden am ${date(hp.next.freeAt)} steuerfrei.` : ''}`,
      `${fmt(taxed)} ${hp.coin} of this sale are still within the one-year period. A gain on them is taxable.${hp.next ? ` The next ${fmt(hp.next.volume)} ${hp.coin} become tax-free on ${date(hp.next.freeAt)}.` : ''}`,
    ),
  }
}

/** Selbst eingetragene Käufe prüfen (aus Einstellungen oder Sicherung) */
export function cleanManualLots(raw: unknown): ManualLot[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((x): ManualLot[] => {
    const o = x as Record<string, unknown>
    const volume = Number(o?.volume)
    const coin = typeof o?.coin === 'string' ? o.coin.trim().toUpperCase().slice(0, 12) : ''
    const date = typeof o?.date === 'string' ? o.date : ''
    const exchange = typeof o?.exchange === 'string' ? o.exchange : ''
    const id = typeof o?.id === 'string' && o.id ? o.id.slice(0, 40) : ''
    if (!coin || !exchange || !id || !(volume > 0) || !Number.isFinite(volume) || dateToSec(date) === null) return []
    return [{ id, exchange, coin, volume, date }]
  }).slice(0, 500)
}
