/** Recovery is an explicit exact-owner RPC; no auth operation or source request is implicit. */
import { Context } from '@deepseek-ai/cordis'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Principal, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import NativeConversations from '../src/index.ts'
import { rebuildCodexMirror } from '../src/rebuild.ts'

vi.mock('../src/rebuild.ts', () => ({ rebuildCodexMirror: vi.fn() }))
const rebuild = vi.mocked(rebuildCodexMirror)

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    'native-rebuild-guest': { readonly kind: 'native-rebuild-guest' }
  }
}

async function fixture() {
  rebuild.mockReset()
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const request = vi.fn(async (): Promise<unknown> => { throw new Error('Recovery must not request source account or thread changes') })
  ctx.provide('codexAppServer', { request, onNotification: () => () => {}, onStatus: () => () => {} } as never)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccess)
  await ctx.plugin(Gateway)
  new NativeConversations(ctx, NativeConversations.Config({}))
  const peer = new Peer(ctx, { principal: { kind: 'owner' } })
  const id = SessionId('explicit-local-mirror')
  const call = () => ctx.typertGateway.invoke({ peer, namespace: 'nativeConversations', method: 'rebuildCodexMirror', args: { sessionId: id } })
  const borrowed = (namespace: string, method: string, principal: Principal = { kind: 'owner' }) => {
    const invocation: RemoteInvocation = { service: namespace, request: { namespace, method, args: {} },
      peer: new Peer(ctx, { principal }), signal: peer.signal,
      uplink: <In>(): AsyncIterable<In> => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }),
    }
    return ctx.extend({ invocation }).nativeConversations.rebuildCodexMirror(id)
  }
  return { ctx, id, call, borrowed, request }
}

describe('Codex rebuild owner RPC', () => {
  it('passes the exact owner Gateway request to explicit local recovery', async () => {
    const h = await fixture()
    const receipt = { sessionId: SessionId('new-local-mirror'), archivedSessionId: h.id }
    rebuild.mockResolvedValue(receipt)
    await expect(h.call()).resolves.toEqual(receipt)
    expect(rebuild).toHaveBeenCalledOnce()
    expect(rebuild.mock.calls[0]?.[2]).toBe(h.id)
    expect(h.request).not.toHaveBeenCalled()
  })

  it('rejects absent, borrowed and non-owner invocations before recovery', async () => {
    const h = await fixture()
    await expect(h.ctx.nativeConversations.rebuildCodexMirror(h.id)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(h.borrowed('dynamicCordisRunner', 'invoke')).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(h.borrowed('nativeConversations', 'startCodexLogin')).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(h.borrowed('nativeConversations', 'rebuildCodexMirror', { kind: 'native-rebuild-guest' }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(rebuild).not.toHaveBeenCalled()
    expect(h.request).not.toHaveBeenCalled()
  })

  it('refuses another recovery and sync while its explicit transaction is pending', async () => {
    const h = await fixture()
    const pending = Promise.withResolvers<{ sessionId: SessionId; archivedSessionId: SessionId }>()
    rebuild.mockReturnValue(pending.promise)
    const first = h.call()
    await vi.waitFor(() => { expect(rebuild).toHaveBeenCalledOnce() })
    await expect(h.call()).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(() => h.ctx.nativeConversations.syncCodex()).toThrow('Wait for explicit Codex mirror recovery')
    pending.resolve({ sessionId: SessionId('new-local-mirror'), archivedSessionId: h.id })
    await first
    expect(h.request).not.toHaveBeenCalled()
  })

  it('refuses recovery while a different owner RPC is synchronizing source metadata', async () => {
    const h = await fixture()
    const pending = Promise.withResolvers<{ data: never[]; nextCursor: null }>()
    h.request.mockImplementationOnce(async () => await pending.promise)
    const peer = new Peer(h.ctx, { principal: { kind: 'owner' } })
    const sync = h.ctx.typertGateway.invoke({ peer, namespace: 'nativeConversations', method: 'syncCodex', args: {} })
    await vi.waitFor(() => { expect(h.request).toHaveBeenCalledOnce() })
    await expect(h.call()).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(rebuild).not.toHaveBeenCalled()
    pending.resolve({ data: [], nextCursor: null })
    await expect(sync).resolves.toEqual({ imported: 0 })
  })
})
