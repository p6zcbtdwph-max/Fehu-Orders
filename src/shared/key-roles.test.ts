import { describe, it, expect } from 'vitest'
import { checksPass, readChecks } from './key-roles'
import { readPermissionRows } from './exchanges'
import { setLang } from './i18n'
import type { KeyCheck } from './ipc'

setLang('de')
const c = (id: string, ok: boolean): KeyCheck => ({ id, label: id, exchangeLabel: id, required: true, ok })

describe('Rechte-Prüfung für den Nur-Lese-Schlüssel', () => {
  it('Kraken: ansehen ja, handeln nein, stornieren nur empfohlen', () => {
    const r = readChecks([c('funds', true), c('open', true), c('closed', true), c('create', false), c('cancel', false), c('withdraw', true)], 'kraken')
    expect(r.map((x) => [x.id, x.ok, x.required])).toEqual([
      ['funds', true, true], ['open', true, true], ['closed', true, true], ['no-trade', true, true], ['cancel', false, false], ['withdraw', true, true],
    ])
    expect(checksPass(r)).toBe(true)
  })
  it('ein Schlüssel mit Handelsrecht fällt durch', () => {
    const r = readChecks([c('view', true), c('trade', true), c('withdraw', true)], 'bitvavo')
    expect(r.find((x) => x.id === 'no-trade')?.ok).toBe(false)
    expect(checksPass(r)).toBe(false)
  })
  it('Auszahlungsrecht fällt immer durch', () => {
    expect(checksPass(readChecks([c('view', true), c('trade', false), c('withdraw', false)], 'coinbase'))).toBe(false)
  })
  it('ohne Ansehen-Recht fällt er durch', () => {
    expect(checksPass(readChecks([c('view', false), c('trade', false), c('withdraw', true)], 'coinbase'))).toBe(false)
  })
  it('Tabelle für den Nur-Lese-Schlüssel: Handeln und Auszahlen sind aus', () => {
    for (const ex of ['kraken', 'bitvavo', 'coinbase'] as const) {
      const rows = readPermissionRows(ex)
      expect(rows.filter((r) => /^(Create|Trade$|Withdraw|Transfer)/.test(r.exchange)).every((r) => !r.on && r.danger)).toBe(true)
      expect(rows.some((r) => r.on)).toBe(true)
    }
  })
})
