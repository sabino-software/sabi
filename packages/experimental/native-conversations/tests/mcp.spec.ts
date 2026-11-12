/** Real MCP HTTP requests use Agent-scoped admission, ordinary tool policies, and durable logs. */
import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { ServerResponse } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { createUserMessage, LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { PtcRuntime, type PtcRunRequest, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool, RUN_CODE_NAME, type ToolBatchResult, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { startHarnessMcp } from '../src/mcp.ts'
import type { HarnessMcpEndpoint } from '../src/mcp.ts'

class UnusedAdapter extends LlmAdapter {
  override async *stream(): AsyncIterable<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } }
}

/** The real PTC executor owns bindings and policies; this fixture selects which binding the program invokes. */
class ConditionalRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fixture'
  readonly admitted: string[][] = []
  resolve(request: PtcRunRequest): PtcRunSpec { return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 120_000 } }
  async run(request: PtcRunRequest) {
    const functions = request.bindings[0]!.functions
    this.admitted.push(Object.keys(functions))
    const name = request.program === 'await tools.activate({})' ? 'activate' : 'conditional'
    const invoke = functions[name]
    if (invoke === undefined) return { output: [], error: { kind: 'exception' as const, message: `${name} is not admitted` } }
    try { return { output: [{ type: 'text' as const, text: JSON.stringify(await invoke({})) }] } }
    catch (error: unknown) { return { output: [], error: { kind: 'exception' as const, message: error instanceof Error ? error.message : String(error) } } }
  }
}

