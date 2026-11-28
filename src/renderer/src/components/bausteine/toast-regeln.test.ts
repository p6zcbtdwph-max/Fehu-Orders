import { describe, it, expect } from 'vitest'
import { TOAST_MAX, toastDauer, toastHinzu, type ToastDaten } from './toast-regeln'

const t = (id: number): ToastDaten => ({ id, text: `T${id}`, art: 'info' })

describe('Toast-Regeln (03 Bausteine.md › Toast)', () => {
  it('4 s, mit Aktion 10 s, Fehler bleiben', () => {
    expect(toastDauer('info', false)).toBe(4000)
    expect(toastDauer('info', true)).toBe(10000)
    expect(toastDauer('fehler', false)).toBeNull()
    expect(toastDauer('fehler', true)).toBeNull()
  })
  it('höchstens drei, der neueste unten, der älteste fällt weg', () => {
    let l: ToastDaten[] = []
    for (let i = 1; i <= 5; i++) l = toastHinzu(l, t(i))
    expect(TOAST_MAX).toBe(3)
    expect(l.map((x) => x.id)).toEqual([3, 4, 5])
  })
})
