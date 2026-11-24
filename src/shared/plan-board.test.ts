import { describe, expect, it } from 'vitest'
import { boardCounts, cancelledPlans, isRunning, planBoard, planStatusOf, restLevels } from './plan-board'
import type { DraftDto, PlanDto, PlanStatusDto } from './ipc'

const lvl = (index: number, zone?: number) => ({ index, price: 100 - index, volume: 1, cost: 100 - index, share: 0.1, zone })

const plan = (userref: number, over: Partial<PlanDto> = {}): PlanDto => ({
  userref, createdAt: `2026-11-${10 + (userref % 10)}T12:00:00Z`, pairId: 'XBTEUR', pairName: 'BTC/EUR', side: 'buy',
  input: { side: 'buy' } as PlanDto['input'], sent: 2, failed: 0, totalCost: 200, levels: [lvl(0), lvl(1)], sentIndices: [0, 1], ...over,
})

const st = (userref: number, over: Partial<PlanStatusDto> = {}): PlanStatusDto => ({
  userref, open: 0, filled: 2, partial: 0, canceled: 0, filledVolume: 2, filledCost: 197, fees: 0, averagePrice: 98.5, ...over,
})

const draft = (id: string, over: Partial<DraftDto> = {}): DraftDto => ({
  id, name: `Entwurf ${id}`, scenario: '', note: '', createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z',
  pairId: 'XBTEUR', pairName: 'BTC/EUR', side: 'buy', input: { side: 'buy' } as DraftDto['input'], postOnly: true, status: 'draft', ...over,
} as DraftDto)

describe('Status eines gesendeten Plans', () => {
  it('ohne Status von der Börse gilt er als laufend, nie als fertig', () => {
    expect(planStatusOf(plan(1), undefined).status).toBe('run')
  })
  it('alles ausgeführt und nichts mehr offen oder zurückgehalten: fertig', () => {
    expect(planStatusOf(plan(1), st(1)).status).toBe('done')
  })
  it('offene Orders bei der Börse: läuft', () => {
    expect(planStatusOf(plan(1), st(1, { open: 1 })).status).toBe('run')
  })
  it('zurückgehaltene Stufen zählen als Rest, der Plan läuft weiter', () => {
    const p = plan(1, { levels: [lvl(0), lvl(1), lvl(2)], sentIndices: [0, 1] })
    expect(restLevels(p).map((l) => l.index)).toEqual([2])
    expect(planStatusOf(p, st(1)).status).toBe('run')
  })
  it('Stufen mit Problem zählen nicht als Rest', () => {
    const p = plan(1, { levels: [lvl(0), lvl(1), { ...lvl(2), problem: 'zu klein' }] })
    expect(restLevels(p)).toEqual([])
  })
  it('pausierte Zone mit erfüllter Bedingung: wartet auf dich', () => {
    const p = plan(1, {
      input: { side: 'buy', zones: [{ priceStart: 100, priceEnd: 99, steps: 2, share: 50 }, { priceStart: 90, priceEnd: 89, steps: 1, share: 50, armed: false }] } as PlanDto['input'],
      levels: [lvl(0, 0), lvl(1, 0), lvl(2, 1)], sentIndices: [0, 1],
    })
    const half = st(1, { open: 1, zones: [{ zone: 0, levels: 2, sent: 2, sentVolume: 2, filledVolume: 1, filledShare: 0.5 }] })
    expect(planStatusOf(p, half)).toEqual({ status: 'wait', wait: { kind: 'zone', zone: 1 } })
    const little = st(1, { open: 2, zones: [{ zone: 0, levels: 2, sent: 2, sentVolume: 2, filledVolume: 0.4, filledShare: 0.2 }] })
    expect(planStatusOf(p, little).status).toBe('run')
  })
})

