// Nur das eigene App-Fenster darf Befehle an den Hauptprozess schicken (alles mit Attrappen)
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', async () => (await import('./test-electron')).electronMock)
import { call, callFrom, OWN_URL } from './test-electron'
const { isOwnUrl } = await import('./index')

describe('Absender-Prüfung', () => {
  it('die eigene index.html ist erlaubt, auch mit Anker', () => {
    expect(isOwnUrl(OWN_URL)).toBe(true)
    expect(isOwnUrl(`${OWN_URL}#/planer`)).toBe(true)
  })
  it('andere Dateien auf dem Mac und fremde Seiten sind nicht erlaubt', () => {
    expect(isOwnUrl('file:///etc/passwd')).toBe(false)
    expect(isOwnUrl('file:///Users/x/Downloads/fremd.html')).toBe(false)
    expect(isOwnUrl(OWN_URL.replace('/renderer/index.html', '/renderer/../../fremd.html'))).toBe(false)
    expect(isOwnUrl(OWN_URL.replace('/renderer/', '/renderer-fremd/'))).toBe(false)
    expect(isOwnUrl('https://example.com/')).toBe(false)
    expect(isOwnUrl('kaputt')).toBe(false)
  })
  it('ein Befehl von einer fremden Datei wird abgelehnt', async () => {
    expect(await callFrom('file:///tmp/fremd.html', 'settings')).toMatchObject({ ok: false })
    expect(await call('settings')).toMatchObject({ ok: true })
  })
})
