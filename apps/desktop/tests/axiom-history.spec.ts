/** Read-only history paging has its own bounded window, queue, cancellation, and unknown-boundary semantics. */
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopAxiomHistory } from '../src/axiom-history.ts'
import type { AxiomWebsiteWindow } from '../src/axiom-window.ts'

const url = 'https://chatgpt.com/dots/original~history'
const message = { id: 'original-old', role: 'assistant' as const, text: 'Observed old answer', timestamp: null, truncated: false }
const observation = { url, supported: true, anchorFound: true, hasEarlier: false, startVerified: false, messages: [message] }
const owners: DesktopAxiomHistory[] = []
afterEach(() => {
  for (const owner of owners.splice(0)) owner.disconnect()
  vi.useRealTimers(); vi.restoreAllMocks()
})

function fixture() {
  let currentUrl = ''
  let destroyed = false
  const contents = Object.assign(new EventEmitter(), {
    getURL: vi.fn(() => currentUrl), isLoading: vi.fn(() => false),
    setWindowOpenHandler: vi.fn((_handler: () => { action: string }) => undefined),
    sendInputEvent: vi.fn((_event: Electron.MouseWheelInputEvent) => {}),
    executeJavaScript: vi.fn(async (_script: string): Promise<unknown> => observation),
    loadURL: vi.fn(async (value: string) => { currentUrl = value }),
  })
  const window = { isDestroyed: () => destroyed, destroy: vi.fn(() => { destroyed = true; contents.emit('destroyed') }) }
  const create = vi.fn(() => ({ contents, window }) as unknown as AxiomWebsiteWindow)
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


it('preserves optional source row order through secondary history without requiring it from older readers', async () => {
  const h = fixture()
  const sourceOrder = ['missing-older-body', message.id]
  h.contents.executeJavaScript.mockResolvedValue({ ...observation, sourceOrder })
  expect(await h.owner.before(url, 'cursor')).toEqual({ messages: [message], sourceOrder, hasMore: true, status: 'ready' })
})


const wheel = { x: 300, y: 200, deltaY: 320, viewportWidth: 800, viewportHeight: 600 }

it('dispatches only a validated 1px downward top nudge followed by the ordinary upward input', async () => {
  vi.useFakeTimers()
  const h = fixture()
  h.contents.executeJavaScript
    .mockResolvedValueOnce({ ...observation, messages: [], wheel: { ...wheel, deltaY: -1 }, seekProgress: { rowCount: 52, scrollTop: 0 } })
    .mockResolvedValueOnce({ ...observation, messages: [], wheel, seekProgress: { rowCount: 52, scrollTop: 1 } })
  const pending = h.owner.before(url, 'cursor')
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({ status: 'ready', messages: [message] })
  expect(h.contents.sendInputEvent.mock.calls.map(([event]) => event.deltaY)).toEqual([-1, 320])
  expect(h.contents.sendInputEvent.mock.calls[0]?.[0]).toEqual({ type: 'mouseWheel', x: 300, y: 200,
    deltaX: 0, deltaY: -1, canScroll: true, hasPreciseScrollingDeltas: true })
})

it.each([
  { name: 'missing progress', progress: undefined },
  { name: 'nonzero position', progress: { rowCount: 52, scrollTop: 1 } },
  { name: 'negative position', progress: { rowCount: 52, scrollTop: -1 } },
  { name: 'unbounded position', progress: { rowCount: 52, scrollTop: 1000000001 } },
  { name: 'unbounded row count', progress: { rowCount: 1000001, scrollTop: 0 } },
])('refuses a downward nudge with $name', async ({ progress }) => {
  const h = fixture()
  h.contents.executeJavaScript.mockResolvedValue({ ...observation, messages: [], wheel: { ...wheel, deltaY: -1 }, seekProgress: progress })
  expect(await h.owner.before(url, 'cursor')).toMatchObject({ status: 'unavailable' })
  expect(h.contents.sendInputEvent).not.toHaveBeenCalled()
})

it.each(['row growth', 'cumulative upward movement'] as const)('keeps seeking past 20 seconds only with %s', async (kind) => {
  vi.useFakeTimers()
  const start = Date.now()
  const h = fixture()
  h.contents.executeJavaScript.mockImplementation(async () => {
    const elapsed = Date.now() - start
    return elapsed >= 25000 ? observation : { ...observation, anchorFound: false, messages: [], wheel,
      seekProgress: kind === 'row growth'
        ? { rowCount: 32 + Math.floor(elapsed / 5000) * 32, scrollTop: 10000 }
        : { rowCount: 124, scrollTop: 10000 - Math.floor(elapsed / 250) * 8 } }
  })
  const pending = h.owner.before(url, 'far-cursor')
  const finished = vi.fn()
  void pending.then(finished)
  await vi.advanceTimersByTimeAsync(20000)
  expect(finished).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(5000)
  expect(await pending).toEqual({ messages: [message], hasMore: true, status: 'ready' })
})

it('stops a 0-to-1px nudge oscillation after 20 seconds without treating it as seek progress', async () => {
  vi.useFakeTimers()
  const h = fixture()
  let scrollTop = 0
  h.contents.executeJavaScript.mockImplementation(async () => ({ ...observation, anchorFound: false, messages: [],
    seekProgress: { rowCount: 124, scrollTop }, wheel: { ...wheel, deltaY: scrollTop === 0 ? -1 : 320 } }))
  h.contents.sendInputEvent.mockImplementation((event) => { scrollTop = event.deltaY === -1 ? 1 : 0 })
  const pending = h.owner.before(url, 'far-cursor')
  const finished = vi.fn()
  void pending.then(finished)
  await vi.advanceTimersByTimeAsync(19999)
  expect(finished).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(await pending).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  const count = h.contents.sendInputEvent.mock.calls.length
  expect(count).toBeGreaterThan(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.contents.sendInputEvent).toHaveBeenCalledTimes(count)
})

it('caps the final pause to the stall deadline when DOM reads offset the polling cadence', async () => {
  vi.useFakeTimers()
  const h = fixture()
  h.contents.executeJavaScript.mockImplementation(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 1) })
    return { ...observation, anchorFound: false, messages: [] }
  })
  const pending = h.owner.before(url, 'far-cursor')
  const finished = vi.fn()
  void pending.then(finished)
  await vi.advanceTimersByTimeAsync(19999)
  expect(finished).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(await pending).toMatchObject({ status: 'unavailable' })
})

