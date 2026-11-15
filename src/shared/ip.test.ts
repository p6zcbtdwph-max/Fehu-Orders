import { describe, it, expect } from 'vitest'
import { cleanIps, ipKind, ipProblem, maskIp } from './ip'
import { setLang } from './i18n'

setLang('de')
describe('IP-Adressen', () => {
  it('erkennt gültige IPv4 und IPv6', () => {
    for (const ok of ['84.123.45.67', '0.0.0.0', '255.255.255.255']) expect(ipKind(ok)).toBe('IPv4')
    for (const ok of ['2a02:810d:4b3f:a00::1', '::1', '2001:db8:0:0:0:0:2:1', '::ffff:192.0.2.1', 'fe80::']) expect(ipKind(ok)).toBe('IPv6')
  })
  it('lehnt Ungültiges ab', () => {
    for (const bad of ['', '84.123.45', '256.1.1.1', '01.2.3.4', '1.2.3.4.5', 'abc', '1:2:3:4:5:6:7:8:9', '1::2::3', 'gggg::1', '84.123.45.67/32', '84.123.45.67 ']) {
      if (bad.trim() === '84.123.45.67') continue
      expect(ipKind(bad)).toBeNull()
    }
    expect(ipProblem('84.123.45.67/32')).toMatch(/ohne „\/…“/)
    expect(ipProblem('1.2.3.4 5.6.7.8')).toMatch(/Leerzeichen/)
    expect(ipProblem(' 84.123.45.67 ')).toBeNull()
  })
  it('verdeckt bis auf den letzten Teil', () => {
    expect(maskIp('84.123.45.67')).toBe('•••.•••.•••.67')
    expect(maskIp('2a02:810d::1')).toBe('••••:••••:…:1')
    expect(maskIp('84.123.45.67')).not.toContain('84')
  })
  it('bereinigt gespeicherte Listen', () => {
    expect(cleanIps([{ ip: '1.2.3.4', label: ' Zuhause ' }, { ip: '1.2.3.4' }, { ip: 'kaputt' }, 5, null])).toEqual([{ ip: '1.2.3.4', label: 'Zuhause' }])
    expect(cleanIps('x')).toEqual([])
  })
})
