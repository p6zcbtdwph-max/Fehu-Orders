import { describe, expect, it } from 'vitest'
import { buildLadder, fibonacci, parseWeights, priceAt, weight, type LadderInput, type PairRules } from './ladder'

const BTC_EUR: PairRules = { priceDecimals: 1, volumeDecimals: 8, orderMin: 0.00005, costMin: 0.5 }
const base: LadderInput = { side: 'buy', priceStart: 60000, priceEnd: 50000, steps: 5, total: 1000, spacing: 'linear', curve: 'flat', ratio: 3 }

describe('Gewichte', () => {
  it('flat ist immer 1', () => expect([0, 0.5, 1].map((t) => weight('flat', t, 3))).toEqual([1, 1, 1]))
  it('linear, exp und log laufen von 1 bis ratio', () => {
    for (const c of ['linear', 'exp', 'log'] as const) {
      expect(weight(c, 0, 3)).toBeCloseTo(1)
      expect(weight(c, 1, 3)).toBeCloseTo(3)
    }
  })
  it('log liegt in der Mitte über linear, exp darunter', () => {
    expect(weight('log', 0.5, 3)).toBeGreaterThan(weight('linear', 0.5, 3))
    expect(weight('exp', 0.5, 3)).toBeLessThan(weight('linear', 0.5, 3))
  })
})

describe('Preise', () => {
  it('linear hat gleiche Euro-Abstände', () => expect(priceAt('linear', 100, 50, 0.5)).toBe(75))
  it('geometrisch hat gleiche Prozent-Abstände', () => expect(priceAt('geometric', 100, 25, 0.5)).toBeCloseTo(50))
})

describe('buildLadder', () => {
  it('verteilt gleichmäßig und überschreitet das Budget nie', () => {
    const l = buildLadder(base, BTC_EUR)
    expect(l.valid).toBe(true)
    expect(l.levels.map((x) => x.price)).toEqual([60000, 57500, 55000, 52500, 50000])
    expect(l.totalCost).toBeLessThanOrEqual(1000)
    expect(l.totalCost).toBeGreaterThan(999.9)
    l.levels.forEach((x) => expect(x.cost).toBeCloseTo(200, 0))
  })
  it('steigende Kurve kauft unten mehr', () => {
    const l = buildLadder({ ...base, curve: 'linear', ratio: 3 }, BTC_EUR)
    expect(l.levels[4].cost / l.levels[0].cost).toBeCloseTo(3, 1)
  })
  it('Verkauf verteilt die Menge und rundet Preise auf', () => {
    const l = buildLadder({ ...base, side: 'sell', priceStart: 70000.04, priceEnd: 80000, total: 0.1 }, BTC_EUR)
    expect(l.valid).toBe(true)
    expect(l.levels[0].price).toBe(70000.1)
    expect(l.totalVolume).toBeLessThanOrEqual(0.1)
  })
  it('markiert zu kleine Stufen', () => {
    const l = buildLadder({ ...base, total: 1, steps: 5 }, { ...BTC_EUR, costMin: 5 })
    expect(l.valid).toBe(false)
    expect(l.levels.every((x) => x.problem)).toBe(true)
  })
  it('lehnt falsche Richtung ab', () => {
    const l = buildLadder({ ...base, priceEnd: 70000 }, BTC_EUR)
    expect(l.valid).toBe(false)
    expect(l.errors[0]).toMatch(/Kauf/)
  })
  it('erkennt doppelte Preise nach dem Runden', () => {
    const l = buildLadder({ ...base, priceStart: 1.0, priceEnd: 0.99, steps: 10, total: 100 }, { ...BTC_EUR, priceDecimals: 2 })
    expect(l.valid).toBe(false)
  })
})

describe('Fibonacci und eigene Verteilung', () => {
  it('Fibonacci-Folge', () => expect([0, 1, 2, 3, 4, 5].map(fibonacci)).toEqual([1, 1, 2, 3, 5, 8]))
  it('Fibonacci verteilt 1:1:2:3:5', () => {
    const l = buildLadder({ ...base, curve: 'fib' }, BTC_EUR)
    expect(l.levels.map((x) => Math.round(x.share * 12))).toEqual([1, 1, 2, 3, 5])
  })
  it('eigene Prozente werden normiert', () => {
    const l = buildLadder({ ...base, curve: 'custom', customWeights: [10, 10, 20, 30, 30] }, BTC_EUR)
    expect(l.valid).toBe(true)
    expect(l.levels[4].share).toBeCloseTo(0.3)
  })
  it('falsche Anzahl Prozente wird gemeldet', () => {
    const l = buildLadder({ ...base, curve: 'custom', customWeights: [50, 50] }, BTC_EUR)
    expect(l.valid).toBe(false)
    expect(l.errors[0]).toMatch(/genau 5/)
  })
  it('liest Prozente aus Text', () => expect(parseWeights('10, 20;30 40%  x')).toEqual([10, 20, 30, 40]))
})

