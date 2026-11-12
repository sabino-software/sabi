/** Managed Codex browser login; the verified work daemon owns OAuth and its callback. */
import { z } from 'zod'
import type CodexAppServer from '@deepseek-ai/dsh-host-codex-app-server'
import type { CodexNotification } from '@deepseek-ai/dsh-host-codex-app-server'
import type { NativeCodexLoginStatus } from './types.ts'

const account = z.object({ account: z.object({ type: z.string() }).loose().nullable() }).loose()
const started = z.object({ type: z.literal('chatgpt'), loginId: z.string().min(1).max(200), authUrl: z.string().max(16384) })
const completed = z.object({ loginId: z.string().nullable(), success: z.boolean() }).loose()
const FAILURE = 'Codex sign-in could not be confirmed. Check the work Codex application before trying again.'
interface Attempt { readonly generation: number; loginId: string | null; timer?: ReturnType<typeof setTimeout> }

/** Validate an authorization URL without logging its OAuth transaction fields. */
export function codexAuthorizationUrl(value: string): string {
  const url = new URL(value)
  if (!['https://auth.openai.com', 'https://chatgpt.com'].includes(url.origin) || url.username || url.password || url.hash) {
    throw new Error(FAILURE)
  }
  return url.href
}

/** One explicit sign-in attempt; no token, authorization URL, or provider error is retained in status. */
export class NativeCodexLoginController {
  private current: NativeCodexLoginStatus = { phase: 'idle', error: null }
  private active: Attempt | undefined
  private readonly lifetime = new AbortController()
  private readonly early: CodexNotification[] = []
  private readonly disposers: readonly (() => void)[]
  private disposed = false

  constructor(
    private readonly transport: Pick<CodexAppServer, 'request' | 'onNotification' | 'onStatus' | 'status'>,
    private readonly onAuthenticated: () => Promise<void>,
    private readonly options: { readonly timeoutMs: number; readonly cancelTimeoutMs: number },
  ) {
    this.disposers = [transport.onNotification((notification) => { this.observe(notification) }), transport.onStatus((status) => {
      if (this.active?.loginId && status.state !== 'ready') this.fail()
    })]
  }

  /** @returns Credential-free state of this controller's attempt. */
  status(): NativeCodexLoginStatus { return this.current }

  /** @returns The daemon's validated authorization link for the explicit browser action. */
  async start(): Promise<{ authUrl: string }> {
    if (this.disposed || this.active || this.current.phase === 'cancelling') throw new Error('A Codex sign-in attempt is already active or unavailable.')
    let owned: Attempt = { generation: this.transport.status().generation, loginId: null }
    this.active = owned
    this.current = { phase: 'starting', error: null }
    let rejection = FAILURE
    try {
      const existing = account.parse(await this.transport.request('account/read', { refreshToken: false }, this.lifetime.signal))
      if (this.active !== owned) throw new Error(FAILURE)
      if (existing.account !== null) {
        rejection = 'Codex already has a signed-in account. Use that account in the work Codex application; this action does not replace it.'
        this.fail(rejection)
        throw new Error(rejection)
      }
      // account/read establishes and verifies the work connection before the mutation.
      const generation = this.transport.status().generation
      owned = { generation, loginId: null }
      this.active = owned
      const result = started.parse(await this.transport.request('account/login/start', { type: 'chatgpt' }, this.lifetime.signal))
      owned.loginId = result.loginId
      if (this.active !== owned || this.transport.status().state !== 'ready'
        || this.transport.status().generation !== owned.generation) {
        await this.cancelOwned(owned)
        throw new Error(FAILURE)
      }
      let authUrl: string
      try { authUrl = codexAuthorizationUrl(result.authUrl) }
      catch (_invalidDestination: unknown) { await this.cancelOwned(owned); throw new Error(FAILURE) }
      this.current = { phase: 'awaiting-browser', error: null }
      owned.timer = setTimeout(() => {
        void this.cancel().then(() => { this.current = { phase: 'failed', error: 'Codex sign-in expired. Check the browser before starting again.' } }, () => {})
      }, this.options.timeoutMs)
      owned.timer.unref()
      const notifications = this.early.splice(0)
      for (const notification of notifications) this.observe(notification)
      return { authUrl }
    } catch (_providerFailure: unknown) {
      if (this.active === owned) this.fail()
      throw new Error(rejection)
    }
  }

  /** Cancel only this attempt; no logout or other client's login is affected. */
  async cancel(): Promise<void> {
    const owned = this.active
    if (!owned?.loginId || this.current.phase !== 'awaiting-browser') throw new Error('There is no cancellable Codex sign-in attempt.')
    this.active = undefined
    clearTimeout(owned.timer)
    this.early.length = 0
    this.current = { phase: 'cancelling', error: null }
    try {
      await this.cancelOwned(owned)
      this.current = { phase: 'cancelled', error: null }
    } catch (_providerFailure: unknown) { this.fail(); throw new Error(FAILURE) }
  }

  /** Release notification handlers and cancel an exact pending login before shutting down. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.disposers) dispose()
    const owned = this.active
    this.active = undefined
    clearTimeout(owned?.timer)
    this.early.length = 0
    this.lifetime.abort()
    if (owned?.loginId) await this.cancelOwned(owned).catch(() => {})
  }

  private async cancelOwned(owned: Attempt): Promise<void> {
    if (owned.loginId === null) return
    await this.transport.request('account/login/cancel', { loginId: owned.loginId }, AbortSignal.timeout(this.options.cancelTimeoutMs))
  }

  private observe(notification: CodexNotification): void {
    const owned = this.active
    if (!owned || notification.generation !== owned.generation || notification.method !== 'account/login/completed') return
    const event = completed.safeParse(notification.params)
    if (!event.success) return
    if (owned.loginId === null) {
      // Notifications may arrive before the start response; retain only bounded correlation facts.
      if (this.early.length < 16) this.early.push({ generation: notification.generation, method: notification.method,
        params: { loginId: event.data.loginId, success: event.data.success } })
      return
    }
    if (event.data.loginId !== owned.loginId || this.current.phase !== 'awaiting-browser') return
    if (!event.data.success) { this.fail(); return }
    clearTimeout(owned.timer)
    this.current = { phase: 'verifying', error: null }
    void this.verify(owned).catch(() => { if (this.active === owned) this.fail() })
  }

  private async verify(owned: Attempt): Promise<void> {
    const result = account.parse(await this.transport.request('account/read', { refreshToken: false }, this.lifetime.signal))
    if (this.active !== owned) return
    if (result.account?.type !== 'chatgpt') { this.fail(); return }
    await this.onAuthenticated()
    if (this.active !== owned) return
    clearTimeout(owned.timer)
    this.active = undefined
    this.current = { phase: 'succeeded', error: null }
  }

  private fail(message = FAILURE): void {
    clearTimeout(this.active?.timer)
    this.active = undefined
    this.early.length = 0
    this.current = { phase: 'failed', error: message }
  }
}
