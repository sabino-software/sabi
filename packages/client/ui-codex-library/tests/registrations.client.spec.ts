/** Unloading the feature removes both navigation entries and lazy source providers. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { en, type CodexLibraryKey } from '../src/client/locales.ts'

describe('Codex library registrations', () => {
  it('removes its main panel, sidebar entry, resource providers, and copy on unload', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SlotRegistry)
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
    ctx.provide('remote', { codexLibrary: {} } as never)
    ctx.provide('remote.codexLibrary', {} as never)
    ctx.slots.register({ name: 'root', children: {
      main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' },
    } }, ({ renderSlot }: { renderSlot: unknown }) => { void renderSlot; return null })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entriesOfSlot('main')).toHaveLength(1)
    expect(ctx.slots.entriesOfSlot('sidebar.panellist')).toHaveLength(1)
    expect([...providers.keys()].sort()).toEqual(['codex-chats', 'codex-transcript'])
    expect(dictionaries.has('codexLibrary')).toBe(true)
    await fiber.dispose()
    expect(ctx.slots.entriesOfSlot('main')).toHaveLength(0)
    expect(ctx.slots.entriesOfSlot('sidebar.panellist')).toHaveLength(0)
    expect(providers.size).toBe(0)
    expect(dictionaries.size).toBe(0)
  })
})
