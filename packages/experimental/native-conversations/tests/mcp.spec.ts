/** Real MCP HTTP requests use Agent-scoped admission, ordinary tool policies, and durable logs. */
import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolBatchResult, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { startHarnessMcp } from '../src/mcp.ts'
import type { HarnessMcpEndpoint } from '../src/mcp.ts'

class UnusedAdapter extends LlmAdapter {
  override async *stream(): AsyncIterable<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } }
}

async function fixture(tools: readonly ToolDefinition[] = [], onBatch?: (batch: ToolBatchResult) => void | Promise<void>) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['fixture'], new UnusedAdapter())
  const loop = await mountAgentLoopTestHarness(ctx)
  const agent = await loop.create(SessionId(`native-mcp-${randomUUID()}`), { provider: 'fixture', model: 'fixture' })
  agent.session.append('turn/start', { turn: 1 })
  for (const tool of tools) ctx.tools.register(tool)
  const controller = new AbortController()
  const admission = await ctx.tools.resolve({ agent, modelSelection: { provider: 'fixture', model: 'fixture' }, signal: controller.signal })
  const schemas = ctx.tools.schemas(agent, admission)
  admission.dispose()
  const endpoint = await startHarnessMcp({ ctx, agent, schemas, instructions: 'Follow the committed Harness system guidance.',
    modelSelection: { provider: 'fixture', model: 'fixture' }, log: { turn: 1, step: 3 }, signal: controller.signal,
    ...onBatch === undefined ? {} : { onBatch },
  })
  const clients: Client[] = []
  const client = async (target: HarnessMcpEndpoint = endpoint) => {
    const peer = new Client({ name: 'native-mcp-test', version: '1.0.0' })
    clients.push(peer)
    await peer.connect(new StreamableHTTPClientTransport(new URL(target.url), { requestInit: { headers: { authorization: `Bearer ${target.token}` } } }))
    return peer
  }
  onTestFinished(async () => {
    for (const peer of clients) await peer.close()
    await endpoint.close()
    await ctx.fiber.dispose()
  })
  return { ctx, agent, controller, endpoint, client, schemas }
}

