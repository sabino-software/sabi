/** One authenticated loopback MCP endpoint dispatching through an Agent's normal tool executor. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import { HarnessError, ToolCallId, type ContentBlock, type ToolSchema } from '@deepseek-ai/dsh-llm'
import type { ToolBatchResult } from '@deepseek-ai/dsh-tools'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createMcpHandler, McpServer, ProtocolError, INVALID_PARAMS, type CallToolResult, type Tool } from '@modelcontextprotocol/server'
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node'

/** Agent and committed model step whose tools the native model may invoke. */
export interface HarnessMcpOptions {
  readonly ctx: Context
  readonly agent: Agent
  readonly schemas: readonly ToolSchema[]
  readonly instructions: string
  readonly modelSelection: { readonly provider: string; readonly model: string }
  readonly log: { readonly turn: number; readonly step: number }
  readonly signal: AbortSignal
  /** Must consume deferred context and turn conclusions before the native model continues. */
  readonly onBatch?: (batch: ToolBatchResult) => void | Promise<void>
  /** Runs after the tool result's HTTP response finishes; never await endpoint.close() inside it. */
  readonly onBatchDelivered?: (batch: ToolBatchResult) => void | Promise<void>
}

/** Credentials exist only in memory for this model turn. */
export interface HarnessMcpEndpoint {
  readonly url: string
  readonly token: string
  /** Abort and drain tool calls before releasing step admission and the HTTP endpoint. */
  close(): Promise<void>
}

interface ExecutedCall {
  readonly batch: ToolBatchResult
  readonly result: CallToolResult
}

interface ResponseDelivery {
  readonly batches: ToolBatchResult[]
}

function denied(response: ServerResponse, status: number): void {
  response.writeHead(status, { 'cache-control': 'no-store', ...(status === 401 ? { 'www-authenticate': 'Bearer' } : {}) }).end()
}

async function content(block: ContentBlock, ctx: Context, signal: AbortSignal): Promise<CallToolResult['content'][number]> {
  if (block.type === 'text') return { type: 'text', text: block.text }
  if (block.type === 'image') {
    const attachments = ctx.get('attachments')
    if (attachments !== undefined) {
      try {
        const image = await attachments.readImage(block.attachment, signal)
        return { type: 'image', data: Buffer.from(image.data).toString('base64'), mimeType: image.ref.mediaType }
      } catch (_unavailableImage: unknown) {
        signal.throwIfAborted()
      }
    }
  }
  return { type: 'text', text: JSON.stringify(block) }
}

/**
 * Publish exactly one model step's tools without replacing the native thread's developer instructions.
 * @param options - Bound Agent, declared tool schemas, committed log position, and turn lifetime.
 * @returns An authenticated ephemeral endpoint; close drains its accepted requests and tools.
 */
