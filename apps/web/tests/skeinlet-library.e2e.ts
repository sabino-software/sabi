/** Assembled native conversations use ordinary sidebar rows, source messages and the real composer. */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { WebSocketServer, type WebSocket } from 'ws'
import { expect, it, onTestFinished } from 'vitest'
import type { AxiomSendRequest, AxiomSendResult, AxiomSnapshot } from '../../desktop/src/axiom-protocol.ts'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, revealNavigationDrawer, REPO_ROOT } from './support.ts'

type Json = Record<string, unknown>
function object(value: unknown): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid native fixture object')
  return value as Json
}

/** Fixture traffic uses the actual authenticated, turn-scoped MCP endpoint emitted by the adapter. */
async function mcpCatalog(server: Json): Promise<Json[]> {
  const url = new URL(String(server.url))
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Fixture MCP must remain on loopback')
  const headers: Record<string, string> = {
    authorization: String(object(server.http_headers).Authorization), 'content-type': 'application/json', accept: 'application/json, text/event-stream',
  }
  let sequence = 0
  const request = async (method: string, params: Json, notification = false): Promise<Json> => {
    const id = `native-fixture-${String(++sequence)}`
    const response = await fetch(url, { method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', ...notification ? {} : { id }, method, params }), signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`Native fixture MCP request failed (${String(response.status)})`)
    const session = response.headers.get('mcp-session-id')
    if (session !== null) headers['mcp-session-id'] = session
    if (notification) { await response.body?.cancel(); return {} }
    const body = await response.text()
    const envelopes: unknown[] = response.headers.get('content-type')?.includes('text/event-stream')
      ? body.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as unknown)
      : [JSON.parse(body) as unknown]
    const envelope = envelopes.map(object).find(value => value.id === id)
    return object(envelope?.result)
  }
  const initialized = await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'native-web-fixture', version: '1' } })
  headers['mcp-protocol-version'] = String(initialized.protocolVersion)
  await request('notifications/initialized', {}, true)
  const tools = (await request('tools/list', {})).tools
  if (!Array.isArray(tools)) throw new Error('Native fixture MCP catalog omitted tools')
  return tools.map(object)
}

