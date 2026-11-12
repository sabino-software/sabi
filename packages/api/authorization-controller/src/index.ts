/** Host bridge from neutral authorization flows to a cancellable browser conversation. */
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AuthorizationAttemptId, AuthorizationFlowView, AuthorizationFrame, AuthorizationPromptId, AuthorizationQuestion } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser provider sign-in Remote owner. */
    authorizationController: AuthorizationController
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Redacted provider sign-in or credential operation refusal. */
    'authorization/rejected': { operation: 'list' | 'answer' | 'logout' | 'cancel' }
  }
}

interface Attempt {
  controller: AbortController
  done: Promise<void>
  answer?: { id: AuthorizationPromptId; question: AuthorizationQuestion; resolve(value: string): void }
}

/** Validate and brand the record address before any service operation. */
function parseKey(key: CredentialKey): CredentialKey {
  const match = /^([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/.exec(key)
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new RemoteError('gateway/bad-request', 'Invalid authorization key.', {})
  }
  return credentialKey(match[1], match[2])
}

/** The browser carrier owns each attempt; closing it cancels and awaits the flow. */
export class AuthorizationController extends TypertRemoteService {
  static inject = ['authorization', 'credentials', 'typert']
  private readonly attempts = new Map<AuthorizationAttemptId, Attempt>()
  private readonly removing = new Set<CredentialKey>()

  /** @param ctx - Host context carrying authorization flows and the credential store. */
  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
    ctx.effect(() => async () => {
      const pending = [...this.attempts.values()]
      for (const attempt of pending) attempt.controller.abort()
      await Promise.all(pending.map(attempt => attempt.done))
    }, 'authorization-controller: running attempts')
  }

  /**
   * List registered methods and stored-record presence without reading secrets.
   * @returns redacted provider entries.
   */
  @Remote
  async list(): Promise<AuthorizationFlowView[]> {
    try {
      return await Promise.all(this.ctx.authorization.list().map(async entry => {
        const info = await this.ctx.credentials.describeRecord(entry.key)
        return {
          key: entry.key, label: entry.label,
          methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
          inFlight: entry.inFlight, configured: info.configured, writable: info.writable,
        }
      }))
    } catch (error) {
      // Provider errors can contain tokens or file contents; the browser gets a stable refusal only.
      throw new RemoteError('authorization/rejected', 'Provider sign-in state is unavailable.', { operation: 'list' }, { cause: error })
    }
  }

  /**
   * Start one conversation. Frames replace previous notices and unanswered prompts.
   * @param key - registered credential key.
   * @param method - method declared by that flow.
   * @param signal - carrier-owned cancellation; disconnect cancels rather than restarting OAuth.
   * @returns current interaction frames and a redacted terminal outcome.
   */
  @Remote({ mode: 'stream' })
  async *begin(key: CredentialKey, method: string, signal: AbortSignal): AsyncIterable<AuthorizationFrame> {
    const recordKey = parseKey(key)
    if (this.removing.has(recordKey)) {
      yield { attemptId: brandString<AuthorizationAttemptId>(randomUUID()), status: 'failed' }
      return
    }
    const controller = new AbortController()
    const attemptId = brandString<AuthorizationAttemptId>(randomUUID())
    let frame: AuthorizationFrame = { attemptId, status: 'running' }
    let revision = 0
    let wake: (() => void) | undefined
    const publish = (next: AuthorizationFrame): void => {
      frame = next
      revision++
      wake?.()
    }
    const cancel = (): void => { controller.abort() }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    const attempt: Attempt = { controller, done: Promise.resolve() }
    this.attempts.set(attemptId, attempt)
    attempt.done = this.ctx.authorization.begin({
      key: recordKey, method, signal: controller.signal,
      interaction: {
        notify: notice => publish({
          ...frame,
          notice: {
            message: notice.message,
            ...notice.url === undefined ? {} : { url: notice.url },
            ...notice.code === undefined ? {} : { code: notice.code },
          },
        }),
        prompt: question => new Promise<string>((resolve, reject) => {
          const id = brandString<AuthorizationPromptId>(randomUUID())
          const promptSignal = question.signal
          const view: AuthorizationQuestion = question.kind === 'select'
            ? { kind: 'select', message: question.message, options: question.options.map(option => ({
                id: option.id, label: option.label,
                ...option.description === undefined ? {} : { description: option.description },
              })) }
            : { kind: question.kind, message: question.message,
                ...question.placeholder === undefined ? {} : { placeholder: question.placeholder } }
          const clear = (): void => {
            delete attempt.answer
            promptSignal?.removeEventListener('abort', withdrawn)
            controller.signal.removeEventListener('abort', withdrawn)
            const { prompt: _prompt, ...rest } = frame
            publish(rest)
          }
          const withdrawn = (): void => {
            clear()
            reject(new DOMException('Authorization question withdrawn.', 'AbortError'))
          }
          if (controller.signal.aborted || promptSignal?.aborted) { withdrawn(); return }
          attempt.answer = { id, question: view, resolve: value => { clear(); resolve(value) } }
          promptSignal?.addEventListener('abort', withdrawn, { once: true })
          controller.signal.addEventListener('abort', withdrawn, { once: true })
          publish({ ...frame, prompt: { id, question: view } })
        }),
      },
    }).then(
      outcome => { publish({ attemptId, status: outcome.status }) },
      (_error: unknown) => { publish({ attemptId, status: 'failed' }) },
    )
    try {
      let delivered = -1
      while (true) {
        if (delivered !== revision) {
          delivered = revision
          const current = frame
          yield current
          if (current.status !== 'running') return
        }
        await new Promise<void>(resolve => { wake = resolve; if (delivered !== revision) resolve() })
      }
    } finally {
      signal.removeEventListener('abort', cancel)
      controller.abort()
      await attempt.done
      this.attempts.delete(attemptId)
    }
  }

  /**
   * Answer only the current question; a callback-withdrawn question rejects stale answers.
   * @param attemptId - capability delivered by the attempt stream.
   * @param promptId - capability of the currently displayed question.
   * @param value - human answer; never retained in an event, snapshot, or error.
   */
  @Remote
  answer(attemptId: AuthorizationAttemptId, promptId: AuthorizationPromptId, value: string): void {
    const pending = this.attempts.get(attemptId)?.answer
    if (pending?.id !== promptId) {
      throw new RemoteError('authorization/rejected', 'This sign-in question is no longer active.', { operation: 'answer' })
    }
    if (value.length > 64 * 1024 || (pending.question.kind === 'select'
      && !pending.question.options.some(option => option.id === value))) {
      throw new RemoteError('gateway/bad-request', 'Invalid authorization answer.', {})
    }
    pending.resolve(value)
  }

  /**
   * Cancel and await settlement, including a credential commit already admitted.
   * @param attemptId - capability delivered by the initiating attempt stream.
   */
  @Remote
  async cancel(attemptId: AuthorizationAttemptId): Promise<void> {
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined) return
    attempt.controller.abort()
    await attempt.done
  }

  /**
   * Remove only a registered flow's app-owned credential; active sign-in must settle first.
   * @param key - registered credential key.
   */
  @Remote
  async logout(key: CredentialKey): Promise<void> {
    const recordKey = parseKey(key)
    const entry = this.ctx.authorization.describe(recordKey)
    if (entry === undefined || entry.inFlight || this.removing.has(recordKey)) {
      throw new RemoteError('authorization/rejected', 'Finish or cancel sign-in before signing out.', { operation: 'logout' })
    }
    this.removing.add(recordKey)
    try {
      await this.ctx.credentials.deleteRecord(recordKey)
    } catch (error) {
      throw new RemoteError('authorization/rejected', 'The saved sign-in could not be removed.', { operation: 'logout' }, { cause: error })
    } finally {
      this.removing.delete(recordKey)
    }
  }
}

export default AuthorizationController
