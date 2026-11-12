/** Feature teardown removes connection navigation, source badges, and its status reader. */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { ConversationEventRegistry } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { en, type CodexLibraryKey } from '../src/client/locales.ts'

/** Preserve the real UiConversation service's caller-context tracing for nested registries. */
class FixtureUiConversation extends Service {
  readonly events: ConversationEventRegistry
  constructor(ctx: Context) {
    super(ctx, 'uiConversation')
    this.events = new ConversationEventRegistry(ctx)
  }
}

describe('Native conversation registrations', () => {
  it('removes its controls, badges, status resource, and copy on unload', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SlotRegistry)
    const { events } = new FixtureUiConversation(ctx)
    const providers = new Map<string, object>()
    const dictionaries = new Map<string, object>()
    ctx.provide('resources', { register: (provider: { protocol: string }) => {
      providers.set(provider.protocol, provider)
      return () => { providers.delete(provider.protocol) }
    } } as never)
    ctx.provide('locale', {
      bind: () => (key: CodexLibraryKey) => en[key],
      register: (namespace: string, copy: object) => {
        dictionaries.set(namespace, copy)
        return () => { dictionaries.delete(namespace) }
      },
    } as never)
    ctx.provide('remote', { nativeConversations: {} } as never)
    ctx.provide('remote.nativeConversations', {} as never)
    ctx.provide('sessions', { refresh: async () => {} } as never)
    ctx.provide('uiWorkspace', { openSession: () => {} } as never)
    ctx.slots.register({ name: 'root', children: {
      main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.session.row.trailing': { kind: 'list', scope: 'root', inline: true },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.chat.node': { kind: 'keyed', scope: 'session', inject: { hooks: {
        turnData: () => { throw new Error('Registration fixture does not render nodes') },
        disclosure: () => { throw new Error('Registration fixture does not render nodes') },
        groupAction: () => { throw new Error('Registration fixture does not render nodes') },
      } } },
    } }, ({ renderSlot }: PropsRenderSlots<'main' | 'sidebar.panellist' | 'sidebar.session.row.trailing' | 'conversation.session.header.actions' | 'conversation.chat.node'>) => {
      void renderSlot
      return null
    })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const name of ['main', 'sidebar.panellist', 'sidebar.session.row.trailing', 'conversation.session.header.actions'] as const) {
      expect(ctx.slots.entriesOfSlot(name)).toHaveLength(1)
    }
    expect([...providers.keys()]).toEqual(['native-conversation-status'])
    expect(ctx.slots.entriesOfSlot('conversation.chat.node')).toHaveLength(2)
    expect(events.entries().map(definition => definition.kind).sort()).toEqual(['native-axiom-message', 'native-codex-activity'])
    expect([...dictionaries.keys()].sort()).toEqual(['codexLibrary', 'nativeAxiom', 'nativeCodexActivity'])
    await fiber.dispose()
    for (const name of ['main', 'sidebar.panellist', 'sidebar.session.row.trailing', 'conversation.session.header.actions'] as const) {
      expect(ctx.slots.entriesOfSlot(name)).toHaveLength(0)
    }
    expect(ctx.slots.entriesOfSlot('conversation.chat.node')).toHaveLength(0)
    expect(events.entries()).toHaveLength(0)
    expect(providers.size).toBe(0)
    expect(dictionaries.size).toBe(0)
  })
})
