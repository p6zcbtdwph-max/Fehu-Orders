import { describe, it, expect } from 'vitest'
import { cleanManualLots, dateToSec, freeFrom, holdingPeriods, sellTaxNote, type LotEvent } from './holding-period'
import { setLang } from './i18n'

setLang('de')
const at = (date: string) => dateToSec(date)!
const buy = (date: string, volume: number, source: LotEvent['source'] = 'app'): LotEvent => ({ coin: 'BTC', side: 'buy', volume, at: at(date), source })
const sell = (date: string, volume: number): LotEvent => ({ coin: 'BTC', side: 'sell', volume, at: at(date), source: 'app' })
const day = (sec: number) => { const d = new Date(sec * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

describe('Haltefrist', () => {
  it('steuerfrei ab dem Tag nach dem Jahrestag', () => {
    expect(day(freeFrom(at('2025-11-15')))).toBe('2026-11-16')
    expect(day(freeFrom(at('2025-12-31')))).toBe('2027-01-01')
    // 29. Februar: lieber einen Tag zu spät als zu früh
    expect(day(freeFrom(at('2024-02-29')))).toBe('2025-03-02')
  })

  it('ungültige Daten werden abgelehnt', () => {
    expect(dateToSec('2026-02-30')).toBeNull()
    expect(dateToSec('15.11.2025')).toBeNull()
  })

  it('teilt Bestand in steuerfrei und noch in der Frist', () => {
    const now = at('2026-11-23')
    const [hp] = holdingPeriods([buy('2025-10-01', 0.01), buy('2025-11-23', 0.02), buy('2026-03-01', 0.03)], now)
    // 23.11.2025 gekauft → erst ab 24.11.2026 frei
    expect(hp.taxFree).toBeCloseTo(0.01)
    expect(hp.inPeriod).toBeCloseTo(0.05)
    expect(day(hp.next!.freeAt)).toBe('2026-11-24')
    expect(hp.next!.volume).toBeCloseTo(0.02)
  })

  it('Verkäufe nehmen zuerst die ältesten Käufe (FIFO)', () => {
    const now = at('2026-11-23')
    const [hp] = holdingPeriods([buy('2025-01-01', 0.01), buy('2026-06-01', 0.02), sell('2026-07-01', 0.015)], now)
    expect(hp.taxFree).toBe(0)
    expect(hp.lots).toHaveLength(1)
    expect(hp.lots[0].volume).toBeCloseTo(0.015)
    expect(hp.unmatchedSells).toBe(0)
  })

  it('kleinerer echter Bestand kürzt zuerst die ältesten Käufe (vorsichtig)', () => {
    const now = at('2026-11-23')
    const [hp] = holdingPeriods([buy('2025-01-01', 0.01), buy('2026-06-01', 0.02)], now, { BTC: 0.025 })
    expect(hp.taxFree).toBeCloseTo(0.005)
    expect(hp.inPeriod).toBeCloseTo(0.02)
  })

  it('Verkäufe ohne bekannten Kauf werden gemeldet', () => {
    const [hp] = holdingPeriods([sell('2026-01-01', 0.01)], at('2026-11-23'))
    expect(hp.unmatchedSells).toBeCloseTo(0.01)
    expect(hp.lots).toHaveLength(0)
  })

  it('Hinweis zum geplanten Verkauf', () => {
    const now = at('2026-11-23')
    const [hp] = holdingPeriods([buy('2025-01-01', 0.01), buy('2026-06-01', 0.02)], now)
    const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6)
    expect(sellTaxNote(hp, 0.008, fmt, day)?.level).toBe('ok')
    const w = sellTaxNote(hp, 0.015, fmt, day)
    expect(w?.level).toBe('warn')
    expect(w?.text).toMatch(/0.005 BTC noch innerhalb der Jahresfrist/)
    expect(w?.text).toMatch(/2027-06-02/)
    expect(sellTaxNote(hp, 0, fmt, day)).toBeNull()
  })

  it('eingetragene Käufe werden geprüft', () => {
    expect(cleanManualLots([
      { id: 'a', exchange: 'kraken', coin: ' btc ', volume: 0.1, date: '2024-05-01' },
      { id: 'b', exchange: 'kraken', coin: 'ETH', volume: -1, date: '2024-05-01' },
      { id: 'c', exchange: 'kraken', coin: 'ETH', volume: 1, date: 'gestern' },
      'Unsinn',
    ])).toEqual([{ id: 'a', exchange: 'kraken', coin: 'BTC', volume: 0.1, date: '2024-05-01' }])
    expect(cleanManualLots(undefined)).toEqual([])
  })
})
