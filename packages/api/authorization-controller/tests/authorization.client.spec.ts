/** Browser attempt ownership, interruption reporting, and secret-free command state. */
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import { streamMethod } from '@deepseek-ai/dsh-remote-mock'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientProviderAuthorization } from '../src/client/service.ts'
import type { AuthorizationAttemptId, AuthorizationFlowView, AuthorizationPromptId } from '../src/types.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const ATTEMPT = brandString<AuthorizationAttemptId>('attempt')
const PROMPT = brandString<AuthorizationPromptId>('prompt')
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  const entries: AuthorizationFlowView[] = [{ key: KEY, label: 'Codex',
    methods: [{ id: 'oauth', label: 'Sign in' }], configured: false, writable: true, inFlight: false }]
  const remote = {
    list: vi.fn(async () => ({ ok: true as const, value: entries })),
    begin: vi.fn(streamMethod<ClientRemote['authorization']['begin']>(async function* () {
      yield { attemptId: ATTEMPT, status: 'authorized' }
    })),
    answer: vi.fn(async () => ({ ok: true as const, value: undefined })),
    cancel: vi.fn(async () => ({ ok: true as const, value: undefined })),
    logout: vi.fn(async () => ({ ok: true as const, value: undefined })),
  } satisfies ClientRemote['authorization']
  const client = new ClientProviderAuthorization(ctx, remote)
  return { client, remote, entries }
}

describe('provider sign-in client', () => {
  it('publishes success only from a terminal frame and refreshes stored presence', async () => {
    const { client, remote, entries } = harness()
    remote.begin.mockImplementation(streamMethod<ClientRemote['authorization']['begin']>(async function* () {
      entries[0]!.configured = true
      yield { attemptId: ATTEMPT, status: 'authorized' }
    }))
    client.begin(KEY, 'oauth')
    await vi.waitFor(() => { expect(client.state.getSnapshot().status).toBe('ready') })
    expect(client.state.getSnapshot()).toMatchObject({ active: { key: KEY, frame: { status: 'authorized' } }, entries: [{ configured: true }] })
    expect(remote.list).toHaveBeenCalledOnce()
  })

  it('reports a broken carrier, refreshes stored presence, and never restarts OAuth', async () => {
    const { client, remote } = harness()
    remote.begin.mockImplementation(streamMethod<ClientRemote['authorization']['begin']>(async function* () {
      yield { attemptId: ATTEMPT, status: 'running' }
      throw new Error('private-provider-diagnostic')
    }))
    client.begin(KEY, 'oauth')
    await vi.waitFor(() => { expect(client.state.getSnapshot().status).toBe('ready') })
    expect(client.state.getSnapshot()).toMatchObject({ error: 'interrupted', active: null })
    expect(remote.begin).toHaveBeenCalledOnce()
    expect(JSON.stringify(client.state.getSnapshot())).not.toContain('private-provider-diagnostic')
  })

  it('keeps secret answers out of state and ignores answers for withdrawn prompts', async () => {
    const { client, remote } = harness()
    const answered = Promise.withResolvers<undefined>()
    remote.begin.mockImplementation(streamMethod<ClientRemote['authorization']['begin']>(async function* () {
      yield { attemptId: ATTEMPT, status: 'running', prompt: { id: PROMPT, question: { kind: 'secret', message: 'Code' } } }
      await answered.promise
      yield { attemptId: ATTEMPT, status: 'cancelled' }
    }))
    client.begin(KEY, 'oauth')
    await vi.waitFor(() => { expect(client.state.getSnapshot().active?.frame?.prompt?.id).toBe(PROMPT) })
    await client.answer(PROMPT, 'private-answer')
    expect(remote.answer).toHaveBeenCalledWith(ATTEMPT, PROMPT, 'private-answer')
    expect(JSON.stringify(client.state.getSnapshot())).not.toContain('private-answer')
    answered.resolve(undefined)
    await vi.waitFor(() => { expect(client.state.getSnapshot().status).toBe('ready') })
    await client.answer(PROMPT, 'late')
    expect(remote.answer).toHaveBeenCalledOnce()
  })

  it('contains a cancellation carrier failure and presents its outcome as unconfirmed', async () => {
    const { client, remote } = harness()
    remote.begin.mockImplementation(streamMethod<ClientRemote['authorization']['begin']>(async function* (_key, _method, signal) {
      yield { attemptId: ATTEMPT, status: 'running' }
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }))
    remote.cancel.mockRejectedValueOnce(new Error('carrier failed'))
    client.begin(KEY, 'oauth')
    await vi.waitFor(() => { expect(client.state.getSnapshot().active?.frame?.status).toBe('running') })
    await client.cancel()
    expect(client.state.getSnapshot()).toMatchObject({ error: 'interrupted', active: null, pending: false })
    expect(remote.cancel).toHaveBeenCalledWith(ATTEMPT)
  })
})
