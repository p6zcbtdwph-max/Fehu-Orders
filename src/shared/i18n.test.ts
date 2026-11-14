import { afterEach, describe, expect, it } from 'vitest'
import { lang, langFromLocale, setLang, tr } from './i18n'
import { checkKeyFormat, priceGuard } from './safety'
import { buildLadder } from './ladder'
import { NUMBER_FORMATS } from './number-format'

afterEach(() => setLang('de'))

describe('Sprache', () => {
  it('Deutsch ist Standard, Englisch umschaltbar', () => {
    expect(lang()).toBe('de')
    expect(tr('Speichern', 'Save')).toBe('Speichern')
    setLang('en')
    expect(tr('Speichern', 'Save')).toBe('Save')
    setLang('xx' as never)
    expect(lang()).toBe('de')
  })

  it('Systemsprache: nur Deutsch wird Deutsch', () => {
    expect(langFromLocale('de-DE')).toBe('de')
    expect(langFromLocale('de_AT')).toBe('de')
    expect(langFromLocale('de')).toBe('de')
    expect(langFromLocale('en-US')).toBe('en')
    expect(langFromLocale('fr')).toBe('en')
    expect(langFromLocale(undefined)).toBe('en')
  })

  it('Meldungen aus Rechenkern, Schlüsselprüfung und Kraken kommen auf Englisch', () => {
    setLang('en')
    expect(checkKeyFormat('a'.repeat(56), 'a'.repeat(56))[0]).toMatch(/identical/)
    expect(priceGuard('buy', [110], 100)).toMatch(/^The price is currently 100\. 1 level is at or above/)
    const l = buildLadder({ side: 'buy', priceStart: 0, priceEnd: 0, steps: 2, total: 10, spacing: 'linear', curve: 'flat', ratio: 1 }, { priceDecimals: 2, volumeDecimals: 8, orderMin: 0.0001, costMin: 0.5, tickSize: 0.01 } as never)
    expect(l.errors).toContain('Prices must be greater than 0.')
    expect(NUMBER_FORMATS().map((f) => f.label)).toEqual(['German', 'US'])
  })
})
