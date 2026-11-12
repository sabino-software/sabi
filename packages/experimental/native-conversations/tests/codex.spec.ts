/** Real Harness tools and MCP HTTP exercise the native adapter against an explicitly controlled source. */
import { Context } from '@deepseek-ai/cordis'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { BlockAssembler, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import CodexAppServer, { type CodexJsonObject, type CodexMethod, type CodexNotification,
  type CodexServerRequestHandler, type CodexServerRequestMethod } from '@deepseek-ai/dsh-host-codex-app-server'
import { CODEX_PROVIDER, CodexConversationAdapter } from '../src/codex.ts'
import type { NativeConversationBinding, NativeConversationId } from '../src/types.ts'
import type { NativeCodexActivity } from '../src/codex-activity-types.ts'

const THREAD = 'existing-source-thread'
const TURN = 'owned-source-turn'

class UnusedAdapter extends LlmAdapter {
  override async *stream(): AsyncIterable<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } }
}

async function fixture(tools: readonly ToolDefinition[] = [], holdAcknowledgement = false) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['fixture'], new UnusedAdapter())
  await ctx.plugin(ApprovalService)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: process.cwd() })
  await ctx.plugin(CodexAppServer, CodexAppServer.Config({ sourceHome: process.cwd() }))
  const loop = await mountAgentLoopTestHarness(ctx)
  const agent = await loop.create(SessionId('native-adapter-fixture'), { provider: 'fixture', model: 'fixture' })
  for (const tool of tools) ctx.tools.register(tool)
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('step/start', { turn: 1, step: 1 })
  const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue this original chat.' }] })
  agent.session.append('user/message', input, { surfaceOp: 'append' })
  const admission = await ctx.tools.resolve({ agent, modelSelection: { provider: CODEX_PROVIDER, model: 'fixture' }, signal: new AbortController().signal })
  const schemas = ctx.tools.schemas(agent, admission)
  admission.dispose()
  const notifications = new Set<(notification: CodexNotification) => void>()
  const handlers = new Map<CodexServerRequestMethod, CodexServerRequestHandler>()
  const requests: { method: CodexMethod; params: CodexJsonObject }[] = []
  const started = Promise.withResolvers<void>()
  const acknowledge = Promise.withResolvers<void>()
  const interrupted = Promise.withResolvers<void>()
  const controller = new AbortController()
  const streams = new Set<Promise<StreamChunk[]>>()
  const clients: Client[] = []
  const activities: NativeCodexActivity[] = []
  const barriers = new Map<string, () => void>()
  let nextBarrier = 0
  let endpoint: { url: string; authorization: string } | undefined
  const observed = vi.fn()
  const binding: NativeConversationBinding = { source: 'codex', sourceId: brandString<NativeConversationId>(THREAD), title: 'Existing fixture', model: null, cwd: null }
  vi.spyOn(ctx.codexAppServer, 'onNotification').mockImplementation(listener => { notifications.add(listener); return () => { notifications.delete(listener) } })
  vi.spyOn(ctx.codexAppServer, 'onStatus').mockImplementation(() => () => {})
  vi.spyOn(ctx.codexAppServer, 'setRequestHandler').mockImplementation((method, handler) => {
    handlers.set(method, handler)
    return () => { handlers.delete(method) }
  })
  vi.spyOn(ctx.codexAppServer, 'request').mockImplementation(async (method, params) => {
    requests.push({ method, params })
    if (method === 'thread/read') return { thread: { id: THREAD, status: { type: 'idle' } } }
    if (method === 'thread/turns/list') return { data: [] }
    if (method === 'thread/resume') {
      const config = z.object({ mcp_servers: z.object({ skeinlet: z.object({ url: z.string(), http_headers: z.object({ Authorization: z.string() }) }) }) }).parse(params.config)
      endpoint = { url: config.mcp_servers.skeinlet.url, authorization: config.mcp_servers.skeinlet.http_headers.Authorization }
      return {}
    }
    if (method === 'mcpServerStatus/list') {
      if (endpoint === undefined) throw new Error('The scoped MCP endpoint was not configured')
      return { data: [{ name: 'skeinlet', runtimeStatus: 'connected', httpOrigin: new URL(endpoint.url).origin,
        tools: Object.fromEntries(schemas.map(schema => [schema.name, {}])), toolsError: null }] }
    }
    if (method === 'turn/start') {
      started.resolve()
      if (holdAcknowledgement) await acknowledge.promise
      return { turn: { id: TURN } }
    }
    if (method === 'turn/interrupt') { interrupted.resolve(); return {} }
    if (method === 'thread/unsubscribe') return {}
    throw new Error(`Unexpected native fixture method ${method}`)
  })
  const adapter = new CodexConversationAdapter(ctx, { bindingOf: () => binding,
    async bindNew() { throw new Error('Existing-source fixture must not create a thread') },
    requestLog: () => ({ turn: 1, step: 1 }), observeOwnedMessages: observed,
    activity(owner, activity) {
      expect(owner).toBe(agent)
      activities.push(activity)
      barriers.get(activity.id)?.()
      barriers.delete(activity.id)
    },
  })
  const emit = (method: string, params: CodexJsonObject) => {
    for (const listener of notifications) listener({ generation: 1, method, params })
  }
  const item = (value: CodexJsonObject, phase: 'started' | 'completed' = 'completed', threadId = THREAD, turnId = TURN) => {
    emit(`item/${phase}`, { threadId, turnId, item: value })
  }
  const finish = (status = 'completed') => { emit('turn/completed', { threadId: THREAD, turn: { id: TURN, status } }) }
  const barrier = async () => {
    const id = `fixture-barrier-${++nextBarrier}`
    const done = Promise.withResolvers<void>()
    barriers.set(`${TURN}:${id}`, done.resolve)
    item({ type: 'commandExecution', id, command: 'Fixture notification barrier' })
    await done.promise
  }
  const sourceApproval = (threadId = THREAD, turnId = TURN) => {
    const method = 'item/commandExecution/requestApproval'
    const handler = handlers.get(method)
    if (handler === undefined) throw new Error('Native approval handler was not registered')
    return handler({ threadId, turnId, command: 'pwd', cwd: process.cwd(), availableDecisions: ['accept', 'cancel'] },
      { id: 'approval-fixture', generation: 1, method, signal: controller.signal })
  }
  const start = () => {
    const options: GenerateOptions = { provider: CODEX_PROVIDER, model: 'fixture', sessionId: agent.id, messages: [input], tools: [...schemas], signal: controller.signal }
    const pending = (async () => {
      const chunks: StreamChunk[] = []
      for await (const chunk of adapter.stream(options)) chunks.push(chunk)
      return chunks
    })()
    streams.add(pending)
    void pending.then(() => { streams.delete(pending) }, () => { streams.delete(pending) })
    return pending
  }
  const client = async () => {
    if (endpoint === undefined) throw new Error('The native fixture has not started')
    const peer = new Client({ name: 'codex-adapter-fixture', version: '1.0.0' })
    clients.push(peer)
    await peer.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: { authorization: endpoint.authorization } } }))
    return peer
  }
  onTestFinished(async () => {
    controller.abort()
    acknowledge.resolve()
    await Promise.allSettled([...streams])
    for (const peer of clients) await peer.close()
    await ctx.fiber.dispose()
  })
  return { ctx, agent, requests, started: started.promise, interrupted: interrupted.promise, acknowledge: acknowledge.resolve,
    observed, activities, emit, item, finish, barrier, sourceApproval, start, client }
}

