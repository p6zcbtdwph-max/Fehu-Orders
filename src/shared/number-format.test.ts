import { describe, expect, it } from 'vitest'
import { parseNumber, parseWeightList, toInputText } from './number-format'
import { buildLadder } from './ladder'
import { localDate } from './dates'

describe('Zahlenformat', () => {
  it('Deutsch: Tausenderpunkt und Dezimalkomma', () => {
    expect(parseNumber('60.000', 'de')).toBe(60000)
    expect(parseNumber('70.000,50', 'de')).toBe(70000.5)
    expect(parseNumber('1.000', 'de')).toBe(1000)
    expect(parseNumber('0,0005', 'de')).toBe(0.0005)
    expect(parseNumber('78428,4', 'de')).toBe(78428.4)
    expect(parseNumber('60 000', 'de')).toBe(60000)
  })
  it('Deutsch: ein Punkt an falscher Stelle ist ungültig statt still falsch', () => {
    expect(parseNumber('78428.4', 'de')).toBeNaN()
    expect(parseNumber('1.00', 'de')).toBeNaN()
    expect(parseNumber('abc', 'de')).toBeNaN()
    expect(parseNumber('', 'de')).toBeNaN()
  })
  it('Amerikanisch: Tausenderkomma und Dezimalpunkt', () => {
    expect(parseNumber('60,000', 'en')).toBe(60000)
    expect(parseNumber('70,000.50', 'en')).toBe(70000.5)
    expect(parseNumber('0.0005', 'en')).toBe(0.0005)
    expect(parseNumber('70.000,50', 'en')).toBeNaN()
  })
  it('Feldtext im gewählten Format', () => {
    expect(toInputText(78428.4, 'de')).toBe('78428,4')
    expect(toInputText(78428.4, 'en')).toBe('78428.4')
    expect(toInputText(5e-7, 'de')).toBe('0,0000005')
  })
  it('Eigene Prozente mit Dezimalkomma bleiben ganz', () => {
    expect(parseWeightList('12,5; 12,5; 25; 50', 'de')).toEqual([12.5, 12.5, 25, 50])
    expect(parseWeightList('12,5 12,5 25 50', 'de')).toEqual([12.5, 12.5, 25, 50])
    expect(parseWeightList('10, 20, 30', 'de')).toEqual([10, 20, 30])
    expect(parseWeightList('12.5, 12.5, 25, 50', 'en')).toEqual([12.5, 12.5, 25, 50])
  })
  it('ungültiger Prozentwert macht den Plan ungültig', () => {
    const w = parseWeightList('10; x; 30', 'de')
    expect(w).toHaveLength(3)
    const l = buildLadder({ side: 'buy', priceStart: 100, priceEnd: 90, steps: 3, total: 300, spacing: 'linear', curve: 'custom', ratio: 1, customWeights: w }, { priceDecimals: 2, volumeDecimals: 8, orderMin: 0, costMin: 0 })
    expect(l.valid).toBe(false)
  })
  it('Dateiname nach der Uhr des Macs, nicht UTC', () => {
    expect(localDate(new Date(2027, 0, 1, 0, 30))).toBe('2027-01-01')
  })
})