async function codexFixture(root: string) {
  const home = join(root, 'source-home')
  const workspace = join(root, 'native-e2e-workspace')
  await mkdir(home)
  await mkdir(workspace)
  const socketPath = join(root, 'source.sock')
  const http = createServer()
  const server = new WebSocketServer({ server: http })
  const clients = new Set<WebSocket>()
  const frames: Json[] = []
  const failures: unknown[] = []
  let tools: Json[] = []
  let mcpOrigin = ''
  const thread = { id: 'existing-codex-thread', name: 'Existing work coding chat', preview: 'An original work conversation',
    cwd: workspace, model: 'fixture-model', createdAt: 1700000000, canAcceptDirectInput: true, status: { type: 'idle' } }
  server.on('connection', (socket) => {
    clients.add(socket)
    socket.on('close', () => { clients.delete(socket) })
    socket.on('message', (bytes) => {
      const text = Array.isArray(bytes) ? Buffer.concat(bytes).toString('utf8')
        : bytes instanceof ArrayBuffer ? new TextDecoder().decode(bytes) : bytes.toString('utf8')
      const frame = object(JSON.parse(text))
      frames.push(frame)
      if (frame.id === undefined) return
      void (async () => {
        const params = object(frame.params ?? {})
        let result: Json
        switch (frame.method) {
          case 'initialize': result = { codexHome: home, userAgent: 'keyless-native-web-fixture', platformFamily: 'unix', platformOs: process.platform }; break
          case 'account/read': result = { account: { type: 'chatgpt' } }; break
          case 'model/list': result = { data: [{ model: 'fixture-model', displayName: 'Fixture work model', description: 'Keyless fixture',
            hidden: false, isDefault: true, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }], defaultReasoningEffort: 'low' }], nextCursor: null }; break
          case 'thread/list': result = { data: [thread], nextCursor: null }; break
          case 'thread/read': result = { thread }; break
          case 'thread/turns/list': result = { data: [], nextCursor: null }; break
          case 'thread/items/list': result = params.cursor === 'answer-page'
            ? { data: [{ item: { type: 'agentMessage', id: 'old-answer', text: 'Original work answer from the source.' } }], nextCursor: null }
            : { data: [{ item: { type: 'userMessage', id: 'old-question', content: [{ type: 'text', text: 'Original work question from the source.' }] } }], nextCursor: 'answer-page' }; break
          case 'thread/resume': {
            const endpoint = object(object(object(params.config).mcp_servers).skeinlet)
            tools = await mcpCatalog(endpoint)
            mcpOrigin = new URL(String(endpoint.url)).origin
            result = { thread }; break
          }
          case 'mcpServerStatus/list': result = { data: [{ name: 'skeinlet', runtimeStatus: 'connected', httpOrigin: mcpOrigin,
            tools: Object.fromEntries(tools.map(tool => [String(tool.name), tool])), toolsError: null }], nextCursor: null }; break
          case 'thread/unsubscribe': result = {}; break
          case 'turn/start': {
            result = { turn: { id: 'continued-source-turn', status: 'inProgress' } }
            socket.send(JSON.stringify({ id: frame.id, result }))
            const params = { threadId: thread.id, turnId: 'continued-source-turn' }
            socket.send(JSON.stringify({ method: 'item/started', params: { ...params, item: { id: 'new-question', type: 'userMessage' } } }))
            socket.send(JSON.stringify({ method: 'item/agentMessage/delta', params: { ...params, itemId: 'new-answer', delta: 'Continued original work answer.' } }))
            socket.send(JSON.stringify({ method: 'item/completed', params: { ...params, item: { id: 'new-answer', type: 'agentMessage', text: 'Continued original work answer.' } } }))
            socket.send(JSON.stringify({ method: 'turn/completed', params: { ...params, turn: { id: params.turnId, status: 'completed' } } }))
            return
          }
          default: throw new Error(`Unexpected native fixture method: ${String(frame.method)}`)
        }
        socket.send(JSON.stringify({ id: frame.id, result }))
      })().catch((error: unknown) => {
        failures.push(error)
        socket.send(JSON.stringify({ id: frame.id, error: { code: -32603, message: 'Native fixture failed' } }))
      })
    })
  })
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(socketPath, resolve) })
  return { home, workspace, socketPath, frames, failures, catalog: () => tools,
    async close() {
      for (const client of clients) client.terminate()
      await new Promise<void>((resolve) => { server.close(() => { http.close(() => { resolve() }) }) })
    },
  }
}

/** Only fixture-authored source observations cross the same transport used by Electron. */
class OriginalAxiomFixture {
  readonly sent: AxiomSendRequest[] = []
  private queue = Promise.resolve()
  private state: AxiomSnapshot = { source: 'chatgpt-web', url: 'https://chatgpt.com/dots/keyless~fixture', title: 'Existing Axiom conversation',
    revision: 1, phase: 'ready', canSend: true, draftPresent: false, siteStatus: null, limited: true,
    messages: [{ id: 'axiom-old-user', role: 'user', text: 'Original Axiom question.', timestamp: null, truncated: false },
      { id: 'axiom-old-assistant', role: 'assistant', text: 'Original **Axiom answer**.', timestamp: null, truncated: false }] }
  async acquire(): Promise<() => void> {
    const previous = this.queue
    const slot = Promise.withResolvers<undefined>()
    this.queue = previous.then(() => slot.promise)
    await previous
    return () => { slot.resolve(undefined) }
  }
  async connect(url: string): Promise<AxiomSnapshot> {
    if (url !== this.state.url) throw new Error('Unexpected fixture Dot selection')
    return this.state
  }
  async snapshot(): Promise<AxiomSnapshot> { return this.state }
  async send(request: AxiomSendRequest): Promise<AxiomSendResult> {
    this.sent.push(request)
    this.state = { ...this.state, revision: this.state.revision + 1, messages: [...this.state.messages,
      { id: 'axiom-new-user', role: 'user', text: request.text, timestamp: null, truncated: false },
      { id: 'axiom-new-assistant', role: 'assistant', text: 'Continued original **Axiom answer**.', timestamp: null, truncated: false }] }
    return { status: 'confirmed', messageId: 'axiom-new-user', snapshot: this.state }
  }
  async showLogin(): Promise<void> { throw new Error('Authenticated fixture must not show a login surface') }
  async disconnect(): Promise<void> {}
}

