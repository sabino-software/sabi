/** Explicit managed OAuth owns only one exact login; Codex keeps tokens and the callback. */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { CodexJsonObject, CodexMethod, CodexNotification } from '@deepseek-ai/dsh-host-codex-app-server'
import { codexAuthorizationUrl, NativeCodexLoginController } from '../src/codex-login.ts'

function fixture(initial: string | null = null, cancelTimeoutMs = 5000) {
  let accountType = initial
  let connection = { state: 'ready' as 'ready' | 'disconnected', generation: 7, sourceHome: '/work-codex', reason: null }
  const notifications = new Set<(value: CodexNotification) => void>()
  const statuses = new Set<(value: typeof connection) => void>()
  const authenticated = vi.fn(async () => {})
  const request = vi.fn(async (method: CodexMethod, _params: CodexJsonObject): Promise<CodexJsonObject> => {
    if (method === 'account/read') return { account: accountType === null ? null : { type: accountType } }
    if (method === 'account/login/start') return { type: 'chatgpt', loginId: 'owned-login', authUrl: 'https://auth.openai.com/oauth/authorize?state=PRIVATE_TRANSACTION' }
    if (method === 'account/login/cancel') return { status: 'canceled' }
    throw new Error('Unexpected fixture method')
  })
  const owner = new NativeCodexLoginController({ request, status: () => connection,
    onNotification: (listener) => { notifications.add(listener); return () => { notifications.delete(listener) } },
    onStatus: (listener) => { statuses.add(listener); return () => { statuses.delete(listener) } },
  }, authenticated, { timeoutMs: 1000, cancelTimeoutMs })
  onTestFinished(() => owner.dispose())
  const emit = (id: string | null, success = true, generation = 7): void => {
    for (const listener of notifications) listener({ generation, method: 'account/login/completed',
      params: { loginId: id, success, error: 'PRIVATE_PROVIDER_ERROR' } })
  }
  return { owner, authenticated, request, emit, notifications,
    account: (type: string | null) => { accountType = type },
    disconnect: () => { connection = { ...connection, state: 'disconnected' }; for (const listener of statuses) listener(connection) },
  }
}

afterEach(() => { vi.useRealTimers() })

