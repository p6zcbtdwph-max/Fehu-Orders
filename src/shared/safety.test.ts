import { describe, expect, it } from 'vitest'
import { checkKeyFormat, wrongSide } from './safety'

const secret = 'kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg=='
const key = 'abcdEFGHijklMNOPqrstUVWXyz0123456789abcdEFGHijklMNOPqrst'

describe('checkKeyFormat', () => {
  it('akzeptiert ein gültiges Paar', () => expect(checkKeyFormat(key, secret)).toEqual([]))
  it('erkennt vertauschte Felder', () => expect(checkKeyFormat(secret, key)[0]).toMatch(/vertauscht/))
  it('erkennt zweimal dasselbe', () => expect(checkKeyFormat(secret, secret)[0]).toMatch(/gleich/))
  it('erkennt abgeschnittenen privaten Schlüssel', () => expect(checkKeyFormat(key, secret.slice(0, 60)).join()).toMatch(/unvollständig/))
  it('erkennt Leerzeichen mitten im Schlüssel', () => expect(checkKeyFormat(key, secret.slice(0, 40) + ' ' + secret.slice(40)).join()).toMatch(/Leerzeichen/))
  it('meldet nichts, solange ein Feld leer ist', () => expect(checkKeyFormat('', secret)).toEqual([]))
})

describe('wrongSide', () => {
  it('Kauf über dem Kurs', () => expect(wrongSide('buy', [105, 100, 95], 100)).toEqual([105, 100]))
  it('Verkauf unter dem Kurs', () => expect(wrongSide('sell', [95, 110], 100)).toEqual([95]))
  it('ohne Kurs keine Warnung', () => expect(wrongSide('buy', [105], null)).toEqual([]))
})

import { alarmHit, assetLabel, firstTestInput, priceGuard } from './safety'
import { buildLadder, roundPrice } from './ladder'

describe('priceGuard', () => {
  it('blockiert Kauf über dem frischen Kurs', () => expect(priceGuard('buy', [101, 99], 100)).toMatch(/1 Stufe liegt/))
  it('lässt passende Stufen durch', () => expect(priceGuard('sell', [101, 120], 100)).toBeNull())
})

describe('alarmHit', () => {
  it('Kauf löst aus, wenn der Kurs fällt', () => {
    expect(alarmHit('buy', 70000, 69999)).toBe(true)
    expect(alarmHit('buy', 70000, 71000)).toBe(false)
  })
  it('Verkauf löst aus, wenn der Kurs steigt', () => expect(alarmHit('sell', 180, 181)).toBe(true))
})

describe('assetLabel', () => {
  it('übersetzt Krakens Namen', () => {
    expect(assetLabel('XXBT')).toEqual({ name: 'BTC' })
    expect(assetLabel('ZEUR')).toEqual({ name: 'EUR' })
    expect(assetLabel('XXDG')).toEqual({ name: 'DOGE' })
    expect(assetLabel('SOL')).toEqual({ name: 'SOL' })
    expect(assetLabel('XTZ')).toEqual({ name: 'XTZ' })
    expect(assetLabel('XBT.F')).toEqual({ name: 'BTC', earn: 'Earn (flexibel)' })
    expect(assetLabel('DOT.S')).toEqual({ name: 'DOT', earn: 'Earn (gebunden)' })
  })
})

describe('roundPrice mit Preisschritt', () => {
  it('rundet auf 0.5er Schritte', () => {
    expect(roundPrice(100.7, { priceDecimals: 1, tickSize: 0.5 }, 'down')).toBe(100.5)
    expect(roundPrice(100.7, { priceDecimals: 1, tickSize: 0.5 }, 'up')).toBe(101)
    expect(roundPrice(100.5, { priceDecimals: 1, tickSize: 0.5 }, 'up')).toBe(100.5)
  })
  it('ohne abweichenden Schritt wie bisher', () => expect(roundPrice(1.23456, { priceDecimals: 3, tickSize: 0.001 }, 'down')).toBe(1.234))
})

describe('firstTestInput', () => {
  it('ergibt einen gültigen Mini-Plan für BTC', () => {
    const input = firstTestInput(80000, { orderMin: 0.00005, costMin: 0.5 })
    const l = buildLadder(input, { priceDecimals: 1, volumeDecimals: 8, orderMin: 0.00005, costMin: 0.5 })
    expect(l.valid).toBe(true)
    expect(l.levels.every((x) => x.price < 80000 * 0.81)).toBe(true)
    expect(input.total).toBeLessThan(20)
  })
})
