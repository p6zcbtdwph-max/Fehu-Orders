// Kleiner Ersatz für die i18n des Lifemanagers, damit übernommene UI-Bausteine unverändert bleiben können.
// Die eigentliche Übersetzung steht in shared/i18n.ts (tr).
import { tr } from '../../shared/i18n'

export { tr, lang, setLang, LANGS, type Lang } from '../../shared/i18n'

const TEXTS: Record<string, () => string> = { 'common.close': () => tr('Schließen', 'Close') }

export function tx(s: string): string {
  return s
}

export function useLanguage(): { t: (key: string) => string } {
  return { t: (key) => TEXTS[key]?.() ?? key }
}
