/** Native conversation ownership over ordinary Harness Sessions. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as schema } from 'zod'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { mkdir, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { Session, SESSION_FORMAT_VERSION, appendPluginRecord, pluginRecordOf, type SessionId, type SessionHeader, type SessionSeq, type UserMessage } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CodexJsonObject } from '@deepseek-ai/dsh-host-codex-app-server'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { BINDING_RECORD, bindingSchema, nativeConversationProjection, nativeBindingSequenceProjection,
  nativeCodexCutProjection, appendCodexCut, nativeStepInputProjection, admittedNativeInputIds, type NativeStepInputState, type NativeCodexCutState } from './projection.ts'
import { CHECKPOINT_RECORD, appendCodexHistoryTurns, appendSourceMessages, parseCodexHistoryEntries, sourceCheckpointProjection, sourceSessionId, type SourceCheckpoint, type SourceHistoryEntry } from './history.ts'
import { CODEX_PROVIDER, CodexConversationAdapter } from './codex.ts'
import { AxiomAdapter, readAxiomHistory } from './axiom.ts'
import type { AxiomMessagesState, AxiomSnapshot, AxiomTransport } from './axiom-types.ts'
import { appendAxiomMessage, axiomMessagesProjection } from './axiom-messages.ts'
import { createCodexActivityRecorder, type CodexActivityRecorder } from './codex-activity.ts'
import type { NativeConversationBinding, NativeConversationId, NativeConversationStatus } from './types.ts'
import { NativeCodexLoginController } from './codex-login.ts'
import { nativeSourceIndex, type SourceSessionAssignment } from './source-index.ts'
import { rebuildCodexMirror } from './rebuild.ts'

// Cordis derives RPC receivers; the stable lifetime signal keeps controllers off service properties.
const managedLogins = new WeakMap<AbortSignal, NativeCodexLoginController>()

function managedLogin(signal: AbortSignal): NativeCodexLoginController {
  const login = managedLogins.get(signal)
  if (login === undefined) throw new RemoteError('gateway/internal', 'Codex sign-in is unavailable.', {})
  return login
}

function requireOwnerNativeInvocation(ctx: Context, method: 'startCodexLogin' | 'cancelCodexLogin' | 'rebuildCodexMirror'): void {
  const invocation = ctx.invocation
  if (invocation?.peer.principal.kind !== 'owner' || invocation.service !== 'nativeConversations'
    || invocation.request.namespace !== 'nativeConversations' || invocation.request.method !== method) {
    throw new RemoteError('gateway/bad-request', method === 'rebuildCodexMirror'
      ? 'Codex mirror recovery requires its exact owner request.'
      : 'Manage Codex sign-in from the Native conversations panel.', {})
  }
}

/** Native bridges are enabled only in the isolated desktop fork. */
export interface Config {
  /** Directory created when the original conversation has no available workspace. */
  readonly fallbackCwd: string
  /** Interval between read-only completed-turn checks for idle open Codex chats. */
  readonly codexPollIntervalMs: number
  /** Maximum wait for the managed Codex browser callback in milliseconds. */
  readonly codexLoginTimeoutMs: number
  /** Deadline for cancelling this app's exact managed login in milliseconds. */
  readonly codexLoginCancelTimeoutMs: number
  /** Maximum desktop original-page request lifetime in milliseconds. */
  readonly axiomRequestTimeoutMs: number
  /** Interval between original Axiom page observations while its Session is idle. */
  readonly axiomPollIntervalMs: number
  /** Maximum original-page send and acknowledgement lifetime in milliseconds. */
  readonly axiomResponseTimeoutMs: number
  /** Fallback stream settling interval; source-owned desktop messages remain continuously observed. */
  readonly axiomSettleMs: number
}
declare module '@deepseek-ai/cordis' { interface Context { nativeConversations: NativeConversations } }
const sourceThread = schema.object({
  id: schema.string(), name: schema.string().nullable(), preview: schema.string(), cwd: schema.string(),
  model: schema.string().nullable(), createdAt: schema.number(), canAcceptDirectInput: schema.boolean().nullable(),
}).loose()
const threadPage = schema.object({ data: schema.array(sourceThread), nextCursor: schema.string().nullable() }).loose()