describe('native Harness MCP tools', () => {
  it('exposes the exact step schemas and system guidance, and logs real tool execution under its Agent', async () => {
    const body = vi.fn(async (value: string) => value)
    const tool = defineTool({ name: 'echo', description: 'Repeat text.', parameters: { text: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) { return body(args.text) },
    })
    const h = await fixture([tool])
    h.ctx.on('tools/pre-execute', (exec, next) => {
      expect(exec.agent).toBe(h.agent)
      expect(h.ctx.agents.requireInitiator()).toBe(h.agent)
      return next()
    })
    const client = await h.client()
    const listed = await client.listTools()
    expect(listed.tools).toEqual(h.schemas.map(schema => ({ name: schema.name, description: schema.description, inputSchema: schema.parameters })))
    expect(client.getInstructions()).toBe('Follow the committed Harness system guidance.')
    expect(await client.callTool({ name: 'echo', arguments: { text: 'saved output' } })).toMatchObject({ isError: false, content: [{ type: 'text', text: 'saved output' }] })
    expect(body).toHaveBeenCalledExactlyOnceWith('saved output')
    const events = h.agent.session.snapshotEvents()
    expect(events.find(event => event.type === 'tool/call')).toMatchObject({ type: 'tool/call', data: { turn: 1, step: 3, name: 'echo', arguments: '{"text":"saved output"}' } })
    expect(events.find(event => event.type === 'tool/result')).toMatchObject({ type: 'tool/result', data: { turn: 1, step: 3, message: { isError: false } } })
  })

  it('requires its bearer token, rejects every browser Origin and non-loopback Host, and never puts credentials in URLs', async () => {
    const { endpoint } = await fixture()
    expect(Buffer.from(endpoint.token, 'base64url')).toHaveLength(32)
    expect(endpoint.url).not.toContain(endpoint.token)
    expect((await fetch(endpoint.url, { method: 'POST' })).status).toBe(401)
    expect((await fetch(endpoint.url, { method: 'POST', headers: { authorization: 'Bearer incorrect' } })).status).toBe(401)
    expect((await fetch(endpoint.url, { method: 'POST', headers: { authorization: `Bearer ${endpoint.token}`, origin: 'http://localhost' } })).status).toBe(403)
    expect((await fetch(endpoint.url, { method: 'POST', headers: { authorization: `Bearer ${endpoint.token}`, host: 'external.invalid' } })).status).toBe(403)
    expect((await fetch(`${endpoint.url}/other`, { method: 'POST', headers: { authorization: `Bearer ${endpoint.token}` } })).status).toBe(404)
  })

  it('rejects unknown tool names and preserves ordinary argument validation and guard denials', async () => {
    let calls = 0
    const tool = defineTool({ name: 'validated', description: 'A guarded operation.', parameters: { text: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) { calls++; return args.text },
    })
    const h = await fixture([tool])
    const client = await h.client()
    await expect(client.callTool({ name: 'not_declared', arguments: {} })).rejects.toThrow()
    expect(await client.callTool({ name: 'validated', arguments: {} })).toMatchObject({ isError: true })
    h.ctx.tools.guard(() => ({ reason: 'Denied by the normal policy.', info: { name: 'FixtureDenial', code: 'FIXTURE_DENIED' } }))
    const denied = await client.callTool({ name: 'validated', arguments: { text: 'blocked' } })
    expect(denied).toMatchObject({ isError: true })
    expect(JSON.stringify(denied)).toContain('Denied by the normal policy.')
    expect(calls).toBe(0)
    expect(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(2)
  })

  it('preserves unsupported content as JSON and reports deferred contexts and turn conclusions to the adapter', async () => {
    const batches: ToolBatchResult[] = []
    const tool = defineContentToolFixture({ name: 'conclude', description: 'Finish with context.', parameters: {},
      async execute(_args, exec) {
        exec.deferContext(createUserMessage({ content: [{ type: 'text', text: 'Deferred guidance' }], source: { kind: 'user' } }))
        exec.concludeTurn()
        return [{ type: 'reasoning', text: 'Structured content' }]
      },
    })
    const h = await fixture([tool], batch => { batches.push(batch) })
    const result = await (await h.client()).callTool({ name: 'conclude', arguments: {} })
    expect(result).toMatchObject({ isError: false, content: [{ type: 'text', text: '{"type":"reasoning","text":"Structured content"}' }] })
    expect(batches).toHaveLength(1)
    expect(batches[0]?.concluded).toBe(true)
    expect(batches[0]?.additionalContexts[0]?.content).toEqual([{ type: 'text', text: 'Deferred guidance' }])
  })

  it('fails closed if a caller omits deferred-context handling', async () => {
    const h = await fixture([defineContentToolFixture({ name: 'ending', description: 'Conclude.', parameters: {},
      async execute(_args, exec) { exec.concludeTurn(); return [{ type: 'text', text: 'ended' }] },
    })])
    await expect((await h.client()).callTool({ name: 'ending', arguments: {} })).rejects.toThrow()
  })

  it('aborts and drains a started tool before close resolves, with no endpoint left listening', async () => {
    const entered = Promise.withResolvers<void>()
    let drained = false
    const h = await fixture([defineTool({ name: 'wait', description: 'Wait for cancellation.', parameters: {},
      output: { schema: { type: 'string' } },
      async execute(_args, exec) {
        entered.resolve()
        await new Promise<void>(resolve => { exec.signal.addEventListener('abort', () => { setTimeout(() => { drained = true; resolve() }, 10) }, { once: true }) })
        return 'drained'
      },
    })])
    const client = await h.client()
    const pending = client.callTool({ name: 'wait', arguments: {} }).catch(() => null)
    await entered.promise
    const closing = h.endpoint.close()
    expect(h.endpoint.close()).toBe(closing)
    await closing
    expect(drained).toBe(true)
    await pending
    await expect(fetch(h.endpoint.url)).rejects.toThrow()
  })
})
