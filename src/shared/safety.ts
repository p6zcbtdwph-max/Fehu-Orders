// Schutz vor typischen Fehlern: Schlüssel falsch kopiert, Preis auf der falschen Seite des Kurses.
// Rein, ohne Netz, damit es testbar ist.
import { tr } from './i18n'
import type { Side } from './ladder'
import type { ExchangeId } from './exchanges'

function base64Bytes(s: string): number | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length % 4 !== 0) return null
  try {
    return atob(s).length
  } catch {
    return null
  }
}

/**
 * Prüft das Format von API-Schlüssel und privatem Schlüssel, bevor etwas an Kraken geht.
 * Krakens privater Schlüssel ist Base64 und 64 Byte lang (88 Zeichen, endet auf ==).
 */
export function checkKeyFormat(key: string, secret: string, exchange: ExchangeId = 'kraken'): string[] {
  if (exchange === 'bitvavo') return checkBitvavoFormat(key, secret)
  if (exchange === 'coinbase') return checkCoinbaseFormat(key, secret)
  const k = key.trim()
  const s = secret.trim()
  const e: string[] = []
  if (!k || !s) return e
  if (/\s/.test(k) || /\s/.test(s)) e.push(tr('Im Schlüssel steckt ein Leerzeichen oder Zeilenumbruch. Kopiere ihn noch einmal am Stück.', 'The key contains a space or line break. Copy it again in one piece.'))
  if (k === s) return [...e, tr('API-Schlüssel und privater Schlüssel sind gleich. Du hast vermutlich zweimal dasselbe eingefügt.', 'API key and private key are identical. You probably pasted the same thing twice.')]
  const kBytes = base64Bytes(k)
  const sBytes = base64Bytes(s)
  if (kBytes === 64 && sBytes !== 64) return [...e, tr('Die beiden Felder sind vermutlich vertauscht: Der lange Schlüssel mit „==“ am Ende gehört ins Feld „Privater Schlüssel“.', 'The two fields are probably swapped: the long key ending in “==” belongs in the “Private key” field.')]
  if (sBytes !== 64) e.push(tr('Der private Schlüssel sieht unvollständig aus. Er ist 88 Zeichen lang und endet meist auf „==“.', 'The private key looks incomplete. It is 88 characters long and usually ends in “==”.'))
  if (k.length < 40) e.push(tr('Der API-Schlüssel ist zu kurz. Kopiere ihn bitte vollständig.', 'The API key is too short. Please copy it completely.'))
  return e
}

const spaceMsg = () => tr('Im Schlüssel steckt ein Leerzeichen oder Zeilenumbruch. Kopiere ihn noch einmal am Stück.', 'The key contains a space or line break. Copy it again in one piece.')
const sameMsg = () => tr('Beide Felder sind gleich. Du hast vermutlich zweimal dasselbe eingefügt.', 'Both fields are identical. You probably pasted the same thing twice.')

/** Bitvavo: API-Schlüssel 64 Zeichen, geheimer Schlüssel 128 Zeichen, beide nur Buchstaben und Ziffern */
function checkBitvavoFormat(key: string, secret: string): string[] {
  const k = key.trim()
  const s = secret.trim()
  const e: string[] = []
  if (!k || !s) return e
  if (/\s/.test(k) || /\s/.test(s)) e.push(spaceMsg())
  if (k === s) return [...e, sameMsg()]
  if (k.length === 128 && s.length === 64) return [...e, tr('Die beiden Felder sind vermutlich vertauscht: Der längere (128 Zeichen) ist der geheime Schlüssel (secret).', 'The two fields are probably swapped: the longer one (128 characters) is the secret.')]
  if (k.length !== 64 || !/^[A-Za-z0-9]+$/.test(k)) e.push(tr('Der API-Schlüssel von Bitvavo ist genau 64 Zeichen lang. Kopiere ihn bitte vollständig.', 'Bitvavo API keys are exactly 64 characters long. Please copy it completely.'))
  if (s.length !== 128 || !/^[A-Za-z0-9]+$/.test(s)) e.push(tr('Der geheime Schlüssel von Bitvavo ist genau 128 Zeichen lang. Kopiere ihn bitte vollständig.', 'Bitvavo secrets are exactly 128 characters long. Please copy it completely.'))
  return e
}

/**
 * Coinbase: Name und privater Schlüssel. Wer die heruntergeladene Datei (JSON) in eines der Felder einfügt,
 * bekommt beides daraus. Wörtliche \n aus der Datei werden zu echten Zeilenumbrüchen.
 */
export function normalizeCoinbase(key: string, secret: string): { key: string; secret: string } {
  const fromJson = (t: string): { key?: string; secret?: string } => {
    try {
      const j = JSON.parse(t.trim())
      return { key: j?.name ?? j?.id ?? j?.keyName, secret: j?.privateKey ?? j?.private_key }
    } catch {
      return {}
    }
  }
  const a = fromJson(secret)
  const b = fromJson(key)
  const k = String(a.key ?? b.key ?? key).trim()
  const s = String(a.secret ?? b.secret ?? secret).replace(/\\n/g, '\n').trim()
  return { key: k, secret: s }
}

