/** Native activity remains ignorable, replayable, deduplicated, and absent from wire projections. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import SessionStore, { Session, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { CODEX_ACTIVITY_RECORD, codexActivitySchema, createCodexActivityRecorder } from '../src/codex-activity.ts'
import type { NativeCodexActivity } from '../src/codex-activity-types.ts'

async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const recorder = await createCodexActivityRecorder(ctx)
  return { ctx, recorder, session: ctx.sessions.create() }
}

const started: NativeCodexActivity = { id: 'turn-one:item-one', type: 'commandExecution', phase: 'started', label: 'Run command', detail: '```sh\npwd\n```' }
const completed: NativeCodexActivity = { ...started, phase: 'completed', detail: '```sh\npwd\n```\n\nExit code: 0' }

describe('native Codex activity records', () => {
  it('appends changed source facts once with the ignorable envelope and isolates ids by original turn', async () => {
    const { ctx, recorder, session } = await fixture()
    expect(recorder.append(session, started)).toBe(0)
    expect(recorder.append(session, { ...started })).toBeUndefined()
    expect(recorder.append(session, completed)).toBe(1)
    expect(recorder.append(session, { ...completed })).toBeUndefined()
    expect(recorder.append(session, { ...started, id: 'turn-two:item-one' })).toBe(2)
    expect(session.snapshotEvents()).toMatchObject([
      { type: CODEX_ACTIVITY_RECORD, ignorable: true, data: started },
      { type: CODEX_ACTIVITY_RECORD, ignorable: true, data: completed },
      { data: { id: 'turn-two:item-one' } },
    ])
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('nativeCodexActivity')
    expect(ctx.sessionProjections.checkpoint(session)).toHaveProperty('nativeCodexActivity')
  })

  it('deduplicates restored records and produces the same state from checkpoint plus suffix and full replay', async () => {
    const { ctx, recorder, session } = await fixture()
    recorder.append(session, started)
    const checkpoint = ctx.sessionProjections.checkpoint(session)
    recorder.append(session, completed)
    const events = session.snapshotEvents()
    const restored = Session.create(session.id, events, session.header)
    expect(recorder.append(restored, completed)).toBeUndefined()
    const full = ctx.sessionProjections.restore({}, events, SessionLogOffset(0), session.header, SessionLogOffset(0))
    const suffix = ctx.sessionProjections.restore(checkpoint, events.slice(1), SessionLogOffset(1), session.header, SessionLogOffset(0))
    expect(suffix.checkpoint).toEqual(full.checkpoint)
    expect(full.snapshot.values).not.toHaveProperty('nativeCodexActivity')
  })

  it('validates source records before committing them', async () => {
    const { recorder, session } = await fixture()
    expect(codexActivitySchema.safeParse({ ...started, phase: 'success' }).success).toBe(false)
    expect(() => recorder.append(session, { ...started, id: '' })).toThrow()
    expect(session.snapshotEvents()).toEqual([])
  })

  it('skips malformed restored plugin data without losing later valid activity', async () => {
    const { recorder, session } = await fixture()
    recorder.append(session, started)
    const malformed = session.snapshotEvents().map(event => ({ ...event, data: { id: started.id } })) as SessionEvent[]
    const restored = Session.create(session.id, malformed, session.header)
    expect(recorder.append(restored, completed)).toBe(1)
    expect(recorder.append(restored, completed)).toBeUndefined()
  })
})
