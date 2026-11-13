/** Original source order and identity, rather than Harness turn anchors, determine Dot chronology. */
import { expect, it } from 'vitest'
import { mergeDotMessages } from '../src/client/dot-history.ts'
import type { DotMessage } from '../src/client/desktop-axiom.ts'
const message = (id: string, text = id): DotMessage => ({ id, text, role: 'assistant', timestamp: null, truncated: false })
it('repairs source-window chronology, deduplicates overlap, and updates a source body in place', () => {
  const merged = mergeDotMessages([message('a'), message('u')], [message('u'), message('a', 'updated'), message('next')], 'live')
  expect(merged.map(value => value.id)).toEqual(['u', 'a', 'next'])
  expect(merged[1]?.text).toBe('updated')
})
it('prepends older pages and preserves newer observed content for overlapping source IDs', () => {
  const merged = mergeDotMessages([message('a', 'latest'), message('b')], [message('old'), message('a', 'stale')], 'older')
  expect(merged.map(value => value.id)).toEqual(['old', 'a', 'b'])
  expect(merged[1]?.text).toBe('latest')
})
it('keeps temporarily omitted original bodies between overlapping source anchors', () => {
  const merged = mergeDotMessages(['a', 'b', 'c', 'd'].map(value => message(value)), [message('b', 'updated'), message('d')], 'live')
  expect(merged.map(value => value.id)).toEqual(['a', 'b', 'c', 'd'])
  expect(merged[1]?.text).toBe('updated')
})
