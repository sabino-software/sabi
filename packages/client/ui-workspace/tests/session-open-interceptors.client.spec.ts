/** Legacy view redirects consume navigation before an ordinary Session can be retained. */
import { expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionOpenInterceptors } from '../src/client/session-open-interceptors.ts'

it('preserves synchronous ordinary navigation and returns to it when a registration is disposed', () => {
  const routes = new SessionOpenInterceptors()
  const id = 'ordinary' as SessionId
  const signal = new AbortController().signal
  expect(routes.inspect(id, signal)).toBe(false)
  const off = routes.register(() => true)
  expect(routes.inspect(id, signal)).toBe(true)
  off()
  expect(routes.inspect(id, signal)).toBe(false)
})
it('awaits feature metadata before allowing retain, and stops at a consumed hidden route', async () => {
  const routes = new SessionOpenInterceptors()
  const pending = Promise.withResolvers<boolean>()
  const later = vi.fn(() => false)
  routes.register(() => pending.promise)
  routes.register(later)
  const decision = routes.inspect('hidden' as SessionId, new AbortController().signal)
  pending.resolve(true)
  expect(await decision).toBe(true)
  expect(later).not.toHaveBeenCalled()
})
it('refuses continuation after navigation cancellation and does not fall through on a metadata error', async () => {
  const routes = new SessionOpenInterceptors()
  const controller = new AbortController()
  const pending = Promise.withResolvers<boolean>()
  const later = vi.fn(() => false)
  routes.register(() => pending.promise)
  routes.register(later)
  const decision = routes.inspect('legacy' as SessionId, controller.signal)
  controller.abort()
  pending.resolve(false)
  expect(await decision).toBe(true)
  expect(later).not.toHaveBeenCalled()
  const failing = new SessionOpenInterceptors()
  failing.register(async () => { throw new Error('metadata unavailable') })
  await expect(failing.inspect('legacy' as SessionId, new AbortController().signal)).rejects.toThrow('metadata unavailable')
})
