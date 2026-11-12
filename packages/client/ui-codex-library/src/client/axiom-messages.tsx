/** Updateable original Axiom assistant messages through the existing Conversation node outlet. */
import { useMemo, type ReactNode } from 'react'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { NativeAxiomMessage } from '@deepseek-ai/dsh-native-conversations/types'
import { en, zh, pt, type AxiomMessageKey } from './axiom-locales.ts'
import css from './axiom-messages.module.css'

const RECORD = 'plugin:native-conversations/axiom-message'
const KIND = 'native-axiom-message'
const messageSchema: z.ZodType<NativeAxiomMessage> = z.object({
  id: z.string().min(1).max(512), text: z.string().max(32768),
  timestamp: z.string().max(100).nullable(), truncated: z.boolean(),
}).strict()

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Latest original-site assistant body, without a model-generation completion claim. */
    'native-axiom-message': NativeAxiomMessage
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Original-source assistant message controls. */
    nativeAxiom: AxiomMessageKey
  }
}

interface MessageState {
  readonly message: NativeAxiomMessage
  readonly anchorSeq: number
}

function messageOf(event: SessionEventLike): NativeAxiomMessage | undefined {
  const envelope: { type: string; ignorable?: unknown; data: unknown } = event
  if (envelope.type !== RECORD || envelope.ignorable !== true) return undefined
  const parsed = messageSchema.safeParse(envelope.data)
  return parsed.success ? parsed.data : undefined
}

/** One persistent source message id owns one node, including later whole-body edits. */
export const axiomMessageDefinition: ConversationNodeDefinition<MessageState> = {
  kind: KIND,
  target: 'chat',
  match: (event) => {
    const message = messageOf(event)
    return message === undefined ? null : { id: message.id, role: 'start' }
  },
  start: (_context, match) => ({ message: messageSchema.parse(match.event.data), anchorSeq: match.event.seq }),
  update: (context, match) => {
    const message = messageSchema.parse(match.event.data)
    const prior = context.state.message
    return message.text === prior.text && message.timestamp === prior.timestamp && message.truncated === prior.truncated
      ? context.state : { message, anchorSeq: context.state.anchorSeq }
  },
  publication: () => 'animation-frame',
  buildViewNode: (context): ChatConversationViewNode | null => context.state === undefined ? null : {
    key: context.key, id: context.id, kind: KIND, target: 'chat',
    anchorSeq: context.state.anchorSeq, location: { kind: 'session' },
    visibility: context.state.message.text === '' ? 'hidden' : 'visible', data: context.state.message,
  },
}

type MessageProps = PropsRuntime<'conversation.chat.node', 'native-axiom-message'> & PropsLocale<'nativeAxiom'>

/**
 * Render original prose with the normal assistant Markdown primitive and typography.
 * @param props Source-owned node and localized Markdown controls.
 * @returns The observed body; later records can replace it without claiming completion.
 */
export function NativeAxiomMessageView({ node, t }: MessageProps): ReactNode {
  const labels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: {
      codeLabel: t('codeLabel'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap'),
    } }, footnotes: t('footnotes'),
  }), [t])
  const timestamp = node.data.timestamp === null ? Number.NaN : Date.parse(node.data.timestamp)
  return <div className={css.body} data-native-axiom-message={node.data.id}>
    <MarkdownText text={node.data.text} labels={labels} omitHtml omitImages />
    {Number.isFinite(timestamp) && <time className={css.timestamp} dateTime={new Date(timestamp).toISOString()}>
      {new Date(timestamp).toLocaleString()}
    </time>}
    {node.data.truncated && <p role="note">{t('sourceTruncated')}</p>}
  </div>
}

/**
 * Register source-message assembly and rendering with the existing Chat view.
 * @param ctx Owning native-conversation UI context.
 */
export function registerAxiomMessages(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('nativeAxiom', { en, zh, pt, ja: en, es: en, fr: en, de: en, ru: en }), 'native-conversations.axiom-copy')
  ctx.uiConversation.events.register({
    ...axiomMessageDefinition,
    match: { [RECORD]: event => axiomMessageDefinition.match(event) },
  })
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: KIND, locale: 'nativeAxiom',
  }, NativeAxiomMessageView))
}
