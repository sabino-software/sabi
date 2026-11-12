/** Source identity on the normal Session row and conversation header. */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-experimental-native-conversations/types'
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
  if (binding == null) return null
  const label = t(binding.source === 'codex' ? 'sourceCodex' : 'sourceAxiom')
  return <span className={css.sourceBadge} aria-label={label}
    title={t(binding.source === 'codex' ? 'sourceCodexHint' : 'sourceAxiomHint')}>{label}</span>
}

/**
 * Name the original execution source beside the native conversation title.
 * @param props - Scoped projection hook and localized labels.
 * @returns The source label, or nothing when no native source is bound.
 */
export function NativeSourceHeader({ useProjection, t }: HeaderProps): ReactNode {
  const binding = useProjection('nativeConversation')
  if (binding == null) return null
  return <span className={css.headerBadge}
    title={t(binding.source === 'codex' ? 'sourceCodexHint' : 'sourceAxiomHint')}>
    {t(binding.source === 'codex' ? 'sourceCodex' : 'sourceAxiom')}
  </span>
}
