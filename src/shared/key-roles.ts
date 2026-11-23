// Zwei Schlüssel je Börse: ein Nur-Lese-Schlüssel, der dauerhaft bleiben darf, und ein Handels-Schlüssel,
// der nur gebraucht wird, wenn wirklich gesendet wird. Rein, ohne Netz, damit es testbar ist.
import { tr } from './i18n'
import type { KeyCheck } from './ipc'
import type { ExchangeId } from './exchanges'

/** read = nur ansehen (Guthaben, Orders), trade = auch Orders anlegen */
export type KeyRole = 'read' | 'trade'
export const KEY_ROLES: KeyRole[] = ['read', 'trade']
export const isKeyRole = (x: unknown): x is KeyRole => x === 'read' || x === 'trade'

/**
 * Wie lange die App den Handels-Schlüssel behält:
 * keep = verschlüsselt im Schlüsselbund (wie bisher), session = nur im Arbeitsspeicher bis die App schließt,
 * once = nur im Arbeitsspeicher und nach dem nächsten echten Senden sofort vergessen
 */
export type TradeKeyMode = 'keep' | 'session' | 'once'
export const TRADE_KEY_MODES: TradeKeyMode[] = ['keep', 'session', 'once']
export const isTradeKeyMode = (x: unknown): x is TradeKeyMode => x === 'keep' || x === 'session' || x === 'once'

/** Welche Schlüssel einer Börse da sind. tradeTemporary: Handels-Schlüssel liegt nur im Arbeitsspeicher. */
export interface KeyRoles {
  read: boolean
  trade: boolean
  tradeTemporary: boolean
}

/** Ein Schlüssel wird gespeichert, wenn jedes Pflicht-Recht stimmt. Empfehlungen (required: false) dürfen fehlen. */
export const checksPass = (checks: KeyCheck[]): boolean => checks.every((c) => c.ok || !c.required)

/** Diese Prüfungen der Börsen bedeuten „darf Orders anlegen“ */
const TRADE_IDS = new Set(['create', 'trade'])

/**
 * Macht aus der Rechte-Prüfung (die immer fragt: darf der Schlüssel handeln?) die Prüfung für einen Nur-Lese-Schlüssel.
 * - Ansehen muss gehen.
 * - Handeln darf NICHT gehen. Sonst wäre es kein Nur-Lese-Schlüssel, und er wird nicht als solcher gespeichert.
 * - Stornieren (nur Kraken kann das getrennt) ist erlaubt und empfohlen: dann funktioniert die Notbremse auch ohne Handels-Schlüssel.
 * - Auszahlen darf nie gehen, wie beim Handels-Schlüssel.
 */
export function readChecks(checks: KeyCheck[], exchange: ExchangeId): KeyCheck[] {
  return checks.map((c): KeyCheck => {
    if (TRADE_IDS.has(c.id)) {
      return {
        id: 'no-trade', label: tr('Darf keine Orders anlegen', 'Cannot place orders'), exchangeLabel: c.exchangeLabel, required: true, ok: !c.ok,
        ...(c.ok ? { detail: tr(`Dieser Schlüssel darf handeln. Für den Nur-Lese-Schlüssel nimm bitte das Häkchen „${c.exchangeLabel}“ raus, oder speichere ihn oben als Handels-Schlüssel.`, `This key can trade. For the read-only key please untick “${c.exchangeLabel}”, or save it as the trading key above.`) } : {}),
      }
    }
    if (c.id === 'cancel' && exchange === 'kraken') {
      return {
        ...c, required: false,
        label: tr('Orders stornieren (empfohlen)', 'Cancel orders (recommended)'),
        detail: c.ok
          ? tr('Gut: Die Notbremse funktioniert damit auch, wenn kein Handels-Schlüssel da ist.', 'Good: the emergency stop then works even without a trading key.')
          : tr('Ohne dieses Recht braucht die Notbremse den Handels-Schlüssel. Stornieren kostet nie Geld, deshalb ist es hier unbedenklich.', 'Without this permission the emergency stop needs the trading key. Cancelling never costs money, so it is harmless here.'),
      }
    }
    return c
  })
}

/** Kann der Nur-Lese-Schlüssel dieser Börse auch stornieren (nur Kraken trennt das Recht)? */
export const readKeyCanCancel = (exchange: ExchangeId): boolean => exchange === 'kraken'

export const roleName = (role: KeyRole): string => (role === 'read' ? tr('Nur-Lese-Schlüssel', 'Read-only key') : tr('Handels-Schlüssel', 'Trading key'))

export const modeLabel = (m: TradeKeyMode): string => ({
  keep: tr('Dauerhaft speichern', 'Keep stored'),
  session: tr('Bis die App schließt', 'Until the app closes'),
  once: tr('Nur für eine Sendung', 'For one send only'),
})[m]

export const modeText = (m: TradeKeyMode): string => ({
  keep: tr('Der Handels-Schlüssel liegt verschlüsselt im macOS-Schlüsselbund, wie bisher. Am bequemsten.', 'The trading key is stored encrypted in the macOS keychain, as before. Most convenient.'),
  session: tr('Der Handels-Schlüssel kommt nie auf die Festplatte. Er bleibt nur im Arbeitsspeicher, bis du die App schließt. Danach fügst du ihn wieder ein.', 'The trading key never touches the disk. It only stays in memory until you close the app. After that you paste it again.'),
  once: tr('Wie „Bis die App schließt“, aber direkt nach dem nächsten echten Senden vergisst die App ihn. Am sichersten, aber du fügst ihn vor jeder Sendung neu ein.', 'Like “Until the app closes”, but the app forgets it right after the next real send. Safest, but you paste it before every send.'),
})[m]

/** Meldung, wenn zum Senden der Handels-Schlüssel fehlt */
export const needTradeKeyText = (exchangeName: string): string => tr(
  `Für ${exchangeName} ist gerade kein Handels-Schlüssel da, deshalb wurde nichts gesendet. Füge ihn unter Einstellungen › Börsen und Schlüssel › Handels-Schlüssel ein und sende dann noch einmal.`,
  `There is no trading key for ${exchangeName} right now, so nothing was sent. Paste it under Settings › Exchanges and keys › Trading key and send again.`,
)
