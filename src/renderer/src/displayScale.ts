// Anzeigegröße nach Fehu Design: feste Schriftstufen, größer oder kleiner nur über den
// Zoom-Faktor des Fensters (90 / 100 / 110 / 120 %). Gespeichert auf diesem Mac.
const KEY = 'fehu-anzeigegroesse'
export const DISPLAY_SCALES = [0.9, 1, 1.1, 1.2] as const
export type DisplayScale = (typeof DISPLAY_SCALES)[number]

export function readDisplayScale(): DisplayScale {
  try {
    const v = Number(localStorage.getItem(KEY))
    return (DISPLAY_SCALES as readonly number[]).includes(v) ? (v as DisplayScale) : 1
  } catch { return 1 }
}

export function applyDisplayScale(s: DisplayScale): void {
  try { s === 1 ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, String(s)) } catch { /* egal */ }
  if (window.fehuDisplay) window.fehuDisplay.setZoom(s)
  else document.documentElement.style.setProperty('zoom', String(s))
}

export function initDisplayScale(): void {
  applyDisplayScale(readDisplayScale())
}
