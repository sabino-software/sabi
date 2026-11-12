/** Deployment login deadlines have finite validated bounds and retain their documented defaults. */
import { describe, expect, it } from 'vitest'
import NativeConversations from '../src/index.ts'

describe('managed Codex login configuration', () => {
  it('defaults the callback wait to five minutes and cancellation to five seconds', () => {
    const config = NativeConversations.Config({})
    expect(config.codexLoginTimeoutMs).toBe(300000)
    expect(config.codexLoginCancelTimeoutMs).toBe(5000)
  })

  it('accepts deployment-selected deadlines within the supported bounds', () => {
    const config = NativeConversations.Config({ codexLoginTimeoutMs: 900000, codexLoginCancelTimeoutMs: 15000 })
    expect(config.codexLoginTimeoutMs).toBe(900000)
    expect(config.codexLoginCancelTimeoutMs).toBe(15000)
  })

  it.each([0, 999, 1800001, 1500.5, Number.POSITIVE_INFINITY])('rejects an invalid callback timeout %s', (value) => {
    expect(() => NativeConversations.Config({ codexLoginTimeoutMs: value })).toThrow()
  })

  it.each([0, 999, 60001, 1500.5, Number.POSITIVE_INFINITY])('rejects an invalid cancellation timeout %s', (value) => {
    expect(() => NativeConversations.Config({ codexLoginCancelTimeoutMs: value })).toThrow()
  })
})