function completedMcp(receipt: string, server = 'skeinlet'): CodexJsonObject {
  return { type: 'mcpToolCall', id: 'native-mcp-item', server, tool: 'finish', result: { content: [], _meta: { 'skeinlet/receipt': receipt } } }
}

async function reopenRecordedEvents(session: Session): Promise<readonly SessionEvent[]> {
  const root = await mkdtemp(join(tmpdir(), 'codex-deferred-context-'))
  const ctx = new Context()
  try {
    await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
    const writer = await ctx.sessionPersistence.create(session.header, { inheritedEventCount: session.inheritedEventCount })
    try { await writer.append(session.snapshotEvents()) } finally { await writer.close() }
    const reader = await ctx.sessionPersistence.open(session.id, 'read')
    try { return (await reader.read()).events } finally { await reader.close() }
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}

describe('original Codex adapter continuations', () => {
  it('persists each deferred context once and delivers its exact role/source to the native MCP caller', async () => {
    const guidance = createUserMessage({ source: { kind: 'tool-registry' }, content: [{ type: 'text', text: 'New SDK guidance from the Harness tool.' }] })
    let executions = 0
    const h = await fixture([defineTool({ name: 'activate', description: 'Activate a capability.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) { executions++; exec.deferContext(guidance); return 'activated' },
    })])
    const pending = h.start()
    await h.started
    const result = await (await h.client()).callTool({ name: 'activate', arguments: {} })
    expect(result.isError).toBe(false)
    const contexts = result.content.flatMap(block => {
      if (block.type !== 'text' || !block.text.includes('harness-deferred-context')) return []
      return [JSON.parse(block.text)]
    })
    expect(contexts).toEqual([{ kind: 'harness-deferred-context', message: guidance }])
    const logged = h.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.id === guidance.id)
    expect(logged).toMatchObject([{ surfaceOp: 'append', data: guidance }])
    expect(h.agent.inbox.nextStep).toEqual([])
    expect(executions).toBe(1)
    h.finish()
    expect((await pending).at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect((await reopenRecordedEvents(h.agent.session)).filter(event => event.type === 'user/message' && event.data.id === guidance.id))
      .toMatchObject([{ surfaceOp: 'append', data: guidance }])
  })

  it('waits for the exact owned source receipt after HTTP finish before interrupting a Harness-concluded turn', async () => {
    const h = await fixture([defineTool({ name: 'finish', description: 'Finish this Harness turn.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) { exec.concludeTurn(); return 'finished' },
    })])
    const pending = h.start()
    await h.started
    const result = await (await h.client()).callTool({ name: 'finish', arguments: {} })
    expect(result.isError).toBe(false)
    const receipt = result._meta?.['skeinlet/receipt']
    if (typeof receipt !== 'string') throw new Error('The native result omitted its receipt')
    await h.barrier()
    expect(h.requests.filter(request => request.method === 'turn/interrupt')).toEqual([])
    h.item(completedMcp('unrelated-receipt'))
    h.item(completedMcp(receipt), 'completed', 'another-thread')
    h.item(completedMcp(receipt), 'completed', THREAD, 'another-turn')
    h.item(completedMcp(receipt, 'another-server'))
    await h.barrier()
    expect(h.requests.filter(request => request.method === 'turn/interrupt')).toEqual([])
    h.item(completedMcp(receipt))
    await h.interrupted
    expect(h.requests.filter(request => request.method === 'turn/interrupt')).toEqual([{ method: 'turn/interrupt', params: { threadId: THREAD, turnId: TURN } }])
    h.finish('interrupted')
    expect((await pending).at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(h.requests.filter(request => request.method === 'turn/interrupt')).toHaveLength(1)
  })

  it.each(['interrupted', 'failed'])('rejects a source %s outcome when Harness did not conclude the turn', async status => {
    const h = await fixture()
    const pending = h.start()
    await h.started
    h.finish(status)
    await expect(pending).rejects.toThrow(`The original Codex turn ${status}`)
    expect(h.requests.filter(request => request.method === 'turn/interrupt')).toEqual([])
  })

  it('uses authoritative completed text and records only exact owned source message identities', async () => {
    const h = await fixture()
    const pending = h.start()
    await h.started
    h.emit('item/agentMessage/delta', { threadId: 'another-thread', turnId: TURN, itemId: 'foreign-thread', delta: 'Wrong thread' })
    h.emit('item/agentMessage/delta', { threadId: THREAD, turnId: 'another-turn', itemId: 'foreign-turn', delta: 'Wrong turn' })
    h.item({ type: 'userMessage', id: 'owned-user' })
    h.emit('item/agentMessage/delta', { threadId: THREAD, turnId: TURN, itemId: 'owned-assistant', delta: 'Partial delta that differs' })
    h.item({ type: 'agentMessage', id: 'owned-assistant', text: 'Authoritative final answer.' })
    h.finish()
    const chunks = await pending
    const assembler = new BlockAssembler()
    for (const chunk of chunks) assembler.push(chunk)
    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'Authoritative final answer.' }])
    expect(h.observed).toHaveBeenCalledExactlyOnceWith(h.agent, ['owned-user'], ['owned-assistant'])
  })

  it('awaits source turn acknowledgement for approvals and refuses other or stale turn owners', async () => {
    const h = await fixture([], true)
    const asked = vi.fn(async (approval: ApprovalRequest) => {
      expect(approval.agent).toBe(h.agent)
      expect(h.ctx.agents.requireInitiator()).toBe(h.agent)
      return 'allowed-once' as const
    })
    h.ctx.on('approval/request', asked)
    const pending = h.start()
    await h.started
    const approval = h.sourceApproval()
    expect(await h.sourceApproval('another-thread')).toEqual({ decision: 'cancel' })
    h.acknowledge()
    expect(await approval).toEqual({ decision: 'accept' })
    expect(asked).toHaveBeenCalledTimes(1)
    expect(asked.mock.calls[0]?.[0].agent).toBe(h.agent)
    expect(asked.mock.calls[0]?.[0].toolName).toBe('Codex command')
    expect(await h.sourceApproval(THREAD, 'another-turn')).toEqual({ decision: 'cancel' })
    h.finish()
    await pending
    expect(await h.sourceApproval()).toEqual({ decision: 'cancel' })
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it('exposes only owned source operations as inert activity and keeps Harness MCP tool cards separate', async () => {
    const h = await fixture()
    const pending = h.start()
    await h.started
    h.item({ type: 'commandExecution', id: 'command', command: 'pwd', status: 'inProgress' }, 'started')
    h.item({ type: 'commandExecution', id: 'command', command: 'pwd', aggregatedOutput: '/fixture', exitCode: 0, status: 'completed' })
    h.item({ type: 'fileChange', id: 'foreign-change', changes: [] }, 'completed', THREAD, 'another-turn')
    h.item(completedMcp('harness-receipt'))
    h.item({ type: 'mcpToolCall', id: 'external-mcp', server: 'external', tool: 'lookup', result: { content: [] } })
    h.finish()
    await pending
    expect(h.activities.map(activity => ({ id: activity.id, type: activity.type, phase: activity.phase }))).toEqual([
      { id: `${TURN}:command`, type: 'commandExecution', phase: 'started' },
      { id: `${TURN}:command`, type: 'commandExecution', phase: 'completed' },
      { id: `${TURN}:external-mcp`, type: 'mcpToolCall', phase: 'completed' },
    ])
    expect(h.activities[1]?.detail).toContain('/fixture')
    expect(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/call')).toEqual([])
  })
})
