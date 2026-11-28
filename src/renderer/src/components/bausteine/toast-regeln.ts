// Regeln für Toasts (Fehu Design, 03 Bausteine.md › Toast), ohne React, damit sie testbar sind.

export type ToastArt = 'info' | 'fehler'

export interface ToastAktion {
  label: string
  onClick: () => void
}

export interface ToastDaten {
  id: number
  text: string
  art: ToastArt
  aktion?: ToastAktion
}

/** Höchstens drei gleichzeitig, der neueste unten. */
export const TOAST_MAX = 3

/** Dauer in ms: 4 s, mit Aktion 10 s, Fehler bleiben bis zum Schließen (null). */
export function toastDauer(art: ToastArt, mitAktion: boolean): number | null {
  if (art === 'fehler') return null
  return mitAktion ? 10_000 : 4_000
}

/** Neuen Toast hinten anhängen; bei mehr als drei fällt der älteste weg. */
export function toastHinzu(liste: ToastDaten[], neu: ToastDaten): ToastDaten[] {
  return [...liste, neu].slice(-TOAST_MAX)
}
