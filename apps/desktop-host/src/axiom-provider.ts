/** Correlated, bounded original-page requests over the shell-owned child IPC channel. */
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-native-conversations'
import type { AxiomSendRequest, AxiomSendResult, AxiomSnapshot, AxiomTransport } from '@deepseek-ai/dsh-native-conversations/types'

const snapshotSchema = z.object({
  source: z.literal('chatgpt-web'), url: z.string().max(4096).nullable(), title: z.string().max(300),
  revision: z.number().int().nonnegative(), phase: z.enum(['disconnected', 'loading', 'login-required', 'ready', 'unavailable']),
  sourceOrder: z.array(z.string().min(1).max(512)).max(100).optional(),
  messages: z.array(z.object({ id: z.string().max(512), role: z.enum(['user', 'assistant']), text: z.string().max(32768),
    timestamp: z.string().max(100).nullable(), truncated: z.boolean() }).strict()).max(100),
  canSend: z.boolean(), draftPresent: z.boolean(), siteStatus: z.string().max(500).nullable(), limited: z.boolean(),
  errorCode: z.enum(['page-unavailable', 'unsupported-page']).optional(),
}).strict().transform(({ errorCode, sourceOrder, ...snapshot }): AxiomSnapshot => ({ ...snapshot,
  ...sourceOrder === undefined ? {} : { sourceOrder }, ...errorCode === undefined ? {} : { errorCode },
}))
const sentSchema = z.object({
  status: z.enum(['confirmed', 'unknown', 'refused']), snapshot: snapshotSchema, messageId: z.string().max(512).optional(),
}).strict().transform(({ messageId, ...result }): AxiomSendResult => messageId === undefined ? result : { ...result, messageId })
const responseSchema = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('axiom-response'), requestId: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), ok: z.literal(true), value: z.unknown() }).strict(),
  z.object({ type: z.literal('axiom-response'), requestId: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), ok: z.literal(false),
    error: z.object({ code: z.string().max(100) }).strict() }).strict(),
])

/** The process channel is injectable so tests never need an Electron window. */
export interface AxiomIpcChannel {
  /** @returns Whether the owned parent channel can still receive requests. */
  connected(): boolean
  /** @param message Correlated request or cancellation. @param done Delivery result; delivery is not operation success. */
  send(message: object, done: (error: Error | null) => void): void
  /** @param listener Receives parent IPC values. @returns Listener cleanup. */
  onMessage(listener: (message: unknown) => void): () => void
  /** @param listener Receives channel shutdown. @returns Listener cleanup. */
  onDisconnect(listener: () => void): () => void
}

interface Pending {
  readonly remoteFinished: Promise<void>
  readonly finishRemote: () => void
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly cleanup: () => void
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('Axiom request cancelled')) }
    signal.addEventListener('abort', abort, { once: true })
    void operation.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}

/** A single-page transport; leases survive cancellation until the parent acknowledges quiescence. */
export class AxiomIpcTransport implements AxiomTransport {
  private readonly lifetime = new AbortController()
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private queue = Promise.resolve()
  private readonly listeners: readonly (() => void)[]

  /** @param channel Owned parent IPC. @param options Validated maximum duration of one page operation. */
  constructor(private readonly channel: AxiomIpcChannel, private readonly options: { requestTimeoutMs: number }) {
    this.listeners = [channel.onMessage((message) => { this.receive(message) }), channel.onDisconnect(() => { this.dispose() })]
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    const combined = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    const previous = this.queue
    const slot = Promise.withResolvers<void>()
    this.queue = previous.then(() => slot.promise)
    try { await abortable(previous, combined) }
    catch (error) { void previous.then(() => { slot.resolve() }); throw error }
    let released = false
    return () => {
      if (released) return
      released = true
      // Aborting a child wait does not establish that the native operation stopped.
      const outstanding = [...this.pending.values()].map(request => request.remoteFinished)
      void Promise.allSettled(outstanding).then(() => { slot.resolve() })
    }
  }

  connect(url: string, signal?: AbortSignal): Promise<AxiomSnapshot> {
    return this.request('axiom/connect', { url }, value => snapshotSchema.parse(value), signal)
  }

  snapshot(signal?: AbortSignal): Promise<AxiomSnapshot> {
    return this.request('axiom/snapshot', {}, value => snapshotSchema.parse(value), signal)
  }

