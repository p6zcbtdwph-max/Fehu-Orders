// Offene Orders je Handelspaar und Richtung zusammenfassen, nur für die Anzeige.
// Bei der Börse ändert sich nichts: jede Order bleibt einzeln bestehen und lässt sich einzeln stornieren.
// Rein, ohne Oberfläche, damit es testbar ist.
import type { Side } from './ladder'

export interface GroupableOrder {
  txid: string
  pair: string
  side: Side
  price: number
  volume: number
  filled: number
  userref: number
}

export interface OrderGroup<T extends GroupableOrder = GroupableOrder> {
  /** Paar und Richtung, z. B. „XBTEUR|buy“ */
  key: string
  pair: string
  side: Side
  /** Die einzelnen Orders, Preis absteigend */
  orders: T[]
  /** Noch offene Menge (ohne den schon ausgeführten Teil) */
  open: number
  filled: number
  /** Ø Limitpreis der noch offenen Menge (nach Menge gewichtet) */
  averagePrice: number
  highPrice: number
  lowPrice: number
  /** Gegenwert der noch offenen Menge zum Limitpreis. Beim Kaufen ist das der gesperrte Betrag. */
  openValue: number
  /** Zu wie vielen Plänen der App die Orders gehören (0 = Orders ohne Plan-Nummer) */
  plans: number[]
}

const rest = (o: GroupableOrder): number => Math.max(0, o.volume - o.filled)

export function groupOpenOrders<T extends GroupableOrder>(orders: T[]): OrderGroup<T>[] {
  const map = new Map<string, T[]>()
  for (const o of orders) {
    const key = `${o.pair}|${o.side}`
    const list = map.get(key)
    if (list) list.push(o)
    else map.set(key, [o])
  }
  const groups: OrderGroup<T>[] = []
  for (const [key, list] of map) {
    const sorted = [...list].sort((a, b) => b.price - a.price)
    const open = sorted.reduce((a, o) => a + rest(o), 0)
    const openValue = sorted.reduce((a, o) => a + rest(o) * o.price, 0)
    groups.push({
      key, pair: sorted[0].pair, side: sorted[0].side, orders: sorted,
      open, filled: sorted.reduce((a, o) => a + o.filled, 0),
      // Ist alles schon ausgeführt (Menge 0), gilt der einfache Durchschnitt der Limitpreise
      averagePrice: open > 0 ? openValue / open : sorted.reduce((a, o) => a + o.price, 0) / sorted.length,
      highPrice: sorted[0].price,
      lowPrice: sorted[sorted.length - 1].price,
      openValue,
      plans: [...new Set(sorted.map((o) => o.userref).filter((u) => u > 0))].sort((a, b) => a - b),
    })
  }
  // Größter offener Gegenwert zuerst
  return groups.sort((a, b) => b.openValue - a.openValue)
}
