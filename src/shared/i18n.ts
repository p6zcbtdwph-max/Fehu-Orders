// Sprache der App: Deutsch oder Englisch. Jeder Text steht direkt an seiner Stelle in beiden
// Sprachen: tr('Speichern', 'Save'). Haupt- und Fensterprozess setzen die Sprache jeweils selbst
// (aus den Einstellungen), so kommen auch Fehlermeldungen von Kraken in der gewählten Sprache.

export type Lang = 'de' | 'en'

export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: 'de', label: 'Deutsch', short: 'DE' },
  { id: 'en', label: 'English', short: 'EN' },
]

let current: Lang = 'de'
export const setLang = (l: Lang): void => { current = l === 'en' ? 'en' : 'de' }
export const lang = (): Lang => current

/** Text in der gewählten Sprache. Geht auch für JSX: tr(<>…</>, <>…</>) */
export function tr<T>(de: T, en: T): T {
  return current === 'en' ? en : de
}

/** Systemsprache → App-Sprache (alles außer Deutsch wird Englisch) */
export const langFromLocale = (locale: string | undefined): Lang => (/^de\b|^de[-_]/i.test(locale ?? '') ? 'de' : 'en')
