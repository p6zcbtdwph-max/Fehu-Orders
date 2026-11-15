// IP-Adressen für die IP-Sperre der API-Schlüssel: prüfen und für die Anzeige verdecken.
// Rein, ohne Netz, damit es testbar ist.
import { tr } from './i18n'

/** Höchstens so viele Adressen (z. B. Zuhause IPv4, Zuhause IPv6, Büro) */
export const MAX_IPS = 10

export interface HomeIp {
  ip: string
  /** Eigene Bezeichnung, z. B. „Zuhause“ */
  label?: string
}

/** Liste für das Fenster: Adresse nur verdeckt, Klartext gibt es erst auf Klick */
export interface HomeIpView {
  masked: string
  label?: string
  kind: 'IPv4' | 'IPv6'
}

function isIpv4(s: string): boolean {
  const parts = s.split('.')
  // keine führenden Nullen (010 könnte als Oktalzahl gelesen werden), jede Zahl 0–255
  return parts.length === 4 && parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)
}

function isIpv6(s: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(s) || s.length > 45) return false
  const halves = s.split('::')
  if (halves.length > 2) return false
  const groups = (h: string) => (h === '' ? [] : h.split(':'))
  const head = groups(halves[0])
  const tail = halves.length === 2 ? groups(halves[1]) : []
  const all = [...head, ...tail]
  // Am Ende darf eine IPv4-Adresse stehen (::ffff:1.2.3.4), sie zählt wie zwei Gruppen
  let count = all.length
  const last = all[all.length - 1]
  if (last !== undefined && last.includes('.')) {
    if (!isIpv4(last)) return false
    all.pop()
    count += 1
  }
  if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false
  return halves.length === 2 ? count <= 7 : count === 8
}

/** Art der Adresse oder null, wenn es keine gültige IP-Adresse ist */
export function ipKind(text: string): 'IPv4' | 'IPv6' | null {
  const s = text.trim()
  if (isIpv4(s)) return 'IPv4'
  if (s.includes(':') && isIpv6(s)) return 'IPv6'
  return null
}

/** Fehlermeldung für die Eingabe, sonst null */
export function ipProblem(text: string): string | null {
  const s = text.trim()
  if (!s) return tr('Bitte eine IP-Adresse eingeben.', 'Please enter an IP address.')
  if (/\s/.test(s)) return tr('In der Adresse steckt ein Leerzeichen. Bitte nur eine Adresse eingeben.', 'The address contains a space. Please enter one address only.')
  if (s.includes('/')) return tr('Bitte die Adresse ohne „/…“ am Ende eingeben.', 'Please enter the address without “/…” at the end.')
  if (ipKind(s)) return null
  return tr(
    'Das ist keine gültige IP-Adresse. Eine IPv4-Adresse sieht so aus: 84.123.45.67 (vier Zahlen von 0 bis 255, mit Punkten). Eine IPv6-Adresse so: 2a02:810d:…',
    'This is not a valid IP address. An IPv4 address looks like 84.123.45.67 (four numbers from 0 to 255, with dots). An IPv6 address looks like 2a02:810d:…',
  )
}

/** Verdeckt: nur der letzte Teil bleibt sichtbar, damit man mehrere Adressen auseinanderhalten kann */
export function maskIp(ip: string): string {
  const s = ip.trim()
  if (ipKind(s) === 'IPv4') return `•••.•••.•••.${s.split('.')[3]}`
  const groups = s.split(':').filter(Boolean)
  return `••••:••••:…:${groups[groups.length - 1] ?? '••••'}`
}

/** Bereinigt eine gespeicherte Liste (z. B. nach dem Entschlüsseln): nur gültige Adressen, ohne doppelte */
export function cleanIps(raw: unknown): HomeIp[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: HomeIp[] = []
  for (const x of raw) {
    const ip = typeof x?.ip === 'string' ? x.ip.trim() : ''
    if (!ipKind(ip) || seen.has(ip.toLowerCase())) continue
    seen.add(ip.toLowerCase())
    const label = typeof x?.label === 'string' && x.label.trim() ? x.label.trim().slice(0, 40) : undefined
    out.push(label ? { ip, label } : { ip })
    if (out.length >= MAX_IPS) break
  }
  return out
}
