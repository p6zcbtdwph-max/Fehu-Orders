// Daten von der Börse für den Planer: Gebühren, Guthaben, Bestand beim Verkaufen, Kurse für Chart und Rückblick.
// Lädt neu, wenn sich Paar, Richtung, Zeitraum ändern oder gerade gesendet wurde.
import { useEffect, useMemo, useState } from 'react'
import { toCandles, type Candle, type OhlcRow } from '@shared/history'
import { toWeekly } from '@shared/fib'
import { holdingsFor } from '@shared/holdings'
import type { PairDto, SendResult } from '@shared/ipc'
import { api } from '../../api'
import { RANGES } from './PlanResults'

export function useMarketData({ hasKey, pairId, pairs, selling, range, result }: { hasKey: boolean; pairId: string; pairs: PairDto[]; selling: boolean; range: number; result: SendResult | null }) {
  const [candles, setCandles] = useState<OhlcRow[]>([])
  // Tageskerzen für den Rückblick (wie oft der Kurs eine Stufe erreicht hat)
  const [daily, setDaily] = useState<Candle[]>([])
  // Wochenkerzen über mehrere Jahre für die Fibonacci-Bodenzone (letzter großer Anstieg)
  const [weekly, setWeekly] = useState<Candle[]>([])
  const [fees, setFees] = useState<{ maker: number; taker: number } | null>(null)
  const [available, setAvailable] = useState<Record<string, number> | null>(null)
  /** Gesamtguthaben (frei + gesperrt, bei Kraken auch Earn) und Kurse für die Bestandsliste beim Verkaufen */
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [holdPrices, setHoldPrices] = useState<Record<string, number>>({})
  const [holdLoading, setHoldLoading] = useState(false)

  // Guthaben und Gebühren nur mit Schlüssel
  useEffect(() => {
    if (!hasKey || !pairId) return
    api().fees(pairId).then(setFees).catch(() => setFees(null))
    api().available().then(setAvailable).catch(() => setAvailable(null))
  }, [hasKey, pairId, result])

  // Bestand beim Verkaufen: freies und gesamtes Guthaben, dazu die Kurse der eigenen Coins für den Wert
  useEffect(() => {
    if (!hasKey || !selling || !pairs.length) return
    let gone = false
    setHoldLoading(true)
    Promise.all([api().available(), api().balances().catch(() => ({} as Record<string, number>))]).then(async ([free, all]) => {
      if (gone) return
      setAvailable(free)
      setBalances(all)
      const ids = holdingsFor(pairs, free, all).map((h) => h.pair.id)
      const ps = ids.length ? await api().prices(ids).catch(() => ({} as Record<string, number>)) : {}
      if (!gone) setHoldPrices(ps)
    }).catch(() => undefined).finally(() => { if (!gone) setHoldLoading(false) })
    return () => { gone = true }
  }, [hasKey, selling, pairs, result])

  useEffect(() => {
    if (!pairId) return
    const r = RANGES.find((x) => x.id === range)!
    const since = Date.now() / 1000 - r.days * 86400
    api().ohlc(pairId, r.interval).then((c) => setCandles(c.filter(([t]) => t >= since))).catch(() => setCandles([]))
  }, [pairId, range])
  useEffect(() => {
    if (!pairId) return
    setDaily([])
    api().ohlc(pairId, 1440).then((c) => setDaily(toCandles(c))).catch(() => setDaily([]))
  }, [pairId])
  useEffect(() => {
    if (!pairId) return
    let gone = false
    setWeekly([])
    // Ohne Wochenkerzen reichen zur Not die Tageskerzen (dann nur rund 2 Jahre)
    api().ohlc(pairId, 10080).then((c) => { if (!gone) setWeekly(toCandles(c)) }).catch(() => undefined)
    return () => { gone = true }
  }, [pairId])

  const weeks = useMemo(() => (weekly.length > 1 ? weekly : toWeekly(daily)), [weekly, daily])
  return { fees, available, balances, holdPrices, holdLoading, candles, daily, weekly: weeks }
}
