/** Real source transport, JSONL persistence and workspace ownership exercise native Session assembly. */
import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import SessionProjectionCache from '@deepseek-ai/dsh-session-projection-cache'
import CodexAppServer, { type CodexJsonObject } from '@deepseek-ai/dsh-host-codex-app-server'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { createSessionTestController } from '../../../api/session-controller/tests/test-remote.ts'
import NativeConversations from '../src/index.ts'
import { sourceSessionId } from '../src/history.ts'

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
  let listed = false
  let external = false
  let mcpUrl = ''
  onTestFinished(async () => {
    try { for (const ctx of [...contexts].reverse()) await ctx.fiber.dispose() }
    finally {
      for (const client of clients) client.terminate()
      await new Promise<void>((resolve) => { server.close(() => { http.close(() => { resolve() }) }) })
      await rm(root, { recursive: true, force: true })
    }
  })
  const thread = (id: string, name: string, canAcceptDirectInput: boolean | null): CodexJsonObject => ({
    id, name, preview: `Preview ${name}`, cwd: workspacePath, model: 'fixture-model', createdAt: 1000, canAcceptDirectInput,
  })
  server.on('connection', (socket) => {
    clients.add(socket)
    socket.on('close', () => { clients.delete(socket) })
    socket.on('message', (bytes) => {
      const text = Buffer.isBuffer(bytes) ? bytes : Array.isArray(bytes) ? Buffer.concat(bytes) : Buffer.from(bytes)
      const frame = JSON.parse(text.toString('utf8')) as CodexJsonObject
      frames.push(frame)
      if (frame.id === undefined) return
      const params = typeof frame.params === 'object' && frame.params !== null && !Array.isArray(frame.params) ? frame.params : {}
      let result: CodexJsonObject
      if (frame.method === 'initialize') result = { codexHome: home, userAgent: 'native-service-fixture', platformFamily: 'unix', platformOs: process.platform }
      else if (frame.method === 'thread/list') result = { data: listed ? [thread('created-original', 'Created through Harness', true)] : [], nextCursor: null }
      else if (frame.method === 'model/list') result = { data: [{ model: 'fixture-model', displayName: 'Fixture', description: '', hidden: false, inputModalities: ['text'],
        supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Fixture medium effort' }], defaultReasoningEffort: 'medium' }] }
      else if (frame.method === 'thread/start') {
        const config = params.config as { mcp_servers: { skeinlet: { url: string } } }
        mcpUrl = config.mcp_servers.skeinlet.url
        listed = true
        result = { thread: thread('created-original', 'Created through Harness', true) }
      }
      else if (frame.method === 'mcpServerStatus/list') result = { data: [{ name: 'skeinlet', runtimeStatus: 'connected',
        httpOrigin: new URL(mcpUrl).origin, tools: {}, toolsError: null }] }
      else if (frame.method === 'turn/start') {
        socket.send(JSON.stringify({ id: frame.id, result: { turn: { id: 'owned-turn' } } }))
        socket.send(JSON.stringify({ method: 'item/completed', params: { threadId: 'created-original', turnId: 'owned-turn',
          item: { type: 'userMessage', id: 'owned-user', content: [{ type: 'text', text: 'Create this real chat' }] } } }))
        socket.send(JSON.stringify({ method: 'item/completed', params: { threadId: 'created-original', turnId: 'owned-turn',
          item: { type: 'agentMessage', id: 'owned-assistant', text: 'Original owned answer' } } }))
        socket.send(JSON.stringify({ method: 'turn/completed', params: { threadId: 'created-original', turn: { id: 'owned-turn', status: 'completed' } } }))
        return
      }
      else if (frame.method === 'thread/unsubscribe') result = {}
      else if (frame.method === 'thread/turns/list') result = { data: external ? [{ id: 'external-turn', status: 'completed' }] : [], nextCursor: null }
      else if (frame.method === 'thread/items/list') result = { data: external ? [
        { turnId: 'external-turn', item: { type: 'userMessage', id: 'external-user', content: [{ type: 'text', text: 'External continuation' }] } },
        { turnId: 'external-turn', item: { type: 'agentMessage', id: 'external-assistant', text: 'External source answer' } },
      ] : [], nextCursor: null }
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
    await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 1000 })
    await ctx.plugin(SessionTitle, { fallbackMaxWords: 10, fallbackMaxBytes: 120, maxTitleBytes: 240 })
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
    const controller = await createSessionTestController(ctx, { cwd: workspacePath, defaultModelSelection: () => ({ provider: 'codex-app-server', model: 'fixture-model' }) })
    await ctx.plugin(CodexAppServer, CodexAppServer.Config({ sourceHome: home, socketPath,
      connectTimeoutMs: 2000, requestTimeoutMs: 2000, serverRequestTimeoutMs: 2000 }))
    await ctx.plugin(NativeConversations, { fallbackCwd: workspacePath, codexPollIntervalMs: 250 })
    const synced = await ctx.nativeConversations.syncCodex()
    return { ctx, synced, controller }
  }
  return { open, frames, workspacePath, completeExternal: () => { external = true } }
}

function authoredText(session: Session): string[] {
  return session.snapshotEvents().flatMap((event) => {
    const message = event.type === 'user/message' ? event.data : event.type === 'assistant/message' ? event.data.message : undefined
    return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []) ?? []
  })
}

describe.skipIf(process.platform === 'win32')('new native source identity', () => {
  it('retains its random local Session through refresh and reopen and observes external turns immediately after binding', async () => {
    const h = await fixture()
    const first = await h.open()
    expect(first.synced).toEqual({ imported: 0 })
    const localId = SessionId('random-local-session-before-source-exists')
    const canonical = sourceSessionId('codex', 'created-original')
    const { agent } = await first.ctx.agents.create({ sessionId: localId,
      meta: { cwd: h.workspacePath }, agentOptions: { provider: 'codex-app-server', model: 'fixture-model' } })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Create this real chat' }] }))
    await agent.whenIdle()
    expect(authoredText(agent.session)).toContain('Original owned answer')
    expect(first.ctx.sessionProjections.snapshot(agent.session).values.nativeConversation).toMatchObject({ source: 'codex', sourceId: 'created-original' })
    expect(await first.ctx.nativeConversations.syncCodex()).toEqual({ imported: 0 })
    expect((await first.ctx.sessionPersistence.list()).map(row => row.header.id)).toEqual([localId])
    expect(first.ctx.workspaceRegistry.list().flatMap(workspace => workspace.sessionIds)).not.toContain(canonical)

    // The Agent was created before it had a binding: a source read proves bindNew started observation.
    h.completeExternal()
    await expect.poll(() => authoredText(agent.session), { timeout: 3000 }).toContain('External source answer')
    expect(authoredText(agent.session).filter(text => text === 'External continuation')).toHaveLength(1)
    expect(h.frames.some(frame => frame.method === 'thread/items/list'
      && (frame.params as { threadId?: string }).threadId === 'created-original')).toBe(true)
    await first.ctx.fiber.dispose()

    const reopened = await h.open()
    expect(reopened.synced).toEqual({ imported: 0 })
    expect((await reopened.ctx.sessionPersistence.list()).map(row => row.header.id)).toEqual([localId])
    expect(reopened.ctx.workspaceRegistry.list().flatMap(workspace => workspace.sessionIds)).toEqual([localId])
    const resumed = await reopened.ctx.agents.resume({ resumeSessionId: localId })
    expect(authoredText(resumed.agent.session).filter(text => text === 'External source answer')).toHaveLength(1)
    expect(h.frames.filter(frame => frame.method === 'thread/start')).toHaveLength(1)
    expect(h.frames.filter(frame => frame.method === 'turn/start')).toHaveLength(1)
  })
})
