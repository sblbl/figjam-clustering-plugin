import { expect, it } from 'vitest'
import { stripStamps } from '../src/main/text'

it('removes name + timestamp but keeps the content', () => {
  expect(stripStamps('Unique creation by\nlocation\n\nTrenton\n2026-11-03 10:41')).toBe('Unique creation by\nlocation')
  expect(stripStamps('Ableton live\n\nTrenton\n2026-11-03 10:24')).toBe('Ableton live')
})
it('a stamp-only text becomes empty', () => {
  expect(stripStamps('matteo\n2026-11-03 11:00')).toBe('')
  expect(stripStamps('Simone 2026-11-03 14:36')).toBe('Simone 2026-11-03 14:36') // one line: not the stamp format
})
it('leaves ordinary text alone', () => {
  expect(stripStamps('How to make something never seen before')).toBe('How to make something never seen before')
})

import { colorName, splitStamps } from '../src/main/text'

it('keeps the stamp as metadata instead of discarding it', () => {
  expect(splitStamps('Ableton live\n\nTrenton\n2026-11-03 10:24')).toEqual({
    text: 'Ableton live',
    stamps: [{ author: 'Trenton', time: '2026-11-03 10:24' }],
  })
})
it('names sticky colours', () => {
  expect(colorName(0.69, 0.92, 0.98)).toBe('light blue')
  expect(colorName(0.98, 0.78, 0.55)).toBe('orange')
})

import { pickAuthors } from '../src/main/text'

it("prefers the name stamped in the text over FigJam's author field", () => {
  expect(pickAuthors(['Amanda'], ['Matteo'])).toEqual(['Amanda'])
  expect(pickAuthors([], ['Matteo'])).toEqual(['Matteo'])
  expect(pickAuthors(['Amanda', 'Amanda', 'jung'], ['Matteo'])).toEqual(['Amanda', 'jung'])
  expect(pickAuthors([], [])).toEqual([])
})
