import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../shared/i18n'
import { explainError } from './kraken'

afterEach(() => setLang('de'))

describe('Kraken-Fehler auf Englisch', () => {
  it('übersetzt Fehlercodes in die gewählte Sprache', () => {
    expect(explainError('EOrder:Insufficient funds')).toBe('Nicht genug Guthaben.')
    setLang('en')
    expect(explainError('EGeneral:Permission denied')).toMatch(/^The API key is missing a permission/)
    expect(explainError('EOrder:Insufficient funds')).toBe('Insufficient funds.')
  })
})
