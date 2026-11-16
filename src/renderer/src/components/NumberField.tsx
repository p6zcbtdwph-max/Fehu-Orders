import { useEffect, useState } from 'react'
import { numberFormat } from '../format'
import { tr } from '@shared/i18n'
import { parseNumber, toInputText } from '@shared/number-format'

/**
 * Zahlenfeld im gewählten Format (Deutsch 1.234,56 oder Amerikanisch 1,234.56).
 * Ist der Text keine gültige Zahl, meldet das Feld NaN: der Plan wird dann ungültig,
 * statt still mit dem alten Wert weiterzurechnen.
 */
export function NumberField({ label, value, onChange, hint, step = 'any', emptyValue }: { label: string; value: number; onChange: (n: number) => void; hint?: string; step?: string; emptyValue?: number }) {
  const fmt = numberFormat()
  // Tausendertrenner wie in der Anzeige, damit Eingabe und Tabelle gleich aussehen (78.467,1)
  const show = (v: number, f = fmt) => toInputText(v, f, true)
  const [text, setText] = useState(show(value))
  const [shownFmt, setShownFmt] = useState(fmt)
  useEffect(() => {
    // Wert kam von außen (Vorlage, Kursvorschlag) oder das Format wurde umgestellt
    if (fmt !== shownFmt) {
      // Text im alten Format lesen und im neuen schreiben; Ungültiges bleibt stehen, damit man es sieht
      const old = parseNumber(text, shownFmt)
      setShownFmt(fmt)
      if (!Number.isNaN(old)) setText(show(old))
      else if (!Number.isNaN(parseNumber(text, fmt))) onChange(parseNumber(text, fmt)) // war ungültig, passt aber zum neuen Format
      return
    }
    const parsed = parseNumber(text, fmt)
    if (text.trim() !== '' && !Number.isNaN(parsed) && parsed !== value && Number.isFinite(value)) setText(show(value))
  }, [value, fmt])
  const invalid = text.trim() !== '' && Number.isNaN(parseNumber(text, fmt))
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className={`input w-full tabular-nums ${invalid ? 'border-danger-500' : ''}`} inputMode="decimal" step={step} value={text} aria-invalid={invalid}
        onChange={(e) => {
          setText(e.target.value)
          const n = parseNumber(e.target.value, fmt)
          onChange(e.target.value.trim() === '' && emptyValue !== undefined ? emptyValue : n)
        }}
        onBlur={() => {
          // leer → letzten Wert zeigen; gültig → einheitlich mit Tausendertrennern schreiben
          if (text.trim() === '' && Number.isFinite(value)) setText(show(value))
          else if (!Number.isNaN(parseNumber(text, fmt))) setText(show(parseNumber(text, fmt)))
        }} />
      {invalid
        ? <span className="mt-1 block text-xs text-danger-fg">{tr(
          `Keine gültige Zahl. Gewählt ist das ${fmt === 'de' ? 'deutsche Format, z. B. 60.000,50' : 'amerikanische Format, z. B. 60,000.50'} (umstellen links unten bei „Zahlenformat“).`,
          `Not a valid number. The ${fmt === 'de' ? 'German format is selected, e.g. 60.000,50' : 'US format is selected, e.g. 60,000.50'} (change it bottom left under “Number format”).`,
        )}</span>
        : hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  )
}
