import { describe, expect, it } from 'vitest'
import { parseRoute, tabForRoute } from './tabs.ts'

describe('parseRoute', () => {
  it('reads tabs and the istatistik route', () => {
    expect(parseRoute('#/okuma')).toBe('okuma')
    expect(parseRoute('#konusma')).toBe('konusma')
    expect(parseRoute('#/istatistik')).toBe('istatistik')
  })
  it('falls back to bugun', () => {
    expect(parseRoute('')).toBe('bugun')
    expect(parseRoute('#/nope')).toBe('bugun')
  })
})

describe('tabForRoute', () => {
  it('keeps Bugun active on istatistik', () => {
    expect(tabForRoute('istatistik')).toBe('bugun')
    expect(tabForRoute('kelime')).toBe('kelime')
  })
})
