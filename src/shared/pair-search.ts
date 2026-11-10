// Suche nach Handelspaaren über das Coin-Symbol (z. B. "sol", "btc", "eth/eur").
export interface Searchable {
  name: string
}

/** Rang eines Treffers: 0 Symbol exakt, 1 Symbol beginnt mit, 2 Name enthält, -1 kein Treffer */
export function matchRank(name: string, query: string): number {
  const q = query.trim().toUpperCase().replace(/\s+/g, '')
  if (!q) return 2
  const n = name.toUpperCase()
  const base = n.split('/')[0]
  if (base === q || n === q) return 0
  if (base.startsWith(q) || n.startsWith(q)) return 1
  if (n.includes(q)) return 2
  return -1
}

/** Treffer sortiert: Watchlist zuerst, dann nach Rang, dann alphabetisch */
export function searchPairs<T extends Searchable>(pairs: T[], query: string, watchlist: string[] = []): T[] {
  return pairs
    .map((p) => ({ p, r: matchRank(p.name, query), w: watchlist.includes(p.name) ? 0 : 1 }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.w - b.w || a.p.name.localeCompare(b.p.name))
    .map((x) => x.p)
}