it('hard caps even continuously progressing seeks at 90 seconds', async () => {
  vi.useFakeTimers()
  const start = Date.now()
  const h = fixture()
  h.contents.executeJavaScript.mockImplementation(async () => ({ ...observation, anchorFound: false, messages: [], wheel,
    seekProgress: { rowCount: 32 + Math.floor((Date.now() - start) / 1000), scrollTop: 1000 } }))
  const pending = h.owner.before(url, 'far-cursor')
  const finished = vi.fn()
  void pending.then(finished)
  await vi.advanceTimersByTimeAsync(89999)
  expect(finished).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(await pending).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  const count = h.contents.sendInputEvent.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.contents.sendInputEvent).toHaveBeenCalledTimes(count)
})

it.each([20000, 90000])('bounds a pending read to the remaining %ims seek deadline and refuses its late input', async (limit) => {
  vi.useFakeTimers()
  const start = Date.now()
  const h = fixture()
  const reading = Promise.withResolvers<unknown>()
  h.contents.executeJavaScript.mockImplementation(async () => {
    const elapsed = Date.now() - start
    if (elapsed >= limit - 1000) return reading.promise
    return { ...observation, anchorFound: false, messages: [], wheel,
      seekProgress: { rowCount: limit === 90000 ? 32 + Math.floor(elapsed / 1000) : 32, scrollTop: 1000 } }
  })
  const pending = h.owner.before(url, 'far-cursor')
  const finished = vi.fn()
  void pending.then(finished)
  await vi.advanceTimersByTimeAsync(limit - 1)
  expect(finished).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(await pending).toMatchObject({ status: 'unavailable' })
  const count = h.contents.sendInputEvent.mock.calls.length
  expect(await h.owner.before(url, 'far-cursor')).toMatchObject({ status: 'unavailable' })
  reading.resolve({ ...observation, wheel, seekProgress: { rowCount: 302, scrollTop: 0 } })
  await reading.promise
  expect(h.contents.sendInputEvent).toHaveBeenCalledTimes(count)
})

