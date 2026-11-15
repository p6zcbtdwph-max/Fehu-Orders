import { describe, expect, it } from 'vitest'
import { appendZone, buildLadder, MAX_STEPS, prepareForSend, splitIntoZones, validateZones, zoneSummary, type LadderInput, type PairRules } from './ladder'

const BTC_EUR: PairRules = { priceDecimals: 1, volumeDecimals: 8, orderMin: 0.00005, costMin: 0.5 }
const zoned: LadderInput = {
  side: 'buy', priceStart: 0, priceEnd: 0, steps: 0, total: 1000, spacing: 'linear', curve: 'flat', ratio: 3,
  zones: [
    { priceStart: 60000, priceEnd: 57000, steps: 4, share: 20 },
    { priceStart: 53000, priceEnd: 50000, steps: 4, share: 50 },
    { priceStart: 45000, priceEnd: 42000, steps: 2, share: 30 },
  ],
}

describe('Preiszonen', () => {
  it('verteilt den Betrag nach den Anteilen der Zonen', () => {
    const l = buildLadder(zoned, BTC_EUR)
    expect(l.valid).toBe(true)
    expect(l.levels).toHaveLength(10)
    const byZone = [0, 1, 2].map((z) => l.levels.filter((x) => x.zone === z).reduce((a, x) => a + x.cost, 0))
    expect(byZone[0]).toBeCloseTo(200, 0)
    expect(byZone[1]).toBeCloseTo(500, 0)
    expect(byZone[2]).toBeCloseTo(300, 0)
    expect(l.totalCost).toBeLessThanOrEqual(1000)
    expect(l.levels.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1)
  })
  it('zwischen den Zonen liegen keine Stufen, Indizes laufen durch', () => {
    const l = buildLadder(zoned, BTC_EUR)
    expect(l.levels.map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(l.levels.map((x) => x.price)).toEqual([60000, 59000, 58000, 57000, 53000, 52000, 51000, 50000, 45000, 42000])
    expect(l.levels.some((x) => x.price < 57000 && x.price > 53000)).toBe(false)
  })
  it('Preisabstände und Mengenverteilung gelten in jeder Zone', () => {
    const l = buildLadder({ ...zoned, curve: 'linear', ratio: 3 }, BTC_EUR)
    const z1 = l.levels.filter((x) => x.zone === 1)
    // innerhalb der Zone wächst der Betrag von Stufe zu Stufe
    for (let i = 1; i < z1.length; i++) expect(z1[i].cost).toBeGreaterThan(z1[i - 1].cost)
  })
  it('Anteile müssen nicht 100 ergeben, sie werden umgerechnet', () => {
    const half = { ...zoned, zones: zoned.zones!.map((z) => ({ ...z, share: z.share / 2 })) }
    expect(buildLadder(half, BTC_EUR).levels.map((x) => x.volume)).toEqual(buildLadder(zoned, BTC_EUR).levels.map((x) => x.volume))
  })
  it('überlappende oder falsch sortierte Zonen sind ungültig', () => {
    const overlap = { ...zoned, zones: [{ priceStart: 60000, priceEnd: 52000, steps: 3, share: 50 }, { priceStart: 53000, priceEnd: 50000, steps: 3, share: 50 }] }
    expect(buildLadder(overlap, BTC_EUR).valid).toBe(false)
    expect(validateZones(overlap)[0]).toContain('Zone 2')
    const sell = { ...zoned, side: 'sell' as const }
    expect(buildLadder(sell, BTC_EUR).valid).toBe(false)
  })
  it('Verkauf: Zonen gehen nach oben', () => {
    const sell: LadderInput = { ...zoned, side: 'sell', total: 0.1, zones: [{ priceStart: 70000, priceEnd: 72000, steps: 3, share: 1 }, { priceStart: 80000, priceEnd: 85000, steps: 3, share: 1 }] }
    const l = buildLadder(sell, BTC_EUR)
    expect(l.valid).toBe(true)
    expect(l.totalVolume).toBeLessThanOrEqual(0.1)
    expect(l.levels[0].price).toBe(70000)
    expect(l.levels[5].price).toBe(85000)
  })
  it('eine Zone mit 1 Stufe nutzt nur ihren Startpreis', () => {
    const one = { ...zoned, zones: [{ priceStart: 60000, priceEnd: 0, steps: 1, share: 50 }, { priceStart: 50000, priceEnd: 48000, steps: 2, share: 50 }] }
    const l = buildLadder(one, BTC_EUR)
    expect(l.valid).toBe(true)
    expect(l.levels.map((x) => x.price)).toEqual([60000, 50000, 48000])
    expect(zoneSummary(one)).toMatchObject({ priceStart: 60000, priceEnd: 48000, steps: 3 })
  })
  it('Zonen, die nach dem Runden auf denselben Preis fallen, werden gemeldet', () => {
    const tight = { ...zoned, zones: [{ priceStart: 60000, priceEnd: 59000.05, steps: 2, share: 1 }, { priceStart: 59000.01, priceEnd: 58000, steps: 2, share: 1 }] }
    const l = buildLadder(tight, BTC_EUR)
    expect(l.valid).toBe(false)
  })
  it('Fehler einer Zone nennen die Zone', () => {
    const tiny = { ...zoned, total: 3 }
    const l = buildLadder(tiny, BTC_EUR)
    expect(l.valid).toBe(false)
    expect(l.errors.some((e) => e.startsWith('Zone'))).toBe(true)
  })
  it('Mindest-Orderwert hebt auch in Zonen zu kleine Stufen an', () => {
    const l = buildLadder({ ...zoned, total: 60 }, BTC_EUR, { minCost: 10 })
    expect(l.levels.every((x) => x.cost >= 10 - 1e-9)).toBe(true)
    expect(l.raised?.count).toBeGreaterThan(0)
  })
  it('eigene Prozente und zu viele Stufen gehen mit Zonen nicht', () => {
    expect(validateZones({ ...zoned, curve: 'custom' }).length).toBe(1)
    expect(validateZones({ ...zoned, zones: [{ priceStart: 60000, priceEnd: 40000, steps: MAX_STEPS + 1, share: 1 }] }).length).toBe(1)
  })
  it('Zusammenfassung hält Anfang, Ende und Stufenzahl passend und schaltet die Regler ab', () => {
    expect(zoneSummary({ ...zoned, orderCenter: 0.2 })).toMatchObject({ priceStart: 60000, priceEnd: 42000, steps: 10, orderCenter: undefined })
  })
  it('die fertigen Stufen bestehen die letzte Prüfung vor dem Senden', () => {
    const l = buildLadder(zoned, BTC_EUR, { minCost: 10 })
    expect(prepareForSend(l.levels, BTC_EUR, 'buy', 10).error).toBeUndefined()
  })
})

describe('Zonen anlegen', () => {
  it('teilt einen Bereich in drei Zonen mit Lücken', () => {
    const zs = splitIntoZones({ priceStart: 60000, priceEnd: 48000, steps: 9 })
    expect(zs).toHaveLength(3)
    expect(zs.map((z) => z.share)).toEqual([30, 40, 30])
    expect(zs[0].priceStart).toBe(60000)
    expect(zs[2].priceEnd).toBe(48000)
    expect(zs.every((z) => z.steps === 3)).toBe(true)
    expect(validateZones({ ...zoned, zones: zs })).toEqual([])
    expect(validateZones({ ...zoned, side: 'sell', zones: splitIntoZones({ priceStart: 70000, priceEnd: 90000, steps: 9 }) })).toEqual([])
  })
  it('hängt eine weitere Zone hinten an', () => {
    const zs = appendZone(splitIntoZones({ priceStart: 60000, priceEnd: 48000, steps: 9 }), 'buy')
    expect(zs).toHaveLength(4)
    expect(zs[3].priceStart).toBeLessThan(48000)
    expect(validateZones({ ...zoned, zones: zs })).toEqual([])
    const up = appendZone([{ priceStart: 70000, priceEnd: 72000, steps: 2, share: 1 }], 'sell')
    expect(up[1].priceStart).toBeGreaterThan(72000)
  })
  it('hängt keine Zone mit Preis unter 0 an', () => {
    const zs = [{ priceStart: 2, priceEnd: 1, steps: 2, share: 1 }]
    expect(appendZone(zs, 'buy')).toHaveLength(1)
  })
})

describe('Entschärfte Zonen und Aufteilung', () => {
  it('normalizeShares ergibt immer ganze Prozent mit Summe 100, jede Zone mindestens 1 %', async () => {
    const { normalizeShares } = await import('./ladder')
    for (const shares of [[30, 40, 30], [1, 1, 1], [50, 50, 50, 50], [99, 0.1, 0.1], [33.3, 33.3, 33.4], [0, 0]]) {
      const out = normalizeShares(shares.map((share) => ({ priceStart: 1, priceEnd: 1, steps: 1, share }))).map((z) => z.share)
      expect(out.reduce((a, b) => a + b, 0)).toBe(100)
      expect(out.every((x) => Number.isInteger(x) && x >= 1)).toBe(true)
    }
  })
  it('heldZones und zoneTrigger mit Standard „vorige Zone, 50 %“', async () => {
    const { heldZones, zoneTrigger } = await import('./ladder')
    const zs = [{ priceStart: 3, priceEnd: 2, steps: 2, share: 1 }, { priceStart: 1.5, priceEnd: 1, steps: 2, share: 1, armed: false }, { priceStart: 0.8, priceEnd: 0.5, steps: 2, share: 1, armed: false, trigger: { zone: 0, percent: 150 } }]
    expect([...heldZones({ zones: zs })]).toEqual([1, 2])
    expect(zoneTrigger(zs, 1)).toEqual({ zone: 0, percent: 50 })
    expect(zoneTrigger(zs, 2)).toEqual({ zone: 0, percent: 100 })
  })
  it('alle Zonen entschärft ist ungültig', () => {
    expect(validateZones({ ...zoned, zones: zoned.zones!.map((z) => ({ ...z, armed: false })) }).join(' ')).toMatch(/Mindestens eine Zone/)
  })
  it('neu angehängte Zone ist erst einmal entschärft', () => {
    expect(appendZone(zoned.zones!, 'buy')[3].armed).toBe(false)
  })
})

describe('Fortschritt je Zone', () => {
  it('ordnet Ausführungen über den Limitpreis den Zonen zu', async () => {
    const { zoneProgress, triggerMet } = await import('./plan-status')
    const levels = [
      { index: 0, price: 100, volume: 1, zone: 0 }, { index: 1, price: 95, volume: 1, zone: 0 },
      { index: 2, price: 80, volume: 2, zone: 1 }, { index: 3, price: 75, volume: 2, zone: 1 },
      { index: 4, price: 60, volume: 3, zone: 2 },
    ]
    const p = zoneProgress(levels, [0, 1, 2, 3], [
      { price: 99.5, limitPrice: 100, filled: 1 }, { price: 95, filled: 1 }, // Zone 1 ganz
      { price: 79, limitPrice: 80, filled: 2 }, { price: 75, limitPrice: 75, filled: 0 }, // Zone 2 halb
    ])
    expect(p.map((z) => Math.round(z.filledShare * 100))).toEqual([100, 50, 0])
    expect(p[2]).toMatchObject({ levels: 1, sent: 0, sentVolume: 0 })
    expect(triggerMet(p, { zone: 1, percent: 50 })).toBe(true)
    expect(triggerMet(p, { zone: 1, percent: 51 })).toBe(false)
    expect(triggerMet(p, { zone: 2, percent: 1 })).toBe(false)
    expect(triggerMet(undefined, { zone: 0, percent: 1 })).toBe(false)
    expect(zoneProgress([{ index: 0, price: 1, volume: 1 }], [0], [])).toEqual([])
  })
})
