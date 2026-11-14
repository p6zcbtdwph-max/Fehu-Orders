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

export { localDate } from '../../shared/dates'

/** Sprache für Datum und Uhrzeit: Deutsch oder britisches Englisch (24 Stunden, Tag vor Monat) */
export const dateLocale = (): string => (lang() === 'en' ? 'en-GB' : 'de-DE')
