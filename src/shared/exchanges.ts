// Welche Börsen die App kennt, mit allem, was Fenster und Hauptprozess über sie wissen müssen:
// Name, Link zur Schlüssel-Seite und welche Häkchen beim API-Schlüssel gesetzt sein sollen.
// Texte immer erst beim Aufruf übersetzen (tr), nie auf Modulebene.
import { tr } from './i18n'

export type ExchangeId = 'kraken' | 'bitvavo' | 'coinbase'

export const EXCHANGE_IDS: ExchangeId[] = ['kraken', 'bitvavo', 'coinbase']

export const isExchangeId = (x: unknown): x is ExchangeId => typeof x === 'string' && (EXCHANGE_IDS as string[]).includes(x)

/** Ein Häkchen beim Anlegen des Schlüssels: englischer Name bei der Börse, deutsche Bedeutung, an oder aus */
export interface PermissionRow {
  /** So heißt es bei der Börse (meist Englisch) */
  exchange: string
  /** Deutsche Bedeutung */
  de: string
  on: boolean
  why: string
  danger?: boolean
}

export interface ExchangeMeta {
  id: ExchangeId
  name: string
  /** Sitz und Aufsicht, kurz */
  origin: string
  /** Seite, auf der man den API-Schlüssel anlegt */
  apiUrl: string
  /** Prüft die Börse beim Probelauf selbst (true) oder nur die App (false)? */
  serverValidate: boolean
  /** Kann die App selbst feststellen, dass der Schlüssel kein Geld abheben darf? */
  withdrawAutoCheck: boolean
  /** Bezeichnungen der beiden Felder beim Einfügen */
  keyLabel: string
  secretLabel: string
  keyPlaceholder: string
  secretPlaceholder: string
  /** Mehrzeiliges Geheimnis (Coinbase: PEM-Block) */
  secretMultiline: boolean
  /** So heißt das Auszahlungsrecht bei der Börse */
  withdrawLabel: string
  permissions: PermissionRow[]
  /** Bei welchem Schritt (ab 0) die Tabelle mit den Häkchen steht */
  permissionsStep: number
  /** Schritte zum Anlegen des Schlüssels */
  steps: { title: string; text: string }[]
}

