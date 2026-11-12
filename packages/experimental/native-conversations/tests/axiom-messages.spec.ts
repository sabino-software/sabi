/** Whole-message source updates retain one host-only identity and clear on rebinding. */
import { expect, it } from 'vitest'
import { appendPluginRecord, Session, SessionId } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import { appendAxiomMessage, axiomMessagesProjection } from '../src/axiom-messages.ts'
import type { NativeConversationBinding, NativeConversationId } from '../src/types.ts'

function binding(sourceId: string): NativeConversationBinding {
  return { source: 'axiom', sourceId: brandString<NativeConversationId>(sourceId), title: 'Original Axiom', model: null, cwd: null }
}
function fold(session: Session) {
  return session.snapshotEvents().reduce((state, event) => axiomMessagesProjection.apply(state, event), axiomMessagesProjection.init())
}

it('retains original ids and updates text in place without putting source bodies on the wire', () => {
  const session = Session.create(SessionId('original-axiom-updates'))
  appendPluginRecord(session, 'plugin:native-conversations/bound', binding('first-original'))
  const first = { id: 'original-assistant-id', text: 'Early body', timestamp: null, truncated: false }
  appendAxiomMessage(session, first)
  const initial = fold(session)
  appendAxiomMessage(session, first)
  const repeated = axiomMessagesProjection.apply(initial, session.snapshotEvents().at(-1)!)
  expect(repeated).toBe(initial)
  appendAxiomMessage(session, { ...first, text: 'Later edited original body' })
  const changed = axiomMessagesProjection.apply(repeated, session.snapshotEvents().at(-1)!)
  expect(Object.keys(changed.byId)).toEqual(['original-assistant-id'])
  expect(changed.byId['original-assistant-id']?.text).toBe('Later edited original body')
  expect(axiomMessagesProjection.stateSchema.parse(changed)).toEqual(changed)
  expect('wire' in axiomMessagesProjection).toBe(false)
})

it('clears source bodies when the original conversation changes', () => {
  const session = Session.create(SessionId('original-axiom-rebinding'))
  appendPluginRecord(session, 'plugin:native-conversations/bound', binding('first-original'))
  appendAxiomMessage(session, { id: 'old-id', text: 'First original source', timestamp: null, truncated: false })
  appendPluginRecord(session, 'plugin:native-conversations/bound', binding('second-original'))
  expect(fold(session)).toEqual({ sourceId: 'second-original', byId: {} })
})