describe('managed Codex login', () => {
  it.each(['chatgpt', 'apiKey'])('refuses to replace an existing %s account without starting OAuth', async (type) => {
    const h = fixture(type)
    await expect(h.owner.start()).rejects.toThrow('already has a signed-in account')
    expect(h.request.mock.calls.map(([method]) => method)).toEqual(['account/read'])
    expect(h.owner.status()).toMatchObject({ phase: 'failed' })
  })

  it('waits for the exact attempt and verifies account/read before success', async () => {
    const h = fixture()
    expect(h.request).not.toHaveBeenCalled()
    const result = await h.owner.start()
    expect(result.authUrl).toContain('https://auth.openai.com/')
    expect(h.owner.status()).toEqual({ phase: 'awaiting-browser', error: null })
    expect(JSON.stringify(h.owner.status())).not.toContain('PRIVATE_')
    await expect(h.owner.start()).rejects.toThrow('already active')
    h.emit('another-login'); h.emit(null); h.emit('owned-login', true, 8)
    expect(h.authenticated).not.toHaveBeenCalled()
    h.account('chatgpt')
    h.emit('owned-login')
    await vi.waitFor(() => { expect(h.owner.status()).toEqual({ phase: 'succeeded', error: null }) })
    expect(h.authenticated).toHaveBeenCalledOnce()
    expect(h.request.mock.calls.filter(([method]) => method === 'account/read')).toHaveLength(2)
  })

  it('does not accept a completion when the daemon has no ChatGPT account and redacts source errors', async () => {
    const h = fixture()
    await h.owner.start()
    h.emit('owned-login')
    await vi.waitFor(() => { expect(h.owner.status().phase).toBe('failed') })
    expect(h.authenticated).not.toHaveBeenCalled()
    expect(JSON.stringify(h.owner.status())).not.toContain('PRIVATE_')
  })

  it('cancels only its exact pending login and ignores late completion', async () => {
    const h = fixture()
    await h.owner.start()
    await h.owner.cancel()
    expect(h.request.mock.calls.at(-1)).toEqual(['account/login/cancel', { loginId: 'owned-login' }, expect.anything()])
    h.account('chatgpt'); h.emit('owned-login')
    expect(h.owner.status()).toEqual({ phase: 'cancelled', error: null })
    expect(h.authenticated).not.toHaveBeenCalled()
  })

  it('uses the configured cancellation deadline for its exact login', async () => {
    const h = fixture(null, 7000)
    await h.owner.start()
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      await h.owner.cancel()
      expect(timeout).toHaveBeenCalledExactlyOnceWith(7000)
    } finally { timeout.mockRestore() }
  })

  it('handles a completion arriving before the start response with the same correlation rules', async () => {
    const h = fixture()
    const start = h.request.getMockImplementation()!
    h.request.mockImplementation(async (method, params) => {
      if (method === 'account/login/start') { h.account('chatgpt'); h.emit('owned-login') }
      return start(method, params)
    })
    await h.owner.start()
    await vi.waitFor(() => { expect(h.owner.status().phase).toBe('succeeded') })
    expect(h.authenticated).toHaveBeenCalledOnce()
  })

  it('fails on disconnect without retrying or accepting another connection generation', async () => {
    const h = fixture()
    await h.owner.start()
    h.disconnect(); h.emit('owned-login', true, 8)
    expect(h.owner.status().phase).toBe('failed')
    expect(h.request.mock.calls.filter(([method]) => method === 'account/login/start')).toHaveLength(1)
    expect(h.authenticated).not.toHaveBeenCalled()
  })

  it('expires a pending callback and cancels its exact daemon-owned login', async () => {
    vi.useFakeTimers()
    const h = fixture()
    await h.owner.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.owner.status().phase).toBe('failed')
    expect(h.owner.status().error).toContain('expired')
    expect(h.request.mock.calls.filter(([method]) => method === 'account/login/cancel')).toHaveLength(1)
  })

  it('cancels a login if the source returns an unsafe browser URL and keeps provider errors private', async () => {
    const h = fixture()
    h.request.mockImplementation(async (method) => {
      if (method === 'account/read') return { account: null }
      if (method === 'account/login/start') return { type: 'chatgpt', loginId: 'owned-login', authUrl: 'https://evil.test/?token=PRIVATE_TRANSACTION' }
      return { status: 'canceled' }
    })
    await expect(h.owner.start()).rejects.toThrow('could not be confirmed')
    expect(h.request.mock.calls.some(([method]) => method === 'account/login/cancel')).toBe(true)
    expect(JSON.stringify(h.owner.status())).not.toContain('PRIVATE_')
  })

  it('disposes its listeners and cancels only its outstanding managed login', async () => {
    const h = fixture()
    await h.owner.start()
    await h.owner.dispose()
    expect(h.notifications.size).toBe(0)
    expect(h.request.mock.calls.filter(([method]) => method === 'account/login/cancel')).toHaveLength(1)
    h.account('chatgpt'); h.emit('owned-login')
    expect(h.authenticated).not.toHaveBeenCalled()
  })

  it('redacts a failed login notification without treating it as account confirmation', async () => {
    const h = fixture()
    await h.owner.start()
    h.emit('owned-login', false)
    expect(h.owner.status().phase).toBe('failed')
    expect(JSON.stringify(h.owner.status())).not.toContain('PRIVATE_PROVIDER_ERROR')
    expect(h.authenticated).not.toHaveBeenCalled()
  })

  it('allows only credential-free exact HTTPS OpenAI authorization origins', () => {
    expect(codexAuthorizationUrl('https://chatgpt.com/auth/login?state=opaque')).toContain('chatgpt.com')
    for (const url of ['http://auth.openai.com/authorize', 'https://auth.openai.com.evil.test/',
      'https://auth.openai.com:8443/', 'https://user:secret@auth.openai.com/', 'javascript:alert(1)', 'https://chatgpt.com/#token']) {
      expect(() => codexAuthorizationUrl(url)).toThrow()
    }
  })
})
