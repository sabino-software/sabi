/** Native conversation connections and source badges over ordinary Harness Sessions. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createDotController } from './dot-controller.ts'
import { DotSidebarRow, DotSettingsRow, type DotControlsInjected } from './dot-controls.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { NativeConversationStatus } from '../types.ts'
import { desktopAxiomCompanion } from './desktop-axiom.ts'
import { CodexLibraryPage, CodexLibraryIcon, type NativeConnectionsInjected } from './page.tsx'
import { NativeSourceHeader, NativeSourceRow, type NativeSourceHeaderInjected } from './source-badge.tsx'
import { registerAxiomMessages } from './axiom-messages.tsx'
import { registerCodexActivity } from './codex-activity.tsx'
import { en, zh, pt, type CodexLibraryKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Native conversation connection controls and source identity. */
    codexLibrary: CodexLibraryKey
  }
  interface ResourceProtocolMap {
    /** Current Host connection state, read on explicit refresh. */
    'native-conversation-status': NativeConversationStatus
  }
}

/** Services needed for native connection controls and ordinary Session navigation. */
export const inject = ['slots', 'locale', 'resources', 'remote', 'remote.nativeConversations', 'sessions', 'uiWorkspace', 'uiConversation', 'layout']

function valueOf<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw result.error
  return result.value
}

/**
 * Register connection controls and source badges without a separate history browser.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: Context): void {
  registerAxiomMessages(ctx)
  registerCodexActivity(ctx)
  const panel = 'codex-library' as MainPanelId
  const companion = desktopAxiomCompanion()
  const dot = companion === undefined ? undefined : createDotController(companion, {
    preferredUrl: async () => valueOf(await ctx.remote.nativeConversations.status()).axiom.preferredUrl ?? null,
    connect: async (url, isCurrent) => {
      const result = valueOf(await ctx.remote.nativeConversations.connectAxiom(url))
      await ctx.sessions.refresh()
      if (isCurrent()) ctx.uiWorkspace.openSession(result.sessionId)
    },
  })
  ctx.effect(() => () => { dot?.dispose() }, 'native-conversations.dot-selection')
  const dotInjected = (): DotControlsInjected => ({
    hooks: { dot: dot?.store ?? unavailableDot },
    chooseDot: async () => { await dot?.choose() },
    setDotPreferences: async (preferences) => { await dot?.setPreferences(preferences) },
  })
  const unavailableDot = createSnapshotStore({ preferences: null, busy: false, pending: false, failed: false, preferencesFailed: false })
  if (dot !== undefined) {
    ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
      name: 'sidebar.primary.action', id: 'dot', locale: 'codexLibrary',
      inject: () => ({ ...dotInjected(), chooseDot: async () => {
        ctx.layout.selectPanel(panel)
        await dot.choose()
      } }),
    }, DotSidebarRow))
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item', id: 'dot', order: 20, locale: 'codexLibrary', inject: dotInjected,
    }, DotSettingsRow))
  }
  const t = ctx.locale.bind('codexLibrary')
  ctx.effect(() => ctx.locale.register('codexLibrary', { en, zh, pt, ja: en, es: en, fr: en, de: en, ru: en }), 'native-conversations.copy')
  ctx.effect(() => ctx.resources.register({
    protocol: 'native-conversation-status',
    async *open() { yield await ctx.remote.nativeConversations.status() },
  }), 'native-conversations.status')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panel, locale: 'codexLibrary',
    inject: (): NativeConnectionsInjected => ({
      ...dotInjected(),
      ...companion === undefined ? {} : { axiomCompanion: companion },
      useCodex: async () => { valueOf(await ctx.remote.nativeConversations.useCodex()) },
      startCodexLogin: async () => valueOf(await ctx.remote.nativeConversations.startCodexLogin()),
      cancelCodexLogin: async () => { valueOf(await ctx.remote.nativeConversations.cancelCodexLogin()) },
      syncCodex: async () => {
        const result = valueOf(await ctx.remote.nativeConversations.syncCodex())
        await ctx.sessions.refresh()
        return result
      },
      showAxiomLogin: async () => { valueOf(await ctx.remote.nativeConversations.showAxiomLogin()) },
    }),
  }, CodexLibraryPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panel, order: -20, label: () => t('title'), locale: 'codexLibrary',
  }, CodexLibraryIcon))
  ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
    name: 'sidebar.session.row.trailing', id: 'native-conversation-source', order: -20, locale: 'codexLibrary',
  }, NativeSourceRow))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'native-conversation-source', order: -20, locale: 'codexLibrary',
    inject: (): NativeSourceHeaderInjected => ({
      showOriginal: async () => { valueOf(await ctx.remote.nativeConversations.showAxiomLogin()) },
    }),
  }, NativeSourceHeader))
}
