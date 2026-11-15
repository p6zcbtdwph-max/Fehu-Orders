// Menge in Stück oder Geld, gesamt oder pro Stufe (Kaufen und Verkaufen)
import { describe, it, expect } from 'vitest'
import { amountUnit, buildLadder, otherUnitLadder, planAmount, prepareForSend, type LadderInput, type PairRules } from './ladder'
import { setLang } from './i18n'

setLang('de')
const sol: PairRules = { priceDecimals: 2, volumeDecimals: 8, orderMin: 0.02, costMin: 0.5 }
const sell: LadderInput = { side: 'sell', priceStart: 150, priceEnd: 250, steps: 5, total: 5, spacing: 'linear', curve: 'flat', ratio: 1 }
const buy: LadderInput = { side: 'buy', priceStart: 140, priceEnd: 100, steps: 5, total: 500, spacing: 'linear', curve: 'flat', ratio: 1 }

describe('Einheit der Menge', () => {
  it('ältere Pläne ohne Einheit: Kauf in Geld, Verkauf in Stück', () => {
    expect(amountUnit({ side: 'buy' })).toBe('quote')
    expect(amountUnit({ side: 'sell' })).toBe('base')
    // ohne neue Felder rechnet der Planer genau wie vorher
    const a = buildLadder(sell, sol)
    const b = buildLadder({ ...sell, unit: 'base', perLevel: false }, sol)
    expect(b.levels).toEqual(a.levels)
    const c = buildLadder(buy, sol)
    const d = buildLadder({ ...buy, unit: 'quote' }, sol)
    expect(d.levels).toEqual(c.levels)
  })

  it('Verkauf pro Stufe: jede Stufe genau 1 SOL', () => {
    const l = buildLadder({ ...sell, total: 1, perLevel: true }, sol)
    expect(l.valid).toBe(true)
    expect(l.levels.map((x) => x.volume)).toEqual([1, 1, 1, 1, 1])
    expect(l.totalVolume).toBe(5)
    expect(planAmount({ total: 1, perLevel: true, steps: 5 })).toBe(5)
  })

  it('pro Stufe gilt auch mit Kurve und Volumen-Regler: alle Stufen gleich', () => {
    const l = buildLadder({ ...sell, total: 0.3, perLevel: true, curve: 'exp', ratio: 5, volumeCenter: 0.9 }, sol)
    expect(new Set(l.levels.map((x) => x.volume))).toEqual(new Set([0.3]))
  })

  it('Kauf in Stück: gleiche Menge je Stufe, Euro sinken mit dem Preis', () => {
    const l = buildLadder({ ...buy, unit: 'base', total: 0.5, perLevel: true }, sol)
    expect(l.levels.map((x) => x.volume)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5])
    const costs = l.levels.map((x) => x.cost)
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeLessThan(costs[i - 1])
  })

  it('Kauf in Stück gesamt: Menge wird nach der Kurve verteilt', () => {
    const l = buildLadder({ ...buy, unit: 'base', total: 3, curve: 'linear', ratio: 2 }, sol)
    expect(l.totalVolume).toBeCloseTo(3, 6)
    expect(l.levels[4].volume).toBeGreaterThan(l.levels[0].volume)
  })

  it('Verkauf in Geld: „2.000 € herausnehmen“ ergibt die nötige Stückzahl', () => {
    const l = buildLadder({ ...sell, unit: 'quote', total: 2000 }, sol)
    expect(l.valid).toBe(true)
    expect(l.totalCost).toBeLessThanOrEqual(2000)
    expect(l.totalCost).toBeGreaterThan(1999.9)
    // gleiche Euro je Stufe: bei höherem Preis weniger Stück
    expect(l.levels[4].volume).toBeLessThan(l.levels[0].volume)
  })

  it('Geld pro Stufe beim Kauf: jede Stufe ca. 100 €', () => {
    const l = buildLadder({ ...buy, total: 100, perLevel: true }, sol)
    for (const x of l.levels) {
      expect(x.cost).toBeLessThanOrEqual(100)
      expect(x.cost).toBeGreaterThan(99.99)
    }
  })

  it('Menge wird nie aufgerundet (nicht mehr als eingegeben)', () => {
    const l = buildLadder({ ...sell, total: 1 / 3, perLevel: true }, { ...sol, volumeDecimals: 3 })
    for (const x of l.levels) expect(x.volume).toBe(0.333)
  })

  it('zu kleine Stück-Stufen werden auf den Mindest-Orderwert angehoben', () => {
    const l = buildLadder({ ...sell, total: 0.03, perLevel: true }, sol, { minCost: 10 })
    expect(l.valid).toBe(true)
    for (const x of l.levels) expect(x.cost).toBeGreaterThanOrEqual(10 - 1e-9)
    expect(l.raised!.count).toBeGreaterThan(0)
  })

  it('Fehlermeldung passt zur Einheit', () => {
    expect(buildLadder({ ...sell, unit: 'quote', total: 0, perLevel: true }, sol).errors[0]).toMatch(/Betrag pro Stufe/)
    expect(buildLadder({ ...buy, unit: 'base', total: 0 }, sol).errors[0]).toMatch(/Gesamtmenge/)
  })

  it('pro Stufe mit Preiszonen: jede Stufe gleich, Anteile der Zonen zählen nicht', () => {
    const l = buildLadder({
      ...sell, total: 1, perLevel: true,
      zones: [{ priceStart: 150, priceEnd: 170, steps: 3, share: 90 }, { priceStart: 200, priceEnd: 240, steps: 2, share: 10 }],
    }, sol)
    expect(l.valid).toBe(true)
    expect(l.levels.map((x) => x.volume)).toEqual([1, 1, 1, 1, 1])
    expect(l.levels[0].share).toBeCloseTo(0.2, 9)
  })

  it('Stück-Pläne bestehen die letzte Prüfung vor dem Senden', () => {
    const l = buildLadder({ ...buy, unit: 'base', total: 0.25, perLevel: true }, sol, { minCost: 10 })
    expect(prepareForSend(l.levels, sol, 'buy', 10).error).toBeUndefined()
  })
})

describe('Vergleich mit der anderen Einheit', () => {
  it('feste Euro kaufen für denselben Betrag mehr Stück als feste Stück', () => {
    const units = buildLadder({ ...buy, unit: 'base', total: 1, perLevel: true }, sol)
    const money = otherUnitLadder({ ...buy, unit: 'base', total: 1, perLevel: true }, units, sol)!
    expect(money).not.toBeNull()
    expect(money.totalCost).toBeCloseTo(units.totalCost, 0)
    expect(money.totalVolume).toBeGreaterThan(units.totalVolume)
    expect(money.averagePrice).toBeLessThan(units.averagePrice)
  })

  it('beim Verkauf bringen feste Stück mehr Euro je verkauftem Stück', () => {
    const units = buildLadder({ ...sell, total: 1, perLevel: true }, sol)
    const money = otherUnitLadder({ ...sell, total: 1, perLevel: true }, units, sol)!
    expect(money.totalVolume).toBeGreaterThan(units.totalVolume - 0.01)
    expect(units.averagePrice).toBeGreaterThan(money.averagePrice)
  })

  it('ungültiger Plan: kein Vergleich', () => {
    const bad = buildLadder({ ...sell, total: 0 }, sol)
    expect(otherUnitLadder({ ...sell, total: 0 }, bad, sol)).toBeNull()
  })
})
