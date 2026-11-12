/** React-free sign-in state and command lifecycle over one non-restarting Remote stream. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import type { AuthorizationFlowView, AuthorizationFrame, AuthorizationPromptId } from '../types.ts'

/** Redacted state consumed by provider sign-in views. */
export interface ProviderAuthorizationState {
  /** Whole-list load state; a failed refresh retains the previous entries. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Available flows and stored-record presence. */
  entries: readonly AuthorizationFlowView[]
  /** Localized by the receiving UI; raw provider exceptions are never retained. */
  error: 'load' | 'answer' | 'logout' | 'interrupted' | null
  /** Attempt being controlled by this browser, retained after settlement for feedback. */
  active: { key: CredentialKey; frame?: AuthorizationFrame } | null
  /** A command pending acknowledgment. */
  pending: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser-owned provider sign-in state and commands. */
    providerAuthorization: ClientProviderAuthorization
  }
}

/** Client sign-in owner; a broken connection requires a new explicit attempt. */
export class ClientProviderAuthorization extends Service {
  /** Redacted observable sign-in state; credential payloads are never retained. */
  readonly state: SnapshotStore<ProviderAuthorizationState> = createSnapshotStore<ProviderAuthorizationState>({
    status: 'idle', entries: [], error: null, active: null, pending: false,
  })
  private running: { controller: AbortController; done: Promise<void> } | undefined
  private generation = 0

  /**
   * @param ctx - browser plugin context.
   * @param remote - resolved generated authorization namespace.
   */
  constructor(ctx: Context, private readonly remote: ClientRemote['authorization']) {
    super(ctx, 'providerAuthorization')
    ctx.effect(() => async () => {
      this.running?.controller.abort()
      await this.running?.done
    }, 'authorization-controller.client: attempt')
  }

  /** Refresh redacted stored state, preserving entries on failure. @returns after publication. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.state.update((state) => { state.status = 'loading' })
    try {
      const result = await this.remote.list()
      if (generation !== this.generation) return
      this.state.update((state) => {
        state.status = result.ok ? 'ready' : 'error'
        if (result.ok) { state.entries = result.value; if (state.error === 'load') state.error = null }
        else state.error = 'load'
      })
    } catch (_error) {
      if (generation !== this.generation) return
      this.state.update((state) => { state.status = 'error'; state.error = 'load' })
    }
  }

  /**
   * Start an explicit attempt; a second local start is ignored while one is running.
   * @param key - registered provider record.
   * @param method - offered method id.
   */
  begin(key: CredentialKey, method: string): void {
    if (this.running !== undefined) return
    const controller = new AbortController()
    this.state.update((state) => { state.active = { key }; state.error = null })
    const running = { controller, done: Promise.resolve() }
    this.running = running
    running.done = this.follow(key, method, controller.signal).finally(() => {
      if (this.running === running) this.running = undefined
    })
  }

  private async follow(key: CredentialKey, method: string, signal: AbortSignal): Promise<void> {
    let settled = false
    try {
      for await (const frame of this.remote.begin(key, method, signal)) {
        this.state.update((state) => { state.active = { key, frame }; state.pending = false })
        if (frame.status !== 'running') settled = true
      }
      if (!settled && !signal.aborted) this.interrupted()
    } catch (_error) {
      // A carrier break has an unknown commit outcome; reload stored state before another attempt.
      if (!signal.aborted) this.interrupted()
    } finally {
      await this.load()
    }
  }

  /**
   * Answer the current prompt without retaining its value in state.
   * @param promptId - currently displayed question.
   * @param value - human answer.
   * @returns after the answer acknowledgment or visible refusal.
   */
  async answer(promptId: AuthorizationPromptId, value: string): Promise<void> {
    const frame = this.state.getSnapshot().active?.frame
    if (frame?.prompt?.id !== promptId) return
    this.state.update((state) => { state.pending = true; state.error = null })
    try {
      const result = await this.remote.answer(frame.attemptId, promptId, value)
      if (!result.ok) this.state.update((state) => { state.error = 'answer' })
    } catch (_error) {
      this.state.update((state) => { state.error = 'answer' })
    } finally {
      this.state.update((state) => { state.pending = false })
    }
  }

  /** Cancel through the Host and await any admitted commit. @returns after settlement is known. */
  async cancel(): Promise<void> {
    const frame = this.state.getSnapshot().active?.frame
    if (frame === undefined) { this.running?.controller.abort(); this.interrupted(); return }
    this.state.update((state) => { state.pending = true })
    try {
      const result = await this.remote.cancel(frame.attemptId)
      if (!result.ok) this.interrupted()
    } catch (_error) {
      this.running?.controller.abort()
      this.interrupted()
    } finally {
      this.state.update((state) => { state.pending = false })
      await this.load()
    }
  }

  /**
   * Delete one app-owned credential and refresh its stored-state badge.
   * @param key - registered provider record.
   * @returns after the write acknowledgment and refresh.
   */
  async logout(key: CredentialKey): Promise<void> {
    this.state.update((state) => { state.pending = true; state.error = null })
    try {
      const result = await this.remote.logout(key)
      if (!result.ok) this.state.update((state) => { state.error = 'logout' })
      else this.state.update((state) => { state.active = null })
    } catch (_error) {
      this.state.update((state) => { state.error = 'logout' })
    } finally {
      this.state.update((state) => { state.pending = false })
      await this.load()
    }
  }

  private interrupted(): void {
    this.state.update((state) => { state.error = 'interrupted'; state.active = null; state.pending = false })
  }
}