describe('Liste „Meine Pläne“', () => {
  it('Entwürfe und Pläne in einer Liste, Wartendes zuerst, Fertiges am Ende', () => {
    const b = planBoard(
      [draft('a'), draft('b', { alarmFiredAt: '2026-11-20T09:00:00Z' })],
      [plan(1), plan(2)],
      { 1: st(1), 2: st(2, { open: 1 }) },
    )
    expect(b.map((e) => [e.id, e.status])).toEqual([['d:b', 'wait'], ['p:2', 'run'], ['d:a', 'draft'], ['p:1', 'done']])
    expect(b[0].wait).toEqual({ kind: 'alarm', at: '2026-11-20T09:00:00Z' })
  })
  it('gesendete Entwürfe erscheinen nur als Plan, mit ihrem Namen', () => {
    const b = planBoard([draft('a', { status: 'released', userref: 7 })], [plan(7)], {})
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ id: 'p:7', kind: 'plan', name: 'Entwurf a', status: 'run' })
  })
  it('zählt je Reiter', () => {
    const b = planBoard([draft('a'), draft('b', { alarmFiredAt: 'x' })], [plan(1), plan(2)], { 1: st(1), 2: st(2, { open: 1 }) })
    expect(boardCounts(b)).toEqual({ all: 4, drafts: 2, running: 1, done: 1, waiting: 1, cancelled: 0 })
  })
})

describe('Abgebrochene Pläne', () => {
  const nothing = { filled: 0, filledVolume: 0, filledCost: 0, averagePrice: 0 }
  it('in der App storniert und nichts ausgeführt: abgebrochen, nicht fertig', () => {
    expect(planStatusOf(plan(1, { cancelledAt: '2026-11-24T10:00:00Z' }), st(1, { ...nothing, canceled: 2 })).status).toBe('cancelled')
  })
  it('bei der Börse storniert (ohne App) und nichts ausgeführt: ebenfalls abgebrochen', () => {
    expect(planStatusOf(plan(1), st(1, { ...nothing, canceled: 2 })).status).toBe('cancelled')
  })
  it('teilweise ausgeführt und Rest storniert: fertig, denn es wurde etwas gekauft', () => {
    expect(planStatusOf(plan(1, { cancelledAt: '2026-11-24T10:00:00Z' }), st(1, { filled: 1, canceled: 1 })).status).toBe('done')
    expect(planStatusOf(plan(1), st(1, { ...nothing, partial: 1, filledVolume: 0.3, canceled: 1 })).status).toBe('done')
  })
  it('nach dem Stornieren gibt es keine Reststufen und keine pausierten Zonen mehr', () => {
    const p = plan(1, { levels: [lvl(0), lvl(1), lvl(2)], sentIndices: [0, 1], cancelledAt: '2026-11-24T10:00:00Z' })
    expect(restLevels(p)).toEqual([])
    expect(planStatusOf(p, st(1, { ...nothing, canceled: 2 })).status).toBe('cancelled')
  })
  it('Einzelne Order storniert, Rest noch nicht gesendet: läuft weiter', () => {
    const p = plan(1, { levels: [lvl(0), lvl(1), lvl(2)], sentIndices: [0, 1] })
    expect(planStatusOf(p, st(1, { ...nothing, canceled: 2 })).status).toBe('run')
  })
  it('in der App storniert, Börse gerade nicht erreichbar: abgebrochen', () => {
    expect(planStatusOf(plan(1, { cancelledAt: '2026-11-24T10:00:00Z' }), undefined).status).toBe('cancelled')
  })
  it('zählt nicht in Meine Pläne mit, steht aber im Verlauf', () => {
    const b = planBoard([], [plan(1), plan(2, { cancelledAt: '2026-11-24T10:00:00Z' }), plan(3)], { 1: st(1), 2: st(2, { ...nothing, canceled: 2 }), 3: st(3, { open: 1 }) })
    expect(boardCounts(b)).toMatchObject({ all: 2, running: 1, done: 1, cancelled: 1 })
    expect(b.filter(isRunning).map((e) => e.id)).toEqual(['p:3'])
    expect(cancelledPlans(b).map((e) => e.id)).toEqual(['p:2'])
  })
})