it('cancels a progress-extended seek immediately on teardown without further input', async () => {
  vi.useFakeTimers()
  const start = Date.now()
  const h = fixture()
  h.contents.executeJavaScript.mockImplementation(async () => ({ ...observation, anchorFound: false, messages: [], wheel,
    seekProgress: { rowCount: 32 + Math.floor((Date.now() - start) / 1000), scrollTop: 1000 } }))
  const pending = h.owner.before(url, 'far-cursor')
  await vi.advanceTimersByTimeAsync(21000)
  const count = h.contents.sendInputEvent.mock.calls.length
  h.owner.disconnect()
  expect(await pending).toMatchObject({ status: 'unavailable' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.contents.sendInputEvent).toHaveBeenCalledTimes(count)
  expect(h.window.destroy).toHaveBeenCalledOnce()
})

it('dispatches one bounded upward native wheel only to the secondary owner, then returns observed older content', async () => {
  vi.useFakeTimers()
  const h = fixture()
  h.contents.executeJavaScript.mockResolvedValueOnce({ ...observation, messages: [], wheel })
  const pending = h.owner.before(url, 'cursor')
  await vi.advanceTimersByTimeAsync(250)
  expect(await pending).toMatchObject({ status: 'ready', messages: [message] })
  expect(h.contents.sendInputEvent).toHaveBeenCalledExactlyOnceWith({ type: 'mouseWheel', x: 300, y: 200,
    deltaX: 0, deltaY: 320, canScroll: true, hasPreciseScrollingDeltas: true })
})

it.each([
  { name: 'outside the viewport', value: { ...wheel, x: 800 } },
  { name: 'an excessive step', value: { ...wheel, deltaY: 601 } },
  { name: 'a downward step', value: { ...wheel, deltaY: -320 } },
])('refuses a wheel proposal with $name', async ({ value }) => {
  const h = fixture()
  h.contents.executeJavaScript.mockResolvedValue({ ...observation, messages: [], wheel: value })
  expect(await h.owner.before(url, 'cursor')).toMatchObject({ status: 'unavailable' })
  expect(h.contents.sendInputEvent).not.toHaveBeenCalled()
})

it.each(['close', 'navigation', 'wrong-url', 'loading'].flatMap(change => [320, -1].map(deltaY => ({ change, deltaY }))))(
  'does not dispatch late native input $deltaY after $change', async ({ change, deltaY }) => {
    const h = fixture()
    const reading = Promise.withResolvers<unknown>()
    h.contents.executeJavaScript.mockReturnValueOnce(reading.promise)
    const pending = h.owner.before(url, 'cursor')
    if (change === 'close') h.owner.disconnect()
    else if (change === 'navigation') h.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    else if (change === 'wrong-url') h.contents.getURL.mockReturnValue('https://auth.openai.com/log-in')
    else h.contents.isLoading.mockReturnValue(true)
    reading.resolve({ ...observation, messages: [], wheel: { ...wheel, deltaY }, seekProgress: { rowCount: 52, scrollTop: 0 } })
    expect(await pending).toMatchObject({ status: 'unavailable' })
    expect(h.contents.sendInputEvent).not.toHaveBeenCalled()
  },
)

it('never dispatches native input from a read whose deadline expired', async () => {
  vi.useFakeTimers()
  const h = fixture()
  const reading = Promise.withResolvers<unknown>()
  h.contents.executeJavaScript.mockReturnValueOnce(reading.promise)
  const pending = h.owner.before(url, 'cursor')
  await vi.advanceTimersByTimeAsync(5001)
  expect(await pending).toMatchObject({ status: 'unavailable' })
  reading.resolve({ ...observation, messages: [], wheel })
  await Promise.resolve()
  expect(h.contents.sendInputEvent).not.toHaveBeenCalled()
})
