// Breite Tests („Eigenschafts-Tests“) für den Weg Planer → Runden → Text für die Börse.
// Statt einzelner Beispiele werden viele tausend zufällige, aber reproduzierbare Preise, Mengen und
// Planer-Einstellungen durchprobiert. Anlass: Kraken lehnte 7 von 10 Orders ab, weil aus 76543.2
// der Text "76543.199999999997" wurde. Jede Prüfung hier hätte das gefunden.
import { describe, it, expect } from 'vitest'
import { buildLadder, conformLevels, levelProblem, prepareForSend, priceStep, priceText, roundPrice, volumeText, CENTER_MAX, CENTER_MIN, type LadderInput, type PairRules, type PriceSpacing, type SizeCurve } from './ladder'
import { setLang } from './i18n'

setLang('de')

/** Zufall mit festem Startwert: jeder Lauf prüft dieselben Fälle, ein Fehler lässt sich nachstellen */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Regeln, wie sie die drei Börsen wirklich liefern (Kraken pair_decimals/tick_size, Bitvavo tickSize, Coinbase price_increment) */
const RULES: Record<string, PairRules> = {
  'Kraken BTC/EUR': { priceDecimals: 1, volumeDecimals: 8, orderMin: 0.00005, costMin: 0.5, tickSize: 0.1 },
  'Kraken ETH/EUR': { priceDecimals: 2, volumeDecimals: 8, orderMin: 0.002, costMin: 0.5, tickSize: 0.01 },
  'Kraken SOL/EUR': { priceDecimals: 2, volumeDecimals: 8, orderMin: 0.02, costMin: 0.5 },
  'Kraken XRP/EUR': { priceDecimals: 5, volumeDecimals: 8, orderMin: 2, costMin: 0.5, tickSize: 0.00001 },
  'Kraken SHIB/EUR': { priceDecimals: 8, volumeDecimals: 0, orderMin: 100000, costMin: 0.5, tickSize: 0.00000001 },
  'Kraken halber Schritt': { priceDecimals: 1, volumeDecimals: 8, orderMin: 0.0001, costMin: 0.5, tickSize: 0.5 },
  'Kraken Viertel': { priceDecimals: 2, volumeDecimals: 4, orderMin: 0.01, costMin: 0.5, tickSize: 0.25 },
  'Bitvavo BTC-EUR': { priceDecimals: 0, volumeDecimals: 8, orderMin: 0.00001, costMin: 5, tickSize: 1 },
  'Bitvavo ETH-EUR': { priceDecimals: 2, volumeDecimals: 4, orderMin: 0.0001, costMin: 5, tickSize: 0.01 },
  'Bitvavo Schritt 5': { priceDecimals: 0, volumeDecimals: 6, orderMin: 0.0001, costMin: 5, tickSize: 5 },
  'Bitvavo alt (5 Ziffern)': { priceDecimals: 8, volumeDecimals: 8, orderMin: 0.0001, costMin: 5, priceSignificant: 5 },
  'Coinbase BTC-EUR': { priceDecimals: 2, volumeDecimals: 8, orderMin: 0.00000001, costMin: 1, tickSize: 0.01 },
  'Coinbase DOGE-EUR': { priceDecimals: 5, volumeDecimals: 1, orderMin: 1, costMin: 1, tickSize: 0.00001 },
  'Coinbase Schritt 0.0005': { priceDecimals: 4, volumeDecimals: 2, orderMin: 0.1, costMin: 1, tickSize: 0.0005 },
}

/** Dezimaltext exakt als ganze Zahl in 10^-20-Einheiten (ohne Gleitkomma) */
function units(text: string): bigint {
  const [i, f = ''] = text.split('.')
  return BigInt(i + f.padEnd(20, '0'))
}
const unitsOf = (n: number) => units(n.toFixed(15))

