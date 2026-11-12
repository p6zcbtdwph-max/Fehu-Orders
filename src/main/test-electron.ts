// Attrappe für das Electron-Modul in Tests (Ablage im Temp-Ordner, IPC-Handler zum direkten Aufrufen)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
export const call = (ch: string, ...args: any[]) => handlers.get(ch)!({ senderFrame: { url: 'file:///app/index.html' } }, ...args)
