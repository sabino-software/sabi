/** Real loop, MCP HTTP, executor and JSONL storage preserve one audited execution per native call. */
import { Context } from '@deepseek-ai/cordis'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, expandAssistantStream, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { startHarnessMcp } from '../src/mcp.ts'

const FINAL_TEXT = 'Native prefix. Native final answer.'

/** MCP calls happen inside one native model stream; only text returns through the outer loop. */
class NativeMcpAdapter extends LlmAdapter {
  readonly receipts: unknown[] = []
  streams = 0
  constructor(private readonly ctx: Context) { super() }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.streams++
    if (options.sessionId === undefined) throw new Error('Native MCP fixture requires an Agent')
    const agent = this.ctx.agents.get(options.sessionId)
    if (agent === undefined) throw new Error('Native MCP fixture Agent is unavailable')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Native prefix. ' }
    const endpoint = await startHarnessMcp({ ctx: this.ctx, agent, schemas: options.tools ?? [],
      instructions: options.system ?? '', modelSelection: { provider: options.provider, model: options.model },
      log: { turn: 1, step: 1 }, signal: options.signal ?? new AbortController().signal,
    })
    const client = new Client({ name: 'native-audit-fixture', version: '1.0.0' })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: { authorization: `Bearer ${endpoint.token}` } } }))
      for (const text of ['first native result', 'second native result']) {
        const result = await client.callTool({ name: 'echo', arguments: { text } })
        expect(result).toMatchObject({ isError: false, content: [{ type: 'text', text }] })
        this.receipts.push(result._meta?.['skeinlet/receipt'])
      }
    } finally { await client.close(); await endpoint.close() }
    yield { type: 'text-delta', index: 0, text: 'Native final answer.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: FINAL_TEXT } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function verify(events: readonly SessionEvent[], receipts: readonly unknown[]): void {
  const calls = events.filter(event => event.type === 'tool/call')
  const results = events.filter(event => event.type === 'tool/result')
  const assistants = events.filter(event => event.type === 'assistant/message')
  const advertisements = assistants.filter(event => event.data.message.content.some(block => block.type === 'tool-call'))
  const final = assistants.filter(event => event.data.message.content.some(block => block.type === 'text'))
  expect(calls).toHaveLength(2)
  expect(results).toHaveLength(2)
  expect(advertisements).toHaveLength(2)
  expect(final).toHaveLength(1)
  expect(final[0]?.data.message.content).toEqual([{ type: 'text', text: FINAL_TEXT }])
  expect(events.filter(event => event.type === 'step/start')).toHaveLength(1)
  expect(events.filter(event => event.type === 'step/end')).toHaveLength(1)
  expect(events.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { reason: { kind: 'completed' } } }])
  expect(receipts).toEqual(calls.map(event => event.data.callId))
  for (const [index, call] of calls.entries()) {
    const advertised = advertisements[index]
    const result = results[index]
    expect(advertised?.data).toMatchObject({ turn: call.data.turn, step: call.data.step, message: {
      content: [{ type: 'tool-call', id: call.data.callId, name: call.data.name, arguments: call.data.arguments }],
    } })
    expect(advertised?.seq).toBeLessThan(call.seq)
    expect(result?.data.message.toolCallId).toBe(call.data.callId)
    expect(result?.seq).toBeGreaterThan(call.seq)
    expect(final[0]?.seq).toBeGreaterThan(result!.seq)
    expect(expandAssistantStream(advertised!.data.stream).at(-1)?.chunk).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  }
}

describe('native MCP audited persistence', () => {
  it.each(['none', 'zstd'] as const)('closes and reopens v4 JSONL after two MCP calls and one native final answer (%s)', async compression => {
    const root = await mkdtemp(join(tmpdir(), 'native-mcp-audit-'))
    const ctx = new Context()
    const reopened = new Context()
    onTestFinished(async () => {
      try { await reopened.fiber.dispose(); await ctx.fiber.dispose() }
      finally { await rm(root, { recursive: true, force: true }) }
    })
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlPersistence, { root, compression })
    const adapter = new NativeMcpAdapter(ctx)
    ctx.llm.registerAdapter(['native-fixture'], adapter)
    const executions: string[] = []
    ctx.tools.register(defineTool({ name: 'echo', description: 'Echo the native model request.', parameters: { text: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) { executions.push(args.text); return args.text },
    }))
    const loop = await mountAgentLoopTestHarness(ctx)
    const agent = await loop.create(SessionId('native-mcp-audit'), { provider: 'native-fixture', model: 'fixture' })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use two tools, then answer.' }] }))
    await agent.whenIdle()
    expect(adapter.streams).toBe(1)
    expect(executions).toEqual(['first native result', 'second native result'])
    const original = agent.session.snapshotEvents()
    verify(original, adapter.receipts)
    // The real AgentLoop owns the live JSONL write handle; flush and dispose it before opening a new process context.
    expect(await ctx.sessions.flush(agent.session)).toBe(true)
    await ctx.fiber.dispose()
    await reopened.plugin(JsonlPersistence, { root, compression })
    for (const access of ['read', 'write'] as const) {
      const handle = await reopened.sessionPersistence.open(agent.id, access)
      try {
        const stored = await handle.read()
        const restored = Session.fromRestore(agent.id, stored.events, handle.header, handle.inheritedEventCount, stored.eventState)
        expect(restored.snapshotEvents()).toEqual(original)
        verify(stored.events, adapter.receipts)
      } finally { await handle.close() }
    }
    expect(executions).toHaveLength(2)
  })
})
