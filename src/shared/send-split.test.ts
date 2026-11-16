import { describe, expect, it } from 'vitest'
import { splitSend } from './send-split'
import type { LadderLevel } from './ladder'

const lv = (index: number, zone?: number, problem?: string): LadderLevel => ({ index, price: 100 - index, volume: 1, cost: 100 - index, share: 0.1, zone, ...(problem ? { problem } : {}) })

describe('Was jetzt rausgeht', () => {
  it('ohne Teilsenden gehen alle Stufen ohne Problem raus', () => {
    const s = splitSend([lv(0), lv(1), lv(2, undefined, 'zu klein')], {}, null)
    expect(s.toSend.map((l) => l.index)).toEqual([0, 1])
    expect(s.partial).toBe(false)
    expect(s.nowCost).toBe(199)
    expect([...s.later]).toEqual([])
  })
  it('„Davon jetzt senden“ nimmt die ersten N, der Rest bleibt für später', () => {
    const s = splitSend([lv(0), lv(1), lv(2)], {}, 2)
    expect(s.toSend.map((l) => l.index)).toEqual([0, 1])
    expect(s.partial).toBe(true)
    expect([...s.later]).toEqual([2])
  })
  it('entschärfte Zonen gehen nicht mit raus und zählen als später', () => {
    const zones = [{ priceStart: 100, priceEnd: 99, steps: 2, share: 0.5 }, { priceStart: 98, priceEnd: 97, steps: 1, share: 0.5, armed: false }] as any
    const s = splitSend([lv(0, 0), lv(1, 0), lv(2, 1)], { zones }, null)
    expect(s.toSend.map((l) => l.index)).toEqual([0, 1])
    expect(s.heldLevels.map((l) => l.index)).toEqual([2])
    expect(s.partial).toBe(false)
    expect([...s.later]).toEqual([2])
  })
  it('mehr als vorhanden zu senden ist nicht möglich', () => {
    expect(splitSend([lv(0)], {}, 5).nowCount).toBe(1)
  })
})
