/** Native empty-form MCP consent uses one ordinary, scoped approval without persistent grants. */
import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import CodexAppServer, { type CodexServerRequestHandler, type CodexServerRequestMethod } from '@deepseek-ai/dsh-host-codex-app-server'
import { registerCodexRequests } from '../src/codex-requests.ts'

class UnusedAdapter extends LlmAdapter {
  override async *stream(): AsyncIterable<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } }
}

async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['fixture'], new UnusedAdapter())
  await ctx.plugin(ApprovalService)
  const loop = await mountAgentLoopTestHarness(ctx)
  const agent = await loop.create(SessionId(`native-consent-${randomUUID()}`), { provider: 'fixture', model: 'fixture' })
  agent.session.append('turn/start', { turn: 1 })
  // Registration alone never connects to a daemon or reads its home.
  await ctx.plugin(CodexAppServer, CodexAppServer.Config({ sourceHome: process.cwd() }))
  const handlers = new Map<CodexServerRequestMethod, CodexServerRequestHandler>()
  vi.spyOn(ctx.codexAppServer, 'setRequestHandler').mockImplementation((method, handler) => {
    handlers.set(method, handler)
    return () => { handlers.delete(method) }
  })
  registerCodexRequests(ctx, async () => agent)
  const request = (signal = new AbortController().signal) => {
    const method = 'mcpServer/elicitation/request'
    const handler = handlers.get(method)
    if (handler === undefined) throw new Error('MCP elicitation handler was not registered')
    return handler({ mode: 'form', threadId: 'owned-thread', turnId: 'owned-turn', serverName: 'external-fixture',
      message: 'Allow this MCP tool action once?', requestedSchema: { type: 'object', properties: {} },
      _meta: { codex_approval_kind: 'mcp_tool_call', codex_approval_tool_name: 'external_operation' },
    }, { id: 'consent', generation: 1, method, signal })
  }
  return { ctx, agent, request }
}

describe('native empty-form MCP consent', () => {
  it.each<ApprovalOutcome>(['allowed-once', 'rejected', 'cancelled', 'unavailable'])('returns only the one-shot %s decision', async outcome => {
    const { ctx, agent, request } = await fixture()
    ctx.on('approval/request', async approval => {
      expect(approval.agent).toBe(agent)
      expect(ctx.agents.requireInitiator()).toBe(agent)
      return outcome
    })
    expect(await request()).toEqual(outcome === 'allowed-once'
      ? { action: 'accept', content: {}, _meta: null } : { action: 'cancel', content: null, _meta: null })
    expect(agent.session.snapshotEvents().filter(event => event.type === 'approval/asked')).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').map(event => event.data)).toMatchObject([{ outcome }])
  })

  it('cancels when the owning request expires while approval is pending', async () => {
    const { ctx, request } = await fixture()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<ApprovalOutcome>()
    ctx.on('approval/request', async () => { entered.resolve(); return release.promise })
    const controller = new AbortController()
    const pending = request(controller.signal)
    await entered.promise
    controller.abort()
    release.resolve('allowed-once')
    expect(await pending).toEqual({ action: 'cancel', content: null, _meta: null })
  })
})
