/** Managed sign-in accepts only its exact owner RPC, including Cordis-derived receivers. */
import { Context } from '@deepseek-ai/cordis'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { CodexJsonObject, CodexMethod } from '@deepseek-ai/dsh-host-codex-app-server'
import type { Principal, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import NativeConversations from '../src/index.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    'native-login-test-guest': { readonly kind: 'native-login-test-guest' }
  }
}

async function fixture() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const request = vi.fn(async (method: CodexMethod): Promise<CodexJsonObject> => {
    if (method === 'account/read') return { account: null }
    if (method === 'account/login/start') return {
      type: 'chatgpt', loginId: 'owned-fixture-login', authUrl: 'https://auth.openai.com/oauth/authorize?state=FIXTURE_ONLY',
    }
    if (method === 'account/login/cancel') return { status: 'canceled' }
    throw new Error('Unexpected fixture request')
  })
  ctx.provide('codexAppServer', {
    request, status: () => ({ state: 'ready', generation: 1, sourceHome: '/fixture', reason: null }),
    onNotification: () => () => {}, onStatus: () => () => {},
  } as never)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccess)
  await ctx.plugin(Gateway)
  // Construct the real auth owner without starting unrelated history/session services.
  new NativeConversations(ctx, NativeConversations.Config({}))
  const peer = new Peer(ctx, { principal: { kind: 'owner' } })
  const call = (method: string): Promise<unknown> => ctx.typertGateway.invoke({
    peer, namespace: 'nativeConversations', method, args: {},
  })
  const borrowed = (namespace: string, method: string, service = namespace, principal?: Principal) => {
    const invocation: RemoteInvocation = {
      request: { namespace, method, args: {} }, service,
      peer: principal === undefined ? peer : new Peer(ctx, { principal }), signal: peer.signal,
      uplink: <In>(): AsyncIterable<In> => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }),
    }
    return ctx.extend({ invocation }).nativeConversations
  }
  return { ctx, call, request, borrowed }
}

const refused = { code: 'gateway/bad-request', message: 'Manage Codex sign-in from the Native conversations panel.' }

describe('Codex login owner invocation', () => {
  it('starts and cancels through the genuine owner Gateway without exposing the controller', async () => {
    const h = await fixture()
    expect(h.request).not.toHaveBeenCalled()
    expect(Reflect.has(h.ctx.nativeConversations, 'codexLogin')).toBe(false)
    await expect(h.call('startCodexLogin')).resolves.toEqual({
      authUrl: 'https://auth.openai.com/oauth/authorize?state=FIXTURE_ONLY',
    })
    await expect(h.call('cancelCodexLogin')).resolves.toBeUndefined()
    expect(h.request.mock.calls.map(([method]) => method)).toEqual(['account/read', 'account/login/start', 'account/login/cancel'])
  })

  it('awaits cancellation of its owned pending login on service disposal', async () => {
    const h = await fixture()
    await h.call('startCodexLogin')
    await h.ctx.fiber.dispose()
    expect(h.request.mock.calls.map(([method]) => method)).toEqual(['account/read', 'account/login/start', 'account/login/cancel'])
  })

  it('rejects direct service calls before touching the daemon', async () => {
    const h = await fixture()
    await expect(h.ctx.nativeConversations.startCodexLogin()).rejects.toMatchObject(refused)
    await expect(h.ctx.nativeConversations.cancelCodexLogin()).rejects.toMatchObject(refused)
    expect(h.request).not.toHaveBeenCalled()
  })

  it('rejects an exact endpoint invocation from a non-owner before touching the daemon', async () => {
    const h = await fixture()
    const guest: Principal = { kind: 'native-login-test-guest' }
    await expect(h.borrowed('nativeConversations', 'startCodexLogin', 'nativeConversations', guest).startCodexLogin())
      .rejects.toMatchObject(refused)
    await expect(h.borrowed('nativeConversations', 'cancelCodexLogin', 'nativeConversations', guest).cancelCodexLogin())
      .rejects.toMatchObject(refused)
    expect(h.request).not.toHaveBeenCalled()
  })

  it('rejects a borrowed dynamic-runner invocation and cross-method owner invocations', async () => {
    const h = await fixture()
    await expect(h.borrowed('dynamicCordisRunner', 'invoke').startCodexLogin()).rejects.toMatchObject(refused)
    await expect(h.call('startCodexLogin')).resolves.toHaveProperty('authUrl')
    const before = h.request.mock.calls.length
    await expect(h.borrowed('dynamicCordisRunner', 'invoke').cancelCodexLogin()).rejects.toMatchObject(refused)
    await expect(h.borrowed('nativeConversations', 'startCodexLogin').cancelCodexLogin()).rejects.toMatchObject(refused)
    await expect(h.borrowed('nativeConversations', 'cancelCodexLogin').startCodexLogin()).rejects.toMatchObject(refused)
    await expect(h.borrowed('nativeConversations', 'cancelCodexLogin', 'dynamicCordisRunner').cancelCodexLogin()).rejects.toMatchObject(refused)
    expect(h.request).toHaveBeenCalledTimes(before)
    await expect(h.call('cancelCodexLogin')).resolves.toBeUndefined()
    expect(h.request).toHaveBeenCalledTimes(before + 1)
  })
})
