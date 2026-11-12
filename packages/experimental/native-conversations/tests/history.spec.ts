/** Source message identities survive production JSONL persistence and real projection reopening. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import SessionStore, { Session, SessionId, SessionLogOffset, SESSION_FORMAT_VERSION, appendPluginRecord, buildForkSeed, type SessionHeader } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { CodexJsonObject } from '@deepseek-ai/dsh-host-codex-app-server'
import { appendSourceMessages, parseCodexHistoryPage, sourceCheckpointProjection, sourceSessionId } from '../src/history.ts'
import { admittedNativeInputIds, appendCodexCut, BINDING_RECORD, nativeCodexCutProjection, nativeStepInputProjection } from '../src/projection.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativeConversationId } from '../src/types.ts'

function textMessages(session: Session): string[] {
  return session.snapshotEvents().flatMap((event) => {
    const message = event.type === 'user/message' ? event.data : event.type === 'assistant/message' ? event.data.message : undefined
    return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []) ?? []
  })
}

describe('native source history', () => {
  it('keeps inherited partial-turn evidence sticky across later own input until the child receives its own binding', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const cuts = await ctx.sessionProjections.register(nativeCodexCutProjection)
    const parent = ctx.sessions.create()
    const binding = { source: 'codex' as const, sourceId: brandString<NativeConversationId>('parent-source'), title: 'Parent', model: null, cwd: null }
    appendPluginRecord(parent, BINDING_RECORD, binding)
    appendCodexCut(parent, { sourceId: binding.sourceId, turnId: 'completed-source-turn' })
    parent.append('turn/start', { turn: 1 })
    parent.append('step/start', { turn: 1, step: 1 })
    const partial = parent.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'A later original turn has started.' }],
    }), { surfaceOp: 'append' })
    const id = SessionId('partial-native-seed')
    const child = Session.create(id, buildForkSeed(parent.snapshotEvents(), partial.seq),
      { ...parent.header, id, parentSession: parent.id, isSeeded: true }, SessionLogOffset(partial.seq + 1))
    expect(cuts.stateOf(child)?.inheritedPartial).toBe(true)
    child.append('turn/start', { turn: 2 })
    child.append('step/start', { turn: 2, step: 1 })
    const own = child.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'New child input must not mask inherited partial evidence.' }],
    }), { surfaceOp: 'append' })
    expect(cuts.stateOf(child)).toMatchObject({ lastEvidenceSeq: own.seq, inheritedPartial: true })
    const restored = Session.create(id, child.snapshotEvents(), child.header, child.inheritedEventCount)
    expect(cuts.stateOf(restored)?.inheritedPartial).toBe(true)
    const childSource = brandString<NativeConversationId>('independent-child-source')
    appendPluginRecord(restored, BINDING_RECORD, { ...binding, sourceId: childSource })
    expect(cuts.stateOf(restored)).toBeNull()
    appendCodexCut(restored, { sourceId: childSource, turnId: 'child-completed-turn' })
    expect(cuts.stateOf(restored)).toMatchObject({ sourceId: childSource, inheritedPartial: false, lastEvidenceSeq: null })
  })

  it('recovers admitted input IDs for one open step and drops old SDK context at the next boundary', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const input = await ctx.sessionProjections.register(nativeStepInputProjection)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const human = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Fresh prompt.' }] })
    const sdk = createUserMessage({ source: { kind: 'tool-registry' }, content: [{ type: 'text', text: 'Already delivered SDK context.' }] })
    session.append('user/message', human, { surfaceOp: 'append' })
    session.append('user/message', sdk, { surfaceOp: 'append' })
    const restored = Session.create(session.id, session.snapshotEvents(), session.header)
    expect(admittedNativeInputIds(input.stateOf(restored), { turn: 1, step: 1 })).toEqual([human.id, sdk.id])
    expect(admittedNativeInputIds(input.stateOf(restored), { turn: 2, step: 1 })).toEqual([])
    restored.append('step/end', { turn: 1, step: 1 })
    expect(input.stateOf(restored).ids).toEqual([])
    restored.append('step/start', { turn: 1, step: 2 })
    const next = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'New follow-up.' }] })
    restored.append('user/message', next, { surfaceOp: 'append' })
    expect(admittedNativeInputIds(input.stateOf(restored), { turn: 1, step: 2 })).toEqual([next.id])
    expect(ctx.sessionProjections.snapshot(restored).values).not.toHaveProperty('nativeStepInput')
  })

  it('keeps opaque source identities stable, namespaced and safe as local Session IDs', () => {
    const id = sourceSessionId('codex', 'opaque/source~id')
    expect(id).toBe(sourceSessionId('codex', 'opaque/source~id'))
    expect(id).toMatch(/^session-[a-f0-9]{32}$/u)
    expect(id).not.toBe(sourceSessionId('axiom', 'opaque/source~id'))
    expect(id).not.toBe(sourceSessionId('codex', 'another/source~id'))
  })

  it('reads the original wrapped items/list envelope and keeps pagination without tool or reasoning text', () => {
    const page = parseCodexHistoryPage({
      data: [
        { item: { type: 'userMessage', id: 'user/opaque~1', content: [{ type: 'text', text: 'Original question' }, { type: 'image', url: 'PRIVATE_ATTACHMENT' }] }, turnId: 'turn-source-1', startedAtMs: 10 },
        { item: { type: 'reasoning', id: 'reasoning', text: 'PRIVATE_REASONING' } },
        { item: { type: 'commandExecution', id: 'tool', text: 'PRIVATE_TOOL_OUTPUT' } },
        { item: { type: 'agentMessage', id: 'assistant/opaque~2', text: 'Original answer' }, startedAtMs: null },
      ], nextCursor: 'opaque-cursor~next',
    })
    expect(page).toEqual({ messages: [
      { id: 'user/opaque~1', role: 'user', text: 'Original question', timestamp: 10 },
      { id: 'assistant/opaque~2', role: 'assistant', text: 'Original answer', timestamp: null },
    ], nextCursor: 'opaque-cursor~next' })
    expect(JSON.stringify(page)).not.toMatch(/PRIVATE_/u)
  })

  it('refuses malformed envelopes and message records instead of presenting them as empty history', () => {
    const invalid: CodexJsonObject[] = [
      { data: [{ type: 'agentMessage', id: 'flat', text: 'Wrong wrapper' }], nextCursor: null },
      { data: [{ item: { type: 'agentMessage', id: 42, text: 'Wrong identity' } }], nextCursor: null },
      { data: [{ item: { type: 'userMessage', id: 'bad-content', content: 'not-an-array' } }], nextCursor: null },
      { data: [], nextCursor: 42 },
      { data: {} },
    ]
    for (const page of invalid) expect(() => parseCodexHistoryPage(page)).toThrow()
  })

  it('reopens real JSONL history and deduplicates original message IDs while admitting a new source message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-history-'))
    const contexts: Context[] = []
    onTestFinished(async () => {
      for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    })
    const open = async () => {
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
      const checkpoint = await ctx.sessionProjections.register(sourceCheckpointProjection)
      return { ctx, checkpoint }
    }
    const first = await open()
    const id = sourceSessionId('codex', 'original-thread')
    const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: 1000, isSeeded: false, cwd: root }
    const original = Session.create(id, undefined, header)
    const messages = [
      { id: 'source-user', role: 'user' as const, text: 'Existing question' },
      { id: 'source-assistant', role: 'assistant' as const, text: 'Existing answer' },
    ]
    appendSourceMessages(original, first.checkpoint.stateOf(original), messages, 'codex-app-server', 'fixture-model', true, 1)
    const writer = await first.ctx.sessionPersistence.create(header)
    try { await writer.append(original.snapshotEvents()); await writer.flush() } finally { await writer.close() }
    await first.ctx.fiber.dispose()

    const second = await open()
    const handle = await second.ctx.sessionPersistence.open(id, 'write')
    try {
      const stored = await handle.read()
      const restored = Session.fromRestore(id, stored.events, handle.header, handle.inheritedEventCount, stored.eventState)
      expect(second.checkpoint.stateOf(restored)).toEqual({ ids: ['source-user', 'source-assistant'], hydrated: true, historyLimited: true })
      appendSourceMessages(restored, second.checkpoint.stateOf(restored), [...messages, messages[1]!,
        { id: 'source-followup', role: 'assistant', text: 'New original answer' }], 'codex-app-server', 'fixture-model', true, 3)
      expect(textMessages(restored)).toEqual(['Existing question', 'Existing answer', 'New original answer'])
      expect(restored.snapshotEvents().some(event => event.type === 'tool/call' || event.type === 'tool/result')).toBe(false)
      expect(second.checkpoint.stateOf(restored).ids).toEqual(['source-user', 'source-assistant', 'source-followup'])
      await handle.append(restored.snapshotEvents().slice(stored.events.length))
      await handle.flush()
    } finally { await handle.close() }
    const reread = await second.ctx.sessionPersistence.open(id, 'read')
    try {
      const stored = await reread.read()
      const restored = Session.fromRestore(id, stored.events, reread.header, reread.inheritedEventCount, stored.eventState)
      expect(textMessages(restored)).toEqual(['Existing question', 'Existing answer', 'New original answer'])
      expect(second.checkpoint.stateOf(restored).ids).toEqual(['source-user', 'source-assistant', 'source-followup'])
    } finally { await reread.close() }
  })
})