async function rpc(scaffold: WebScaffold, method: string, args: Json): Promise<unknown> {
  const rpcId = `fixture-${method}`
  const response = await scaffold.hostFetch(`/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }) })
  const envelope = object(await response.json())
  const result = object(envelope.result)
  expect(result.ok, `${method} succeeds through the assembled Remote`).toBe(true)
  return result.value
}

it.skipIf(process.platform === 'win32')('continues original Codex and Axiom chats through ordinary Harness messages and composer', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-web-')))
  const previousFlag = process.env.DSH_NATIVE_CONVERSATIONS
  process.env.DSH_NATIVE_CONVERSATIONS = '1'
  const owned: {
    daemon?: Awaited<ReturnType<typeof codexFixture>>
    scaffold?: WebScaffold
    browser?: Awaited<ReturnType<typeof chromium.launch>>
  } = {}
  onTestFinished(async () => {
    try { await owned.browser?.close(); await owned.scaffold?.close() }
    finally {
      await owned.daemon?.close()
      await rm(root, { recursive: true, force: true })
      if (previousFlag === undefined) Reflect.deleteProperty(process.env, 'DSH_NATIVE_CONVERSATIONS')
      else process.env.DSH_NATIVE_CONVERSATIONS = previousFlag
    }
  })
  const daemon = await codexFixture(root)
  owned.daemon = daemon
  const overlay = join(root, 'native.overlay.yml')
  await writeFile(overlay, `- id: codex-app-server\n  config:\n    sourceHome: ${JSON.stringify(daemon.home)}\n    socketPath: ${JSON.stringify(daemon.socketPath)}\n- id: native-conversations\n  config:\n    fallbackCwd: ${JSON.stringify(daemon.workspace)}\n    axiomPollIntervalMs: 250\n    axiomSettleMs: 500\n`)
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
  owned.scaffold = scaffold
  const source = new OriginalAxiomFixture()
  const native = scaffold.ctx.get('nativeConversations') as { attachAxiomTransport(transport: OriginalAxiomFixture): () => void }
  native.attachAxiomTransport(source)
  await rpc(scaffold, 'nativeConversations/syncCodex', {})
  expect(daemon.frames.some(frame => frame.method === 'thread/items/list' || frame.method === 'turn/start')).toBe(false)
  expect(scaffold.ctx.sessions.list()).toEqual([])

  const browser = await chromium.launch({ headless: true })
  owned.browser = browser
  const page = await newEnglishPage(browser)
  const console = watchConsole(page)
  const captureFailure = async (): Promise<void> => {
    const artifacts = join(REPO_ROOT, '.cache', 'native-browser-e2e')
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'native-chat-failure.png'), fullPage: true })
    await writeFile(join(artifacts, 'native-chat-failure.json'), JSON.stringify({
      text: await page.locator('body').innerText(),
      rows: await page.locator('[data-row-key]').evaluateAll(rows => rows.map(row => row.outerHTML)),
      sessions: await rpc(scaffold, 'session/list', { _request: {} }),
      console,
    }, null, 2))
  }
  try {
    await page.goto(scaffold.authenticatedUrl)
    await revealNavigationDrawer(page, 'en')
    const workspace = page.locator('[data-row-key^="workspace:"]').filter({ hasText: 'native-e2e-workspace' }).first()
    await workspace.waitFor()
    await expect.poll(async () => {
      if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
      return workspace.getAttribute('aria-expanded')
    }, { timeout: 10000 }).toBe('true')
    const codexRow = page.locator('[data-row-key^="session:"]').filter({ hasText: 'Existing work coding chat' })
    await codexRow.getByLabel('Codex', { exact: true }).waitFor()
    expect(daemon.frames.some(frame => frame.method === 'thread/items/list' || frame.method === 'turn/start')).toBe(false)
    const coldCodexKey = await codexRow.getAttribute('data-row-key')
    expect(scaffold.ctx.sessions.list().some(session => `session:${session.id}` === coldCodexKey)).toBe(false)

    await codexRow.click()
    await page.getByText('Original work question from the source.', { exact: true }).waitFor()
    await page.getByText('Original work answer from the source.', { exact: true }).waitFor()
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.fill('Continue this exact work thread.')
    const codexSettled = scaffold.whenTurnSettled(30000)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await codexSettled
    await page.getByText('Continued original work answer.', { exact: true }).waitFor()
    const turns = daemon.frames.filter(frame => frame.method === 'turn/start').map(frame => object(frame.params))
    expect(turns).toHaveLength(1)
    const started = object(turns[0])
    expect(started.threadId).toBe('existing-codex-thread')
    const input = started.input
    if (!Array.isArray(input)) throw new Error('Expected original Codex turn input')
    expect(input[0]).toEqual({ type: 'text', text: 'Continue this exact work thread.', text_elements: [] })
    const framework = input.slice(1).map((value) => {
      const context = object(value)
      expect(context.type).toBe('text')
      expect(context.text_elements).toEqual([])
      if (typeof context.text !== 'string') throw new Error('Expected attributed Harness context')
      const envelope = object(JSON.parse(context.text))
      expect(envelope.kind).toBe('harness-context')
      const message = object(envelope.message)
      expect(object(message.source).kind).not.toBe('user')
      return envelope
    })
    expect(framework.some(envelope => object(object(envelope.message).source).kind === 'runtime-context')).toBe(true)
    expect(JSON.stringify(input)).not.toContain('Original work question from the source.')
    expect(JSON.stringify(input)).not.toContain('Original work answer from the source.')
    expect(daemon.frames.some(frame => frame.method === 'thread/start')).toBe(false)
    expect(daemon.catalog().length).toBeGreaterThan(0)

    const connections = page.getByRole('button', { name: 'Native conversations', exact: true })
    if (await connections.count() > 0) await connections.click()
    else {
      await page.getByRole('button', { name: 'More', exact: true }).first().click()
      await page.getByRole('menuitem', { name: 'Native conversations', exact: true }).click()
    }
    await page.getByRole('heading', { name: 'Native conversations', exact: true }).waitFor()
    const axiomRow = page.locator('[data-row-key^="session:"]').filter({ hasText: 'Existing Axiom conversation' })
    expect(await axiomRow.count()).toBe(0)
    await page.getByRole('textbox', { name: 'Existing ChatGPT Dot URL', exact: true }).fill('https://chatgpt.com/dots/keyless~fixture')
    await page.getByRole('button', { name: 'Connect Axiom', exact: true }).click()
    await page.getByText('Original Axiom question.', { exact: true }).waitFor()
    await page.getByText('Axiom answer', { exact: true }).waitFor()
    await axiomRow.getByLabel('Axiom', { exact: true }).waitFor()
    expect(source.sent).toEqual([])
    await composer.fill('Continue Axiom exactly.\nKeep this second line.')
    const axiomSettled = scaffold.whenTurnSettled(30000)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await axiomSettled
    await page.getByText('Continued original Axiom answer.', { exact: true }).waitFor()
    expect(source.sent.map(request => request.text)).toEqual(['Continue Axiom exactly.\nKeep this second line.'])
    expect(await page.locator('iframe').count()).toBe(0)
    expect(await page.getByText('Read-only source', { exact: true }).count()).toBe(0)
    expect(console.pageErrors).toEqual([])
    expect(daemon.failures).toEqual([])
    const artifacts = join(REPO_ROOT, '.cache', 'native-browser-e2e')
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'native-chat-success.png'), fullPage: true })
  } catch (error) { await captureFailure(); throw error }
})