/** Prüft einen Preistext so streng, wie es eine Börse tut */
function expectValidPriceText(text: string, rules: PairRules, near: number): void {
  // nur Ziffern und höchstens ein Punkt, keine wissenschaftliche Schreibweise, kein Komma
  expect(text, `Format von ${text}`).toMatch(/^\d+(\.\d+)?$/)
  const decimals = text.includes('.') ? text.split('.')[1].length : 0
  expect(decimals, `Nachkommastellen von ${text}`).toBeLessThanOrEqual(rules.priceDecimals)
  if (rules.tickSize) {
    const tick = unitsOf(rules.tickSize)
    expect(units(text) % tick, `${text} liegt nicht auf dem Preisschritt ${rules.tickSize}`).toBe(0n)
  }
  if (rules.priceSignificant && !rules.tickSize) {
    const digits = text.replace('.', '').replace(/^0+/, '').replace(/0+$/, '')
    expect(digits.length, `gültige Ziffern von ${text}`).toBeLessThanOrEqual(rules.priceSignificant)
  }
  // und der Text weicht höchstens einen Preisschritt vom gemeinten Preis ab
  expect(Math.abs(Number(text) - near)).toBeLessThanOrEqual(priceStep(near, rules) * 1.000001)
}

/** Zufälliger Preis über viele Größenordnungen (0.00001 bis 200 000), oft mit „krummen“ Nachkommastellen */
function randomPrice(r: () => number): number {
  const exp = -5 + r() * 10.3
  const p = Math.pow(10, exp)
  // jeder dritte Preis ist schon „rund“ (wie 76543.2), dort entstehen die Gleitkomma-Reste
  return r() < 0.33 ? Number(p.toFixed(Math.max(0, Math.min(8, Math.floor(r() * 9))))) || p : p
}

describe('Preistext für die Börse (viele Preise)', () => {
  it('der Fehler vom 14.11.: jeder Preis mit 1 Nachkommastelle bis 100 000 € bleibt genau so', () => {
    const rules = RULES['Kraken BTC/EUR']
    for (let k = 1; k <= 1_000_000; k++) {
      const expected = k % 10 === 0 ? String(k / 10) : `${Math.floor(k / 10)}.${k % 10}`
      const text = priceText(k / 10, rules)
      if (text !== expected) expect(text).toBe(expected)
    }
  })

  it('auch mit 2 Nachkommastellen (Coinbase, Bitvavo ETH) bis 10 000 €', () => {
    const rules = RULES['Coinbase BTC-EUR']
    for (let k = 1; k <= 1_000_000; k++) {
      const c = k % 100
      const expected = c === 0 ? String(k / 100) : `${Math.floor(k / 100)}.${String(c).padStart(2, '0').replace(/0$/, '')}`
      const text = priceText(k / 100, rules)
      if (text !== expected) expect(text).toBe(expected)
    }
  })

  for (const [name, rules] of Object.entries(RULES)) {
    it(`${name}: 4000 zufällige Preise ergeben gültige Texte`, () => {
      const r = rng(name.length * 7919)
      for (let n = 0; n < 4000; n++) {
        const p = randomPrice(r)
        const down = roundPrice(p, rules, 'down')
        const up = roundPrice(p, rules, 'up')
        // Kauf rundet ab, Verkauf auf: nie schlechter als berechnet, höchstens einen Schritt entfernt
        expect(down).toBeLessThanOrEqual(p * (1 + 1e-12))
        expect(up).toBeGreaterThanOrEqual(p * (1 - 1e-12))
        if (down > 0) {
          expectValidPriceText(priceText(down, rules), rules, down)
          // schon gerundete Preise bleiben exakt gleich (wichtig für Entwürfe und „Rest senden“)
          expect(Number(priceText(down, rules))).toBe(down)
          expect(roundPrice(down, rules, 'down')).toBe(down)
          expect(roundPrice(down, rules, 'up')).toBe(down)
        }
        expectValidPriceText(priceText(up, rules), rules, up)
        expect(Number(priceText(up, rules))).toBe(up)
        expect(roundPrice(up, rules, 'up')).toBe(up)
      }
    })
  }
})

