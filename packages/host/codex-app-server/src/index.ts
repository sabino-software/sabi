/** Native Host integration with an existing work Codex app-server daemon. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { connect as connectSocket } from 'node:net'
import WebSocket from 'ws'
import { CodexAppServerError } from './error.ts'
import { CodexRpcPeer } from './peer.ts'
import type {
  CodexConnectionStatus, CodexJsonObject, CodexMethod, CodexNotification,
  CodexRequestId, CodexServerRequestHandler, CodexServerRequestMethod,
} from './types.ts'

export { CodexAppServerError } from './error.ts'
export type * from './types.ts'

/** Work identity, Unix endpoint, and complete operation limits. No setting starts a daemon. */
export interface Config {
  /** Exact work Codex home expected in the daemon's initialize response. */
  readonly sourceHome: string
  /** Empty selects sourceHome/app-server-control/app-server-control.sock. */
  readonly socketPath: string
  /** Client identity advertised to the connected work daemon. */
  readonly clientName: string
  /** Client version advertised during initialization. */
  readonly clientVersion: string
  /** Maximum Unix connection and initialization lifetime in milliseconds. */
  readonly connectTimeoutMs: number
  /** Maximum lifetime of an outgoing request before an unknown-outcome refusal. */
  readonly requestTimeoutMs: number
  /** Maximum lifetime of an owned incoming approval or user-input request. */
  readonly serverRequestTimeoutMs: number
  /** Maximum accepted WebSocket message size in bytes. */
  readonly maxFrameBytes: number
  /** Maximum simultaneous outgoing requests per connection. */
  readonly maxPendingRequests: number
}

const METHODS = new Set<CodexMethod>([
  'thread/list', 'thread/read', 'thread/turns/list', 'thread/items/list', 'thread/loaded/list',
  'model/list', 'permissionProfile/list', 'mcpServerStatus/list', 'account/read', 'thread/start', 'thread/fork', 'thread/resume', 'thread/unsubscribe',
  'thread/name/set', 'thread/archive', 'thread/unarchive', 'thread/settings/update',
  'account/login/start', 'account/login/cancel',
  'turn/start', 'turn/steer', 'turn/interrupt',
])
const READS = new Set<CodexMethod>([
  'thread/list', 'thread/read', 'thread/turns/list', 'thread/items/list', 'thread/loaded/list',
  'model/list', 'permissionProfile/list', 'mcpServerStatus/list', 'account/read',
])
const SERVER_METHODS = new Set<CodexServerRequestMethod>([
  'item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
  'item/permissions/requestApproval', 'item/tool/requestUserInput',
  'mcpServer/elicitation/request', 'item/tool/call', 'applyPatchApproval', 'execCommandApproval', 'currentTime/read',
])

interface Connection {
  readonly peer: CodexRpcPeer
  readonly lifetime: AbortController
  readonly ready: Promise<void>
  readonly generation: number
}

/** Fail closed when no owning Harness bridge is mounted for a server request. */
function refused(method: string, params: CodexJsonObject): CodexJsonObject {
  switch (method) {
    case 'item/commandExecution/requestApproval': {
      if (Array.isArray(params.availableDecisions) && !params.availableDecisions.includes('cancel')) {
        if (params.availableDecisions.includes('decline')) return { decision: 'decline' }
        throw new CodexAppServerError('CODEX_METHOD_UNSUPPORTED')
      }
      return { decision: 'cancel' }
    }
    case 'item/fileChange/requestApproval': return { decision: 'cancel' }
    case 'applyPatchApproval':
    case 'execCommandApproval': return { decision: 'abort' }
    case 'item/permissions/requestApproval': return { permissions: {}, scope: 'turn' }
    case 'item/tool/requestUserInput': return { answers: {} }
    case 'mcpServer/elicitation/request': return { action: 'cancel', content: null }
    case 'item/tool/call': return { success: false, contentItems: [{ type: 'inputText', text: 'This tool is unavailable in the connected client.' }] }
    case 'currentTime/read': return { currentTimeAt: Math.floor(Date.now() / 1000) }
    default: throw new CodexAppServerError('CODEX_METHOD_UNSUPPORTED')
  }
}

function awaitSignal<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return pending
  if (signal.aborted) return Promise.reject(new CodexAppServerError('CODEX_CANCELLED'))
  return new Promise((resolve, reject) => {
    const aborted = (): void => { reject(new CodexAppServerError('CODEX_CANCELLED')) }
    signal.addEventListener('abort', aborted, { once: true })
    pending.then(resolve, reject).finally(() => { signal.removeEventListener('abort', aborted) })
  })
}