function checkCoinbaseFormat(key: string, secret: string): string[] {
  const { key: k, secret: s } = normalizeCoinbase(key, secret)
  const e: string[] = []
  if (!k || !s) return e
  if (/\s/.test(k)) e.push(spaceMsg())
  if (k === s) return [...e, sameMsg()]
  if (k.includes('BEGIN') && !s.includes('BEGIN')) return [...e, tr('Die beiden Felder sind vermutlich vertauscht: Der Block mit „-----BEGIN EC PRIVATE KEY-----“ gehört ins Feld „Privater Schlüssel“.', 'The two fields are probably swapped: the block with “-----BEGIN EC PRIVATE KEY-----” belongs in the “Private key” field.')]
  if (!/^organizations\/[^/\s]+\/apiKeys\/[^/\s]+$/.test(k) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) e.push(tr('Der Schlüssel-Name von Coinbase sieht so aus: organizations/…/apiKeys/…. Kopiere ihn bitte vollständig.', 'Coinbase key names look like organizations/…/apiKeys/…. Please copy it completely.'))
  if (!s.includes('BEGIN')) {
    if (/^[A-Za-z0-9+/]{60,}={0,2}$/.test(s)) e.push(tr('Das ist ein Ed25519-Schlüssel. Für den Handel braucht Coinbase ECDSA. Lege bitte einen neuen Schlüssel an und wähle unter „Advanced Settings“ ECDSA.', 'This is an Ed25519 key. Coinbase needs ECDSA for trading. Please create a new key and choose ECDSA under “Advanced Settings”.'))
    else e.push(tr('Der private Schlüssel beginnt mit „-----BEGIN EC PRIVATE KEY-----“. Kopiere ihn bitte vollständig mit Anfang und Ende.', 'The private key starts with “-----BEGIN EC PRIVATE KEY-----”. Please copy all of it, including start and end.'))
  } else if (!/-----END [A-Z ]*PRIVATE KEY-----/.test(s)) e.push(tr('Das Ende des privaten Schlüssels fehlt („-----END EC PRIVATE KEY-----“).', 'The end of the private key is missing (“-----END EC PRIVATE KEY-----”).'))
  return e
}

/**
 * Stufen, die auf der falschen Seite des aktuellen Kurses liegen:
 * Kauf zum oder über dem Kurs bzw. Verkauf zum oder unter dem Kurs.
 * Solche Orders würden sofort ausgeführt (oder mit Post-only sofort storniert).
 */
export function wrongSide(side: Side, prices: number[], last: number | null | undefined): number[] {
  if (!last || !(last > 0)) return []
  return prices.filter((p) => (side === 'buy' ? p >= last : p <= last))
}

/** Meldung, wenn Stufen nach dem frisch geladenen Kurs auf der falschen Seite liegen (sonst null) */
export function priceGuard(side: Side, prices: number[], last: number, fmt: (n: number) => string = String): string | null {
  const w = wrongSide(side, prices, last)
  if (!w.length) return null
  return tr(
    `Der Kurs steht gerade bei ${fmt(last)}. ${w.length} ${w.length === 1 ? 'Stufe liegt' : 'Stufen liegen'} ${side === 'buy' ? 'beim oder über dem' : 'beim oder unter dem'} Kurs und ${w.length === 1 ? 'würde' : 'würden'} sofort ausgeführt oder storniert. Es wurde nichts gesendet. Passe die Preise an.`,
    `The price is currently ${fmt(last)}. ${w.length} ${w.length === 1 ? 'level is' : 'levels are'} ${side === 'buy' ? 'at or above' : 'at or below'} the price and would be filled or cancelled immediately. Nothing was sent. Please adjust the prices.`,
  )
}

/** Kursalarm: hat der Kurs die erste Stufe erreicht? Kauf: Kurs fällt darauf oder darunter. Verkauf: steigt darauf oder darüber. */
export function alarmHit(side: Side, firstPrice: number, last: number | null | undefined): boolean {
  if (!last || !(last > 0) || !(firstPrice > 0)) return false
  return side === 'buy' ? last <= firstPrice : last >= firstPrice
}

const SUFFIX: Record<string, () => string> = { F: () => tr('Earn (flexibel)', 'Earn (flexible)'), S: () => tr('Earn (gebunden)', 'Earn (bonded)'), M: () => 'Earn', B: () => 'Earn', P: () => 'Earn', HOLD: () => tr('zurückgehalten', 'on hold') }

/**
 * Lesbarer Name eines Kraken-Assets: XXBT → BTC, ZEUR → EUR, XBT.F → BTC (Earn).
 * earn ist gesetzt, wenn das Guthaben nicht im normalen Spot-Konto liegt.
 */
export function assetLabel(code: string): { name: string; earn?: string } {
  const [raw, suffix] = code.split('.')
  let name = raw
  if (name.length === 4 && (name[0] === 'X' || name[0] === 'Z') && !['XTZ', 'ZRX'].some((x) => name.endsWith(x))) name = name.slice(1)
  if (name === 'XBT') name = 'BTC'
  if (name === 'XDG') name = 'DOGE'
  if (name.length > 4 && /^ETH2$/.test(name)) name = 'ETH'
  return suffix ? { name, earn: SUFFIX[suffix]?.() ?? suffix } : { name }
}

/** Vorschlag für den ersten echten Test: zwei kleine Kauf-Stufen 20 % unter dem Kurs, knapp über Krakens Minimum */
export function firstTestInput(last: number, rules: { orderMin: number; costMin: number }): { side: 'buy'; priceStart: number; priceEnd: number; steps: number; total: number; spacing: 'linear'; curve: 'flat'; ratio: number } {
  const priceStart = +(last * 0.8).toPrecision(6)
  const priceEnd = +(last * 0.78).toPrecision(6)
  const perStage = Math.max(rules.orderMin * priceStart * 1.1, rules.costMin * 1.1, 5)
  return { side: 'buy', priceStart, priceEnd, steps: 2, total: Math.ceil(perStage * 2), spacing: 'linear', curve: 'flat', ratio: 1 }
}
