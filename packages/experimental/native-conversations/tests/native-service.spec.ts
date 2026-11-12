/** Real source transport, JSONL persistence and workspace ownership exercise native Session assembly. */
import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { describe, expect, it, onTestFinished } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { Session, SessionId, appendPluginRecord } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import CodexAppServer, { type CodexJsonObject } from '@deepseek-ai/dsh-host-codex-app-server'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import NativeConversations from '../src/index.ts'
import { BINDING_RECORD } from '../src/projection.ts'
import { sourceSessionId } from '../src/history.ts'
import type { NativeConversationId } from '../src/types.ts'

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-service-')))
  const home = join(root, 'work-codex')
  const workspacePath = join(root, 'source-workspace')
  await mkdir(home)
  await mkdir(workspacePath)
  const socketPath = join(root, 'daemon.sock')
  const http = createServer()
  const server = new WebSocketServer({ server: http })
  const clients = new Set<WebSocket>()
  const frames: CodexJsonObject[] = []
  const contexts: Context[] = []
  const pool = new MemoryMediaPool()
  onTestFinished(async () => {
    try { for (const ctx of [...contexts].reverse()) await ctx.fiber.dispose() }
    finally {
      for (const client of clients) client.terminate()
      await new Promise<void>(resolve => { server.close(() => { http.close(() => { resolve() }) }) })
      await rm(root, { recursive: true, force: true })
    }
  })
  const thread = (id: string, name: string, canAcceptDirectInput: boolean | null): CodexJsonObject => ({
    id, name, preview: `Preview ${name}`, cwd: workspacePath, model: 'fixture-model', createdAt: 1000, canAcceptDirectInput,
  })
  server.on('connection', socket => {
    clients.add(socket)
    socket.on('close', () => { clients.delete(socket) })
    socket.on('message', bytes => {
      const frame = JSON.parse(String(bytes)) as CodexJsonObject
      frames.push(frame)
      if (frame.id === undefined) return
      const params = typeof frame.params === 'object' && frame.params !== null && !Array.isArray(frame.params) ? frame.params : {}
      let result: CodexJsonObject
      if (frame.method === 'initialize') result = { codexHome: home, userAgent: 'native-service-fixture', platformFamily: 'unix', platformOs: process.platform }
      else if (frame.method === 'thread/list') result = params.cursor === 'page-two'
        ? { data: [thread('source-two', 'Second existing chat', null)], nextCursor: null }
        : { data: [thread('source-one', 'First existing chat', true), thread('source-busy', 'Unavailable chat', false)], nextCursor: 'page-two' }
      else if (frame.method === 'thread/items/list') result = params.cursor === 'items-two'
        ? { data: [{ item: { type: 'agentMessage', id: 'original-assistant', text: 'Original persisted answer' } }], nextCursor: null }
        : { data: [{ item: { type: 'userMessage', id: 'original-user', content: [{ type: 'text', text: 'Original persisted question' }] } }], nextCursor: 'items-two' }
      else {
        socket.send(JSON.stringify({ id: frame.id, error: { code: -32601, message: 'Unexpected fixture request' } }))
        return
      }
      socket.send(JSON.stringify({ id: frame.id, result }))
    })
  })
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(socketPath, resolve) })

  const open = async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
    const domain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', domain)
    ctx.provide('storageDomain', domain)
    await ctx.plugin(WorkspaceRegistry)
    await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: workspacePath })
    await ctx.plugin(ApprovalService, { policy: 'ask' })
    await ctx.plugin(UserQuestionService)
    ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('Metadata fixtures must not execute shell commands') },
      run() { throw new Error('Metadata fixtures must not execute shell commands') },
      start() { throw new Error('Metadata fixtures must not execute shell commands') },
    })
    await ctx.plugin(PermissionPresets)
    await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(CodexAppServer, CodexAppServer.Config({ sourceHome: home, socketPath,
      connectTimeoutMs: 2000, requestTimeoutMs: 2000, serverRequestTimeoutMs: 2000 }))
    await ctx.plugin(NativeConversations, { fallbackCwd: workspacePath })
    const synced = await ctx.nativeConversations.syncCodex()
    return { ctx, synced }
  }
  return { open, frames, workspacePath }
}

function authoredText(session: Session): string[] {
  return session.snapshotEvents().flatMap(event => {
    const message = event.type === 'user/message' ? event.data : event.type === 'assistant/message' ? event.data.message : undefined
    return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []) ?? []
  })
}

