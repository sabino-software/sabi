/** Browse source Codex history through the existing panel and resource registries. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { CodexChatId, CodexChatPage, CodexTranscriptPage } from '../types.ts'
import { CodexLibraryPage, CodexLibraryIcon } from './page.tsx'
import { en, zh, pt, type CodexLibraryKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Existing work chat browser. */
    codexLibrary: CodexLibraryKey
  }
  interface ResourceProtocolMap {
    /** A filtered page of source chats. */
    'codex-chats': CodexChatPage
    /** One bounded transcript page. */
    'codex-transcript': CodexTranscriptPage
  }
}

/** Services needed to register the source browser. */
export const inject = ['slots', 'locale', 'resources', 'remote', 'remote.codexLibrary']

/**
 * Register a main panel, sidebar entry, and lazy read-only resource providers.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: Context): void {
  const panel = 'codex-library' as MainPanelId
  const t = ctx.locale.bind('codexLibrary')
  ctx.effect(() => ctx.locale.register('codexLibrary', { en, zh, pt, ja: en, es: en, fr: en, de: en, ru: en }), 'codex-library.copy')
  ctx.effect(() => ctx.resources.register({
    protocol: 'codex-chats',
    async *open(address, { signal }) {
      const params = new URL(address).searchParams
      yield await ctx.remote.codexLibrary.list({ query: params.get('query') ?? '', archived: params.get('archived') === 'true', cursor: params.get('cursor') }, signal)
    },
  }), 'codex-library.catalog')
  ctx.effect(() => ctx.resources.register({
    protocol: 'codex-transcript',
    async *open(address, { signal }) {
      const params = new URL(address).searchParams
      yield await ctx.remote.codexLibrary.read((params.get('id') ?? '') as CodexChatId, params.get('cursor'), signal)
    },
  }), 'codex-library.transcript')
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, locale: 'codexLibrary' }, CodexLibraryPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panel, order: -20, label: () => t('title'), locale: 'codexLibrary',
  }, CodexLibraryIcon))
}
