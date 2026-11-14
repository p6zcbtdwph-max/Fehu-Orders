import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import { toCsv } from './pages/LogPage'

afterEach(() => setLang('de'))

describe('Sprache im Fenster', () => {
  it('Protokoll als CSV mit englischen Spalten', () => {
    setLang('en')
    const csv = toCsv([{ at: '2026-11-11T10:00:00Z', action: 'send', pair: 'BTC/EUR', side: 'buy', count: 2, ok: 2, failed: 0, amount: 12.5, success: true }])
    const [head, row] = csv.replace('﻿', '').split('\r\n')
    expect(head.startsWith('Time;Action;Pair;Side')).toBe(true)
    expect(row).toContain(';Sent;BTC/EUR;Buy;')
    expect(row).toContain(';yes;')
  })
})