describe.skipIf(process.platform === 'win32')('native conversation service', () => {
  it('stores paginated metadata as ordinary workspace rows before opening Agents and reuses them after reopening', async () => {
    const h = await fixture()
    const first = await h.open()
    const ids = [sourceSessionId('codex', 'source-one'), sourceSessionId('codex', 'source-two')]
    expect(first.synced).toEqual({ imported: 2 })
    expect(first.ctx.sessions.list()).toEqual([])
    expect(first.ctx.workspaceRegistry.list().find(workspace => workspace.path === h.workspacePath)?.sessionIds).toEqual(expect.arrayContaining(ids))
    expect(first.ctx.workspaceRegistry.list().flatMap(workspace => workspace.sessionIds)).not.toContain(sourceSessionId('codex', 'source-busy'))
    expect((await first.ctx.sessionPersistence.list()).map(row => row.header.id).sort()).toEqual([...ids].sort())
    expect(h.frames.filter(frame => frame.method === 'thread/list').map(frame => frame.params)).toEqual([
      { limit: 100, cursor: null, modelProviders: [], useStateDbOnly: true, archived: false },
      { limit: 100, cursor: 'page-two', modelProviders: [], useStateDbOnly: true, archived: false },
    ])
    expect(h.frames.some(frame => frame.method === 'thread/resume' || frame.method === 'turn/start' || frame.method === 'thread/items/list')).toBe(false)
    const handle = await first.ctx.sessionPersistence.open(ids[0]!, 'read')
    try {
      const stored = await handle.read()
      const session = Session.fromRestore(ids[0]!, stored.events, handle.header, handle.inheritedEventCount, stored.eventState)
      expect(first.ctx.sessionProjections.snapshot(session).values.nativeConversation).toMatchObject({ source: 'codex', sourceId: 'source-one', title: 'First existing chat' })
      expect(session.snapshotEvents().find(event => event.type === 'session/title')).toMatchObject({ data: { title: 'First existing chat' } })
      expect(authoredText(session)).toEqual([])
    } finally { await handle.close() }
    await first.ctx.fiber.dispose()
    const reopened = await h.open()
    expect(reopened.synced).toEqual({ imported: 0 })
    expect(reopened.ctx.sessions.list()).toEqual([])
    const rows = reopened.ctx.workspaceRegistry.list().flatMap(workspace => workspace.sessionIds)
    expect(rows.sort()).toEqual([...ids].sort())
    expect(new Set(rows).size).toBe(2)
  })

  it('hydrates original paginated text on Agent open and enforces source-bound model and permission admission', async () => {
    const h = await fixture()
    const { ctx } = await h.open()
    const id = sourceSessionId('codex', 'source-one')
    const { agent } = await ctx.agents.resume({ resumeSessionId: id })
    expect(authoredText(agent.session)).toEqual(['Original persisted question', 'Original persisted answer'])
    expect(h.frames.filter(frame => frame.method === 'thread/items/list').map(frame => frame.params)).toEqual([
      { threadId: 'source-one', limit: 100, sortDirection: 'asc', cursor: null },
      { threadId: 'source-one', limit: 100, sortDirection: 'asc', cursor: 'items-two' },
    ])
    const beforeModel = agent.session.snapshotEvents()
    expect(() => agent.model.select({ provider: 'different-provider', model: 'fixture-model' })).toThrow('Choose a model from Work Codex')
    expect(agent.session.snapshotEvents()).toEqual(beforeModel)
    agent.model.select({ provider: 'codex-app-server', model: 'second-fixture-model' })
    expect(agent.model.current()).toMatchObject({ provider: 'codex-app-server', model: 'second-fixture-model' })

    const seed = Session.create(SessionId('axiom-source-fixture'))
    appendPluginRecord(seed, BINDING_RECORD, { source: 'axiom', sourceId: brandString<NativeConversationId>('https://chatgpt.com/dots/fixture~source'),
      title: 'Original Dot fixture', model: 'original-dot', cwd: null })
    seed.append('model/selection', { provider: 'axiom-original', model: 'original-dot' })
    const bound = await ctx.agents.create({ sessionId: SessionId('bound-axiom-fixture'), seed: seed.snapshotEvents(), meta: { cwd: h.workspacePath } })
    const before = bound.agent.session.snapshotEvents()
    expect(() => bound.agent.model.select({ provider: 'codex-app-server', model: 'fixture-model' })).toThrow('original Axiom page owns its model')
    expect(() => ctx.permissionPresets.set(bound.agent.session, 'danger-full-access')).toThrow('original Axiom page owns its permissions')
    expect(bound.agent.session.snapshotEvents()).toEqual(before)
    expect(ctx.permissionPresets.current(bound.agent.session)).toBe('workspace-write')
    expect(h.frames.some(frame => frame.method === 'turn/start' || frame.method === 'thread/resume')).toBe(false)
  })
})