async function fixture(tools: readonly ToolDefinition[] = [], onBatch?: (batch: ToolBatchResult) => void | Promise<void>,
  onBatchDelivered?: (batch: ToolBatchResult) => void | Promise<void>) {
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
    ...onBatchDelivered === undefined ? {} : { onBatchDelivered },
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
  it('refreshes conditional PTC admission between calls while preserving the catalog, deferred SDK guidance, and live guards', async () => {
    const ctx = new Context()
    provideWorkingDirectoryFixture(ctx)
    await ctx.plugin(ConditionalRuntime)
    await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'ptc' } })
    ctx.llm.registerAdapter(['fixture'], new UnusedAdapter())
    const loop = await mountAgentLoopTestHarness(ctx)
    const modelSelection = { provider: 'fixture', model: 'fixture' }
    const agent = await loop.create(SessionId(`native-conditional-${randomUUID()}`), modelSelection)
    agent.session.append('turn/start', { turn: 1 })
    let enabled = false
    let conditionalCalls = 0
    ctx.tools.register(defineContentToolFixture({ name: 'activate', description: 'Load a conditional capability.', parameters: {},
      async execute(_args, exec) {
        enabled = true
        exec.deferContext(createUserMessage({ content: [{ type: 'text', text: 'SDK: tools.conditional({}) is now available.' }], source: { kind: 'tool-registry' } }))
        return [{ type: 'text', text: 'activated' }]
      },
    }))
    ctx.tools.register(defineContentToolFixture({ name: 'conditional', description: 'An activated capability.', parameters: {},
      async execute() { conditionalCalls++; return [{ type: 'text', text: 'conditional result' }] },
    }), { when: () => enabled })
    const signal = new AbortController().signal
    const admission = await ctx.tools.resolve({ agent, modelSelection, signal })
    const assembly = await ctx.systemPrompt.assemble({ ...assembleContextFor(agent, signal), modelSelection, toolSet: admission })
    admission.dispose()
    expect(assembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    const endpoint = await startHarnessMcp({ ctx, agent, schemas: assembly.tools, instructions: 'Stable PTC transport.', modelSelection,
      log: { turn: 1, step: 1 }, signal,
      onBatch: batch => { for (const message of batch.additionalContexts) agent.session.append('user/message', message, { surfaceOp: 'append' }) },
    })
    const client = new Client({ name: 'native-conditional-test', version: '1.0.0' })
    onTestFinished(async () => { await client.close(); await endpoint.close(); await ctx.fiber.dispose() })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: { authorization: `Bearer ${endpoint.token}` } } }))
    const initialCatalog = await client.listTools()
    const run = (code: string) => client.callTool({ name: RUN_CODE_NAME, arguments: { code, description: 'Exercise conditional admission.' } })
    const activated = await run('await tools.activate({})')
    expect(activated.isError).toBe(false)
    expect(JSON.stringify(activated)).toContain('harness-deferred-context')
    expect(JSON.stringify(activated)).toContain('SDK: tools.conditional({}) is now available.')
    expect((ctx.ptcRuntime as ConditionalRuntime).admitted[0]).not.toContain('conditional')
    expect(JSON.stringify(await run('await tools.conditional({})'))).toContain('conditional result')
    expect((ctx.ptcRuntime as ConditionalRuntime).admitted[1]).toContain('conditional')
    expect(conditionalCalls).toBe(1)
    expect(await client.listTools()).toEqual(initialCatalog)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/ptc-dispatch').map(event => event.data)).toMatchObject([
      { name: 'activate', isError: false }, { name: 'conditional', isError: false },
    ])
    ctx.tools.guard(exec => exec.name === 'conditional' ? { reason: 'Conditional access denied by Harness.', info: { name: 'FixtureDenial', code: 'FIXTURE_DENIED' } } : undefined)
    expect(JSON.stringify(await run('await tools.conditional({})'))).toContain('Conditional access denied by Harness.')
    expect(conditionalCalls).toBe(1)
    enabled = false
    expect((await run('await tools.conditional({})')).isError).toBe(true)
    expect((ctx.ptcRuntime as ConditionalRuntime).admitted.at(-1)).not.toContain('conditional')
    expect(conditionalCalls).toBe(1)
  })

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
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: '{"type":"reasoning","text":"Structured content"}' })
    const context = result.content[1]
    expect(context?.type).toBe('text')
    if (context?.type !== 'text') throw new Error('The deferred context was not delivered as MCP text')
    expect(JSON.parse(context.text)).toMatchObject({ kind: 'harness-deferred-context', message: {
      role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Deferred guidance' }],
    } })
    expect(batches).toHaveLength(1)
    expect(batches[0]?.concluded).toBe(true)
    expect(batches[0]?.additionalContexts[0]?.content).toEqual([{ type: 'text', text: 'Deferred guidance' }])
    await expect((await h.client()).callTool({ name: 'conclude', arguments: {} })).rejects.toThrow()
    expect(batches).toHaveLength(1)
  })

  it('reports batch delivery only after the actual tool HTTP response finishes', async () => {
    const trace: string[] = []
    let batchCompleted = false
    const h = await fixture([defineContentToolFixture({ name: 'finish', description: 'Finish this turn.', parameters: {},
      async execute(_args, exec) { exec.concludeTurn(); return [{ type: 'text', text: 'complete' }] },
    })], () => { batchCompleted = true; trace.push('batch') }, () => { trace.push('delivered') })
    const client = await h.client()
    const originalEmit = ServerResponse.prototype.emit
    const emitted = vi.spyOn(ServerResponse.prototype, 'emit').mockImplementation(function (this: ServerResponse, event, ...args) {
      if (batchCompleted && event === 'finish') trace.push('http-finish')
      return originalEmit.call(this, event, ...args)
    })
    try {
      expect((await client.callTool({ name: 'finish', arguments: {} })).isError).toBe(false)
      await vi.waitFor(() => { expect(trace).toContain('delivered') })
      expect(trace.indexOf('batch')).toBeLessThan(trace.indexOf('http-finish'))
      expect(trace.indexOf('http-finish')).toBeLessThan(trace.indexOf('delivered'))
    } finally { emitted.mockRestore() }
  })

  it('drains response-delivery callbacks during close and refuses calls after a concluded batch', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let laterCalls = 0
    const h = await fixture([
      defineContentToolFixture({ name: 'finish', description: 'Finish this turn.', parameters: {},
        async execute(_args, exec) { exec.concludeTurn(); return [{ type: 'text', text: 'complete' }] },
      }),
      defineContentToolFixture({ name: 'later', description: 'Must not run after completion.', parameters: {},
        async execute() { laterCalls++; return [{ type: 'text', text: 'unexpected' }] },
      }),
    ], () => {}, async () => { entered.resolve(); await release.promise })
    const client = await h.client()
    await client.callTool({ name: 'finish', arguments: {} })
    await entered.promise
    await expect(client.callTool({ name: 'later', arguments: {} })).rejects.toThrow()
    expect(laterCalls).toBe(0)
    let closed = false
    const closing = h.endpoint.close().then(() => { closed = true })
    try {
      await Promise.resolve()
      expect(closed).toBe(false)
    } finally { release.resolve() }
    await closing
    expect(closed).toBe(true)
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
