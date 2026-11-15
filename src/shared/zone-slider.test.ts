import { describe, expect, it } from 'vitest'
import { moveHandle, sliderDomain, sliderStep, zoneHandles } from './zone-slider'
import { validateZones, type LadderZone } from './ladder'

const zones: LadderZone[] = [
  { priceStart: 78000, priceEnd: 75000, steps: 3, share: 30 },
  { priceStart: 72000, priceEnd: 69000, steps: 3, share: 40 },
  { priceStart: 65000, priceEnd: 65000, steps: 1, share: 30 },
]
const base = { side: 'buy' as const, priceStart: 0, priceEnd: 0, steps: 0, total: 100, spacing: 'linear' as const, curve: 'flat' as const, ratio: 1 }

describe('Preis-Regler der Zonen', () => {
  it('Griffe vom Kurs weg, Zone mit 1 Stufe hat nur einen', () => {
    expect(zoneHandles(zones).map((h) => `${h.zone}${h.edge[0]}${h.price}`)).toEqual(['0s78000', '0e75000', '1s72000', '1e69000', '2s65000'])
  })
  it('Schritt und Bereich', () => {
    expect(sliderStep(80000)).toBe(10)
    expect(sliderStep(0.6)).toBeCloseTo(0.0001)
    expect(sliderDomain(zones, 'buy', 80000)).toEqual({ lo: 60000, hi: 80000 })
    const sell = sliderDomain([{ priceStart: 90000, priceEnd: 150000, steps: 2, share: 1 }], 'sell', 80000)
    expect(sell.lo).toBe(80000)
    expect(sell.hi).toBeCloseTo(157500)
  })
  it('ein Griff bleibt zwischen seinen Nachbarn, die Zonen bleiben gültig', () => {
    const d = sliderDomain(zones, 'buy', 80000)
    const moved = moveHandle(zones, 'buy', 2, 76000, d, 10) // Anfang Zone 2 nach oben über Zone 1 hinaus
    expect(moved[1].priceStart).toBe(74990)
    expect(validateZones({ ...base, zones: moved })).toEqual([])
    const down = moveHandle(zones, 'buy', 1, 10000, d, 10) // Ende Zone 1 weit nach unten
    expect(down[0].priceEnd).toBe(72010)
    const top = moveHandle(zones, 'buy', 0, 99000, d, 10) // nicht über den Kurs
    expect(top[0].priceStart).toBe(79990)
    const one = moveHandle(zones, 'buy', 4, 61234, d, 10) // 1-Stufen-Zone: Anfang und Ende wandern mit, gerundet
    expect(one[2]).toMatchObject({ priceStart: 61230, priceEnd: 61230 })
    const floor = moveHandle(zones, 'buy', 4, 0, d, 10)
    expect(floor[2].priceStart).toBe(60010)
  })
  it('Verkauf: Zonen gehen nach oben', () => {
    const sz: LadderZone[] = [{ priceStart: 85000, priceEnd: 90000, steps: 2, share: 1 }, { priceStart: 100000, priceEnd: 110000, steps: 2, share: 1 }]
    const d = sliderDomain(sz, 'sell', 80000)
    const m = moveHandle(sz, 'sell', 1, 105000, d, 10)
    expect(m[0].priceEnd).toBe(99990)
    expect(moveHandle(sz, 'sell', 0, 70000, d, 10)[0].priceStart).toBe(80010)
    expect(validateZones({ ...base, side: 'sell', zones: m })).toEqual([])
  })
})