/** A source binding is a Session projection; connection state carries no credentials. */
export default class NativeConversations extends TypertRemoteService {
  static inject = ['storageDomain', 'sessionProjections', 'sessionProjectionCache', 'sessionController', 'sessionTitle', 'sessionPersistence', 'sessions', 'workspaceRegistry', 'agents', 'llm', 'codexAppServer', 'tools', 'sandboxPolicy', 'approval', 'userQuestions']
  static Config: z<Partial<Config>, Config> = z.object({
    fallbackCwd: z.string().default(join(homedir(), 'Documents', 'deepseek-harness-default-workspace')),
    codexPollIntervalMs: z.number().min(250).max(30000).default(2000),
    codexLoginTimeoutMs: z.natural().min(1000).max(1800000).default(300000),
    codexLoginCancelTimeoutMs: z.natural().min(1000).max(60000).default(5000),
    axiomRequestTimeoutMs: z.number().min(1000).max(120000).default(30000),
    axiomPollIntervalMs: z.number().min(250).max(5000).default(750),
    axiomResponseTimeoutMs: z.number().min(10000).max(1800000).default(300000),
    axiomSettleMs: z.number().min(500).max(10000).default(1500),
  })
  readonly axiomRequestTimeoutMs: number
  private bindings!: ProjectionHandle<NativeConversationBinding | null>
  private bindingSequences!: ProjectionHandle<SessionSeq | null>
  private sourceCuts!: ProjectionHandle<NativeCodexCutState | null>
  private stepInputs!: ProjectionHandle<NativeStepInputState>
  private checkpoints!: ProjectionHandle<SourceCheckpoint>
  private axiomMessages!: ProjectionHandle<AxiomMessagesState>
  private codexActivity!: CodexActivityRecorder
  private sourceSessions!: KvTable<SessionId, SourceSessionAssignment>
  private readonly observedCodex = new WeakSet<Agent>()
  private axiom: AxiomTransport | undefined
  private axiomPhase = 'disconnected'
  // RPC receivers inherit this shared state; assigning a primitive on a receiver would hide an in-flight sync.
  private readonly synchronization: { task: Promise<{ imported: number }> | undefined } = { task: undefined }
  private readonly rebuilding = { pending: false, ids: new Set<SessionId>() }
  private readonly requestLogs = new Map<SessionId, { turn: number; step: number }>()
  private readonly pendingResponses = new Map<SessionId, { readonly ids: readonly string[]; readonly turnId?: string }>()
  private readonly lifetime = new AbortController()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'nativeConversations')
    this.axiomRequestTimeoutMs = config.axiomRequestTimeoutMs
    const login = new NativeCodexLoginController(this.ctx.codexAppServer, async () => {
      await this.useCodex()
      await this.syncCodex()
    }, { timeoutMs: this.config.codexLoginTimeoutMs, cancelTimeoutMs: this.config.codexLoginCancelTimeoutMs })
    managedLogins.set(this.lifetime.signal, login)
    this.ctx.effect(() => async () => {
      managedLogins.delete(this.lifetime.signal)
      await login.dispose()
    }, 'native-conversations.managed-login')
  }
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(nativeSourceIndex)
    this.ctx.effect(() => () => domain.close(), 'native-conversations.source-index')
    this.sourceSessions = domain.table('sources')
    this.bindings = await this.ctx.sessionProjections.register(nativeConversationProjection)
    this.bindingSequences = await this.ctx.sessionProjections.register(nativeBindingSequenceProjection)
    this.sourceCuts = await this.ctx.sessionProjections.register(nativeCodexCutProjection)
    this.stepInputs = await this.ctx.sessionProjections.register(nativeStepInputProjection)
    this.checkpoints = await this.ctx.sessionProjections.register(sourceCheckpointProjection)
    this.axiomMessages = await this.ctx.sessionProjections.register(axiomMessagesProjection)
    this.codexActivity = await createCodexActivityRecorder(this.ctx)
    this.ctx.on('api-session/has-content', (event) => {
      const record = pluginRecordOf(event)
      return record?.type === BINDING_RECORD && bindingSchema.safeParse(record.data).success ? true : undefined
    })
    const bindingOf = (id: SessionId): NativeConversationBinding | null => {
      const session = this.ctx.sessions.get(id)
      return session ? this.bindings.stateOf(session) : null
    }
    this.ctx.on('agent/model-selecting', ({ agent, selection }) => {
      const binding = this.bindings.stateOf(agent.session)
      if (binding?.source === 'axiom') throw new Error('The original Axiom page owns its model. Change it in ChatGPT.')
      if (binding?.source === 'codex' && selection.provider !== CODEX_PROVIDER) throw new Error('Choose a model from Work Codex to continue this original conversation.')
      return undefined
    })
    this.ctx.on('permission-presets/selecting', (session) => {
      if (this.bindings.stateOf(session)?.source === 'axiom') throw new Error('The original Axiom page owns its permissions. Harness tool permissions do not apply to it.')
      return undefined
    })
    const codex = new CodexConversationAdapter(this.ctx, {
      bindingOf,
      admittedInputs: (agent, position) => admittedNativeInputIds(this.stepInputs.stateOf(agent.session), position),
      bindNew: (agent, value) => this.bindCodex(agent, value),
      requestLog: (id) => {
        const log = this.requestLogs.get(id)
        if (!log) throw new Error('The native request has no committed Harness step')
        return log
      },
      observeOwnedMessages: (agent, users, assistants) => {
        this.markObserved(agent.session, users, false)
        this.pendingResponses.set(agent.id, { ids: assistants })
      },
      completedSourceTurn: (agent, turnId) => {
        const pending = this.pendingResponses.get(agent.id)
        if (pending) this.pendingResponses.set(agent.id, { ...pending, turnId })
      },
      activity: (agent, activity) => { this.codexActivity.append(agent.session, activity) },
    })
    this.ctx.effect(() => this.ctx.llm.registerAdapter([CODEX_PROVIDER], codex))
    const axiom = new AxiomAdapter({
      bindingOf: (id) => { const binding = bindingOf(id); return binding?.source === 'axiom' ? { sourceId: binding.sourceId, url: binding.sourceId } : undefined },
      transport: () => this.axiom,
      userInput: (id, messages) => {
        const session = this.ctx.sessions.get(id)
        const log = this.requestLogs.get(id)
        if (!session || !log) return []
        const admitted = new Set(admittedNativeInputIds(this.stepInputs.stateOf(session), log))
        return messages.filter((message): message is UserMessage => message.role === 'user'
          && 'id' in message && typeof message.id === 'string' && admitted.has(message.id))
          .filter(message => message.source.kind === 'user')
      },
      renderObserved: true,
      onSnapshot: (id, snapshot) => {
        const session = this.ctx.sessions.get(id)
        if (session) this.observeAxiom(session, snapshot, false)
      },
      pollIntervalMs: this.config.axiomPollIntervalMs,
      responseTimeoutMs: this.config.axiomResponseTimeoutMs, settleMs: this.config.axiomSettleMs,
      onCommitted: (id, snapshot, userId, assistantIds) => {
        const session = this.ctx.sessions.get(id)
        if (session) this.markObserved(session, [...userId ? [userId] : [], ...assistantIds], snapshot.limited)
      },
    })
    this.ctx.effect(() => this.ctx.llm.registerAdapter(['axiom-original'], axiom))
    this.ctx.on('agent/created', async ({ agent, signal }) => {
      if (this.rebuilding.ids.has(agent.id)) throw new Error('This local Codex mirror is being explicitly rebuilt.')
      let binding = this.bindings.stateOf(agent.session)
      const bindingSeq = this.bindingSequences.stateOf(agent.session)
      let forked = false
      if (binding && bindingSeq !== null && !agent.session.isOwnSeq(bindingSeq)) {
        if (binding.source !== 'codex') throw new Error('Fork this original Axiom conversation in its original application before continuing the copied Session.')
        const cut = this.sourceCuts.stateOf(agent.session)
        if (!cut || cut.sourceId !== binding.sourceId || agent.session.isOwnSeq(cut.seq)) {
          throw new Error('This copied Codex Session has no verified complete original-turn cut. Fork it in Codex or complete a new turn before copying it.')
        }
        // A cut inside later commentary, prose, tools, or input cannot silently select an older original turn.
        const partial = cut.inheritedPartial || (cut.lastEvidenceSeq !== null && cut.lastEvidenceSeq > cut.seq
          && !agent.session.isOwnSeq(cut.lastEvidenceSeq))
        if (partial) throw new Error('The copied Session ends inside an original Codex turn. Select its completed turn boundary instead.')
        const response = await this.ctx.codexAppServer.request('thread/fork', {
          threadId: binding.sourceId, lastTurnId: cut.turnId, excludeTurns: true, deferGoalContinuation: true,
          config: { mcp_servers: { skeinlet: { enabled: false } } },
        }, signal)
        const thread = schema.record(schema.string(), schema.json()).parse(response.thread)
        if (thread.id === binding.sourceId) throw new Error('Codex did not create an independent fork; the copied Session was not rebound.')
        binding = await this.bindCodex(agent, thread)
        forked = true
      }
      if (binding && !forked) await this.hydrate(agent, binding, signal)
      if (binding?.source === 'axiom') this.watchAxiom(agent, binding)
      if (binding?.source === 'codex') this.watchCodex(agent, binding)
      return undefined
    })
    this.ctx.on('agent/request', async ({ agent, turn, step }, next) => {
      this.requestLogs.set(agent.session.id, { turn, step })
      return next()
    })
    this.ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (frame.type !== 'end') return
      const pending = this.pendingResponses.get(agent.id)
      this.pendingResponses.delete(agent.id)
      if (pending && frame.outcome.kind === 'committed' && frame.outcome.eventType === 'assistant/message') {
        this.markObserved(agent.session, pending.ids, false)
        const binding = this.bindings.stateOf(agent.session)
        if (pending.turnId && binding?.source === 'codex') appendCodexCut(agent.session, { sourceId: binding.sourceId, turnId: pending.turnId })
      }
    })
    this.ctx.on('agent/disposed', ({ agent }) => { this.requestLogs.delete(agent.session.id); this.pendingResponses.delete(agent.id) })
    this.ctx.effect(() => {
      // List metadata in the background; failure is visible through the connection panel.
      const startup = this.syncCodex().catch(() => {})
      return async () => { this.lifetime.abort(); await startup; await this.synchronization.task?.catch(() => {}) }
    })
  }

  /**
   * Attach only the desktop-owned original-page transport; credentials stay in its browser session.
   * @param transport Original-page operations owned by this desktop Host.
   * @returns Disposer that detaches only this transport.
   */
  attachAxiomTransport(transport: AxiomTransport): () => void {
    if (this.axiom) throw new Error('The original-page transport is already attached')
    this.axiom = transport
    return () => { if (this.axiom === transport) { this.axiom = undefined; this.axiomPhase = 'disconnected' } }
  }
  /**
   * Read connection state without starting or resuming a conversation.
   * @returns Credential-free connection status.
   */
  @Remote
  async status(): Promise<NativeConversationStatus> {
    const authenticated = await this.workAccountReady()
    const status = this.ctx.codexAppServer.status()
    return { codex: { login: managedLogin(this.lifetime.signal).status(), connected: status.state === 'ready', authenticated, selected: this.ctx.get('agentDefaultModel')?.currentSelection().provider === CODEX_PROVIDER, error: status.reason }, axiom: { available: this.axiom !== undefined, phase: this.axiomPhase }, syncing: this.synchronization.task !== undefined }
  }
  /**
   * Start managed login after an explicit owner action; Codex owns OAuth and the local callback.
   * @returns The ephemeral authorization link for the owner's regular browser, without credentials.
   */
  @Remote
  async startCodexLogin(): Promise<{ authUrl: string }> {
    requireOwnerNativeInvocation(this.ctx, 'startCodexLogin')
    return await managedLogin(this.lifetime.signal).start()
  }
  /** Cancel only the pending login created by this service. */
  @Remote
  async cancelCodexLogin(): Promise<void> {
    requireOwnerNativeInvocation(this.ctx, 'cancelCodexLogin')
    await managedLogin(this.lifetime.signal).cancel()
  }
  private async workAccountReady(): Promise<boolean> {
    try {
      const response = await this.ctx.codexAppServer.request('account/read', { refreshToken: false }, this.lifetime.signal)
      return schema.object({ account: schema.object({ type: schema.string() }).loose().nullable() }).loose().parse(response).account?.type === 'chatgpt'
    } catch (_unavailableAccount: unknown) { return false }
  }
  /** Select the real work subscription for new Harness chats after the user's explicit welcome action. */
  @Remote
  async useCodex(): Promise<void> {
    if (!await this.workAccountReady()) throw new RemoteError('gateway/internal', 'Sign in to your work Codex app before using its subscription here.', {})
    const defaults = this.ctx.get('agentDefaultModel')
    if (!defaults) throw new RemoteError('gateway/internal', 'This deployment cannot save a default model.', {})
    const response = await this.ctx.codexAppServer.request('model/list', { includeHidden: false }, this.lifetime.signal)
    const models = schema.array(schema.object({
      model: schema.string(), hidden: schema.boolean(), isDefault: schema.boolean(),
    }).loose()).parse(response.data).filter(model => !model.hidden)
    const selected = models.find(model => model.isDefault) ?? models[0]
    if (!selected) throw new RemoteError('gateway/internal', 'The work Codex account has no available models.', {})
    await defaults.saveSelection({ provider: CODEX_PROVIDER, model: selected.model })
  }
  /**
   * Refresh source metadata into ordinary workspace sidebar rows.
   * @returns Count of newly imported Sessions.
   */
  @Remote
  syncCodex(): Promise<{ imported: number }> {
    if (this.rebuilding.pending) throw new RemoteError('gateway/bad-request', 'Wait for explicit Codex mirror recovery before synchronizing.', {})
    this.synchronization.task ??= this.importCodex().finally(() => { this.synchronization.task = undefined })
    return this.synchronization.task
  }
  /**
   * Replace one inactive derived mirror; its archived log remains local audit evidence.
   * This compensates caught failures, but interruption can leave recoverable navigation/index state.
   * @param sessionId - Explicitly selected old local mirror, never an original Codex thread id.
   * @returns New mirror and archived evidence identities; no local tool or approval records are replayed.
   */
  @Remote
  async rebuildCodexMirror(sessionId: SessionId): Promise<{ sessionId: SessionId; archivedSessionId: SessionId }> {
    requireOwnerNativeInvocation(this.ctx, 'rebuildCodexMirror')
    if (this.rebuilding.pending || this.synchronization.task !== undefined) {
      throw new RemoteError('gateway/bad-request', 'Wait for the current native conversation operation before rebuilding.', {})
    }
    this.rebuilding.pending = true
    this.rebuilding.ids.add(sessionId)
    try { return await rebuildCodexMirror(this.ctx, this.sourceSessions, sessionId, this.rebuilding.ids) }
    finally { this.rebuilding.pending = false; this.rebuilding.ids.delete(sessionId) }
  }
  private async importCodex(): Promise<{ imported: number }> {
    let cursor: string | null = null
    const cursors = new Set<string>()
    let imported = 0
    do {
      const page = threadPage.parse(await this.ctx.codexAppServer.request('thread/list', { limit: 100, cursor, modelProviders: [], useStateDbOnly: true, archived: false }, this.lifetime.signal))
      for (const thread of page.data) {
        this.lifetime.signal.throwIfAborted()
        if (thread.canAcceptDirectInput === false) continue
        if (await this.ensureStored(this.codexBinding(thread), thread.createdAt * 1000)) imported++
      }
      cursor = page.nextCursor
      if (cursor && cursors.has(cursor)) throw new Error('Codex returned a repeated history cursor')
      if (cursor) cursors.add(cursor)
    } while (cursor)
    return { imported }
  }
  private codexBinding(thread: schema.infer<typeof sourceThread>): NativeConversationBinding {
    return { source: 'codex', sourceId: brandString<NativeConversationId>(thread.id), title: thread.name || thread.preview.slice(0, 120) || 'Codex conversation', model: thread.model, cwd: thread.cwd }
  }
  private async bindCodex(agent: Agent, value: CodexJsonObject): Promise<NativeConversationBinding> {
    const binding = this.codexBinding(sourceThread.parse(value))
    appendPluginRecord(agent.session, BINDING_RECORD, binding)
    await this.ctx.sessionProjectionCache.write(agent.session)
    await this.sourceSessions.put(sourceSessionId(binding.source, binding.sourceId), {
      sessionId: agent.id, createdAt: agent.session.header.createdAt,
    })
    this.watchCodex(agent, binding)
    return binding
  }
  private async safeCwd(cwd: string | null): Promise<string> {
    if (cwd && isAbsolute(cwd) && await stat(cwd).then(value => value.isDirectory(), () => false)) return cwd
    await mkdir(this.config.fallbackCwd, { recursive: true })
    return this.config.fallbackCwd
  }
  private async ensureStored(binding: NativeConversationBinding, createdAt = Date.now()): Promise<boolean> {
    const sourceKey = sourceSessionId(binding.source, binding.sourceId)
    const assignment = this.sourceSessions.get(sourceKey)
    const id = assignment?.sessionId ?? sourceKey
    const cwd = await this.safeCwd(binding.cwd)
    const workspace = await this.ctx.workspaceRegistry.create(cwd)
    const stored = await this.ctx.sessionPersistence.stat(id)
    if (stored) {
      if (assignment && stored.header.createdAt !== assignment.createdAt) throw new Error('The original conversation assignment refers to a replaced local Session.')
      const cache = this.ctx.sessionProjectionCache
      const snapshot = cache.cachedSnapshot(stored.header)
      if (!snapshot?.values.nativeConversation || !snapshot.values.title || snapshot.values.sessionListMetadata?.blank !== false) {
        const handle = await this.ctx.sessionPersistence.open(id, 'read')
        try {
          const restored = await handle.read()
          const session = Session.fromRestore(id, restored.events, handle.header, handle.inheritedEventCount, restored.eventState)
          await cache.write(session)
        } finally { await handle.close() }
      }
      await workspace.attachSession(id)
      if (!assignment) await this.sourceSessions.put(sourceKey, { sessionId: id, createdAt: stored.header.createdAt })
      return false
    }
    if (assignment) throw new Error('The original conversation’s assigned local Session is missing. Restore its local data before synchronizing.')
    let model = binding.model
    if (!model && binding.source === 'codex') {
      const models = await this.ctx.llm.listModels(CODEX_PROVIDER)
      model = models[0]?.id ?? null
    }
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION, id, createdAt: Math.max(0, Math.trunc(createdAt)), isSeeded: false, cwd,
    }
    const session = Session.create(id, undefined, header)
    const events = [appendPluginRecord(session, BINDING_RECORD, binding, { returnEvent: true })]
    events.push(session.append('session/title', { title: binding.title, messageSeqs: [], source: { kind: 'user' } }))
    if (model) events.push(session.append('model/selection', {
      provider: binding.source === 'codex' ? CODEX_PROVIDER : 'axiom-original', model,
    }))
    const handle = await this.ctx.sessionPersistence.create(header)
    try { await handle.append(events); await handle.flush() } finally { await handle.close() }
    await this.ctx.sessionProjectionCache.write(session)
    await this.sourceSessions.put(sourceKey, { sessionId: id, createdAt: header.createdAt })
    await workspace.attachSession(id)
    return true
  }
  /**
   * Connect the original selected Dot and open it as an ordinary Session.
   * @param url Exact original ChatGPT Dot URL selected by the user.
   * @returns The ordinary Session assigned to that original conversation.
   */
  @Remote
  async connectAxiom(url: string): Promise<{ sessionId: SessionId }> {
    const transport = this.axiom
    if (!transport) throw new RemoteError('gateway/internal', 'Open the Mac app to connect the original Axiom page.', {})
    const binding = { sourceId: brandString<NativeConversationId>(url), url }
    const history = await readAxiomHistory(transport, binding, this.lifetime.signal)
    this.axiomPhase = history.phase
    const value: NativeConversationBinding = { source: 'axiom', sourceId: brandString<NativeConversationId>(history.url), title: history.phase === 'ready' ? history.title || 'Axiom' : 'Axiom', model: 'original-dot', cwd: null }
    await this.ensureStored(value)
    return { sessionId: sourceSessionId('axiom', value.sourceId) }
  }
  /** Show the dedicated original-page login surface when authentication is required. */
  @Remote
  async showAxiomLogin(): Promise<void> {
    if (!this.axiom) throw new RemoteError('gateway/internal', 'The Mac app original-page connection is unavailable.', {})
    await this.axiom.showLogin(this.lifetime.signal)
  }
  private async codexHistory(id: string, signal?: AbortSignal): Promise<SourceHistoryEntry[]> {
    // Snapshot settled turn identities BEFORE reading items. Newly completed or active turns wait for the next observation.
    const settled = new Set<string>()
    const excluded = new Set<string>()
    const turnCursors = new Set<string>()
    let turnCursor: string | null = null
    do {
      const page = schema.object({ data: schema.array(schema.object({ id: schema.string(), status: schema.string() })),
        nextCursor: schema.string().nullable().optional(),
      }).parse(await this.ctx.codexAppServer.request('thread/turns/list', {
        threadId: id, limit: 100, sortDirection: 'asc', itemsView: 'summary', cursor: turnCursor,
      }, signal))
      for (const turn of page.data) {
        if (['completed', 'interrupted', 'failed'].includes(turn.status)) settled.add(turn.id)
        else excluded.add(turn.id)
      }
      turnCursor = page.nextCursor ?? null
      if (turnCursor && turnCursors.has(turnCursor)) throw new Error('Codex returned a repeated turn cursor')
      if (turnCursor) turnCursors.add(turnCursor)
    } while (turnCursor)
    const entries: SourceHistoryEntry[] = []; const seenCursors = new Set<string>()
    let cursor: string | null = null
    do {
      const page = parseCodexHistoryEntries(await this.ctx.codexAppServer.request('thread/items/list', { threadId: id, limit: 100, sortDirection: 'asc', cursor }, signal), excluded)
      entries.push(...page.entries); cursor = page.nextCursor
      if (cursor && seenCursors.has(cursor)) throw new Error('Codex returned a repeated message cursor')
      if (cursor) seenCursors.add(cursor)
    } while (cursor)
    return entries.filter(entry => entry.sourceTurnId === undefined || settled.has(entry.sourceTurnId))
  }
  private markObserved(session: Session, ids: readonly string[], limited: boolean): void {
    const checkpoint = this.checkpoints.stateOf(session)
    appendPluginRecord(session, CHECKPOINT_RECORD, {
      ids: [...new Set([...checkpoint.ids, ...ids])], hydrated: true, historyLimited: limited,
    })
  }
  private async hydrate(agent: Agent, binding: NativeConversationBinding, signal?: AbortSignal): Promise<void> {
    if (binding.source === 'codex') {
      appendCodexHistoryTurns(agent.session, this.checkpoints.stateOf(agent.session), await this.codexHistory(binding.sourceId, signal),
        binding.sourceId, binding.model ?? 'unknown', this.ctx.agents.turnBoundaryOf(agent.session).lastTurn + 1,
        (activity) => { this.codexActivity.append(agent.session, activity) })
    } else if (this.axiom) {
      const history = await readAxiomHistory(this.axiom, { sourceId: binding.sourceId, url: binding.sourceId }, signal)
      this.observeAxiom(agent.session, history, true)
    }
  }
  private observeAxiom(session: Session, snapshot: Pick<AxiomSnapshot, 'phase' | 'messages' | 'limited'>, includeUsers: boolean): void {
    this.axiomPhase = snapshot.phase
    // Site messages keep their original order. Assistant edits update their original-id node.
    const seen = new Set(this.checkpoints.stateOf(session).ids)
    let pendingUser = false
    for (const message of snapshot.messages) {
      if (message.role === 'user') {
        const parsedTime = message.timestamp === null ? Number.NaN : Date.parse(message.timestamp)
        const timestamp = Number.isSafeInteger(parsedTime) && parsedTime >= 0 ? parsedTime : null
        if (includeUsers) appendSourceMessages(session, this.checkpoints.stateOf(session),
          [{ id: message.id, role: 'user', text: message.text, timestamp }], 'axiom-original', 'original-dot', snapshot.limited,
          this.ctx.agents.turnBoundaryOf(session).lastTurn + 1)
        else if (!seen.has(message.id)) pendingUser = true
      } else {
        // A concurrent original-site user belongs before its reply. Reconcile the
        // complete ordered batch under idle maintenance instead of anchoring it early.
        if (pendingUser) continue
        const prior = this.axiomMessages.stateOf(session).byId[message.id]
        if (!prior || prior.text !== message.text || prior.timestamp !== message.timestamp || prior.truncated !== message.truncated) {
          appendAxiomMessage(session, { id: message.id, text: message.text, timestamp: message.timestamp, truncated: message.truncated })
        }
      }
    }
  }
  private watchCodex(agent: Agent, binding: NativeConversationBinding): void {
    if (this.observedCodex.has(agent)) return
    this.observedCodex.add(agent)
    agent.ctx.effect(() => {
      const lifetime = new AbortController()
      const signal = AbortSignal.any([lifetime.signal, this.lifetime.signal])
      let previous = ''
      const observe = async (): Promise<void> => {
        while (!signal.aborted) {
          await delay(this.config.codexPollIntervalMs, undefined, { signal })
          if (agent.status !== 'idle') continue
          try {
            await agent.runMaintenance(async (maintenance) => {
              const active = AbortSignal.any([signal, maintenance])
              const recent = await this.ctx.codexAppServer.request('thread/turns/list', { threadId: binding.sourceId, limit: 1, sortDirection: 'desc', itemsView: 'summary' }, active)
              const turns = schema.array(schema.object({ id: schema.string(), status: schema.string() }).loose()).parse(recent.data)
              const signature = JSON.stringify(turns.map(turn => [turn.id, turn.status]))
              if (signature === previous || turns.some(turn => turn.status === 'inProgress')) return
              await this.hydrate(agent, binding, active)
              previous = signature
            })
          } catch (_unavailableObservation: unknown) {
            // A busy Agent or disconnected source is retried by read-only observation.
            // No original turn is started, resumed, replayed, or interrupted here.
          }
        }
      }
      const pending = observe().catch((_cancelledObservation: unknown) => {})
      return async () => { lifetime.abort(); await pending }
    }, 'native-conversations.observe-original-codex')
  }
  private watchAxiom(agent: Agent, binding: NativeConversationBinding): void {
    agent.ctx.effect(() => {
      const lifetime = new AbortController()
      const signal = AbortSignal.any([lifetime.signal, this.lifetime.signal])
      const observe = async (): Promise<void> => {
        while (!signal.aborted) {
          await delay(this.config.axiomPollIntervalMs, undefined, { signal })
          if (agent.status !== 'idle' || !this.axiom) continue
          try {
            await agent.runMaintenance(async (maintenance) => {
              const transport = this.axiom
              if (!transport) return
              try {
                const history = await readAxiomHistory(
                  transport, { sourceId: binding.sourceId, url: binding.sourceId }, AbortSignal.any([signal, maintenance]),
                )
                this.observeAxiom(agent.session, history, true)
              } catch (_unavailableObservation: unknown) {
                if (!signal.aborted) this.axiomPhase = 'unavailable'
              }
            })
          } catch (_busyMaintenance: unknown) {
            // A busy Agent did not admit a source read; retry when it becomes idle.
          }
        }
      }
      const pending = observe().catch((_cancelledObservation: unknown) => { if (!signal.aborted) this.axiomPhase = 'unavailable' })
      return async () => { lifetime.abort(); await pending }
    }, 'native-conversations.observe-original-axiom')
  }
}
