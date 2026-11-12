/** Native engine operations use the ordinary Conversation Definition and keyed renderer seams. */
import type { Context } from '@deepseek-ai/cordis'
import { useState } from 'react'
import { DisclosureRow, MarkdownText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { NativeCodexActivity } from '@deepseek-ai/dsh-native-conversations/types'
import { en, zh, ja, es, fr, de, ru, pt, type CodexActivityKey } from './codex-activity-locales.ts'
import css from './codex-activity.module.css'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** An operation performed by the source Codex engine, outside the Harness executor. */
    'native-codex-activity': NativeCodexActivity
  }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Native source activity cards. */
    nativeCodexActivity: CodexActivityKey
  }
}

function activityOf(event: SessionEventLike): NativeCodexActivity | undefined {
  // Ignorable plugin records intentionally remain outside the released SessionEvent discriminant table.
  const envelope: { readonly type: string; readonly data: unknown; readonly ignorable?: true } = event
  if (envelope.type !== 'plugin:native-conversations/codex-activity' || envelope.ignorable !== true) return undefined
  const value = envelope.data
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  if (!('id' in value && typeof value.id === 'string' && value.id.length > 0
    && 'type' in value && typeof value.type === 'string' && value.type.length > 0
    && 'label' in value && typeof value.label === 'string' && value.label.length > 0
    && 'phase' in value && (value.phase === 'started' || value.phase === 'completed')
    && 'detail' in value && (value.detail === null || typeof value.detail === 'string'))) return undefined
  return { id: value.id, type: value.type, label: value.label, phase: value.phase, detail: value.detail }
}

/** One id retains its earliest loaded anchor even when only completion is available in a paged window. */
export const codexActivityDefinition: ConversationNodeDefinition<NativeCodexActivity> = {
  kind: 'native-codex-activity', target: 'chat',
  match: (event) => {
    const activity = activityOf(event)
    // Every record may initialize a partial window; later starts update the same business id.
    return activity === undefined ? null : { id: activity.id, role: 'start', exclusive: true }
  },
  start: (_context, match) => {
    const activity = activityOf(match.event)
    if (activity === undefined) throw new Error('Native Codex activity start requires a validated source record')
    return activity
  },
  update: (context, match) => activityOf(match.event) ?? context.state,
  buildViewNode: (context) => {
    if (context.state === undefined || context.start === undefined) return null
    return { key: context.key, kind: 'native-codex-activity', id: context.id, target: 'chat',
      anchorSeq: context.start.event.seq, location: context.start.location, visibility: 'visible', data: context.state,
    } satisfies ChatNode<'native-codex-activity'>
  },
}

export type CodexActivityCardProps = PropsRuntime<'conversation.chat.node', 'native-codex-activity'> & PropsLocale<'nativeCodexActivity'>

/** Show original source and lifecycle without claiming the native operation succeeded. */
export function CodexActivityCard({ node, t }: CodexActivityCardProps) {
  const [open, setOpen] = useState(false)
  const { label, phase, detail, type } = node.data
  const running = phase === 'started'
  return <section className={css.card} data-native-codex-activity={node.id} data-activity-type={type} data-phase={phase}>
    <DisclosureRow title={label} icon={<StateDot state={running ? 'ongoing' : 'idle'} />} running={running}
      open={open} expandable={detail !== null && detail.length > 0} onToggle={() => { setOpen(value => !value) }} expandOnRowClick
      headerAccessory={<span className={css.status}>{t('source')} · {t(phase)}</span>}>
      {detail !== null && <div className={css.detail}><MarkdownText text={detail} variant="compact" omitHtml omitImages
        labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} /></div>}
    </DisclosureRow>
  </section>
}

/** @param ctx - Client owner with uiConversation, slots, and locale dependencies. */
export function registerCodexActivity(ctx: Context): void {
  ctx.uiConversation.events.register(codexActivityDefinition)
  ctx.effect(() => ctx.locale.register('nativeCodexActivity', { en, zh, ja, es, fr, de, ru, pt }), 'native-codex-activity: dictionaries')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'native-codex-activity', locale: 'nativeCodexActivity',
  }, CodexActivityCard))
}
