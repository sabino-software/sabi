// @vitest-environment jsdom
/** Original message edits preserve one Conversation node and use the shared assistant Markdown primitive. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { appendPluginRecord, Session, SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationNodeContext, ConversationStartMatch } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { axiomMessageDefinition, NativeAxiomMessageView, registerAxiomMessages } from '../src/client/axiom-messages.tsx'
import { en } from '../src/client/axiom-locales.ts'

afterEach(cleanup)

type State = ReturnType<typeof axiomMessageDefinition.start>

it('folds subsequent whole-body records into the same original-id node and keeps its first anchor', () => {
  const session = Session.create(SessionId('axiom-node-fixture'))
  const message = { id: 'original-assistant-id', text: 'First visible body', timestamp: null, truncated: false }
  appendPluginRecord(session, 'plugin:native-conversations/axiom-message', message)
  const first: ConversationStartMatch = { event: session.snapshotEvents().at(-1)!, role: 'start', location: { kind: 'session' } }
  expect(axiomMessageDefinition.match(first.event)).toEqual({ id: message.id, role: 'start' })
  const context: ConversationNodeContext<State> = {
    key: `native-axiom-message:${message.id}`, kind: 'native-axiom-message', id: message.id,
    matches: [first], start: first, state: undefined, current: new Map(),
  }
  const initial = axiomMessageDefinition.start(context, first, { previous: () => undefined })
  appendPluginRecord(session, 'plugin:native-conversations/axiom-message', { ...message, text: 'Later genuine edited body' })
  const next: ConversationStartMatch = { event: session.snapshotEvents().at(-1)!, role: 'start', location: { kind: 'session' } }
  const changed = axiomMessageDefinition.update({ ...context, state: initial }, next)
  const node = axiomMessageDefinition.buildViewNode!({ ...context, matches: [first, next], state: changed }) as ChatConversationViewNode
  expect(node.key).toBe(context.key)
  expect(node.id).toBe(message.id)
  expect(node.anchorSeq).toBe(first.event.seq)
  expect(node.location).toEqual({ kind: 'session' })
  expect(node.data).toEqual({ ...message, text: 'Later genuine edited body' })
})

it('renders and replaces genuine prose with shared Markdown while keeping HTML and remote images inert', () => {
  type Props = Parameters<typeof NativeAxiomMessageView>[0]
  const node = {
    key: 'original-assistant', id: 'original-assistant', kind: 'native-axiom-message' as const, target: 'chat' as const,
    anchorSeq: 1, location: { kind: 'session' as const }, visibility: 'visible' as const,
    data: { id: 'original-assistant', text: '**Observed** source ![diagram](https://example.com/tracker.png)<script>bad()</script>', timestamp: null, truncated: false },
  }
  const props = { node, t: makeTranslate(en) } as Props
  const view = render(<NativeAxiomMessageView {...props} />)
  expect(screen.getByText('Observed').tagName).toBe('STRONG')
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.querySelector('script')).toBeNull()
  view.rerender(<NativeAxiomMessageView {...{ ...props, node: { ...node, data: { ...node.data, text: 'Later **source** edit' } } } as Props} />)
  expect(view.container.querySelectorAll('[data-native-axiom-message]')).toHaveLength(1)
  expect(view.container.textContent).toBe('Later source edit')
})

it('removes the source definition, renderer, and locale together when its plugin unloads', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SlotRegistry)
  const definitions = new Set<string>()
  const dictionaries = new Set<string>()
  ctx.provide('uiConversation', { events: { register: (definition: { kind: string }) => {
    definitions.add(definition.kind)
    return () => { definitions.delete(definition.kind) }
  } } } as never)
  ctx.provide('locale', { register: (name: string) => {
    dictionaries.add(name)
    return () => { dictionaries.delete(name) }
  } } as never)
  ctx.slots.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } }, () => null)
  const fiber = ctx.plugin({ inject: ['slots', 'locale', 'uiConversation'], apply: registerAxiomMessages })
  await fiber.await()
  expect(ctx.slots.entriesOfSlot('conversation.chat.node')).toHaveLength(1)
  expect([...definitions]).toEqual(['native-axiom-message'])
  expect([...dictionaries]).toEqual(['nativeAxiom'])
  await fiber.dispose()
  expect(ctx.slots.entriesOfSlot('conversation.chat.node')).toHaveLength(0)
  expect(definitions.size).toBe(0)
  expect(dictionaries.size).toBe(0)
})