describe('Schwerpunkt-Regler', () => {
  const ten: LadderInput = { ...base, steps: 10 }
  it('ohne Regler gilt die Formel: gleich und linear liegt genau in der Mitte', () => {
    const c = buildLadder(ten, BTC_EUR).centers!
    expect(c.orderDefault).toBeCloseTo(0.5)
    expect(c.order).toBeCloseTo(0.5)
    expect(c.volume).toBeCloseTo(0.5)
  })
  it('steigende Kurve hat den Volumen-Schwerpunkt hinter der Mitte', () => {
    const c = buildLadder({ ...ten, curve: 'linear', ratio: 3 }, BTC_EUR).centers!
    expect(c.volumeDefault).toBeGreaterThan(0.55)
    expect(c.orderDefault).toBeCloseTo(0.5)
  })
  it('gleiche %-Abstände legen die Stufen beim Kauf dichter nach unten', () => {
    const c = buildLadder({ ...ten, priceEnd: 30000, spacing: 'geometric' }, BTC_EUR).centers!
    expect(c.orderDefault).toBeGreaterThan(0.5)
  })
  it('Orderanzahl-Regler verschiebt die Stufen, erste und letzte bleiben', () => {
    const l = buildLadder({ ...ten, orderCenter: 0.65 }, BTC_EUR)
    expect(l.valid).toBe(true)
    expect(l.centers!.order).toBeCloseTo(0.65, 3)
    expect(l.levels[0].price).toBe(60000)
    expect(l.levels[9].price).toBe(50000)
    // dichter am Ende: der Abstand der letzten beiden Stufen ist kleiner als der ersten beiden
    expect(l.levels[8].price - l.levels[9].price).toBeLessThan(l.levels[0].price - l.levels[1].price)
  })
  it('Volumen-Regler trifft den Wunschwert und hält das Budget', () => {
    for (const curve of ['flat', 'linear', 'log', 'exp', 'fib'] as const) {
      const l = buildLadder({ ...ten, curve, volumeCenter: 0.65 }, BTC_EUR)
      expect(l.centers!.volume).toBeCloseTo(0.65, 3)
      expect(l.totalCost).toBeLessThanOrEqual(1000)
      expect(l.totalCost).toBeGreaterThan(999)
    }
  })
  it('Regler auf dem Formelwert ändert nichts', () => {
    const a = buildLadder({ ...ten, curve: 'linear' }, BTC_EUR)
    const b = buildLadder({ ...ten, curve: 'linear', orderCenter: a.centers!.orderDefault, volumeCenter: a.centers!.volumeDefault }, BTC_EUR)
    b.levels.forEach((x, i) => {
      expect(x.price).toBe(a.levels[i].price)
      expect(x.share).toBeCloseTo(a.levels[i].share, 6)
    })
  })
  it('beide Regler zusammen', () => {
    const l = buildLadder({ ...ten, orderCenter: 0.3, volumeCenter: 0.7 }, BTC_EUR)
    expect(l.centers!.order).toBeCloseTo(0.3, 3)
    expect(l.centers!.volume).toBeCloseTo(0.7, 3)
  })
  it('Verkauf und wenige Stufen', () => {
    const s = buildLadder({ ...base, side: 'sell', priceStart: 70000, priceEnd: 80000, total: 0.1, volumeCenter: 0.2 }, BTC_EUR)
    expect(s.centers!.volume).toBeCloseTo(0.2, 3)
    const two = buildLadder({ ...base, steps: 2, orderCenter: 0.8 }, BTC_EUR)
    expect(two.levels.map((x) => x.price)).toEqual([60000, 50000])
  })
  it('Werte außerhalb 0–100 % sind ein Fehler', () => {
    expect(buildLadder({ ...ten, volumeCenter: 1.5 }, BTC_EUR).valid).toBe(false)
  })
})