export async function startHarnessMcp(options: HarnessMcpOptions): Promise<HarnessMcpEndpoint> {
  options.signal.throwIfAborted()
  const { ctx, agent } = options
  const lifetime = new AbortController()
  const signal = AbortSignal.any([options.signal, lifetime.signal])
  const schemas = new Map(options.schemas.map(schema => [schema.name, schema]))
  const tools: Tool[] = options.schemas.map(schema => {
    if (schema.parameters.type !== 'object') throw new HarnessError('Native MCP tools require object input schemas.', 'NATIVE_MCP_SCHEMA')
    return { name: schema.name, description: schema.description, inputSchema: schema.parameters as Tool['inputSchema'] }
  })
  const toolSet = await ctx.agents.withInitiator(agent, () => ctx.tools.resolve({ agent, modelSelection: options.modelSelection, signal }))
  const token = randomBytes(32).toString('base64url')
  const credential = Buffer.from(`Bearer ${token}`)
  const calls = new Set<Promise<ExecutedCall>>()
  const requests = new Set<Promise<void>>()
  const responses = new Set<Promise<void>>()
  const deliveryScope = new AsyncLocalStorage<ResponseDelivery>()
  let deliveryFailed = false
  let concluded = false
  // Native MCP requests arrive individually; serialize them so exclusive Harness tools cannot overlap.
  let queue: Promise<void> = Promise.resolve()
  let authorities = new Set<string>()
  let closing: Promise<void> | undefined

  const execute = async (name: string, args: Record<string, unknown>, requestSignal: AbortSignal): Promise<ExecutedCall> => {
    const active = AbortSignal.any([signal, requestSignal])
    active.throwIfAborted()
    if (concluded) throw new ProtocolError(INVALID_PARAMS, 'The Harness tool batch concluded this turn; no further tools are admitted.')
    const batch = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
      calls: [{ type: 'tool-call', id: ToolCallId(`native_mcp_${randomUUID()}`), name, arguments: JSON.stringify(args) }],
      agent, log: options.log, signal: active, toolSet,
    }))
    concluded ||= batch.concluded
    if (options.onBatch !== undefined) await options.onBatch(batch)
    else if (batch.additionalContexts.length > 0 || batch.concluded) {
      throw new HarnessError('Native tool context requires an owning continuation handler.', 'NATIVE_MCP_CONTEXT_UNHANDLED')
    }
    const result = batch.results[0]?.result
    if (result === undefined) throw new HarnessError('The tool executor omitted its result.', 'NATIVE_MCP_RESULT_MISSING')
    const projected = await Promise.all(result.content.map(block => content(block, ctx, active)))
    for (const message of batch.additionalContexts) {
      projected.push({ type: 'text', text: JSON.stringify({ kind: 'harness-deferred-context', message }) })
    }
    return { batch, result: { isError: result.isError, content: projected } }
  }

  const handler = createMcpHandler(() => {
    const mcp = new McpServer({ name: 'skeinlet-harness', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: options.instructions })
    mcp.server.setRequestHandler('tools/list', () => ({ tools }))
    mcp.server.setRequestHandler('tools/call', async (request, context) => {
      signal.throwIfAborted()
      if (!schemas.has(request.params.name)) throw new ProtocolError(INVALID_PARAMS, 'This tool is not declared for the current model step.')
      const delivery = deliveryScope.getStore()
      if (delivery === undefined) throw new HarnessError('The MCP response has no delivery owner.', 'NATIVE_MCP_DELIVERY_SCOPE')
      const run = queue.then(() => execute(request.params.name, request.params.arguments ?? {}, context.mcpReq.signal))
      calls.add(run)
      queue = run.then(() => {}, () => {})
      try {
        const completed = await run
        const result = mcp.server.projectCallToolResult(completed.result, undefined)
        delivery.batches.push(completed.batch)
        return result
      }
      finally { calls.delete(run) }
    })
    return mcp
  })
  const handle = toNodeHandler(handler)

  const admit = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (signal.aborted) { denied(response, 503); return }
    if (request.headers.origin !== undefined || !authorities.has(request.headers.host ?? '')) { denied(response, 403); return }
    const supplied = Buffer.from(request.headers.authorization ?? '')
    if (supplied.length !== credential.length || !timingSafeEqual(supplied, credential)) { denied(response, 401); return }
    if (request.url !== '/mcp') { denied(response, 404); return }
    await handle(request as NodeIncomingMessageLike, response)
  }

  const server = createServer((request, response) => {
    const delivery: ResponseDelivery = { batches: [] }
    const completion = Promise.withResolvers<void>()
    let finished = false
    responses.add(completion.promise)
    void completion.promise.then(() => { responses.delete(completion.promise) })
    response.once('finish', () => {
      finished = true
      const delivered = async (): Promise<void> => {
        if (response.statusCode < 200 || response.statusCode >= 300) return
        for (const batch of delivery.batches) await options.onBatchDelivered?.(batch)
      }
      void delivered().then(completion.resolve, (_deliveryFailure: unknown) => {
        deliveryFailed = true
        ctx.logger.warn('A native MCP result delivery callback failed.')
        completion.resolve()
      })
    })
    response.once('close', () => { if (!finished) completion.resolve() })
    const pending = deliveryScope.run(delivery, () => admit(request, response)).catch((_requestFailure: unknown) => {
      if (!response.headersSent) denied(response, 500)
      else response.destroy()
    })
    requests.add(pending)
    void pending.finally(() => { requests.delete(pending) })
  })

  const close = (): Promise<void> => {
    closing ??= (async () => {
      lifetime.abort(new HarnessError('The native model turn has ended.', 'NATIVE_MCP_CLOSED'))
      options.signal.removeEventListener('abort', cancelled)
      const stopped = new Promise<void>((resolve, reject) => {
        server.close(error => { if (error === undefined) resolve(); else reject(error) })
      })
      server.closeIdleConnections()
      try {
        const closingHandler = Promise.resolve().then(() => handler.close())
        await Promise.allSettled([closingHandler, ...calls, ...requests])
        await Promise.allSettled([...responses])
        await closingHandler
        if (deliveryFailed) throw new HarnessError('A native MCP delivery callback failed.', 'NATIVE_MCP_DELIVERY')
      } finally {
        server.closeAllConnections()
        try { await stopped }
        finally { toolSet.dispose() }
      }
    })()
    return closing
  }
  const cancelled = (): void => {
    void close().catch((_cleanupFailure: unknown) => { ctx.logger.warn('A native MCP endpoint could not finish closing.') })
  }

  try {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new HarnessError('The native MCP endpoint did not obtain a loopback port.', 'NATIVE_MCP_LISTEN')
    authorities = new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`, `[::1]:${address.port}`])
    options.signal.addEventListener('abort', cancelled, { once: true })
    signal.throwIfAborted()
    return { url: `http://127.0.0.1:${address.port}/mcp`, token, close }
  } catch (error: unknown) {
    if (server.listening) await close()
    else { await handler.close(); toolSet.dispose() }
    throw error
  }
}
