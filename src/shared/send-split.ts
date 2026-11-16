// Welche Stufen eines Plans jetzt rausgehen und welche später: entschärfte Zonen bleiben im Plan,
// „Davon jetzt senden“ schickt nur die ersten N scharfen Stufen (nah am Kurs). Rein, damit es testbar ist.
// Dieselbe Regel gilt im Hauptprozess beim Senden (index.ts, runSend), damit Planer und Senden übereinstimmen.
import { heldZones, isHeld, type LadderInput, type LadderLevel } from './ladder'

export interface SendSplit<T extends LadderLevel = LadderLevel> {
  /** Stufen ohne Problem (über Mindestwerten usw.) */
  sendable: T[]
  /** Nummern der entschärften Zonen */
  held: Set<number>
  armedLevels: T[]
  heldLevels: T[]
  /** Wie viele Stufen jetzt rausgehen */
  nowCount: number
  toSend: T[]
  nowCost: number
  nowVolume: number
  /** Nicht alle scharfen Stufen gehen jetzt raus */
  partial: boolean
  /** Indizes der Stufen, die im Plan bleiben (später oder entschärft) */
  later: Set<number>
}

export function splitSend<T extends LadderLevel>(levels: T[], input: Pick<LadderInput, 'zones'>, sendCount: number | null | undefined): SendSplit<T> {
  const sendable = levels.filter((l) => !l.problem)
  const held = heldZones(input)
  const armedLevels = sendable.filter((l) => !isHeld(l, held))
  const heldLevels = sendable.filter((l) => isHeld(l, held))
  const nowCount = sendCount ? Math.min(armedLevels.length, Math.max(1, Math.floor(sendCount))) : armedLevels.length
  const toSend = armedLevels.slice(0, nowCount)
  return {
    sendable, held, armedLevels, heldLevels, nowCount, toSend,
    nowCost: toSend.reduce((a, l) => a + l.cost, 0),
    nowVolume: toSend.reduce((a, l) => a + l.volume, 0),
    partial: nowCount < armedLevels.length,
    later: new Set([...armedLevels.slice(nowCount), ...heldLevels].map((l) => l.index)),
  }
}
