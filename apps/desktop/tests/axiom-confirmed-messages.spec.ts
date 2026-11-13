/** Only current source rows can recover an ACK-confirmed body omitted by background layout. */
import { expect, it } from 'vitest'
import { AxiomConfirmedMessages } from '../src/axiom-confirmed-messages.ts'
import type { AxiomPageState } from '../src/axiom-page.ts'
import type { AxiomMessage } from '../src/axiom-protocol.ts'

const user = 'fixture~CalpicoMessage~Sentinel_user'
const reply = 'fixture~CalpicoMessage~Sentinel_reply'
const message = (id: string, text: string): AxiomMessage => ({ id, text, role: 'assistant', timestamp: null, truncated: false })
const observation = (messages: readonly AxiomMessage[], sourceOrder?: readonly string[]): AxiomPageState => ({
  url: 'https://chatgpt.com/dots/fixture~conversation', title: 'Fixture', messages,
  ...sourceOrder === undefined ? {} : { sourceOrder }, composer: true, draft: '', sendPresent: true,
  sendEnabled: false, siteStatus: null, limited: false,
})

it('recovers a newly confirmed user before its reply only when the original row order includes it', () => {
  const confirmed = new AxiomConfirmedMessages()
  const state = observation([message(reply, 'Original reply')], [user, reply])
  expect(confirmed.project(state)).toBe(state)
  confirmed.record(user, '*Authored* _literal_ [text] `code` \\ | ~ < >')
  expect(confirmed.project(state).messages).toEqual([
    { id: user, role: 'user', text: '\\*Authored\\* \\_literal\\_ \\[text\\] \\`code\\` \\\\ \\| \\~ \\< \\>',
      timestamp: null, truncated: false },
    message(reply, 'Original reply'),
  ])
  expect(confirmed.project(observation([message(reply, 'Reply')])).messages).toEqual([message(reply, 'Reply')])
  expect(confirmed.project(observation([message(reply, 'Reply')], [reply])).messages).toEqual([message(reply, 'Reply')])
})

it('deduplicates canonical IDs, preserves repeated authored messages, and prefers actual source bodies', () => {
  const confirmed = new AxiomConfirmedMessages()
  confirmed.record(user, 'Repeated text')
  confirmed.record(user, 'Repeated text')
  confirmed.record('another-user', 'Repeated text')
  const actual = { ...message(user, 'Actual **source** formatting'), role: 'user' as const, timestamp: '2026-11-01T10:00:00Z' }
  expect(confirmed.project(observation([actual, message(reply, 'Reply')], [user, 'another-user', reply])).messages)
    .toEqual([actual, { ...message('another-user', 'Repeated text'), role: 'user' }, message(reply, 'Reply')])
})

it('bounds recovered and existing bodies together newest first and marks partial older bodies', () => {
  const confirmed = new AxiomConfirmedMessages()
  confirmed.record(user, '*'.repeat(40000))
  const older = message('older', 'o'.repeat(32768))
  const incoming = ['a', 'b', 'c'].map(id => message(id, id.repeat(32768)))
  const state = confirmed.project(observation([older, ...incoming, message(reply, 'reply')], ['older', user, 'a', 'b', 'c', reply]))
  expect(state.messages.map(body => body.id)).toEqual([user, 'a', 'b', 'c', reply])
  expect(state.messages[0]).toMatchObject({ text: '\\*'.repeat(16381) + '\\', truncated: true })
  expect(state.messages.every(body => body.text.length <= 32768)).toBe(true)
  expect(state.messages.reduce((sum, body) => sum + body.text.length, 0)).toBe(131072)
  expect(state.limited).toBe(true)
})

it('retains at most the newest 100 ACK-confirmed bodies and revokes all on clear', () => {
  const confirmed = new AxiomConfirmedMessages()
  for (let index = 0; index <= 100; index++) confirmed.record(`user-${index}`, `Text ${index}`)
  const state = observation([], ['user-0', 'user-1', 'user-100'])
  expect(confirmed.project(state).messages.map(body => body.id)).toEqual(['user-1', 'user-100'])
  confirmed.clear()
  expect(confirmed.project(state)).toBe(state)
})
