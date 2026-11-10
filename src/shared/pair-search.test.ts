import { describe, expect, it } from 'vitest'
import { matchRank, searchPairs } from './pair-search'

const pairs = ['ADA/EUR', 'BTC/EUR', 'SOL/EUR', 'SOLV/EUR', 'BSOL/EUR', 'ETH/EUR'].map((name) => ({ name }))

describe('Paar-Suche', () => {
  it('exaktes Symbol vor Anfang vor Teiltreffer', () => {
    expect(searchPairs(pairs, 'sol').map((p) => p.name)).toEqual(['SOL/EUR', 'SOLV/EUR', 'BSOL/EUR'])
  })
  it('leere Suche zeigt alles, Watchlist zuerst', () => {
    expect(searchPairs(pairs, '', ['ETH/EUR'])[0].name).toBe('ETH/EUR')
    expect(searchPairs(pairs, '')).toHaveLength(6)
  })
  it('findet auch mit Schrägstrich und Leerzeichen', () => {
    expect(matchRank('BTC/EUR', ' btc/eur ')).toBe(0)
    expect(matchRank('BTC/EUR', 'xyz')).toBe(-1)
  })
})
