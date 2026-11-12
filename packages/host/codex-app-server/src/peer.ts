/** Bounded bidirectional JSON-RPC over the official Unix WebSocket transport. */
import { randomUUID } from 'node:crypto'
import type WebSocket from 'ws'
import type { RawData } from 'ws'
import { isJsonValue } from '@deepseek-ai/dsh-util-values'
import { CodexAppServerError } from './error.ts'
import type { CodexJsonObject, CodexRequestId } from './types.ts'

interface Pending {
  readonly settle: (value: CodexJsonObject | CodexAppServerError) => void
  readonly mutating: boolean
}

interface Incoming {
  readonly controller: AbortController
  readonly params: CodexJsonObject
  readonly timer: ReturnType<typeof setTimeout>
}

/** Per-connection limits supplied by the owning Host plugin. */
export interface PeerOptions {
  readonly maxFrameBytes: number
  readonly maxPendingRequests: number
  readonly serverRequestTimeoutMs: number
}

function object(value: unknown): CodexJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !isJsonValue(value)) throw new CodexAppServerError('CODEX_PROTOCOL')
  return value as CodexJsonObject
}

function requestId(value: unknown): value is CodexRequestId {
  return typeof value === 'string' || typeof value === 'number' && Number.isSafeInteger(value)
}

function failure(code: 'CODEX_CANCELLED' | 'CODEX_TIMEOUT' | 'CODEX_DISCONNECTED', mutating: boolean): CodexAppServerError {
  return new CodexAppServerError(code, { outcomeUnknown: mutating })
}

/** Owns correlation and pending request lifetimes; never owns the daemon or its turns. */
export class CodexRpcPeer {
  private failure: CodexAppServerError | undefined
  private readonly pending = new Map<CodexRequestId, Pending>()
  private readonly incoming = new Map<CodexRequestId, Incoming>()
  readonly closed: Promise<void>

  /**
   * @param socket - One owned WebSocket connection to an existing daemon.
   * @param options - Complete frame and request limits.
   * @param notified - Receives validated daemon notifications.
   * @param requested - Handles one original server request with its cancellation signal.
   * @param failed - Publishes one terminal connection failure.
   */
  constructor(
    private readonly socket: WebSocket,
    private readonly options: PeerOptions,
    private readonly notified: (method: string, params: CodexJsonObject) => void,
    private readonly requested: (
      id: CodexRequestId, method: string, params: CodexJsonObject, signal: AbortSignal,
    ) => Promise<CodexJsonObject>,
    private readonly failed: (error: CodexAppServerError) => void,
  ) {
    this.closed = new Promise(resolve => socket.once('close', () => { resolve() }))
    socket.on('message', this.message)
    socket.on('error', this.socketError)
    socket.on('close', this.socketClosed)
  }

