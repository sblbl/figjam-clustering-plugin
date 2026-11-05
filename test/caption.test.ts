import { expect, it } from 'vitest'
import { parseCaption } from '../src/caption'

it('splits the description from the author stamp', () => {
  expect(parseCaption('A screen showing a festival. Caption: dig shibuya.\nSTAMP: matteo, 2026-11-03 11:00')).toEqual({
    text: 'A screen showing a festival. Caption: dig shibuya.',
    stamp: 'matteo, 2026-11-03 11:00',
  })
})
it('handles no stamp', () => {
  expect(parseCaption('Just a photo.\nSTAMP: none')).toEqual({ text: 'Just a photo.', stamp: '' })
  expect(parseCaption('Just a photo.')).toEqual({ text: 'Just a photo.', stamp: '' })
})
