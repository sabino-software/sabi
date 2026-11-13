/** Original message ingestion, independent of a live model turn. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { CodexJsonObject } from '@deepseek-ai/dsh-host-codex-app-server'
import { codexItemActivity } from './codex-items.ts'
import type { NativeCodexActivity } from './codex-activity-types.ts'
import { appendCodexCut } from './projection.ts'
import type { NativeConversationId } from './types.ts'

/** A source message is mirrored once; its opaque id never becomes a local authentication fact. */
export interface SourceMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly timestamp?: number | null
}
/** Private ingestion checkpoint, not a sidebar summary or a second transcript API. */
export interface SourceCheckpoint {
  readonly ids: readonly string[]
  readonly hydrated: boolean
  readonly historyLimited: boolean
}
const checkpointSchema: z.ZodType<SourceCheckpoint> = z.object({
  ids: z.array(z.string()), hydrated: z.boolean(), historyLimited: z.boolean(),
}).strict()
/** Durable record of source identities already mirrored into a local Session. */
export const CHECKPOINT_RECORD = 'plugin:native-conversations/checkpoint'
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Original source message identities already mirrored into this Session. */
    'plugin:native-conversations/checkpoint': SourceCheckpoint
  }
}
/** Host projection of mirrored source identities and history completeness. */
export const sourceCheckpointProjection = {
  key: 'nativeConversationCheckpoint', stateVersion: 1, stateSchema: checkpointSchema,
  init: (): SourceCheckpoint => ({ ids: [], hydrated: false, historyLimited: false }),
  apply: (state: SourceCheckpoint, event) => {
    const record = pluginRecordOf(event)
    return record?.type === CHECKPOINT_RECORD ? checkpointSchema.parse(record.data) : state
  },
} satisfies ProjectionDefinition<'nativeConversationCheckpoint', SourceCheckpoint>

/**
 * Derive a stable local identity so catalog refreshes can reuse a Session without opening every log.
 * @param source - Original execution source namespace.
 * @param sourceId - Opaque conversation identity within that source.
 * @returns Deterministic local Session identity for the source conversation.
 */
export function sourceSessionId(source: string, sourceId: string): SessionId {
  return SessionId(`session-${createHash('sha256').update(`${source}\0${sourceId}`).digest('hex').slice(0, 32)}`)
}

/**
 * Append observed text at the next turn supplied by the owning turn-boundary reader.
 * @param session - Local Session receiving completed source messages.
 * @param checkpoint - Previously mirrored message identities and history completeness.
 * @param messages - Observed source messages in chronological order.
 * @param provider - Original execution provider attached to assistant messages.
 * @param model - Original model identity attached to assistant messages.
 * @param historyLimited - Whether the source returned an incomplete history.
 * @param nextTurn - Next available local turn number.
 */
export function appendSourceMessages(
  session: Session, checkpoint: SourceCheckpoint, messages: readonly SourceMessage[],
  provider: string, model: string, historyLimited: boolean, nextTurn: number,
): void {
  const seen = new Set(checkpoint.ids)
  // Imported messages are completed turns outside the live loop. Repeated page ids are ignored.
  let turn = nextTurn
  for (const message of messages) {
    if (seen.has(message.id)) continue
    seen.add(message.id)
    if (!message.text) continue
    session.append('turn/start', { turn })
    const firstSurface = session.surface.nodes.length === 0
    const hasStep = firstSurface || message.role === 'assistant'
    if (hasStep) session.append('step/start', { turn, step: 1 })
    if (firstSurface) reserveSystemHead(session, turn, 1)
    if (message.role === 'user') {
      session.append('user/message', createUserMessage({ content: [{ type: 'text', text: message.text }], source: { kind: 'user' }, authoredAt: message.timestamp ?? null }), { surfaceOp: 'append' })
    } else {
      session.append('assistant/message', {
        turn, step: 1,
        message: createAssistantMessage({ content: [{ type: 'text', text: message.text }], source: { provider, model }, authoredAt: message.timestamp ?? null }),
        stream: [],
      }, { surfaceOp: 'append' })
    }
    if (hasStep) session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
    turn++
  }
  if (!checkpoint.hydrated || checkpoint.historyLimited !== historyLimited || seen.size !== checkpoint.ids.length) {
    appendPluginRecord(session, CHECKPOINT_RECORD, { ids: [...seen], hydrated: true, historyLimited })
  }
}

/** An empty first system surface reserves the framework head without importing unknown source instructions. */
function reserveSystemHead(session: Session, turn: number, step: number): void {
  session.append('system/message', { turn, step, message: createSystemMessage('') }, { surfaceOp: 'append' })
}

const itemSchema = z.object({
  type: z.string(), id: z.string(), text: z.string().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()).optional(),
}).loose()
const pageSchema = z.object({
  data: z.array(z.object({ item: itemSchema, turnId: z.string().optional(),
    startedAtMs: z.number().int().nonnegative().max(8_640_000_000_000_000).nullable().optional(),
  }).loose()),
  nextCursor: z.string().nullable(),
}).loose()
/** One observed source message or inert operation, optionally grouped by its original turn. */
export type SourceHistoryEntry = (
  { readonly kind: 'message'; readonly message: SourceMessage } | { readonly kind: 'activity'; readonly activity: NativeCodexActivity }
) & { readonly sourceTurnId?: string }
/**
 * Parse original item order, including inert source operations; omit excluded in-progress turns until settled.
 * @param value - Original Codex items/list response envelope.
 * @param excludedTurns - Original turn identities to omit from this history page.
 * @returns Ordered source entries and the next page cursor.
 */
