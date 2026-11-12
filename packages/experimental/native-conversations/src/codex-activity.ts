/** Durable native activity with replay-safe duplicate suppression and no client projection payload. */
import type { Context } from '@deepseek-ai/cordis'
import { appendPluginRecord, pluginRecordOf, type Session, type SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { NativeCodexActivity } from './codex-activity-types.ts'

/** Ignorable record owned by the native integration. */
export const CODEX_ACTIVITY_RECORD = 'plugin:native-conversations/codex-activity'

/** Validate original-engine data at the durable record boundary. */
export const codexActivitySchema: z.ZodType<NativeCodexActivity> = z.object({
  id: z.string().min(1), type: z.string().min(1), phase: z.enum(['started', 'completed']),
  label: z.string().min(1), detail: z.string().nullable(),
}).strict()

type ActivityState = Readonly<Record<string, NativeCodexActivity>>

function same(left: NativeCodexActivity | undefined, right: NativeCodexActivity): boolean {
  return left !== undefined && left.id === right.id && left.type === right.type && left.phase === right.phase
    && left.label === right.label && left.detail === right.detail
}

function own(state: ActivityState, id: string): NativeCodexActivity | undefined {
  return Object.hasOwn(state, id) ? state[id] : undefined
}

// One current DTO per source item supports deduplication after replay; no transcript or event index is retained.
const projection = {
  key: 'nativeCodexActivity', stateVersion: 1,
  stateSchema: z.record(z.string(), codexActivitySchema),
  init: () => ({}),
  apply: (state, event) => {
    const record = pluginRecordOf(event)
    if (record?.type !== CODEX_ACTIVITY_RECORD) return state
    const parsed = codexActivitySchema.safeParse(record.data)
    if (!parsed.success || same(own(state, parsed.data.id), parsed.data)) return state
    return { ...state, [parsed.data.id]: parsed.data }
  },
} satisfies ProjectionDefinition<'nativeCodexActivity', ActivityState>

/** A session-scoped writer whose ready projection handle remains private. */
export interface CodexActivityRecorder {
  /**
   * @param session - Ordinary owning Harness Session.
   * @param activity - Original operation facts.
   * @returns New record sequence, or undefined when unchanged.
   */
  append(session: Session, activity: NativeCodexActivity): SessionSeq | undefined
}

/**
 * Register host-only recovery before exposing the writer; the owning Context releases registration.
 * @param ctx - Host owner declaring sessionProjections as a required dependency.
 * @returns A writer which never opens or changes the original Codex history.
 */
export async function createCodexActivityRecorder(ctx: Context): Promise<CodexActivityRecorder> {
  const handle = await ctx.sessionProjections.register(projection)
  return {
    append(session, activity) {
      const value = codexActivitySchema.parse(activity)
      if (same(own(handle.stateOf(session), value.id), value)) return undefined
      return appendPluginRecord(session, CODEX_ACTIVITY_RECORD, value)
    },
  }
}
