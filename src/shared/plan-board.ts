// „Meine Pläne“: Entwürfe und gesendete Pläne in einer Liste, jeder mit einem Status.
// Ein Plan durchläuft vier Zustände: Entwurf → (Wartet auf dich) → Läuft → Fertig.
// Wurde ein Plan storniert, ohne dass etwas ausgeführt wurde, gilt er als „Abgebrochen“: Er steht dann
// nicht mehr in „Meine Pläne“, sondern nur noch im Verlauf.
import type { DraftDto, PlanDto, PlanStatusDto } from './ipc'
import { heldZones, isHeld, zoneTrigger, type LadderLevel } from './ladder'
import { triggerMet } from './plan-status'

export type BoardStatus = 'draft' | 'wait' | 'run' | 'done' | 'cancelled'

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

/** Noch nicht gesendete Stufen einer Zone. Nach dem Stornieren gibt es keine mehr. */
export const zoneLevels = (p: PlanDto, zone: number): LadderLevel[] => {
  if (p.cancelledAt) return []
  const sent = new Set(p.sentIndices ?? [])
  return (p.levels ?? []).filter((l) => l.zone === zone && !sent.has(l.index) && !l.problem)
}

/** Stufen, die beim ersten Senden zurückgehalten wurden (ohne pausierte Zonen, die haben ihren eigenen Knopf) */
export const restLevels = (p: PlanDto): LadderLevel[] => {
  if (p.cancelledAt) return []
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
  // In der App storniert, Börse gerade nicht erreichbar: es bleibt beim Abbruch
  if (!st) return { status: p.cancelledAt ? 'cancelled' : 'run' }
  const left = restLevels(p).length > 0 || heldWithLevels(p).length > 0
  if (st.open > 0 || left) return { status: 'run' }
  return { status: wasCancelled(p, st) && !hasFills(st) ? 'cancelled' : 'done' }
}

/** Ist von einem Plan etwas ausgeführt worden (auch nur teilweise)? */
export const hasFills = (st: PlanStatusDto | undefined): boolean => !!st && (st.filled > 0 || st.partial > 0 || st.filledVolume > 0)

/** Wurde ein Plan storniert, in der App oder direkt bei der Börse (bzw. sind Orders abgelaufen)? */
export const wasCancelled = (p: PlanDto, st: PlanStatusDto | undefined): boolean => !!p.cancelledAt || (st?.canceled ?? 0) > 0

/** Gehört der Eintrag in „Meine Pläne“? Abgebrochene Pläne ohne Ausführung stehen nur noch im Verlauf. */
export const onBoard = (e: Pick<BoardEntry, 'status'>): boolean => e.status !== 'cancelled'

const ORDER: Record<BoardStatus, number> = { wait: 0, draft: 1, run: 1, done: 2, cancelled: 3 }

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

/** Gesendet und noch nicht fertig oder abgebrochen */
export const isRunning = (e: Pick<BoardEntry, 'kind' | 'status'>): boolean => e.kind === 'plan' && (e.status === 'run' || e.status === 'wait')

/** Abgebrochene Pläne (nichts ausgeführt) für den Verlauf, neueste zuerst */
export const cancelledPlans = (entries: BoardEntry[]): BoardEntry[] =>
  entries.filter((e) => e.status === 'cancelled').sort((a, b) => (b.plan?.cancelledAt ?? b.at).localeCompare(a.plan?.cancelledAt ?? a.at))

/** Anzahl je Reiter: Entwürfe (inkl. Kursalarm), Laufend (inkl. Zone bereit), Fertig. Abgebrochene zählen nicht mit. */
export function boardCounts(entries: BoardEntry[]): { all: number; drafts: number; running: number; done: number; waiting: number; cancelled: number } {
  const shown = entries.filter(onBoard)
  return {
    all: shown.length,
    cancelled: entries.length - shown.length,
    drafts: entries.filter((e) => e.kind === 'draft').length,
    running: entries.filter(isRunning).length,
    done: entries.filter((e) => e.status === 'done').length,
    waiting: entries.filter((e) => e.status === 'wait').length,
  }
}
