/** Persistent source binding, separate from the original conversation store. */
import { z } from 'zod'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { appendPluginRecord, pluginRecordOf, SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { NativeCodexCut, NativeConversationBinding, NativeConversationId } from './types.ts'

/** Record owned by this experimental integration; old readers may ignore it. */
export const BINDING_RECORD = 'plugin:native-conversations/bound'
/** Validates stored source metadata at the record boundary. */
export const bindingSchema: z.ZodType<NativeConversationBinding> = z.object({
  source: z.enum(['codex', 'axiom']),
  sourceId: z.string().min(1).transform(value => brandString<NativeConversationId>(value)),
  title: z.string(), model: z.string().nullable(), cwd: z.string().nullable(),
}).strict()

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Source chosen when an ordinary native Session was created. */
    'plugin:native-conversations/bound': NativeConversationBinding
  }
}

/** Summary-visible source metadata; ephemeral activity stays in the ordinary Session controls. */
export const nativeConversationProjection = {
  key: 'nativeConversation', stateVersion: 1, stateSchema: bindingSchema.nullable(),
  init: () => null,
  apply: (state, event) => {
    const record = pluginRecordOf(event)
    if (record?.type !== BINDING_RECORD) return state
    return bindingSchema.parse(record.data)
  },
  wire: { viewSchema: bindingSchema.nullable(), view: state => state },
} satisfies ProjectionDefinition<'nativeConversation', NativeConversationBinding | null>

/** Host-only binding ownership; a copied binding cannot authorize continuing its parent. */
export const nativeBindingSequenceProjection = {
  key: 'nativeBindingSequence', stateVersion: 1,
  stateSchema: z.number().int().nonnegative().transform(SessionSeq).nullable(),
  init: () => null,
  apply: (state, event) => pluginRecordOf(event)?.type === BINDING_RECORD ? event.seq : state,
} satisfies ProjectionDefinition<'nativeBindingSequence', SessionSeq | null>

/** Durable marker for a verified completed boundary in the original Codex thread. */
export const CODEX_CUT_RECORD = 'plugin:native-conversations/codex-cut'
const cutSchema: z.ZodType<NativeCodexCut> = z.object({
  sourceId: z.string().min(1).transform(value => brandString<NativeConversationId>(value)), turnId: z.string().min(1),
}).strict()
/** Private current cut plus its position; no history-sized index or client payload. */
export interface NativeCodexCutState extends NativeCodexCut {
  readonly seq: SessionSeq
  readonly lastEvidenceSeq: SessionSeq | null
  readonly inheritedPartial: boolean
}
/** Host projection of the latest verified source cut and any subsequent inherited evidence. */
export const nativeCodexCutProjection = {
  key: 'nativeCodexCut', stateVersion: 2,
  stateSchema: z.object({
    sourceId: z.string().min(1).transform(value => brandString<NativeConversationId>(value)),
    turnId: z.string().min(1), seq: z.number().int().nonnegative().transform(SessionSeq),
    lastEvidenceSeq: z.number().int().nonnegative().transform(SessionSeq).nullable(), inheritedPartial: z.boolean(),
  }).strict().nullable(),
  init: () => null,
  apply: (state, event) => {
    const record = pluginRecordOf(event)
    // Every new binding is an explicit ownership boundary. Its source must establish its own completed cut.
    if (record?.type === BINDING_RECORD) return null
    if (record?.type === CODEX_CUT_RECORD) return {
      ...cutSchema.parse(record.data), seq: event.seq, lastEvidenceSeq: null, inheritedPartial: state?.inheritedPartial ?? false,
    }
    if (state === null) return state
    if (event.type === 'session/end-seed' && event.data.inherited === true) {
      return { ...state, inheritedPartial: state.inheritedPartial
        || state.lastEvidenceSeq !== null && state.lastEvidenceSeq > state.seq }
    }
    if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/call'
      || event.type === 'tool/result' || record?.type === 'plugin:native-conversations/codex-activity') {
      return { ...state, lastEvidenceSeq: event.seq }
    }
    return state
  },
} satisfies ProjectionDefinition<'nativeCodexCut', NativeCodexCutState | null>

/**
 * Append a verified completed source boundary to its owning local Session.
 * @param session - Owning Session.
 * @param cut - Verified original boundary.
 */
export function appendCodexCut(session: Session, cut: NativeCodexCut): void {
  appendPluginRecord(session, CODEX_CUT_RECORD, cutSchema.parse(cut))
}

/** Current admitted input identities, never a second transcript or full-history reader. */
export interface NativeStepInputState {
  readonly turn: number
  readonly step: number
  readonly open: boolean
  readonly ids: readonly MessageId[]
}
/** Host registration belongs to NativeConversations before it exposes adapters or opens Sessions. */
export const nativeStepInputProjection = {
  key: 'nativeStepInput', stateVersion: 1,
  stateSchema: z.object({ turn: z.number().int().nonnegative(), step: z.number().int().nonnegative(),
    open: z.boolean(), ids: z.array(z.string().min(1).transform(MessageId)).readonly(),
  }).strict(),
  init: (): NativeStepInputState => ({ turn: 0, step: 0, open: false, ids: [] }),
  apply: (state, event) => {
    if (event.type === 'step/start') return { ...event.data, open: true, ids: [] }
    if (event.type === 'user/message' && state.open) return { ...state, ids: [...state.ids, event.data.id] }
    if ((event.type === 'step/end' || event.type === 'turn/end') && state.open) return { ...state, open: false, ids: [] }
    return state
  },
} satisfies ProjectionDefinition<'nativeStepInput', NativeStepInputState>

/**
 * Read admitted input identities only for the currently open matching request position.
 * @param state - Current projected boundary.
 * @param position - The committed request position.
 * @returns Matching admitted IDs, or an empty list outside that open step.
 */
export function admittedNativeInputIds(
  state: NativeStepInputState, position: { readonly turn: number; readonly step: number },
): readonly MessageId[] {
  return state.open && state.turn === position.turn && state.step === position.step ? state.ids : []
}
