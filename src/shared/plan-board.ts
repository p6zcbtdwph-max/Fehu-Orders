// „Meine Pläne“: Entwürfe und gesendete Pläne in einer Liste, jeder mit einem Status.
// Ein Plan durchläuft vier Zustände: Entwurf → (Wartet auf dich) → Läuft → Fertig.
import type { DraftDto, PlanDto, PlanStatusDto } from './ipc'
import { heldZones, isHeld, zoneTrigger, type LadderLevel } from './ladder'
import { triggerMet } from './plan-status'

export type BoardStatus = 'draft' | 'wait' | 'run' | 'done'

/** Grund, warum ein Plan auf dich wartet */
export type WaitReason =
  | { kind: 'alarm'; at: string }
  | { kind: 'zone'; zone: number }

export interface BoardEntry {
  /** Eindeutig in der Liste: „d:<id>“ für Entwürfe, „p:<userref>“ für gesendete Pläne */
  id: string
  kind: 'draft' | 'plan'
  status: BoardStatus
  /** Nur bei status 'wait' */
  wait?: WaitReason
  /** Name des Entwurfs (auch bei gesendeten Plänen, die aus einem Entwurf kamen) */
  name?: string
  pairName: string
  side: 'buy' | 'sell'
  /** Erstellt oder gesendet (ISO), zum Sortieren und Anzeigen */
  at: string
  draft?: DraftDto
  plan?: PlanDto
  st?: PlanStatusDto
}

/** Noch nicht gesendete Stufen einer Zone */
export const zoneLevels = (p: PlanDto, zone: number): LadderLevel[] => {
  const sent = new Set(p.sentIndices ?? [])
  return (p.levels ?? []).filter((l) => l.zone === zone && !sent.has(l.index) && !l.problem)
}

/** Stufen, die beim ersten Senden zurückgehalten wurden (ohne pausierte Zonen, die haben ihren eigenen Knopf) */
export const restLevels = (p: PlanDto): LadderLevel[] => {
  const sent = new Set(p.sentIndices ?? [])
  const held = heldZones(p.input)
  return (p.levels ?? []).filter((l) => !sent.has(l.index) && !isHeld(l, held) && !l.problem)
}

/** Pausierte Zonen eines Plans, die noch Stufen zum Senden haben */
export const heldWithLevels = (p: PlanDto): number[] => [...heldZones(p.input)].filter((z) => zoneLevels(p, z).length > 0)

/** Pausierte Zonen, deren Bedingung erfüllt ist („Jetzt aktivieren“) */
export const readyZones = (p: PlanDto, st: PlanStatusDto | undefined): number[] =>
  heldWithLevels(p).filter((z) => triggerMet(st?.zones, zoneTrigger(p.input.zones ?? [], z)))

/**
 * Status eines gesendeten Plans. Ohne Status von der Börse (kein Schlüssel, Fehler) gilt er als „Läuft“,
 * damit nie ein Plan fälschlich als fertig erscheint.
 */
export function planStatusOf(p: PlanDto, st: PlanStatusDto | undefined): { status: BoardStatus; wait?: WaitReason } {
  const ready = readyZones(p, st)
  if (ready.length) return { status: 'wait', wait: { kind: 'zone', zone: ready[0] } }
  if (!st) return { status: 'run' }
  const left = restLevels(p).length > 0 || heldWithLevels(p).length > 0
  return { status: st.open > 0 || left ? 'run' : 'done' }
}

const ORDER: Record<BoardStatus, number> = { wait: 0, draft: 1, run: 1, done: 2 }

/** Alle Pläne für „Meine Pläne“: zuerst, was auf dich wartet, dann das Neueste, Fertiges am Ende */
export function planBoard(drafts: DraftDto[], plans: PlanDto[], status: Record<number, PlanStatusDto>): BoardEntry[] {
  // Gesendete Entwürfe erscheinen als Plan, behalten aber ihren Namen
  const nameOf = new Map<number, string>()
  for (const d of drafts) if (d.status === 'released' && d.userref) nameOf.set(d.userref, d.name)

  const out: BoardEntry[] = []
  for (const d of drafts) {
    if (d.status !== 'draft') continue
    out.push({
      id: `d:${d.id}`, kind: 'draft', draft: d, name: d.name, pairName: d.pairName, side: d.side, at: d.updatedAt || d.createdAt,
      ...(d.alarmFiredAt ? { status: 'wait', wait: { kind: 'alarm', at: d.alarmFiredAt } } : { status: 'draft' }),
    })
  }
  for (const p of plans) {
    const st = status[p.userref]
    out.push({ id: `p:${p.userref}`, kind: 'plan', plan: p, st, name: nameOf.get(p.userref), pairName: p.pairName, side: p.side, at: p.createdAt, ...planStatusOf(p, st) })
  }
  return out.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.at.localeCompare(a.at))
}

/** Anzahl je Reiter: Entwürfe (inkl. Kursalarm), Laufend (inkl. Zone bereit), Fertig */
export function boardCounts(entries: BoardEntry[]): { all: number; drafts: number; running: number; done: number; waiting: number } {
  return {
    all: entries.length,
    drafts: entries.filter((e) => e.kind === 'draft').length,
    running: entries.filter((e) => e.kind === 'plan' && e.status !== 'done').length,
    done: entries.filter((e) => e.status === 'done').length,
    waiting: entries.filter((e) => e.status === 'wait').length,
  }
}