export function parseCodexHistoryEntries(
  value: CodexJsonObject, excludedTurns: ReadonlySet<string> = new Set(),
): { entries: SourceHistoryEntry[]; nextCursor: string | null } {
  const page = pageSchema.parse(value)
  const entries: SourceHistoryEntry[] = []
  for (const entry of page.data) {
    if (entry.turnId && excludedTurns.has(entry.turnId)) continue
    const item = entry.item
    const turn = entry.turnId === undefined ? {} : { sourceTurnId: entry.turnId }
    if (item.type === 'agentMessage' && item.text !== undefined) entries.push({ kind: 'message', ...turn, message: { id: item.id, role: 'assistant', text: item.text, timestamp: entry.startedAtMs ?? null } })
    if (item.type === 'userMessage') entries.push({ kind: 'message', ...turn, message: { id: item.id, role: 'user', text: (item.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n'), timestamp: entry.startedAtMs ?? null } })
    if (entry.turnId) {
      const activity = codexItemActivity(item, entry.turnId, 'completed')
      if (activity) entries.push({ kind: 'activity', ...turn, activity })
    }
  }
  return { entries, nextCursor: page.nextCursor }
}

/**
 * Mirror complete original turns only after all item pages have been collected.
 * The cut follows every message/activity and precedes local turn/end, the UI and delegation fork boundary.
 * @param session - Ordinary owning Session.
 * @param checkpoint - Current source identities.
 * @param entries - Complete chronological, settled source history across all pages.
 * @param sourceId - Original Codex thread.
 * @param model - Original model identity.
 * @param nextTurn - Next available Harness turn.
 * @param activity - Ordinary inert activity writer.
 */
export function appendCodexHistoryTurns(
  session: Session, checkpoint: SourceCheckpoint, entries: readonly SourceHistoryEntry[],
  sourceId: NativeConversationId, model: string, nextTurn: number, activity: (value: NativeCodexActivity) => void,
): void {
  const seen = new Set(checkpoint.ids)
  const groups: SourceHistoryEntry[][] = []
  for (const entry of entries) {
    const previous = groups.at(-1)
    if (entry.sourceTurnId !== undefined && previous?.[0]?.sourceTurnId === entry.sourceTurnId) previous.push(entry)
    else groups.push([entry])
  }
  let turn = nextTurn
  for (const group of groups) {
    const sourceTurnId = group[0]?.sourceTurnId
    if (sourceTurnId === undefined) {
      for (const entry of group) {
        if (entry.kind === 'activity') activity(entry.activity)
        else {
          const fresh = !seen.has(entry.message.id)
          appendSourceMessages(session, { ...checkpoint, ids: [...seen] }, [entry.message], 'codex-app-server', model, false, turn)
          seen.add(entry.message.id)
          if (fresh && entry.message.text) turn++
        }
      }
      continue
    }
    const fresh = group.some(entry => entry.kind === 'message' && !seen.has(entry.message.id))
    if (fresh) session.append('turn/start', { turn })
    let step = 0
    let stepOpen = fresh && session.surface.nodes.length === 0
    if (stepOpen) {
      step = 1
      session.append('step/start', { turn, step })
      reserveSystemHead(session, turn, step)
    }
    for (const entry of group) {
      if (entry.kind === 'activity') { activity(entry.activity); continue }
      const message = entry.message
      if (seen.has(message.id)) continue
      seen.add(message.id)
      if (!message.text) continue
      if (message.role === 'user') {
        session.append('user/message', createUserMessage({ content: [{ type: 'text', text: message.text }], source: { kind: 'user' }, authoredAt: message.timestamp ?? null }), { surfaceOp: 'append' })
      } else {
        if (!stepOpen) {
          step++
          session.append('step/start', { turn, step })
        }
        session.append('assistant/message', { turn, step, stream: [],
          message: createAssistantMessage({ content: [{ type: 'text', text: message.text }], source: { provider: 'codex-app-server', model }, authoredAt: message.timestamp ?? null }),
        }, { surfaceOp: 'append' })
        session.append('step/end', { turn, step })
        stepOpen = false
      }
    }
    if (stepOpen) session.append('step/end', { turn, step })
    if (fresh) {
      appendCodexCut(session, { sourceId, turnId: sourceTurnId })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
      turn++
    }
  }
  if (!checkpoint.hydrated || checkpoint.historyLimited || seen.size !== checkpoint.ids.length) {
    appendPluginRecord(session, CHECKPOINT_RECORD, { ids: [...seen], hydrated: true, historyLimited: false })
  }
}
/**
 * Validate official items/list envelopes and retain user and assistant authored text.
 * @param value - Original Codex items/list response envelope.
 * @returns Source text messages and the next page cursor, excluding operation entries.
 */
export function parseCodexHistoryPage(value: CodexJsonObject): { messages: SourceMessage[]; nextCursor: string | null } {
  const page = parseCodexHistoryEntries(value)
  return { messages: page.entries.flatMap(entry => entry.kind === 'message' ? [entry.message] : []), nextCursor: page.nextCursor }
}
