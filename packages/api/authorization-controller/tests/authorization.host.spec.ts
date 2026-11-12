/** Remote conversation lifecycle, stored-state projection, and redacted failures. */
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import AuthorizationService, { type AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCredentials } from '../../../credentials/authorization/tests/memory.ts'
import AuthorizationController from '../src/index.ts'
import type { AuthorizationFrame } from '../src/types.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function harness(run: (session: AuthorizationSession) => Promise<void>) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(TypertRegistry)
  ctx.authorization.registerFlow({ key: KEY, label: 'ChatGPT (Codex)', methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }], run })
  await ctx.plugin(AuthorizationController).await()
  return ctx
}

function collect(ctx: Context) {
  const controller = new AbortController()
  const frames: AuthorizationFrame[] = []
  const done = (async () => {
    for await (const frame of ctx.authorizationController.begin(KEY, 'oauth', controller.signal)) frames.push(frame)
  })()
  return { controller, frames, done }
}

describe('provider authorization Remote', () => {
  it('relays notices and secret prompts, commits once, and exposes only stored presence', async () => {
    let answer: string | undefined
    const ctx = await harness(async session => {
      session.notify({ message: 'Continue in browser', url: 'https://example.com/login', code: 'ABCD' })
      answer = await session.prompt({ kind: 'secret', message: 'Paste callback code' })
      await session.commit({ kind: 'grant', payload: { refreshToken: 'private-refresh-token' } })
    })
    expect(await ctx.authorizationController.list()).toMatchObject([{ key: KEY, configured: false, writable: true }])
    const { frames, done } = collect(ctx)
    await vi.waitFor(() => { expect(frames.at(-1)?.prompt).toBeDefined() })
    const prompt = frames.at(-1)!
    ctx.authorizationController.answer(prompt.attemptId, prompt.prompt!.id, 'private-callback-code')
    await done
    expect(answer).toBe('private-callback-code')
    expect(frames.at(-1)).toMatchObject({ status: 'authorized' })
    const state = await ctx.authorizationController.list()
    expect(state).toMatchObject([{ key: KEY, configured: true, inFlight: false }])
    expect(JSON.stringify({ frames, state })).not.toContain('private-')
    await ctx.authorizationController.logout(KEY)
    expect(await ctx.authorizationController.list()).toMatchObject([{ configured: false }])
  })

  it('withdraws callback-raced prompts and refuses stale answers', async () => {
    const withdrawn = new AbortController()
    const proceed = Promise.withResolvers<void>()
    const ctx = await harness(async session => {
      const prompt = session.prompt({ kind: 'text', message: 'Code', signal: withdrawn.signal }).catch(() => undefined)
      await proceed.promise
      withdrawn.abort()
      await prompt
      await session.commit({ kind: 'grant', payload: {} })
    })
    const { frames, done } = collect(ctx)
    await vi.waitFor(() => { expect(frames.at(-1)?.prompt).toBeDefined() })
    const stale = frames.at(-1)!
    proceed.resolve()
    await done
    expect(() => ctx.authorizationController.answer(stale.attemptId, stale.prompt!.id, 'late'))
      .toThrow('no longer active')
    expect(frames.at(-1)).toMatchObject({ status: 'authorized' })
  })

  it('cancels the flow when its stream closes and allows a new attempt', async () => {
    const ctx = await harness(async session => {
      await session.prompt({ kind: 'text', message: 'Code' })
    })
    const first = collect(ctx)
    await vi.waitFor(() => { expect(first.frames.at(-1)?.prompt).toBeDefined() })
    await expect(ctx.authorizationController.logout(KEY)).rejects.toMatchObject({ code: 'authorization/rejected' })
    first.controller.abort()
    await first.done
    expect(first.frames.at(-1)).toMatchObject({ status: 'cancelled' })
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
    const second = collect(ctx)
    await vi.waitFor(() => { expect(second.frames.at(-1)?.prompt).toBeDefined() })
    await ctx.authorizationController.cancel(second.frames.at(-1)!.attemptId)
    await second.done
    expect(second.frames.at(-1)).toMatchObject({ status: 'cancelled' })
  })

  it('redacts provider failures and rejects invalid selection answers', async () => {
    const ctx = await harness(async session => {
      await session.prompt({ kind: 'select', message: 'Account', options: [{ id: 'work', label: 'Work' }] })
      throw new Error('Bearer private-access-token')
    })
    const { frames, done } = collect(ctx)
    await vi.waitFor(() => { expect(frames.at(-1)?.prompt).toBeDefined() })
    const current = frames.at(-1)!
    expect(() => ctx.authorizationController.answer(current.attemptId, current.prompt!.id, 'other'))
      .toThrow('Invalid authorization answer')
    ctx.authorizationController.answer(current.attemptId, current.prompt!.id, 'work')
    await done
    expect(frames.at(-1)).toMatchObject({ status: 'failed' })
    expect(JSON.stringify(frames)).not.toContain('private-access-token')
    expect(await ctx.authorizationController.list()).toMatchObject([{ configured: false }])
  })
})