function opened(socket: WebSocket, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: CodexAppServerError): void => {
      socket.off('open', ready)
      socket.off('error', failed)
      socket.off('close', failed)
      signal.removeEventListener('abort', aborted)
      if (error === undefined) resolve()
      else reject(error)
    }
    const ready = (): void => { finish() }
    const failed = (): void => { finish(new CodexAppServerError('CODEX_UNAVAILABLE')) }
    const aborted = (): void => { finish(new CodexAppServerError('CODEX_UNAVAILABLE')) }
    socket.once('open', ready)
    socket.once('error', failed)
    socket.once('close', failed)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** One lazy native connection to the existing work Codex daemon. */
    codexAppServer: CodexAppServer
  }
}

/**
 * Preserves native IDs and events without creating Harness Sessions. Consumers own projections,
 * operation authorization, subscription restoration, and bridges into Harness tools or interaction.
 */
export default class CodexAppServer extends Service {
  /** Deployment-selected native identity and resource limits. */
  static Config: z<Partial<Config>, Config> = z.object({
    sourceHome: z.string().default(join(homedir(), '.codex')),
    socketPath: z.string().default(''),
    clientName: z.string().min(1).default('skeinlet'),
    clientVersion: z.string().min(1).default('0.1.0'),
    connectTimeoutMs: z.natural().min(1).max(600000).default(20000),
    requestTimeoutMs: z.natural().min(1).max(3600000).default(60000),
    serverRequestTimeoutMs: z.natural().min(1).max(3600000).default(900000),
    maxFrameBytes: z.natural().min(1024).max(67108864).default(16777216),
    maxPendingRequests: z.natural().min(1).max(1024).default(128),
  })

  private connection: Connection | undefined
  private readonly peers = new Set<CodexRpcPeer>()
  private readonly lifetime = new AbortController()
  private readonly notifications = new Set<(notification: CodexNotification) => void>()
  private readonly statusListeners = new Set<(status: CodexConnectionStatus) => void>()
  private readonly handlers = new Map<CodexServerRequestMethod, CodexServerRequestHandler>()
  private snapshot: CodexConnectionStatus

  /**
   * @param ctx - Host plugin context; no browser or filesystem provider is required.
   * @param config - Existing work daemon identity and limits.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'codexAppServer')
    if (!isAbsolute(config.sourceHome) || config.socketPath !== '' && !isAbsolute(config.socketPath)) throw new CodexAppServerError('CODEX_UNAVAILABLE')
    this.snapshot = { state: 'disconnected', generation: 0, sourceHome: config.sourceHome, reason: null }
    ctx.effect(() => async () => {
      this.lifetime.abort()
      const peers = [...this.peers]
      for (const peer of peers) peer.close()
      this.publish({ ...this.snapshot, state: 'disposed', reason: null })
      this.notifications.clear()
      this.statusListeners.clear()
      this.handlers.clear()
      await Promise.all(peers.map(peer => peer.closed))
    }, 'codex-app-server.connection')
  }

  /**
   * Read current connection facts.
   * @returns Immutable status; ready does not establish model access.
   */
  status(): CodexConnectionStatus { return this.snapshot }

  /**
   * Attach and initialize once. A future call after loss creates a new connection without replaying mutations.
   * @param signal - Optional caller abandonment; does not close a connection shared by other consumers.
   * @returns The ready generation after the daemon's work home is verified.
   */
  async connect(signal?: AbortSignal): Promise<CodexConnectionStatus> {
    await this.readyConnection(signal)
    return this.snapshot
  }

  /**
   * Invoke an allowlisted official operation exactly once, preserving its response fields.
   * @param method - Native operation; managed login is explicit, while filesystem and configuration writes are excluded.
   * @param params - Official operation parameters; consumers own method-specific defaults and authorization.
   * @param signal - Optional abandonment, never an implicit turn interruption.
   * @returns The unprojected official response object.
   * @throws CodexAppServerError; outcomeUnknown forbids blindly retrying a submitted mutation.
   */
  async request(method: CodexMethod, params: CodexJsonObject, signal?: AbortSignal): Promise<CodexJsonObject> {
    if (!METHODS.has(method)) throw new CodexAppServerError('CODEX_METHOD_UNSUPPORTED')
    const connection = await this.readyConnection(signal)
    return connection.peer.request(method, params, !READS.has(method), this.config.requestTimeoutMs, signal)
  }

  /**
   * Receive validated native notifications, including turn, item, status, and request-resolution events.
   * @param listener - Synchronous observer; consumers re-read history after a generation change.
   * @returns Effect-owned disposer.
   */
  onNotification(listener: (notification: CodexNotification) => void): () => void {
    const dispose = this.ctx.effect(() => {
      this.notifications.add(listener)
      return () => { this.notifications.delete(listener) }
    })
    return () => { void dispose() }
  }

  /**
   * Observe connection changes; registration immediately reports the current generation.
   * @param listener - Synchronous observer of immutable connection facts.
   * @returns Effect-owned disposer.
   */
  onStatus(listener: (status: CodexConnectionStatus) => void): () => void {
    const dispose = this.ctx.effect(() => {
      this.statusListeners.add(listener)
      return () => { this.statusListeners.delete(listener) }
    })
    listener(this.snapshot)
    return () => { void dispose() }
  }

