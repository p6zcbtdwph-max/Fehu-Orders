import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
vi.mock('electron', async () => (await import('./test-electron')).electronMock)
import { dir } from './test-electron'
import * as store from './store'

const plan = (userref: number) => ({ userref, createdAt: new Date().toISOString(), pairId: 'XXBTZEUR', pairName: 'BTC/EUR', side: 'buy' as const, input: {} as any, sent: 1, failed: 0, totalCost: 10 })
const draft = (i: number, status: 'draft' | 'released' = 'draft') => ({ id: 'd' + i, name: 'Entwurf ' + i, scenario: '', createdAt: '', updatedAt: '', pairId: 'XXBTZEUR', pairName: 'BTC/EUR', side: 'buy' as const, input: {} as any, postOnly: true, status })

beforeEach(() => { for (const f of readdirSync(dir)) rmSync(join(dir, f)) })

describe('Ablage', () => {
  it('löscht bei vielen Plänen keinen Plan', () => {
    for (let i = 1; i <= 250; i++) store.addPlan(plan(i))
    expect(store.getPlans()).toHaveLength(250)
    expect(store.getPlans().some((p) => p.userref === 1)).toBe(true)
  })
  it('löscht offene Entwürfe nie, freigegebene nur über 300', () => {
    for (let i = 1; i <= 310; i++) store.saveDraft(draft(i))
    for (let i = 1000; i < 1310; i++) store.saveDraft(draft(i, 'released'))
    const all = store.getDrafts()
    expect(all.filter((d) => d.status === 'draft')).toHaveLength(310)
    expect(all.filter((d) => d.status === 'released')).toHaveLength(300)
  })
  it('kaputte Datei: alter Stand kommt aus der Reserve, nichts wird überschrieben', () => {
    for (let i = 1; i <= 5; i++) store.addPlan(plan(i))
    const f = join(dir, 'plans.json')
    const full = readFileSync(f, 'utf8')
    writeFileSync(f, full.slice(0, Math.floor(full.length / 2))) // wie nach Absturz mitten im Schreiben
    expect(store.getPlans().map((p) => p.userref)).toEqual([4, 3, 2, 1]) // Reserve = Stand vor dem letzten Speichern
    expect(readdirSync(dir).some((n) => n.startsWith('plans.json.defekt-'))).toBe(true)
    store.addPlan(plan(99))
    expect(store.getPlans().map((p) => p.userref)).toEqual([99, 4, 3, 2, 1])
  })
  it('schreibt über eine Hilfsdatei, es bleibt keine .tmp liegen', () => {
    store.addPlan(plan(1))
    expect(existsSync(join(dir, 'plans.json.tmp'))).toBe(false)
  })
  it('übernimmt keine unsinnigen Einstellungen', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ maxPlanEur: -5, watchlist: 'BTC/EUR', numberFormat: 'xx' }))
    expect(store.getSettings()).toEqual(store.DEFAULT_SETTINGS)
  })
})
