import { describe, expect, it } from 'vitest'
import { toCsv } from './pages/LogPage'
import { createDemoApi } from './demo'
import { buildLadder } from '../../shared/ladder'

describe('Protokoll', () => {
  it('CSV mit Semikolon, Komma und deutschen Spalten', () => {
    const csv = toCsv([{ at: '2026-11-11T10:00:00Z', action: 'send', pair: 'BTC/EUR', side: 'buy', count: 2, ok: 2, failed: 0, amount: 12.345, success: true, message: 'a;b' }])
    const [head, row] = csv.replace('﻿', '').split('\r\n')
    expect(head.startsWith('Zeit;Aktion;Paar')).toBe(true)
    expect(row).toContain(';Gesendet;BTC/EUR;Kauf;')
    expect(row).toContain(';12,35;ja;"a;b"')
  })

  it('Demo: Notbremse, Kursprüfung und Protokoll', async () => {
    const api = createDemoApi()
    const pair = (await api.pairs()).find((p) => p.name === 'BTC/EUR')!
    const input = { side: 'buy' as const, priceStart: 81000, priceEnd: 79000, steps: 2, total: 50, spacing: 'linear' as const, curve: 'flat' as const, ratio: 1 }
    const { levels } = buildLadder(input, pair)
    await expect(api.send({ pairId: pair.id, pairName: pair.name, side: 'buy', input, levels, validate: true, postOnly: true })).rejects.toThrow(/falschen Seite/)
    expect(await api.cancelAll()).toBe(3) // die offenen Orders des Beispielplans
    expect(await api.openOrders()).toHaveLength(0)
    const log = await api.log()
    expect(log.map((e) => e.action)).toEqual(['cancel-all', 'validate'])
    expect(log[1].success).toBe(false)
  })
})
