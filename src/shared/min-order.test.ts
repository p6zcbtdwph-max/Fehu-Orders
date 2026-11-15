// Mindest-Orderwert: keine Stufe darunter, zu kleine Stufen werden angehoben, Mindestwert der Börse gilt, wenn er höher ist
import { describe, it, expect } from 'vitest'
import { buildLadder, effectiveMinCost, exchangeMinCost, prepareForSend, type LadderInput, type PairRules } from './ladder'
import { firstTestInput } from './safety'
import { setLang } from './i18n'

setLang('de')
const btc: PairRules = { priceDecimals: 1, volumeDecimals: 8, orderMin: 0.00005, costMin: 0.5 }
const base: LadderInput = { side: 'buy', priceStart: 80000, priceEnd: 60000, steps: 10, total: 100, spacing: 'linear', curve: 'exp', ratio: 5 }

describe('Mindest-Orderwert', () => {
  it('ohne Option bleibt alles wie bisher (nichts angehoben)', () => {
    const l = buildLadder(base, btc)
    expect(l.raised).toBeUndefined()
    expect(l.levels.some((x) => x.raised)).toBe(false)
  })

  it('jede Stufe liegt mindestens beim Mindest-Orderwert', () => {
    const l = buildLadder(base, btc, { minCost: 10 })
    expect(l.valid).toBe(true)
    for (const x of l.levels) expect(x.cost).toBeGreaterThanOrEqual(10 - 1e-9)
    expect(l.raised!.count).toBeGreaterThan(0)
    expect(l.levels.filter((x) => x.raised).length).toBe(l.raised!.count)
    // durch das Anheben wird der Plan größer als die eingegebenen 100 €
    expect(l.totalCost).toBeGreaterThan(100)
  })

  it('reicht der Betrag ohnehin, wird nichts angehoben', () => {
    const l = buildLadder({ ...base, curve: 'flat', total: 1000 }, btc, { minCost: 10 })
    expect(l.raised!.count).toBe(0)
    expect(l.totalCost).toBeLessThanOrEqual(1000)
  })

  it('verlangt die Börse mehr (25 €), gilt deren Wert', () => {
    const strict = { ...btc, costMin: 25 }
    const l = buildLadder({ ...base, curve: 'flat', total: 100, steps: 10 }, strict, { minCost: 10 })
    expect(l.valid).toBe(true)
    for (const x of l.levels) expect(x.cost).toBeGreaterThanOrEqual(25 - 1e-9)
    expect(l.raised!.count).toBe(10)
    expect(effectiveMinCost(10, 80000, strict)).toMatchObject({ effective: 25, exchange: 25, exchangeHigher: true })
  })

  it('Mindestmenge der Börse (z. B. 0.00005 BTC) zählt als Euro-Wert beim Preis', () => {
    expect(exchangeMinCost(80000, btc)).toBeCloseTo(4)
    expect(effectiveMinCost(10, 80000, btc)).toMatchObject({ effective: 10, exchangeHigher: false })
    const big = { ...btc, orderMin: 0.001 } // 0.001 BTC × 80.000 € = 80 €
    const l = buildLadder({ ...base, curve: 'flat', total: 100, steps: 3 }, big, { minCost: 10 })
    for (const x of l.levels) expect(x.volume).toBeGreaterThanOrEqual(0.001)
    expect(l.valid).toBe(true)
  })

  it('Verkauf: Menge wird angehoben, Gegenwert je Stufe mindestens 10 €', () => {
    const l = buildLadder({ side: 'sell', priceStart: 85000, priceEnd: 100000, steps: 8, total: 0.0006, spacing: 'linear', curve: 'flat', ratio: 1 }, btc, { minCost: 10 })
    expect(l.valid).toBe(true)
    for (const x of l.levels) expect(x.price * x.volume).toBeGreaterThanOrEqual(10 - 1e-9)
    expect(l.totalVolume).toBeGreaterThan(0.0006)
  })

  it('auch bei vielen Zufallsplänen fällt keine Stufe unter den Mindestwert', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let n = 0; n < 400; n++) {
      const rules: PairRules = { priceDecimals: Math.floor(rnd() * 5), volumeDecimals: 2 + Math.floor(rnd() * 7), orderMin: rnd() < 0.5 ? 0 : rnd() * 0.01, costMin: rnd() * 30 }
      const p = 1 + rnd() * 90000
      const min = 1 + rnd() * 40
      const l = buildLadder({ side: 'buy', priceStart: p, priceEnd: p * (0.5 + rnd() * 0.4), steps: 1 + Math.floor(rnd() * 30), total: 5 + rnd() * 500, spacing: rnd() < 0.5 ? 'linear' : 'geometric', curve: 'exp', ratio: 1 + rnd() * 5 }, rules, { minCost: min })
      for (const x of l.levels.filter((y) => !y.problem)) {
        expect(x.cost).toBeGreaterThanOrEqual(Math.max(min, rules.costMin) * (1 - 1e-9))
        expect(x.volume).toBeGreaterThanOrEqual(rules.orderMin)
        // Menge passt weiter zu den erlaubten Nachkommastellen
        expect(Math.abs(x.volume * 10 ** rules.volumeDecimals - Math.round(x.volume * 10 ** rules.volumeDecimals))).toBeLessThan(1e-6)
      }
    }
  })

  it('letzte Prüfung vor dem Senden: Stufe unter dem eigenen Mindestwert → nichts wird gesendet', () => {
    const levels = [{ index: 0, price: 70000, volume: 0.0002 }, { index: 1, price: 69000, volume: 0.0001 }] // 14 € und 6,90 €
    const r = prepareForSend(levels, btc, 'buy', 10)
    expect(r.error).toMatch(/Mindest-Orderwert von 10 €.*Stufe 2.*nichts gesendet/)
    expect(prepareForSend(levels, btc, 'buy', 5).error).toBeUndefined()
    expect(prepareForSend(levels, btc, 'buy').error).toBeUndefined()
  })

  it('erster Test berücksichtigt Mindest-Orderwert und 50-€-Grenze', () => {
    const t = firstTestInput(80000, btc, 10, 50)
    expect(t.steps).toBe(2)
    const l = buildLadder(t, btc, { minCost: 10 })
    expect(l.valid).toBe(true)
    expect(l.raised!.count).toBe(0)
    expect(l.totalCost).toBeLessThanOrEqual(50)
    // 30 € je Stufe: zwei passen nicht unter 50 €, also eine
    const one = firstTestInput(80000, btc, 30, 50)
    expect(one.steps).toBe(1)
    expect(buildLadder(one, btc, { minCost: 30 }).totalCost).toBeLessThanOrEqual(50)
  })
})
