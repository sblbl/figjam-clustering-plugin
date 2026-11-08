import { expect, it } from 'vitest'
import { judgeKey } from '../src/hash'
import { parseVerdicts, topicTitle } from '../src/ui/judge'

it('reads verdicts and treats anything missing or malformed as no match', () => {
  expect(parseVerdicts('{"items":[{"i":0,"match":true},{"i":2,"match":true},{"i":1,"match":false}]}', 3)).toEqual([true, false, true])
  expect(parseVerdicts('{"items":[{"i":0,"match":"yes"},{"i":9,"match":true},{"i":-1,"match":true}]}', 2)).toEqual([false, false])
  expect(parseVerdicts('not json', 2)).toEqual([false, false])
  expect(parseVerdicts('{}', 2)).toEqual([false, false])
})

it('titles the frame with the first line of the topic, shortened', () => {
  expect(topicTitle('  how the audience   takes part\nand more detail')).toBe('how the audience takes part')
  expect(topicTitle('x'.repeat(100))).toHaveLength(58)
})

it('verdict keys depend on topic, item and metadata', () => {
  expect(judgeKey('Audience', 't:a', 'm')).toBe(judgeKey('audience', 't:a', 'm'))
  expect(judgeKey('audience', 't:a', 'm')).not.toBe(judgeKey('audience', 't:a', 'n'))
  expect(judgeKey('audience', 't:a')).not.toBe(judgeKey('robots', 't:a'))
})
