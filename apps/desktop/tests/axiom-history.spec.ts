/** Read-only history paging has its own bounded window, queue, cancellation, and unknown-boundary semantics. */
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopAxiomHistory } from '../src/axiom-history.ts'
import type { AxiomWebsiteWindow } from '../src/axiom-window.ts'

const url = 'https://chatgpt.com/dots/original~history'
const message = { id: 'original-old', role: 'assistant' as const, text: 'Observed old answer', timestamp: null, truncated: false }
const observation = { url, supported: true, anchorFound: true, hasEarlier: false, startVerified: false, messages: [message] }
const owners: DesktopAxiomHistory[] = []
afterEach(() => { for (const owner of owners.splice(0)) owner.disconnect(); vi.useRealTimers() })

function fixture() {
  let currentUrl = ''
  let destroyed = false
  const contents = Object.assign(new EventEmitter(), {
    getURL: vi.fn(() => currentUrl), isLoading: vi.fn(() => false),
    setWindowOpenHandler: vi.fn((_handler: () => { action: string }) => undefined),
    executeJavaScript: vi.fn(async (_script: string): Promise<unknown> => observation),
    loadURL: vi.fn(async (value: string) => { currentUrl = value }),
  })
  const window = { isDestroyed: () => destroyed, destroy: vi.fn(() => { destroyed = true; contents.emit('destroyed') }) }
  const create = vi.fn(() => ({ contents, window }) as AxiomWebsiteWindow)
  const owner = new DesktopAxiomHistory(create)
  owners.push(owner)
  return { owner, create, contents, window }
}

it('returns original source bodies without exhaustion guesses, shares one cursor and rejects competing history work', async () => {
  const h = fixture()
  const first = h.owner.before(url, 'cursor')
  expect(h.owner.before(url, 'cursor')).toBe(first)
  expect(await h.owner.before(url, 'other')).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(await first).toEqual({ messages: [message], hasMore: true, status: 'ready' })
  expect(h.create).toHaveBeenCalledOnce()
  expect(h.contents.loadURL).toHaveBeenCalledWith(url)
  expect(h.contents.setWindowOpenHandler.mock.calls[0]?.[0]()).toEqual({ action: 'deny' })
})

it('does not turn a stable top or a timed-out lazy load into a verified start', async () => {
  vi.useFakeTimers()
  const h = fixture()
  h.contents.executeJavaScript.mockResolvedValue({ ...observation, messages: [] })
  const result = h.owner.before(url, 'cursor')
  await vi.advanceTimersByTimeAsync(20250)
  expect(await result).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(h.contents.executeJavaScript.mock.calls.some(([script]) => script.endsWith(',true)'))).toBe(true)
})

it('bounds a stalled DOM read and keeps it owned instead of queueing additional browser execution', async () => {
  vi.useFakeTimers()
  const h = fixture()
  const pending = Promise.withResolvers<unknown>()
  h.contents.executeJavaScript.mockReturnValue(pending.promise)
  const result = h.owner.before(url, 'cursor')
  await vi.advanceTimersByTimeAsync(5000)
  expect(await result).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(await h.owner.before(url, 'cursor')).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(h.contents.executeJavaScript).toHaveBeenCalledOnce()
  h.owner.disconnect()
  pending.resolve(observation)
  await pending.promise
  expect(h.window.destroy).toHaveBeenCalledOnce()
})

it('cancels an initial load on teardown and never observes an authentication document', async () => {
  const h = fixture()
  h.contents.isLoading.mockReturnValue(true)
  const result = h.owner.before(url, 'cursor')
  h.owner.disconnect()
  expect(await result).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(h.contents.executeJavaScript).not.toHaveBeenCalled()
  expect(h.window.destroy).toHaveBeenCalledOnce()
  const auth = fixture()
  auth.contents.getURL.mockReturnValue('https://auth.openai.com/log-in?state=PRIVATE_AUTH')
  expect(await auth.owner.before(url, 'cursor')).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(auth.contents.executeJavaScript).not.toHaveBeenCalled()
})

it('rejects a late older page after source selection changes', async () => {
  const h = fixture()
  const pending = Promise.withResolvers<unknown>()
  h.contents.executeJavaScript.mockReturnValueOnce(pending.promise)
  const old = h.owner.before(url, 'cursor')
  h.owner.disconnect()
  pending.resolve(observation)
  expect(await old).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(h.window.destroy).toHaveBeenCalledOnce()
})


it('scrolls the original history page until a missing older cursor is mounted', async () => {
  vi.useFakeTimers()
  const h = fixture()
  h.contents.executeJavaScript.mockResolvedValueOnce({ ...observation, anchorFound: false, messages: [] })
  const result = h.owner.before(url, 'older-cursor')
  await vi.advanceTimersByTimeAsync(250)
  expect(await result).toEqual({ messages: [message], hasMore: true, status: 'ready' })
  expect(h.contents.executeJavaScript.mock.calls[1]?.[0]).toMatch(/,true\)$/u)
})

it('releases the destroyed page read slot even when its old JavaScript never settles', async () => {
  const h = fixture()
  const pending = Promise.withResolvers<unknown>()
  h.contents.executeJavaScript.mockReturnValueOnce(pending.promise)
  const old = h.owner.before(url, 'cursor')
  h.owner.disconnect()
  expect(await old).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  // The fixture makes the new window lifetime usable without settling the revoked renderer read.
  h.window.isDestroyed = () => false
  expect(await h.owner.before(url, 'new-cursor')).toEqual({ messages: [message], hasMore: true, status: 'ready' })
  expect(h.contents.executeJavaScript).toHaveBeenCalledTimes(2)
})


it('revokes source observations across a same-URL document reload', async () => {
  const h = fixture()
  const pending = Promise.withResolvers<unknown>()
  h.contents.executeJavaScript.mockReturnValueOnce(pending.promise)
  const old = h.owner.before(url, 'cursor')
  h.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  pending.resolve(observation)
  expect(await old).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(await h.owner.before(url, 'cursor')).toEqual({ messages: [message], hasMore: true, status: 'ready' })
})
