// Attrappe für das Electron-Modul in Tests (Ablage im Temp-Ordner, IPC-Handler zum direkten Aufrufen)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const dir = mkdtempSync(join(tmpdir(), 'fehu-'))
export const handlers = new Map<string, (...a: any[]) => any>()
export const electronMock = {
  app: { getPath: () => dir, whenReady: () => new Promise(() => {}), on: () => {} },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  ipcMain: { handle: (ch: string, fn: any) => handlers.set(ch, fn) },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: {}, Notification: class { static isSupported() { return false } }, session: {}, shell: {},
  systemPreferences: { canPromptTouchID: () => false },
}
/** Ruft einen IPC-Handler so auf, als käme der Aufruf aus dem App-Fenster */
export const call = (ch: string, ...args: any[]) => handlers.get(ch)!({ senderFrame: { url: OWN_URL } }, ...args)
/** Adresse des eigenen Fensters (gebaute index.html neben dem Hauptprozess) */
export const OWN_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href
/** Ruft einen IPC-Handler so auf, als käme der Aufruf von einer fremden Seite */
export const callFrom = (url: string, ch: string, ...args: any[]) => handlers.get(ch)!({ senderFrame: { url } }, ...args)