describe('Mengentext für die Börse (viele Mengen)', () => {
  for (const [name, rules] of Object.entries(RULES)) {
    it(`${name}: 4000 zufällige Mengen, nie mehr als berechnet`, () => {
      const r = rng(name.length * 104729)
      for (let n = 0; n < 4000; n++) {
        const v = Math.pow(10, -6 + r() * 12)
        const text = volumeText(v, rules)
        expect(text).toMatch(/^\d+(\.\d+)?$/)
        const decimals = text.includes('.') ? text.split('.')[1].length : 0
        expect(decimals).toBeLessThanOrEqual(rules.volumeDecimals)
        // abgerundet: nie mehr als gewollt (Budget), höchstens eine letzte Stelle weniger
        expect(Number(text)).toBeLessThanOrEqual(v * (1 + 1e-12))
        expect(v - Number(text)).toBeLessThan(Math.pow(10, -rules.volumeDecimals) * 1.000001 + v * 1e-12)
        // zweimal runden ändert nichts
        expect(volumeText(Number(text), rules)).toBe(text)
      }
    })
  }
})

describe('Gültige Ziffern (Bitvavo ohne tickSize)', () => {
  const rules = RULES['Bitvavo alt (5 Ziffern)']
  it('rundet auf 5 gültige Ziffern', () => {
    expect(priceText(76543.21, rules)).toBe('76543')
    expect(roundPrice(76543.21, rules, 'up')).toBe(76544)
    expect(roundPrice(123456.7, rules, 'down')).toBe(123450)
    expect(priceText(0.0123456, rules)).toBe('0.012346')
    expect(roundPrice(99999.5, rules, 'up')).toBe(100000)
    expect(priceText(1.23456789, rules)).toBe('1.2346')
  })
})

describe('Planer: tausende zufällige Pläne sind sendefertig', () => {
  const curves: SizeCurve[] = ['flat', 'linear', 'log', 'exp', 'fib']
  const spacings: PriceSpacing[] = ['linear', 'geometric']
  // Ränder der Schwerpunkt-Regler und knapp daneben
  const centers = [undefined, 0, CENTER_MIN, 0.0501, 0.2, 0.5, 0.8, 0.9499, CENTER_MAX, 1]

  for (const [name, rules] of Object.entries(RULES)) {
    it(`${name}: 600 Pläne mit Reglern am Rand`, () => {
      const r = rng(name.length * 31337)
      const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
      for (let n = 0; n < 600; n++) {
        const side = r() < 0.5 ? 'buy' : 'sell'
        const start = randomPrice(r) * 10
        const width = 0.001 + r() * 0.6
        const end = side === 'buy' ? start * (1 - width) : start * (1 + width)
        const steps = 1 + Math.floor(Math.pow(r(), 2) * 120)
        const total = side === 'buy' ? 5 + r() * 20000 : Math.pow(10, -3 + r() * 9)
        const input: LadderInput = {
          side, priceStart: start, priceEnd: end, steps, total, spacing: pick(spacings), curve: pick(curves), ratio: 0.2 + r() * 6,
          orderCenter: pick(centers), volumeCenter: pick(centers),
        }
        const ladder = buildLadder(input, rules)
        // nie NaN oder Unendlich, egal ob der Plan gültig ist
        for (const l of ladder.levels) {
          expect(Number.isFinite(l.price) && Number.isFinite(l.volume) && Number.isFinite(l.cost), JSON.stringify(input)).toBe(true)
        }
        if (!ladder.valid) continue
        const ctx = JSON.stringify({ name, input })
        const prices = ladder.levels.map((l) => l.price)
        // streng sortiert: Kauf immer tiefer, Verkauf immer höher, keine zwei Stufen auf einem Preis
        for (let i = 1; i < prices.length; i++) expect(side === 'buy' ? prices[i] < prices[i - 1] : prices[i] > prices[i - 1], ctx).toBe(true)
        for (const l of ladder.levels) {
          expectValidPriceText(priceText(l.price, rules), rules, l.price)
          expect(Number(priceText(l.price, rules)), ctx).toBe(l.price)
          expect(Number(volumeText(l.volume, rules)), ctx).toBe(l.volume)
          expect(levelProblem(l.price, l.volume, rules), ctx).toBeUndefined()
        }
        // Budget bzw. Bestand wird nie überschritten
        if (side === 'buy') expect(ladder.totalCost, ctx).toBeLessThanOrEqual(total * (1 + 1e-9))
        else expect(ladder.totalVolume, ctx).toBeLessThanOrEqual(total * (1 + 1e-9))
        // die letzte Prüfung vor dem Senden ändert nichts und findet nichts
        const prep = prepareForSend(ladder.levels, rules, side)
        expect(prep.error, ctx).toBeUndefined()
        expect(conformLevels(ladder.levels, rules, side).changed, ctx).toBe(0)
      }
    })
  }
})

