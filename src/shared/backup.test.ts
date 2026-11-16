import { describe, expect, it } from 'vitest'
import { makeBackup, parseBackup, summarize } from './backup'

const parts = {
  settings: { maxPlanEur: 50 },
  plans: [{ userref: 1, pairId: 'XXBTZEUR' }, { kaputt: true }],
  drafts: [{ id: 'd1', pairId: 'XXBTZEUR', input: {} }],
  templates: [],
  log: [{ at: 'x', action: 'send' }],
  notified: ['T1'],
  fills: [{ exchange: 'kraken', orders: [{ txid: 'T1', userref: 1, filled: 1, closedAt: 1_800_000_000 }] }, { kaputt: true }],
}

describe('Datensicherung', () => {
  it('schreibt und liest wieder ein, kaputte Einträge fallen weg', () => {
    const d = parseBackup(JSON.stringify(makeBackup(parts)))
    expect(summarize(d)).toMatchObject({ plans: 1, drafts: 1, templates: 0, log: 1 })
    expect(d.settings).toEqual({ maxPlanEur: 50 })
    expect(d.fills).toHaveLength(1)
  })
  it('liest ältere Sicherungen ohne Ausführungsbuch', () => {
    const { fills: _, ...old } = makeBackup(parts)
    expect(parseBackup(JSON.stringify(old)).fills).toEqual([])
  })
  it('lehnt fremde Dateien ab', () => {
    expect(() => parseBackup('hallo')).toThrow(/keine Fehu-Orders-Sicherung/)
    expect(() => parseBackup('{"app":"anders"}')).toThrow(/keine Fehu-Orders-Sicherung/)
    expect(() => parseBackup('{"app":"fehu-orders","version":99}')).toThrow(/neueren App-Version/)
  })
  it('schreibt nie Schlüsseldaten', () => {
    expect(() => makeBackup({ ...parts, settings: { secret: 'x' } })).toThrow(/Schlüsseldaten/)
  })
})
