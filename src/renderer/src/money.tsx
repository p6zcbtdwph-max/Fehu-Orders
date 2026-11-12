// Anzeigewährung: Orders laufen immer in EUR, auf Wunsch werden Beträge und Preise
// mit dem aktuellen Kraken-Kurs EUR/USD in Dollar angezeigt.
import { createContext, useContext, type ReactNode } from 'react'
import { eur as fmtEur, numberFormat, price as fmtPriceRaw } from './format'
import { localeOf } from '../../shared/number-format'

export type Currency = 'EUR' | 'USD'

interface MoneyState {
  currency: Currency
  /** 1 EUR = rate USD */
  rate: number | null
  setCurrency: (c: Currency) => void
}

const Ctx = createContext<MoneyState>({ currency: 'EUR', rate: null, setCurrency: () => {} })

export function MoneyProvider({ value, children }: { value: MoneyState; children: ReactNode }): JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMoney() {
  const s = useContext(Ctx)
  const usd = s.currency === 'USD' && !!s.rate
  const k = usd ? (s.rate as number) : 1
  const usdFmt = new Intl.NumberFormat(localeOf(numberFormat()), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return {
    ...s,
    usd,
    /** Kürzel der Anzeigewährung */
    sym: usd ? 'USD' : 'EUR',
    /** Betrag in EUR in der Anzeigewährung */
    eur: (n: number) => (usd ? `${usdFmt.format(n * k)} $` : fmtEur(n)),
    /** Preis in EUR in der Anzeigewährung (ohne Kürzel) */
    fmtPrice: (n: number, decimals: number) => fmtPriceRaw(n * k, decimals),
    /** Dollar-Hinweis für ein EUR-Eingabefeld */
    usdHint: (n: number) => (usd ? `≈ ${usdFmt.format(n * k)} $` : ''),
  }
}