describe('Letzte Prüfung vor dem Senden', () => {
  const rules = RULES['Kraken BTC/EUR']
  const lv = (price: number, volume: number, index = 0) => ({ index, price, volume })

  it('lehnt ungültige Zahlen ab, statt sie zu senden', () => {
    expect(prepareForSend([lv(NaN, 0.001)], rules, 'buy').error).toMatch(/ungültigen Preis/)
    expect(prepareForSend([lv(50000, -1)], rules, 'buy').error).toMatch(/ungültigen Preis/)
    expect(prepareForSend([lv(Infinity, 1)], rules, 'buy').error).toMatch(/ungültigen Preis/)
    expect(prepareForSend([lv(50000, 0)], rules, 'buy').error).toMatch(/ungültigen Preis/)
  })

  it('findet Stufen, die nach dem Runden unter die Mindestmenge fallen (z. B. Regeln geändert)', () => {
    const strict = { ...rules, orderMin: 0.0002 }
    const r = prepareForSend([lv(50000, 0.0003, 0), lv(49000, 0.00019999, 1)], strict, 'buy')
    expect(r.error).toMatch(/Stufe 2: Menge unter Mindestmenge/)
  })

  it('findet Stufen unter dem Mindestbetrag', () => {
    const r = prepareForSend([lv(50000, 0.001), lv(100, 0.001, 1)], { ...rules, costMin: 5 }, 'buy')
    expect(r.error).toMatch(/Mindestbetrag/)
  })

  it('genau am Mindestbetrag ist erlaubt (0.1 × 50 ist 5, nicht 4.9999)', () => {
    expect(levelProblem(50, 0.1, { orderMin: 0, costMin: 5 })).toBeUndefined()
    expect(levelProblem(0.7, 7.142858, { orderMin: 0, costMin: 5 })).toBeUndefined()
  })

  it('findet Preise, die nach dem Runden zusammenfallen', () => {
    const r = prepareForSend([lv(50000.04, 0.001, 0), lv(50000.01, 0.001, 1)], rules, 'buy')
    expect(r.error).toMatch(/demselben Preis/)
  })

  it('rundet Preise aus alten Entwürfen auf die heutigen Regeln, ohne Gleitkomma-Reste', () => {
    const r = prepareForSend([lv(76543.199999999997, 0.001, 0), lv(76000.123456, 0.0012345678912, 1)], rules, 'buy')
    expect(r.error).toBeUndefined()
    expect(r.levels.map((l) => priceText(l.price, rules))).toEqual(['76543.2', '76000.1'])
    expect(r.levels.map((l) => volumeText(l.volume, rules))).toEqual(['0.001', '0.00123456'])
  })
})
