import { describe, expect, it } from 'vitest'
import { MESSAGE_CODES } from '../core/messages'
import { DICTS, translate } from './index'

describe('i18n dictionary', () => {
  it('has the same keys in every language', () => {
    const reference = Object.keys(DICTS.en).sort()
    for (const lang of ['en', 'ru'] as const) {
      expect(Object.keys(DICTS[lang]).sort(), `language ${lang}`).toEqual(reference)
    }
  })

  it('translates every core message code', () => {
    for (const code of MESSAGE_CODES) {
      for (const lang of ['en', 'ru'] as const) {
        const text = DICTS[lang][code]
        expect(text, `${lang}:${code}`).toBeTruthy()
      }
    }
  })

  it('fills parameters and keeps unknown placeholders', () => {
    expect(translate('en', 'parse.notice.inferredCounts', { x: 11, y: 11 })).toContain('11 × 11')
    expect(translate('ru', 'parse.error.profileNotFound', { name: 'x', available: 'a, b' })).toContain('«x»')
    expect(translate('en', 'heatmap.hover', { x: 1 })).toContain('{y}')
  })

  it('falls back to the key for unknown strings', () => {
    expect(translate('ru', 'no.such.key')).toBe('no.such.key')
  })
})