  /**
   * Assign one owner for approvals, questions, elicitation, or dynamic tool calls.
   * @param method - Exact official server method.
   * @param handler - Receives original request ID and an abort signal; return its official response object.
   * @returns Effect-owned disposer; absent handlers decline, cancel, or report unavailable tools.
   * @throws CodexAppServerError when a handler already owns this method.
   */
  setRequestHandler(method: CodexServerRequestMethod, handler: CodexServerRequestHandler): () => void {
    if (!SERVER_METHODS.has(method)) throw new CodexAppServerError('CODEX_METHOD_UNSUPPORTED')
    if (this.handlers.has(method)) throw new CodexAppServerError('CODEX_HANDLER_EXISTS')
    const dispose = this.ctx.effect(() => {
      this.handlers.set(method, handler)
      return () => { if (this.handlers.get(method) === handler) this.handlers.delete(method) }
    })
    return () => { void dispose() }
  }

  private attach(): Connection {
    const generation = this.snapshot.generation + 1
    this.publish({ ...this.snapshot, state: 'connecting', generation, reason: null })
    const lifetime = new AbortController()
    const deadline = setTimeout(() => { lifetime.abort() }, this.config.connectTimeoutMs)
    deadline.unref()
    const socketPath = this.config.socketPath || join(this.config.sourceHome, 'app-server-control', 'app-server-control.sock')
    const socket = new WebSocket('ws://localhost', {
      createConnection: () => connectSocket({ path: socketPath }),
      maxPayload: this.config.maxFrameBytes,
      perMessageDeflate: false,
      handshakeTimeout: this.config.connectTimeoutMs,
    })
    const peer = new CodexRpcPeer(socket, this.config,
      (method, params) => {
        for (const listener of this.notifications) {
          try { listener({ generation, method, params }) }
          catch (_observerFailure: unknown) { this.ctx.logger.warn('A native Codex notification observer failed.') }
        }
      },
      (id, method, params, signal) => this.serverRequest(id, generation, method, params, signal),
      (error) => {
        lifetime.abort()
        if (this.snapshot.generation === generation && !this.lifetime.signal.aborted) {
          this.publish({ ...this.snapshot, state: 'disconnected', reason: error.code === 'CODEX_PROTOCOL' ? 'protocol' : 'lost' })
        }
      })
    this.peers.add(peer)
    void peer.closed.then(() => { this.peers.delete(peer) })
    const ready = (async () => {
      try {
        await opened(socket, lifetime.signal)
        const result = await peer.request('initialize', {
          clientInfo: { name: this.config.clientName, title: 'Skeinlet', version: this.config.clientVersion },
          capabilities: { experimentalApi: true, requestAttestation: false },
        }, false, this.config.connectTimeoutMs, lifetime.signal)
        if (typeof result.codexHome !== 'string' || realpathSync(result.codexHome) !== realpathSync(this.config.sourceHome)) throw new CodexAppServerError('CODEX_WRONG_HOME')
        peer.notify('initialized')
        this.publish({ ...this.snapshot, state: 'ready', generation, reason: null })
      } catch (error: unknown) {
        const failure = error instanceof CodexAppServerError ? error : new CodexAppServerError('CODEX_UNAVAILABLE')
        peer.close(failure)
        throw failure
      } finally { clearTimeout(deadline) }
    })()
    const connection = { peer, lifetime, ready, generation }
    this.connection = connection
    return connection
  }

  private async readyConnection(signal?: AbortSignal): Promise<Connection> {
    if (this.lifetime.signal.aborted) throw new CodexAppServerError('CODEX_DISPOSED')
    if (signal?.aborted === true) throw new CodexAppServerError('CODEX_CANCELLED')
    const connection = this.connection?.lifetime.signal.aborted === false ? this.connection : this.attach()
    await awaitSignal(connection.ready, signal)
    if (connection.lifetime.signal.aborted) throw new CodexAppServerError('CODEX_DISCONNECTED')
    return connection
  }

  private async serverRequest(
    id: CodexRequestId, generation: number, method: string, params: CodexJsonObject, signal: AbortSignal,
  ): Promise<CodexJsonObject> {
    const owner = SERVER_METHODS.has(method as CodexServerRequestMethod) ? method as CodexServerRequestMethod : undefined
    const handler = owner === undefined ? undefined : this.handlers.get(owner)
    if (handler === undefined || owner === undefined) return refused(method, params)
    return handler(params, { id, generation, method: owner, signal })
  }

  private publish(snapshot: CodexConnectionStatus): void {
    this.snapshot = snapshot
    for (const listener of this.statusListeners) {
      try { listener(snapshot) }
      catch (_observerFailure: unknown) { this.ctx.logger.warn('A native Codex status observer failed.') }
    }
  }
}
