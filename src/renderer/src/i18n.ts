// Die Beta ist nur deutsch. Kleiner Ersatz für die i18n des Lifemanagers,
// damit übernommene UI-Bausteine unverändert bleiben können.
const TEXTS: Record<string, string> = { 'common.close': 'Schließen' }

export function tx(s: string): string {
  return s
}

export function useLanguage(): { t: (key: string) => string } {
  return { t: (key) => TEXTS[key] ?? key }
}
