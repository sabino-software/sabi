/** Source identity on the normal Session row and conversation header. */
import { useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-native-conversations/types'
import css from './page.module.css'

type RowProps = PropsRuntime<'sidebar.session.row.trailing'> & PropsLocale<'codexLibrary'>
/** Host-owned action for revealing the dedicated original ChatGPT page. */
export interface NativeSourceHeaderInjected {
  /** Reveal the original page for login or direct interaction without passing browser credentials. */
  showOriginal(this: void): Promise<void>
}

type HeaderProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'codexLibrary'> & InjectFace<NativeSourceHeaderInjected>

function OpenOriginal({ showOriginal, t }: Pick<HeaderProps, 'showOriginal' | 't'>): ReactNode {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const open = async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try { await showOriginal() }
    catch (_unavailableOriginal: unknown) { setFailed(true) }
    finally { setBusy(false) }
  }
  return <>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => { void open() }}>
      {t(busy ? 'openingOriginal' : 'openOriginal')}
    </Button>
    {failed && <span role="alert">{t('openOriginalError')}</span>}
  </>
}

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
 * @param props - Scoped projection hook, localized labels, and Host-owned original-page callback.
 * @returns The source label and Axiom original-page action, or nothing for an unbound Session.
 */
export function NativeSourceHeader({ useProjection, t, showOriginal }: HeaderProps): ReactNode {
  const binding = useProjection('nativeConversation')
  if (binding == null) return null
  return <>
    <span className={css.headerBadge}
      title={t(binding.source === 'codex' ? 'sourceCodexHint' : 'sourceAxiomHint')}>
      {t(binding.source === 'codex' ? 'sourceCodex' : 'sourceAxiom')}
    </span>
    {binding.source === 'axiom' && <OpenOriginal key={binding.sourceId} showOriginal={showOriginal} t={t} />}
  </>
}
