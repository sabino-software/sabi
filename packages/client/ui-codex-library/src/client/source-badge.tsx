/** Source identity on the normal Session row and conversation header. */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-native-conversations/types'
import css from './page.module.css'

type RowProps = PropsRuntime<'sidebar.session.row.trailing'> & PropsLocale<'codexLibrary'>
type HeaderProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'codexLibrary'>

/**
 * Render source identity without activating the listed Session.
 * @param props - Listed Session identity, catalog selector, and localized labels.
 * @returns The source badge, or nothing for an ordinary Harness Session.
 */
export function NativeSourceRow({ sessionId, useSessions, t }: RowProps): ReactNode {
  const binding = useSessions(state => state.byId[sessionId]?.projectionValues?.nativeConversation)
  if (binding == null || binding.source !== 'codex') return null
  const label = t('sourceCodex')
  return <span className={css.sourceBadge} aria-label={label}
    title={t('sourceCodexHint')}>{label}</span>
}

/**
 * Name the original execution source beside the native conversation title.
 * @param props - Scoped projection hook and localized Codex source labels.
 * @returns The Codex source label; Dot never contributes a normal Session action.
 */
export function NativeSourceHeader({ useProjection, t }: HeaderProps): ReactNode {
  const binding = useProjection('nativeConversation')
  if (binding == null || binding.source !== 'codex') return null
  return <>
    <span className={css.headerBadge}
      title={t('sourceCodexHint')}>
      {t('sourceCodex')}
    </span>
  </>
}