  /**
   * Send exactly once; cancellation abandons the response and does not interrupt a Codex turn.
   * @param method - Official method name.
   * @param params - Official request parameters.
   * @param mutating - Whether a lost response makes the action's outcome unknown.
   * @param timeoutMs - Deadline for this request's response.
   * @param signal - Optional caller abandonment signal.
   * @returns The official response object, without projection.
   */
  request(method: string, params: CodexJsonObject, mutating: boolean, timeoutMs: number, signal?: AbortSignal): Promise<CodexJsonObject> {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    if (signal?.aborted === true) return Promise.reject(failure('CODEX_CANCELLED', false))
    if (this.pending.size >= this.options.maxPendingRequests) return Promise.reject(new CodexAppServerError('CODEX_LIMIT'))
    const id = `skeinlet_${randomUUID()}`
    return new Promise((resolve, reject) => {
      let sent = false
      const settle = (value: CodexJsonObject | CodexAppServerError): void => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', aborted)
        if (value instanceof CodexAppServerError) reject(value)
        else resolve(value)
      }
      const aborted = (): void => { settle(failure('CODEX_CANCELLED', sent && mutating)) }
      const timer = setTimeout(() => { settle(failure('CODEX_TIMEOUT', sent && mutating)) }, timeoutMs)
      timer.unref()
      this.pending.set(id, { settle, mutating })
      signal?.addEventListener('abort', aborted, { once: true })
      try {
        this.write({ id, method, params })
        sent = true
      } catch (error: unknown) {
        settle(error instanceof CodexAppServerError ? error : new CodexAppServerError('CODEX_PROTOCOL'))
      }
    })
  }

  /**
   * Send a protocol notification after initialization.
   * @param method - Official notification method.
   * @param params - Optional official parameters.
   */
  notify(method: string, params?: CodexJsonObject): void {
    this.write(params === undefined ? { method } : { method, params })
  }

  /**
   * Reject all waiters, abort inbound handlers, and close only this owned socket.
   * @param error - Sanitized terminal failure, or disposal by default.
   */
  close(error = new CodexAppServerError('CODEX_DISPOSED')): void {
    if (this.failure !== undefined) return
    this.failure = error
    for (const pending of [...this.pending.values()]) {
      pending.settle(new CodexAppServerError(error.code as ConstructorParameters<typeof CodexAppServerError>[0], {
        outcomeUnknown: pending.mutating,
      }))
    }
    for (const id of [...this.incoming.keys()]) this.cancelIncoming(id)
    this.socket.off('message', this.message)
    this.socket.terminate()
    this.failed(error)
  }

  private readonly socketError = (): void => { this.close(new CodexAppServerError('CODEX_DISCONNECTED')) }
  private readonly socketClosed = (): void => { this.close(new CodexAppServerError('CODEX_DISCONNECTED')) }

  private readonly message = (data: RawData, binary: boolean): void => {
    try {
      if (binary) throw new CodexAppServerError('CODEX_PROTOCOL')
      const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
      if (bytes.byteLength > this.options.maxFrameBytes) throw new CodexAppServerError('CODEX_LIMIT')
      const frame = object(JSON.parse(bytes.toString('utf8')))
      if (typeof frame.method === 'string') {
        const params = frame.params === undefined ? {} : object(frame.params)
        if (frame.id !== undefined) {
          if (!requestId(frame.id)) throw new CodexAppServerError('CODEX_PROTOCOL')
          this.receiveRequest(frame.id, frame.method, params)
        } else {
          if (frame.method === 'serverRequest/resolved' && requestId(params.requestId)) this.cancelIncoming(params.requestId)
          if (frame.method === 'turn/completed' || frame.method === 'thread/closed') {
            const turn = params.turn !== null && typeof params.turn === 'object' && !Array.isArray(params.turn) ? params.turn : undefined
            for (const [id, incoming] of this.incoming) {
              if (incoming.params.threadId !== params.threadId) continue
              if (frame.method === 'turn/completed' && typeof turn?.id === 'string'
                && typeof incoming.params.turnId === 'string' && incoming.params.turnId !== turn.id) continue
              this.cancelIncoming(id)
            }
          }
          this.notified(frame.method, params)
        }
      } else if (requestId(frame.id)) {
        const pending = this.pending.get(frame.id)
        if (pending === undefined) return
        if (frame.error !== undefined) {
          const error = object(frame.error)
          const details = error.data !== null && typeof error.data === 'object' && !Array.isArray(error.data) ? error.data : undefined
          pending.settle(new CodexAppServerError('CODEX_RPC_REJECTED', {
            rpcCode: typeof error.code === 'number' ? error.code : null,
            rpcErrorType: typeof details?.type === 'string' && details.type.length <= 80 ? details.type : null,
          }))
        } else pending.settle(object(frame.result))
      } else throw new CodexAppServerError('CODEX_PROTOCOL')
    } catch (error: unknown) {
      this.close(error instanceof CodexAppServerError ? error : new CodexAppServerError('CODEX_PROTOCOL'))
    }
  }

  private receiveRequest(id: CodexRequestId, method: string, params: CodexJsonObject): void {
    if (this.incoming.has(id)) throw new CodexAppServerError('CODEX_PROTOCOL')
    if (this.incoming.size >= this.options.maxPendingRequests) {
      this.respond({ id, error: { code: -32001, message: 'Client request capacity reached.' } })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      this.cancelIncoming(id)
      this.respond({ id, error: { code: -32603, message: 'Client request timed out.' } })
    }, this.options.serverRequestTimeoutMs)
    timer.unref()
    this.incoming.set(id, { controller, params, timer })
    Promise.resolve().then(() => this.requested(id, method, params, controller.signal)).then((result) => {
      if (controller.signal.aborted) return
      this.respond({ id, result: object(result) })
    }).catch(() => {
      if (!controller.signal.aborted) this.respond({ id, error: { code: -32603, message: 'Client could not complete this request.' } })
    }).finally(() => {
      if (this.incoming.get(id)?.controller === controller) this.cancelIncoming(id)
    })
  }

  private cancelIncoming(id: CodexRequestId): void {
    const request = this.incoming.get(id)
    if (request === undefined) return
    this.incoming.delete(id)
    clearTimeout(request.timer)
    request.controller.abort(new CodexAppServerError('CODEX_CANCELLED'))
  }

  private write(frame: object): void {
    if (this.failure !== undefined) throw this.failure
    const text = JSON.stringify(frame)
    if (Buffer.byteLength(text) + this.socket.bufferedAmount > this.options.maxFrameBytes) throw new CodexAppServerError('CODEX_LIMIT')
    this.socket.send(text, (error) => { if (error) this.close(new CodexAppServerError('CODEX_DISCONNECTED')) })
  }

  private respond(frame: object): void {
    try { this.write(frame) }
    catch (error: unknown) { this.close(error instanceof CodexAppServerError ? error : new CodexAppServerError('CODEX_PROTOCOL')) }
  }
}