export function exchangeMeta(id: ExchangeId): ExchangeMeta {
  const never = tr('Niemals! Damit könnte man Geld von deinem Konto abheben.', 'Never! It would allow money to be withdrawn from your account.')
  const notNeeded = tr('Nicht nötig', 'Not needed')
  switch (id) {
    case 'bitvavo':
      return {
        id, name: 'Bitvavo', origin: tr('Niederlande, von der niederländischen Aufsicht (AFM) nach MiCA zugelassen', 'Netherlands, licensed under MiCA by the Dutch regulator (AFM)'),
        apiUrl: 'https://account.bitvavo.com/user/api',
        serverValidate: false, withdrawAutoCheck: false,
        keyLabel: tr('API-Schlüssel (API key)', 'API key'), secretLabel: tr('Geheimer Schlüssel (API secret)', 'API secret'),
        keyPlaceholder: tr('64 Zeichen', '64 characters'), secretPlaceholder: tr('128 Zeichen, der längere', '128 characters, the longer one'),
        secretMultiline: false, withdrawLabel: 'Withdraw', permissionsStep: 2,
        permissions: [
          { exchange: 'View', de: tr('Ansehen (Guthaben und Orders)', 'View (balances and orders)'), on: true, why: tr('Guthaben, offene Orders und Ausführungen anzeigen', 'Show balances, open orders and fills') },
          { exchange: 'Trade', de: tr('Handeln (Orders anlegen und stornieren)', 'Trade (place and cancel orders)'), on: true, why: tr('Orders anlegen und stornieren', 'Place and cancel orders') },
          { exchange: 'Withdraw', de: tr('Auszahlen', 'Withdraw'), on: false, why: never, danger: true },
        ],
        steps: [
          { title: tr('Bei Bitvavo anmelden', 'Log in to Bitvavo'), text: tr('Im Browser (nicht in der Handy-App) unter Einstellungen › API die API-Seite öffnen.', 'In the browser (not the phone app), open Settings › API.') },
          { title: tr('Neuen Schlüssel anlegen', 'Create a new key'), text: tr('„API-Schlüssel anfordern“ (Request API key) und als Namen Fehu Orders eintragen.', 'Click “Request API key” and enter Fehu Orders as the name.') },
          { title: tr('Genau diese Rechte wählen', 'Pick exactly these permissions'), text: tr('Siehe Tabelle. Bei Bitvavo können die Namen leicht anders lauten, gemeint sind Ansehen, Handeln und Auszahlen.', 'See the table. Bitvavo may word them slightly differently: view, trade and withdraw.') },
          { title: tr('Per E-Mail bestätigen', 'Confirm by e-mail'), text: tr('Bitvavo schickt eine Bestätigungs-Mail. Erst danach ist der Schlüssel aktiv.', 'Bitvavo sends a confirmation e-mail. The key only works after you confirm it.') },
          { title: tr('Beide Teile kopieren', 'Copy both parts'), text: tr('Den geheimen Schlüssel (secret) zeigt Bitvavo nur einmal. Schick ihn niemandem, auch nicht per Chat oder Mail.', 'Bitvavo shows the secret only once. Never send it to anyone, not even by chat or e-mail.') },
          { title: tr('Unten einfügen und bestätigen', 'Paste below and confirm'), text: tr('Bitvavo verrät der App nicht, ob der Schlüssel Geld abheben darf. Deshalb bestätigst du selbst mit einem Häkchen, dass „Withdraw“ aus ist.', 'Bitvavo does not tell the app whether the key may withdraw money. So you confirm yourself with a tick that “Withdraw” is off.') },
        ],
      }
    case 'coinbase':
      return {
        id, name: 'Coinbase', origin: tr('USA, in der EU über Coinbase Europe (Irland) nach MiCA zugelassen', 'USA, licensed in the EU under MiCA via Coinbase Europe (Ireland)'),
        apiUrl: 'https://portal.cdp.coinbase.com/projects/api-keys',
        serverValidate: true, withdrawAutoCheck: true,
        keyLabel: tr('Schlüssel-Name (API key name)', 'API key name'), secretLabel: tr('Privater Schlüssel (private key)', 'Private key'),
        keyPlaceholder: 'organizations/…/apiKeys/…', secretPlaceholder: '-----BEGIN EC PRIVATE KEY----- …',
        secretMultiline: true, withdrawLabel: 'Transfer', permissionsStep: 1,
        permissions: [
          { exchange: 'View', de: tr('Ansehen (Guthaben und Orders)', 'View (balances and orders)'), on: true, why: tr('Guthaben, offene Orders und Ausführungen anzeigen', 'Show balances, open orders and fills') },
          { exchange: 'Trade', de: tr('Handeln (Orders anlegen und stornieren)', 'Trade (place and cancel orders)'), on: true, why: tr('Orders anlegen, Probelauf und stornieren', 'Place orders, test run and cancel') },
          { exchange: 'Transfer', de: tr('Überweisen (Ein- und Auszahlungen)', 'Transfer (deposits and withdrawals)'), on: false, why: never, danger: true },
        ],
        steps: [
          { title: tr('Coinbase-Entwicklerportal öffnen', 'Open the Coinbase developer portal'), text: tr('Mit deinem normalen Coinbase-Konto anmelden. Die Schlüssel für den Handel heißen dort „Secret API Keys“.', 'Log in with your normal Coinbase account. Trading keys are called “Secret API Keys” there.') },
          { title: tr('Neuen Schlüssel anlegen', 'Create a new key'), text: tr('„Create API key“, als Namen Fehu Orders. Bei den Rechten (API restrictions / Permissions) nur View und Trade.', 'Click “Create API key”, name it Fehu Orders. For permissions pick only View and Trade.') },
          { title: tr('Wichtig: ECDSA wählen', 'Important: choose ECDSA'), text: tr('Unter „Advanced Settings“ beim Signatur-Verfahren (Signature algorithm) ECDSA wählen, nicht Ed25519. Ed25519 funktioniert für den Handel nicht.', 'Under “Advanced Settings”, choose ECDSA as the signature algorithm, not Ed25519. Ed25519 does not work for trading.') },
          { title: tr('Schlüssel herunterladen oder kopieren', 'Download or copy the key'), text: tr('Coinbase zeigt den Namen (beginnt mit organizations/…) und den privaten Schlüssel (beginnt mit -----BEGIN EC PRIVATE KEY-----) nur einmal. Du kannst auch den ganzen Inhalt der heruntergeladenen Datei in das Feld „Privater Schlüssel“ einfügen.', 'Coinbase shows the name (starts with organizations/…) and the private key (starts with -----BEGIN EC PRIVATE KEY-----) only once. You can also paste the whole content of the downloaded file into the “Private key” field.') },
          { title: tr('Unten einfügen und prüfen', 'Paste below and check'), text: tr('Die App fragt bei Coinbase nach, welche Rechte der Schlüssel hat. Ein Schlüssel mit „Transfer“ wird nicht gespeichert.', 'The app asks Coinbase which permissions the key has. A key with “Transfer” is not saved.') },
        ],
      }
    default:
      return {
        id: 'kraken', name: 'Kraken', origin: tr('USA, in der EU über Payward Europe (Irland) nach MiCA zugelassen', 'USA, licensed in the EU under MiCA via Payward Europe (Ireland)'),
        apiUrl: 'https://pro.kraken.com/app/settings/api',
        serverValidate: true, withdrawAutoCheck: true,
        keyLabel: tr('API-Schlüssel (API Key)', 'API key'), secretLabel: tr('Privater Schlüssel (Private Key)', 'Private key'),
        keyPlaceholder: tr('der kürzere der beiden', 'the shorter one'), secretPlaceholder: tr('der längere, endet meist auf ==', 'the longer one, usually ends in =='),
        secretMultiline: false, withdrawLabel: 'Withdraw Funds', permissionsStep: 2,
        permissions: [
          { exchange: 'Query Funds', de: tr('Guthaben abfragen', 'Query funds'), on: true, why: tr('Guthaben anzeigen und vor dem Senden prüfen', 'Show balances and check them before sending') },
          { exchange: 'Deposit Funds', de: tr('Einzahlen', 'Deposit'), on: false, why: notNeeded },
          { exchange: 'Withdraw Funds', de: tr('Geld abheben', 'Withdraw'), on: false, why: never, danger: true },
          { exchange: 'Query Open Orders & Trades', de: tr('Offene Orders abfragen', 'Query open orders'), on: true, why: tr('Offene Orders anzeigen', 'Show open orders') },
          { exchange: 'Query Closed Orders & Trades', de: tr('Geschlossene Orders abfragen', 'Query closed orders'), on: true, why: tr('Ausführungen und Durchschnittspreis anzeigen', 'Show fills and average price') },
          { exchange: 'Create & Modify Orders', de: tr('Orders erstellen und ändern', 'Create and modify orders'), on: true, why: tr('Orders anlegen und Probelauf', 'Place orders and test run') },
          { exchange: 'Cancel & Close Orders', de: tr('Orders stornieren', 'Cancel orders'), on: true, why: tr('Pläne und Orders stornieren', 'Cancel plans and orders') },
          { exchange: tr('Alle übrigen (Ledger, Export, WebSocket, Earn …)', 'All others (Ledger, Export, WebSocket, Earn …)'), de: tr('alles andere', 'everything else'), on: false, why: notNeeded },
        ],
        steps: [
          { title: tr('Bei Kraken anmelden', 'Log in to Kraken'), text: tr('Die API-Einstellungen öffnen: Einstellungen › API (oder „Verbindungen & API“).', 'Open the API settings: Settings › API (or “Connections & API”).') },
          { title: tr('Neuen Schlüssel erstellen', 'Create a new key'), text: tr('„Create API key“ und als Namen Fehu Orders eintragen. So erkennst du ihn später wieder.', 'Click “Create API key” and enter Fehu Orders as the name, so you recognise it later.') },
          { title: tr('Genau diese Häkchen setzen', 'Tick exactly these boxes'), text: tr('Siehe Tabelle.', 'See the table.') },
          { title: tr('Alles andere so lassen', 'Leave everything else as is'), text: tr('Nonce Window, IP-Beschränkung, Ablaufdatum brauchst du für den Anfang nicht. Die IP-Beschränkung kannst du später als Profi-Schutz einrichten, siehe unten.', 'You do not need Nonce Window, IP restriction or expiry date for now. You can add the IP restriction later as extra protection, see below.') },
          { title: tr('Erstellen und beide Schlüssel kopieren', 'Create and copy both keys'), text: tr('Kraken zeigt den privaten Schlüssel nur einmal. Schick ihn niemandem, auch nicht per Chat oder Mail, und speichere ihn nicht in Notizen.', 'Kraken shows the private key only once. Never send it to anyone, not even by chat or e-mail, and do not keep it in notes.') },
          { title: tr('Unten einfügen und „Prüfen und speichern“', 'Paste below and click “Check and save”'), text: tr('Die App prüft jedes Recht einzeln. Ein Schlüssel, der Geld abheben darf, wird nicht gespeichert.', 'The app checks every permission. A key that can withdraw money is not saved.') },
        ],
      }
  }
}

