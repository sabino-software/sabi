/** Completed history ingested under maintenance must precede the next real driver turn. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, onTestFinished } from 'vitest'
import { MockAdapter, textResponse } from './mock-adapter.ts'

function appendCompletedHistory(agent: Agent, firstTurn: number): void {
  for (const turn of [firstTurn, firstTurn + 1]) {
    agent.session.append('turn/start', { turn })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `Imported original message ${turn}` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
}

async function followup(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

describe('completed-history maintenance', () => {
  it.each(['created', 'idle'] as const)('starts a subsequent live turn after history imported during %s maintenance', async (phase) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await mountAgentLoopTestDependencies(ctx)
    const adapter = new MockAdapter([textResponse('First live response'), textResponse('Second live response')])
    ctx.llm.registerAdapter(['mock'], adapter)
    await mountAgentLoopTestHarness(ctx)
    if (phase === 'created') {
      ctx.on('agent/created', async ({ agent }) => {
        await agent.runMaintenance(async () => { appendCompletedHistory(agent, 0) })
        return undefined
      })
    }
    const { agent } = await ctx.agents.create({ sessionId: SessionId(`import-maintenance-${phase}`), agentOptions: { provider: 'mock', model: 'mock' } })
    if (phase === 'idle') {
      await followup(agent, 'Initial live message')
      await agent.runMaintenance(async () => { appendCompletedHistory(agent, 2) })
    }
    const importedMax = phase === 'created' ? 1 : 3
    await followup(agent, 'Continue the original conversation')
    const turns = agent.session.snapshotEvents().flatMap(event => event.type === 'turn/start' ? [event.data.turn] : [])
    expect(turns.at(-1)).toBe(importedMax + 1)
    expect(new Set(turns).size).toBe(turns.length)
    expect(adapter.requests).toHaveLength(phase === 'created' ? 1 : 2)
    const observed = adapter.requests.at(-1)?.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    expect(observed).toContain(`Imported original message ${importedMax}`)
    expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { turn: importedMax + 1, reason: { kind: 'completed' } } })
  })
})