  send(request: AxiomSendRequest, signal?: AbortSignal): Promise<AxiomSendResult> {
    return this.request('axiom/send', { request }, value => sentSchema.parse(value), signal)
  }

  async showLogin(signal?: AbortSignal): Promise<void> {
    await this.request('axiom/showLogin', {}, value => z.null().parse(value), signal)
  }

  async disconnect(signal?: AbortSignal): Promise<void> {
    await this.request('axiom/disconnect', {}, value => z.null().parse(value), signal)
  }

  /** Reject all pending and queued work without stopping or closing the original page. */
  dispose(): void {
    if (this.lifetime.signal.aborted) return
    const error = new Error('The original ChatGPT page bridge is unavailable; check the Desktop connection.')
    for (const remove of this.listeners) remove()
    for (const [id, request] of this.pending) {
      request.cleanup()
      this.cancel(id)
      request.reject(error)
      request.finishRemote()
    }
    this.pending.clear()
    this.lifetime.abort(error)
  }

  private request<T>(method: string, args: object, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    const combined = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    if (combined.aborted || !this.channel.connected()) return Promise.reject(new Error('The original ChatGPT page bridge is unavailable.'))
    if (!Number.isSafeInteger(this.nextId)) return Promise.reject(new Error('The original page request identity is exhausted. Restart the Desktop connection.'))
    const requestId = this.nextId++
    const remote = Promise.withResolvers<void>()
    const result = new Promise<unknown>((resolve, reject) => {
      const abort = (): void => {
        this.cancel(requestId)
        reject(new Error('Observation cancelled; the original page operation may already have taken place.'))
      }
      const timer = setTimeout(() => {
        reject(new Error('The original page operation timed out. Check ChatGPT before sending again.'))
        // No acknowledgement means later mutations cannot safely overtake this one.
        this.dispose()
      }, this.options.requestTimeoutMs)
      const cleanup = (): void => { clearTimeout(timer); combined.removeEventListener('abort', abort) }
      this.pending.set(requestId, { resolve, reject, cleanup, remoteFinished: remote.promise, finishRemote: remote.resolve })
      combined.addEventListener('abort', abort, { once: true })
      try {
        this.channel.send({ type: 'axiom-request', requestId, method, args }, (error) => {
          if (error === null) return
          reject(new Error('The original page request could not be delivered. Its outcome is unconfirmed.'))
          this.dispose()
        })
      } catch (error) {
        reject(error instanceof Error ? error : new Error('The original page request could not be delivered.'))
        this.dispose()
      }
    })
    return result.then(parse)
  }

  private cancel(requestId: number): void {
    if (!this.channel.connected()) return
    try {
      this.channel.send({ type: 'axiom-cancel', requestId }, (_deliveryError) => {
        // The operation deadline rejects the transport if no parent acknowledgement arrives.
      })
    } catch (_closedChannel) { /* Disposal already rejects the owned waiters. */ }
  }

  private receive(message: unknown): void {
    const parsed = responseSchema.safeParse(message)
    if (!parsed.success) return
    const reply = parsed.data
    const request = this.pending.get(reply.requestId)
    if (request === undefined) return
    this.pending.delete(reply.requestId)
    request.cleanup()
    request.finishRemote()
    if (reply.ok) request.resolve(reply.value)
    else request.reject(new Error(`The original ChatGPT page operation failed (${reply.error.code}). Check the original page.`))
  }
}

/**
 * Attach original-page IPC only when the optional native conversation service is mounted.
 * @param ctx Running Desktop Host context.
 * @param options Validated page-operation deadline from native conversation configuration.
 * @returns Idempotent teardown of attachment, listeners, and pending requests.
 */
export function installDesktopAxiomProvider(ctx: Context, options: { requestTimeoutMs: number }): () => void {
  const service = ctx.get('nativeConversations')
  if (service === undefined || !process.connected || process.send === undefined) return () => {}
  const transport = new AxiomIpcTransport({
    connected: () => process.connected,
    send: (message, done) => { process.send?.(message, done) },
    onMessage: (listener) => { process.on('message', listener); return () => { process.off('message', listener) } },
    onDisconnect: (listener) => { process.on('disconnect', listener); return () => { process.off('disconnect', listener) } },
  }, options)
  const detach = service.attachAxiomTransport(transport)
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    detach()
    transport.dispose()
  }
  ctx.effect(() => dispose, 'desktop: original Axiom page transport')
  return dispose
}
