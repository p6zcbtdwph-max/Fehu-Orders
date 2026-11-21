import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { DraftDto, OpenOrderDto, PairDto, PlanDto, PlanStatusDto } from '@shared/ipc'
import { DEFAULT_MIN_ORDER_EUR } from '@shared/ladder'
import { planBoard, type BoardEntry } from '@shared/plan-board'

export interface PlanData {
  drafts: DraftDto[]
  plans: PlanDto[]
  /** null = noch nicht geladen oder kein Schlüssel */
  orders: OpenOrderDto[] | null
  status: Record<number, PlanStatusDto>
  pairs: PairDto[]
  /** Aktueller Kurs je Paar der offenen Entwürfe */
  prices: Record<string, number>
  balances: Record<string, number>
  /** Frei verfügbar (nicht in offenen Orders gebunden), null ohne Schlüssel */
  available: Record<string, number> | null
  minOrder: number
  error: string | null
  loading: boolean
  board: BoardEntry[]
  load: () => void
}

/**
 * Lädt alles, was „Übersicht“ und „Meine Pläne“ brauchen: Entwürfe, Pläne, offene Orders, Status und Guthaben.
 * Lädt neu bei neuen Ausführungen und wenn `reload` hochzählt (z. B. nach der Notbremse).
 */
export function usePlanData(hasKey: boolean, reload: string | number = 0): PlanData {
  const [drafts, setDrafts] = useState<DraftDto[]>([])
  const [plans, setPlans] = useState<PlanDto[]>([])
  const [orders, setOrders] = useState<OpenOrderDto[] | null>(null)
  const [status, setStatus] = useState<Record<number, PlanStatusDto>>({})
  const [pairs, setPairs] = useState<PairDto[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [available, setAvailable] = useState<Record<string, number> | null>(null)
  const [minOrder, setMinOrder] = useState(DEFAULT_MIN_ORDER_EUR)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setError(null)
    setLoading(true)
    try {
      const [ds, ps, pl, s] = await Promise.all([api().drafts(), api().pairs(), api().plans(), api().settings()])
      setDrafts(ds)
      setPairs(ps)
      setPlans(pl)
      setMinOrder(s.minOrderEur ?? DEFAULT_MIN_ORDER_EUR)
      const ids = [...new Set(ds.filter((d) => d.status === 'draft').map((d) => d.pairId))]
      if (ids.length) api().prices(ids).then(setPrices).catch(() => setPrices({}))
      else setPrices({})
      if (hasKey) {
        const [o, b, a] = await Promise.all([api().openOrders(), api().balances(), api().available().catch(() => null)])
        setOrders(o)
        setBalances(b)
        setAvailable(a)
        const st = await api().planStatus()
        setStatus(Object.fromEntries(st.map((x) => [x.userref, x])))
      } else {
        setOrders(null)
        setBalances({})
        setAvailable(null)
        setStatus({})
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // neue Ausführungen (Meldung aus dem Hauptprozess) sofort anzeigen
    return api().onFills(() => load())
  }, [hasKey, reload])

  const board = useMemo(() => planBoard(drafts, plans, status), [drafts, plans, status])

  return { drafts, plans, orders, status, pairs, prices, balances, available, minOrder, error, loading, board, load }
}
