// Datensicherung: Pläne, Entwürfe, Vorlagen, Einstellungen, Protokoll in einer Datei.
// Der API-Schlüssel kommt nie hinein. Rein, ohne Dateizugriff, damit es testbar ist.

export const BACKUP_APP = 'fehu-orders'
export const BACKUP_VERSION = 1

export interface BackupData {
  app: typeof BACKUP_APP
  version: number
  createdAt: string
  settings: Record<string, unknown>
  plans: unknown[]
  drafts: unknown[]
  templates: unknown[]
  log: unknown[]
  notified: string[]
}

export interface BackupSummary {
  createdAt: string
  plans: number
  drafts: number
  templates: number
  log: number
}

/** Wörter, die nie in einer Sicherung stehen dürfen */
const FORBIDDEN = ['secret', 'apiKey', 'privateKey', 'API-Sign']

/** Prüft eine eingelesene Sicherung. Wirft eine verständliche Meldung, wenn die Datei nicht passt. */
export function parseBackup(text: string): BackupData {
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Die Datei ist keine Fehu-Orders-Sicherung (kein gültiges Format).')
  }
  if (raw?.app !== BACKUP_APP) throw new Error('Die Datei ist keine Fehu-Orders-Sicherung.')
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) throw new Error('Diese Sicherung stammt aus einer neueren App-Version. Bitte zuerst die App aktualisieren.')
  const arr = (x: unknown) => (Array.isArray(x) ? x : [])
  const data: BackupData = {
    app: BACKUP_APP,
    version: raw.version,
    createdAt: String(raw.createdAt ?? ''),
    settings: raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings : {},
    plans: arr(raw.plans).filter((p: any) => typeof p?.userref === 'number' && typeof p?.pairId === 'string'),
    drafts: arr(raw.drafts).filter((d: any) => typeof d?.id === 'string' && typeof d?.pairId === 'string' && d?.input),
    templates: arr(raw.templates).filter((t: any) => typeof t?.id === 'string' && t?.input),
    log: arr(raw.log).filter((e: any) => typeof e?.at === 'string' && typeof e?.action === 'string'),
    notified: arr(raw.notified).filter((x: unknown): x is string => typeof x === 'string'),
  }
  return data
}

export function makeBackup(parts: Omit<BackupData, 'app' | 'version' | 'createdAt'>): BackupData {
  const data: BackupData = { app: BACKUP_APP, version: BACKUP_VERSION, createdAt: new Date().toISOString(), ...parts }
  const text = JSON.stringify(data)
  if (FORBIDDEN.some((w) => text.includes(`"${w}"`))) throw new Error('Interner Fehler: Die Sicherung enthielt Schlüsseldaten und wurde nicht geschrieben.')
  return data
}

export function summarize(d: BackupData): BackupSummary {
  return { createdAt: d.createdAt, plans: d.plans.length, drafts: d.drafts.length, templates: d.templates.length, log: d.log.length }
}
