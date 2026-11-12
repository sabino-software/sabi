/** A real Unix WebSocket daemon double exercises native connection and request ownership. */
import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import CodexAppServer, { CodexAppServerError } from '../src/index.ts'
import type { CodexJsonObject, CodexMethod } from '../src/types.ts'

async function fixture(options: {
  readonly handle?: (frame: CodexJsonObject, socket: WebSocket) => void
  readonly timeout?: number
  readonly expectedHome?: string
  readonly maxPendingRequests?: number
} = {}) {
  const home = mkdtempSync(join(tmpdir(), 'codex-native-'))
  const path = join(home, 'daemon.sock')
  const http = createServer()
  const server = new WebSocketServer({ server: http })
  const received: CodexJsonObject[] = []
  const clients: WebSocket[] = []
  server.on('connection', socket => {
    clients.push(socket)
    socket.on('message', bytes => {
      const frame = JSON.parse(String(bytes)) as CodexJsonObject
      received.push(frame)
      if (frame.method === 'initialize') {
        socket.send(JSON.stringify({ id: frame.id, result: { codexHome: options.expectedHome ?? home, userAgent: 'fixture', platformFamily: 'unix', platformOs: 'macos' } }))
      } else if (frame.id !== undefined && frame.method !== undefined) {
        if (options.handle !== undefined) options.handle(frame, socket)
        else socket.send(JSON.stringify({ id: frame.id, result: { data: [], nextCursor: null } }))
      }
    })
  })
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(path, resolve) })
  const ctx = new Context()
  await ctx.plugin(CodexAppServer, CodexAppServer.Config({ sourceHome: home, socketPath: path,
    connectTimeoutMs: 2000, requestTimeoutMs: options.timeout ?? 1000,
    serverRequestTimeoutMs: 2000, maxPendingRequests: options.maxPendingRequests ?? 10 }))
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    for (const socket of clients) socket.terminate()
    await new Promise<void>(resolve => { server.close(() => { http.close(() => { resolve() }) }) })
    rmSync(home, { recursive: true, force: true })
  })
  return { ctx, native: ctx.codexAppServer, received, clients, home }
}

