import { describe, expect, it } from 'vitest'
import { coinName, findPair, normalizePairName, pairLabel } from './pair-label'
import type { PairDto } from './ipc'

const pair = (id: string, name: string): PairDto => ({ id, name, base: '', quote: '', priceDecimals: 1, volumeDecimals: 8, orderMin: 0, costMin: 0 })

describe('Paar-Namen für die Anzeige', () => {
  it('Krakens XBT heißt BTC, XDG heißt DOGE', () => {
    expect(normalizePairName('XBTEUR')).toBe('BTC/EUR')
    expect(normalizePairName('XXBTZEUR')).toBe('BTC/EUR')
    expect(normalizePairName('XDGEUR')).toBe('DOGE/EUR')
    expect(normalizePairName('XXDGZEUR')).toBe('DOGE/EUR')
    expect(normalizePairName('XETHZEUR')).toBe('ETH/EUR')
    expect(normalizePairName('XBTUSDT')).toBe('BTC/USDT')
    expect(normalizePairName('XBT/EUR')).toBe('BTC/EUR')
  })
  it('andere Schreibweisen bleiben lesbar', () => {
    expect(normalizePairName('BTC-EUR')).toBe('BTC/EUR')
    expect(normalizePairName('SOLEUR')).toBe('SOL/EUR')
    expect(normalizePairName('ETHEUR')).toBe('ETH/EUR')
    expect(normalizePairName('XTZEUR')).toBe('XTZ/EUR')
    expect(normalizePairName('ZRXEUR')).toBe('ZRX/EUR')
    expect(normalizePairName('XRPEUR')).toBe('XRP/EUR')
    expect(normalizePairName('XXRPZEUR')).toBe('XRP/EUR')
  })
  it('Coin-Namen', () => {
    expect(coinName('XXBT')).toBe('BTC')
    expect(coinName('ZEUR')).toBe('EUR')
    expect(coinName('XTZ')).toBe('XTZ')
    expect(coinName('ZRX')).toBe('ZRX')
  })
  it('findet das Paar der Börse auch unter Krakens Altnamen', () => {
    const pairs = [pair('XXBTZEUR', 'BTC/EUR'), pair('XDGEUR', 'DOGE/EUR'), pair('SOLEUR', 'SOL/EUR')]
    expect(findPair('XBTEUR', pairs)?.id).toBe('XXBTZEUR')
    expect(findPair('XXDGZEUR', pairs)?.id).toBe('XDGEUR')
    expect(findPair('BTC-EUR', pairs)?.id).toBe('XXBTZEUR')
    expect(pairLabel('XBTEUR', pairs)).toBe('BTC/EUR')
    // Paar nicht in der Liste (z. B. andere Kurswährung gewählt): trotzdem BTC
    expect(pairLabel('XBTUSD', pairs)).toBe('BTC/USD')
  })
})
