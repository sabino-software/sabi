/** Explicit recovery preserves old evidence and compensates navigation/index failures without replay. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SessionId, SESSION_FORMAT_VERSION, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { rebuildCodexMirror } from '../src/rebuild.ts'
import { sourceSessionId } from '../src/history.ts'
import type { NativeConversationBinding, NativeConversationId } from '../src/types.ts'
import type { SourceSessionAssignment } from '../src/source-index.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

function fixture(failure?: string) {
  const ctx = new Context()
  const id = SessionId('old-local-mirror')
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: 123, cwd: '/fixture/workspace', isSeeded: false }
  const binding: NativeConversationBinding = { source: 'codex', sourceId: brandString<NativeConversationId>('original-codex-thread'),
    model: 'original-model', cwd: header.cwd ?? null, title: 'Original fixture' }
  const key = sourceSessionId('codex', binding.sourceId)
  let assignment: SourceSessionAssignment | undefined = { sessionId: id, createdAt: header.createdAt }
  const originalBytes = Buffer.from('fixture old tool and approval evidence; never opened or rewritten')
  const artifacts = new Map<SessionId, { header: SessionHeader; events: SessionEvent[] }>([[id, { header, events: [] }]])
  const archived: SessionId[] = []
  const pinned: SessionId[] = []
  const retained = new Set<SessionId>()
  const attached: SessionId[] = [id]
  const order: string[] = []
  const blocked = new Set<SessionId>()
  const fail = (stage: string): void => { if (failure === stage) throw new Error('PRIVATE_FIXTURE_FAILURE') }
  const cacheWrite = vi.fn(async () => { fail('cache') })
  const open = vi.fn(async (target: SessionId, access: string) => {
    expect(target).not.toBe(id)
    expect(access).toBe('read')
    order.push('reopen'); fail('reopen')
    const artifact = artifacts.get(target)!
    return { header: artifact.header, inheritedEventCount: 0,
      read: async () => { order.push('read'); fail('read'); return { events: artifact.events, eventState: 'detached' } },
      close: async () => { order.push('read-close') },
    }
  })
  const create = vi.fn(async (meta: SessionHeader) => {
    expect(meta.id).not.toBe(id)
    expect(blocked.has(meta.id)).toBe(true)
    artifacts.set(meta.id, { header: meta, events: [] })
    order.push('create')
    fail('create')
    return {
      append: async (events: readonly SessionEvent[]) => { fail('append'); artifacts.get(meta.id)!.events.push(...events) },
      flush: async () => { order.push('flush'); fail('flush') },
      close: async () => { order.push('write-close') },
    }
  })
  const workspace = { path: header.cwd, sessionIds: attached,
    attachSession: async (target: SessionId) => { attached.push(target); fail('attach') },
    detachSession: async (target: SessionId) => { attached.splice(attached.indexOf(target), 1) },
  }
  ctx.provide('agents', { get: (target: SessionId) => retained.has(target) ? {} : undefined } as never)
  ctx.provide('llm', { listModels: () => { throw new Error('Known model must not query the source') } } as never)
  ctx.provide('sessionPersistence', {
    stat: async (target: SessionId) => artifacts.has(target) ? { header: artifacts.get(target)!.header, revision: `revision-${target}` } : undefined,
    create, open,
    list: async () => [...artifacts.values()].map(item => ({ header: item.header })),
  } as never)
  let cachedBinding: unknown = binding
  ctx.provide('sessionProjectionCache', { cachedSnapshot: () => ({ values: { nativeConversation: cachedBinding } }), write: cacheWrite } as never)
  const archiveSession = vi.fn(async (target: SessionId, options?: unknown) => {
    expect(options).toBeUndefined()
    if (target === id) fail('archive-old')
    if (!archived.includes(target)) archived.push(target)
  })
  ctx.provide('workspaceRegistry', { archivedSessionIds: archived, pinnedSessionIds: pinned, list: () => [workspace], archiveSession,
    unarchiveSession: async (target: SessionId) => {
      if (target !== id) { fail('unarchive-new'); if (failure === 'rollback') throw new Error('PRIVATE_FAILURE') }
      const at = archived.indexOf(target)
      if (at >= 0) archived.splice(at, 1)
    },
  } as never)
  const put = vi.fn(async (_key: SessionId, value: SourceSessionAssignment) => {
    if (failure === 'rollback' && value.sessionId === id) throw new Error('PRIVATE_ROLLBACK_FAILURE')
    assignment = value
    if (value.sessionId !== id) fail('assignment')
  })
  const sources = { get: (target: SessionId) => target === key ? assignment : undefined, put }
  return { ctx, id, header, binding, key, originalBytes, artifacts, archived, pinned, retained, attached, order, blocked,
    create, open, cacheWrite, put, archiveSession, assignment: () => assignment,
    cached: (value: unknown) => { cachedBinding = value }, assign: (value: SourceSessionAssignment | undefined) => { assignment = value },
    recover: () => rebuildCodexMirror(ctx, sources, id, blocked),
  }
}

describe('explicit Codex mirror rebuild', () => {
  it.each([undefined, 0])('strictly reopens fresh metadata with top-level depth %s and preserves original bytes and source', async (depth) => {
    const h = fixture()
    if (depth !== undefined) Object.assign(h.header, { delegationDepth: depth })
    const bytes = Buffer.from(h.originalBytes)
    const receipt = await h.recover()
    expect(receipt.archivedSessionId).toBe(h.id)
    expect(receipt.sessionId).not.toBe(h.id)
    expect(h.originalBytes).toEqual(bytes)
    expect(h.artifacts.get(h.id)).toEqual({ header: h.header, events: [] })
    const fresh = h.artifacts.get(receipt.sessionId)!
    expect(fresh.header.createdAt).toBe(h.header.createdAt)
    expect(fresh.events.map(event => event.type)).toEqual(['plugin:native-conversations/bound', 'session/title', 'model/selection'])
    expect(JSON.stringify(fresh.events)).toContain('original-codex-thread')
    expect(JSON.stringify(fresh.events)).not.toMatch(/tool\/result|approval|turn\/start|user\/message/)
    expect(h.order).toEqual(['create', 'flush', 'write-close', 'reopen', 'read', 'read-close'])
    expect(h.cacheWrite).toHaveBeenCalledOnce()
    expect(h.assignment()).toEqual({ sessionId: receipt.sessionId, createdAt: fresh.header.createdAt })
    expect(h.archived).toEqual([h.id])
    expect(h.attached).toEqual([h.id, receipt.sessionId])
    expect(h.blocked.size).toBe(0)
  })

  it.each(['create', 'append', 'flush', 'reopen', 'read', 'cache', 'attach', 'assignment', 'archive-old', 'unarchive-new'])
  ('retains failed candidate archived and restores prior navigation/index after %s failure', async (failure) => {
    const h = fixture(failure)
    await expect(h.recover()).rejects.toThrow('original assignment was restored')
    expect(h.assignment()).toEqual({ sessionId: h.id, createdAt: h.header.createdAt })
    expect(h.archived).not.toContain(h.id)
    expect(h.attached).toEqual([h.id])
    const candidates = [...h.artifacts.keys()].filter(id => id !== h.id)
    expect(candidates).toHaveLength(1)
    expect(h.archived).toContain(candidates[0])
    expect(h.artifacts.get(h.id)).toEqual({ header: h.header, events: [] })
  })

  it('reports failed compensation explicitly and keeps the candidate blocked and archived', async () => {
    const h = fixture('rollback')
    await expect(h.recover()).rejects.toThrow('needs owner inspection')
    const candidate = [...h.artifacts.keys()].find(id => id !== h.id)!
    expect(h.archived).toContain(candidate)
    expect(h.blocked.has(candidate)).toBe(true)
    expect(h.assignment()?.sessionId).toBe(candidate)
    expect(h.artifacts.get(h.id)).toEqual({ header: h.header, events: [] })
  })

  it('preserves an unrelated archive made before final admission', async () => {
    const h = fixture()
    h.cacheWrite.mockImplementationOnce(async () => { h.archived.push(h.id) })
    await expect(h.recover()).rejects.toThrow('original assignment was restored')
    expect(h.archived).toContain(h.id)
    expect(h.assignment()?.sessionId).toBe(h.id)
    expect(h.attached).toEqual([h.id])
  })

  it.each(['pin', 'archive'])('rechecks a concurrent %s after waiting for activity', async (action) => {
    const h = fixture()
    h.ctx.on('workspace/session-activity', () => {
      if (action === 'pin') h.pinned.push(h.id)
      else h.archived.push(h.id)
      return Promise.resolve([])
    })
    await expect(h.recover()).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.archiveSession).not.toHaveBeenCalled()
  })

  it.each(['retained', 'pinned', 'archived', 'seeded', 'fork', 'subagent', 'descendant', 'missing-binding', 'axiom', 'ordinary', 'missing-assignment', 'wrong-assignment', 'wrong-lifecycle'])
  ('refuses %s before creating or reading any log', async (condition) => {
    const h = fixture()
    if (condition === 'retained') h.retained.add(h.id)
    if (condition === 'pinned') h.pinned.push(h.id)
    if (condition === 'archived') h.archived.push(h.id)
    if (condition === 'seeded') Object.assign(h.header, { isSeeded: true })
    if (condition === 'fork') Object.assign(h.header, { parentSession: SessionId('parent') })
    if (condition === 'descendant') {
      const childId = SessionId('existing-descendant')
      h.artifacts.set(childId, { header: { ...h.header, id: childId, parentSession: h.id }, events: [] })
    }
    if (condition === 'subagent') Object.assign(h.header, { origin: 'subagent' })
    if (condition === 'missing-binding' || condition === 'ordinary') h.cached(null)
    if (condition === 'axiom') h.cached({ ...h.binding, source: 'axiom' })
    if (condition === 'missing-assignment') h.assign(undefined)
    if (condition === 'wrong-assignment') h.assign({ sessionId: SessionId('someone-else'), createdAt: h.header.createdAt })
    if (condition === 'wrong-lifecycle') h.assign({ sessionId: h.id, createdAt: h.header.createdAt + 1 })
    await expect(h.recover()).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.open).not.toHaveBeenCalled()
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses reported background activity without stopping it', async () => {
    const h = fixture()
    h.ctx.on('workspace/session-activity', () => Promise.resolve([{ kind: 'job' }] as never))
    await expect(h.recover()).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.archiveSession).not.toHaveBeenCalled()
  })
})
