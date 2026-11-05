import { expect, it } from 'vitest'
import { facetKey, fullMeta, hashStr, normalizeGroupBy } from '../src/hash'

it('normalises the prompt so cosmetic edits do not invalidate the cache', () => {
  expect(normalizeGroupBy('  what they   are\nasking for ')).toBe('what they are asking for')
  expect(normalizeGroupBy(undefined)).toBe('')
  expect(normalizeGroupBy('x'.repeat(500))).toHaveLength(300)
})
it('facet keys depend on both prompt and item, case-insensitively on the prompt', () => {
  expect(facetKey('Emotional tone', 't:abc')).toBe(facetKey('emotional tone', 't:abc'))
  expect(facetKey('emotional tone', 't:abc')).not.toBe(facetKey('who is affected', 't:abc'))
  expect(facetKey('emotional tone', 't:abc')).not.toBe(facetKey('emotional tone', 't:abd'))
  expect(hashStr('a')).not.toBe(hashStr('b'))
})

it('facet keys change when metadata changes (same text, different author)', () => {
  expect(facetKey('author', 't:abc', 'author: A')).not.toBe(facetKey('author', 't:abc', 'author: B'))
  expect(facetKey('author', 't:abc', fullMeta('type: sticky', 'stamp on image: x'))).toBe(facetKey('author', 't:abc', 'type: sticky | stamp on image: x'))
})
