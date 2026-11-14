import { describe, expect, it } from 'vitest'
import { checkKeyFormat, normalizeCoinbase } from './safety'
import { EXCHANGE_IDS, exchangeMeta, sendLimit } from './exchanges'

describe('Schlüssel-Format je Börse', () => {
  it('Bitvavo: 64 und 128 Zeichen, erkennt vertauschte Felder', () => {
    expect(checkKeyFormat('a'.repeat(64), 'b'.repeat(128), 'bitvavo')).toEqual([])
    expect(checkKeyFormat('b'.repeat(128), 'a'.repeat(64), 'bitvavo').join()).toMatch(/vertauscht/)
    expect(checkKeyFormat('a'.repeat(60), 'b'.repeat(128), 'bitvavo').join()).toMatch(/64 Zeichen/)
  })
  it('Coinbase: Name und PEM, Ed25519 wird erkannt', () => {
    const pem = '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\n-----END EC PRIVATE KEY-----'
    expect(checkKeyFormat('organizations/o/apiKeys/k', pem, 'coinbase')).toEqual([])
    expect(checkKeyFormat('organizations/o/apiKeys/k', 'A'.repeat(86) + '==', 'coinbase').join()).toMatch(/Ed25519/)
    expect(checkKeyFormat(pem, 'organizations/o/apiKeys/k', 'coinbase').join()).toMatch(/vertauscht/)
  })
  it('Coinbase: die heruntergeladene Datei darf ins Feld, wörtliche \\n werden Zeilenumbrüche', () => {
    const file = JSON.stringify({ name: 'organizations/o/apiKeys/k', privateKey: '-----BEGIN EC PRIVATE KEY-----\\nMHcC\\n-----END EC PRIVATE KEY-----\\n' })
    const r = normalizeCoinbase('', file)
    expect(r.key).toBe('organizations/o/apiKeys/k')
    expect(r.secret).toBe('-----BEGIN EC PRIVATE KEY-----\nMHcC\n-----END EC PRIVATE KEY-----')
    expect(checkKeyFormat('', file, 'coinbase')).toEqual([])
  })
  it('Kraken bleibt wie bisher', () => {
    expect(checkKeyFormat('k'.repeat(56), Buffer.alloc(64, 1).toString('base64'))).toEqual([])
  })
})

describe('Börsen-Liste', () => {
  it('jede Börse sagt, dass das Auszahlungsrecht aus bleiben muss', () => {
    for (const id of EXCHANGE_IDS) {
      const m = exchangeMeta(id)
      expect(m.permissions.some((p) => p.danger && !p.on && p.exchange === m.withdrawLabel)).toBe(true)
      expect(m.permissionsStep).toBeLessThan(m.steps.length)
    }
  })
  it('erster Test auf einer neuen Börse: höchstens 50 €', () => {
    expect(sendLimit(500, true)).toBe(50)
    expect(sendLimit(20, true)).toBe(20)
    expect(sendLimit(500, false)).toBe(500)
  })
})
