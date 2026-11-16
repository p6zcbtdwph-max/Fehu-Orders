// Zahlenformat für Eingaben und Anzeige: Deutsch (1.234,56) oder Amerikanisch (1,234.56).
// Rein, ohne Oberfläche, damit es testbar ist.
import { tr } from './i18n'

export type NumberFormat = 'de' | 'en'

/** Funktion statt fester Liste, damit die Namen in der gewählten Sprache erscheinen */
export const NUMBER_FORMATS = (): { id: NumberFormat; label: string; example: string; locale: string }[] => [
  { id: 'de', label: tr('Deutsch', 'German'), example: '1.234,56', locale: 'de-DE' },
  { id: 'en', label: tr('Amerikanisch', 'US'), example: '1,234.56', locale: 'en-US' },
]

export const localeOf = (f: NumberFormat): string => (f === 'en' ? 'en-US' : 'de-DE')

const SEP: Record<NumberFormat, { group: string; decimal: string }> = {
  de: { group: '.', decimal: ',' },
  en: { group: ',', decimal: '.' },
}

/**
 * Liest eine Zahl streng im gewählten Format. Tausenderpunkte (bzw. -kommas) sind nur
 * in Dreiergruppen erlaubt, damit „78428.4“ im deutschen Format nicht still zu 784284 wird.
 * Leerzeichen als Tausendertrenner sind erlaubt. Ungültig oder leer → NaN.
 */
export function parseNumber(text: string, format: NumberFormat): number {
  const { group, decimal } = SEP[format]
  const s = text.trim().replace(/[\s  ']/g, '').replace(/[€$%]/g, '')
  if (!s) return NaN
  const esc = (c: string) => `\\${c}`
  const re = new RegExp(`^([+-])?(\\d{1,3}(?:${esc(group)}\\d{3})+|\\d+)?(?:${esc(decimal)}(\\d*))?$`)
  const m = re.exec(s)
  if (!m || (!m[2] && !m[3])) return NaN
  const intPart = (m[2] ?? '0').split(group).join('')
  return Number(`${m[1] ?? ''}${intPart}.${m[3] || '0'}`)
}

/**
 * Zahl für ein Eingabefeld mit dem Dezimalzeichen des Formats, ohne Rundung.
 * group: Tausendertrenner wie in der Anzeige (78.467,1), damit Eingabe und Tabelle gleich aussehen.
 * parseNumber liest beide Schreibweisen.
 */
export function toInputText(value: number, format: NumberFormat, group = false): string {
  if (!Number.isFinite(value)) return ''
  const s = String(value).includes('e') ? value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '') : String(value)
  const [int, frac] = s.split('.')
  const sign = int.startsWith('-') ? '-' : ''
  const digits = sign ? int.slice(1) : int
  const grouped = group ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, SEP[format].group) : digits
  return `${sign}${grouped}${frac !== undefined ? SEP[format].decimal + frac : ''}`
}

/** Währungszeichen statt Kürzel: EUR → €, USD → $. Coins (BTC, SOL …) bleiben, wie sie heißen. */
export function currencySign(code: string): string {
  return ({ EUR: '€', USD: '$' } as Record<string, string>)[code] ?? code
}

/** Geldbetrag mit zwei Nachkommastellen im gewählten Format, z. B. „1.234,50 €“. Auch für Meldungen aus dem Hauptprozess. */
export function moneyText(n: number, format: NumberFormat, sign = '€'): string {
  return `${new Intl.NumberFormat(localeOf(format), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${sign}`
}

/**
 * Prozentliste aus Text. Deutsch: Werte mit Leerzeichen oder Semikolon trennen, Komma ist das Dezimalzeichen
 * („12,5; 12,5; 25; 50“). Amerikanisch: Komma, Semikolon oder Leerzeichen trennen („12.5, 12.5, 25, 50“).
 * Ungültige Werte bleiben als NaN in der Liste, damit die Anzahl stimmt und die Prüfung sie meldet.
 */
export function parseWeightList(text: string, format: NumberFormat): number[] {
  const split = format === 'de' ? /[\s;]+/ : /[\s,;]+/
  return text
    .split(split)
    .map((x) => x.replace(/%$/, '').replace(/,$/, ''))
    .filter((x) => x !== '')
    .map((x) => parseNumber(x, format))
}
