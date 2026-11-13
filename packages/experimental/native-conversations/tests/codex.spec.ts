/** Real Harness tools and MCP HTTP exercise the native adapter against an explicitly controlled source. */
import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { BlockAssembler, createUserMessage, LlmAdapter, type ContentBlock, type GenerateOptions, type StreamChunk, type UserMessage } from '@deepseek-ai/dsh-llm'
import AttachmentStore, { AttachmentId, type ImageAttachmentRef, type SaveImageAttachment, type StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
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
import { createAgentMessage, createSettlementMessage } from '@deepseek-ai/dsh-subagent/src/continuation-messages.ts'
import { admittedNativeInputIds, nativeStepInputProjection } from '../src/projection.ts'

const THREAD = 'existing-source-thread'
const TURN = 'owned-source-turn'

class UnusedAdapter extends LlmAdapter {
  override async *stream(): AsyncIterable<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } }
}

/** Owned bytes without filesystem, decoding, or an untyped service replacement. Uploads are outside this adapter seam. */
class FixtureImages extends AttachmentStore {
  readonly imageLimits = { maxImageBytes: 1024, maxImagesPerMessage: 2, maxMessageImageBytes: 2048,
    maxImagePixels: 1, maxImageDimension: 1, mediaTypes: ['image/png'] as const }
  readonly images = new Map<AttachmentId, StoredImageAttachment>()
  readonly readImage = vi.fn(async (ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> => {
    signal?.throwIfAborted()
    const image = this.images.get(ref.attachmentId)
    if (image === undefined) throw new Error('The owned fixture image is unavailable')
    return image
  })
  async validateImage(_input: SaveImageAttachment): Promise<void> { throw new Error('Adapter tests must not upload images') }
  async saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> { throw new Error('Adapter tests must not upload images') }
}

interface FixtureInput {
  readonly content?: ContentBlock[]
  readonly history?: readonly UserMessage[]
  readonly drive?: boolean
  readonly system?: string
  readonly frameworkInputs?: readonly UserMessage[]
}

const sourceModels = [
  { model: 'text-model', inputModalities: ['text', 'audio'] },
  { model: 'vision-model', inputModalities: ['text', 'image', 'video'] },
  { model: 'image-model', inputModalities: ['image'] },
  { model: 'audio-only-model', inputModalities: ['audio'] },
  { model: 'hidden-model', inputModalities: ['text'], hidden: true },
].map(model => ({ displayName: model.model, description: 'Source modality fixture', hidden: false,
  supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }], defaultReasoningEffort: 'medium', ...model }))

