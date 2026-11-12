/** Real authenticated WebSocket serialization and cancellation of a provider conversation. */
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { apply as connectionApply, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import WebSocket, { type RawData } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCredentials } from '../../../credentials/authorization/tests/memory.ts'
import { browserCookie } from '../../gateway/tests/browser-credentials.ts'
import { ownerPeer } from '../../gateway/tests/peer.ts'
import AuthorizationController from '../src/index.ts'
import type { AuthorizationFrame } from '../src/types.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const contexts: Context[] = []
const sockets: WebSocket[] = []
afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.CLOSED) continue
    socket.close()
    await once(socket, 'close')
  }
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

interface WireFrame { type: string; streamId: string; value?: AuthorizationFrame }

async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(TypertGatewayService, {})
  await ctx.plugin({ inject: [...connectionInject], apply: connectionApply })
  await ctx.plugin(AuthorizationController)
  ctx.authorization.registerFlow({
    key: KEY, label: 'ChatGPT (Codex)', methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
    async run(session) {
      session.notify({ message: 'Continue in browser', url: 'https://example.com/login', code: 'ABCD' })
      await session.prompt({ kind: 'secret', message: 'Callback code' })
      await session.commit({ kind: 'grant', payload: { refreshToken: 'private-token' } })
    },
  })
  const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`, {
    headers: { cookie: browserCookie(ctx) },
  })
  sockets.push(socket)
  await once(socket, 'open')
  const frames: WireFrame[] = []
  const raw: string[] = []
  socket.on('message', (data: RawData) => {
    const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8')
      : data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : data.toString('utf8')
    raw.push(text)
    frames.push(JSON.parse(text) as WireFrame)
  })
  socket.send(JSON.stringify({ type: 'open', streamId: 'login', endpoint: 'authorization/begin',
    payload: { args: { key: KEY, method: 'oauth' } } }))
  return { ctx, socket, frames, raw }
}

describe('provider sign-in wire', () => {
  it('serializes notices and prompts, accepts an answer, and omits credentials from success frames', async () => {
    const { ctx, frames, raw } = await harness()
    await vi.waitFor(() => { expect(frames.some(frame => frame.value?.prompt !== undefined)).toBe(true) })
    const question = frames.find(frame => frame.value?.prompt !== undefined)!.value!
    expect(question.notice).toEqual({ message: 'Continue in browser', url: 'https://example.com/login', code: 'ABCD' })
    await ctx.typertGateway.invoke({ peer: ownerPeer(ctx), namespace: 'authorization', method: 'answer',
      args: { attemptId: question.attemptId, promptId: question.prompt!.id, value: 'private-callback' } })
    await vi.waitFor(() => { expect(frames.at(-1)).toMatchObject({ type: 'end', streamId: 'login' }) })
    expect(frames.some(frame => frame.value?.status === 'authorized')).toBe(true)
    expect(raw.join('\n')).not.toContain('private-')
    expect(await ctx.authorizationController.list()).toMatchObject([{ configured: true, inFlight: false }])
  })

  it('cancels the underlying flow when the initiating WebSocket disconnects', async () => {
    const { ctx, socket, frames } = await harness()
    await vi.waitFor(() => { expect(frames.some(frame => frame.value?.prompt !== undefined)).toBe(true) })
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(true)
    socket.close()
    await once(socket, 'close')
    await vi.waitFor(() => { expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false) })
    expect(await ctx.authorizationController.list()).toMatchObject([{ configured: false }])
  })
})
