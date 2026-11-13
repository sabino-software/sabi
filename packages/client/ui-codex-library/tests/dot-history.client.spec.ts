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


it('places recovered bodies before an omitted retained row only when the source row order establishes it', () => {
  const existing = ['a', 'd'].map(id => message(id))
  const incoming = ['a', 'b', 'c'].map(id => message(id))
  expect(mergeDotMessages(existing, incoming, 'live', ['a', 'b', 'c', 'd']).map(value => value.id))
    .toEqual(['a', 'b', 'c', 'd'])
  expect(mergeDotMessages(existing, incoming, 'live', ['a', 'd', 'b', 'c']).map(value => value.id))
    .toEqual(['a', 'd', 'b', 'c'])
  expect(mergeDotMessages(existing, incoming, 'live').map(value => value.id)).toEqual(['a', 'd', 'b', 'c'])
})

it('preserves sparse source neighbors through older pages, repeated text, duplicates, and live body updates', () => {
  let rows = mergeDotMessages([], [message('a', 'same'), message('d', 'same')], 'live', ['a', 'b', 'c', 'd'])
  rows = mergeDotMessages(rows, [message('a', 'same'), message('b'), message('c'), message('c', 'duplicate')],
    'live', ['a', 'b', 'c', 'd'])
  rows = mergeDotMessages(rows, [message('p'), message('r')], 'older', ['p', 'q', 'r'])
  rows = mergeDotMessages(rows, [message('q'), message('r')], 'older', ['p', 'q', 'r'])
  rows = mergeDotMessages(rows, [message('d', 'streaming'), message('e')], 'live', ['b', 'c', 'd', 'e'])
  rows = mergeDotMessages(rows, [message('b'), message('d', 'stale')], 'older', ['a', 'b', 'c', 'd'])
  expect(rows.map(value => value.id)).toEqual(['p', 'q', 'r', 'a', 'b', 'c', 'd', 'e'])
  expect(rows.find(value => value.id === 'd')?.text).toBe('streaming')
  expect(rows.find(value => value.id === 'a')?.text).toBe('same')
  expect(rows.find(value => value.id === 'c')?.text).toBe('c')
})