async function fixture(tools: readonly ToolDefinition[] = [], holdAcknowledgement = false, inputOptions: FixtureInput = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const stepInputs = await ctx.sessionProjections.register(nativeStepInputProjection)
  ctx.llm.registerAdapter(['fixture'], new UnusedAdapter())
  await ctx.plugin(ApprovalService)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: process.cwd() })
  await ctx.plugin(CodexAppServer, CodexAppServer.Config({ sourceHome: process.cwd() }))
  const loop = await mountAgentLoopTestHarness(ctx)
  const agent = await loop.create(SessionId('native-adapter-fixture'), { provider: 'fixture', model: 'fixture' })
  for (const tool of tools) ctx.tools.register(tool)
  const history = inputOptions.history ?? []
  if (history.length > 0) {
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    for (const message of history) agent.session.append('user/message', message, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  }
  let turn = history.length > 0 ? 2 : 1
  let step = 1
  if (!inputOptions.drive) {
    agent.session.append('turn/start', { turn })
    agent.session.append('step/start', { turn, step })
  }
  const input = createUserMessage({ source: { kind: 'user' }, content: inputOptions.content ?? [{ type: 'text', text: 'Continue this original chat.' }] })
  if (!inputOptions.drive) agent.session.append('user/message', input, { surfaceOp: 'append' })
  for (const message of inputOptions.frameworkInputs ?? []) agent.session.append('user/message', message, { surfaceOp: 'append' })
  const admission = await ctx.tools.resolve({ agent, modelSelection: { provider: CODEX_PROVIDER, model: 'fixture' }, signal: new AbortController().signal })
  const schemas = ctx.tools.schemas(agent, admission)
  admission.dispose()
  const notifications = new Set<(notification: CodexNotification) => void>()
  const handlers = new Map<CodexServerRequestMethod, CodexServerRequestHandler>()
  const requests: { method: CodexMethod; params: CodexJsonObject }[] = []
  const started = Promise.withResolvers<undefined>()
  const secondStarted = Promise.withResolvers<undefined>()
  let starts = 0
  const acknowledge = Promise.withResolvers<undefined>()
  const interrupted = Promise.withResolvers<undefined>()
  const controller = new AbortController()
  const streams = new Set<Promise<StreamChunk[]>>()
  const clients: Client[] = []
  const activities: NativeCodexActivity[] = []
  const barriers = new Map<string, () => void>()
  let nextBarrier = 0
  let endpoint: { url: string; authorization: string } | undefined
  const observed = vi.fn()
  const binding: NativeConversationBinding = { source: 'codex', sourceId: brandString<NativeConversationId>(THREAD), title: 'Existing fixture', model: null, cwd: null }
  vi.spyOn(ctx.codexAppServer, 'onNotification').mockImplementation((listener) => { notifications.add(listener); return () => { notifications.delete(listener) } })
  vi.spyOn(ctx.codexAppServer, 'onStatus').mockImplementation(() => () => {})
  vi.spyOn(ctx.codexAppServer, 'setRequestHandler').mockImplementation((method, handler) => {
    handlers.set(method, handler)
    return () => { handlers.delete(method) }
  })
  vi.spyOn(ctx.codexAppServer, 'request').mockImplementation(async (method, params) => {
    requests.push({ method, params })
    if (method === 'model/list') return { data: sourceModels }
    if (method === 'thread/read') return { thread: { id: THREAD, status: { type: 'idle' } } }
    if (method === 'thread/turns/list') return { data: [] }
    if (method === 'thread/resume') {
      const config = z.object({
        mcp_servers: z.object({ skeinlet: z.object({ url: z.string(), http_headers: z.object({ Authorization: z.string() }) }) }),
      }).parse(params.config)
      endpoint = { url: config.mcp_servers.skeinlet.url, authorization: config.mcp_servers.skeinlet.http_headers.Authorization }
      return {}
    }
    if (method === 'mcpServerStatus/list') {
      if (endpoint === undefined) throw new Error('The scoped MCP endpoint was not configured')
      return { data: [{ name: 'skeinlet', runtimeStatus: 'connected', httpOrigin: new URL(endpoint.url).origin,
        tools: Object.fromEntries(schemas.map(schema => [schema.name, {}])), toolsError: null }] }
    }
    if (method === 'turn/start') {
      starts++
      started.resolve(undefined)
      if (starts === 2) secondStarted.resolve(undefined)
      if (holdAcknowledgement) await acknowledge.promise
      return { turn: { id: TURN } }
    }
    if (method === 'turn/interrupt') { interrupted.resolve(undefined); return {} }
    if (method === 'thread/unsubscribe') return {}
    throw new Error(`Unexpected native fixture method ${method}`)
  })
  const adapter = new CodexConversationAdapter(ctx, { bindingOf: () => binding,
    async bindNew() { throw new Error('Existing-source fixture must not create a thread') },
    requestLog: () => ({ turn, step }), observeOwnedMessages: observed,
    admittedInputs: (owner, position) => admittedNativeInputIds(stepInputs.stateOf(owner.session), position),
    activity(owner, activity) {
      expect(owner).toBe(agent)
      activities.push(activity)
      barriers.get(activity.id)?.()
      barriers.delete(activity.id)
    },
  })
  if (inputOptions.drive) {
    ctx.effect(() => ctx.llm.registerAdapter([CODEX_PROVIDER], adapter))
    ctx.on('agent/request', ({ turn: requestedTurn, step: requestedStep }, next) => {
      turn = requestedTurn
      step = requestedStep
      return next()
    })
  }
  const emit = (method: string, params: CodexJsonObject) => {
    for (const listener of notifications) listener({ generation: 1, method, params })
  }
  const item = (value: CodexJsonObject, phase: 'started' | 'completed' = 'completed', threadId = THREAD, turnId = TURN) => {
    emit(`item/${phase}`, { threadId, turnId, item: value })
  }
  const finish = (status = 'completed') => { emit('turn/completed', { threadId: THREAD, turn: { id: TURN, status } }) }
  const barrier = async () => {
    const id = `fixture-barrier-${++nextBarrier}`
    const done = Promise.withResolvers<undefined>()
    barriers.set(`${TURN}:${id}`, () => { done.resolve(undefined) })
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
    const options: GenerateOptions = { provider: CODEX_PROVIDER, model: 'fixture', sessionId: agent.id,
      messages: [...history, input, ...inputOptions.frameworkInputs ?? []], tools: [...schemas], signal: controller.signal,
      ...inputOptions.system === undefined ? {} : { system: inputOptions.system } }
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
    await peer.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { authorization: endpoint.authorization } },
    }))
    return peer
  }
  onTestFinished(async () => {
    controller.abort()
    acknowledge.resolve(undefined)
    await Promise.allSettled([...streams])
    for (const peer of clients) await peer.close()
    await ctx.fiber.dispose()
  })
  return { ctx, agent, adapter, input, signal: controller.signal, requests, secondStarted: secondStarted.promise,
    started: started.promise, interrupted: interrupted.promise, acknowledge: () => { acknowledge.resolve(undefined) },
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

function contextPayloads(params: CodexJsonObject, kind: 'untrusted' | 'application'): unknown[] {
  const entries = z.record(z.string(), z.object({ kind: z.enum(['untrusted', 'application']),
    name: z.string().optional(), value: z.string(),
  })).parse(params.additionalContext)
  const groups = new Map<string, { part: number; total: number; json: string }[]>()
  for (const entry of Object.values(entries)) {
    expect(Buffer.byteLength(entry.value, 'utf8')).toBeLessThanOrEqual(1000)
    if (entry.kind === 'application') expect(entry.name).toBeUndefined()
    else expect(entry.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/u)
    if (entry.kind !== kind) continue
    const part = z.object({ group: z.string().regex(/^[a-f0-9]{64}$/u), revision: z.string().regex(/^[a-f0-9]{64}$/u),
      part: z.number().int().positive(), total: z.number().int().positive(), json: z.string(),
    })
      .parse(JSON.parse(entry.value))
    const group = `${part.group}:${part.revision}`
    const parts = groups.get(group) ?? []
    parts.push(part); groups.set(group, parts)
  }
  return [...groups.values()].map((parts) => {
    parts.sort((left, right) => left.part - right.part)
    expect(parts.map(part => part.part)).toEqual(parts.map((_part, index) => index + 1))
    expect(parts.every(part => part.total === parts.length)).toBe(true)
    const decoded: unknown = JSON.parse(parts.map(part => part.json).join(''))
    return decoded
  })
}

describe('original Codex adapter continuations', () => {
  it('forwards fresh framework runtime and SDK context with its exact attribution', async () => {
    const runtime = createUserMessage({ source: { kind: 'runtime-context', form: 'snapshot', sections: [] },
      content: [{ type: 'text', text: 'Current working directory guidance.' }] })
    const sdk = createUserMessage({ source: { kind: 'tool-registry' }, content: [{ type: 'text', text: 'New SDK declarations.' }] })
    const h = await fixture([], false, { frameworkInputs: [runtime, sdk] })
    const pending = h.start()
    await h.started
    const input = h.requests.find(request => request.method === 'turn/start')?.params.input
    expect(input).toEqual([
      { type: 'text', text: 'Continue this original chat.', text_elements: [] },
    ])
    const params = h.requests.find(request => request.method === 'turn/start')!.params
    expect(contextPayloads(params, 'untrusted')).toEqual([runtime, sdk].map(message => ({ kind: 'harness-context', message })))
    expect(h.requests.find(request => request.method === 'thread/resume')?.params.developerInstructions).toBeUndefined()
    h.finish()
    await pending
  })

  it('preserves complete multibyte context and trusted policy across bounded ordered fragments', async () => {
    const text = 'SDK 世界🧪 "quoted" \\escaped\n'.repeat(600)
    const message = createUserMessage({ source: { kind: 'runtime-context', form: 'snapshot',
      sections: [{ name: 'SDK instructions', text }],
    }, content: [{ type: 'text', text }] })
    const system = 'Trusted Harness policy 🌍\n'.repeat(600)
    const other = createUserMessage({ source: { kind: 'tool-registry' }, content: [{ type: 'text', text: `Other SDK ${text}` }] })
    const h = await fixture([], false, { frameworkInputs: [message, other], system })
    const pending = h.start()
    await h.started
    const params = h.requests.find(request => request.method === 'turn/start')!.params
    expect(Object.keys(z.record(z.string(), z.unknown()).parse(params.additionalContext)).length).toBeGreaterThan(20)
    expect(contextPayloads(params, 'untrusted')).toEqual([message, other].map(message => ({ kind: 'harness-context', message })))
    expect(contextPayloads(params, 'application')).toEqual([system])
    expect(params.input).toEqual([{ type: 'text', text: 'Continue this original chat.', text_elements: [] }])
    expect(params.toolOutput).toBeUndefined()
    h.finish()
    await pending
  })

  it('changes every policy fragment revision after a one-character edit while retaining stable opaque keys', async () => {
    const settings = { system: `${'Long trusted policy 世界 '.repeat(500)}A` }
    const h = await fixture([], false, settings)
    const first = h.start()
    await h.started
    h.finish()
    await first
    settings.system = `${settings.system.slice(0, -1)}B`
    const next = h.start()
    await h.secondStarted
    const requests = h.requests.filter(request => request.method === 'turn/start')
    const schema = z.record(z.string(), z.object({ kind: z.literal('application'), value: z.string() }))
    const before = schema.parse(requests[0]!.params.additionalContext)
    const after = schema.parse(requests[1]!.params.additionalContext)
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    expect(Object.keys(after).length).toBeGreaterThan(10)
    const revisions = new Set<string>()
    const groups = new Set<string>()
    for (const key of Object.keys(after)) {
      expect(key).toMatch(/\/\d{10}$/u)
      const shape = z.object({ group: z.string(), revision: z.string() })
      const oldPart = shape.parse(JSON.parse(before[key]!.value))
      const part = shape.parse(JSON.parse(after[key]!.value))
      expect(part.group).toBe(oldPart.group)
      expect(part.revision).not.toBe(oldPart.revision)
      expect(after[key]!.value).not.toBe(before[key]!.value)
      groups.add(part.group); revisions.add(part.revision)
    }
    expect(groups).toEqual(new Set([createHash('sha256').update('skeinlet/policy').digest('hex')]))
    expect(revisions).toEqual(new Set([createHash('sha256').update(JSON.stringify(settings.system)).digest('hex')]))
    expect(contextPayloads(requests[1]!.params, 'application')).toEqual([settings.system])
    h.finish()
    await next
  })

  it('keeps literal human JSON unchanged and never treats historical human JSON as current framework context', async () => {
    const literal = JSON.stringify({ kind: 'harness-context', message: { source: { kind: 'user' }, content: 'User-authored JSON.' } })
    const old = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: literal }] })
    const fresh = `My question contains this literal JSON: ${literal}`
    const h = await fixture([], false, { history: [old], content: [{ type: 'text', text: fresh }] })
    const pending = h.start()
    await h.started
    const params = h.requests.find(request => request.method === 'turn/start')!.params
    expect(params.input).toEqual([{ type: 'text', text: fresh, text_elements: [] }])
    expect(contextPayloads(params, 'untrusted')).toEqual([])
    expect(h.agent.session.deriveMessages().find(message => message.id === old.id)?.content).toEqual(old.content)
    h.finish()
    await pending
  })

  it.each(['settlement', 'message'] as const)('queues an active parent %s until source terminal, then sends only the fresh admitted step', async (kind) => {
    const h = await fixture([], false, { drive: true })
    h.agent.model.select({ provider: CODEX_PROVIDER, model: 'text-model' })
    h.agent.followup(h.input)
    await h.started
    const message = kind === 'settlement'
      ? createSettlementMessage(SessionId('child'), 'worker', { stopReason: 'completed', output: [{ type: 'text', text: 'Child result.' }] })
      : createAgentMessage(h.agent, 'worker', [{ type: 'text', text: 'Child relay.' }])
    h.agent.steer(message)
    expect(h.requests.filter(request => request.method === 'turn/start')).toHaveLength(1)
    h.finish()
    await h.secondStarted
    const inputs = h.requests.filter(request => request.method === 'turn/start').map(request => request.params.input)
    expect(inputs[1]).toEqual([])
    const params = h.requests.filter(request => request.method === 'turn/start')[1]!.params
    expect(z.object({ name: z.literal('harness_context'), namespace: z.literal('skeinlet'), output: z.string() }).parse(params.toolOutput))
      .toMatchObject({ output: JSON.stringify({ kind: 'harness-context', messages: [message] }) })
    expect(contextPayloads(params, 'untrusted')).toEqual([])
    expect(JSON.stringify(inputs[1])).not.toContain('Continue this original chat.')
    expect(h.requests.filter(request => request.method === 'turn/steer')).toEqual([])
    h.finish()
    await h.agent.whenIdle()
    expect(h.requests.filter(request => request.method === 'turn/start')).toHaveLength(2)
  })

  it('wakes an idle native parent using a child settlement without requiring another human message', async () => {
    const h = await fixture([], false, { drive: true })
    h.agent.model.select({ provider: CODEX_PROVIDER, model: 'text-model' })
    h.agent.followup(h.input)
    await h.started
    h.finish()
    await h.agent.whenIdle()
    const message = createSettlementMessage(SessionId('child'), 'worker', { stopReason: 'completed', output: [{ type: 'text', text: 'Idle child result.' }] })
    h.agent.followup(message)
    await h.secondStarted
    const input = h.requests.filter(request => request.method === 'turn/start')[1]?.params.input
    expect(input).toEqual([])
    const params = h.requests.filter(request => request.method === 'turn/start')[1]!.params
    const output = z.object({ name: z.literal('harness_context'), output: z.string() }).parse(params.toolOutput)
    expect(JSON.parse(output.output)).toEqual({ kind: 'harness-context', messages: [message] })
    expect(contextPayloads(params, 'untrusted')).toEqual([])
    expect(JSON.stringify(input)).not.toContain('Continue this original chat.')
    h.finish()
    await h.agent.whenIdle()
  })

  it('refuses attributed images before source mutation instead of relabeling them as human input', async () => {
    const context = createUserMessage({ source: { kind: 'runtime-context', form: 'snapshot', sections: [] },
      content: [{ type: 'image', attachment: { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
        mediaType: 'image/png', bytes: 12, width: 1, height: 1,
      } }],
    })
    const h = await fixture([], false, { frameworkInputs: [context] })
    await expect(h.start()).rejects.toThrow('context channel accepts attributed text only')
    expect(h.requests.some(request => request.method === 'thread/resume' || request.method === 'turn/start')).toBe(false)
  })

  it('reads only fresh owned image bytes and preserves text/image order in the exact source turn input', async () => {
    const data = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64')
    const fresh: ImageAttachmentRef = { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: data.byteLength, width: 1, height: 1 }
    const old: ImageAttachmentRef = { ...fresh, attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`) }
    const history = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Old image already belongs to the original chat.' }, { type: 'image', attachment: old }] })
    const h = await fixture([], false, { history: [history], content: [
      { type: 'text', text: 'Before fresh image.' }, { type: 'image', attachment: fresh }, { type: 'text', text: 'After fresh image.' },
    ] })
    await h.ctx.plugin(FixtureImages)
    const images = h.ctx.attachments as FixtureImages
    images.images.set(fresh.attachmentId, { ref: fresh, data })
    const pending = h.start()
    await h.started
    expect(images.readImage).toHaveBeenCalledExactlyOnceWith(fresh, h.signal)
    // Generated UserInput permits an omitted detail; detail is not a nullable field.
    expect(h.requests.find(request => request.method === 'turn/start')?.params.input).toEqual([
      { type: 'text', text: 'Before fresh image.', text_elements: [] },
      { type: 'image', url: `data:image/png;base64,${data.toString('base64')}` },
      { type: 'text', text: 'After fresh image.', text_elements: [] },
    ])
    h.finish()
    await pending
  })

  it('fails an unreadable fresh attachment before resuming or starting any source thread or turn', async () => {
    const unavailable: ImageAttachmentRef = { attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`), mediaType: 'image/png', bytes: 68, width: 1, height: 1 }
    const h = await fixture([], false, { content: [{ type: 'text', text: 'Inspect the image.' }, { type: 'image', attachment: unavailable }] })
    await h.ctx.plugin(FixtureImages)
    const images = h.ctx.attachments as FixtureImages
    await expect(h.start()).rejects.toThrow('The owned fixture image is unavailable')
    expect(images.readImage).toHaveBeenCalledExactlyOnceWith(unavailable, h.signal)
    expect(h.requests).toEqual([])
  })

  it('reports only text/image modalities actually advertised by each source model', async () => {
    const h = await fixture()
    const expected = [
      ['text-model', ['text']], ['vision-model', ['text', 'image']], ['image-model', ['image']], ['audio-only-model', []],
    ]
    expect((await h.adapter.listModels(CODEX_PROVIDER)).map(model => [model.id, model.inputModalities])).toEqual(expected)
    for (const model of sourceModels.filter(model => !model.hidden)) {
      const resolved = await h.adapter.resolveModel(CODEX_PROVIDER, model.model)
      expect(resolved.inputModalities).toEqual(model.inputModalities.filter(modality => modality === 'text' || modality === 'image'))
    }
    expect(h.requests.every(request => request.method === 'model/list' && request.params.includeHidden === false)).toBe(true)
  })

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
    const contexts = result.content.flatMap((block) => {
      if (block.type !== 'text' || !block.text.includes('harness-deferred-context')) return []
      const context: unknown = JSON.parse(block.text)
      return [context]
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

  it.each(['interrupted', 'failed'])('rejects a source %s outcome when Harness did not conclude the turn', async (status) => {
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