export const exchangeName = (id: ExchangeId | undefined): string => exchangeMeta(id ?? 'kraken').name

/** Pläne und Entwürfe ohne Börse stammen aus der Zeit, als es nur Kraken gab */
export const exchangeOf = (x: { exchange?: ExchangeId } | null | undefined): ExchangeId => x?.exchange ?? 'kraken'

/**
 * Höchstbetrag für die allerersten echten Orders auf einer Börse. Bis dort ein Plan erfolgreich angelegt wurde,
 * gilt höchstens dieser Betrag, auch wenn die Obergrenze in den Einstellungen höher steht.
 */
export const FIRST_TEST_MAX_EUR = 50

/** Grenze für eine Sendung: die eigene Obergrenze, beim ersten Test auf einer Börse höchstens 50 € */
export function sendLimit(maxPlanEur: number, firstOnExchange: boolean): number {
  return firstOnExchange ? Math.min(maxPlanEur, FIRST_TEST_MAX_EUR) : maxPlanEur
}

// Modulwert für die aktive Börse, wie bei der Sprache. Das Fenster setzt ihn vor jedem Zeichnen.
let active: ExchangeId = 'kraken'
export const setActiveExchange = (id: ExchangeId): void => { active = isExchangeId(id) ? id : 'kraken' }
export const activeExchange = (): ExchangeId => active
/** Name der aktiven Börse für Texte wie „An Kraken senden“ */
export const exName = (): string => exchangeName(active)

/** Wer prüft beim Probelauf? Kraken und Coinbase prüfen selbst, bei Bitvavo prüft die App. */
export const probeHint = (): string => exchangeMeta(active).serverValidate
  ? tr(`${exName()} prüft alle Orders, legt aber nichts an`, `${exName()} checks all orders but places nothing`)
  : tr(`Die App prüft alle Orders und dein Guthaben (${exName()} hat keinen eigenen Probelauf). Es wird nichts angelegt`, `The app checks all orders and your balance (${exName()} has no test mode of its own). Nothing is placed`)

/** Erfolgsmeldung nach dem Probelauf */
export const probeOk = (n: number): string => exchangeMeta(active).serverValidate
  ? tr(`Probelauf erfolgreich: ${exName()} würde alle ${n} Orders annehmen. Es wurde nichts angelegt.`, `Test run passed: ${exName()} would accept all ${n} orders. Nothing was placed.`)
  : tr(`Probelauf erfolgreich: Alle ${n} Orders passen zu den Regeln von ${exName()} und dein Guthaben reicht. Es wurde nichts angelegt.`, `Test run passed: all ${n} orders match ${exName()}’s rules and your balance is enough. Nothing was placed.`)