describe('native work Codex connection', () => {
  it('attaches lazily, initializes once, preserves official fields, and registers disposable observers', async () => {
    const { native, received, clients } = await fixture()
    expect(native.status().state).toBe('disconnected')
    expect(clients).toHaveLength(0)
    const states: string[] = []
    const disposeStatus = native.onStatus(status => { states.push(status.state) })
    const notifications: string[] = []
    const disposeNotifications = native.onNotification(notification => { notifications.push(notification.method) })
    expect(await native.request('thread/list', { limit: 10, useStateDbOnly: true })).toEqual({ data: [], nextCursor: null })
    await native.request('thread/read', { threadId: 'saved-thread', includeTurns: false })
    expect(received.filter(frame => frame.method === 'initialize')).toHaveLength(1)
    expect(received.findIndex(frame => frame.method === 'initialized')).toBeLessThan(received.findIndex(frame => frame.method === 'thread/list'))
    expect(states).toEqual(['disconnected', 'connecting', 'ready'])
    clients[0]?.send(JSON.stringify({ method: 'thread/status/changed', params: { threadId: 'saved-thread', status: { type: 'idle' } } }))
    await vi.waitFor(() => { expect(notifications).toEqual(['thread/status/changed']) })
    disposeNotifications()
    disposeStatus()
    clients[0]?.send(JSON.stringify({ method: 'turn/completed', params: { threadId: 'saved-thread', turn: { id: 'turn-1' } } }))
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(notifications).toHaveLength(1)
  })

  it('refuses unchecked configuration operations before connecting', async () => {
    const { native, clients } = await fixture()
    await expect(native.request('config/value/write' as CodexMethod, {})).rejects.toMatchObject({ code: 'CODEX_METHOD_UNSUPPORTED' })
    expect(clients).toHaveLength(0)
  })

  it('verifies the daemon home before sending any thread operation', async () => {
    const { native, received } = await fixture({ expectedHome: tmpdir() })
    await expect(native.request('thread/read', { threadId: 'saved-thread' })).rejects.toMatchObject({ code: 'CODEX_WRONG_HOME' })
    expect(received.some(frame => frame.method === 'thread/read')).toBe(false)
  })

  it('declines unattended approvals and lets the owning dynamic tool handler answer original IDs', async () => {
    const { native, clients, received } = await fixture()
    await native.connect()
    clients[0]?.send(JSON.stringify({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'saved-thread', turnId: 'turn-1' } }))
    await vi.waitFor(() => { expect(received.find(frame => frame.id === 'approval-1')?.result).toEqual({ decision: 'cancel' }) })
    const handler = vi.fn(async (_params, context) => {
      expect(context.id).toBe(42)
      return { success: true, contentItems: [{ type: 'inputText', text: 'Harness result' }] }
    })
    const dispose = native.setRequestHandler('item/tool/call', handler)
    expect(() => native.setRequestHandler('item/tool/call', handler)).toThrow(CodexAppServerError)
    clients[0]?.send(JSON.stringify({ id: 42, method: 'item/tool/call', params: { threadId: 'saved-thread', turnId: 'turn-1', tool: 'fixture_tool', arguments: {} } }))
    await vi.waitFor(() => { expect(received.find(frame => frame.id === 42)?.result).toMatchObject({ success: true }) })
    dispose()
  })

  it('aborts resolved server requests and ignores late answers', async () => {
    const { native, clients, received } = await fixture()
    const answer = Promise.withResolvers<CodexJsonObject>()
    let requestSignal: AbortSignal | undefined
    native.setRequestHandler('item/tool/requestUserInput', async (_params, context) => {
      requestSignal = context.signal
      return answer.promise
    })
    await native.connect()
    clients[0]?.send(JSON.stringify({ id: 'question-1', method: 'item/tool/requestUserInput', params: { threadId: 'saved-thread', turnId: 'turn-1', questions: [] } }))
    await vi.waitFor(() => { expect(requestSignal).toBeDefined() })
    clients[0]?.send(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'saved-thread', requestId: 'question-1' } }))
    await vi.waitFor(() => { expect(requestSignal?.aborted).toBe(true) })
    answer.resolve({ answers: {} })
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(received.some(frame => frame.id === 'question-1')).toBe(false)
  })

  it('reports unknown mutation outcomes after timeout without retrying or interrupting the turn', async () => {
    const { native, received } = await fixture({ timeout: 25, handle: () => {} })
    await expect(native.request('turn/start', { threadId: 'saved-thread', input: [{ type: 'text', text: 'fixture only' }] }))
      .rejects.toMatchObject({ code: 'CODEX_TIMEOUT', outcomeUnknown: true })
    expect(received.filter(frame => frame.method === 'turn/start')).toHaveLength(1)
    expect(received.some(frame => frame.method === 'turn/interrupt')).toBe(false)
  })

  it('reconnects only on a later explicit request, without replaying a lost mutation', async () => {
    const { native, clients, received } = await fixture({ handle: (frame, socket) => {
      if (frame.method === 'turn/start') socket.terminate()
      else socket.send(JSON.stringify({ id: frame.id, result: { thread: { id: 'saved-thread' } } }))
    } })
    await expect(native.request('turn/start', { threadId: 'saved-thread', input: [] }))
      .rejects.toMatchObject({ code: 'CODEX_DISCONNECTED', outcomeUnknown: true })
    expect(native.status().state).toBe('disconnected')
    expect(clients).toHaveLength(1)
    await native.request('thread/read', { threadId: 'saved-thread' })
    expect(clients).toHaveLength(2)
    expect(received.filter(frame => frame.method === 'turn/start')).toHaveLength(1)
    expect(native.status().generation).toBe(2)
  })

  it('bounds concurrent requests and abandons a read without an unknown mutation outcome', async () => {
    const { native, received } = await fixture({ maxPendingRequests: 1, handle: () => {} })
    await native.connect()
    const controller = new AbortController()
    const first = native.request('thread/read', { threadId: 'saved-thread' }, controller.signal)
    const rejected = expect(first).rejects.toMatchObject({ code: 'CODEX_CANCELLED', outcomeUnknown: false })
    await vi.waitFor(() => { expect(received.some(frame => frame.method === 'thread/read')).toBe(true) })
    await expect(native.request('thread/list', {})).rejects.toMatchObject({ code: 'CODEX_LIMIT' })
    controller.abort()
    await rejected
  })
})
