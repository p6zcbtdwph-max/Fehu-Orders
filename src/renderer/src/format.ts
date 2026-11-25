import { localeOf, type NumberFormat } from '../../shared/number-format'
import { lang } from '../../shared/i18n'

// Gewähltes Zahlenformat (Deutsch oder Amerikanisch). App.tsx setzt es beim Start und beim Umschalten.
let current: NumberFormat = 'de'
export const setNumberFormat = (f: NumberFormat): void => { current = f }
export const numberFormat = (): NumberFormat => current

const nf = (min: number, max: number) => new Intl.NumberFormat(localeOf(current), { minimumFractionDigits: min, maximumFractionDigits: max })

export const eur = (n: number): string => `${nf(2, 2).format(n)} €`
export const num = (n: number, decimals = 8): string => nf(0, decimals).format(n)
export const price = (n: number, decimals: number): string => nf(Math.min(decimals, 2), decimals).format(n)
export const pct = (n: number): string => `${nf(1, 1).format(n * 100)} %`
/** Prozent mit zwei Nachkommastellen, z. B. „78,60 %“ */
export const pct2 = (n: number): string => `${nf(2, 2).format(n * 100)} %`

export { localDate } from '../../shared/dates'

/** Sprache für Datum und Uhrzeit: Deutsch oder britisches Englisch (24 Stunden, Tag vor Monat) */
export const dateLocale = (): string => (lang() === 'en' ? 'en-GB' : 'de-DE')

// Datum und Zeit nach Fehu Design (04 Texte.md): 24.11.2026, 24.11., 14:05, 24.11.2026, 14:05
const asDate = (x: Date | number | string): Date => (x instanceof Date ? x : new Date(x))
export const fmtDate = (x: Date | number | string): string => asDate(x).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
export const fmtDayMonth = (x: Date | number | string): string => asDate(x).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' })
export const fmtTime = (x: Date | number | string): string => asDate(x).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
export const fmtDateTime = (x: Date | number | string): string => `${fmtDate(x)}, ${fmtTime(x)}`
export const fmtDateTimeSeconds = (x: Date | number | string): string =>
  `${fmtDate(x)}, ${asDate(x).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
