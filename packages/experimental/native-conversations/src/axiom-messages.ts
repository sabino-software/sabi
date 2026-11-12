/** Original Axiom assistant bodies remain updateable by their source message identities. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { appendPluginRecord, pluginRecordOf, type Session } from '@deepseek-ai/dsh-session'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { NativeConversationId } from './types.ts'
import type { AxiomMessagesState, NativeAxiomMessage } from './axiom-types.ts'
import { BINDING_RECORD, bindingSchema } from './projection.ts'

/** Whole-message updates preserve one source-owned Conversation node. */
export const AXIOM_MESSAGE_RECORD = 'plugin:native-conversations/axiom-message'

const messageSchema: z.ZodType<NativeAxiomMessage> = z.object({
  id: z.string().min(1).max(512), text: z.string().max(32768),
  timestamp: z.string().max(100).nullable(), truncated: z.boolean(),
}).strict()
const stateSchema: z.ZodType<AxiomMessagesState> = z.object({
  sourceId: z.string().transform(value => brandString<NativeConversationId>(value)).nullable(),
  byId: z.record(z.string(), messageSchema),
}).strict()

/**
 * Persist an observed original assistant body without creating a model response.
 * @param session Ordinary Harness Session bound to the original Axiom page.
 * @param message Bounded whole source body with its original site id.
 * @returns The ignorable record's sequence number.
 */
export function appendAxiomMessage(session: Session, message: NativeAxiomMessage): SessionSeq {
  return appendPluginRecord(session, AXIOM_MESSAGE_RECORD, messageSchema.parse(message))
}

/** Latest source bodies for deduplication; omitted from Client wire views and sidebar summaries. */
export const axiomMessagesProjection = {
  key: 'nativeAxiomMessages', stateVersion: 1, stateSchema,
  init: (): AxiomMessagesState => ({ sourceId: null, byId: {} }),
  apply: (state, event) => {
    const record = pluginRecordOf(event)
    if (record?.type === BINDING_RECORD) {
      const binding = bindingSchema.parse(record.data)
      const sourceId = binding.source === 'axiom' ? binding.sourceId : null
      return sourceId === state.sourceId ? state : { sourceId, byId: {} }
    }
    if (record?.type !== AXIOM_MESSAGE_RECORD || state.sourceId === null) return state
    const message = messageSchema.parse(record.data)
    const prior = Object.hasOwn(state.byId, message.id) ? state.byId[message.id] : undefined
    if (prior?.text === message.text && prior.timestamp === message.timestamp && prior.truncated === message.truncated) return state
    return { sourceId: state.sourceId, byId: { ...state.byId, [message.id]: message } }
  },
} satisfies ProjectionDefinition<'nativeAxiomMessages', AxiomMessagesState>
