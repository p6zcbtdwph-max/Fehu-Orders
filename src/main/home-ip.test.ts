// IP-Adressen im Hauptprozess: verschlüsselt gespeichert, Fenster sieht sie nur verdeckt, nicht in der Sicherung, nicht im Protokoll
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', async () => (await import('./test-electron')).electronMock)
import { call, dir, electronMock } from './test-electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as store from './store'

vi.stubGlobal('fetch', async () => ({ status: 500, text: async () => '{}' }))
await import('./index')

describe('IP-Adressen speichern', () => {
  it('speichern, verdeckt auflisten, aufdecken, kopieren, löschen', async () => {
    await call('settings:save', { language: 'de' })
    expect((await call('ip:list')).value).toEqual([])
    const bad = await call('ip:add', '300.1.1.1')
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/keine gültige IP-Adresse/)

    const r = await call('ip:add', ' 84.123.45.67 ', 'Zuhause')
    expect(r.ok).toBe(true)
    expect(r.value).toEqual([{ masked: '•••.•••.•••.67', label: 'Zuhause', kind: 'IPv4' }])
    expect((await call('ip:add', '84.123.45.67')).error).toMatch(/schon gespeichert/)
    await call('ip:add', '2a02:810d::1')

    // Liste enthält den Klartext nirgends
    expect(JSON.stringify((await call('ip:list')).value)).not.toContain('84.123')
    expect((await call('ip:reveal', 0)).value).toBe('84.123.45.67')
    expect((await call('ip:reveal', 5)).ok).toBe(false)
    await call('ip:copy', 1)
    expect((electronMock.clipboard as any).text).toBe('2a02:810d::1')

    // Datei geht über safeStorage (Schlüsselbund) und hat nur Besitzer-Rechte
    expect(existsSync(join(dir, 'home-ip.bin'))).toBe(true)
    expect(store.loadHomeIps()).toHaveLength(2)

    // nicht in der Datensicherung und nicht im Protokoll
    expect(JSON.stringify(store.exportAll())).not.toContain('84.123')
    expect(JSON.stringify(store.getLog())).not.toContain('84.123')

    const d = await call('ip:delete', 0)
    expect(d.value).toEqual([{ masked: '••••:••••:…:1', kind: 'IPv6' }])
    await call('ip:delete', 0)
    expect(existsSync(join(dir, 'home-ip.bin'))).toBe(false)
  })

  it('ohne Schlüsselbund wird nichts unverschlüsselt gespeichert', async () => {
    const orig = electronMock.safeStorage.isEncryptionAvailable
    electronMock.safeStorage.isEncryptionAvailable = () => false
    const r = await call('ip:add', '1.2.3.4')
    electronMock.safeStorage.isEncryptionAvailable = orig
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/nicht unverschlüsselt/)
    expect(existsSync(join(dir, 'home-ip.bin'))).toBe(false)
  })

  it('Mindest-Orderwert: Standard 10 €, ungültige Werte werden abgelehnt', async () => {
    expect((await call('settings')).value.minOrderEur).toBe(10)
    expect((await call('settings:save', { minOrderEur: 0 })).ok).toBe(false)
    expect((await call('settings:save', { minOrderEur: 'abc' })).ok).toBe(false)
    expect((await call('settings:save', { minOrderEur: 50000 })).ok).toBe(false)
    expect((await call('settings:save', { minOrderEur: 25 })).value.minOrderEur).toBe(25)
    expect(store.cleanSettings({ minOrderEur: -3 }).minOrderEur).toBe(10)
    expect(store.cleanSettings({ minOrderEur: 25 }).minOrderEur).toBe(25)
  })
})
