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
