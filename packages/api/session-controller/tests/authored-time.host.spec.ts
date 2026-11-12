/** Imported source times cannot move an old chat to receipt time just by viewing it. */
import { expect, it, onTestFinished } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ApiSessionList, applySessionListMetadata } from '../src/list.ts'

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { TEST_IMAGE_LIMITS } from './test-remote.ts'

it('keeps original author recency before a mirror creation without changing the creation header', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.provide('attachments', { imageLimits: TEST_IMAGE_LIMITS } as never)
  const list = new ApiSessionList(ctx, 1)
  await list.initialize()
  const session = ctx.sessions.create(SessionId('new-mirror'))
  const createdAt = session.header.createdAt
  const authoredAt = createdAt - 9 * 60 * 60 * 1000
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Original question' }], source: { kind: 'user' }, authoredAt,
  }), { surfaceOp: 'append' })
  expect(list.summaryFor(session).updatedAt).toBe(authoredAt)
  expect(session.header.createdAt).toBe(createdAt)
  const own = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'New local question' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  expect(list.summaryFor(session).updatedAt).toBe(own.time)
})

it('orders imported prompts by authored time and ignores unknown original times', () => {
  const session = Session.create(SessionId('source-recency'))
  const initial = { blank: false, lastPromptAt: null }
  const authoredAt = 1_600_000_000_000
  const imported = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Old original question' }], source: { kind: 'user' }, authoredAt,
  }), { surfaceOp: 'append' })
  expect(imported.time).toBeGreaterThan(authoredAt)
  const state = applySessionListMetadata(initial, imported)
  expect(state).toEqual({ blank: false, lastPromptAt: authoredAt, authoredPrompt: true })
  const unknown = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Unknown original date' }], source: { kind: 'user' }, authoredAt: null,
  }), { surfaceOp: 'append' })
  expect(applySessionListMetadata(state, unknown)).toBe(state)
  const own = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'A fresh user turn' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  expect(applySessionListMetadata(state, own).lastPromptAt).toBe(own.time)
})
